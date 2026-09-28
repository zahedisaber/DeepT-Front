"""A whole phone call through the AudioSocket server, with fake Claude and speech."""

import asyncio
import math
import struct
import uuid

from deept_agent.catalog import Catalog
from deept_agent.office import OfficeDirectory
from deept_agent.phone.audiosocket import KIND_AUDIO, KIND_HANGUP, KIND_UUID, pack, read_frame
from deept_agent.phone.call import EnergyVAD
from deept_agent.phone.server import PhoneServer
from deept_agent.services import JsonOrders, LogSms
from deept_agent.speech import FRAME_BYTES, resample

from .fakes import ROOT, FakeClaude, FakeSTT, FakeTTS, make_office, response, text, tool_use

LOUD = struct.pack("<160h", *(int(6000 * math.sin(i / 3)) for i in range(160)))
QUIET = b"\0" * FRAME_BYTES


def test_vad_finds_one_utterance():
    vad = EnergyVAD()
    events = [vad.feed(f) for f in [QUIET] * 20 + [LOUD] * 20 + [QUIET] * 40]
    kinds = [e[0] for e in events if e]
    assert kinds == ["start", "end"]
    utterance = [e for e in events if e and e[0] == "end"][0][1]
    assert len(utterance) >= 20 * FRAME_BYTES


def test_resample_24k_to_8k():
    pcm = struct.pack("<6h", 3, 3, 3, 9, 9, 9)
    assert resample(pcm, 24000, 8000) == struct.pack("<2h", 3, 9)


async def http_get(port: int, path: str) -> str:
    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    writer.write(f"GET {path} HTTP/1.1\r\nHost: x\r\n\r\n".encode())
    await writer.drain()
    data = await reader.read()
    writer.close()
    return data.decode().split("\r\n\r\n", 1)[1]


async def start_call(claude, stt, tts):
    server = PhoneServer(OfficeDirectory([make_office()]), Catalog.load(), JsonOrders(ROOT / "offices" / "orders.json"),
                         LogSms(), claude, stt, tts)
    audio = await asyncio.start_server(server.handle_call, "127.0.0.1", 0)
    control = await asyncio.start_server(server.handle_control, "127.0.0.1", 0)
    control_port = control.sockets[0].getsockname()[1]
    call_id = str(uuid.uuid4())
    assert await http_get(control_port, f"/register?uuid={call_id}&did=5000&caller=09121234567") == "OK"
    reader, writer = await asyncio.open_connection("127.0.0.1", audio.sockets[0].getsockname()[1])
    writer.write(pack(KIND_UUID, uuid.UUID(call_id).bytes))
    await writer.drain()
    return audio, control, control_port, call_id, reader, writer


async def read_until_hangup(reader) -> int:
    received = 0
    async with asyncio.timeout(10):
        while True:
            kind, payload = await read_frame(reader)
            if kind == KIND_HANGUP:
                return received
            assert kind == KIND_AUDIO and len(payload) == FRAME_BYTES
            received += 1


async def say(writer, frames):
    for frame in frames:
        writer.write(pack(KIND_AUDIO, frame))
    await writer.drain()


async def test_call_answers_then_transfers():
    claude = FakeClaude(
        response(tool_use("transfer_to_human", {"reason": "caller asked for a person"})),
        response(text("چشم، الان وصلتون می‌کنم.")),
    )
    stt, tts = FakeSTT("می‌خوام با یه آدم صحبت کنم"), FakeTTS()
    audio, control, control_port, call_id, reader, writer = await start_call(claude, stt, tts)

    for _ in range(5):  # listen to the whole greeting (0.1 s = 5 frames) before speaking
        assert (await read_frame(reader))[0] == KIND_AUDIO
    await say(writer, [QUIET] * 10 + [LOUD] * 15 + [QUIET] * 40)
    received = await read_until_hangup(reader)
    writer.close()

    # filler (the tool call came before any words) + the reply, 5 frames each
    assert received == 10
    assert tts.spoken[0] == "سلام، بفرمایید." and tts.spoken[-1] == "چشم، الان وصلتون می‌کنم."
    assert stt.calls == 1
    assert await http_get(control_port, f"/result?uuid={call_id}") == "TRANSFER:101"
    audio.close()
    control.close()


async def test_caller_talking_over_the_greeting_cuts_it_off():
    claude = FakeClaude(response(text("خواهش می‌کنم، خداحافظ."), tool_use("end_call", {})), response(text("")))
    stt, tts = FakeSTT("ممنون"), FakeTTS()
    audio, control, control_port, call_id, reader, writer = await start_call(claude, stt, tts)

    await say(writer, [LOUD] * 15 + [QUIET] * 40)  # starts talking straight away
    received = await read_until_hangup(reader)
    writer.close()

    assert 5 <= received < 10  # the greeting was cut short; the goodbye (5 frames) played in full
    assert await http_get(control_port, f"/result?uuid={call_id}") == "HANGUP:"
    audio.close()
    control.close()
