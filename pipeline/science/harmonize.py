"""Monthly quantile mapping so the long ERA5 record matches the climate of the
higher-resolution models used for recent years and for the live forecast."""
from __future__ import annotations

import numpy as np
import pandas as pd

QS = np.linspace(0.005, 0.995, 100)


def fit_monthly_qmap(src: pd.Series, ref: pd.Series, window: int = 1) -> dict:
    """Fit src->ref quantile maps per calendar month on their overlapping times.

    `window` widens each month with its neighbours to stabilise the tails.
    Returns {month: (src_quantiles, ref_quantiles)} as lists.
    """
    both = pd.concat([src.rename("s"), ref.rename("r")], axis=1).dropna()
    maps: dict[int, tuple[list, list]] = {}
    for m in range(1, 13):
        months = [((m - 1 + k) % 12) + 1 for k in range(-window, window + 1)]
        sub = both[both.index.month.isin(months)]
        if len(sub) < 200:
            continue
        sq = np.quantile(sub["s"].to_numpy(), QS)
        rq = np.quantile(sub["r"].to_numpy(), QS)
        sq = np.maximum.accumulate(sq)
        rq = np.maximum.accumulate(rq)
        maps[m] = (sq.tolist(), rq.tolist())
    return maps


def apply_monthly_qmap(src: pd.Series, maps: dict) -> pd.Series:
    out = src.copy().astype(float)
    if not maps:
        return out
    months = src.index.month
    for m in range(1, 13):
        if m not in maps:
            continue
        sq, rq = (np.asarray(x) for x in maps[m])
        sel = months == m
        x = src.to_numpy()[sel]
        y = np.interp(x, sq, rq)
        # beyond the fitted range, extrapolate with the ratio at the tails
        hi = x > sq[-1]
        if hi.any() and sq[-1] > 0:
            y[hi] = x[hi] * (rq[-1] / sq[-1])
        lo = x < sq[0]
        if lo.any() and sq[0] > 0:
            y[lo] = x[lo] * (rq[0] / sq[0])
        out.iloc[np.where(sel)[0]] = y
    return out


def qmap_summary(src: pd.Series, ref: pd.Series, mapped: pd.Series) -> dict:
    both = pd.concat([src.rename("s"), ref.rename("r"), mapped.rename("m")], axis=1).dropna()
    if both.empty:
        return {}
    q = [0.5, 0.9, 0.99]
    return {
        "n": int(len(both)),
        "src_q": np.quantile(both["s"], q).round(3).tolist(),
        "ref_q": np.quantile(both["r"], q).round(3).tolist(),
        "mapped_q": np.quantile(both["m"], q).round(3).tolist(),
        "corr": round(float(both["s"].corr(both["r"])), 3),
        "rmse_before": round(float(np.sqrt(((both["s"] - both["r"]) ** 2).mean())), 3),
        "rmse_after": round(float(np.sqrt(((both["m"] - both["r"]) ** 2).mean())), 3),
    }
