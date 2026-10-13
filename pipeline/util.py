"""Shared helpers: HTTP with retries, parquet cache, JSON export, geodesy."""
from __future__ import annotations

import json
import logging
import math
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import pandas as pd
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

log = logging.getLogger("surf")
if not log.handlers:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")

USER_AGENT = "serenity-surf/1.0 (+https://github.com/21stCheran/serenity-surf)"
EARTH_R_KM = 6371.0088


def session() -> requests.Session:
    s = requests.Session()
    retry = Retry(
        total=6,
        backoff_factor=2.0,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=("GET", "POST"),
        respect_retry_after_header=True,
    )
    s.mount("https://", HTTPAdapter(max_retries=retry))
    s.mount("http://", HTTPAdapter(max_retries=retry))
    s.headers["User-Agent"] = USER_AGENT
    return s


_SESSION: requests.Session | None = None


def http() -> requests.Session:
    global _SESSION
    if _SESSION is None:
        _SESSION = session()
    return _SESSION


def get_json(url: str, params: dict | None = None, timeout: int = 180) -> Any:
    r = http().get(url, params=params, timeout=timeout)
    if r.status_code >= 400:
        raise RuntimeError(f"HTTP {r.status_code} for {r.url}: {r.text[:300]}")
    return r.json()


def get_text(url: str, params: dict | None = None, timeout: int = 300, headers: dict | None = None) -> str:
    r = http().get(url, params=params, timeout=timeout, headers=headers)
    r.raise_for_status()
    return r.text


def get_bytes(url: str, params: dict | None = None, timeout: int = 300) -> bytes:
    r = http().get(url, params=params, timeout=timeout)
    r.raise_for_status()
    return r.content


# ---------------------------------------------------------------- cache

def ensure_dir(p: Path) -> Path:
    p.mkdir(parents=True, exist_ok=True)
    return p


def age_hours(p: Path) -> float:
    if not p.exists():
        return float("inf")
    return (time.time() - p.stat().st_mtime) / 3600.0


def save_parquet(df: pd.DataFrame, p: Path) -> None:
    ensure_dir(p.parent)
    tmp = p.with_suffix(".tmp.parquet")
    df.to_parquet(tmp)
    os.replace(tmp, p)


def load_parquet(p: Path) -> pd.DataFrame:
    return pd.read_parquet(p)


# ---------------------------------------------------------------- export

def _clean(o: Any) -> Any:
    if isinstance(o, float):
        if math.isnan(o) or math.isinf(o):
            return None
        return o
    if isinstance(o, (np.floating,)):
        v = float(o)
        return None if (math.isnan(v) or math.isinf(v)) else v
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, np.ndarray):
        return [_clean(x) for x in o.tolist()]
    if isinstance(o, dict):
        return {str(k): _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(x) for x in o]
    if isinstance(o, (pd.Timestamp, datetime)):
        return o.isoformat()
    return o


def write_json(obj: Any, p: Path) -> int:
    ensure_dir(p.parent)
    txt = json.dumps(_clean(obj), separators=(",", ":"), ensure_ascii=False)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(txt, encoding="utf-8")
    os.replace(tmp, p)
    return len(txt)


def rounded(values: Iterable, nd: int) -> list:
    """Round a numeric sequence for compact JSON; NaN becomes None."""
    out = []
    for v in values:
        if v is None:
            out.append(None)
            continue
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            out.append(None)
        elif nd == 0:
            out.append(int(round(f)))
        else:
            out.append(round(f, nd))
    return out


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------- geodesy

def haversine_km(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(np.radians, (lat1, lon1, lat2, lon2))
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = np.sin(dlat / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2) ** 2
    return 2 * EARTH_R_KM * np.arcsin(np.sqrt(a))


def bearing_deg(lat1, lon1, lat2, lon2):
    """Initial bearing from point 1 to point 2, degrees clockwise from north."""
    lat1, lon1, lat2, lon2 = map(np.radians, (lat1, lon1, lat2, lon2))
    y = np.sin(lon2 - lon1) * np.cos(lat2)
    x = np.cos(lat1) * np.sin(lat2) - np.sin(lat1) * np.cos(lat2) * np.cos(lon2 - lon1)
    return (np.degrees(np.arctan2(y, x)) + 360.0) % 360.0


def angdiff(a, b):
    """Smallest absolute difference between two directions in degrees (0..180)."""
    d = np.abs((np.asarray(a, dtype=float) - np.asarray(b, dtype=float) + 180.0) % 360.0 - 180.0)
    return d


def circmean_deg(deg, weights=None):
    r = np.radians(np.asarray(deg, dtype=float))
    w = np.ones_like(r) if weights is None else np.asarray(weights, dtype=float)
    s = np.nansum(w * np.sin(r))
    c = np.nansum(w * np.cos(r))
    return (math.degrees(math.atan2(s, c)) + 360.0) % 360.0
