"""The conversation loop: caller text in, speakable sentences out.

Replies stream sentence by sentence so the phone side can start speaking the
first sentence while Claude is still writing the rest.
"""

import asyncio
import logging
import os
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass

import anthropic

from .prompt import build_system_prompt
from .tools import TOOLS, CallContext, run_tool

log = logging.getLogger(__name__)

# Haiku keeps latency and cost low enough for a live call; set DEEPT_AGENT_MODEL
# to try a larger model (e.g. claude-sonnet-5) if answers need more judgement.
DEFAULT_MODEL = os.environ.get("DEEPT_AGENT_MODEL", "claude-haiku-4-5")
MAX_TOOL_ROUNDS = 5

# End of a sentence: . ! ? ؟ … or a newline, followed by whitespace.
_SENTENCE_END = re.compile(r"(?<=[.!?؟…\n])\s+")

FALLBACK_REPLY = "ببخشید، یک مشکل فنی پیش اومد. اجازه بدید وصلتون کنم به همکارم."


@dataclass
class Say:
    text: str


@dataclass
class ToolStarted:
    name: str


Event = Say | ToolStarted


class Brain:
    def __init__(self, ctx: CallContext, client: anthropic.AsyncAnthropic, model: str = DEFAULT_MODEL):
        self.ctx = ctx
        self.client = client
        self.model = model
        self.system = build_system_prompt(ctx.office)
        self.messages: list[dict] = []

    def _drop_unanswered_tool_call(self) -> None:
        """A barge-in can cancel a reply between Claude's tool call and our tool
        result; the API rejects a tool_use with no tool_result, so drop it."""
        if self.messages and self.messages[-1]["role"] == "assistant":
            content = self.messages[-1]["content"]
            if not isinstance(content, str) and any(getattr(b, "type", None) == "tool_use" for b in content):
                self.messages.pop()

    async def reply(self, caller_text: str) -> AsyncIterator[Event]:
        self._drop_unanswered_tool_call()
        self.messages.append({"role": "user", "content": caller_text})
        try:
            for _ in range(MAX_TOOL_ROUNDS):
                buffer = ""
                async with self.client.messages.stream(
                    model=self.model,
                    max_tokens=1024,
                    system=self.system,
                    tools=TOOLS,
                    messages=self.messages,
                    cache_control={"type": "ephemeral"},
                ) as stream:
                    async for event in stream:
                        if event.type == "text":
                            buffer += event.text
                            *done, buffer = _SENTENCE_END.split(buffer)
                            for sentence in done:
                                if sentence.strip():
                                    yield Say(sentence.strip())
                    response = await stream.get_final_message()
                if buffer.strip():
                    yield Say(buffer.strip())

                self.messages.append({"role": "assistant", "content": response.content})
                tool_uses = [b for b in response.content if b.type == "tool_use"]
                if response.stop_reason == "refusal":
                    self.messages.pop()  # a refused turn can't be continued; keep history valid
                    yield Say(FALLBACK_REPLY)
                    self.ctx.state.transfer_to = self.ctx.office.human_extension
                    return
                if not tool_uses or response.stop_reason == "max_tokens":
                    if tool_uses:  # truncated tool call: don't run it, and don't leave it unanswered
                        self.messages.pop()
                    return

                for block in tool_uses:
                    yield ToolStarted(block.name)
                results = await asyncio.gather(*(run_tool(self.ctx, b.name, b.input) for b in tool_uses))
                self.messages.append({"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": b.id, "content": r} for b, r in zip(tool_uses, results)
                ]})
            log.warning("gave up after %d tool rounds", MAX_TOOL_ROUNDS)
            yield Say(FALLBACK_REPLY)
            self.ctx.state.transfer_to = self.ctx.office.human_extension
        except anthropic.APIError:
            log.exception("Claude API call failed")
            yield Say(FALLBACK_REPLY)
            self.ctx.state.transfer_to = self.ctx.office.human_extension
