/** Static data products written by the Python pipeline (web/public/data). */
import type { CycloneModel } from '../core/cyclone';
import type { ForecastCalibration } from '../core/forecast';
import type { TideData } from '../core/tide';
import { Tides } from '../core/tide';
import type { HourInput, WavePart } from '../core/types';

export interface Meta {
  generated: string;
  spot: Record<string, unknown>;
  history: { files: { year: number; file: string; hours: number; bytes: number }[]; decade_start: string; decade_end: string; long_start: string; waves_era5_end: string; partitions_start: string; sea_level_start: string; ifs_start: string };
  harmonization: Record<string, { n: number; corr: number; rmse_before: number; rmse_after: number; src_q: number[]; ref_q: number[]; mapped_q: number[] }>;
  forecastCalibration: ForecastCalibration;
  tide: Omit<TideData, 'h_cm'>;
  build: Record<string, { status: string; seconds?: number; ageHours?: number; error?: string }>;
  products: Record<string, { file: string; ageHours: number }>;
}

export interface HistoryYear {
  year: number;
  t0: number;
  dt: number;
  n: number;
  scale: Record<string, number>;
  cols: Record<string, (number | null)[]>;
}

export interface StormRecord {
  id: string;
  name: string;
  season: number;
  subbasin: string;
  start: number;
  end: number;
  maxWindKt: number | null;
  minPres: number | null;
  imd: string;
  closestKm: number;
  closestTime: number;
  closestBearing: number;
  landfall: { time: number; lat: number; lon: number; distKm: number } | null;
  provisional: boolean;
  track: [number, number, number, number | null, number | null][]; // t, lat, lon, windKt, pres
  response: { baseHs: number; peakHs: number; peakTime: number; peakTp: number | null; peakDir: number | null; hoursAbove1_5m: number; hoursAbove2m: number; attributedHs?: number; confounded?: boolean };
  model?: { predPeakHs: number; predSwellHs: number; predTp: number; arrival: number | null };
}

export interface StormSeries {
  t0: number;
  dt: number;
  hs: (number | null)[];
  tp: (number | null)[];
  dir: (number | null)[];
  ws: (number | null)[];
  wd: (number | null)[];
  pr: (number | null)[];
}

export interface Climatology {
  doy: { years: [number, number]; hsMax: Record<string, (number | null)[]>; tp: Record<string, (number | null)[]>; wind: Record<string, (number | null)[]>; rain: Record<string, (number | null)[]> };
  monthHour: { offshore: number[][]; onshore: number[][]; speed: number[][] };
  seaBreeze: { model: (number | null)[]; modelDaysPct: number[]; airport?: (number | null)[]; airportDays?: number[]; validation?: { hours: number; speedBiasKt: number; dirWithin45Pct: number; corrSpeed: number } };
  roses: { sectors: number; hsBins: number[]; wsBins: number[]; wave: number[][][]; windAM: number[][][]; windPM: number[][][] };
  rain: { monthlyMean1980: number[]; byYear: Record<string, (number | null)[]>; rainyDaysMean: number[] };
  bigSwellDays: number[];
  sst?: (number | null)[];
  cyclones: { years: [number, number]; perYearByMonth: { dep: number[]; cs: number[]; severe: number[] }; swellStormsPerYearByMonth: number[]; total: number };
  mjo?: { phases: number[]; genesisCount: number[]; weakMjoGenesis: number; daysInPhase: number[]; rateRatio: (number | null)[]; note: string };
  enso?: Record<string, { years: number[]; meanStormsOND: number | null; meanBigSwellDaysOND: number | null }>;
}

export interface Coastal {
  method: { drift: string; state: string; states: { code: string; name: string; maxOmega: number | null }[] };
  daily: { t0: number; dt: number; net: (number | null)[]; omega: (number | null)[]; state: string[] };
  monthlyClimatology: { month: number; net: number; north: number; south: number; netStd: number }[];
  yearly: { year: number; net: number; north: number; south: number }[];
}

export interface Indices {
  oni: { year: number[]; season: string[]; anom: number[] };
  dmi: { year: number[]; month: number[]; dmi: number[] };
  romi: { t0: string; x: number[]; y: number[]; amp: number[]; phase: number[]; last: string };
}

export interface Genesis {
  issued: string;
  grid: { lats: number[]; lons: number[] };
  models: {
    model: string;
    label: string;
    members: number;
    start: number;
    pAnyByDay: number[];
    pZoneByDay: number[];
    pAny15d: number;
    pZone15d: number;
    density: number[];
    pSwell4ft: number;
    pSwell6ft: number;
    tracks: { member: number; track: { t: number; lat: number; lon: number; anom: number; wind: number; dist: number; blocked: boolean; v?: number }[]; maxFaceFt: number; arrival: number | null }[];
  }[];
  combined?: { members: number; pSwell4ft: number; pSwell6ft: number; pAny15d: number; arrivals4ft: number[] };
  method: { anomHpa: number; windKt: number; gridDeg: number; note: string };
}

export interface Field {
  t0: number;
  dt: number;
  n: number;
  lat: number[];
  lon: number[];
  hs: (number | null)[][];
  dir: (number | null)[][];
  tp: (number | null)[][];
  model: string;
  issued?: string;
  name?: string;
  sid?: string;
}

