"""Cyclone swell model: how big a swell a storm sends to Serenity Beach.

Physics: Young (1988) parametric hurricane waves give the maximum significant
wave height and peak period near the storm. Swell then decays with distance
(R0/d)^a, is boosted when the storm moves toward the spot (1 + k cos), and is
cut when the great-circle path crosses land (Sri Lanka / India). The total at
the offshore point is sqrt(background^2 + swell^2). The free parameters c, a, k
are fitted on the storm archive, with leave-one-storm-out cross-validation.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
from scipy.optimize import least_squares

from .. import spot
from ..util import angdiff, log
from . import geo

G = 9.81
R0_KM = 150.0
BLOCKED_FACTOR = 0.2
YOUNG = dict(a=-2.175e-3, b=1.506e-2, c=-1.223e-1, d=2.190e-1, e=6.737e-1, f=7.980e-1)


def young(vmax_ms, vfm_ms, rmw_km):
    """Young (1988): max Hs (m) and Tp (s) for a moving tropical cyclone."""
    v = np.clip(vmax_ms, 12.0, 68.0)
    vf = np.clip(vfm_ms, 0.0, 12.0)
    r = np.clip(rmw_km, 15.0, 80.0) * 1000.0
    rp = 22.5e3 * np.log10(r) - 70.8e3
    y = YOUNG
    f_over = y["a"] * v**2 + y["b"] * v * vf + y["c"] * vf**2 + y["d"] * v + y["e"] * vf + y["f"]
    fetch = np.maximum(f_over * rp, 10e3)
    hs = 0.0016 * v * np.sqrt(fetch / G)
    tp = 0.045 * 2 * math.pi * v / G * (G * fetch / v**2) ** 0.33
    return hs, tp


def point_features(tr: pd.DataFrame, shadow: "ShadowGrid") -> pd.DataFrame:
    """Per-track-point physical inputs for the model."""
    f = pd.DataFrame(index=tr.index)
    v = tr["wind"].fillna(25.0).to_numpy() * 0.5144 * 0.93  # 1-min kt -> 10-min m/s
    vf = tr["speed"].fillna(8.0).to_numpy() * 0.5144
    rmw = tr["rmw"].fillna(45.0).to_numpy()
    hs, tp = young(v, vf, rmw)
    f["hs_gen"], f["tp_gen"] = hs, tp
    f["dist"] = tr["dist"].to_numpy()
    f["brg"] = tr["brg"].to_numpy()
    to_spot = (tr["brg"].to_numpy() + 180.0) % 360.0
    heading = tr["heading"].to_numpy(dtype=float)
    heading = np.where(np.isnan(heading), to_spot, heading)
    f["align"] = np.cos(np.radians(angdiff(heading, to_spot)))
    f["blocked"] = [shadow.blocked(la, lo) for la, lo in zip(tr["LAT"], tr["LON"])]
    f["over_land"] = (tr["DIST2LAND"].fillna(100).to_numpy() <= 0)
    f["time"] = tr["time"].to_numpy()
    f["SID"] = tr["SID"].to_numpy()
    f["wind"] = tr["wind"].to_numpy()
    f["lat"], f["lon"] = tr["LAT"].to_numpy(), tr["LON"].to_numpy()
    f["heading"] = tr["heading"].to_numpy()
    cg = G * tp / (4 * math.pi)  # deep-water group velocity, m/s
    f["travel_h"] = f["dist"].to_numpy() * 1000.0 / cg / 3600.0
    return f


def swell_at_spot(feat: pd.DataFrame, c: float, a: float, k: float) -> np.ndarray:
    d = np.maximum(feat["dist"].to_numpy(), R0_KM)
    h = c * feat["hs_gen"].to_numpy() * (R0_KM / d) ** a * (1.0 + k * feat["align"].to_numpy())
    h = np.where(feat["blocked"].to_numpy(), h * BLOCKED_FACTOR, h)
    h = np.where(feat["over_land"].to_numpy(), 0.0, h)
    return np.maximum(h, 0.0)


class ShadowGrid:
    """0.25 deg lookup of 'path to the spot crosses land' (1) / on land (2)."""

    def __init__(self, lat0=-10.0, lat1=32.0, lon0=60.0, lon1=110.0, step=0.25):
        self.lat0, self.lon0, self.step = lat0, lon0, step
        self.nlat = int(round((lat1 - lat0) / step)) + 1
        self.nlon = int(round((lon1 - lon0) / step)) + 1
        self.grid = None

    def compute(self):
        log.info("computing swell shadow grid %dx%d", self.nlat, self.nlon)
        g = np.zeros((self.nlat, self.nlon), dtype=np.int8)
        for i in range(self.nlat):
            la = self.lat0 + i * self.step
            for j in range(self.nlon):
                lo = self.lon0 + j * self.step
                if geo.on_land(la, lo):
                    g[i, j] = 2
                elif geo.path_blocked(la, lo, spot.LAT, spot.LON):
                    g[i, j] = 1
        self.grid = g
        return self

    def blocked(self, lat, lon) -> bool:
        i = int(round((lat - self.lat0) / self.step))
        j = int(round((lon - self.lon0) / self.step))
        if i < 0 or j < 0 or i >= self.nlat or j >= self.nlon:
            return True
        return bool(self.grid[i, j] == 1)

    def to_json(self) -> dict:
        flat = self.grid.ravel().tolist()
        rle, prev, n = [], flat[0], 0
        for v in flat:
            if v == prev:
                n += 1
            else:
                rle.extend([prev, n])
                prev, n = v, 1
        rle.extend([prev, n])
        return {"lat0": self.lat0, "lon0": self.lon0, "step": self.step, "nlat": self.nlat, "nlon": self.nlon, "rle": rle}

    @classmethod
    def from_json(cls, d: dict) -> "ShadowGrid":
        s = cls()
        s.lat0, s.lon0, s.step, s.nlat, s.nlon = d["lat0"], d["lon0"], d["step"], d["nlat"], d["nlon"]
        flat = []
        rle = d["rle"]
        for v, n in zip(rle[0::2], rle[1::2]):
            flat.extend([v] * n)
        s.grid = np.asarray(flat, dtype=np.int8).reshape(s.nlat, s.nlon)
        return s


def _storm_table(storms: list[dict], feat: pd.DataFrame, waves: pd.DataFrame) -> list[dict]:
    rows = []
    by = dict(tuple(feat.groupby("SID")))
    for s in storms:
        r = s.get("response") or {}
        if not r or s["id"] not in by:
            continue
        t0 = pd.Timestamp(s["start"], unit="s", tz="UTC") - pd.Timedelta(hours=6)
        t1 = pd.Timestamp(s["end"], unit="s", tz="UTC") + pd.Timedelta(hours=96)
        w = waves.loc[t0:t1, ["hs", "tp"]].dropna(subset=["hs"])
        rows.append({"sid": s["id"], "obs": r["peakHs"], "base": r["baseHs"], "feat": by[s["id"]], "win": w,
                     "t0": t0, "t1": t1})
    return rows


def _arrival(row, c, a, k):
    """(time of the strongest predicted arrival, predicted swell Hs, predicted Tp)."""
    h = swell_at_spot(row["feat"], c, a, k)
    if len(h) == 0:
        return None, 0.0, None
    i = int(np.argmax(h))
    fr = row["feat"].iloc[i]
    return pd.Timestamp(fr["time"]) + pd.Timedelta(hours=float(fr["travel_h"])), float(h[i]), float(fr["tp_gen"])


def _attribute(rows, c, a, k, half_window_h: float = 36.0):
    """Observed peak near the predicted arrival, and flag storms whose window is
    dominated by another storm's (bigger) predicted swell."""
    arr = [_arrival(r, c, a, k) for r in rows]
    for r, (ta, hp, tp) in zip(rows, arr):
        r["arrival"], r["pred_swell"], r["pred_tp"] = ta, hp, tp
        w = r["win"]
        if ta is not None and len(w):
            near = w.loc[ta - pd.Timedelta(hours=half_window_h): ta + pd.Timedelta(hours=half_window_h)]
            if len(near):
                j = near["hs"].idxmax()
                r["obs"] = float(near.loc[j, "hs"])
                r["obs_tp"] = float(near.loc[j, "tp"]) if pd.notna(near.loc[j, "tp"]) else None
    for r in rows:
        r["confounded"] = False
        for o in rows:
            if o is r or o["arrival"] is None:
                continue
            if r["t0"] <= o["arrival"] <= r["t1"] and o["pred_swell"] > max(r["pred_swell"], 0.05) * 1.25:
                r["confounded"] = True
                break
    return rows


