"""Compact JSON products for the web app.

Hourly history uses integer-scaled columns (value = int / scale) to keep files
small; the web decoder lives in web/src/data/static.ts."""
from __future__ import annotations

import shutil
from pathlib import Path

import numpy as np
import pandas as pd

from .spot import CACHE, OUT
from .util import ensure_dir, write_json

PRODUCTS = CACHE / "products"

# field -> scale (stored as round(value * scale))
HOURLY_FIELDS = {
    "hs": 100, "tp": 10, "dir": 1,
    "sw1h": 100, "sw1p": 10, "sw1d": 1,
    "sw2h": 100, "sw2p": 10, "sw2d": 1,
    "wwh": 100, "wwp": 10, "wwd": 1,
    "ws": 10, "wd": 1, "wg": 10,
    "pr": 10, "msl": 10, "t2": 10, "cc": 1, "wc": 1,
    "sst": 10, "sl": 100, "tide": 100,
}


def _col(s: pd.Series, scale: int) -> list:
    v = s.to_numpy(dtype=float) * scale
    return [None if np.isnan(x) else int(round(x)) for x in v]


def history_years(dec: pd.DataFrame) -> list[dict]:
    files = []
    dest = ensure_dir(PRODUCTS / "history")
    full = pd.date_range(dec.index.min().floor("D"), dec.index.max(), freq="h", tz="UTC")
    dec = dec.reindex(full)
    for year, g in dec.groupby(dec.index.year):
        doc = {
            "year": int(year),
            "t0": int(g.index[0].timestamp()),
            "dt": 3600,
            "n": int(len(g)),
            "scale": HOURLY_FIELDS,
            "cols": {k: _col(g[k], sc) for k, sc in HOURLY_FIELDS.items() if k in g.columns and g[k].notna().any()},
        }
        size = write_json(doc, dest / f"hourly-{year}.json")
        files.append({"year": int(year), "file": f"history/hourly-{year}.json", "hours": int(len(g)), "bytes": size})
    return files


def product(name: str) -> Path:
    return PRODUCTS / name


def publish() -> list[str]:
    """Copy every product into web/public/data."""
    ensure_dir(OUT)
    copied = []
    for p in PRODUCTS.rglob("*.json"):
        rel = p.relative_to(PRODUCTS)
        dst = OUT / rel
        ensure_dir(dst.parent)
        shutil.copy2(p, dst)
        copied.append(str(rel).replace("\\", "/"))
    return sorted(copied)
