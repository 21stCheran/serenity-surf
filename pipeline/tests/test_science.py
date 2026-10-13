"""Unit and integration tests for the data pipeline.

Run from the repo root:  python -m pytest pipeline/tests -q
Integration tests use cached products when present and are skipped otherwise.
"""
import json
import math

import numpy as np
import pandas as pd
import pytest

from pipeline import spot
from pipeline.export import PRODUCTS
from pipeline.fetch import ibtracs, indices
from pipeline.science import coastal, cyclone_model, harmonize, surfmodel, tides

GOLDEN = spot.ROOT / "web" / "src" / "core" / "golden.json"


# ------------------------------------------------------------------ parity with TypeScript

def test_surf_transform_matches_golden_vectors():
    g = json.loads(GOLDEN.read_text())
    for c in g["breaking"]:
        hb = surfmodel.breaking_height(c["h"], c["t"], c["d"])
        assert hb == pytest.approx(c["hb"], abs=1e-6)
        lo, hi = surfmodel.face_ft(hb)
        assert lo == pytest.approx(c["faceLo"], abs=1e-5)
        assert hi == pytest.approx(c["faceHi"], abs=1e-5)
    hb, tdom = surfmodel.combine([tuple(p) for p in g["combine"]["parts"]])
    assert hb == pytest.approx(g["combine"]["hb"], abs=1e-6)
    assert tdom == g["combine"]["tdom"]


def test_waves_from_land_do_not_break():
    assert surfmodel.breaking_height(2.0, 12, spot.OFFSHORE_FROM) == 0.0


# ------------------------------------------------------------------ physics

def test_young_hurricane_waves_are_sensible():
    hs, tp = cyclone_model.young(np.array([40.0]), np.array([5.0]), np.array([30.0]))
    assert 9 < hs[0] < 13
    assert 12 < tp[0] < 16
    weak_hs, _ = cyclone_model.young(np.array([15.0]), np.array([5.0]), np.array([60.0]))
    assert weak_hs[0] < hs[0]


def test_cerc_sign_convention_north_is_positive():
    # swell from the south-east (150 deg) pushes sand north along the 16 deg coast
    hb, ab = coastal.breaker(np.array([1.0]), np.array([10.0]), np.array([150.0]))
    assert coastal.cerc_m3_per_s(hb, ab)[0] > 0
    # north-east monsoon waves (60 deg) push it south
    hb, ab = coastal.breaker(np.array([1.0]), np.array([8.0]), np.array([60.0]))
    assert coastal.cerc_m3_per_s(hb, ab)[0] < 0
    # shore-normal waves: no drift
    hb, ab = coastal.breaker(np.array([1.0]), np.array([10.0]), np.array([spot.BEACH_NORMAL]))
    assert abs(coastal.cerc_m3_per_s(hb, ab)[0]) < 1e-9


def test_beach_state_thresholds():
    assert coastal.state_of(1.0) == "R"
    assert coastal.state_of(3.0) == "TBR"
    assert coastal.state_of(7.0) == "D"


def test_mjo_phase_octants():
    # RMM convention: phase 1 lower-left (west Africa), phase 5 upper-right (Maritime Continent)
    assert indices.mjo_phase(-1.0, -0.3) == 1
    assert indices.mjo_phase(1.0, -0.3) == 4
    assert indices.mjo_phase(1.0, 0.3) == 5
    assert indices.mjo_phase(-1.0, 0.3) == 8


def test_imd_grades():
    assert ibtracs.imd_grade(25) == "D"
    assert ibtracs.imd_grade(40) == "CS"
    assert ibtracs.imd_grade(70) == "VSCS"
    assert ibtracs.imd_grade(130) == "SuCS"


def test_best_wind_prefers_jtwc_and_scales_imd():
    df = pd.DataFrame({"USA_WIND": [60.0, np.nan], "NEWDELHI_WIND": [50.0, 50.0], "WMO_WIND": [np.nan, np.nan]})
    w = ibtracs.best_wind_kt(df)
    assert w.iloc[0] == 60
    assert w.iloc[1] == pytest.approx(55.0)


