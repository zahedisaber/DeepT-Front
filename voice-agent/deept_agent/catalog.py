"""Official tariff lookup, read straight from the frontend's price-catalog.js.

The frontend file is the single source of truth for tariff prices; this module
parses it rather than keeping a second copy that could drift.
"""

import json
import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path

from .persian import normalize

DEFAULT_CATALOG_PATH = Path(__file__).resolve().parents[2] / "price-catalog.js"

# What callers say -> the tariff sheet's wording.
SYNONYMS = {
    "پاسپورت": "گذرنامه",
    "کارت سربازی": "کارت پایان خدمت",
    "سوپیشینه": "سوءپیشینه",
    "عدم سو پیشینه": "عدم سوءپیشینه",
    "عقدنامه": "سند ازدواج",
    "قباله ازدواج": "سند ازدواج",
    "مدرک دیپلم": "دیپلم",
    "لیسانس": "دانشنامه",
    "فوق لیسانس": "دانشنامه",
    "ریزنمره": "ریزنمرات",
}
_SYNONYM_RE = re.compile(
    r"(?<!\S)(" + "|".join(re.escape(normalize(k)) for k in sorted(SYNONYMS, key=len, reverse=True)) + r")(?!\S)"
)
_SYNONYM_MAP = {normalize(k): normalize(v) for k, v in SYNONYMS.items()}


@dataclass(frozen=True)
class CatalogItem:
    id: str
    label: str
    category: str
    base: int
    extra: int | None = None
    unit: str | None = None  # what `extra` is charged per, e.g. "هر سطر"
    base_unit: str | None = None  # set when `base` is per page/term/year
    addition: bool = False  # add-on to its parent row, never sold alone
    pinned: bool = False  # office service fee (courier, stamps...), not a document


def parse_catalog_js(source: str) -> list[CatalogItem]:
    start = source.index("const PRICE_CATALOG = [") + len("const PRICE_CATALOG = ")
    end = source.index("\n];", start) + 2
    body = source[start:end]
    body = "\n".join(line for line in body.splitlines() if not line.lstrip().startswith("//"))
    body = re.sub(r"([{,]\s*)([A-Za-z_]\w*)\s*:", r'\1"\2":', body)  # quote keys
    body = re.sub(r",(\s*[\]}])", r"\1", body)  # trailing commas
    items = []
    for group in json.loads(body):
        for raw in group["items"]:
            items.append(CatalogItem(
                id=raw["id"],
                label=raw["label"],
                category=group["category"],
                base=raw["base"],
                extra=raw.get("extra"),
                unit=raw.get("unit"),
                base_unit=raw.get("baseUnit"),
                addition=bool(raw.get("addition")),
                pinned=bool(group.get("pinned")),
            ))
    return items


class Catalog:
    def __init__(self, items: list[CatalogItem]):
        self.items = items
        self.by_id = {item.id: item for item in items}
        self._norm = {item.id: normalize(re.sub(r"\(هر (صفحه|ترم|سال)\)", "", item.label)) for item in items}

    @classmethod
    def load(cls, path: Path = DEFAULT_CATALOG_PATH) -> "Catalog":
        return cls(parse_catalog_js(Path(path).read_text(encoding="utf-8")))

    @staticmethod
    def canonical(query: str) -> str:
        """Normalized query with caller wording mapped to the tariff's (پاسپورت -> گذرنامه)."""
        return _SYNONYM_RE.sub(lambda m: _SYNONYM_MAP[m.group(1)], normalize(query))

    def contains(self, item: CatalogItem, query: str) -> bool:
        """Whether the item's name contains everything the caller said, ignoring spacing."""
        return self.canonical(query).replace(" ", "") in self._norm[item.id].replace(" ", "")

    def search(self, query: str, limit: int = 5, include_fees: bool = False) -> list[tuple[CatalogItem, float]]:
        """Fuzzy match a caller's wording ("شناسنامه", "ریز نمرات دانشگاه") to tariff rows."""
        q = self.canonical(query)
        if not q:
            return []
        q_tokens = set(q.split())
        q_compact = q.replace(" ", "")
        scored = []
        for item in self.items:
            if item.pinned and not include_fees:
                continue
            label = self._norm[item.id]
            tokens = set(label.split())
            overlap = len(q_tokens & tokens) / len(q_tokens)
            ratio = SequenceMatcher(None, q, label).ratio()
            score = 0.6 * overlap + 0.4 * ratio
            # Spacing varies ("ریز نمرات" / "ریزنمرات"), so compare without spaces too.
            if q_compact in label.replace(" ", ""):
                score += 0.3
            if label == q:
                score += 0.5
            scored.append((item, round(score, 3)))
        scored.sort(key=lambda pair: pair[1], reverse=True)
        return [pair for pair in scored[:limit] if pair[1] >= 0.35]
