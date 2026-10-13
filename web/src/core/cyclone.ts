/** Cyclone swell predictor (TypeScript twin of pipeline/science/cyclone_model.py).
 *
 * Young (1988) parametric waves at the storm, decay (R0/d)^a, a boost when the
 * storm moves toward the spot, and a cut when the path crosses land. Parameters
 * and the land-shadow grid come from data/cyclone-model.json.
 */
import { SPOT } from './spot';
import { surfAtBeach, faceRange } from './surf';
import { relAngle } from './units';

export const G = 9.81;
const R_EARTH = 6371.0088;

export interface CycloneParams {
  c: number;
  a: number;
  k: number;
  R0km: number;
  blockedFactor: number;
  windTo10min: number;
  tpScale: number;
  defaults: { windKt: number; speedKt: number; rmwKm: number };
}

export interface Analog {
  sid: string;
  lat: number;
  lon: number;
  dist: number;
  brg: number;
  wind: number | null;
  heading: number | null;
  month: number;
  obsPeak: number;
  base: number;
  confounded: boolean;
}

export interface CycloneModel {
  params: CycloneParams;
  young: Record<'a' | 'b' | 'c' | 'd' | 'e' | 'f', number>;
  metrics: {
    storms: number;
    mae_m: number;
    bias_m: number;
    corr: number;
    r2: number;
    skill_vs_background: number;
    mae_background_only_m: number;
    resid_log_q: Record<string, number>;
    tp_scale: number;
    cv: string;
  };
  analogs: Analog[];
  cv_points: [number, number][];
  shadow: { lat0: number; lon0: number; step: number; nlat: number; nlon: number; rle: number[] };
  land: unknown;
}

export interface TrackPoint {
  t: number; // epoch s
  lat: number;
  lon: number;
  windKt: number | null; // 1-min sustained
  speedKt?: number | null;
  heading?: number | null;
  rmwKm?: number | null;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const dlat = (lat2 - lat1) * r;
  const dlon = (lon2 - lon1) * r;
  const a = Math.sin(dlat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dlon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(a));
}

export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export class Shadow {
  private grid: Int8Array;
  constructor(private s: CycloneModel['shadow']) {
    this.grid = new Int8Array(s.nlat * s.nlon);
    let i = 0;
    for (let k = 0; k < s.rle.length; k += 2) {
      this.grid.fill(s.rle[k], i, i + s.rle[k + 1]);
      i += s.rle[k + 1];
    }
  }
  private cell(lat: number, lon: number): number {
    const i = Math.round((lat - this.s.lat0) / this.s.step);
    const j = Math.round((lon - this.s.lon0) / this.s.step);
    if (i < 0 || j < 0 || i >= this.s.nlat || j >= this.s.nlon) return 1;
    return this.grid[i * this.s.nlon + j];
  }
  blocked(lat: number, lon: number): boolean {
    return this.cell(lat, lon) === 1;
  }
  onLand(lat: number, lon: number): boolean {
    return this.cell(lat, lon) === 2;
  }
}

export function young(model: CycloneModel, vms: number, vfm: number, rmwKm: number): { hs: number; tp: number } {
  const y = model.young;
  const v = Math.min(68, Math.max(12, vms));
  const vf = Math.min(12, Math.max(0, vfm));
  const r = Math.min(80, Math.max(15, rmwKm)) * 1000;
  const rp = 22.5e3 * Math.log10(r) - 70.8e3;
  const fOver = y.a * v * v + y.b * v * vf + y.c * vf * vf + y.d * v + y.e * vf + y.f;
  const fetch = Math.max(fOver * rp, 10e3);
  return { hs: 0.0016 * v * Math.sqrt(fetch / G), tp: ((0.045 * 2 * Math.PI * v) / G) * ((G * fetch) / (v * v)) ** 0.33 };
}

export interface Contribution {
  t: number;
  lat: number;
  lon: number;
  windKt: number;
  distKm: number;
  bearing: number; // from the spot to the storm = swell direction
  blocked: boolean;
  swellHs: number; // at the offshore point
  tp: number; // calibrated period at the spot
  arrival: number; // epoch s
}

/** Interpolate a forecast track to a regular step (default 3 h). */
export function densify(track: TrackPoint[], step = 10800): TrackPoint[] {
  if (track.length < 2) return track.slice();
  const out: TrackPoint[] = [];
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i];
    const b = track[i + 1];
    for (let t = a.t; t < b.t; t += step) {
      const f = (t - a.t) / (b.t - a.t);
      out.push({
        t,
        lat: a.lat + (b.lat - a.lat) * f,
        lon: a.lon + (b.lon - a.lon) * f,
        windKt: a.windKt != null && b.windKt != null ? a.windKt + (b.windKt - a.windKt) * f : a.windKt ?? b.windKt,
        heading: bearingDeg(a.lat, a.lon, b.lat, b.lon),
        speedKt: (haversineKm(a.lat, a.lon, b.lat, b.lon) / ((b.t - a.t) / 3600)) / 1.852,
        rmwKm: a.rmwKm ?? null,
      });
    }
  }
  const last = track[track.length - 1];
  out.push({ ...last, heading: out.length ? out[out.length - 1].heading : last.heading, speedKt: out.length ? out[out.length - 1].speedKt : last.speedKt });
  return out;
}

