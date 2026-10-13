"""Build every data product for the web app.

    python -m pipeline.build            # refresh whatever is stale (CI default)
    python -m pipeline.build --full     # rebuild everything, ignoring freshness
    python -m pipeline.build --only genesis,field

Each product is cached under pipeline/cache/products with its own refresh
interval, then copied to web/public/data.
"""
from __future__ import annotations

import argparse
import json
import time
import traceback
from datetime import datetime, timezone

import pandas as pd

from . import export, spot
from .export import product
from .fetch import cpc_gth, ibtracs, imagery, indices, metar, osm
from .science import climatology, coastal, cyclone_model, genesis, geo, history, storms, swell_field
from .util import age_hours, log, write_json

# product -> max age in hours before it is rebuilt
MAX_AGE = {
    "storms": 24 * 7,
    "indices": 20,
    "metar": 24 * 7,
    "climatology": 20,
    "coastal": 20,
    "osm": 24 * 90,
    "imagery": 24 * 30,
    "cpc": 12,
    "genesis": 11,
    "field": 5,
    "replays": 24 * 180,
}
FILES = {
    "storms": "cyclone-model.json",
    "indices": "indices.json",
    "metar": "metar.json",
    "climatology": "climatology.json",
    "coastal": "coastal.json",
    "osm": "osm.json",
    "imagery": "imagery.json",
    "cpc": "cpc.json",
    "genesis": "genesis.json",
    "field": "field.json",
    "replays": "replays/index.json",
}


