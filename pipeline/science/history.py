"""Download and assemble the hourly history at Serenity Beach.

Two products:
- `decade`: 2015 -> now, every field the dashboard shows (waves, swell partitions,
  wind, rain, pressure, temperature, SST, sea level, tide).
- `long`:   1980 -> now, waves + wind + rain only, for cyclone statistics and
  long-term climatology.
"""
from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd

from .. import spot
from ..fetch import openmeteo as om
from ..util import angdiff, log
from . import harmonize, tides

WAVE_VARS_ERA5 = ["wave_height", "wave_direction", "wave_period", "wave_peak_period"]
WAVE_VARS_MFWAM = [
    "wave_height", "wave_direction", "wave_period",
    "wind_wave_height", "wind_wave_direction", "wind_wave_period",
    "swell_wave_height", "swell_wave_direction", "swell_wave_period",
    "secondary_swell_wave_height", "secondary_swell_wave_direction", "secondary_swell_wave_period",
]
WAVE_VARS_ECWAM = ["wave_height", "wave_direction", "wave_period", "wave_peak_period"]
OCEAN_VARS = ["sea_level_height_msl", "sea_surface_temperature", "ocean_current_velocity", "ocean_current_direction"]
WX_VARS = [
    "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m", "precipitation",
    "pressure_msl", "temperature_2m", "cloud_cover", "weather_code",
]
WX_VARS_LONG = ["wind_speed_10m", "wind_direction_10m", "precipitation", "pressure_msl"]

WAVE_VARS_GFS = [
    "wave_height", "wave_direction", "wave_period",
    "swell_wave_height", "swell_wave_direction", "swell_wave_period",
    "wind_wave_height", "wind_wave_direction", "wind_wave_period",
]

MFWAM_START = date(2021, 10, 1)
ECWAM_START = date(2024, 3, 1)
ECWAM9_START = date(2025, 11, 15)
GFSW_START = date(2024, 10, 1)
SMOC_START = date(2022, 11, 1)
IFS_START = date(2017, 1, 1)


def download(long: bool = True) -> dict[str, pd.DataFrame]:
    end = om.today_utc()
    wlat, wlon = spot.WAVE_POINT
    alat, alon = spot.WIND_POINT
    long_start = date.fromisoformat(spot.LONG_HISTORY_START if long else spot.HISTORY_START)
    d: dict[str, pd.DataFrame] = {}
    d["era5_waves"] = om.fetch_years("era5_waves", om.MARINE(), wlat, wlon, long_start, end, WAVE_VARS_ERA5, "era5_ocean")
    d["mfwam"] = om.fetch_years("mfwam", om.MARINE(), wlat, wlon, MFWAM_START, end, WAVE_VARS_MFWAM, "meteofrance_wave")
    d["ecwam"] = om.fetch_years("ecwam", om.MARINE(), wlat, wlon, ECWAM_START, end, WAVE_VARS_ECWAM, "ecmwf_wam025")
    d["ecwam9"] = om.fetch_years("ecwam9", om.MARINE(), wlat, wlon, ECWAM9_START, end, WAVE_VARS_ECWAM, "ecmwf_wam")
    d["gfswave"] = om.fetch_years("gfswave", om.MARINE(), wlat, wlon, GFSW_START, end, WAVE_VARS_GFS, "ncep_gfswave016")
    d["ocean"] = om.fetch_years("ocean", om.MARINE(), wlat, wlon, SMOC_START, end, OCEAN_VARS, None)
    d["ifs"] = om.fetch_years("ifs", om.ARCHIVE(), alat, alon, IFS_START, end, WX_VARS, "ecmwf_ifs")
    d["era5_wx"] = om.fetch_years("era5_wx", om.ARCHIVE(), alat, alon, long_start, end, WX_VARS_LONG, "era5")
    for k, v in d.items():
        log.info("%-10s %7d rows %s..%s grid=%s", k, len(v), v.index.min(), v.index.max(), v.attrs.get("grid"))
    return d


def _ratio_fit(num: pd.Series, den: pd.Series) -> float:
    both = pd.concat([num.rename("n"), den.rename("d")], axis=1).dropna()
    both = both[(both["d"] > 1) & (both["n"] > 1)]
    if len(both) < 100:
        return float("nan")
    return float(np.median(both["n"] / both["d"]))