export function contributions(track: TrackPoint[], model: CycloneModel, shadow: Shadow): Contribution[] {
  const p = model.params;
  return densify(track).map((pt) => {
    const wind = pt.windKt ?? p.defaults.windKt;
    const v = wind * 0.5144 * p.windTo10min;
    const vf = (pt.speedKt ?? p.defaults.speedKt) * 0.5144;
    const { hs, tp } = young(model, v, vf, pt.rmwKm ?? p.defaults.rmwKm);
    const d = haversineKm(SPOT.lat, SPOT.lon, pt.lat, pt.lon);
    const brg = bearingDeg(SPOT.lat, SPOT.lon, pt.lat, pt.lon);
    const toSpot = (brg + 180) % 360;
    const align = pt.heading != null ? Math.cos((relAngle(pt.heading, toSpot) * Math.PI) / 180) : 1;
    let h = p.c * hs * (p.R0km / Math.max(d, p.R0km)) ** p.a * (1 + p.k * align);
    const blocked = shadow.blocked(pt.lat, pt.lon);
    if (blocked) h *= p.blockedFactor;
    if (shadow.onLand(pt.lat, pt.lon)) h = 0;
    const tpCal = tp * (p.tpScale ?? 0.8);
    const cg = (G * tp) / (4 * Math.PI);
    return { t: pt.t, lat: pt.lat, lon: pt.lon, windKt: wind, distKm: d, bearing: brg, blocked, swellHs: Math.max(0, h), tp: tpCal, arrival: pt.t + (d * 1000) / cg };
  });
}

export interface SwellPoint {
  t: number;
  swellHs: number; // cyclone swell only
  p10: number; // total offshore Hs incl. background
  p50: number;
  p90: number;
  tp: number;
  dir: number;
  faceLo: number; // ft, cyclone swell alone at the beach
  faceHi: number;
}

export interface StormSwell {
  timeline: SwellPoint[];
  peak: SwellPoint | null;
  firstArrival: number | null; // first time the swell exceeds +0.3 m over background
  contributions: Contribution[];
  closestKm: number;
}

/** Predicted swell at Serenity from a (forecast) track, with uncertainty from the CV residuals. */
export function predictStormSwell(track: TrackPoint[], model: CycloneModel, shadow: Shadow, baseHs = 0.8, sigmaH = 8): StormSwell {
  const cons = contributions(track, model, shadow);
  if (!cons.length) return { timeline: [], peak: null, firstArrival: null, contributions: cons, closestKm: Infinity };
  const q = model.metrics.resid_log_q;
  const t0 = Math.floor(Math.min(...cons.map((c) => c.t)) / 3600) * 3600;
  const t1 = Math.ceil((Math.max(...cons.map((c) => c.arrival)) + 36 * 3600) / 3600) * 3600;
  const timeline: SwellPoint[] = [];
  let firstArrival: number | null = null;
  for (let t = t0; t <= t1; t += 3600) {
    let best = 0;
    let bc: Contribution | null = null;
    for (const c of cons) {
      if (c.t > t) continue; // swell cannot arrive from a future storm position
      const w = Math.exp(-0.5 * ((t - c.arrival) / (sigmaH * 3600)) ** 2);
      const h = c.swellHs * w;
      if (h > best) {
        best = h;
        bc = c;
      }
    }
    const total = Math.sqrt(baseHs * baseHs + best * best);
    const dir = bc ? bc.bearing : SPOT.beachNormal;
    const tp = bc ? bc.tp : 8;
    const s = surfAtBeach({ hs: best, tp, dir, parts: null });
    const f = faceRange(s.hb);
    if (firstArrival == null && total - baseHs >= 0.3) firstArrival = t;
    timeline.push({
      t,
      swellHs: best,
      p10: total * Math.exp(q['10'] ?? -0.35),
      p50: total * Math.exp(q['50'] ?? 0),
      p90: total * Math.exp(q['90'] ?? 0.45),
      tp,
      dir,
      faceLo: f.lo,
      faceHi: f.hi,
    });
  }
  const peak = timeline.reduce<SwellPoint | null>((a, b) => (!a || b.swellHs > a.swellHs ? b : a), null);
  return { timeline, peak, firstArrival, contributions: cons, closestKm: Math.min(...cons.map((c) => c.distKm)) };
}

/** Historical storms most like a current one (position, intensity, heading, month). */
export function findAnalogs(
  model: CycloneModel,
  q: { lat: number; lon: number; windKt: number | null; heading: number | null; month: number },
  n = 5,
): (Analog & { score: number })[] {
  const out = model.analogs
    .filter((a) => !a.confounded)
    .map((a) => {
      const dPos = haversineKm(q.lat, q.lon, a.lat, a.lon) / 300;
      const dWind = q.windKt != null && a.wind != null ? Math.abs(q.windKt - a.wind) / 20 : 0.7;
      const dHead = q.heading != null && a.heading != null ? relAngle(q.heading, a.heading) / 60 : 0.5;
      const dm = Math.min(Math.abs(q.month - a.month), 12 - Math.abs(q.month - a.month)) / 2;
      return { ...a, score: Math.sqrt(dPos * dPos + dWind * dWind + dHead * dHead + dm * dm) };
    })
    .sort((a, b) => a.score - b.score);
  return out.slice(0, n);
}

/** IMD category from a 1-minute wind (JTWC) in knots (IMD uses 3-minute means ≈ 0.9×). */
export function imdCategory(wind1minKt: number | null): { code: string; name: string } {
  const w = (wind1minKt ?? 0) / 1.1;
  const cats: [number, string, string][] = [
    [120, 'SuCS', 'Super Cyclonic Storm'],
    [90, 'ESCS', 'Extremely Severe Cyclonic Storm'],
    [64, 'VSCS', 'Very Severe Cyclonic Storm'],
    [48, 'SCS', 'Severe Cyclonic Storm'],
    [34, 'CS', 'Cyclonic Storm'],
    [28, 'DD', 'Deep Depression'],
    [17, 'D', 'Depression'],
  ];
  for (const [thr, code, name] of cats) if (w >= thr) return { code, name };
  return { code: 'LOW', name: 'Low pressure area' };
}
