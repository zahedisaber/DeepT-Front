"""Per-office settings: each office has its own numbers, hours, prices and FAQ.

One agent server serves many offices; the dialed number picks the office.
"""

from dataclasses import dataclass, field
from datetime import datetime, time
from pathlib import Path
from zoneinfo import ZoneInfo

import yaml

from .catalog import CatalogItem

TEHRAN = ZoneInfo("Asia/Tehran")
WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
WEEKDAYS_FA = {
    "saturday": "شنبه", "sunday": "یکشنبه", "monday": "دوشنبه", "tuesday": "سه‌شنبه",
    "wednesday": "چهارشنبه", "thursday": "پنجشنبه", "friday": "جمعه",
}


@dataclass
class Office:
    id: str
    name: str
    phone_numbers: list[str]
    address: str
    greeting: str
    hours: dict[str, list[str]]  # "saturday": ["09:00-13:00", "16:00-19:00"]
    human_extension: str | None = None
    staff_mobile: str | None = None  # gets messages the agent takes
    map_url: str | None = None
    upload_url: str | None = None
    turnaround: str = ""
    notes: list[str] = field(default_factory=list)
    required_documents: dict[str, str] = field(default_factory=dict)
    price_overrides: dict[str, dict[str, int]] = field(default_factory=dict)
    optional_fee_ids: list[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: dict) -> "Office":
        known = cls.__dataclass_fields__.keys()
        unknown = set(data) - set(known)
        if unknown:
            raise ValueError(f"office {data.get('id')}: unknown keys {sorted(unknown)}")
        data = dict(data)
        data["phone_numbers"] = [str(n) for n in data.get("phone_numbers", [])]
        data["price_overrides"] = {str(k): v for k, v in (data.get("price_overrides") or {}).items()}
        data["optional_fee_ids"] = [str(i) for i in data.get("optional_fee_ids", [])]
        return cls(**data)

    def price_of(self, item: CatalogItem) -> tuple[int, int | None]:
        """(base, extra) after this office's own overrides from نرخنامه من."""
        override = self.price_overrides.get(item.id, {})
        return override.get("base", item.base), override.get("extra", item.extra)

    def is_open(self, now: datetime | None = None) -> bool:
        now = (now or datetime.now(TEHRAN)).astimezone(TEHRAN)
        for span in self.hours.get(WEEKDAYS[now.weekday()], []):
            start, end = (time.fromisoformat(t) for t in span.split("-"))
            if start <= now.time() < end:
                return True
        return False

    def hours_text(self) -> str:
        lines = []
        for day in ["saturday", "sunday", "monday", "tuesday", "wednesday", "thursday", "friday"]:
            spans = self.hours.get(day, [])
            lines.append(f"{WEEKDAYS_FA[day]}: {'، '.join(spans) if spans else 'تعطیل'}")
        return "\n".join(lines)


class OfficeDirectory:
    def __init__(self, offices: list[Office]):
        self.by_id = {o.id: o for o in offices}
        self.by_number = {n: o for o in offices for n in o.phone_numbers}

    @classmethod
    def load(cls, directory: Path) -> "OfficeDirectory":
        offices = []
        for path in sorted(Path(directory).glob("*.yaml")):
            offices.append(Office.from_dict(yaml.safe_load(path.read_text(encoding="utf-8"))))
        return cls(offices)

    def find(self, dialed: str | None = None, office_id: str | None = None) -> Office | None:
        if office_id and office_id in self.by_id:
            return self.by_id[office_id]
        if dialed and dialed in self.by_number:
            return self.by_number[dialed]
        return None
