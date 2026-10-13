"""Seasonal statistics that do not depend on the surfer's scoring profile.
(Profile-dependent odds are computed in the browser from the hourly history.)"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .. import spot
from ..fetch import indices as idx
from ..util import angdiff

IST = pd.Timedelta(minutes=spot.SPOT["utcOffsetMinutes"])
SECTORS = 16


def _ist(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out.index = out.index.tz_localize(None) + IST
    return out


def doy_percentiles(daily: pd.Series, qs=(0.1, 0.25, 0.5, 0.75, 0.9), half_window: int = 7) -> dict:
    s = daily.dropna()
    doy = np.minimum(s.index.dayofyear, 365)
    out = {f"p{int(q * 100)}": [] for q in qs}
    vals = s.to_numpy()
    for d in range(1, 366):
        dist = np.abs(((doy - d) + 182) % 365 - 182)
        v = vals[dist <= half_window]
        for q in qs:
            out[f"p{int(q * 100)}"].append(round(float(np.quantile(v, q)), 2) if len(v) else None)
    return out


def rose(direction: pd.Series, value: pd.Series, bins: list[float]) -> list[list[float]]:
    ok = direction.notna() & value.notna()
    d, v = direction[ok].to_numpy(), value[ok].to_numpy()
    sec = ((d + 360 / SECTORS / 2) % 360 // (360 / SECTORS)).astype(int)
    out = np.zeros((SECTORS, len(bins)))
    edges = bins[1:] + [np.inf]
    b = np.searchsorted(edges, v, side="right")
    b = np.clip(b, 0, len(bins) - 1)
    np.add.at(out, (sec, b), 1)
    tot = max(len(d), 1)
    return np.round(out / tot * 100, 2).tolist()


def sea_breeze_onset(ws: pd.Series, wd: pd.Series, min_kt: float = 6.0) -> pd.Series:
    """Per day (IST index), the first hour from 08:00 when wind turns onshore >= min_kt."""
    df = pd.DataFrame({"ws": ws, "wd": wd}).dropna()
    df = df[(df.index.hour >= 8) & (df.index.hour <= 17)]
    onshore = (angdiff(df["wd"].to_numpy(), spot.BEACH_NORMAL) <= 70) & (df["ws"].to_numpy() >= min_kt)
    df["on"] = onshore
    first = df[df["on"]].groupby(df[df["on"]].index.date).apply(lambda g: g.index.hour.min() + g.index.minute.min() / 60)
    first.index = pd.to_datetime(first.index)
    return first


def build(dec: pd.DataFrame, long: pd.DataFrame, storms: list[dict], romi: pd.DataFrame | None,
          oni: pd.DataFrame | None, metar: pd.DataFrame | None) -> dict:
    out: dict = {}
    L = _ist(long)
    D = _ist(dec)

    # ---------- day-of-year percentiles (1980+) ----------
    day = L.resample("D").agg({"hs": "max", "tp": "mean", "ws": "mean", "pr": "sum"})
    out["doy"] = {
        "years": [int(day.index.min().year), int(day.index.max().year)],
        "hsMax": doy_percentiles(day["hs"]),
        "tp": doy_percentiles(day["tp"]),
        "wind": doy_percentiles(day["ws"]),
        "rain": doy_percentiles(day["pr"], qs=(0.5, 0.75, 0.9)),
    }

    # ---------- month x hour wind behaviour (IST, IFS era preferred) ----------
    W = D[D.index >= pd.Timestamp("2017-01-01")][["ws", "wd"]].dropna()
    rel_off = angdiff(W["wd"].to_numpy(), spot.OFFSHORE_FROM)
    rel_on = angdiff(W["wd"].to_numpy(), spot.BEACH_NORMAL)
    W = W.assign(off=((rel_off <= 60) | (W["ws"] <= 3)).astype(float),
                 on=((rel_on <= 60) & (W["ws"] > 5)).astype(float))
    g = W.groupby([W.index.month, W.index.hour])
    mh = g.agg({"off": "mean", "on": "mean", "ws": "mean"})
    out["monthHour"] = {
        "offshore": [[round(float(mh.loc[(m, h), "off"]) * 100, 1) for h in range(24)] for m in range(1, 13)],
        "onshore": [[round(float(mh.loc[(m, h), "on"]) * 100, 1) for h in range(24)] for m in range(1, 13)],
        "speed": [[round(float(mh.loc[(m, h), "ws"]), 1) for h in range(24)] for m in range(1, 13)],
    }

    # ---------- sea-breeze onset: model vs airport observations ----------
    sb = sea_breeze_onset(W["ws"], W["wd"])
    sb_m = sb.groupby(sb.index.month)
    onset = {"model": [round(float(sb_m.median().get(m, np.nan)), 2) if m in sb_m.groups else None for m in range(1, 13)],
             "modelDaysPct": [round(float(sb_m.size().get(m, 0)) / max(1, int(((W.index.month == m) & (W.index.hour == 12)).sum())) * 100, 1) for m in range(1, 13)]}
    if metar is not None and len(metar):
        M = _ist(metar.rename(columns={"sknt": "ws", "drct": "wd"}))
        sbo = sea_breeze_onset(M["ws"], M["wd"])
        g2 = sbo.groupby(sbo.index.month)
        onset["airport"] = [round(float(g2.median().get(m, np.nan)), 2) if m in g2.groups and g2.size().get(m, 0) >= 10 else None for m in range(1, 13)]
        onset["airportDays"] = [int(g2.size().get(m, 0)) for m in range(1, 13)]
        # model vs obs at the airport hours for validation
        both = pd.concat([M[["ws", "wd"]].add_suffix("_obs"), D[["ws", "wd"]].add_suffix("_mod")], axis=1).dropna()
        if len(both):
            dd = angdiff(both["wd_obs"].to_numpy(), both["wd_mod"].to_numpy())
            onset["validation"] = {"hours": int(len(both)),
                                   "speedBiasKt": round(float((both["ws_mod"] - both["ws_obs"]).mean()), 2),
                                   "dirWithin45Pct": round(float((dd <= 45).mean() * 100), 1),
                                   "corrSpeed": round(float(both["ws_mod"].corr(both["ws_obs"])), 3)}
    out["seaBreeze"] = onset

    # ---------- roses by month ----------
    hs_bins = [0, 0.5, 1.0, 1.5, 2.0]
    ws_bins = [0, 5, 10, 15, 20]
    out["roses"] = {"sectors": SECTORS, "hsBins": hs_bins, "wsBins": ws_bins, "wave": [], "windAM": [], "windPM": []}
    for m in range(1, 13):
        Dm = D[D.index.month == m]
        out["roses"]["wave"].append(rose(Dm["dir"], Dm["hs"], hs_bins))
        am = Dm[(Dm.index.hour >= 5) & (Dm.index.hour <= 10)]
        pm = Dm[(Dm.index.hour >= 12) & (Dm.index.hour <= 18)]
        out["roses"]["windAM"].append(rose(am["wd"], am["ws"], ws_bins))
        out["roses"]["windPM"].append(rose(pm["wd"], pm["ws"], ws_bins))

    # ---------- rain ----------
    rain_m = L["pr"].resample("MS").sum()
    years = sorted(set(rain_m.index.year))
    out["rain"] = {
        "monthlyMean1980": [round(float(rain_m[rain_m.index.month == m].mean()), 1) for m in range(1, 13)],
        "byYear": {int(y): [round(float(rain_m.get(pd.Timestamp(y, m, 1), np.nan)), 1) if pd.Timestamp(y, m, 1) in rain_m.index else None for m in range(1, 13)]
                   for y in years if y >= 2015},
        "rainyDaysMean": [round(float((day["pr"][day.index.month == m] >= 2.5).groupby(day.index[day.index.month == m].year).sum().mean()), 1) for m in range(1, 13)],
    }

    # ---------- big-swell days per month (1980+) ----------
    big = (day["hs"] >= 2.0).groupby([day.index.year, day.index.month]).sum()
    out["bigSwellDays"] = [round(float(big.xs(m, level=1).mean()), 2) for m in range(1, 13)]

    # ---------- SST ----------
    if "sst" in D:
        sst = D["sst"].dropna()
        out["sst"] = [round(float(sst[sst.index.month == m].mean()), 1) if (sst.index.month == m).any() else None for m in range(1, 13)]

    # ---------- cyclones: monthly counts, MJO and ENSO ----------
    bob = [s for s in storms if s["subbasin"] == "BB" or s["closestKm"] < 1500]
    yrs = sorted({s["season"] for s in bob})
    nyears = max(1, (max(yrs) - min(yrs) + 1)) if yrs else 1
    cat = {"dep": (0, 34), "cs": (34, 64), "severe": (64, 999)}
    counts = {k: [0] * 12 for k in cat}
    swell_storms = [0] * 12
    for s in bob:
        m = pd.Timestamp(s["start"], unit="s").month - 1
        w = s["maxWindKt"] or 0
        for k, (lo, hi) in cat.items():
            if lo <= w < hi:
                counts[k][m] += 1
        r = s.get("response") or {}
        if r and not r.get("confounded") and r.get("attributedHs", 0) - r.get("baseHs", 0) >= 0.5:
            swell_storms[m] += 1
    out["cyclones"] = {
        "years": [min(yrs), max(yrs)] if yrs else None,
        "perYearByMonth": {k: [round(v / nyears, 2) for v in vals] for k, vals in counts.items()},
        "swellStormsPerYearByMonth": [round(v / nyears, 2) for v in swell_storms],
        "total": len(bob),
    }

    if romi is not None and len(romi):
        r = romi.set_index("date")
        active = r[r["amp"] >= 1.0]
        days_in = active.groupby("phase").size().reindex(range(1, 9), fill_value=0)
        gen = []
        for s in bob:
            if (s["maxWindKt"] or 0) < 34:
                continue
            d = pd.Timestamp(s["start"], unit="s").normalize()
            if d in active.index:
                gen.append(int(active.loc[d, "phase"]))
            elif d in r.index:
                gen.append(0)  # weak MJO
        gcount = pd.Series(gen).value_counts().reindex(range(0, 9), fill_value=0)
        base_rate = len(gen) / max(1, len(r))
        out["mjo"] = {
            "phases": list(range(1, 9)),
            "genesisCount": [int(gcount[p]) for p in range(1, 9)],
            "weakMjoGenesis": int(gcount[0]),
            "daysInPhase": [int(days_in[p]) for p in range(1, 9)],
            "rateRatio": [round(float((gcount[p] / days_in[p]) / base_rate), 2) if days_in[p] and base_rate else None for p in range(1, 9)],
            "note": "Cyclonic storms (>=34 kt) forming while the MJO (ROMI) amplitude >= 1, per day in each phase, relative to the all-days rate.",
        }

    if oni is not None and len(oni):
        o = oni[oni["season"] == "OND"].set_index("year")["anom"]
        rows = {}
        for cls in ("El Niño", "Neutral", "La Niña"):
            yrs_c = [y for y, v in o.items() if idx.enso_class(v) == cls and (min(yrs) if yrs else 1980) <= y <= max(yrs or [2026]) and y < pd.Timestamp.utcnow().year]
            n_storms = [sum(1 for s in bob if s["season"] == y and pd.Timestamp(s["start"], unit="s").month in (10, 11, 12) and (s["maxWindKt"] or 0) >= 34) for y in yrs_c]
            bigd = [int(big.get((y, 10), 0) + big.get((y, 11), 0) + big.get((y, 12), 0)) for y in yrs_c]
            rows[cls] = {"years": yrs_c, "meanStormsOND": round(float(np.mean(n_storms)), 2) if n_storms else None,
                         "meanBigSwellDaysOND": round(float(np.mean(bigd)), 1) if bigd else None}
        out["enso"] = rows
    return out
