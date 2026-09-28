"""One live phone call over AudioSocket: listen, transcribe, think, speak.

Three things run at once during a call:
  - the reader: caller audio -> voice activity detection -> utterances
  - the responder: utterance -> speech-to-text -> Claude -> text-to-speech
  - the player: sends queued speech to Asterisk in real time (20 ms frames)
When the caller starts talking over the agent, playback and the pending reply
are cut off (barge-in), like a person would stop mid-sentence.
"""

import asyncio
import logging
from collections import deque

from ..brain import Brain, Say, ToolStarted
from ..speech import FRAME_BYTES, SpeechToText, TextToSpeech, rms
from ..tools import CallContext
from .audiosocket import KIND_AUDIO, KIND_DTMF, KIND_ERROR, KIND_HANGUP, pack, read_frame

log = logging.getLogger(__name__)

FRAME_SECONDS = 0.02


class EnergyVAD:
    """Energy-based voice activity detection with an adaptive noise floor.

    Crude next to a model-based detector (e.g. Silero), but dependency-free and
    fine for a prototype on a clean line. Thresholds are RMS of 16-bit samples.
    """

    def __init__(self, min_threshold: float = 500, start_frames: int = 4, end_silence_frames: int = 35,
                 max_frames: int = 1000, preroll_frames: int = 10):
        self.min_threshold = min_threshold
        self.start_frames = start_frames  # 80 ms of speech starts an utterance
        self.end_silence_frames = end_silence_frames  # 700 ms of silence ends it
        self.max_frames = max_frames  # 20 s cap
        self.noise_floor = 200.0
        self.in_speech = False
        self.loud_run = 0
        self.quiet_run = 0
        self.frames: list[bytes] = []
        self.preroll: deque[bytes] = deque(maxlen=preroll_frames)

    def feed(self, frame: bytes) -> tuple[str, bytes] | None:
        """Returns ("start", b"") when speech begins, ("end", pcm) when an utterance ends."""
        level = rms(frame)
        loud = level > max(self.min_threshold, self.noise_floor * 3)
        if not self.in_speech:
            self.noise_floor = 0.95 * self.noise_floor + 0.05 * level if not loud else self.noise_floor
            self.preroll.append(frame)
            self.loud_run = self.loud_run + 1 if loud else 0
            if self.loud_run >= self.start_frames:
                self.in_speech = True
                self.frames = list(self.preroll)
                self.quiet_run = 0
                return ("start", b"")
            return None
        self.frames.append(frame)
        self.quiet_run = 0 if loud else self.quiet_run + 1
        if self.quiet_run >= self.end_silence_frames or len(self.frames) >= self.max_frames:
            pcm = b"".join(self.frames)
            self.in_speech = False
            self.loud_run = 0
            self.frames = []
            self.preroll.clear()
            return ("end", pcm)
        return None


