"""Coastline and coastal structures (groynes, breakwaters, seawalls) around the
spot from OpenStreetMap (ODbL)."""
from __future__ import annotations

import json

from .. import spot
from ..spot import RAW
from ..util import age_hours, ensure_dir, http, log

MIRRORS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]


def load(radius_deg: float = 0.07, max_age_hours: float = 24 * 90) -> dict:
    p = RAW / "osm" / "coast.json"
    if p.exists() and age_hours(p) < max_age_hours:
        return json.loads(p.read_text(encoding="utf-8"))
    s, w, n, e = spot.LAT - radius_deg, spot.LON - radius_deg, spot.LAT + radius_deg, spot.LON + radius_deg
    q = (
        f"[out:json][timeout:90];("
        f'way["natural"="coastline"]({s},{w},{n},{e});'
        f'way["man_made"~"groyne|breakwater|pier|seawall"]({s},{w},{n},{e});'
        f'way["natural"="beach"]({s},{w},{n},{e});'
        f");out geom;"
    )
    last = None
    import requests  # plain session: the shared one retries 6x with backoff, too slow for flaky mirrors

    for url in MIRRORS:
        for _ in range(2):
            try:
                r = requests.post(url, data={"data": q}, timeout=(10, 75), headers={"User-Agent": http().headers["User-Agent"]})
                if r.status_code == 200 and r.text.strip().startswith("{"):
                    d = r.json()
                    if d.get("elements"):
                        gj = _to_geojson(d)
                        ensure_dir(p.parent)
                        p.write_text(json.dumps(gj), encoding="utf-8")
                        log.info("OSM: %d features", len(gj["features"]))
                        return gj
                last = f"{url} -> {r.status_code}"
            except Exception as ex:  # pragma: no cover - mirror flakiness
                last = f"{url} -> {ex}"
    if p.exists():
        log.warning("OSM refresh failed (%s); using cached copy", last)
        return json.loads(p.read_text(encoding="utf-8"))
    raise RuntimeError(f"OSM download failed: {last}")


def _to_geojson(d: dict) -> dict:
    feats = []
    for el in d["elements"]:
        g = el.get("geometry") or []
        if len(g) < 2:
            continue
        tags = el.get("tags", {})
        kind = tags.get("man_made") or tags.get("natural") or "other"
        coords = [[round(pt["lon"], 6), round(pt["lat"], 6)] for pt in g]
        closed = coords[0] == coords[-1] and len(coords) > 3
        geom = {"type": "Polygon", "coordinates": [coords]} if (closed and kind == "beach") else {"type": "LineString", "coordinates": coords}
        feats.append({"type": "Feature", "properties": {"kind": kind, "name": tags.get("name", ""), "osm_id": el["id"]}, "geometry": geom})
    return {"type": "FeatureCollection", "features": feats}
