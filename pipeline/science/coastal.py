"""Sandbank indicators from the wave record (model estimates, not surveys).

- Longshore drift: CERC formula (Shore Protection Manual 1984), positive = northward.
- Beach state: Wright & Short (1984) dimensionless fall velocity Omega = Hb / (ws T),
  with an exponentially weighted memory of recent days.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from .. import spot

G = 9.81
RHO, RHO_S, POROSITY, KAPPA, K_CERC = 1025.0, 2650.0, 0.4, 0.78, 0.39
STATES = [
    (1.5, "R", "Reflective"),
    (2.5, "LTT", "Low-tide terrace"),
    (3.5, "TBR", "Transverse bar & rip"),
    (4.5, "RBB", "Rhythmic bar & beach"),
    (5.5, "LBT", "Longshore bar-trough"),
    (math.inf, "D", "Dissipative"),
]


def _signed(dir_from, normal):
    return (np.asarray(dir_from, dtype=float) - normal + 180.0) % 360.0 - 180.0


def breaker(hs, tp, dir_from):
    """Physical breaker height (no site factor) and breaker angle (deg, signed)."""
    hs = np.asarray(hs, dtype=float)
    tp = np.asarray(tp, dtype=float)
    a0 = _signed(dir_from, spot.BEACH_NORMAL)
    ok = (np.abs(a0) < 89.0) & (hs > 0) & (tp > 0)
    h0 = np.where(ok, hs * np.sqrt(np.cos(np.radians(np.clip(np.abs(a0), 0, 89)))), 0.0)
    hb = np.where(ok, 0.39 * G**0.2 * (tp * h0**2) ** 0.4, 0.0)
    c0 = G * tp / (2 * math.pi)
    cb = np.sqrt(G * np.maximum(hb, 1e-3) / KAPPA)
    sin_ab = np.clip(np.sin(np.radians(a0)) * cb / np.maximum(c0, 1e-3), -1, 1)
    ab = np.degrees(np.arcsin(sin_ab))
    return hb, np.where(ok, ab, 0.0)


def cerc_m3_per_s(hb, ab):
    coef = K_CERC * RHO * math.sqrt(G) / (16 * math.sqrt(KAPPA) * (RHO_S - RHO) * (1 - POROSITY))
    return coef * np.asarray(hb) ** 2.5 * np.sin(np.radians(2 * np.asarray(ab)))


def state_of(omega: float) -> str:
    for thr, code, _ in STATES:
        if omega < thr:
            return code
    return "D"


def build(dec: pd.DataFrame) -> dict:
    w = dec[["hs", "tp", "dir"]].dropna()
    hb, ab = breaker(w["hs"].to_numpy(), w["tp"].to_numpy(), w["dir"].to_numpy())
    q = cerc_m3_per_s(hb, ab) * 3600.0  # m3 per hour
    h = pd.DataFrame({"q": q, "qn": np.where(q > 0, q, 0), "qs": np.where(q < 0, -q, 0), "hb": hb, "tp": w["tp"].to_numpy()}, index=w.index)
    ws = spot.SPOT["sediment"]["fallVelocity"]
    h["omega"] = h["hb"] / (ws * h["tp"].clip(lower=2))

    day = h.resample("D").agg({"q": "sum", "qn": "sum", "qs": "sum", "omega": "mean", "hb": "mean"})
    # Wright et al. (1985) weighting: weight falls to 10% after phi days
    phi = 15.0
    alpha = 1 - 10 ** (-1 / phi)
    day["omega_w"] = day["omega"].ewm(alpha=alpha, adjust=True).mean()
    day["state"] = [state_of(x) for x in day["omega_w"].fillna(0)]

    mon = day.resample("MS").agg({"q": "sum", "qn": "sum", "qs": "sum"})
    clim = mon.groupby(mon.index.month).agg(["mean", "std"])
    yearly = day.resample("YS").agg({"q": "sum", "qn": "sum", "qs": "sum"})
    return {
        "method": {
            "drift": "CERC (SPM 1984), K=0.39 on Hs, breaker index 0.78; positive = northward",
            "state": "Wright & Short (1984) Omega = Hb/(ws*T), ws=%.3f m/s, 15-day weighted memory" % ws,
            "states": [{"code": c, "name": n, "maxOmega": None if math.isinf(t) else t} for t, c, n in STATES],
        },
        "daily": {
            "t0": int(day.index[0].timestamp()),
            "dt": 86400,
            "net": [None if pd.isna(x) else int(round(x)) for x in day["q"]],
            "omega": [None if pd.isna(x) else round(float(x), 2) for x in day["omega_w"]],
            "state": day["state"].tolist(),
        },
        "monthlyClimatology": [
            {"month": int(m), "net": round(float(r[("q", "mean")])), "north": round(float(r[("qn", "mean")])),
             "south": round(float(r[("qs", "mean")])), "netStd": round(float(r[("q", "std")] if pd.notna(r[("q", "std")]) else 0))}
            for m, r in clim.iterrows()
        ],
        "yearly": [{"year": int(i.year), "net": round(float(r["q"])), "north": round(float(r["qn"])), "south": round(float(r["qs"]))}
                   for i, r in yearly.iterrows()],
    }
