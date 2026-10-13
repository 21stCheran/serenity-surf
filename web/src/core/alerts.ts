/** The phone-alert JSON (api/alert.json) read by an iOS Shortcut / Android automation. */
import type { StormAssessment } from './live';
import { faceText } from './surf';
import { tideWord as tideWordFromNorm } from './tide';
import type { HourScore, Label } from './types';
import { compass, fmtDay, fmtTime, istDayKey } from './units';
import { dailySummaries, type Session } from './windows';

export const THRESHOLDS = { good: 4.5, great: 6.5, epic: 8.5, cycloneFaceFt: 4 };

export interface AlertWindow {
  day: string;
  start: string; // HH:MM IST
  end: string;
  start_epoch: number;
  score: number;
  label: Label;
  face_ft: [number, number];
  face_text: string;
  period_s: number | null;
  swell_dir: string;
  swell_dir_deg: number | null;
  wind_kt: number | null;
  wind_type: string;
  tide: string | null;
  summary: string;
}

export interface Alert {
  schema: 1;
  generated_at: string;
  generated_epoch: number;
  valid_for: string;
  notify: boolean;
  notify_great: boolean;
  level: 'none' | 'good' | 'great' | 'epic' | 'cyclone';
  title: string;
  message: string;
  score: number;
  today: AlertWindow | null;
  tomorrow: AlertWindow | null;
  next_great: AlertWindow | null;
  cyclone: {
    active: boolean;
    name: string | null;
    category: string | null;
    distance_km: number | null;
    swell_eta: string | null;
    swell_eta_epoch: number | null;
    expected_face_ft: [number, number] | null;
  };
  thresholds: typeof THRESHOLDS;
  profile: string;
  url: string;
}

export function windowOf(s: Session, windKt: (t: number) => number | null, tideAt: (t: number) => { norm: number; rising: boolean } | null): AlertWindow {
  const p = s.peak;
  const st = tideAt(s.start + 3600);
  const fr: [number, number] = [Math.round(p.faceLo), Math.max(Math.round(p.faceLo) + 1, Math.round(p.faceHi))];
  const ws = windKt(p.t);
  const parts = [
    `${fmtTime(s.start)}–${fmtTime(s.end)}`,
    `${s.score.toFixed(1)}/10`,
    `${faceText(p.faceLo, p.faceHi)}${p.tdom ? ` @ ${Math.round(p.tdom)} s` : ''} ${compass(p.swellDir)}`,
    `${ws != null ? Math.round(ws) + ' kt ' : ''}${p.windType}`,
  ];
  if (st) parts.push(`tide ${tideWordFromNorm(st.norm, st.rising)}`);
  return {
    day: istDayKey(s.start),
    start: fmtTime(s.start),
    end: fmtTime(s.end),
    start_epoch: s.start,
    score: s.score,
    label: s.label,
    face_ft: fr,
    face_text: faceText(p.faceLo, p.faceHi),
    period_s: p.tdom != null ? Math.round(p.tdom) : null,
    swell_dir: compass(p.swellDir),
    swell_dir_deg: p.swellDir != null ? Math.round(p.swellDir) : null,
    wind_kt: ws != null ? Math.round(ws) : null,
    wind_type: p.windType,
    tide: st ? tideWordFromNorm(st.norm, st.rising) : null,
    summary: parts.join(' · '),
  };
}

export function buildAlert(args: {
  hours: HourScore[];
  storms: StormAssessment[];
  now: number;
  profile: string;
  url: string;
  windKt: (t: number) => number | null;
  tideAt: (t: number) => { norm: number; rising: boolean } | null;
}): Alert {
  const { hours, storms, now } = args;
  // only sessions that can still be surfed (the current hour counts)
  const days = dailySummaries(hours.filter((h) => h.t >= now - 1800));
  const todayKey = istDayKey(now);
  const today = days.find((d) => d.day === todayKey);
  const tomorrow = days.find((d) => d.t > (today?.t ?? now));
  const w = (s: Session | null | undefined) => (s ? windowOf(s, args.windKt, args.tideAt) : null);
  const tw = w(today?.best);
  const tm = w(tomorrow?.best);
  const great = days.find((d) => d.t >= (today?.t ?? now) && d.best && d.best.score >= THRESHOLDS.great && d.best.start > now);
  const ng = w(great?.best);

  const rel = storms.filter((s) => s.relevant && s.peakFaceHi >= THRESHOLDS.cycloneFaceFt && (s.peakTime ?? 0) > now - 6 * 3600);
  const cyc = rel[0];
  const cycSoon = !!cyc && (cyc.firstArrival ?? cyc.peakTime ?? Infinity) - now < 72 * 3600;

  const score = tw?.score ?? 0;
  let level: Alert['level'] = 'none';
  if (score >= THRESHOLDS.good) level = 'good';
  if (score >= THRESHOLDS.great) level = 'great';
  if (score >= THRESHOLDS.epic) level = 'epic';
  if (cycSoon) level = 'cyclone';

  let title = 'Serenity: no session worth the drive today';
  let message = tw ? `Best: ${tw.summary}` : 'No daylight forecast available.';
  if (level === 'good' || level === 'great' || level === 'epic') {
    title = `Serenity: ${tw!.label} surf ${tw!.start}–${tw!.end}`;
    message = tw!.summary;
  }
  if (level === 'cyclone' && cyc) {
    const eta = cyc.firstArrival ?? cyc.peakTime;
    title = `Cyclone swell: ${cyc.name} → ${Math.round(cyc.peakFaceLo)}–${Math.round(cyc.peakFaceHi)} ft`;
    message = `${cyc.category.name} ${Math.round(cyc.distanceKm)} km away. Swell arriving ~${eta ? fmtDay(eta) + ' ' + fmtTime(eta) : 'soon'}.${tw ? ' Today: ' + tw.summary : ''}`;
  }
  return {
    schema: 1,
    generated_at: new Date(now * 1000).toISOString(),
    generated_epoch: now,
    valid_for: todayKey,
    notify: level !== 'none',
    notify_great: level === 'great' || level === 'epic' || level === 'cyclone',
    level,
    title,
    message,
    score,
    today: tw,
    tomorrow: tm,
    next_great: ng,
    cyclone: {
      active: storms.some((s) => s.relevant),
      name: cyc?.name ?? null,
      category: cyc?.category.name ?? null,
      distance_km: cyc ? Math.round(cyc.distanceKm) : null,
      swell_eta: cyc && (cyc.firstArrival ?? cyc.peakTime) ? `${fmtDay((cyc.firstArrival ?? cyc.peakTime)!)} ${fmtTime((cyc.firstArrival ?? cyc.peakTime)!)}` : null,
      swell_eta_epoch: cyc ? cyc.firstArrival ?? cyc.peakTime : null,
      expected_face_ft: cyc ? [Math.round(cyc.peakFaceLo), Math.round(cyc.peakFaceHi)] : null,
    },
    thresholds: THRESHOLDS,
    profile: args.profile,
    url: args.url,
  };
}
