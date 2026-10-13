"""NOAA CPC Global Tropics Hazards outlook: week-2 and week-3 probability of
tropical cyclone formation (KML polygons, issued Tuesdays)."""
from __future__ import annotations

import html
import re

from ..util import get_text, log

BASE = "https://www.cpc.ncep.noaa.gov/products/precip/CWlink/ghaz/kmzs"
UA = {"User-Agent": "Mozilla/5.0 (serenity-surf)"}
REGION = (40.0, -15.0, 115.0, 32.0)


def _ring(txt: str) -> list[list[float]]:
    pts = []
    for p in txt.split():
        x, y, *_ = p.split(",")
        pts.append([round(float(x), 3), round(float(y), 3)])
    return pts


def _in_region(rings) -> bool:
    lo0, la0, lo1, la1 = REGION
    for r in rings:
        for x, y in r:
            if lo0 <= x <= lo1 and la0 <= y <= la1:
                return True
    return False


def week(n: int) -> dict:
    x = get_text(f"{BASE}/W{n}_TC.kml", headers=UA)
    title = re.search(r"<name>(.*?)</name>", x, re.S)
    title = html.unescape(title.group(1)) if title else ""
    issued = re.search(r"Issued:\s*([0-9/]+)", title)
    valid = re.search(r"Valid:\s*([0-9/]+)\s*-\s*([0-9/]+)", title)
    feats = []
    for m in re.finditer(r"<Placemark.*?</Placemark>", x, re.S):
        pm = m.group(0)
        cells = [re.sub("<[^>]+>", "", html.unescape(c)).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", pm, re.S)]
        prob = None
        for i, c in enumerate(cells[:-1]):
            if c.lower() == "prob":
                try:
                    prob = int(float(cells[i + 1]))
                except ValueError:
                    pass
        polys = []
        for poly in re.findall(r"<Polygon>(.*?)</Polygon>", pm, re.S):
            outer = re.search(r"<outerBoundaryIs>.*?<coordinates>(.*?)</coordinates>", poly, re.S)
            inners = re.findall(r"<innerBoundaryIs>.*?<coordinates>(.*?)</coordinates>", poly, re.S)
            if outer:
                polys.append([_ring(outer.group(1))] + [_ring(t) for t in inners])
        polys = [p for p in polys if _in_region(p)]
        if polys and prob is not None:
            feats.append({"type": "Feature", "properties": {"prob": prob, "week": n},
                          "geometry": {"type": "MultiPolygon", "coordinates": polys}})
    log.info("CPC week-%d: %d regional polygons", n, len(feats))
    return {
        "week": n,
        "title": title,
        "issued": issued.group(1) if issued else None,
        "validFrom": valid.group(1) if valid else None,
        "validTo": valid.group(2) if valid else None,
        "features": feats,
    }


def load() -> dict:
    out = {"source": "NOAA CPC Global Tropics Hazards Outlook", "weeks": []}
    for n in (2, 3):
        try:
            out["weeks"].append(week(n))
        except Exception as ex:  # week 3 is experimental and sometimes missing
            log.warning("CPC week-%d unavailable: %s", n, ex)
    return out
