"""Cyclone formation outlook from global ensembles (ECMWF ENS 51 + GFS ENS 31).

For every member and 6-hourly step, the Bay of Bengal pressure field on a coarse
grid is scanned for a cyclone-like low (a pressure minimum well below the
domain median with strong winds nearby, over water). Each member's low is then
run through the cyclone swell model to estimate the swell it would send to
Serenity Beach, giving 'chance of cyclone swell >= 4 ft in the next 15 days'.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone

import numpy as np

from .. import spot
from ..fetch import openmeteo as om
from ..util import bearing_deg, haversine_km, log
from . import cyclone_model as cm
from . import geo, surfmodel

LATS = [5.0, 8.0, 11.0, 14.0, 17.0, 20.0]
LONS = [80.0, 83.0, 86.0, 89.0, 92.0, 95.0, 98.0]
MODELS = {"ecmwf_ifs025": "ECMWF ENS", "gfs_seamless": "GFS ENS"}
ANOM_HPA = -5.0
WIND_KT = 22.0


def _grid():
    pts = [(la, lo) for la in LATS for lo in LONS]
    sea = [not geo.on_land(la, lo) for la, lo in pts]
    return pts, np.array(sea)


def _fetch(model: str, pts):
    lats = [p[0] for p in pts]
    lons = [p[1] for p in pts]
    blocks = om.fetch_points(
        om.ENSEMBLE(), lats, lons, ["pressure_msl", "wind_speed_10m"],
        {"models": model, "forecast_days": 15, "temporal_resolution": "hourly_6", "wind_speed_unit": "kn"},
        batch=50,
    )
    times = np.asarray(blocks[0]["hourly"]["time"], dtype="int64")
    keys_p = sorted(k for k in blocks[0]["hourly"] if k.startswith("pressure_msl"))
    keys_w = sorted(k for k in blocks[0]["hourly"] if k.startswith("wind_speed_10m"))
    nm, nt, npnt = len(keys_p), len(times), len(pts)
    P = np.full((nm, nt, npnt), np.nan)
    W = np.full((nm, nt, npnt), np.nan)
    for j, b in enumerate(blocks):
        h = b["hourly"]
        for i, (kp, kw) in enumerate(zip(keys_p, keys_w)):
            P[i, :, j] = np.asarray([np.nan if x is None else x for x in h[kp]], dtype=float)
            W[i, :, j] = np.asarray([np.nan if x is None else x for x in h[kw]], dtype=float)
    return times, P, W


def _intensity(anom: float, wind: float) -> float:
    """Rough 1-min max wind (kt) for a model low; coarse ensembles under-do TC winds."""
    from_p = 25.0 + 3.0 * max(0.0, -anom - 5.0)
    return float(np.clip(max(1.25 * wind, from_p), 25.0, 110.0))


def scan(params: dict, shadow: "cm.ShadowGrid") -> dict:
    pts, sea = _grid()
    plat = np.array([p[0] for p in pts])
    plon = np.array([p[1] for p in pts])
    # neighbours within one grid step for the wind check
    nb = [np.where((np.abs(plat - la) <= 3.01) & (np.abs(plon - lo) <= 3.01))[0] for la, lo in pts]
    out = {"issued": datetime.now(timezone.utc).isoformat(), "grid": {"lats": LATS, "lons": LONS}, "models": []}
    all_members = []
    for model, label in MODELS.items():
        try:
            times, P, W = _fetch(model, pts)
        except Exception as ex:
            log.warning("genesis: %s failed: %s", model, ex)
            continue
        nm, nt, _ = P.shape
        density = np.zeros(len(pts))
        day_any = np.zeros((nm, 15), dtype=bool)
        day_zone = np.zeros((nm, 15), dtype=bool)
        members = []
        for m in range(nm):
            track = []
            for t in range(nt):
                p = P[m, t]
                if np.all(np.isnan(p)):
                    continue
                med = np.nanmedian(p)
                pp = np.where(sea, p, np.nan)
                if np.all(np.isnan(pp)):
                    continue
                j = int(np.nanargmin(pp))
                anom = float(pp[j] - med)
                wmax = float(np.nanmax(W[m, t, nb[j]]))
                if anom <= ANOM_HPA and wmax >= WIND_KT:
                    la, lo = pts[j]
                    d = float(haversine_km(spot.LAT, spot.LON, la, lo))
                    blocked = shadow.blocked(la, lo)
                    track.append({"t": int(times[t]), "lat": la, "lon": lo, "anom": round(anom, 1), "wind": round(wmax), "dist": round(d), "blocked": blocked})
                    density[j] += 1
                    di = int((times[t] - times[0]) // 86400)
                    if di < 15:
                        day_any[m, di] = True
                        if d <= 1500 and not blocked:
                            day_zone[m, di] = True
            # swell estimate for the member's low track
            best_face, arrival = 0.0, None
            for k, pt in enumerate(track):
                v = _intensity(pt["anom"], pt["wind"])
                vms = v * 0.5144 * params["windTo10min"]
                hs_gen, tp_gen = cm.young(np.array([vms]), np.array([params["defaults"]["speedKt"] * 0.5144]), np.array([params["defaults"]["rmwKm"]]))
                dkm = max(pt["dist"], params["R0km"])
                align = 0.0
                if k + 1 < len(track):
                    hdg = float(bearing_deg(pt["lat"], pt["lon"], track[k + 1]["lat"], track[k + 1]["lon"]))
                    to_spot = (float(bearing_deg(spot.LAT, spot.LON, pt["lat"], pt["lon"])) + 180) % 360
                    align = math.cos(math.radians(abs((hdg - to_spot + 180) % 360 - 180)))
                h = params["c"] * float(hs_gen[0]) * (params["R0km"] / dkm) ** params["a"] * (1 + params["k"] * align)
                if pt["blocked"]:
                    h *= params["blockedFactor"]
                tp = float(tp_gen[0]) * params.get("tpScale", 0.8)
                brg = float(bearing_deg(spot.LAT, spot.LON, pt["lat"], pt["lon"]))
                hb = surfmodel.breaking_height(h, tp, brg)
                face = (hb * surfmodel.M_TO_FT * (spot.SPOT["surf"]["faceLo"] + spot.SPOT["surf"]["faceHi"]) / 2)
                if face > best_face:
                    best_face = face
                    cg = 9.81 * tp / (4 * math.pi)
                    arrival = int(pt["t"] + pt["dist"] * 1000 / cg)
                pt["v"] = round(v)
            members.append({"member": m, "track": track, "maxFaceFt": round(best_face, 1), "arrival": arrival})
        nsteps = nm * nt
        out["models"].append({
            "model": model, "label": label, "members": nm, "start": int(times[0]),
            "pAnyByDay": np.round(day_any.mean(axis=0) * 100, 1).tolist(),
            "pZoneByDay": np.round(day_zone.mean(axis=0) * 100, 1).tolist(),
            "pAny15d": round(float(day_any.any(axis=1).mean() * 100), 1),
            "pZone15d": round(float(day_zone.any(axis=1).mean() * 100), 1),
            "density": np.round(density / max(nsteps, 1) * 100 * len(LATS), 2).tolist(),
            "pSwell4ft": round(float(np.mean([mm["maxFaceFt"] >= 4 for mm in members]) * 100), 1),
            "pSwell6ft": round(float(np.mean([mm["maxFaceFt"] >= 6 for mm in members]) * 100), 1),
            "tracks": [mm for mm in members if mm["track"]],
        })
        all_members.extend(members)
    if all_members:
        faces = np.array([m["maxFaceFt"] for m in all_members])
        out["combined"] = {
            "members": int(len(all_members)),
            "pSwell4ft": round(float((faces >= 4).mean() * 100), 1),
            "pSwell6ft": round(float((faces >= 6).mean() * 100), 1),
            "pAny15d": round(float(np.mean([bool(m["track"]) for m in all_members]) * 100), 1),
            "arrivals4ft": sorted(int(m["arrival"]) for m in all_members if m["maxFaceFt"] >= 4 and m["arrival"]),
        }
    out["method"] = {"anomHpa": ANOM_HPA, "windKt": WIND_KT, "gridDeg": 3,
                     "note": "Pressure minimum >=5 hPa below the Bay of Bengal median with >=22 kt winds nearby, over water."}
    return out