def _predict_peak(row, c, a, k):
    h = swell_at_spot(row["feat"], c, a, k)
    if len(h) == 0:
        return row["base"], None
    i = int(np.argmax(h))
    return math.sqrt(row["base"] ** 2 + h[i] ** 2), i


def _fit(rows, x0=(0.25, 0.5, 0.3)):
    def resid(p):
        c, a, k = math.exp(p[0]), p[1], p[2]
        out = []
        for r in rows:
            pred, _ = _predict_peak(r, c, a, k)
            out.append(math.log(max(r["obs"], 0.05)) - math.log(max(pred, 0.05)))
        return np.asarray(out)

    p0 = np.array([math.log(x0[0]), x0[1], x0[2]])
    res = least_squares(resid, p0, bounds=([math.log(0.01), 0.0, 0.0], [math.log(3.0), 2.5, 0.9]), loss="soft_l1", f_scale=0.3)
    return math.exp(res.x[0]), float(res.x[1]), float(res.x[2])


def fit(storms: list[dict], tracks: pd.DataFrame, shadow: ShadowGrid, waves: pd.DataFrame, cv: bool = True) -> dict:
    feat = point_features(tracks, shadow)
    rows = _storm_table(storms, feat, waves)
    log.info("cyclone model: %d storms with responses", len(rows))
    # pass 1 on whole-window peaks, pass 2 on peaks near the predicted arrival
    c, a, k = _fit(rows)
    _attribute(rows, c, a, k)
    clean = [r for r in rows if not r["confounded"]]
    c, a, k = _fit(clean, x0=(c, a, k))
    _attribute(rows, c, a, k)
    clean = [r for r in rows if not r["confounded"]]
    log.info("cyclone model params c=%.3f a=%.3f k=%.3f (%d clean, %d confounded)", c, a, k, len(clean), len(rows) - len(clean))

    # leave-one-storm-out cross-validation on the clean set
    cvres = []
    for i, r in enumerate(clean):
        if cv:
            ci, ai, ki = _fit(clean[:i] + clean[i + 1:], x0=(c, a, k))
        else:
            ci, ai, ki = c, a, k
        pred, _ = _predict_peak(r, ci, ai, ki)
        cvres.append((r["obs"], pred, r["base"]))
    obs = np.array([x[0] for x in cvres])
    pred = np.array([x[1] for x in cvres])
    base = np.array([x[2] for x in cvres])
    logr = np.log(np.maximum(obs, 0.05)) - np.log(np.maximum(pred, 0.05))
    big = obs - base > 0.5
    sse = float(np.sum((obs - pred) ** 2))
    sse_base = float(np.sum((obs - base) ** 2))
    metrics = {
        "storms": int(len(clean)),
        "confounded_excluded": int(len(rows) - len(clean)),
        "cv": "leave-one-storm-out" if cv else "in-sample",
        "mae_m": round(float(np.mean(np.abs(obs - pred))), 3),
        "bias_m": round(float(np.mean(pred - obs)), 3),
        "corr": round(float(np.corrcoef(obs, pred)[0, 1]), 3),
        "r2": round(float(1 - sse / np.sum((obs - obs.mean()) ** 2)), 3),
        "skill_vs_background": round(float(1 - sse / sse_base), 3),
        "mae_background_only_m": round(float(np.mean(np.abs(obs - base))), 3),
        "mae_big_events_m": round(float(np.mean(np.abs(obs[big] - pred[big]))), 3) if big.any() else None,
        "n_big_events": int(big.sum()),
        "resid_log_q": {str(q): round(float(np.quantile(logr, q / 100)), 3) for q in (10, 25, 50, 75, 90)},
    }
    # period calibration: observed Tp at the attributed peak vs Young's Tp
    tps = [(r["obs_tp"], r["pred_tp"]) for r in clean if r.get("obs_tp") and r.get("pred_tp") and r["obs"] - r["base"] > 0.5]
    tp_scale = float(np.median([o / p for o, p in tps])) if len(tps) > 10 else 0.8
    metrics["tp_scale"] = round(tp_scale, 3)
    log.info("cyclone model CV: %s", metrics)

    # per-storm prediction (final params) + analog features at the most favourable point
    analogs = []
    by_sid = {s["id"]: s for s in storms}
    for r in rows:
        h = swell_at_spot(r["feat"], c, a, k)
        i = int(np.argmax(h)) if len(h) else 0
        fr = r["feat"].iloc[i]
        s = by_sid[r["sid"]]
        pred_total = math.sqrt(r["base"] ** 2 + float(h[i]) ** 2) if len(h) else r["base"]
        arrival = int(pd.Timestamp(fr["time"]).timestamp() + fr["travel_h"] * 3600) if len(h) else None
        s["model"] = {"predPeakHs": round(pred_total, 2), "predSwellHs": round(float(h[i]) if len(h) else 0.0, 2),
                      "predTp": round(float(fr["tp_gen"]) * tp_scale, 1), "arrival": arrival}
        s["response"]["attributedHs"] = round(float(r["obs"]), 2)
        s["response"]["confounded"] = bool(r["confounded"])
        analogs.append({
            "sid": r["sid"], "lat": round(float(fr["lat"]), 2), "lon": round(float(fr["lon"]), 2),
            "dist": round(float(fr["dist"])), "brg": round(float(fr["brg"])),
            "wind": None if pd.isna(fr["wind"]) else round(float(fr["wind"])),
            "heading": None if pd.isna(fr["heading"]) else round(float(fr["heading"])),
            "month": int(pd.Timestamp(fr["time"]).month),
            "obsPeak": round(float(r["obs"]), 2), "base": r["base"], "confounded": bool(r["confounded"]),
        })

    return {
        "params": {"c": round(c, 4), "a": round(a, 4), "k": round(k, 4), "R0km": R0_KM, "blockedFactor": BLOCKED_FACTOR,
                   "windTo10min": 0.93, "tpScale": round(tp_scale, 3),
                   "defaults": {"windKt": 25.0, "speedKt": 8.0, "rmwKm": 45.0}},
        "young": YOUNG,
        "metrics": metrics,
        "analogs": analogs,
        "cv_points": [[round(float(o), 2), round(float(p), 2)] for o, p in zip(obs, pred)],
    }


