"""Spot constants, shared with the web app through web/src/core/spot.json."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPOT_FILE = ROOT / "web" / "src" / "core" / "spot.json"
SPOT: dict = json.loads(SPOT_FILE.read_text(encoding="utf-8"))

LAT: float = SPOT["lat"]
LON: float = SPOT["lon"]
BEACH_NORMAL: float = SPOT["beachNormal"]
OFFSHORE_FROM: float = SPOT["offshoreFrom"]
WAVE_POINT = (SPOT["wavePoint"]["lat"], SPOT["wavePoint"]["lon"])
WIND_POINT = (SPOT["windPoint"]["lat"], SPOT["windPoint"]["lon"])
TZ: str = SPOT["timezone"]
UTC_OFFSET_HOURS: float = SPOT["utcOffsetMinutes"] / 60.0
HISTORY_START: str = SPOT["historyStart"]
LONG_HISTORY_START: str = SPOT["longHistoryStart"]

CACHE = ROOT / "pipeline" / "cache"
RAW = CACHE / "raw"
OUT = ROOT / "web" / "public" / "data"
