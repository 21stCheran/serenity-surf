/**
 * Build the phone/automation API (web/public/api/*.json) from live data.
 *
 *   npm run build:api
 *
 * Uses the same scoring engine as the browser (src/core). Reads static products
 * from web/public/data (written by `python -m pipeline.build`).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildAlert } from '../src/core/alerts';
import type { CycloneModel } from '../src/core/cyclone';
import { buildForecast, modelSpread, scoreForecast } from '../src/core/forecast';
import { assessStorms, cycloneContext } from '../src/core/live';
import { DEFAULT_PROFILE } from '../src/core/profiles';
import { SPOT } from '../src/core/spot';
import { DEFAULT_CAL, faceText } from '../src/core/surf';
import { Tides, type TideData } from '../src/core/tide';
import { compass, fmtTime, nowS } from '../src/core/units';
import { dailySummaries } from '../src/core/windows';
import { fetchImd } from '../src/data/alerts';
import { fetchJtwc } from '../src/data/jtwc';
import { fetchLive } from '../src/data/openmeteo';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = join(here, '..', 'public', 'data');
const API = join(here, '..', 'public', 'api');

function readJson<T>(name: string): T | null {
  const p = join(DATA, name);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : null;
}

function write(name: string, obj: unknown) {
  mkdirSync(API, { recursive: true });
  writeFileSync(join(API, name), JSON.stringify(obj, null, 1));
  console.log(`wrote api/${name}`);
}

async function main() {
  const now = nowS();
  const meta = readJson<{ forecastCalibration: Record<string, { hs: number; period: number; periodVar: string }> }>('meta.json');
  const tideData = readJson<TideData>('tides.json');
  const model = readJson<CycloneModel>('cyclone-model.json');
  const tides = tideData ? new Tides(tideData) : null;

  const [raw, jtwc, imd] = await Promise.all([
    fetchLive(),
    fetchJtwc().catch((e) => {
      console.warn('JTWC unavailable:', e.message);
      return null;
    }),
    fetchImd().catch(() => []),
  ]);
  const fc = buildForecast(raw, meta?.forecastCalibration ?? {}, tides);
  const nowHour = fc.hours.find((h) => h.t >= now - 1800);
  const base = nowHour?.hs ?? 0.8;
  const storms = model && jtwc ? assessStorms(jtwc.storms, model, base) : [];
  const ctx = cycloneContext(storms);
  const hours = scoreForecast(fc, DEFAULT_PROFILE, DEFAULT_CAL, ctx);
  const spread = modelSpread(fc, DEFAULT_PROFILE, DEFAULT_CAL);
  const windAt = (t: number) => fc.hours.find((h) => h.t === Math.floor(t / 3600) * 3600)?.ws ?? null;
  const tideAt = (t: number) => {
    const s = tides?.stage(t);
    return s ? { norm: s.norm, rising: s.rising } : null;
  };

  const alert = buildAlert({ hours, storms, now, profile: DEFAULT_PROFILE.name, url: SPOT.siteUrl, windKt: windAt, tideAt });
  write('alert.json', alert);

  const cur = hours.find((h) => h.t >= now - 1800) ?? hours[0];
  const curIn = fc.hours.find((h) => h.t === cur?.t);
  write('now.json', {
    generated_at: new Date(now * 1000).toISOString(),
    time: cur ? fmtTime(cur.t) : null,
    score: cur?.score ?? null,
    label: cur?.label ?? null,
    face_ft: cur ? [Math.round(cur.faceLo), Math.round(cur.faceHi)] : null,
    face_text: cur ? faceText(cur.faceLo, cur.faceHi) : null,
    swell: curIn ? { hs_m: curIn.hs, period_s: curIn.tp, dir: compass(curIn.dir), dir_deg: curIn.dir } : null,
    wind: curIn ? { kt: curIn.ws, gust_kt: curIn.wg, dir: compass(curIn.wd), dir_deg: curIn.wd, type: cur?.windType } : null,
    tide: curIn ? { m: curIn.tide, stage: tideAt(cur!.t) } : null,
    water_c: curIn?.sst ?? null,
    flags: cur?.flags ?? [],
  });

  const days = dailySummaries(hours.filter((h) => h.t >= now - 3600 * 6));
  write('forecast.json', {
    generated_at: new Date(now * 1000).toISOString(),
    profile: DEFAULT_PROFILE.name,
    days: days.map((d) => {
      const sp = spread.filter((s) => d.hours.some((h) => h.t === s.t));
      const conf = sp.length ? (['high', 'medium', 'low'] as const).find((c) => sp.filter((s) => s.confidence === c).length >= sp.length / 3) ?? 'medium' : 'low';
      const pk = d.best?.peak;
      return {
        day: d.day,
        label: d.label,
        best: d.best ? { start: fmtTime(d.best.start), end: fmtTime(d.best.end), score: d.best.score } : null,
        max_score: Math.round(d.maxScore * 10) / 10,
        am: d.am != null ? Math.round(d.am * 10) / 10 : null,
        pm: d.pm != null ? Math.round(d.pm * 10) / 10 : null,
        face_text: pk ? faceText(pk.faceLo, pk.faceHi) : null,
        period_s: pk?.tdom != null ? Math.round(pk.tdom) : null,
        swell_dir: pk ? compass(pk.swellDir) : null,
        wind_type: pk?.windType ?? null,
        confidence: conf,
        flags: [...new Set(d.hours.flatMap((h) => h.flags.map((f) => f.code)))],
      };
    }),
  });

  write('cyclones.json', {
    generated_at: new Date(now * 1000).toISOString(),
    storms: storms.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      category: s.category.name,
      wind_kt: s.windKt,
      lat: s.lat,
      lon: s.lon,
      distance_km: Math.round(s.distanceKm),
      relevant: s.relevant,
      first_arrival: s.firstArrival ? new Date(s.firstArrival * 1000).toISOString() : null,
      peak_time: s.peakTime ? new Date(s.peakTime * 1000).toISOString() : null,
      peak_face_ft: [Math.round(s.peakFaceLo), Math.round(s.peakFaceHi)],
      analogs: s.analogs.map((a) => a.sid),
    })),
    invests: jtwc?.invests ?? [],
    imd_alerts: imd.filter((a) => a.relevant).slice(0, 10),
  });
  console.log(`alert: level=${alert.level} notify=${alert.notify} "${alert.title}"`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