def predict_track(points: list[dict], params: dict, shadow: ShadowGrid, base_hs: float) -> list[dict]:
    """Swell contributions for a forecast track [{time, lat, lon, windKt, speedKt, heading, rmwKm}]."""
    out = []
    for p in points:
        v = (p.get("windKt") or params["defaults"]["windKt"]) * 0.5144 * params["windTo10min"]
        vf = (p.get("speedKt") or params["defaults"]["speedKt"]) * 0.5144
        hs, tp = young(np.array([v]), np.array([vf]), np.array([p.get("rmwKm") or params["defaults"]["rmwKm"]]))
        d = float(geo_dist(p["lat"], p["lon"]))
        to_spot = (float(geo_brg(p["lat"], p["lon"])) + 180) % 360
        align = math.cos(math.radians(float(angdiff(p.get("heading", to_spot) or to_spot, to_spot))))
        h = params["c"] * float(hs[0]) * (params["R0km"] / max(d, params["R0km"])) ** params["a"] * (1 + params["k"] * align)
        if shadow.blocked(p["lat"], p["lon"]):
            h *= params["blockedFactor"]
        cg = G * float(tp[0]) / (4 * math.pi)
        out.append({"time": p["time"], "swellHs": h, "tp": float(tp[0]), "arrival": p["time"] + d * 1000 / cg,
                    "totalHs": math.sqrt(base_hs**2 + h**2)})
    return out


def geo_dist(lat, lon):
    from ..util import haversine_km
    return haversine_km(spot.LAT, spot.LON, lat, lon)


def geo_brg(lat, lon):
    from ..util import bearing_deg
    return bearing_deg(spot.LAT, spot.LON, lat, lon)
