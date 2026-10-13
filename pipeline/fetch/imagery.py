"""Satellite imagery catalogue for the beach: distinct Esri World Imagery Wayback
captures (de-duplicated by tile content) and the EOX Sentinel-2 yearly mosaics."""
from __future__ import annotations

import hashlib
import json
import math
import re

from .. import spot
from ..spot import RAW
from ..util import age_hours, ensure_dir, get_json, http, log

WAYBACK_CONFIG = "https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json"
EOX_YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]


def tile_xy(lat: float, lon: float, z: int) -> tuple[int, int]:
    n = 2**z
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


def _capture_meta(meta_url: str) -> dict:
    for layer in (3, 4, 5, 6, 7, 8):
        try:
            d = get_json(
                f"{meta_url}/{layer}/query",
                {"geometry": f"{spot.LON},{spot.LAT}", "geometryType": "esriGeometryPoint", "inSR": 4326,
                 "spatialRel": "esriSpatialRelIntersects", "outFields": "SRC_DATE2,SRC_RES,SRC_DESC,NICE_DESC",
                 "returnGeometry": "false", "f": "json"},
                timeout=60,
            )
        except Exception:
            continue
        feats = d.get("features") or []
        if feats:
            a = feats[0]["attributes"]
            date = a.get("SRC_DATE2")
            return {
                "captured": int(date / 1000) if isinstance(date, (int, float)) else None,
                "resolution_m": a.get("SRC_RES"),
                "provider": a.get("NICE_DESC") or a.get("SRC_DESC"),
            }
    return {}


def wayback(z: int = 17, max_age_hours: float = 24 * 30) -> list[dict]:
    p = RAW / "imagery" / "wayback.json"
    if p.exists() and age_hours(p) < max_age_hours:
        return json.loads(p.read_text(encoding="utf-8"))
    cfg = get_json(WAYBACK_CONFIG)
    rels = []
    for rid, r in cfg.items():
        m = re.search(r"(\d{4}-\d{2}-\d{2})", r.get("itemTitle", ""))
        if m:
            rels.append((m.group(1), int(rid), r))
    rels.sort()
    x, y = tile_xy(spot.LAT, spot.LON, z)
    out, last_hash = [], None
    log.info("Wayback: scanning %d releases at z%d", len(rels), z)
    for date, rid, r in rels:
        url = r["itemURL"].replace("{level}", str(z)).replace("{row}", str(y)).replace("{col}", str(x))
        try:
            resp = http().get(url, timeout=60)
            if resp.status_code != 200 or len(resp.content) < 2000:
                continue
            h = hashlib.sha1(resp.content).hexdigest()
        except Exception:
            continue
        if h == last_hash:
            continue
        last_hash = h
        meta = _capture_meta(r["metadataLayerUrl"])
        out.append({"release": rid, "releaseDate": date, "title": r["itemTitle"], **meta})
    # drop releases that only re-published an image with the same capture date
    seen, distinct = set(), []
    for o in out:
        key = o.get("captured") or o["releaseDate"]
        if key in seen:
            continue
        seen.add(key)
        distinct.append(o)
    ensure_dir(p.parent)
    p.write_text(json.dumps(distinct), encoding="utf-8")
    log.info("Wayback: %d distinct captures", len(distinct))
    return distinct


def catalogue() -> dict:
    try:
        wb = wayback()
    except Exception as ex:  # pragma: no cover
        log.warning("Wayback scan failed: %s", ex)
        wb = []
    return {
        "wayback": wb,
        "waybackTemplate": "https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/{release}/{z}/{y}/{x}",
        "eox": [{"year": y, "template": f"https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-{y}_3857/default/g/{{z}}/{{y}}/{{x}}.jpg"} for y in EOX_YEARS],
        "attribution": {
            "wayback": "Esri, Maxar, Earthstar Geographics, and the GIS User Community (World Imagery Wayback)",
            "eox": "Sentinel-2 cloudless by EOX IT Services GmbH (contains modified Copernicus Sentinel data), CC BY-NC-SA 4.0",
        },
    }