def assemble(raw: dict[str, pd.DataFrame]) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    era = raw["era5_waves"].rename(columns={"wave_height": "hs", "wave_direction": "dir", "wave_period": "tm", "wave_peak_period": "tp"})
    mf = raw["mfwam"]
    ec = raw["ecwam"]
    ifs = raw["ifs"]
    e5w = raw["era5_wx"]
    ocean = raw["ocean"]
    meta: dict = {"harmonization": {}}

    # ---- waves: map ERA5 Hs onto the MFWAM climate (8 km, partitions) ----
    hs_maps = harmonize.fit_monthly_qmap(era["hs"], mf["wave_height"])
    hs_mapped = harmonize.apply_monthly_qmap(era["hs"], hs_maps)
    meta["harmonization"]["hs_era5_to_mfwam"] = harmonize.qmap_summary(era["hs"], mf["wave_height"], hs_mapped)

    # peak period: ERA5 Tp until late 2024, then ECMWF WAM Tp mapped to ERA5's scale,
    # then MFWAM swell period scaled by the median Tp / swell-period ratio
    tp = era["tp"].copy()
    tp_maps = harmonize.fit_monthly_qmap(ec["wave_peak_period"], era["tp"])
    ec_tp = harmonize.apply_monthly_qmap(ec["wave_peak_period"], tp_maps) if tp_maps else ec["wave_peak_period"]
    r_mf = _ratio_fit(era["tp"], mf["swell_wave_period"])
    r_ec = _ratio_fit(ec["wave_peak_period"], mf["swell_wave_period"])
    meta["period_ratios"] = {"era5_tp_over_mfwam_swell_period": round(r_mf, 3), "ecwam_tp_over_mfwam_swell_period": round(r_ec, 3)}

    idx = pd.date_range(min(era.index.min(), mf.index.min()), max(era.index.max(), mf.index.max(), ifs.index.max()), freq="h", tz="UTC")
    w = pd.DataFrame(index=idx)
    w["hs"] = hs_mapped.reindex(idx)
    w["dir"] = era["dir"].reindex(idx)
    w["tm"] = era["tm"].reindex(idx)
    w["tp"] = tp.reindex(idx)
    # fill the ERA5 lag (last ~5 days) and the Tp gap
    mf_r = mf.reindex(idx)
    w["hs"] = w["hs"].fillna(mf_r["wave_height"])
    w["dir"] = w["dir"].fillna(mf_r["wave_direction"])
    w["tm"] = w["tm"].fillna(mf_r["wave_period"])
    w["tp"] = w["tp"].fillna(ec_tp.reindex(idx))
    if np.isfinite(r_mf):
        w["tp"] = w["tp"].fillna(mf_r["swell_wave_period"] * r_mf)
    w["src_wave"] = np.where(era["hs"].reindex(idx).notna(), 1, np.where(mf_r["wave_height"].notna(), 2, 0))

    # partitions (MFWAM era only)
    w["sw1h"] = mf_r["swell_wave_height"]
    w["sw1p"] = mf_r["swell_wave_period"]
    w["sw1d"] = mf_r["swell_wave_direction"]
    w["sw2h"] = mf_r["secondary_swell_wave_height"]
    w["sw2p"] = mf_r["secondary_swell_wave_period"]
    w["sw2d"] = mf_r["secondary_swell_wave_direction"]
    w["wwh"] = mf_r["wind_wave_height"]
    w["wwp"] = mf_r["wind_wave_period"]
    w["wwd"] = mf_r["wind_wave_direction"]

    # ---- wind & weather: IFS 9 km from 2017, ERA5 mapped onto IFS before that ----
    ws_maps = harmonize.fit_monthly_qmap(e5w["wind_speed_10m"], ifs["wind_speed_10m"])
    e5_ws = harmonize.apply_monthly_qmap(e5w["wind_speed_10m"], ws_maps)
    meta["harmonization"]["wind_era5_to_ifs"] = harmonize.qmap_summary(e5w["wind_speed_10m"], ifs["wind_speed_10m"], e5_ws)
    pr_maps = harmonize.fit_monthly_qmap(e5w["precipitation"], ifs["precipitation"])
    e5_pr = harmonize.apply_monthly_qmap(e5w["precipitation"], pr_maps).clip(lower=0)

    ifs_r = ifs.reindex(idx)
    w["ws"] = ifs_r["wind_speed_10m"].fillna(e5_ws.reindex(idx))
    w["wd"] = ifs_r["wind_direction_10m"].fillna(e5w["wind_direction_10m"].reindex(idx))
    w["wg"] = ifs_r["wind_gusts_10m"]
    w["pr"] = ifs_r["precipitation"].fillna(e5_pr.reindex(idx))
    w["msl"] = ifs_r["pressure_msl"].fillna(e5w["pressure_msl"].reindex(idx))
    w["t2"] = ifs_r["temperature_2m"]
    w["cc"] = ifs_r["cloud_cover"]
    w["wc"] = ifs_r["weather_code"]
    w["src_wind"] = np.where(ifs_r["wind_speed_10m"].notna(), 1, np.where(e5w["wind_speed_10m"].reindex(idx).notna(), 2, 0))

    # ---- ocean ----
    oc = ocean.reindex(idx)
    w["sl"] = oc["sea_level_height_msl"]
    w["sst"] = oc["sea_surface_temperature"]
    w["cur"] = oc["ocean_current_velocity"]
    w["curd"] = oc["ocean_current_direction"]

    # ---- tides ----
    tide = tides.build(ocean["sea_level_height_msl"], spot.WAVE_POINT[0])
    meta["tide"] = {k: v for k, v in tide.items() if k not in ("h_cm",)}
    tide_series = pd.Series(np.asarray(tide["h_cm"], dtype=float) / 100.0,
                            index=pd.date_range(pd.Timestamp(tide["t0"], unit="s", tz="UTC"), periods=tide["n"], freq="h"))
    w["tide"] = tide_series.reindex(idx)

    # trim to rows that have waves or wind
    w = w[(w["hs"].notna()) | (w["ws"].notna())]

    # ---- forecast-model calibration onto the history climate (MFWAM Hs, ERA5 Tp) ----
    meta["forecastCalibration"] = forecast_calibration(raw, w)

    decade = w[w.index >= pd.Timestamp(spot.HISTORY_START, tz="UTC")].copy()
    long = w[["hs", "dir", "tp", "tm", "ws", "wd", "pr", "msl", "src_wave"]].copy()
    meta["coverage"] = {
        "decade_start": decade.index.min().isoformat(),
        "decade_end": decade.index.max().isoformat(),
        "long_start": long.index.min().isoformat(),
        "waves_era5_end": era["hs"].dropna().index.max().isoformat(),
        "partitions_start": mf["wave_height"].dropna().index.min().isoformat(),
        "sea_level_start": ocean["sea_level_height_msl"].dropna().index.min().isoformat(),
        "ifs_start": ifs["wind_speed_10m"].dropna().index.min().isoformat(),
    }
    meta["grids"] = {k: list(v.attrs.get("grid") or []) for k, v in raw.items()}
    return decade, long, {"meta": meta, "tide": tide}


