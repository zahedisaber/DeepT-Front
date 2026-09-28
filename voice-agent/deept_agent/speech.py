"""Audio helpers and speech providers (speech-to-text, text-to-speech).

Phone audio here is always 8 kHz, 16-bit signed little-endian mono PCM, which
is what Asterisk AudioSocket sends and expects.
"""

import array
import io
import math
import os
import wave
from typing import Protocol

from .persian import to_speakable

PHONE_RATE = 8000
FRAME_BYTES = 320  # 20 ms at 8 kHz, 16-bit


def rms(pcm: bytes) -> float:
    samples = array.array("h", pcm[: len(pcm) - len(pcm) % 2])
    if not samples:
        return 0.0
    return math.sqrt(sum(s * s for s in samples) / len(samples))


def resample(pcm: bytes, src_rate: int, dst_rate: int) -> bytes:
    """Block-average for whole-number downsampling (24 kHz -> 8 kHz), linear
    interpolation otherwise. Good enough for speech on a phone line."""
    if src_rate == dst_rate:
        return pcm
    samples = array.array("h", pcm[: len(pcm) - len(pcm) % 2])
    if src_rate > dst_rate and src_rate % dst_rate == 0:
        width = src_rate // dst_rate
        n_out = len(samples) // width
        return array.array("h", (sum(samples[i * width:(i + 1) * width]) // width for i in range(n_out))).tobytes()
    n_out = int(len(samples) * dst_rate / src_rate)
    out = array.array("h", bytes(2 * n_out))
    step = src_rate / dst_rate
    last = len(samples) - 1
    for i in range(n_out):
        pos = i * step
        j = int(pos)
        frac = pos - j
        a = samples[min(j, last)]
        b = samples[min(j + 1, last)]
        out[i] = int(a + (b - a) * frac)
    return out.tobytes()


def to_wav(pcm: bytes, rate: int = PHONE_RATE) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


class SpeechToText(Protocol):
    async def transcribe(self, pcm: bytes) -> str: ...


class TextToSpeech(Protocol):
    async def synthesize(self, text: str) -> bytes: ...


class OpenAISpeechToText:
    def __init__(self, client, model: str | None = None):
        self.client = client
        self.model = model or os.environ.get("DEEPT_STT_MODEL", "gpt-4o-mini-transcribe")

    async def transcribe(self, pcm: bytes) -> str:
        result = await self.client.audio.transcriptions.create(
            model=self.model,
            file=("speech.wav", to_wav(pcm), "audio/wav"),
            language="fa",
            prompt="تماس تلفنی با دارالترجمه رسمی: شناسنامه، کارت ملی، ریزنمرات، کد رهگیری، ترجمه رسمی",
        )
        return result.text.strip()


class OpenAITextToSpeech:
    RATE = 24000  # OpenAI's raw "pcm" output

    def __init__(self, client, model: str | None = None, voice: str | None = None):
        self.client = client
        self.model = model or os.environ.get("DEEPT_TTS_MODEL", "gpt-4o-mini-tts")
        self.voice = voice or os.environ.get("DEEPT_TTS_VOICE", "coral")

    async def synthesize(self, text: str) -> bytes:
        response = await self.client.audio.speech.create(
            model=self.model,
            voice=self.voice,
            input=to_speakable(text),
            instructions="Speak Persian with a natural Tehrani accent, warm and polite, at a relaxed phone pace.",
            response_format="pcm",
        )
        return resample(response.content, self.RATE, PHONE_RATE)
