from deept_agent.brain import FALLBACK_REPLY, Brain, Say, ToolStarted

from .fakes import FakeClaude, make_ctx, response, text, tool_use


async def collect(brain, said):
    return [e async for e in brain.reply(said)]


async def test_answers_with_a_tool_and_streams_sentences():
    claude = FakeClaude(
        response(text("یک لحظه."), tool_use("find_price", {"document": "شناسنامه"})),
        response(text("ترجمه شناسنامه صد و هفتاد و یک هزار تومانه. سؤال دیگه‌ای دارید؟")),
    )
    brain = Brain(make_ctx(), claude, model="test-model")
    events = await collect(brain, "قیمت ترجمه شناسنامه چنده؟")

    assert events == [
        Say("یک لحظه."),
        ToolStarted("find_price"),
        Say("ترجمه شناسنامه صد و هفتاد و یک هزار تومانه."),
        Say("سؤال دیگه‌ای دارید؟"),
    ]
    # Second request carries the tool result for the first request's tool call.
    tool_result = claude.requests[1]["messages"][-1]["content"][0]
    assert tool_result["type"] == "tool_result" and tool_result["tool_use_id"] == "toolu_1"
    assert "171360" in tool_result["content"]
    assert claude.requests[0]["model"] == "test-model"
    assert claude.requests[0]["cache_control"] == {"type": "ephemeral"}


async def test_system_prompt_is_the_same_for_every_call():
    ctx = make_ctx()
    assert Brain(ctx, FakeClaude()).system == Brain(ctx, FakeClaude()).system


async def test_refusal_falls_back_to_a_human():
    ctx = make_ctx()
    brain = Brain(ctx, FakeClaude(response(stop_reason="refusal")))
    events = await collect(brain, "...")
    assert events == [Say(FALLBACK_REPLY)]
    assert ctx.state.transfer_to == "101"
    assert brain.messages[-1]["role"] == "user"


async def test_interrupted_tool_call_is_dropped_from_history():
    brain = Brain(make_ctx(), FakeClaude(response(text("باشه."))))
    brain.messages = [
        {"role": "user", "content": "سلام"},
        {"role": "assistant", "content": [tool_use("office_info", {})]},  # caller barged in before the result
    ]
    await collect(brain, "آدرس کجاست؟")
    roles = [m["role"] for m in brain.messages]
    assert roles == ["user", "user", "assistant"]
