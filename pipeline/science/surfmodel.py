"""Python mirror of web/src/core/surf.ts (nearshore transform).

Kept deliberately small; tests/test_parity.py checks it against the shared golden
vectors in web/src/core/golden.json so both implementations agree."""
from __future__ import annotations

import math

from .. import spot

G = 9.81
M_TO_FT = 3.28084


def rel_angle(a: float, b: float) -> float:
    return abs((a - b + 180.0) % 360.0 - 180.0)


def breaking_height(h: float, t: float, d: float, normal: float | None = None, site_factor: float | None = None) -> float:
    """Komar-Gaughan breaker height for one wave system, with a refraction
    factor sqrt(cos(theta)) for obliquity relative to the beach normal."""
    if h is None or t is None or d is None or h <= 0 or t <= 0:
        return 0.0
    normal = spot.BEACH_NORMAL if normal is None else normal
    sf = spot.SPOT["surf"]["siteFactor"] if site_factor is None else site_factor
    rel = rel_angle(d, normal)
    if rel >= 89.0:
        return 0.0
    h0 = h * math.sqrt(math.cos(math.radians(rel)))
    hb = 0.39 * G**0.2 * (t * h0 * h0) ** 0.4
    return hb * sf


def combine(parts: list[tuple[float, float, float]], **kw) -> tuple[float, float]:
    """Energy-sum of breaker heights for (h, t, dir) parts; returns (hb, dominant period)."""
    best_t, best_hb, e = 0.0, -1.0, 0.0
    for h, t, d in parts:
        hb = breaking_height(h, t, d, **kw)
        e += hb * hb
        if hb > best_hb:
            best_hb, best_t = hb, t
    return math.sqrt(e), best_t


def face_ft(hb: float) -> tuple[float, float]:
    s = spot.SPOT["surf"]
    return hb * M_TO_FT * s["faceLo"], hb * M_TO_FT * s["faceHi"]
