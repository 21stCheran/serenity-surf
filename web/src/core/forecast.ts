/** Turn raw multi-model Open-Meteo responses into hourly spot conditions:
 * a consensus series plus one series per model (for spread / confidence). */
import type { LiveRaw, OMResponse } from '../data/openmeteo';
import { WAVE_MODELS, WIND_MODELS } from '../data/openmeteo';
import { scoreHour } from './score';
import { Tides } from './tide';
import type { Calibration, HourInput, HourScore, Profile, WavePart } from './types';
import { circMean, median } from './units';

export interface ModelCal {
  hs: number;
  period: number;
  periodVar: string;
}
export type ForecastCalibration = Record<string, ModelCal>;

export interface WaveRow {
  hs: number | null;
  tp: number | null;
  dir: number | null;
  parts: WavePart[] | null;
}
export interface WindRow {
  ws: number | null;
  wd: number | null;
  wg: number | null;
  pr: number | null;
}

export interface Forecast {
  fetchedAt: number;
  times: number[];
  hours: HourInput[]; // consensus
  waves: Record<string, WaveRow[]>; // per wave model, aligned to times
  wind: Record<string, WindRow[]>; // per wind model
  uvMax: Record<string, number>; // IST day key -> UV index
}

const get = (r: OMResponse, key: string): (number | null)[] | undefined => r.hourly[key] as (number | null)[] | undefined;
const num = (x: number | null | undefined) => (x == null || Number.isNaN(x) ? null : x);

function indexer(times: number[]) {
  const m = new Map<number, number>();
  times.forEach((t, i) => m.set(t, i));
  return m;
}

function waveRows(marine: OMResponse, times: number[], cal: ForecastCalibration): Record<string, WaveRow[]> {
  const idx = indexer(marine.hourly.time as number[]);
  const out: Record<string, WaveRow[]> = {};
  for (const m of WAVE_MODELS) {
    const c = cal[m.id] ?? { hs: 1, period: 1, periodVar: m.parts ? 'swell_wave_period' : 'wave_peak_period' };
    const k = (v: string) => get(marine, `${v}_${m.id}`);
    const hs = k('wave_height');
    const dir = k('wave_direction');
    const per = k(c.periodVar);
    const s1 = [k('swell_wave_height'), k('swell_wave_period'), k('swell_wave_direction')];
    const s2 = [k('secondary_swell_wave_height'), k('secondary_swell_wave_period'), k('secondary_swell_wave_direction')];
    const ww = [k('wind_wave_height'), k('wind_wave_period'), k('wind_wave_direction')];
    out[m.id] = times.map((t) => {
      const i = idx.get(t);
      if (i == null || !hs || num(hs[i]) == null) return { hs: null, tp: null, dir: null, parts: null };
      let parts: WavePart[] | null = null;
      if (m.parts) {
        const found: WavePart[] = [];
        const add = (sys: ((number | null)[] | undefined)[], kind: 'swell' | 'wind') => {
          const [h, p, d] = sys;
          if (!h || !p || !d) return;
          const hv = num(h[i]);
          const pv = num(p[i]);
          const dv = num(d[i]);
          if (hv != null && pv != null && dv != null && hv > 0.02 && pv > 0) found.push({ h: hv * c.hs, p: pv * c.period, d: dv, kind });
        };
        add(s1, 'swell');
        add(s2, 'swell');
        add(ww, 'wind');
        parts = found.length ? found : null;
      }
      return { hs: (hs[i] as number) * c.hs, tp: per && num(per[i]) != null ? (per[i] as number) * c.period : null, dir: dir ? num(dir[i]) : null, parts };
    });
  }
  return out;
}

function windRows(weather: OMResponse, times: number[]): Record<string, WindRow[]> {
  const idx = indexer(weather.hourly.time as number[]);
  const out: Record<string, WindRow[]> = {};
  for (const m of WIND_MODELS) {
    const k = (v: string) => get(weather, `${v}_${m.id}`);
    const ws = k('wind_speed_10m');
    const wd = k('wind_direction_10m');
    const wg = k('wind_gusts_10m');
    const pr = k('precipitation');
    out[m.id] = times.map((t) => {
      const i = idx.get(t);
      if (i == null || !ws || num(ws[i]) == null) return { ws: null, wd: null, wg: null, pr: null };
      return { ws: ws[i] as number, wd: wd ? num(wd[i]) : null, wg: wg ? num(wg[i]) : null, pr: pr ? num(pr[i]) : null };
    });
  }
  return out;
}

