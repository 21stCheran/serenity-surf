/** Hourly surf quality score (0-10) for a profile. */
import { DEFAULT_PROFILE } from './profiles';
import { isDaylight } from './sun';
import { DEFAULT_CAL, faceRange, surfAtBeach } from './surf';
import type { Calibration, Flag, HourInput, HourScore, Label, Profile, WindType } from './types';
import { clamp, interp, relAngle } from './units';

export const LABELS: { label: Label; min: number }[] = [
  { label: 'Flat', min: 0 },
  { label: 'Poor', min: 1 },
  { label: 'Fair', min: 2.5 },
  { label: 'Good', min: 4.5 },
  { label: 'Great', min: 6.5 },
  { label: 'Epic', min: 8.5 },
];

export function labelOf(score: number): Label {
  let l: Label = 'Flat';
  for (const x of LABELS) if (score >= x.min) l = x.label;
  return l;
}

export function windInfo(ws: number | null, wd: number | null, offshoreFrom = DEFAULT_CAL.offshoreFrom): { type: WindType; rel: number | null } {
  if (ws == null || wd == null) return { type: 'glassy', rel: null };
  const rel = relAngle(wd, offshoreFrom);
  if (ws <= 3) return { type: 'glassy', rel };
  if (rel <= 30) return { type: 'offshore', rel };
  if (rel <= 70) return { type: 'cross-offshore', rel };
  if (rel <= 110) return { type: 'cross-shore', rel };
  if (rel <= 150) return { type: 'cross-onshore', rel };
  return { type: 'onshore', rel };
}

/** 1 = no penalty. Onshore wind spoils the surface; very strong offshore also hurts. */
export function windFactor(ws: number | null, wd: number | null, profile: Profile = DEFAULT_PROFILE, offshoreFrom = DEFAULT_CAL.offshoreFrom): number {
  if (ws == null || wd == null) return 0.9;
  if (ws <= 3) return 1;
  const rel = relAngle(wd, offshoreFrom);
  const dirW = (1 - Math.cos((rel * Math.PI) / 180)) / 2;
  const penalty = 0.85 * clamp((ws - 3) / 15, 0, 1) ** 0.8 * profile.onshorePenalty;
  let f = 1 - dirW * penalty;
  if (rel < 60 && ws > 18) f -= Math.min(0.3, (ws - 18) / 30);
  return clamp(f, 0.1, 1);
}

export interface ScoreContext {
  cycloneSwell?: { name: string } | null;
  stormDistanceKm?: number | null;
}

export function scoreHour(x: HourInput, profile: Profile = DEFAULT_PROFILE, cal: Calibration = DEFAULT_CAL, ctx: ScoreContext = {}): HourScore {
  const s = surfAtBeach(x, cal);
  const face = faceRange(s.hb, cal);
  const size = interp(face.mid, profile.size);
  let periodF = s.tdom != null ? interp(s.tdom, profile.period) : 0.8;
  if (s.swellFrac != null) periodF *= 0.85 + 0.15 * s.swellFrac;
  const windF = windFactor(x.ws, x.wd, profile, cal.offshoreFrom);
  const wi = windInfo(x.ws, x.wd, cal.offshoreFrom);
  const tideF = x.tideNorm != null ? clamp(1 - profile.tideWeight * Math.abs(x.tideNorm - profile.tidePref) * 2, 0.5, 1) : 1;
  const score = clamp(size * periodF * windF * tideF, 0, 10);

  const flags: Flag[] = [];
  if (ctx.cycloneSwell) flags.push({ code: 'cyclone-swell', level: 'info', text: `Cyclone swell (${ctx.cycloneSwell.name})` });
  if (ctx.stormDistanceKm != null && ctx.stormDistanceKm < 300)
    flags.push({ code: 'dangerous', level: 'critical', text: `Storm ${Math.round(ctx.stormDistanceKm)} km away — stay out` });
  if ((x.wc != null && x.wc >= 95) || ((x.cape ?? 0) >= 2000 && (x.pr ?? 0) >= 1))
    flags.push({ code: 'lightning', level: 'critical', text: 'Thunderstorm risk' });
  if ((x.rain48 ?? 0) >= 50) flags.push({ code: 'water-quality', level: 'warning', text: `Runoff: ${Math.round(x.rain48 ?? 0)} mm rain in 48 h` });
  if (x.sl != null && x.tide != null && x.sl - x.tide >= 0.3)
    flags.push({ code: 'surge', level: 'serious', text: `Surge +${(x.sl - x.tide).toFixed(1)} m` });
  if (face.mid >= 8) flags.push({ code: 'big-surf', level: 'serious', text: 'Big, powerful surf' });

  return {
    t: x.t,
    score: Math.round(score * 10) / 10,
    label: labelOf(score),
    hb: s.hb,
    faceLo: face.lo,
    faceHi: face.hi,
    faceMid: face.mid,
    tdom: s.tdom,
    swellDir: s.dirDom,
    swellFrac: s.swellFrac,
    size,
    periodF,
    windF,
    tideF,
    windType: wi.type,
    windRel: wi.rel,
    daylight: isDaylight(x.t),
    flags,
  };
}

export function scoreMany(xs: HourInput[], profile?: Profile, cal?: Calibration, ctx?: (x: HourInput) => ScoreContext): HourScore[] {
  return xs.map((x) => scoreHour(x, profile, cal, ctx ? ctx(x) : {}));
}

/** Plain-language reasons behind a score, strongest first. */
export function explain(h: HourScore): string[] {
  const out: string[] = [];
  out.push(`${h.faceLo.toFixed(0)}–${h.faceHi.toFixed(0)} ft faces (size ${h.size.toFixed(1)}/10)`);
  if (h.tdom != null) out.push(`${h.tdom.toFixed(0)} s period (${h.periodF >= 0.97 ? 'groundswell' : h.periodF >= 0.85 ? 'decent swell' : 'short, weak'})`);
  const wl: Record<WindType, string> = {
    glassy: 'glassy, almost no wind',
    offshore: 'offshore wind grooming the faces',
    'cross-offshore': 'cross-offshore wind',
    'cross-shore': 'cross-shore wind',
    'cross-onshore': 'cross-onshore wind roughing it up',
    onshore: 'onshore wind making it messy',
  };
  out.push(`${wl[h.windType]} (×${h.windF.toFixed(2)})`);
  if (h.tideF < 0.99) out.push(`tide off your preferred stage (×${h.tideF.toFixed(2)})`);
  return out;
}
