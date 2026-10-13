/** Design tokens (validated reference palette, light + dark) and colour scales. */
import type { Label } from '../core/types';

export type Mode = 'light' | 'dark';

export const TOKENS = {
  light: {
    page: '#f9f9f7',
    surface: '#fcfcfb',
    ink: '#0b0b0b',
    ink2: '#52514e',
    muted: '#898781',
    grid: '#e1e0d9',
    axis: '#c3c2b7',
    border: 'rgba(11,11,11,0.10)',
    success: '#006300',
  },
  dark: {
    page: '#0d0d0d',
    surface: '#1a1a19',
    ink: '#f0efec',
    ink2: '#c3c2b7',
    muted: '#898781',
    grid: '#2c2c2a',
    axis: '#383835',
    border: 'rgba(255,255,255,0.10)',
    success: '#0ca30c',
  },
} as const;

/** Categorical slots in fixed order (never cycled). */
export const SERIES = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
} as const;

/** Sequential blue ramp 100..700. */
export const BLUE = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];

export const STATUS = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' } as const;

/** Diverging (offshore blue <-> onshore red, neutral grey middle). */
export const DIVERGING = {
  light: { neg: '#2a78d6', mid: '#c3c2b7', pos: '#e34948' },
  dark: { neg: '#3987e5', mid: '#5c5b56', pos: '#e66767' },
} as const;

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
}
function lerpHex(a: string, b: string, f: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex(x[0] + (y[0] - x[0]) * f, x[1] + (y[1] - x[1]) * f, x[2] + (y[2] - x[2]) * f);
}

/** Continuous score colour: near-surface for 0, strongest step for 10. Light: light->dark; dark: dark->light. */
export function scoreColor(score: number, mode: Mode): string {
  const ramp = mode === 'light' ? BLUE : [...BLUE].reverse();
  const x = Math.max(0, Math.min(10, score)) / 10;
  const pos = x * (ramp.length - 1);
  const i = Math.floor(pos);
  const f = pos - i;
  return i >= ramp.length - 1 ? ramp[ramp.length - 1] : lerpHex(ramp[i], ramp[i + 1], f);
}

/** Ordinal steps for discrete labels (light end >= 2:1 on the surface). */
const LABEL_STEP: Record<Label, [number, number]> = {
  Flat: [1, 11],
  Poor: [3, 10],
  Fair: [5, 8],
  Good: [7, 6],
  Great: [9, 4],
  Epic: [12, 0],
};
export function labelColor(label: Label, mode: Mode): string {
  const [l, d] = LABEL_STEP[label];
  return BLUE[mode === 'light' ? l : d];
}

/** The ramp as stops for an ECharts visualMap (0..10). */
export function scorePieces(mode: Mode): string[] {
  return Array.from({ length: 11 }, (_, i) => scoreColor(i, mode));
}

/** Wind colour by angle to offshore (0 offshore .. 180 onshore). */
export function windColor(rel: number | null, ws: number | null, mode: Mode): string {
  const d = DIVERGING[mode];
  if (rel == null || ws == null || ws <= 3) return d.mid;
  const x = (1 - Math.cos((rel * Math.PI) / 180)) / 2; // 0 offshore, 1 onshore
  if (x < 0.5) return lerpHex(d.neg, d.mid, x / 0.5);
  return lerpHex(d.mid, d.pos, (x - 0.5) / 0.5);
}

export function sequential(x: number, mode: Mode): string {
  return scoreColor(x * 10, mode);
}

export function withAlpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
