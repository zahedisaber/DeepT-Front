"""Talk to the receptionist by typing, to test its answers without a phone.

    python -m deept_agent.console                     # the only/first office
    python -m deept_agent.console --caller 09121234567 --office sample

Shows each spoken sentence, the tools it used, and SMS it would send.
Needs ANTHROPIC_API_KEY (no speech services).
"""

import argparse
import asyncio
import logging
from pathlib import Path

from anthropic import AsyncAnthropic

from .brain import DEFAULT_MODEL, Brain, Say, ToolStarted
from .catalog import Catalog
from .office import OfficeDirectory
from .persian import to_speakable
from .services import JsonOrders, LogSms, normalize_phone
from .tools import CallContext

ROOT = Path(__file__).resolve().parents[1]


async def chat(args: argparse.Namespace) -> None:
    offices = OfficeDirectory.load(Path(args.offices))
    office = offices.find(office_id=args.office) or next(iter(offices.by_id.values()))
    sms = LogSms()
    ctx = CallContext(office=office, catalog=Catalog.load(), orders=JsonOrders(Path(args.offices) / "orders.json"),
                      sms=sms, caller=normalize_phone(args.caller))
    brain = Brain(ctx, AsyncAnthropic(), model=args.model)

    print(f"office: {office.name}   caller: {ctx.caller or 'hidden'}   model: {args.model}")
    print("(empty line or Ctrl+D to quit)\n")
    print(f"🤖 {office.greeting}")
    while True:
        try:
            text = input("\n👤 ").strip()
        except EOFError:
            break
        if not text:
            break
        sent_before = len(sms.sent)
        async for event in brain.reply(text):
            if isinstance(event, Say):
                print(f"🤖 {event.text}")
                if args.show_speech:
                    print(f"   🔊 {to_speakable(event.text)}")
            elif isinstance(event, ToolStarted):
                print(f"   ⚙ {event.name}")
        for to, body in sms.sent[sent_before:]:
            print(f"   ✉ SMS to {to}: {body!r}")
        for message in ctx.state.messages_taken:
            print(f"   📝 message: {message}")
        ctx.state.messages_taken.clear()
        if ctx.state.transfer_to:
            print(f"   ☎ (call would transfer to extension {ctx.state.transfer_to})")
            break
        if ctx.state.end_call:
            print("   ☎ (call ended)")
            break


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--office", help="office id from offices/*.yaml")
    parser.add_argument("--offices", default=str(ROOT / "offices"))
    parser.add_argument("--caller", default="09121234567", help="caller ID to simulate; '' for hidden")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--show-speech", action="store_true", help="also print the text as the TTS voice would get it")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING)
    try:
        asyncio.run(chat(args))
    except TypeError as exc:
        if "authentication" not in str(exc):
            raise
        raise SystemExit("No Claude credentials: set ANTHROPIC_API_KEY (or run `ant auth login`).") from None


if __name__ == "__main__":
    main()
