/** Shared types for the surf engine (browser + Node). */

export interface WavePart {
  h: number; // significant height (m)
  p: number; // period, already on the peak-period scale (s)
  d: number; // direction the waves come FROM (deg)
  kind: 'swell' | 'wind';
}

/** One hour of conditions at the spot. Times are epoch seconds UTC. */
export interface HourInput {
  t: number;
  hs: number | null;
  tp: number | null;
  dir: number | null;
  parts?: WavePart[] | null;
  ws: number | null; // wind speed, knots
  wd: number | null; // wind FROM direction
  wg?: number | null;
  tide?: number | null; // m relative to MSL
  tideNorm?: number | null; // 0 low .. 1 high in the current cycle
  tideRising?: boolean | null;
  pr?: number | null; // precipitation mm/h
  pp?: number | null; // precipitation probability %
  cape?: number | null;
  wc?: number | null; // WMO weather code
  sst?: number | null;
  sl?: number | null; // modelled sea level incl. surge (m)
  rain48?: number | null; // rain in the previous 48 h (mm), for the water-quality flag
}

export type Label = 'Flat' | 'Poor' | 'Fair' | 'Good' | 'Great' | 'Epic';
export type WindType = 'glassy' | 'offshore' | 'cross-offshore' | 'cross-shore' | 'cross-onshore' | 'onshore';

export type FlagCode = 'cyclone-swell' | 'lightning' | 'water-quality' | 'surge' | 'dangerous' | 'big-surf';
export interface Flag {
  code: FlagCode;
  level: 'warning' | 'serious' | 'critical' | 'info';
  text: string;
}

export interface HourScore {
  t: number;
  score: number;
  label: Label;
  hb: number; // breaking height (m)
  faceLo: number; // ft
  faceHi: number; // ft
  faceMid: number; // ft
  tdom: number | null; // dominant period (s)
  swellDir: number | null;
  swellFrac: number | null; // share of energy in swell (vs local wind sea)
  size: number; // 0..10 size score
  periodF: number;
  windF: number;
  tideF: number;
  windType: WindType;
  windRel: number | null; // angle between wind and offshore (0 = pure offshore)
  daylight: boolean;
  flags: Flag[];
}

export interface Profile {
  id: string;
  name: string;
  board: string;
  blurb: string;
  size: [number, number][]; // face ft -> 0..10
  period: [number, number][]; // s -> factor
  onshorePenalty: number; // 0..1 multiplier on the wind penalty
  tidePref: number; // 0 low .. 1 high
  tideWeight: number; // 0..0.4
}

export interface Calibration {
  sizeMultiplier: number; // personal correction on face height
  siteFactor: number;
  faceLo: number;
  faceHi: number;
  beachNormal: number;
  offshoreFrom: number;
}
