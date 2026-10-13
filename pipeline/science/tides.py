"""Astronomical tide for Serenity Beach.

SMOC sea level (Open-Meteo, Nov 2022 onwards, ~12 km offshore) is decomposed with
UTide; the harmonic constants then reconstruct tides for any date (2015-2030).
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import utide

from ..util import log


def _days(idx: pd.DatetimeIndex) -> np.ndarray:
    # UTide works in days; use days since 1970 with epoch='python'-compatible floats
    return (idx.tz_convert("UTC").tz_localize(None) - pd.Timestamp("1970-01-01")) / pd.Timedelta(days=1)


def fit(sl: pd.Series, lat: float):
    s = sl.dropna()
    s = s - s.mean()
    coef = utide.solve(
        _days(s.index).to_numpy(),
        s.to_numpy(),
        lat=lat,
        epoch="1970-01-01",
        method="ols",
        conf_int="none",
        constit="auto",
        trend=False,
        verbose=False,
    )
    return coef


def predict(coef, idx: pd.DatetimeIndex) -> np.ndarray:
    r = utide.reconstruct(_days(idx).to_numpy(), coef, epoch="1970-01-01", verbose=False)
    return np.asarray(r.h, dtype=float)


def build(sl: pd.Series, lat: float, start="2015-01-01", end="2031-01-01") -> dict:
    sl = sl.dropna()
    if len(sl) < 24 * 200:
        raise RuntimeError(f"not enough sea-level data for a tidal fit ({len(sl)} h)")

    # hold-out validation: fit up to the end of 2024, test afterwards
    cut = pd.Timestamp("2025-01-01", tz="UTC")
    train, test = sl[sl.index < cut], sl[sl.index >= cut]
    val = {}
    if len(train) > 24 * 365 and len(test) > 24 * 60:
        c_tr = fit(train, lat)
        pred = predict(c_tr, test.index)
        resid = (test - test.mean()).to_numpy() - pred
        val = {
            "train_hours": int(len(train)),
            "test_hours": int(len(test)),
            "rmse_m": round(float(np.sqrt(np.nanmean(resid**2))), 4),
            "explained_var": round(float(1 - np.nanvar(resid) / np.nanvar(test.to_numpy())), 4),
        }
        log.info("tide hold-out: %s", val)

    coef = fit(sl, lat)
    idx = pd.date_range(start, end, freq="h", tz="UTC", inclusive="left")
    h = predict(coef, idx)

    cons = []
    for name, amp, ph, freq in zip(coef.name, coef.A, coef.g, coef.aux.frq):
        cons.append({"name": str(name), "amp_m": round(float(amp), 4), "phase_deg": round(float(ph), 1), "cph": round(float(freq), 6)})
    cons.sort(key=lambda c: -c["amp_m"])

    # spring range: typical max daily range across the reconstructed series
    daily = pd.Series(h, index=idx).resample("D")
    rng = (daily.max() - daily.min()).dropna()
    return {
        "t0": int(idx[0].timestamp()),
        "dt": 3600,
        "n": len(idx),
        "h_cm": np.round(h * 100).astype(int).tolist(),
        "datum": "mean sea level",
        # SMOC sea level is relative to global MSL; subtract this before comparing with the tide
        "msl_offset_m": round(float(sl.mean()), 3),
        "mean_range_m": round(float(rng.mean()), 3),
        "spring_range_m": round(float(rng.quantile(0.95)), 3),
        "neap_range_m": round(float(rng.quantile(0.05)), 3),
        "lat_m": round(float(h.min()), 3),
        "hat_m": round(float(h.max()), 3),
        "constituents": cons[:20],
        "validation": val,
        "fit_hours": int(len(sl)),
        "fit_start": sl.index.min().isoformat(),
        "fit_end": sl.index.max().isoformat(),
    }
