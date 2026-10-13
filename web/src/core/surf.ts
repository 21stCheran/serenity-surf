/** Offshore swell -> breaking wave at Serenity Beach.
 *
 * Komar & Gaughan (1972) breaker height with a refraction factor sqrt(cos θ)
 * for obliquity to the beach normal, times a site factor for the shelf and the
 * groynes. Mirrored in pipeline/science/surfmodel.py; golden.json keeps them equal.
 */
import { SPOT } from './spot';
import type { Calibration, HourInput, WavePart } from './types';
import { M_TO_FT, relAngle } from './units';

export const G = 9.81;

export const DEFAULT_CAL: Calibration = {
  sizeMultiplier: 1,
  siteFactor: SPOT.surf.siteFactor,
  faceLo: SPOT.surf.faceLo,
  faceHi: SPOT.surf.faceHi,
  beachNormal: SPOT.beachNormal,
  offshoreFrom: SPOT.offshoreFrom,
};

export function breakingHeight(h: number, t: number, d: number, normal = SPOT.beachNormal, siteFactor = SPOT.surf.siteFactor): number {
  if (!(h > 0) || !(t > 0) || d == null || Number.isNaN(d)) return 0;
  const rel = relAngle(d, normal);
  if (rel >= 89) return 0;
  const h0 = h * Math.sqrt(Math.cos((rel * Math.PI) / 180));
  const hb = 0.39 * G ** 0.2 * (t * h0 * h0) ** 0.4;
  return hb * siteFactor;
}

export interface SurfAtBeach {
  hb: number; // m
  tdom: number | null;
  dirDom: number | null;
  swellFrac: number | null;
}

/** Combine wave systems by energy. Uses partitions when present, else the total sea. */
export function surfAtBeach(x: Pick<HourInput, 'hs' | 'tp' | 'dir' | 'parts'>, cal: Calibration = DEFAULT_CAL): SurfAtBeach {
  const parts: WavePart[] =
    x.parts && x.parts.length
      ? x.parts.filter((p) => p.h > 0.02 && p.p > 0)
      : x.hs != null && x.tp != null && x.dir != null
        ? [{ h: x.hs, p: x.tp, d: x.dir, kind: 'swell' }]
        : [];
  if (!parts.length) return { hb: 0, tdom: null, dirDom: null, swellFrac: null };
  let e = 0;
  let eSwell = 0;
  let best = -1;
  let tdom: number | null = null;
  let dirDom: number | null = null;
  for (const p of parts) {
    const hb = breakingHeight(p.h, p.p, p.d, cal.beachNormal, cal.siteFactor);
    e += hb * hb;
    if (p.kind === 'swell') eSwell += hb * hb;
    if (hb > best) {
      best = hb;
      tdom = p.p;
      dirDom = p.d;
    }
  }
  const hb = Math.sqrt(e) * cal.sizeMultiplier;
  return { hb, tdom, dirDom, swellFrac: e > 0 ? eSwell / e : null };
}

export function faceRange(hb: number, cal: Calibration = DEFAULT_CAL): { lo: number; hi: number; mid: number } {
  const lo = hb * M_TO_FT * cal.faceLo;
  const hi = hb * M_TO_FT * cal.faceHi;
  return { lo, hi, mid: (lo + hi) / 2 };
}

/** "3–4 ft" style text. */
export function faceText(lo: number, hi: number): string {
  if (hi < 0.8) return 'Flat';
  const a = Math.max(0, Math.round(lo));
  const b = Math.max(a + 1, Math.round(hi));
  if (hi < 1.5) return '0–1 ft';
  return `${a}–${b} ft`;
}

/** A plain-words size, e.g. "waist to chest". */
export function faceWords(mid: number): string {
  if (mid < 1) return 'flat';
  if (mid < 2) return 'ankle to knee';
  if (mid < 3) return 'knee to waist';
  if (mid < 4) return 'waist to chest';
  if (mid < 5) return 'chest to head';
  if (mid < 7) return 'head high to overhead';
  if (mid < 10) return 'well overhead';
  return 'double overhead +';
}
