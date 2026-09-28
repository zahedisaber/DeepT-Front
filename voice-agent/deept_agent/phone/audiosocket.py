"""Asterisk AudioSocket wire format.

Each frame: 1 byte kind, 2 bytes big-endian payload length, payload.
Audio payloads are 8 kHz 16-bit signed little-endian mono PCM.
https://docs.asterisk.org/Configuration/Channel-Drivers/AudioSocket/
"""

import asyncio
import struct
import uuid

KIND_HANGUP = 0x00
KIND_UUID = 0x01
KIND_DTMF = 0x03
KIND_AUDIO = 0x10
KIND_ERROR = 0xFF


def pack(kind: int, payload: bytes = b"") -> bytes:
    return struct.pack(">BH", kind, len(payload)) + payload


async def read_frame(reader: asyncio.StreamReader) -> tuple[int, bytes]:
    """Returns (kind, payload); a closed connection reads as a hangup."""
    try:
        header = await reader.readexactly(3)
        kind, length = struct.unpack(">BH", header)
        payload = await reader.readexactly(length) if length else b""
    except (asyncio.IncompleteReadError, ConnectionError):
        return KIND_HANGUP, b""
    return kind, payload


def parse_uuid(payload: bytes) -> str:
    return str(uuid.UUID(bytes=payload))
