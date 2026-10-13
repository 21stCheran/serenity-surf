/** Derived statistics from the scored hourly history (profile-dependent). */
import type { StormRecord } from '../data/static';
import { labelOf } from './score';
import type { HourInput, HourScore, Label } from './types';
import { ist, istDayKey, istDayStart } from './units';
import { sessionsForDay } from './windows';

export interface DayStat {
  t: number; // IST midnight
  key: string;
  year: number;
  month: number; // 1..12
  doy: number; // 1..366
  week: number; // 1..53
  best: number; // best 2-3 h session score
  label: Label;
  bestStart: number | null;
  maxFace: number; // daylight max face (ft, mid)
  amScore: number | null; // 05:30-10:30
  pmScore: number | null; // 12:30-17:30
  rain: number; // mm
  offshoreAM: number | null; // share of morning hours with offshore/glassy/cross-offshore wind
  hs: number | null; // daily max offshore Hs
  tp: number | null; // period at the best hour
  dir: number | null;
  cyclone: string | null; // storm name if a cyclone swell was running
}

export interface CycloneDayIndex {
  [dayKey: string]: string;
}

/** Days on which a historical storm's swell was running at Serenity (gain >= 0.5 m). */
export function cycloneDays(storms: StormRecord[]): CycloneDayIndex {
  const out: CycloneDayIndex = {};
  for (const s of storms) {
    const r = s.response;
    if (!r || r.confounded || r.attributedHs == null || r.attributedHs - r.baseHs < 0.5) continue;
    const name = s.name || `${s.season} storm`;
    const peak = r.peakTime;
    for (let t = peak - 42 * 3600; t <= peak + 42 * 3600; t += 3600 * 6) out[istDayKey(t)] = name;
  }
  return out;
}

