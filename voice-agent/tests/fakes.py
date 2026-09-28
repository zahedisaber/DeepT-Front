"""Stand-ins for Claude and the speech services, so tests run offline."""

from pathlib import Path
from types import SimpleNamespace

from deept_agent.catalog import Catalog
from deept_agent.office import Office
from deept_agent.services import JsonOrders, LogSms
from deept_agent.tools import CallContext

ROOT = Path(__file__).resolve().parents[1]
ALL_DAY = {day: ["00:00-23:59"] for day in ["saturday", "sunday", "monday", "tuesday", "wednesday", "thursday", "friday"]}


def make_office(**overrides) -> Office:
    data = {
        "id": "test",
        "name": "دارالترجمه تست",
        "phone_numbers": ["5000"],
        "address": "تهران، خیابان آزمایش",
        "greeting": "سلام، بفرمایید.",
        "hours": ALL_DAY,
        "human_extension": "101",
        "staff_mobile": "09120000000",
        "upload_url": "https://deept.ir/upload/test",
        "optional_fee_ids": ["224"],
        "required_documents": {"کارت ملی": "اصل کارت ملی، پشت و رو."},
    }
    data.update(overrides)
    return Office.from_dict(data)


def make_ctx(caller: str | None = "09121234567", **office_overrides) -> CallContext:
    orders = JsonOrders(ROOT / "offices" / "orders.json")
    office = make_office(**office_overrides)
    office.id = "sample"  # read the sample orders
    return CallContext(office=office, catalog=Catalog.load(), orders=orders, sms=LogSms(), caller=caller)


def text(t: str):
    return SimpleNamespace(type="text", text=t)


def tool_use(name: str, args: dict, id: str = "toolu_1"):
    return SimpleNamespace(type="tool_use", id=id, name=name, input=args)


def response(*content, stop_reason: str | None = None):
    if stop_reason is None:
        stop_reason = "tool_use" if any(b.type == "tool_use" for b in content) else "end_turn"
    return SimpleNamespace(content=list(content), stop_reason=stop_reason)


class FakeStream:
    def __init__(self, resp):
        self.resp = resp

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def __aiter__(self):
        for block in self.resp.content:
            if block.type == "text":
                # Stream in small pieces, like real text deltas.
                for i in range(0, len(block.text), 7):
                    yield SimpleNamespace(type="text", text=block.text[i:i + 7])

    async def get_final_message(self):
        return self.resp


class FakeClaude:
    """Returns scripted responses in order; records each request."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.requests: list[dict] = []
        self.messages = self

    def stream(self, **kwargs):
        self.requests.append({**kwargs, "messages": list(kwargs["messages"])})
        return FakeStream(self.responses.pop(0))


class FakeSTT:
    def __init__(self, *texts):
        self.texts = list(texts)
        self.calls = 0

    async def transcribe(self, pcm: bytes) -> str:
        self.calls += 1
        return self.texts.pop(0) if self.texts else ""


class FakeTTS:
    """0.1 s of silence per sentence."""

    def __init__(self):
        self.spoken: list[str] = []

    async def synthesize(self, text: str) -> bytes:
        self.spoken.append(text)
        return b"\0" * 1600
