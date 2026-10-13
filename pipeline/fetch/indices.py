"""Climate drivers: ENSO (ONI), Indian Ocean Dipole (DMI) and the MJO (ROMI)."""
from __future__ import annotations

import math

import pandas as pd

from ..util import get_text, log

ONI_URL = "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt"
DMI_URL = "https://psl.noaa.gov/gcos_wgsp/Timeseries/Data/dmi.had.long.data"
ROMI_URL = "https://psl.noaa.gov/mjo/mjoindex/romi.cpcolr.1x.txt"
UA = {"User-Agent": "Mozilla/5.0 (serenity-surf)"}
SEAS_MID = {"DJF": 1, "JFM": 2, "FMA": 3, "MAM": 4, "AMJ": 5, "MJJ": 6, "JJA": 7, "JAS": 8, "ASO": 9, "SON": 10, "OND": 11, "NDJ": 12}


def oni() -> pd.DataFrame:
    rows = []
    for line in get_text(ONI_URL, headers=UA).splitlines()[1:]:
        p = line.split()
        if len(p) != 4 or p[0] not in SEAS_MID:
            continue
        rows.append({"season": p[0], "year": int(p[1]), "month": SEAS_MID[p[0]], "anom": float(p[3])})
    return pd.DataFrame(rows)


def dmi() -> pd.DataFrame:
    rows = []
    for line in get_text(DMI_URL, headers=UA).splitlines()[1:]:
        p = line.split()
        if len(p) != 13:
            continue
        try:
            y = int(p[0])
        except ValueError:
            continue
        for m, v in enumerate(p[1:], start=1):
            f = float(v)
            if f > -99:
                rows.append({"year": y, "month": m, "dmi": f})
    return pd.DataFrame(rows)


def mjo_phase(rmm1: float, rmm2: float) -> int:
    th = math.degrees(math.atan2(rmm2, rmm1))
    return int((th + 180.0) // 45.0) % 8 + 1


def romi() -> pd.DataFrame:
    """Real-time OMI. Mapped to RMM-like axes as (PC2, -PC1), per NOAA PSL guidance."""
    rows = []
    for line in get_text(ROMI_URL, headers=UA).splitlines():
        p = line.split()
        if len(p) < 7:
            continue
        try:
            y, m, d = int(p[0]), int(p[1]), int(p[2])
            pc1, pc2, amp = float(p[4]), float(p[5]), float(p[6])
        except ValueError:
            continue
        x, yv = pc2, -pc1
        rows.append({"date": pd.Timestamp(y, m, d), "x": x, "y": yv, "amp": amp, "phase": mjo_phase(x, yv)})
    df = pd.DataFrame(rows)
    log.info("ROMI %d days, last %s", len(df), df["date"].max().date() if len(df) else None)
    return df


def enso_class(anom: float) -> str:
    if anom >= 0.5:
        return "El Niño"
    if anom <= -0.5:
        return "La Niña"
    return "Neutral"