export function dayStats(hours: HourScore[], inputs: HourInput[], cyc: CycloneDayIndex = {}): DayStat[] {
  const byDay = new Map<string, { hs: HourScore[]; xs: HourInput[] }>();
  for (let i = 0; i < hours.length; i++) {
    const k = istDayKey(hours[i].t);
    let d = byDay.get(k);
    if (!d) byDay.set(k, (d = { hs: [], xs: [] }));
    d.hs.push(hours[i]);
    d.xs.push(inputs[i]);
  }
  const out: DayStat[] = [];
  for (const [key, d] of byDay) {
    if (d.hs.length < 18) continue; // partial day at the edges
    const f = ist(d.hs[0].t);
    const light = d.hs.filter((h) => h.daylight);
    const s = sessionsForDay(d.hs, 1)[0];
    const hourOf = (h: HourScore) => ist(h.t).hour;
    const am = light.filter((h) => hourOf(h) >= 5 && hourOf(h) <= 10);
    const pm = light.filter((h) => hourOf(h) >= 12 && hourOf(h) <= 17);
    const mean = (xs: HourScore[]) => (xs.length ? xs.reduce((a, h) => a + h.score, 0) / xs.length : null);
    const offAM = am.length ? am.filter((h) => h.windType === 'offshore' || h.windType === 'glassy' || h.windType === 'cross-offshore').length / am.length : null;
    const peak = s?.peak ?? light.reduce<HourScore | null>((a, b) => (!a || b.score > a.score ? b : a), null);
    const hsMax = d.xs.reduce<number | null>((a, x) => (x.hs != null && (a == null || x.hs > a) ? x.hs : a), null);
    out.push({
      t: istDayStart(d.hs[0].t),
      key,
      year: f.year,
      month: f.month,
      doy: f.doy,
      week: Math.min(53, Math.floor((f.doy - 1) / 7) + 1),
      best: s ? s.score : 0,
      label: labelOf(s ? s.score : 0),
      bestStart: s?.start ?? null,
      maxFace: light.length ? Math.max(...light.map((h) => h.faceMid)) : 0,
      amScore: mean(am),
      pmScore: mean(pm),
      rain: d.xs.reduce((a, x) => a + (x.pr ?? 0), 0),
      offshoreAM: offAM,
      hs: hsMax,
      tp: peak?.tdom ?? null,
      dir: peak?.swellDir ?? null,
      cyclone: cyc[key] ?? null,
    });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Share of days per week of year meeting each threshold (smoothed over +/-1 week). */
export function weekOdds(days: DayStat[]): { week: number; good: number; great: number; cyclone: number; n: number }[] {
  const out = [];
  for (let w = 1; w <= 52; w++) {
    const sel = days.filter((d) => Math.abs(((d.week - w + 52 + 26) % 52) - 26) <= 1);
    const n = sel.length || 1;
    out.push({
      week: w,
      good: (sel.filter((d) => d.best >= 4.5).length / n) * 100,
      great: (sel.filter((d) => d.best >= 6.5).length / n) * 100,
      cyclone: (sel.filter((d) => d.cyclone).length / n) * 100,
      n: sel.length,
    });
  }
  return out;
}

/** Mean daylight score by month x hour (IST). NaN where never daylight. */
export function monthHour(hours: HourScore[]): number[][] {
  const sum = Array.from({ length: 12 }, () => new Array(24).fill(0));
  const cnt = Array.from({ length: 12 }, () => new Array(24).fill(0));
  for (const h of hours) {
    if (!h.daylight) continue;
    const f = ist(h.t);
    sum[f.month - 1][f.hour] += h.score;
    cnt[f.month - 1][f.hour]++;
  }
  return sum.map((row, m) => row.map((s, h) => (cnt[m][h] > 20 ? s / cnt[m][h] : NaN)));
}

export function quantiles(xs: number[], qs: number[]): number[] {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return qs.map(() => NaN);
  return qs.map((q) => {
    const p = q * (v.length - 1);
    const i = Math.floor(p);
    const f = p - i;
    return i + 1 < v.length ? v[i] + (v[i + 1] - v[i]) * f : v[i];
  });
}

/** Daily max face per month: [p10, p25, p50, p75, p90]. */
export function monthlyFaceBoxes(days: DayStat[]): number[][] {
  return Array.from({ length: 12 }, (_, m) => quantiles(days.filter((d) => d.month === m + 1).map((d) => d.maxFace), [0.1, 0.25, 0.5, 0.75, 0.9]));
}

export interface PeriodStats {
  days: number;
  good: number;
  great: number;
  epic: number;
  meanBest: number;
  meanFace: number;
  maxFace: number;
  offshoreMornings: number; // %
  rain: number;
  cycloneDays: number;
}

export function periodStats(days: DayStat[]): PeriodStats {
  const n = days.length || 1;
  return {
    days: days.length,
    good: days.filter((d) => d.best >= 4.5).length,
    great: days.filter((d) => d.best >= 6.5).length,
    epic: days.filter((d) => d.best >= 8.5).length,
    meanBest: days.reduce((a, d) => a + d.best, 0) / n,
    meanFace: days.reduce((a, d) => a + d.maxFace, 0) / n,
    maxFace: days.reduce((a, d) => Math.max(a, d.maxFace), 0),
    offshoreMornings: (days.filter((d) => (d.offshoreAM ?? 0) >= 0.5).length / n) * 100,
    rain: days.reduce((a, d) => a + d.rain, 0),
    cycloneDays: days.filter((d) => d.cyclone).length,
  };
}

/** Climatological odds for a calendar window (by day-of-year, all years). */
export function windowOdds(days: DayStat[], doyFrom: number, doyTo: number, pad = 0) {
  const inWin = (doy: number) => {
    const a = (doyFrom - pad + 366) % 366;
    const b = (doyTo + pad) % 366;
    return a <= b ? doy >= a && doy <= b : doy >= a || doy <= b;
  };
  const sel = days.filter((d) => inWin(d.doy));
  return { sel, stats: periodStats(sel) };
}