class CallSession:
    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter, ctx: CallContext,
                 brain: Brain, stt: SpeechToText, tts: TextToSpeech, greeting: bytes, filler: bytes,
                 goodbye: bytes = b"", idle_seconds: float = 25, max_call_seconds: float = 600, vad: EnergyVAD | None = None):
        self.reader, self.writer = reader, writer
        self.ctx, self.brain, self.stt, self.tts = ctx, brain, stt, tts
        self.greeting, self.filler, self.goodbye = greeting, filler, goodbye
        self.idle_seconds, self.max_call_seconds = idle_seconds, max_call_seconds
        self.vad = vad or EnergyVAD()
        self.queue: asyncio.Queue[bytes] = asyncio.Queue()
        self.playing = False
        self.generation = 0  # bumped on barge-in; the player drops audio from older generations
        self.idle = asyncio.Event()
        self.idle.set()
        self.responder: asyncio.Task | None = None
        self.dtmf = ""
        self.closed = False
        self.transcript: list[tuple[str, str]] = []

    # --- playback -------------------------------------------------------

    def speak(self, pcm: bytes) -> None:
        if pcm:
            self.idle.clear()
            self.queue.put_nowait(pcm)

    @property
    def speaking(self) -> bool:
        return self.playing or not self.queue.empty()

    def stop_speaking(self) -> None:
        self.generation += 1
        while not self.queue.empty():
            self.queue.get_nowait()
        if not self.playing:
            self.idle.set()

    async def _player(self) -> None:
        loop = asyncio.get_running_loop()
        while True:
            pcm = await self.queue.get()
            generation = self.generation
            self.playing = True
            next_at = loop.time()
            for i in range(0, len(pcm), FRAME_BYTES):
                if generation != self.generation or self.closed:
                    break
                frame = pcm[i:i + FRAME_BYTES].ljust(FRAME_BYTES, b"\0")
                self.writer.write(pack(KIND_AUDIO, frame))
                await self.writer.drain()
                next_at += FRAME_SECONDS
                await asyncio.sleep(max(0.0, next_at - loop.time()))
            self.playing = False
            if self.queue.empty():
                self.idle.set()

    # --- responding -----------------------------------------------------

    def _start_reply(self, pcm: bytes = b"", text: str = "") -> None:
        if self.responder and not self.responder.done():
            self.responder.cancel()
        self.responder = asyncio.create_task(self._reply(pcm, text))

    async def _reply(self, pcm: bytes, text: str) -> None:
        if pcm:
            text = await self.stt.transcribe(pcm)
        if not text:
            return
        log.info("caller: %s", text)
        self.transcript.append(("caller", text))
        said_something = False
        async for event in self.brain.reply(text):
            if isinstance(event, Say):
                log.info("agent: %s", event.text)
                self.transcript.append(("agent", event.text))
                self.speak(await self.tts.synthesize(event.text))
                said_something = True
            elif isinstance(event, ToolStarted) and not said_something:
                self.speak(self.filler)  # cover the tool call's silence
                said_something = True
        if self.ctx.state.transfer_to or self.ctx.state.end_call:
            await self.idle.wait()
            await self.hang_up()

    # --- call loop ------------------------------------------------------

    async def hang_up(self) -> None:
        if self.closed:
            return
        self.closed = True
        try:
            self.writer.write(pack(KIND_HANGUP))
            await self.writer.drain()
        except ConnectionError:
            pass
        self.writer.close()  # also ends run(): the reader sees EOF

    async def run(self) -> None:
        loop = asyncio.get_running_loop()
        player = asyncio.create_task(self._player())
        started = last_activity = loop.time()
        self.speak(self.greeting)
        said_goodbye = False
        try:
            while not self.closed:
                kind, payload = await read_frame(self.reader)
                if kind in (KIND_HANGUP, KIND_ERROR):
                    break
                now = loop.time()
                busy = self.speaking or (self.responder and not self.responder.done())
                if busy:
                    last_activity = now
                if kind == KIND_DTMF:
                    self._on_dtmf(payload.decode(errors="ignore"))
                    last_activity = now
                elif kind == KIND_AUDIO:
                    result = self.vad.feed(payload)
                    if result and result[0] == "start":
                        last_activity = now
                        if busy:
                            # The caller talks over the agent: stop speaking and drop the
                            # pending reply; their next utterance is answered together with it.
                            log.info("barge-in")
                            self.stop_speaking()
                            if self.responder and not self.responder.done():
                                self.responder.cancel()
                    elif result and result[0] == "end":
                        last_activity = now
                        self._start_reply(pcm=result[1])
                    elif self.vad.in_speech:
                        last_activity = now
                if said_goodbye:
                    if not self.speaking:
                        await self.hang_up()
                elif now - started > self.max_call_seconds or (not busy and now - last_activity > self.idle_seconds):
                    if self.responder and not self.responder.done():
                        self.responder.cancel()
                    self.stop_speaking()
                    self.speak(self.goodbye)
                    said_goodbye = True
        finally:
            self.closed = True
            if self.responder and not self.responder.done():
                self.responder.cancel()
            player.cancel()
            await asyncio.gather(player, *([self.responder] if self.responder else []), return_exceptions=True)
            self.writer.close()

    def _on_dtmf(self, digit: str) -> None:
        """Keypad entry, for codes that speech recognition gets wrong: digits then #."""
        if digit == "#":
            if self.dtmf:
                code, self.dtmf = self.dtmf, ""
                self.stop_speaking()
                self._start_reply(text=f"(با صفحه‌کلید تلفن وارد کردم: {code})")
        elif digit == "*":
            self.dtmf = ""
        elif digit.isdigit():
            self.dtmf += digit