export function buildForecast(raw: LiveRaw, cal: ForecastCalibration, tides: Tides | null): Forecast {
  const tw = raw.weather.hourly.time as number[];
  const tm = raw.marine.hourly.time as number[];
  const t0 = Math.max(tw[0], tm[0]);
  const t1 = Math.max(tw[tw.length - 1], tm[tm.length - 1]);
  const times: number[] = [];
  for (let t = t0; t <= t1; t += 3600) times.push(t);

  const waves = waveRows(raw.marine, times, cal);
  const wind = windRows(raw.weather, times);
  const wIdx = indexer(tw);
  const oIdx = raw.ocean ? indexer(raw.ocean.hourly.time as number[]) : null;
  const bm = (v: string) => get(raw.weather, `${v}_best_match`);
  const pp = bm('precipitation_probability');
  const wc = bm('weather_code');
  const capeAll = WIND_MODELS.map((m) => get(raw.weather, `cape_${m.id}`));
  const sl = raw.ocean ? get(raw.ocean, 'sea_level_height_msl') : undefined;
  const sst = raw.ocean ? get(raw.ocean, 'sea_surface_temperature') : undefined;

  const hours: HourInput[] = times.map((t, j) => {
    // waves: median of calibrated models, partitions from MFWAM else GFS
    const rows = WAVE_MODELS.map((m) => waves[m.id][j]).filter((r) => r.hs != null);
    const hs = median(rows.map((r) => r.hs));
    const tp = median(rows.map((r) => r.tp));
    const dir = circMean(rows.filter((r) => r.dir != null).map((r) => r.dir as number), rows.filter((r) => r.dir != null).map((r) => r.hs as number));
    let parts: WavePart[] | null = waves.meteofrance_wave[j].parts ?? waves.ncep_gfswave016[j].parts ?? null;
    if (parts && hs != null) {
      const e = Math.sqrt(parts.reduce((a, p) => a + p.h * p.h, 0));
      if (e > 0) parts = parts.map((p) => ({ ...p, h: (p.h * hs) / e }));
    }
    // wind: median speed, speed-weighted circular mean direction
    const wr = WIND_MODELS.map((m) => wind[m.id][j]).filter((r) => r.ws != null);
    const ws = median(wr.map((r) => r.ws));
    const wd = circMean(wr.filter((r) => r.wd != null).map((r) => r.wd as number), wr.filter((r) => r.wd != null).map((r) => Math.max(1, r.ws as number)));
    const wg = median(wr.map((r) => r.wg));
    const pr = median(wr.map((r) => r.pr));
    const i = wIdx.get(t);
    const cape = i != null ? median(capeAll.map((c) => (c ? c[i] : null))) : null;
    const st = tides?.stage(t) ?? null;
    const oi = oIdx?.get(t);
    return {
      t,
      hs,
      tp,
      dir,
      parts,
      ws,
      wd,
      wg,
      pr,
      pp: i != null && pp ? num(pp[i]) : null,
      wc: i != null && wc ? num(wc[i]) : null,
      cape,
      tide: st?.h ?? null,
      tideNorm: st?.norm ?? null,
      tideRising: st?.rising ?? null,
      sl: oi != null && sl ? (tides ? tides.seaLevel(num(sl[oi])) : num(sl[oi])) : null,
      sst: oi != null && sst ? num(sst[oi]) : null,
    };
  });
  // trailing 48 h rain for the water-quality flag
  for (let j = 0; j < hours.length; j++) {
    let s = 0;
    for (let k = Math.max(0, j - 47); k <= j; k++) s += hours[k].pr ?? 0;
    hours[j].rain48 = s;
  }

  const uvMax: Record<string, number> = {};
  const du = raw.weather.daily;
  if (du && du.time && du['uv_index_max_best_match']) {
    (du.time as number[]).forEach((t, k) => {
      const v = (du['uv_index_max_best_match'] as (number | null)[])[k];
      if (v != null) uvMax[new Date((t + 19800) * 1000).toISOString().slice(0, 10)] = v;
    });
  }
  return { fetchedAt: raw.fetchedAt, times, hours, waves, wind, uvMax };
}

/** Hours with any wave data (models run out at different horizons). */
export function validHours(f: Forecast): HourInput[] {
  return f.hours.filter((h) => h.hs != null && h.ws != null);
}

export interface Spread {
  t: number;
  min: number;
  max: number;
  p10: number;
  p90: number;
  confidence: 'high' | 'medium' | 'low';
}

/** Score spread across model combinations -> confidence per hour. */
export function modelSpread(f: Forecast, profile: Profile, cal: Calibration): Spread[] {
  return f.hours.map((h, j) => {
    const scores: number[] = [];
    for (const m of WAVE_MODELS) {
      const w = f.waves[m.id][j];
      if (w.hs == null || h.ws == null) continue;
      scores.push(scoreHour({ ...h, hs: w.hs, tp: w.tp ?? h.tp, dir: w.dir ?? h.dir, parts: w.parts }, profile, cal).score);
    }
    for (const m of WIND_MODELS) {
      const w = f.wind[m.id][j];
      if (w.ws == null || h.hs == null) continue;
      scores.push(scoreHour({ ...h, ws: w.ws, wd: w.wd }, profile, cal).score);
    }
    if (!scores.length) return { t: h.t, min: 0, max: 0, p10: 0, p90: 0, confidence: 'low' as const };
    scores.sort((a, b) => a - b);
    const q = (p: number) => scores[Math.min(scores.length - 1, Math.max(0, Math.round(p * (scores.length - 1))))];
    const width = q(0.9) - q(0.1);
    const lead = (h.t - f.fetchedAt) / 86400;
    let conf: Spread['confidence'] = width < 1.5 ? 'high' : width < 3 ? 'medium' : 'low';
    if (lead > 7 && conf === 'high') conf = 'medium';
    if (lead > 11) conf = 'low';
    return { t: h.t, min: scores[0], max: scores[scores.length - 1], p10: q(0.1), p90: q(0.9), confidence: conf };
  });
}

export function scoreForecast(f: Forecast, profile: Profile, cal: Calibration, ctx?: (h: HourInput) => Parameters<typeof scoreHour>[3]): HourScore[] {
  return validHours(f).map((h) => scoreHour(h, profile, cal, ctx ? ctx(h) : {}));
}
