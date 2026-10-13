/** Best-session finder and daily summaries. */
import { labelOf } from './score';
import type { HourScore, Label } from './types';
import { istDayKey, istDayStart } from './units';

export interface Session {
  start: number;
  end: number; // exclusive end time
  score: number;
  label: Label;
  peak: HourScore;
  hours: HourScore[];
  day: string;
}

export interface DaySummary {
  day: string;
  t: number; // IST midnight
  best: Session | null;
  maxScore: number;
  meanScore: number;
  label: Label;
  am: number | null; // mean score 05:00-11:00
  pm: number | null; // mean score 12:00-18:00
  hours: HourScore[];
}

function windowScore(hs: HourScore[]): number {
  const mean = hs.reduce((a, h) => a + h.score, 0) / hs.length;
  const min = Math.min(...hs.map((h) => h.score));
  return 0.75 * mean + 0.25 * min;
}

export function sessionsForDay(hours: HourScore[], perDay = 2, minLen = 2, maxLen = 3): Session[] {
  const day = hours.filter((h) => h.daylight).sort((a, b) => a.t - b.t);
  const cands: Session[] = [];
  for (let i = 0; i < day.length; i++) {
    for (let L = minLen; L <= maxLen; L++) {
      const w = day.slice(i, i + L);
      if (w.length < L) break;
      if (w[w.length - 1].t - w[0].t !== (L - 1) * 3600) continue;
      const sc = windowScore(w);
      const peak = w.reduce((a, b) => (b.score > a.score ? b : a));
      cands.push({ start: w[0].t, end: w[w.length - 1].t + 3600, score: Math.round(sc * 10) / 10, label: labelOf(sc), peak, hours: w, day: istDayKey(w[0].t) });
    }
  }
  // prefer higher score, then longer
  cands.sort((a, b) => b.score - a.score || b.hours.length - a.hours.length);
  const picked: Session[] = [];
  for (const c of cands) {
    if (picked.length >= perDay) break;
    if (picked.some((p) => c.start < p.end + 3600 && p.start < c.end + 3600)) continue;
    picked.push(c);
  }
  return picked.sort((a, b) => a.start - b.start);
}

export function byDay(hours: HourScore[]): Map<string, HourScore[]> {
  const m = new Map<string, HourScore[]>();
  for (const h of hours) {
    const k = istDayKey(h.t);
    let a = m.get(k);
    if (!a) m.set(k, (a = []));
    a.push(h);
  }
  return m;
}

export function dailySummaries(hours: HourScore[]): DaySummary[] {
  const out: DaySummary[] = [];
  for (const [day, hs] of byDay(hours)) {
    const light = hs.filter((h) => h.daylight);
    const sess = sessionsForDay(hs, 1);
    const hourOf = (h: HourScore) => (new Date((h.t + 19800) * 1000)).getUTCHours();
    const am = light.filter((h) => hourOf(h) >= 5 && hourOf(h) <= 11);
    const pm = light.filter((h) => hourOf(h) >= 12 && hourOf(h) <= 18);
    const mean = (xs: HourScore[]) => (xs.length ? xs.reduce((a, h) => a + h.score, 0) / xs.length : null);
    const maxScore = light.length ? Math.max(...light.map((h) => h.score)) : 0;
    const best = sess[0] ?? null;
    out.push({
      day,
      t: istDayStart(hs[0].t),
      best,
      maxScore,
      meanScore: mean(light) ?? 0,
      label: labelOf(best ? best.score : maxScore),
      am: mean(am),
      pm: mean(pm),
      hours: hs,
    });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Top sessions across a range, at most one per day. */
export function topSessions(hours: HourScore[], n = 5, minScore = 0): Session[] {
  const all: Session[] = [];
  for (const [, hs] of byDay(hours)) {
    const s = sessionsForDay(hs, 1)[0];
    if (s && s.score >= minScore) all.push(s);
  }
  return all.sort((a, b) => b.score - a.score).slice(0, n);
}
