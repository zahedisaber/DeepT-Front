"""Phone server: Asterisk connects here for every call the agent answers.

Two listeners:
  - AudioSocket (default :9092): the call audio.
  - Control HTTP (default 127.0.0.1:8090), called from the Asterisk dialplan:
      GET /register?uuid=..&did=..&caller=..   before AudioSocket(): which office and caller
      GET /result?uuid=..                      after it: "TRANSFER:<ext>" or "HANGUP:"
    AudioSocket itself only carries a call UUID, so this is how the dialed
    number goes in and the transfer decision comes back out.
    Keep it on localhost or a private network; it has no authentication.

Run:  python -m deept_agent.phone.server
"""

import asyncio
import logging
import os
import time
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from anthropic import AsyncAnthropic

from ..brain import Brain
from ..catalog import Catalog
from ..office import Office, OfficeDirectory
from ..services import JsonOrders, KavenegarSms, LogSms, normalize_phone
from ..speech import OpenAISpeechToText, OpenAITextToSpeech, TextToSpeech
from ..tools import CallContext
from .audiosocket import KIND_UUID, parse_uuid, read_frame
from .call import CallSession

log = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[2]
FILLER = "یک لحظه، الان نگاه می‌کنم."
GOODBYE = "اگر سؤال دیگه‌ای ندارید، روز خوبی داشته باشید. خداحافظ."


class CallRegistry:
    """Per-call info handed between the dialplan and the audio connection."""

    TTL = 3600

    def __init__(self):
        self.calls: dict[str, dict] = {}

    def register(self, call_id: str, did: str | None, caller: str | None) -> None:
        cutoff = time.monotonic() - self.TTL
        self.calls = {k: v for k, v in self.calls.items() if v["at"] > cutoff}
        self.calls[call_id] = {"at": time.monotonic(), "did": did, "caller": caller, "result": None}

    def get(self, call_id: str) -> dict:
        return self.calls.get(call_id) or {"at": time.monotonic(), "did": None, "caller": None, "result": None}

    def set_result(self, call_id: str, result: str) -> None:
        self.calls.setdefault(call_id, self.get(call_id))["result"] = result


class PhoneServer:
    def __init__(self, offices: OfficeDirectory, catalog: Catalog, orders, sms, claude: AsyncAnthropic,
                 stt, tts: TextToSpeech, default_office: str | None = None):
        self.offices, self.catalog, self.orders, self.sms = offices, catalog, orders, sms
        self.claude, self.stt, self.tts = claude, stt, tts
        self.default_office = default_office
        self.registry = CallRegistry()
        self._tts_cache: dict[str, bytes] = {}

    async def cached_speech(self, text: str) -> bytes:
        """Greeting, filler and goodbye are the same on every call; synthesize once."""
        if text not in self._tts_cache:
            self._tts_cache[text] = await self.tts.synthesize(text)
        return self._tts_cache[text]

    def pick_office(self, did: str | None) -> Office | None:
        office = self.offices.find(dialed=did, office_id=self.default_office)
        if office is None and len(self.offices.by_id) == 1:
            office = next(iter(self.offices.by_id.values()))
        return office

    async def handle_call(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        kind, payload = await read_frame(reader)
        if kind != KIND_UUID:
            log.warning("AudioSocket connection did not start with a UUID frame")
            writer.close()
            return
        call_id = parse_uuid(payload)
        info = self.registry.get(call_id)
        office = self.pick_office(info["did"])
        if office is None:
            log.error("call %s: no office for dialed number %r", call_id, info["did"])
            self.registry.set_result(call_id, "HANGUP:")
            writer.close()
            return
        log.info("call %s: office=%s caller=%s", call_id, office.id, info["caller"])
        ctx = CallContext(office=office, catalog=self.catalog, orders=self.orders, sms=self.sms,
                          caller=normalize_phone(info["caller"]))
        session = CallSession(
            reader, writer, ctx, Brain(ctx, self.claude), self.stt, self.tts,
            greeting=await self.cached_speech(office.greeting),
            filler=await self.cached_speech(FILLER),
            goodbye=await self.cached_speech(GOODBYE),
        )
        try:
            await session.run()
        finally:
            result = f"TRANSFER:{ctx.state.transfer_to}" if ctx.state.transfer_to else "HANGUP:"
            self.registry.set_result(call_id, result)
            log.info("call %s ended: %s", call_id, result)

    async def handle_control(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            request_line = (await reader.readline()).decode(errors="ignore")
            while (await reader.readline()) not in (b"\r\n", b"\n", b""):
                pass  # skip headers
            parts = request_line.split()
            url = urlsplit(parts[1] if len(parts) > 1 else "/")
            query = {k: v[0] for k, v in parse_qs(url.query).items()}
            status, body = "200 OK", ""
            if url.path == "/register" and query.get("uuid"):
                self.registry.register(query["uuid"], query.get("did"), query.get("caller"))
                body = "OK"
            elif url.path == "/result" and query.get("uuid"):
                body = self.registry.get(query["uuid"])["result"] or "HANGUP:"
            else:
                status, body = "404 Not Found", "not found"
            data = body.encode()
            writer.write(f"HTTP/1.1 {status}\r\nContent-Type: text/plain\r\nContent-Length: {len(data)}\r\nConnection: close\r\n\r\n".encode() + data)
            await writer.drain()
        finally:
            writer.close()


def build_server() -> PhoneServer:
    from openai import AsyncOpenAI

    offices = OfficeDirectory.load(Path(os.environ.get("DEEPT_OFFICES_DIR", ROOT / "offices")))
    catalog = Catalog.load(Path(os.environ["DEEPT_PRICE_CATALOG"])) if os.environ.get("DEEPT_PRICE_CATALOG") else Catalog.load()
    orders = JsonOrders(Path(os.environ.get("DEEPT_ORDERS_FILE", ROOT / "offices" / "orders.json")))
    if os.environ.get("KAVENEGAR_API_KEY"):
        sms = KavenegarSms(os.environ["KAVENEGAR_API_KEY"], os.environ["KAVENEGAR_SENDER"])
    else:
        sms = LogSms()
    openai_client = AsyncOpenAI()
    return PhoneServer(
        offices, catalog, orders, sms, AsyncAnthropic(),
        OpenAISpeechToText(openai_client), OpenAITextToSpeech(openai_client),
        default_office=os.environ.get("DEEPT_DEFAULT_OFFICE"),
    )


async def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(name)s %(message)s")
    server = build_server()
    audio = await asyncio.start_server(server.handle_call, os.environ.get("AUDIOSOCKET_HOST", "0.0.0.0"),
                                       int(os.environ.get("AUDIOSOCKET_PORT", 9092)))
    control = await asyncio.start_server(server.handle_control, os.environ.get("CONTROL_HOST", "127.0.0.1"),
                                         int(os.environ.get("CONTROL_PORT", 8090)))
    log.info("AudioSocket on %s, control on %s", audio.sockets[0].getsockname(), control.sockets[0].getsockname())
    async with audio, control:
        await asyncio.gather(audio.serve_forever(), control.serve_forever())


if __name__ == "__main__":
    asyncio.run(main())