export interface Cpc {
  source: string;
  weeks: { week: number; title: string; issued: string | null; validFrom: string | null; validTo: string | null; features: GeoJSON.Feature[] }[];
}

export interface Imagery {
  wayback: { release: number; releaseDate: string; title: string; captured?: number | null; resolution_m?: number; provider?: string }[];
  waybackTemplate: string;
  eox: { year: number; template: string }[];
  attribution: Record<string, string>;
}

export interface Metar {
  station: string;
  name: string;
  t: number[];
  dir: (number | null)[];
  kt: (number | null)[];
}

export const base = (): string => (typeof import.meta !== 'undefined' && (import.meta as any).env?.BASE_URL) || '/';

const cache = new Map<string, Promise<unknown>>();

export function loadJson<T>(path: string): Promise<T> {
  let p = cache.get(path) as Promise<T> | undefined;
  if (!p) {
    p = fetch(`${base()}data/${path}`).then((r) => {
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return r.json() as Promise<T>;
    });
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return p;
}

export const loadMeta = () => loadJson<Meta>('meta.json');
export const loadTides = () => loadJson<TideData>('tides.json').then((d) => new Tides(d));
export const loadCycloneModel = () => loadJson<CycloneModel>('cyclone-model.json');
export const loadStorms = () => loadJson<{ generated: string; count: number; storms: StormRecord[] }>('storms.json');
export const loadStormSeries = () => loadJson<Record<string, StormSeries>>('storm-series.json');
export const loadClimatology = () => loadJson<Climatology>('climatology.json');
export const loadCoastal = () => loadJson<Coastal>('coastal.json');
export const loadIndices = () => loadJson<Indices>('indices.json');
export const loadGenesis = () => loadJson<Genesis>('genesis.json');
export const loadField = () => loadJson<Field>('field.json');
export const loadCpc = () => loadJson<Cpc>('cpc.json');
export const loadImagery = () => loadJson<Imagery>('imagery.json');
export const loadOsm = () => loadJson<GeoJSON.FeatureCollection>('osm.json');
export const loadMetar = () => loadJson<Metar>('metar.json');
export const loadReplayIndex = () => loadJson<{ sid: string; name: string; start: string; end: string; file: string }[]>('replays/index.json');
export const loadReplay = (file: string) => loadJson<Field>(file);
export const loadHistoryYear = (year: number) => loadJson<HistoryYear>(`history/hourly-${year}.json`);

// ------------------------------------------------------------------ decoding

/** Hourly history -> HourInput rows (with tide stage and trailing 48 h rain). */
export function decodeHistory(years: HistoryYear[], tides: Tides | null): HourInput[] {
  const out: HourInput[] = [];
  for (const y of [...years].sort((a, b) => a.year - b.year)) {
    const c = y.cols;
    const sc = y.scale;
    const v = (k: string, i: number): number | null => {
      const col = c[k];
      if (!col) return null;
      const x = col[i];
      return x == null ? null : x / sc[k];
    };
    for (let i = 0; i < y.n; i++) {
      const t = y.t0 + i * y.dt;
      const hs = v('hs', i);
      const parts: WavePart[] = [];
      const s1 = v('sw1h', i);
      if (s1 != null) {
        const ratio = 1.16; // MFWAM swell period -> peak-period scale (pipeline period ratio)
        const p1 = v('sw1p', i);
        const d1 = v('sw1d', i);
        if (p1 != null && d1 != null && s1 > 0.02) parts.push({ h: s1, p: p1 * ratio, d: d1, kind: 'swell' });
        const s2 = v('sw2h', i);
        const p2 = v('sw2p', i);
        const d2 = v('sw2d', i);
        if (s2 != null && p2 != null && d2 != null && s2 > 0.02) parts.push({ h: s2, p: p2 * ratio, d: d2, kind: 'swell' });
        const ww = v('wwh', i);
        const pw = v('wwp', i);
        const dw = v('wwd', i);
        if (ww != null && pw != null && dw != null && ww > 0.02) parts.push({ h: ww, p: pw * ratio, d: dw, kind: 'wind' });
        if (hs != null && parts.length) {
          const e = Math.sqrt(parts.reduce((a, p) => a + p.h * p.h, 0));
          if (e > 0) for (const p of parts) p.h = (p.h * hs) / e;
        }
      }
      const tideV = v('tide', i);
      const st = tides ? tides.stage(t) : null;
      out.push({
        t,
        hs,
        tp: v('tp', i),
        dir: v('dir', i),
        parts: parts.length ? parts : null,
        ws: v('ws', i),
        wd: v('wd', i),
        wg: v('wg', i),
        pr: v('pr', i),
        wc: v('wc', i),
        tide: tideV ?? st?.h ?? null,
        tideNorm: st?.norm ?? null,
        tideRising: st?.rising ?? null,
        sst: v('sst', i),
        sl: tides ? tides.seaLevel(v('sl', i)) : v('sl', i),
      });
    }
  }
  let acc = 0;
  for (let j = 0; j < out.length; j++) {
    acc += out[j].pr ?? 0;
    if (j >= 48) acc -= out[j - 48].pr ?? 0;
    out[j].rain48 = acc;
  }
  return out;
}
