"""Storm -> swell archive: every North Indian Ocean storm since 1980 paired with
the waves it produced at Serenity Beach."""
from __future__ import annotations

import numpy as np
import pandas as pd

from .. import spot
from ..fetch import ibtracs
from ..util import bearing_deg, haversine_km

BOB_MAX_DIST_KM = 2600.0


def prepare_tracks(raw: pd.DataFrame) -> pd.DataFrame:
    tr = raw.copy()
    tr["wind"] = ibtracs.best_wind_kt(tr)
    tr["pres"] = ibtracs.best_pres(tr)
    tr["r34"] = ibtracs.r34_km(tr)
    tr["rmw"] = tr["USA_RMW"].where(tr["USA_RMW"] > 0) * 1.852
    tr["dist"] = haversine_km(spot.LAT, spot.LON, tr["LAT"].to_numpy(), tr["LON"].to_numpy())
    tr["brg"] = bearing_deg(spot.LAT, spot.LON, tr["LAT"].to_numpy(), tr["LON"].to_numpy())
    tr["speed"] = tr["STORM_SPEED"].where(tr["STORM_SPEED"] >= 0)
    tr["heading"] = tr["STORM_DIR"].where(tr["STORM_DIR"] >= 0)
    return tr


def relevant(g: pd.DataFrame) -> bool:
    """Storms that could send swell to the east coast: anything in the Bay of Bengal /
    Andaman Sea, or passing within reach on the eastern side."""
    if (g["SUBBASIN"] == "BB").any():
        return True
    east = g[(g["LON"] >= 78.5) & (g["dist"] <= BOB_MAX_DIST_KM)]
    return len(east) > 0


def storm_record(sid: str, g: pd.DataFrame, waves: pd.DataFrame) -> dict:
    g = g.sort_values("time")
    t0, t1 = g["time"].iloc[0], g["time"].iloc[-1]
    name = str(g["NAME"].iloc[0]).strip()
    name = "" if name in ("NOT_NAMED", "UNNAMED", "nan") else name.title()

    pre = waves["hs"].loc[t0 - pd.Timedelta(days=7): t0 - pd.Timedelta(days=1)]
    base = float(pre.median()) if len(pre.dropna()) > 24 else float(waves["hs"].loc[t0 - pd.Timedelta(days=30): t0].median())
    win = waves.loc[t0 - pd.Timedelta(hours=6): t1 + pd.Timedelta(hours=96)]
    resp = {}
    if len(win.dropna(subset=["hs"])):
        i = win["hs"].idxmax()
        resp = {
            "baseHs": round(base, 2),
            "peakHs": round(float(win.loc[i, "hs"]), 2),
            "peakTime": int(i.timestamp()),
            "peakTp": round(float(win.loc[i, "tp"]), 1) if pd.notna(win.loc[i, "tp"]) else None,
            "peakDir": int(round(float(win.loc[i, "dir"]))) if pd.notna(win.loc[i, "dir"]) else None,
            "hoursAbove1_5m": int((win["hs"] >= 1.5).sum()),
            "hoursAbove2m": int((win["hs"] >= 2.0).sum()),
        }
    k = g["dist"].idxmin()
    closest = g.loc[k]
    landfall = g[(g["DIST2LAND"] <= 0)]
    lf = None
    if len(landfall):
        r = landfall.iloc[0]
        lf = {"time": int(r["time"].timestamp()), "lat": round(float(r["LAT"]), 2), "lon": round(float(r["LON"]), 2),
              "distKm": round(float(r["dist"]))}
    grades = g["NEWDELHI_GRADE"].dropna().astype(str).str.strip().str.upper().str.replace("(H)", "", regex=False)
    rank = {c: i for i, c in enumerate(["L", "D", "DD", "CS", "SCS", "VSCS", "ESCS", "SUCS"])}
    imd = max((s for s in grades if s in rank), key=lambda s: rank[s], default="")
    imd = "SuCS" if imd == "SUCS" else imd
    if not imd:
        imd = ibtracs.imd_grade(float(g["wind"].max()) / 1.1)

    track = []
    for _, r in g.iterrows():
        track.append([
            int(r["time"].timestamp()),
            round(float(r["LAT"]), 2),
            round(float(r["LON"]), 2),
            None if pd.isna(r["wind"]) else int(round(r["wind"])),
            None if pd.isna(r["pres"]) else int(round(r["pres"])),
        ])
    return {
        "id": sid,
        "name": name,
        "season": int(g["SEASON"].iloc[0]),
        "subbasin": str(g["SUBBASIN"].mode().iloc[0]),
        "start": int(t0.timestamp()),
        "end": int(t1.timestamp()),
        "maxWindKt": None if pd.isna(g["wind"].max()) else int(round(g["wind"].max())),
        "minPres": None if pd.isna(g["pres"].min()) else int(round(g["pres"].min())),
        "imd": imd,
        "closestKm": int(round(closest["dist"])),
        "closestTime": int(closest["time"].timestamp()),
        "closestBearing": int(round(closest["brg"])),
        "landfall": lf,
        "provisional": bool(g["TRACK_TYPE"].astype(str).str.contains("PROVISIONAL").any()),
        "track": track,
        "response": resp,
    }


def build(raw_tracks: pd.DataFrame, waves: pd.DataFrame) -> tuple[list[dict], pd.DataFrame]:
    tr = prepare_tracks(raw_tracks)
    storms, keep = [], []
    for sid, g in tr.groupby("SID", sort=False):
        if not relevant(g):
            continue
        if g["time"].iloc[0] < waves.index.min() + pd.Timedelta(days=8):
            continue
        storms.append(storm_record(sid, g, waves))
        keep.append(sid)
    storms.sort(key=lambda s: s["start"])
    return storms, tr[tr["SID"].isin(keep)].copy()


def series_for(storms: list[dict], decade: pd.DataFrame, long: pd.DataFrame) -> dict:
    """3-hourly Serenity series around each storm for the archive charts."""
    out = {}
    for s in storms:
        t0 = pd.Timestamp(s["start"], unit="s", tz="UTC") - pd.Timedelta(days=2)
        t1 = pd.Timestamp(s["end"], unit="s", tz="UTC") + pd.Timedelta(days=4)
        src = decade if t0 >= decade.index.min() else long
        w = src.loc[t0:t1, [c for c in ("hs", "tp", "dir", "ws", "wd", "pr") if c in src.columns]]
        w = w.resample("3h").agg({"hs": "max", "tp": "mean", "dir": "mean", "ws": "mean", "wd": "mean", "pr": "sum"})
        if w.empty:
            continue
        out[s["id"]] = {
            "t0": int(w.index[0].timestamp()),
            "dt": 10800,
            "hs": [None if pd.isna(x) else round(float(x), 2) for x in w["hs"]],
            "tp": [None if pd.isna(x) else round(float(x), 1) for x in w["tp"]],
            "dir": [None if pd.isna(x) else int(round(x)) for x in w["dir"]],
            "ws": [None if pd.isna(x) else round(float(x), 1) for x in w["ws"]],
            "wd": [None if pd.isna(x) else int(round(x)) for x in w["wd"]],
            "pr": [None if pd.isna(x) else round(float(x), 1) for x in w["pr"]],
        }
    return out
