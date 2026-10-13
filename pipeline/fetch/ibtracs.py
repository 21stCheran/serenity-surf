"""IBTrACS v04r01 North Indian Ocean best tracks (NOAA NCEI)."""
from __future__ import annotations

import io

import numpy as np
import pandas as pd

from ..spot import RAW
from ..util import age_hours, ensure_dir, get_bytes, http, load_parquet, log, save_parquet

BASE = "https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv"
COLS = [
    "SID", "SEASON", "NUMBER", "BASIN", "SUBBASIN", "NAME", "ISO_TIME", "NATURE", "LAT", "LON",
    "WMO_WIND", "WMO_PRES", "TRACK_TYPE", "DIST2LAND", "LANDFALL", "USA_WIND", "USA_PRES",
    "USA_R34_NE", "USA_R34_SE", "USA_R34_SW", "USA_R34_NW", "USA_RMW", "USA_SSHS",
    "NEWDELHI_WIND", "NEWDELHI_PRES", "NEWDELHI_GRADE", "STORM_SPEED", "STORM_DIR",
]
NUM = [c for c in COLS if c not in ("SID", "BASIN", "SUBBASIN", "NAME", "ISO_TIME", "NATURE", "TRACK_TYPE", "NEWDELHI_GRADE")]


def _remote_stamp(url: str) -> str:
    try:
        r = http().head(url, timeout=60)
        return r.headers.get("Last-Modified", "") + "|" + r.headers.get("Content-Length", "")
    except Exception:  # pragma: no cover - network hiccup
        return ""


def load(min_season: int = 1980, max_age_hours: float = 20.0) -> pd.DataFrame:
    url = f"{BASE}/ibtracs.NI.list.v04r01.csv"
    p = RAW / "ibtracs" / "ni.parquet"
    stamp_p = RAW / "ibtracs" / "ni.stamp"
    if p.exists() and age_hours(p) < max_age_hours:
        return load_parquet(p)
    stamp = _remote_stamp(url)
    if p.exists() and stamp and stamp_p.exists() and stamp_p.read_text() == stamp:
        p.touch()
        return load_parquet(p)
    log.info("downloading IBTrACS NI (%s)", stamp or "?")
    raw = get_bytes(url, timeout=600)
    df = pd.read_csv(io.BytesIO(raw), usecols=COLS, skiprows=[1], keep_default_na=False, na_values=[" ", ""], low_memory=False)
    for c in NUM:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df["time"] = pd.to_datetime(df["ISO_TIME"], utc=True)
    df = df[(df["SEASON"] >= min_season) & (~df["TRACK_TYPE"].astype(str).str.startswith("spur"))]
    df = df.drop(columns=["ISO_TIME"]).sort_values(["SID", "time"]).reset_index(drop=True)
    save_parquet(df, p)
    ensure_dir(stamp_p.parent)
    stamp_p.write_text(stamp)
    return df


def best_wind_kt(df: pd.DataFrame) -> pd.Series:
    """1-minute sustained wind (kt). JTWC (USA) first; New Delhi 3-min winds scaled by 1.1."""
    usa = df["USA_WIND"]
    nd = df["NEWDELHI_WIND"].fillna(df["WMO_WIND"]) * 1.1
    return usa.where(usa.notna() & (usa > 0), nd)


def best_pres(df: pd.DataFrame) -> pd.Series:
    return df["USA_PRES"].where(df["USA_PRES"].notna() & (df["USA_PRES"] > 0), df["NEWDELHI_PRES"].fillna(df["WMO_PRES"]))


def r34_km(df: pd.DataFrame) -> pd.Series:
    q = df[["USA_R34_NE", "USA_R34_SE", "USA_R34_SW", "USA_R34_NW"]].where(lambda x: x > 0)
    return q.mean(axis=1) * 1.852


IMD_GRADES = [
    (17, "D", "Depression"),
    (28, "DD", "Deep Depression"),
    (34, "CS", "Cyclonic Storm"),
    (48, "SCS", "Severe Cyclonic Storm"),
    (64, "VSCS", "Very Severe Cyclonic Storm"),
    (90, "ESCS", "Extremely Severe Cyclonic Storm"),
    (120, "SuCS", "Super Cyclonic Storm"),
]


def imd_grade(wind_kt_3min: float) -> str:
    """IMD category from a 3-minute sustained wind in knots."""
    if wind_kt_3min is None or np.isnan(wind_kt_3min):
        return ""
    g = "LOW"
    for thr, code, _ in IMD_GRADES:
        if wind_kt_3min >= thr:
            g = code
    return g
