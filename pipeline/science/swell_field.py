"""Bay of Bengal swell field: wave height/direction/period on a coarse grid, for the
animated map (15-day forecast) and for replays of notable cyclones (ERA5)."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import numpy as np

from ..fetch import openmeteo as om
from ..util import log
from . import geo

STEP = 1.5
LAT_RANGE = (0.0, 22.0)
LON_RANGE = (76.0, 100.0)


def grid(step: float = STEP):
    lats = np.arange(LAT_RANGE[0], LAT_RANGE[1] + 0.01, step)
    lons = np.arange(LON_RANGE[0], LON_RANGE[1] + 0.01, step)
    pts = [(float(la), float(lo)) for la in lats for lo in lons if not geo.on_land(float(la), float(lo))]
    return pts


def _pack(blocks, pts, var_map) -> dict:
    times = blocks[0]["hourly"]["time"]
    out = {"t0": int(times[0]), "dt": int(times[1] - times[0]) if len(times) > 1 else 10800, "n": len(times),
           "lat": [p[0] for p in pts], "lon": [p[1] for p in pts]}
    for key, (src, scale) in var_map.items():
        arr = []
        for b in blocks:
            v = b["hourly"].get(src) or []
            arr.append([None if x is None else int(round(x * scale)) for x in v])
        out[key] = arr
    return out


def forecast(step: float = STEP) -> dict:
    pts = grid(step)
    log.info("swell field: %d sea points", len(pts))
    blocks = om.fetch_points(
        om.MARINE(), [p[0] for p in pts], [p[1] for p in pts],
        ["wave_height", "wave_direction", "wave_peak_period"],
        {"models": "ecmwf_wam025", "forecast_days": 15, "temporal_resolution": "hourly_3", "cell_selection": "sea"},
        batch=60,
    )
    d = _pack(blocks, pts, {"hs": ("wave_height", 10), "dir": ("wave_direction", 1), "tp": ("wave_peak_period", 1)})
    d.update({"model": "ECMWF WAM 0.25°", "issued": datetime.now(timezone.utc).isoformat(), "scale": {"hs": 0.1}})
    return d


def replay(start: date, end: date, step: float = 2.5) -> dict:
    pts = grid(step)
    blocks = om.fetch_points(
        om.MARINE(), [p[0] for p in pts], [p[1] for p in pts],
        ["wave_height", "wave_direction", "wave_peak_period"],
        {"models": "era5_ocean", "start_date": start.isoformat(), "end_date": end.isoformat(), "cell_selection": "sea"},
        batch=60,
    )
    # thin hourly ERA5 to 3-hourly
    for b in blocks:
        h = b["hourly"]
        for k in list(h.keys()):
            h[k] = h[k][::3]
    d = _pack(blocks, pts, {"hs": ("wave_height", 10), "dir": ("wave_direction", 1), "tp": ("wave_peak_period", 1)})
    d.update({"model": "ERA5 (0.5°)", "scale": {"hs": 0.1}})
    return d


REPLAYS = ["THANE", "NILAM", "MADI", "VARDAH", "GAJA", "NIVAR", "MANDOUS", "MICHAUNG", "FENGAL", "DITWAH"]


def replay_windows(storms: list[dict]) -> list[tuple[str, str, date, date]]:
    out = []
    for s in storms:
        if s["name"].upper() in REPLAYS:
            t0 = datetime.fromtimestamp(s["start"], tz=timezone.utc).date() - timedelta(days=1)
            t1 = datetime.fromtimestamp(s["end"], tz=timezone.utc).date() + timedelta(days=2)
            out.append((s["id"], s["name"], t0, t1))
    return out
