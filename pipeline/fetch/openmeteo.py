"""Open-Meteo clients (marine, archive, forecast, ensemble) with per-year parquet caching.

Free tier is for non-commercial use. Set OPEN_METEO_API_KEY to use the commercial
`customer-` endpoints instead.
"""
from __future__ import annotations

import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from ..spot import RAW
from ..util import age_hours, get_json, load_parquet, log, save_parquet

API_KEY = os.environ.get("OPEN_METEO_API_KEY", "").strip()


def _host(sub: str) -> str:
    # sub is e.g. "marine-api", "archive-api", "api", "ensemble-api"
    if API_KEY:
        return f"https://customer-{sub}.open-meteo.com"
    return f"https://{sub}.open-meteo.com"


MARINE = lambda: _host("marine-api") + "/v1/marine"  # noqa: E731
ARCHIVE = lambda: _host("archive-api") + "/v1/archive"  # noqa: E731
FORECAST = lambda: _host("api") + "/v1/forecast"  # noqa: E731
ENSEMBLE = lambda: _host("ensemble-api") + "/v1/ensemble"  # noqa: E731


def _with_key(params: dict) -> dict:
    if API_KEY:
        params = dict(params, apikey=API_KEY)
    return params


def _to_frame(block: dict) -> pd.DataFrame:
    t = pd.to_datetime(np.asarray(block["time"], dtype="int64"), unit="s", utc=True)
    cols = {k: pd.to_numeric(pd.Series(v), errors="coerce").to_numpy(dtype=float) for k, v in block.items() if k != "time"}
    df = pd.DataFrame(cols, index=t)
    df.index.name = "time"
    return df


def fetch_hourly(
    url: str,
    lat: float,
    lon: float,
    start: date,
    end: date,
    variables: list[str],
    model: str | None = None,
    extra: dict | None = None,
) -> pd.DataFrame:
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "hourly": ",".join(variables),
        "timeformat": "unixtime",
        "timezone": "GMT",
        "cell_selection": "sea",
        "wind_speed_unit": "kn",
    }
    if model:
        params["models"] = model
    if extra:
        params.update(extra)
    d = get_json(url, _with_key(params))
    df = _to_frame(d["hourly"])
    df.attrs["grid"] = (d.get("latitude"), d.get("longitude"))
    return df


def fetch_years(
    name: str,
    url: str,
    lat: float,
    lon: float,
    start: date,
    end: date,
    variables: list[str],
    model: str | None = None,
    refresh_current_hours: float = 20.0,
    extra: dict | None = None,
) -> pd.DataFrame:
    """Fetch [start, end] in calendar-year chunks cached as RAW/name/YYYY.parquet.

    Past years are fetched once. The current year (and any year touching `end`)
    is refreshed when its cache is older than `refresh_current_hours`.
    """
    frames = []
    this_year = datetime.now(timezone.utc).year
    for y in range(start.year, end.year + 1):
        s = max(start, date(y, 1, 1))
        e = min(end, date(y, 12, 31))
        p: Path = RAW / name / f"{y}.parquet"
        live_year = y >= this_year - (1 if datetime.now(timezone.utc).month == 1 else 0)
        stale = (not p.exists()) or (live_year and age_hours(p) > refresh_current_hours)
        if p.exists() and not stale:
            df = load_parquet(p)
            # a past-year file must cover the whole requested span
            if not live_year and len(df) and df.index.max() < pd.Timestamp(e, tz="UTC") + pd.Timedelta(hours=23):
                stale = True
        if stale:
            log.info("open-meteo %s %s..%s", name, s, e)
            df = fetch_hourly(url, lat, lon, s, e, variables, model, extra)
            save_parquet(df, p)
        else:
            df = load_parquet(p)
        frames.append(df)
    out = pd.concat(frames).sort_index()
    out = out[~out.index.duplicated(keep="last")]
    return out.loc[pd.Timestamp(start, tz="UTC"): pd.Timestamp(end, tz="UTC") + pd.Timedelta(hours=23)]


def fetch_points(
    url: str,
    lats: list[float],
    lons: list[float],
    variables: list[str],
    params: dict,
    batch: int = 50,
) -> list[dict]:
    """Multi-location request in batches. Returns the raw per-location JSON blocks."""
    out: list[dict] = []
    for i in range(0, len(lats), batch):
        p = dict(params)
        p.update(
            latitude=",".join(f"{x:.3f}" for x in lats[i : i + batch]),
            longitude=",".join(f"{x:.3f}" for x in lons[i : i + batch]),
            hourly=",".join(variables),
            timeformat="unixtime",
            timezone="GMT",
        )
        d = get_json(url, _with_key(p), timeout=300)
        out.extend(d if isinstance(d, list) else [d])
    return out


def today_utc() -> date:
    return datetime.now(timezone.utc).date()


def days_ago(n: int) -> date:
    return today_utc() - timedelta(days=n)
