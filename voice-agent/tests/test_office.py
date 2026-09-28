from datetime import datetime
from pathlib import Path

import pytest

from deept_agent.office import TEHRAN, Office, OfficeDirectory

from .fakes import make_office

ROOT = Path(__file__).resolve().parents[1]


def test_sample_office_loads_and_is_found_by_number():
    directory = OfficeDirectory.load(ROOT / "offices")
    office = directory.find(dialed="02188001234")
    assert office is not None and office.id == "sample"
    assert directory.find(dialed="000") is None


def test_opening_hours_in_tehran_time():
    office = make_office(hours={"saturday": ["09:00-17:00"], "thursday": ["09:00-13:00"]})
    # 2026-09-26 is a Saturday.
    assert office.is_open(datetime(2026, 9, 26, 10, 0, tzinfo=TEHRAN))
    assert not office.is_open(datetime(2026, 9, 26, 17, 0, tzinfo=TEHRAN))
    assert not office.is_open(datetime(2026, 9, 25, 10, 0, tzinfo=TEHRAN))  # Friday
    assert "جمعه: تعطیل" in office.hours_text()


def test_price_overrides():
    from deept_agent.catalog import Catalog

    item = Catalog.load().by_id["9"]
    office = make_office(price_overrides={"9": {"base": 200000}})
    assert office.price_of(item) == (200000, None)


def test_unknown_keys_are_rejected():
    with pytest.raises(ValueError):
        Office.from_dict({"id": "x", "nmae": "typo"})
