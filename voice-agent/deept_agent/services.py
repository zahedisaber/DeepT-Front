"""Outside services the tools call: order lookup and SMS.

Both are interfaces with a local implementation for the prototype, so the
agent runs end to end before DeepT-Core or an SMS provider is wired in.
"""

import asyncio
import json
import logging
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Protocol

from .persian import to_ascii_digits

log = logging.getLogger(__name__)


def normalize_phone(number: str | None) -> str | None:
    """'+98 912 123 4567' / '00989121234567' / '9121234567' -> '09121234567'."""
    if not number:
        return None
    digits = "".join(c for c in to_ascii_digits(number) if c.isdigit())
    if digits.startswith("0098"):
        digits = "0" + digits[4:]
    elif digits.startswith("98") and len(digits) == 12:
        digits = "0" + digits[2:]
    elif len(digits) == 10 and digits.startswith("9"):
        digits = "0" + digits
    return digits or None


def is_mobile(number: str | None) -> bool:
    n = normalize_phone(number)
    return bool(n) and len(n) == 11 and n.startswith("09")


class Orders(Protocol):
    async def find(self, office_id: str, tracking_code: str | None = None, phone: str | None = None) -> list[dict]: ...


class JsonOrders:
    """Orders from a JSON file: {"office_id": [{"tracking_code", "phone", "title", "status", "ready_date"}]}.

    Stand-in until DeepT-Core exposes an order lookup for the agent.
    """

    def __init__(self, path: Path):
        self.path = Path(path)

    async def find(self, office_id: str, tracking_code: str | None = None, phone: str | None = None) -> list[dict]:
        data = json.loads(self.path.read_text(encoding="utf-8")) if self.path.exists() else {}
        orders = data.get(office_id, [])
        if tracking_code:
            code = to_ascii_digits(tracking_code).strip()
            return [o for o in orders if str(o.get("tracking_code")) == code]
        if phone:
            return [o for o in orders if normalize_phone(o.get("phone")) == normalize_phone(phone)]
        return []


class Sms(Protocol):
    async def send(self, to: str, text: str) -> None: ...


class LogSms:
    """Prints instead of sending; keeps what was sent for tests and the console."""

    def __init__(self):
        self.sent: list[tuple[str, str]] = []

    async def send(self, to: str, text: str) -> None:
        self.sent.append((to, text))
        log.info("SMS to %s: %s", to, text)


class KavenegarSms:
    """Kavenegar (kavenegar.com) SMS API. Not yet tested against a live account."""

    def __init__(self, api_key: str, sender: str):
        self.url = f"https://api.kavenegar.com/v1/{api_key}/sms/send.json"
        self.sender = sender

    async def send(self, to: str, text: str) -> None:
        data = urllib.parse.urlencode({"receptor": to, "sender": self.sender, "message": text}).encode()

        def post() -> None:
            with urllib.request.urlopen(urllib.request.Request(self.url, data=data), timeout=10):
                pass  # urlopen raises on HTTP errors

        await asyncio.to_thread(post)
