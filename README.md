# Serenity Surf

Surf forecast, cyclone swell tracker and 10-year surf history for **Serenity Beach, Kottakuppam (Puducherry), India**.

**Live site:** https://21stcheran.github.io/serenity-surf/ · **Phone alert feed:** [`api/alert.json`](https://21stcheran.github.io/serenity-surf/api/alert.json) ([setup guide](docs/phone-alerts.md))

| Page | What it does |
|---|---|
| **Today** | Score dial, surf height, swell/wind/tide/water, best sessions today and tomorrow, 72-hour strip, cyclone watch |
| **Forecast** | 16 days: daily cards, day × hour heatmap, synchronised swell/period/wind/tide/rain charts, 4 wave + 8 wind models compared, confidence band, `.ics` export |
| **Cyclones** | Live JTWC storms with predicted swell at Serenity, ECMWF/GFS ensemble cyclone-formation odds, NOAA week 2–3 outlook, animated Bay of Bengal swell field, live satellite, MJO/ENSO drivers, 1980+ storm archive with replays, model skill |
| **Seasons** | Surf climate wheel, odds by week, month × hour quality, swell/wind roses, sea-breeze timing (vs airport obs), size by month, rain, calendar, compare any two months, biggest days |
| **Planner** | Trip odds for any dates from the history, 45-day outlook (forecast + climate), best weeks, ENSO/MJO context |
| **Spot** | Satellite time machine (Esri Wayback 2014–2023, Sentinel-2 2018–2025), OSM groynes, swell window, modelled sand drift and beach state, tides |
| **Data lab** | Any variable over any period, scatter, CSV export, model winds vs Puducherry airport |
| **Log & settings** | Profiles (6'10 all-rounder, intermediate, cyclone hunter, beginner), units, calibration, session log with auto-calibration |

## How it works

```
GitHub Actions (03:30 IST + every 3 h)
  python -m pipeline.build      → web/public/data/*.json   (history, tides, storms, cyclone model, climatology, genesis, swell field…)
  npm run build:api             → web/public/api/*.json    (phone alert feed, uses the same TypeScript scoring as the site)
  npm run build                 → GitHub Pages
Browser                          → static data + live Open-Meteo / JTWC / GDACS / IMD feeds (all CORS-enabled, no server)
```

- **Spot geometry** (OpenStreetMap): coast runs 16°, the beach faces 106° (ESE), offshore wind blows from 286° (WNW). Sri Lanka shadows 155–185°.
- **History**: ERA5 waves 1980→ (quantile-mapped onto Météo-France MFWAM 8 km), MFWAM swell partitions from Oct 2021, ECMWF IFS 9 km winds from 2017, tides from a UTide harmonic fit to SMOC sea level (hold-out error 7 cm).
- **Surf at the beach**: Komar–Gaughan breaking height with refraction for the 106° beach, × site factor 0.8, reported as a face-height range. Calibrate it with your logged sessions.
- **Score** 0–10 = size curve (per profile) × period × wind (angle to offshore) × tide. Labels: Flat < 1 ≤ Poor < 2.5 ≤ Fair < 4.5 ≤ Good < 6.5 ≤ Great < 8.5 ≤ Epic.
- **Cyclone swell model**: Young (1988) hurricane waves → decay with distance, boost for storms heading at the coast, cut by land shadows. 3 constants fitted on ~350 storms (leave-one-storm-out CV: 0.35 m error vs 0.51 m background-only).

## Run it locally

```bash
# data (Python 3.11)
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt     # Windows (use .venv/bin on macOS/Linux)
.venv/Scripts/python -m pipeline.build              # first run ~5–10 min; later runs only refresh stale products
.venv/Scripts/python -m pytest pipeline/tests -q

# web
cd web
npm ci
npm run build:api      # phone API from live data
npm run dev            # http://localhost:5173/serenity-surf/
npm test
npm run build && npm run preview
```

`python -m pipeline.build --full` rebuilds everything; `--only genesis,field` forces specific products.

## Data sources & licences

Open-Meteo (CC BY 4.0; free tier is **non-commercial** — set an `OPEN_METEO_API_KEY` repo secret for commercial use) with ECMWF, NOAA, Météo-France, DWD, UK Met Office, JMA and CMA models and ERA5 (Copernicus) · IBTrACS (NOAA NCEI) · JTWC · GDACS · IMD CAP alerts · NOAA CPC Global Tropics Hazards · NOAA PSL (ROMI MJO, DMI) and CPC (ONI) · Iowa Environmental Mesonet (METAR) · EUMETSAT (live satellite) · Esri World Imagery, Wayback and Canvas basemaps · EOX Sentinel-2 cloudless (CC BY-NC-SA 4.0, non-commercial) · OpenStreetMap (ODbL) · Natural Earth.

Surf heights and cyclone swell are **model estimates**. Always look at the water before you paddle out — and stay out of the sea when a cyclone is close.
