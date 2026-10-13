"""Airport wind observations (METAR) via the Iowa Environmental Mesonet archive.
VOPC = Puducherry airport (~4 km inland of Serenity), VOMM = Chennai."""
from __future__ import annotations

import io
from datetime import date

import pandas as pd

from ..spot import RAW
from ..util import age_hours, get_text, load_parquet, log, save_parquet

IEM = "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py"


def load(station: str = "VOPC", start: date = date(2015, 1, 1), max_age_hours: float = 24 * 7) -> pd.DataFrame:
    p = RAW / "metar" / f"{station}.parquet"
    if p.exists() and age_hours(p) < max_age_hours:
        return load_parquet(p)
    end = date.today()
    params = {
        "station": station, "data": ["drct", "sknt", "gust", "tmpf"], "tz": "Etc/UTC", "format": "onlycomma",
        "latlon": "no", "missing": "M", "trace": "T", "direct": "no", "report_type": [3, 4],
        "year1": start.year, "month1": start.month, "day1": start.day,
        "year2": end.year, "month2": end.month, "day2": end.day,
    }
    log.info("downloading METAR %s", station)
    txt = get_text(IEM, params=params, timeout=600)
    df = pd.read_csv(io.StringIO(txt), na_values=["M", "T"])
    df["time"] = pd.to_datetime(df["valid"], utc=True)
    for c in ("drct", "sknt", "gust", "tmpf"):
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df.dropna(subset=["sknt"]).set_index("time")[["drct", "sknt", "gust", "tmpf"]]
    # one observation per hour (the last report in the hour)
    df = df.resample("h").last().dropna(subset=["sknt"])
    save_parquet(df, p)
    return df