def test_quantile_mapping_recovers_a_scale_bias():
    idx = pd.date_range("2022-01-01", periods=24 * 365 * 2, freq="h", tz="UTC")
    rng = np.random.default_rng(1)
    truth = pd.Series(rng.gamma(4, 0.2, len(idx)), index=idx)
    biased = truth * 1.15
    maps = harmonize.fit_monthly_qmap(biased, truth)
    mapped = harmonize.apply_monthly_qmap(biased, maps)
    assert abs(mapped.median() - truth.median()) < 0.01
    assert abs(np.quantile(mapped, 0.99) - np.quantile(truth, 0.99)) < 0.05


def test_tidal_fit_recovers_m2_and_s2():
    idx = pd.date_range("2023-01-01", periods=24 * 400, freq="h", tz="UTC")
    hours = (idx - idx[0]) / pd.Timedelta(hours=1)
    sl = 0.3 * np.cos(2 * np.pi * hours / 12.4206012 + 0.5) + 0.1 * np.cos(2 * np.pi * hours / 12.0 + 1.0) + 0.45
    coef = tides.fit(pd.Series(sl, index=idx), 12.0)
    amp = dict(zip(coef.name, coef.A))
    assert amp["M2"] == pytest.approx(0.3, abs=0.01)
    assert amp["S2"] == pytest.approx(0.1, abs=0.01)


def test_shadow_grid_blocks_sri_lanka_and_arabian_sea():
    p = spot.RAW / "geo" / "shadow.json"
    if not p.exists():
        pytest.skip("shadow grid not built yet")
    g = cyclone_model.ShadowGrid.from_json(json.loads(p.read_text()))
    assert g.blocked(5.5, 81.0)  # south of Sri Lanka
    assert g.blocked(12.0, 70.0)  # Arabian Sea
    assert not g.blocked(14.0, 87.0)  # open Bay of Bengal
    assert not g.blocked(16.0, 82.5)  # off Andhra


# ------------------------------------------------------------------ integration (cached products)

def _storms():
    p = PRODUCTS / "storms.json"
    if not p.exists():
        pytest.skip("storm archive not built yet")
    return json.loads(p.read_text())["storms"]


@pytest.mark.parametrize("name,date", [("Nivar", "2020-11-25"), ("Mandous", "2022-12-09"), ("Fengal", "2024-11-28")])
def test_known_cyclones_are_attributed(name, date):
    st = [s for s in _storms() if s["name"].lower() == name.lower()]
    assert st, f"{name} missing from the archive"
    r = st[0]["response"]
    gain = r.get("attributedHs", r["peakHs"]) - r["baseHs"]
    assert gain >= 0.5, f"{name} should have raised the swell (gain {gain:.2f} m)"
    peak = pd.Timestamp(r["peakTime"], unit="s")
    assert abs((peak - pd.Timestamp(date)).days) <= 3


def test_cyclone_model_beats_background_in_cross_validation():
    p = PRODUCTS / "cyclone-model.json"
    if not p.exists():
        pytest.skip("cyclone model not built yet")
    m = json.loads(p.read_text())["metrics"]
    assert m["cv"] == "leave-one-storm-out"
    assert m["mae_m"] < m["mae_background_only_m"]
    assert m["skill_vs_background"] > 0.2


def test_tide_hold_out_error_under_8cm():
    p = PRODUCTS / "tides.json"
    if not p.exists():
        pytest.skip("tides not built yet")
    v = json.loads(p.read_text())["validation"]
    assert v["rmse_m"] < 0.08
    assert v["explained_var"] > 0.85


def test_history_files_cover_the_decade():
    files = sorted((PRODUCTS / "history").glob("hourly-*.json"))
    if not files:
        pytest.skip("history not built yet")
    years = [int(f.stem.split("-")[1]) for f in files]
    assert years[0] == 2015 and len(years) >= 11
    doc = json.loads(files[0].read_text())
    hs = [x for x in doc["cols"]["hs"] if x is not None]
    assert len(hs) > 8000 and math.isclose(doc["dt"], 3600)
