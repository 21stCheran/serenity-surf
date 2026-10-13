/** Units, angles and time helpers. All times are epoch seconds (UTC) unless noted. */
import { SPOT } from './spot';

export const M_TO_FT = 3.28084;
export const KT_TO_KMH = 1.852;
export const TZ = SPOT.timezone;
export const IST_OFFSET_S = SPOT.utcOffsetMinutes * 60;

const COMPASS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function compass(deg: number | null | undefined): string {
  if (deg == null || Number.isNaN(deg)) return '–';
  return COMPASS16[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

/** Smallest absolute difference between two directions (0..180). */
export function relAngle(a: number, b: number): number {
  return Math.abs(((((a - b + 180) % 360) + 360) % 360) - 180);
}

/** Signed difference a-b wrapped to (-180, 180]. */
export function signedAngle(a: number, b: number): number {
  return ((((a - b + 180) % 360) + 360) % 360) - 180;
}

export function circMean(degs: number[], weights?: number[]): number | null {
  let s = 0;
  let c = 0;
  let n = 0;
  degs.forEach((d, i) => {
    if (d == null || Number.isNaN(d)) return;
    const w = weights ? weights[i] ?? 1 : 1;
    s += w * Math.sin((d * Math.PI) / 180);
    c += w * Math.cos((d * Math.PI) / 180);
    n++;
  });
  if (!n || (s === 0 && c === 0)) return null;
  return (((Math.atan2(s, c) * 180) / Math.PI) + 360) % 360;
}

export function median(xs: (number | null | undefined)[]): number | null {
  const v = xs.filter((x): x is number => x != null && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Piecewise-linear interpolation over sorted [x, y] points. */
export function interp(x: number, pts: [number, number][]): number {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return pts[pts.length - 1][1];
}

// ------------------------------------------------------------------ time (IST)

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opts });
    fmtCache.set(key, f);
  }
  return f;
}

export const fmtTime = (t: number) => fmt({ hour: '2-digit', minute: '2-digit', hour12: false }).format(t * 1000);
export const fmtHour = (t: number) => fmt({ hour: 'numeric', hour12: true }).format(t * 1000).replace(' ', '').toLowerCase();
export const fmtDay = (t: number) => fmt({ weekday: 'short', day: 'numeric', month: 'short' }).format(t * 1000);
export const fmtWeekday = (t: number) => fmt({ weekday: 'short' }).format(t * 1000);
export const fmtDate = (t: number) => fmt({ day: 'numeric', month: 'short', year: 'numeric' }).format(t * 1000);
export const fmtDateTime = (t: number) => `${fmtDay(t)} ${fmtTime(t)}`;
export const fmtMonth = (t: number) => fmt({ month: 'short', year: 'numeric' }).format(t * 1000);

/** IST calendar fields for an epoch-second time. */
export function ist(t: number) {
  const d = new Date((t + IST_OFFSET_S) * 1000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    weekday: d.getUTCDay(),
    doy: Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1,
  };
}

/** Epoch seconds of IST midnight for the IST day containing t. */
export function istDayStart(t: number): number {
  return Math.floor((t + IST_OFFSET_S) / 86400) * 86400 - IST_OFFSET_S;
}

/** Key like 2026-10-13 for the IST day of t. */
export function istDayKey(t: number): string {
  const f = ist(t);
  return `${f.year}-${String(f.month).padStart(2, '0')}-${String(f.day).padStart(2, '0')}`;
}

export const nowS = () => Math.floor(Date.now() / 1000);

export function relTime(t: number, now = nowS()): string {
  const d = t - now;
  const a = Math.abs(d);
  if (a < 90) return 'just now';
  const unit = a < 3600 ? [Math.round(a / 60), 'min'] : a < 86400 * 2 ? [Math.round(a / 3600), 'h'] : [Math.round(a / 86400), 'd'];
  return d >= 0 ? `in ${unit[0]} ${unit[1]}` : `${unit[0]} ${unit[1]} ago`;
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
