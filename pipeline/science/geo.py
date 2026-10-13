"""Land polygons for the Bay of Bengal region (Natural Earth 50 m) and the
great-circle land-crossing test used for swell shadowing (Sri Lanka, India)."""
from __future__ import annotations

import json
from functools import lru_cache

import numpy as np
from shapely.geometry import box, mapping, shape
from shapely.ops import unary_union
from shapely.prepared import prep

from ..spot import RAW
from ..util import age_hours, ensure_dir, get_bytes, log

NE_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson"
REGION = (60.0, -10.0, 110.0, 32.0)  # lon_min, lat_min, lon_max, lat_max


@lru_cache(maxsize=1)
def land_region():
    p = RAW / "geo" / "ne_50m_land.geojson"
    if not p.exists() or age_hours(p) > 24 * 365:
        log.info("downloading Natural Earth land")
        ensure_dir(p.parent)
        p.write_bytes(get_bytes(NE_URL))
    gj = json.loads(p.read_text(encoding="utf-8"))
    clip = box(*REGION)
    geoms = []
    for f in gj["features"]:
        g = shape(f["geometry"])
        if g.intersects(clip):
            geoms.append(g.intersection(clip))
    return unary_union(geoms)


@lru_cache(maxsize=1)
def _prepared():
    return prep(land_region())


def simplified_geojson(tol: float = 0.04) -> dict:
    g = land_region().simplify(tol, preserve_topology=True)
    return mapping(g)


def gc_points(lat1, lon1, lat2, lon2, step_km: float = 20.0):
    """Points along the great circle from 1 to 2."""
    p1 = np.radians([lat1, lon1])
    p2 = np.radians([lat2, lon2])
    v1 = np.array([np.cos(p1[0]) * np.cos(p1[1]), np.cos(p1[0]) * np.sin(p1[1]), np.sin(p1[0])])
    v2 = np.array([np.cos(p2[0]) * np.cos(p2[1]), np.cos(p2[0]) * np.sin(p2[1]), np.sin(p2[0])])
    omega = np.arccos(np.clip(np.dot(v1, v2), -1, 1))
    dist = omega * 6371.0
    n = max(2, int(dist / step_km) + 1)
    if omega < 1e-9:
        return np.array([lat1]), np.array([lon1]), np.array([0.0])
    f = np.linspace(0, 1, n)
    a = np.sin((1 - f) * omega) / np.sin(omega)
    b = np.sin(f * omega) / np.sin(omega)
    v = a[:, None] * v1 + b[:, None] * v2
    lat = np.degrees(np.arctan2(v[:, 2], np.hypot(v[:, 0], v[:, 1])))
    lon = np.degrees(np.arctan2(v[:, 1], v[:, 0]))
    return lat, lon, f * dist


def path_blocked(src_lat, src_lon, dst_lat, dst_lon, skip_src_km: float = 40.0, skip_dst_km: float = 25.0) -> bool:
    """True when the great-circle path from the storm to the spot crosses land,
    ignoring the stretches next to each end (storm over the coast, spot on the coast)."""
    import shapely

    lat, lon, d = gc_points(src_lat, src_lon, dst_lat, dst_lon)
    total = d[-1]
    sel = (d >= skip_src_km) & (d <= total - skip_dst_km)
    if not sel.any():
        return False
    return bool(shapely.contains_xy(_land_prepared_geom(), lon[sel], lat[sel]).any())


@lru_cache(maxsize=1)
def _land_prepared_geom():
    import shapely

    g = land_region()
    shapely.prepare(g)
    return g


def on_land(lat: float, lon: float) -> bool:
    import shapely

    return bool(shapely.contains_xy(_land_prepared_geom(), lon, lat))