class Build:
    def __init__(self, full: bool, only: set[str] | None, cv: bool):
        self.full, self.only, self.cv = full, only, cv
        self.status: dict[str, dict] = {}
        self.dec = self.long = self.extra = None
        self._storms = None
        self._tracks = None
        self._shadow = None
        self._romi = self._oni = self._metar = None

    def due(self, name: str) -> bool:
        if self.only is not None:
            return name in self.only  # --only forces the named products
        if self.full:
            return True
        return age_hours(product(FILES[name])) > MAX_AGE[name]

    def run(self, name: str, fn) -> None:
        if not self.due(name):
            self.status[name] = {"status": "fresh", "ageHours": round(age_hours(product(FILES[name])), 1)}
            return
        t = time.time()
        try:
            fn()
            self.status[name] = {"status": "built", "seconds": round(time.time() - t, 1)}
            log.info("built %s in %.1fs", name, time.time() - t)
        except Exception as ex:  # keep going: a stale product beats a failed build
            log.error("FAILED %s: %s", name, ex)
            traceback.print_exc()
            self.status[name] = {"status": "failed", "error": str(ex)[:300]}

    # ------------------------------------------------------------------ data
    def history(self):
        raw = history.download(long=True)
        self.dec, self.long, self.extra = history.assemble(raw)
        files = export.history_years(self.dec)
        write_json(self.extra["tide"], product("tides.json"))
        self.status["history"] = {"status": "built", "files": len(files)}
        return files

    def shadow(self):
        if self._shadow is None:
            p = spot.RAW / "geo" / "shadow.json"
            if p.exists():
                self._shadow = cyclone_model.ShadowGrid.from_json(json.loads(p.read_text()))
            else:
                self._shadow = cyclone_model.ShadowGrid().compute()
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(json.dumps(self._shadow.to_json()))
        return self._shadow

    def storms_list(self):
        if self._storms is None:
            p = product("storms.json")
            if p.exists():
                self._storms = json.loads(p.read_text(encoding="utf-8"))["storms"]
        return self._storms

    def t_storms(self):
        tr = ibtracs.load()
        st, trk = storms.build(tr, self.long)
        model = cyclone_model.fit(st, trk, self.shadow(), self.long, cv=self.cv)
        model["shadow"] = self.shadow().to_json()
        model["land"] = geo.simplified_geojson(0.05)
        series = storms.series_for(st, self.dec, self.long)
        write_json({"generated": now(), "count": len(st), "storms": st}, product("storms.json"))
        write_json(series, product("storm-series.json"))
        write_json(model, product("cyclone-model.json"))
        self._storms = st

    def t_indices(self):
        self._oni = indices.oni()
        dmi = indices.dmi()
        self._romi = indices.romi()
        r = self._romi[self._romi["date"] >= pd.Timestamp("1980-01-01")]
        write_json({
            "oni": {"year": self._oni["year"].tolist(), "season": self._oni["season"].tolist(), "anom": self._oni["anom"].round(2).tolist()},
            "dmi": {"year": dmi["year"].tolist(), "month": dmi["month"].tolist(), "dmi": dmi["dmi"].round(3).tolist()},
            "romi": {"t0": r["date"].iloc[0].strftime("%Y-%m-%d"), "x": r["x"].round(2).tolist(), "y": r["y"].round(2).tolist(),
                     "amp": r["amp"].round(2).tolist(), "phase": r["phase"].tolist(), "last": r["date"].iloc[-1].strftime("%Y-%m-%d")},
        }, product("indices.json"))

    def t_metar(self):
        m = metar.load("VOPC")
        self._metar = m
        write_json({"station": "VOPC", "name": "Puducherry Airport", "t": [int(t.timestamp()) for t in m.index],
                    "dir": [None if pd.isna(x) else int(x) for x in m["drct"]], "kt": [None if pd.isna(x) else int(x) for x in m["sknt"]]},
                   product("metar.json"))

    def t_climatology(self):
        if self._romi is None:
            try:
                self._romi, self._oni = indices.romi(), indices.oni()
            except Exception as ex:
                log.warning("indices unavailable for climatology: %s", ex)
        if self._metar is None:
            try:
                self._metar = metar.load("VOPC")
            except Exception as ex:
                log.warning("METAR unavailable: %s", ex)
        st = self.storms_list() or []
        write_json(climatology.build(self.dec, self.long, st, self._romi, self._oni, self._metar), product("climatology.json"))

    def t_coastal(self):
        write_json(coastal.build(self.dec), product("coastal.json"))

    def t_osm(self):
        write_json(osm.load(), product("osm.json"))

    def t_imagery(self):
        write_json(imagery.catalogue(), product("imagery.json"))

    def t_cpc(self):
        write_json(cpc_gth.load(), product("cpc.json"))

    def t_genesis(self):
        model = json.loads(product("cyclone-model.json").read_text())
        write_json(genesis.scan(model["params"], self.shadow()), product("genesis.json"))

    def t_field(self):
        write_json(swell_field.forecast(), product("field.json"))

    def t_replays(self):
        st = self.storms_list() or []
        idx = []
        for sid, name, t0, t1 in swell_field.replay_windows(st):
            p = product(f"replays/{sid}.json")
            if not p.exists() or self.full:
                d = swell_field.replay(t0, t1)
                d.update({"sid": sid, "name": name})
                write_json(d, p)
            idx.append({"sid": sid, "name": name, "start": t0.isoformat(), "end": t1.isoformat(), "file": f"replays/{sid}.json"})
        write_json(idx, product("replays/index.json"))


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", action="store_true")
    ap.add_argument("--only", default="")
    ap.add_argument("--no-cv", action="store_true", help="skip leave-one-storm-out CV (faster)")
    a = ap.parse_args(argv)
    only = set(x for x in a.only.split(",") if x) or None
    b = Build(a.full, only, cv=not a.no_cv)
    t = time.time()

    files = b.history()
    b.run("storms", b.t_storms)
    b.run("indices", b.t_indices)
    b.run("metar", b.t_metar)
    b.run("climatology", b.t_climatology)
    b.run("coastal", b.t_coastal)
    b.run("osm", b.t_osm)
    b.run("imagery", b.t_imagery)
    b.run("cpc", b.t_cpc)
    b.run("genesis", b.t_genesis)
    b.run("field", b.t_field)
    b.run("replays", b.t_replays)

    meta = {
        "generated": now(),
        "spot": spot.SPOT,
        "history": {"files": files, **b.extra["meta"]["coverage"]},
        "harmonization": b.extra["meta"]["harmonization"],
        "periodRatios": b.extra["meta"]["period_ratios"],
        "forecastCalibration": b.extra["meta"]["forecastCalibration"],
        "grids": b.extra["meta"]["grids"],
        "tide": b.extra["meta"]["tide"],
        "build": b.status,
        "products": {k: {"file": v, "ageHours": round(age_hours(product(v)), 2)} for k, v in FILES.items() if product(v).exists()},
    }
    write_json(meta, product("meta.json"))
    copied = export.publish()
    log.info("published %d files to %s in %.0fs", len(copied), spot.OUT, time.time() - t)
    failed = [k for k, v in b.status.items() if v.get("status") == "failed"]
    if failed:
        log.warning("failed products: %s", failed)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
