/** Tide predictions from the hourly harmonic reconstruction (tides.json). */

export interface TideData {
  t0: number;
  dt: number;
  n: number;
  h_cm: number[];
  mean_range_m: number;
  spring_range_m: number;
  neap_range_m: number;
  lat_m: number;
  hat_m: number;
  msl_offset_m?: number;
  constituents?: { name: string; amp_m: number; phase_deg: number; cph: number }[];
  validation?: { rmse_m: number; explained_var: number };
}

export interface TideExtreme {
  t: number;
  h: number;
  type: 'high' | 'low';
}

export class Tides {
  constructor(readonly d: TideData) {}

  get start() {
    return this.d.t0;
  }
  /** Convert modelled absolute sea level (SMOC, global-MSL datum) to the tide datum. */
  seaLevel(sl: number | null | undefined): number | null {
    return sl == null ? null : sl - (this.d.msl_offset_m ?? 0);
  }
  get end() {
    return this.d.t0 + (this.d.n - 1) * this.d.dt;
  }

  private v(i: number): number {
    const j = Math.max(0, Math.min(this.d.n - 1, i));
    return this.d.h_cm[j] / 100;
  }

  /** Height (m, relative to MSL) at time t using Catmull-Rom interpolation. */
  at(t: number): number | null {
    if (t < this.start || t > this.end) return null;
    const x = (t - this.d.t0) / this.d.dt;
    const i = Math.floor(x);
    const f = x - i;
    const p0 = this.v(i - 1);
    const p1 = this.v(i);
    const p2 = this.v(i + 1);
    const p3 = this.v(i + 2);
    return (
      0.5 *
      (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f)
    );
  }

  /** High and low waters between t0 and t1 (parabolic refinement of hourly extrema). */
  extremes(t0: number, t1: number): TideExtreme[] {
    const out: TideExtreme[] = [];
    const i0 = Math.max(1, Math.floor((t0 - this.d.t0) / this.d.dt) - 1);
    const i1 = Math.min(this.d.n - 2, Math.ceil((t1 - this.d.t0) / this.d.dt) + 1);
    for (let i = i0; i <= i1; i++) {
      const a = this.v(i - 1);
      const b = this.v(i);
      const c = this.v(i + 1);
      const isMax = b > a && b >= c;
      const isMin = b < a && b <= c;
      if (!isMax && !isMin) continue;
      const denom = a - 2 * b + c;
      const off = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
      const h = b - 0.25 * (a - c) * off;
      const t = this.d.t0 + (i + off) * this.d.dt;
      if (t >= t0 && t <= t1) out.push({ t: Math.round(t), h, type: isMax ? 'high' : 'low' });
    }
    return out;
  }

  /** Stage at t: height, rising/falling, 0 (low) .. 1 (high) within the current cycle. */
  stage(t: number): { h: number; rising: boolean; norm: number; prev?: TideExtreme; next?: TideExtreme } | null {
    const h = this.at(t);
    if (h == null) return null;
    const ex = this.extremes(t - 9 * 3600, t + 9 * 3600);
    const prev = [...ex].reverse().find((e) => e.t <= t);
    const next = ex.find((e) => e.t > t);
    if (!prev || !next) return { h, rising: (this.at(t + 600) ?? h) > h, norm: 0.5, prev, next };
    const lo = Math.min(prev.h, next.h);
    const hi = Math.max(prev.h, next.h);
    const norm = hi - lo > 0.01 ? (h - lo) / (hi - lo) : 0.5;
    return { h, rising: next.type === 'high', norm: Math.max(0, Math.min(1, norm)), prev, next };
  }

  /** Hourly series for charts. */
  series(t0: number, t1: number, step = 3600): [number, number][] {
    const out: [number, number][] = [];
    for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) {
      const h = this.at(t);
      if (h != null) out.push([t, h]);
    }
    return out;
  }
}

export function tideWord(norm: number, rising: boolean): string {
  if (norm < 0.2) return 'low';
  if (norm > 0.8) return 'high';
  return rising ? 'mid, rising' : 'mid, falling';
}