def forecast_calibration(raw: dict[str, pd.DataFrame], w: pd.DataFrame) -> dict:
    """Per forecast model: Hs scale onto MFWAM, and the factor turning its period
    variable into the reference peak period used by the history (ERA5 Tp)."""
    mf_hs = raw["mfwam"]["wave_height"]
    tp_ref = w["tp"].where(w["src_wave"] == 1)  # ERA5-era Tp (and mapped ECWAM Tp)
    tp_any = w["tp"]
    models = {
        "meteofrance_wave": (raw["mfwam"], "swell_wave_period"),
        "ecmwf_wam025": (raw["ecwam"], "wave_peak_period"),
        "ecmwf_wam": (raw["ecwam9"], "wave_peak_period"),
        "ncep_gfswave016": (raw["gfswave"], "swell_wave_period"),
    }
    out = {}
    for name, (df, pvar) in models.items():
        both = pd.concat([df["wave_height"].rename("x"), mf_hs.rename("y")], axis=1).dropna()
        both = both[both["x"] > 0.2]
        a = float((both["x"] * both["y"]).sum() / (both["x"] ** 2).sum()) if len(both) > 200 else 1.0
        ref = tp_ref if tp_ref.dropna().index.max() > df.index.min() + pd.Timedelta(days=60) else tp_any
        pb = pd.concat([df[pvar].rename("p"), ref.rename("r")], axis=1).dropna()
        pb = pb[pb["p"] > 2]
        r = float(np.median(pb["r"] / pb["p"])) if len(pb) > 200 else 1.0
        out[name] = {"hs": round(a, 3), "period": round(r, 3), "periodVar": pvar, "overlapHours": int(len(both))}
    return out


def offshore_fraction(ws: pd.Series, wd: pd.Series) -> pd.Series:
    rel = angdiff(wd, spot.OFFSHORE_FROM)
    return pd.Series(np.where(ws.to_numpy() <= 3, 1.0, (rel <= 60).astype(float)), index=ws.index)
