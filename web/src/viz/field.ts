/** Render a coarse wave-height grid (Field) into a canvas image for the map. */
import type { Field } from '../data/static';
import { BLUE, type Mode } from './theme';

export interface FieldGrid {
  lats: number[];
  lons: number[];
  idx: (number | null)[][]; // [ilat][ilon] -> point index in Field arrays
}

export function fieldGrid(f: Field): FieldGrid {
  const lats = [...new Set(f.lat)].sort((a, b) => a - b);
  const lons = [...new Set(f.lon)].sort((a, b) => a - b);
  const idx = lats.map(() => lons.map(() => null as number | null));
  f.lat.forEach((la, i) => {
    idx[lats.indexOf(la)][lons.indexOf(f.lon[i])] = i;
  });
  return { lats, lons, idx };
}

function rgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const HS_MAX = 4; // m at the strong end of the ramp

/** Hs (m) -> rgba. Calm water recedes into the map; strong swell glows. */
function hsColor(hs: number, mode: Mode): [number, number, number, number] {
  const ramp = mode === 'dark' ? [...BLUE].reverse() : BLUE;
  const x = Math.max(0, Math.min(1, hs / HS_MAX));
  const pos = Math.sqrt(x) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(pos));
  const f = pos - i;
  const a = rgb(ramp[i]);
  const b = rgb(ramp[i + 1]);
  const alpha = Math.min(0.88, 0.22 + x * 0.9);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, alpha];
}

export function renderField(
  f: Field,
  g: FieldGrid,
  step: number,
  mode: Mode,
  isLand?: (lat: number, lon: number) => boolean,
  pxPerDeg = 12,
): { url: string; coordinates: [[number, number], [number, number], [number, number], [number, number]] } {
  const lon0 = g.lons[0];
  const lon1 = g.lons[g.lons.length - 1];
  const lat0 = g.lats[0];
  const lat1 = g.lats[g.lats.length - 1];
  const W = Math.round((lon1 - lon0) * pxPerDeg);
  const H = Math.round((lat1 - lat0) * pxPerDeg);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const scale = 0.1;
  const val = (ila: number, ilo: number): number | null => {
    const i = g.idx[ila]?.[ilo];
    if (i == null) return null;
    const v = f.hs[i][step];
    return v == null ? null : v * scale;
  };
  const dLat = g.lats[1] - g.lats[0];
  const dLon = g.lons[1] - g.lons[0];
  for (let y = 0; y < H; y++) {
    const lat = lat1 - (y / H) * (lat1 - lat0);
    const fy = (lat - lat0) / dLat;
    const iy = Math.min(g.lats.length - 2, Math.max(0, Math.floor(fy)));
    const ty = fy - iy;
    for (let x = 0; x < W; x++) {
      const lon = lon0 + (x / W) * (lon1 - lon0);
      if (isLand && isLand(lat, lon)) continue;
      const fx = (lon - lon0) / dLon;
      const ix = Math.min(g.lons.length - 2, Math.max(0, Math.floor(fx)));
      const tx = fx - ix;
      const q = [
        [val(iy, ix), (1 - tx) * (1 - ty)],
        [val(iy, ix + 1), tx * (1 - ty)],
        [val(iy + 1, ix), (1 - tx) * ty],
        [val(iy + 1, ix + 1), tx * ty],
      ] as [number | null, number][];
      let s = 0;
      let w = 0;
      for (const [v, wt] of q) {
        if (v != null) {
          s += v * wt;
          w += wt;
        }
      }
      if (w < 0.02) continue;
      const [r, gg, b, a] = hsColor(s / w, mode);
      const o = (y * W + x) * 4;
      img.data[o] = r;
      img.data[o + 1] = gg;
      img.data[o + 2] = b;
      img.data[o + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  // direction arrows (where the waves are heading)
  ctx.fillStyle = mode === 'dark' ? 'rgba(255,255,255,0.75)' : 'rgba(11,11,11,0.6)';
  for (let ila = 0; ila < g.lats.length; ila++) {
    for (let ilo = 0; ilo < g.lons.length; ilo++) {
      const i = g.idx[ila][ilo];
      if (i == null) continue;
      const d = f.dir[i][step];
      const h = f.hs[i][step];
      if (d == null || h == null) continue;
      const px = (g.lons[ilo] - lon0) * pxPerDeg;
      const py = (lat1 - g.lats[ila]) * pxPerDeg;
      const ang = ((d + 180) * Math.PI) / 180; // heading
      const len = 2.5 + Math.min(5, h * scale * 1.6);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(0, -len);
      ctx.lineTo(2.2, len * 0.4);
      ctx.lineTo(0, len * 0.15);
      ctx.lineTo(-2.2, len * 0.4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  return {
    url: c.toDataURL('image/png'),
    coordinates: [
      [lon0, lat1],
      [lon1, lat1],
      [lon1, lat0],
      [lon0, lat0],
    ],
  };
}

export function fieldLegend(mode: Mode): { label: string; color: string }[] {
  return [0.5, 1, 1.5, 2, 3, 4].map((h) => {
    const [r, g, b] = hsColor(h, mode);
    return { label: `${h} m`, color: `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})` };
  });
}
