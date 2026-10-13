/** Season / history charts. */
import type { DayStat } from '../core/history';
import { compass, fmtDate, MONTHS } from '../core/units';
import type { Climatology } from '../data/static';
import { cellSeries } from './charts';
import type { EOption } from './EChart';
import { BLUE, scoreColor, SERIES, TOKENS, withAlpha, type Mode } from './theme';

/** Radial calendar: angle = day of year (Jan at the top, clockwise), ring = year. */
export function climateWheelOption(days: DayStat[], mode: Mode, metric: 'best' | 'face' = 'best'): EOption {
  const years = [...new Set(days.map((d) => d.year))].sort();
  const t = TOKENS[mode];
  const val = (d: DayStat) => (metric === 'best' ? d.best : Math.min(10, d.maxFace * 1.25));
  const data = days.map((d) => [d.doy, years.indexOf(d.year), val(d), d.cyclone ? 1 : 0, d.t]);
  const geom = (api: any) => {
    const w = api.getWidth();
    const h = api.getHeight();
    const R = Math.min(w, h) / 2 - 26;
    return { cx: w / 2, cy: h / 2, R, r0: R * 0.22 };
  };
  return {
    tooltip: {
      trigger: 'item',
      formatter: (p: any) => {
        const d = days[p.dataIndex];
        return `<b>${fmtDate(d.t)}</b><br/>Best session ${d.best.toFixed(1)} (${d.label})<br/>Max ${d.maxFace.toFixed(0)} ft faces${d.tp ? ` · ${d.tp.toFixed(0)} s ${compass(d.dir)}` : ''}${d.cyclone ? `<br/>Cyclone swell: ${d.cyclone}` : ''}`;
      },
    },
    series: [
      {
        type: 'custom',
        coordinateSystem: 'none',
        renderItem: (_params: any, api: any) => {
          const { cx, cy, R, r0 } = geom(api);
          const doy = api.value(0);
          const yi = api.value(1);
          const band = (R - r0) / years.length;
          const a0 = -Math.PI / 2 + ((doy - 1) / 366) * Math.PI * 2;
          const a1 = a0 + (Math.PI * 2) / 366 + 0.002;
          const cyc = api.value(3) === 1;
          return {
            type: 'sector',
            shape: { cx, cy, r0: r0 + yi * band + 0.6, r: r0 + (yi + 1) * band - 0.6, startAngle: a0, endAngle: a1, clockwise: true },
            style: { fill: scoreColor(api.value(2), mode), stroke: cyc ? (mode === 'dark' ? '#ffffff' : '#0b0b0b') : undefined, lineWidth: cyc ? 0.6 : 0 },
          };
        },
        data,
        animation: false,
      } as any,
      {
        type: 'custom',
        coordinateSystem: 'none',
        silent: true,
        renderItem: (params: any, api: any) => {
          if (params.dataIndex !== 0) return null;
          const { cx, cy, R, r0 } = geom(api);
          const children: any[] = [];
          const starts = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
          starts.forEach((doy, m) => {
            const a = -Math.PI / 2 + ((doy - 1) / 366) * Math.PI * 2;
            children.push({ type: 'line', shape: { x1: cx + Math.cos(a) * r0, y1: cy + Math.sin(a) * r0, x2: cx + Math.cos(a) * (R + 4), y2: cy + Math.sin(a) * (R + 4) }, style: { stroke: t.grid, lineWidth: 1 } });
            const am = a + ((15 / 366) * Math.PI * 2);
            children.push({ type: 'text', x: cx + Math.cos(am) * (R + 14), y: cy + Math.sin(am) * (R + 14), style: { text: MONTHS[m], fill: t.muted, fontSize: 11, align: 'center', verticalAlign: 'middle' } });
          });
          const band = (R - r0) / years.length;
          years.forEach((y, i) => {
            if (i % 2 && i !== years.length - 1) return;
            children.push({ type: 'text', x: cx + 3, y: cy - (r0 + (i + 0.5) * band), style: { text: String(y), fill: t.ink2, fontSize: 9, align: 'left', verticalAlign: 'middle' } });
          });
          children.push({ type: 'text', x: cx, y: cy, style: { text: metric === 'best' ? 'surf\nscore' : 'size', fill: t.muted, fontSize: 11, align: 'center', verticalAlign: 'middle' } });
          return { type: 'group', children };
        },
        data: [[0]],
        animation: false,
      } as any,
    ],
  };
}

export function weekOddsOption(rows: { week: number; good: number; great: number; cyclone: number }[], mode: Mode): EOption {
  const s = SERIES[mode];
  const months = MONTHS;
  return {
    grid: { left: 40, right: 12, top: 34, bottom: 26 },
    legend: { data: ['Good+ day', 'Great+ day', 'Cyclone swell day'] },
    xAxis: { type: 'category', data: rows.map((r) => r.week), axisLabel: { interval: (i: number) => i % 4 === 0 || false, formatter: (v: string) => months[Math.min(11, Math.floor(((+v - 1) * 7) / 30.5))] } },
    yAxis: { type: 'value', name: '% of days', min: 0, max: 100 },
    tooltip: { trigger: 'axis', formatter: (ps: any) => `Week ${rows[ps[0].dataIndex].week} (${months[Math.min(11, Math.floor(((rows[ps[0].dataIndex].week - 1) * 7) / 30.5))]})<br/>` + ps.map((p: any) => `${p.marker}${p.seriesName}: ${Number(p.value).toFixed(0)}%`).join('<br/>') },
    series: [
      { type: 'line', name: 'Good+ day', data: rows.map((r) => +r.good.toFixed(1)), smooth: true, showSymbol: false, lineStyle: { width: 2, color: s[0] }, itemStyle: { color: s[0] }, areaStyle: { color: withAlpha(s[0], 0.1) } },
      { type: 'line', name: 'Great+ day', data: rows.map((r) => +r.great.toFixed(1)), smooth: true, showSymbol: false, lineStyle: { width: 2, color: s[1] }, itemStyle: { color: s[1] } },
      { type: 'line', name: 'Cyclone swell day', data: rows.map((r) => +r.cyclone.toFixed(1)), smooth: true, showSymbol: false, lineStyle: { width: 2, color: s[2] }, itemStyle: { color: s[2] } },
    ],
  };
}

export function monthHourOption(mh: number[][], mode: Mode): EOption {
  const data: number[][] = [];
  mh.forEach((row, m) => row.forEach((v, h) => Number.isFinite(v) && data.push([h, m, +v.toFixed(2)])));
  // relative colouring so the daily rhythm stands out (absolute values are in the tooltip)
  const vals = data.map((d) => d[2]);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const rel = (v: number) => (hi > lo ? ((v - lo) / (hi - lo)) * 10 : 5);
  return {
    grid: { left: 40, right: 10, top: 8, bottom: 26 },
    xAxis: { type: 'category', data: Array.from({ length: 24 }, (_, h) => `${h}:30`), axisLabel: { interval: 2 }, splitLine: { show: false }, axisLine: { show: false } },
    yAxis: { type: 'category', data: MONTHS, inverse: true, splitLine: { show: false }, axisLine: { show: false } },
    tooltip: { formatter: (p: any) => `${MONTHS[p.data[1]]}, ${p.data[0]}:30 IST<br/>average score ${p.data[2].toFixed(1)}` },
    series: [cellSeries(data, (d) => scoreColor(rel(d[2]), mode))],
  };
}

export function seaBreezeOption(c: Climatology, mode: Mode): EOption {
  const s = SERIES[mode];
  const fmt = (v: number | null) => (v == null ? '–' : `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, '0')}`);
  return {
    grid: { left: 44, right: 12, top: 34, bottom: 26 },
    legend: { data: ['Model (IFS 9 km)', 'Airport observations'] },
    xAxis: { type: 'category', data: MONTHS },
    yAxis: { type: 'value', name: 'hour (IST)', min: 8, max: 16, inverse: false },
    tooltip: { trigger: 'axis', formatter: (ps: any) => `${MONTHS[ps[0].dataIndex]}<br/>` + ps.map((p: any) => `${p.marker}${p.seriesName}: onshore from ~${fmt(p.value)}`).join('<br/>') },
    series: [
      { type: 'line', name: 'Model (IFS 9 km)', data: c.seaBreeze.model, showSymbol: true, symbolSize: 8, lineStyle: { width: 2, color: s[0] }, itemStyle: { color: s[0] } },
      ...(c.seaBreeze.airport ? [{ type: 'line' as const, name: 'Airport observations', data: c.seaBreeze.airport, showSymbol: true, symbolSize: 8, lineStyle: { width: 2, color: s[1] }, itemStyle: { color: s[1] } }] : []),
    ],
  };
}

/** Wave or wind rose for one month: stacked polar bars by speed/height bin (ordinal ramp). */
export function roseOption(rose: number[][], bins: number[], unit: string, mode: Mode): EOption {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const steps = mode === 'light' ? [3, 5, 7, 9, 11] : [9, 7, 5, 3, 1];
  const names = bins.map((b, i) => (i < bins.length - 1 ? `${b}–${bins[i + 1]} ${unit}` : `${b}+ ${unit}`));
  return {
    angleAxis: { type: 'category', data: dirs, startAngle: 90 + 11.25, axisLine: { lineStyle: { color: TOKENS[mode].axis } }, axisLabel: { color: TOKENS[mode].muted, fontSize: 10 } },
    radiusAxis: { axisLabel: { show: false }, splitLine: { lineStyle: { color: TOKENS[mode].grid } }, axisLine: { show: false } },
    polar: { radius: ['6%', '72%'] },
    legend: { data: names, bottom: 0, top: 'auto', itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 10.5 } },
    tooltip: { trigger: 'item', formatter: (p: any) => `${p.name}: ${p.seriesName} — ${Number(p.value).toFixed(1)}% of hours` },
    series: names.map((n, b) => ({
      type: 'bar' as const,
      coordinateSystem: 'polar' as const,
      stack: 'r',
      name: n,
      data: rose.map((row) => row[b]),
      itemStyle: { color: BLUE[steps[b]], borderColor: TOKENS[mode].surface, borderWidth: 1 },
    })),
  } as any;
}

export function faceBoxOption(boxes: number[][], mode: Mode): EOption {
  const s = SERIES[mode][0];
  return {
    grid: { left: 40, right: 12, top: 14, bottom: 26 },
    xAxis: { type: 'category', data: MONTHS },
    yAxis: { type: 'value', name: 'ft', min: 0 },
    tooltip: { trigger: 'item', formatter: (p: any) => `${MONTHS[p.dataIndex]} daily max face<br/>10%: ${p.data[1].toFixed(1)} · 25%: ${p.data[2].toFixed(1)} · median ${p.data[3].toFixed(1)} · 75%: ${p.data[4].toFixed(1)} · 90%: ${p.data[5].toFixed(1)} ft` },
    series: [{ type: 'boxplot', data: boxes, itemStyle: { color: withAlpha(s, 0.15), borderColor: s, borderWidth: 1.5 }, boxWidth: [8, 22] }],
  };
}

export function rainOption(c: Climatology, year: string | null, mode: Mode): EOption {
  const s = SERIES[mode];
  const yr = year ? c.rain.byYear[year] : null;
  return {
    grid: { left: 44, right: 12, top: 34, bottom: 26 },
    legend: { data: ['Average 1980–2025', ...(yr ? [year!] : [])] },
    xAxis: { type: 'category', data: MONTHS },
    yAxis: { type: 'value', name: 'mm' },
    tooltip: { trigger: 'axis', valueFormatter: (v: any) => (v == null ? '–' : `${Math.round(v)} mm`) },
    series: [
      { type: 'bar', name: 'Average 1980–2025', data: c.rain.monthlyMean1980, barMaxWidth: 22, itemStyle: { color: s[0], borderRadius: [4, 4, 0, 0] } },
      ...(yr ? [{ type: 'line' as const, name: year!, data: yr, symbolSize: 8, lineStyle: { width: 2, color: s[1] }, itemStyle: { color: s[1] } }] : []),
    ],
  };
}

/** Calendar heatmap for one year of daily best scores. */
export function calendarOption(days: DayStat[], year: number, mode: Mode): EOption {
  const sel = days.filter((d) => d.year === year);
  const data = sel.map((d) => [d.key, d.best, d.cyclone ? 1 : 0]);
  const t = TOKENS[mode];
  return {
    tooltip: { formatter: (p: any) => { const d = sel[p.dataIndex]; return `<b>${fmtDate(d.t)}</b><br/>${d.label} · best ${d.best.toFixed(1)}<br/>max ${d.maxFace.toFixed(0)} ft${d.cyclone ? `<br/>Cyclone swell: ${d.cyclone}` : ''}`; } },
    calendar: {
      range: String(year),
      top: 28,
      left: 34,
      right: 8,
      cellSize: ['auto', 15],
      splitLine: { show: false },
      itemStyle: { color: 'transparent', borderColor: 'transparent' },
      dayLabel: { color: t.muted, fontSize: 10, firstDay: 1, nameMap: ['S', 'M', 'T', 'W', 'T', 'F', 'S'] },
      monthLabel: { color: t.muted, fontSize: 11 },
      yearLabel: { show: false },
    },
    series: [
      {
        type: 'custom',
        coordinateSystem: 'calendar',
        renderItem: (params: any, api: any) => {
          const p = api.coord(api.value(0));
          const cw = params.coordSys.cellWidth;
          const ch = params.coordSys.cellHeight;
          const cyc = api.value(2) === 1;
          return {
            type: 'rect',
            shape: { x: p[0] - cw / 2 + 1, y: p[1] - ch / 2 + 1, width: cw - 2, height: ch - 2, r: 2 },
            style: { fill: scoreColor(api.value(1), mode), stroke: cyc ? (mode === 'dark' ? '#fff' : '#0b0b0b') : undefined, lineWidth: cyc ? 1 : 0 },
          };
        },
        data,
      } as any,
    ],
  };
}

export function compareOption(a: DayStat[], b: DayStat[], la: string, lb: string, mode: Mode): EOption {
  const s = SERIES[mode];
  const n = Math.max(a.length, b.length);
  return {
    grid: { left: 36, right: 12, top: 34, bottom: 26 },
    legend: { data: [la, lb] },
    xAxis: { type: 'category', data: Array.from({ length: n }, (_, i) => i + 1), name: 'day' },
    yAxis: { type: 'value', min: 0, max: 10, name: 'best score' },
    tooltip: { trigger: 'axis', valueFormatter: (v: any) => (v == null ? '–' : Number(v).toFixed(1)) },
    series: [
      { type: 'line', name: la, data: a.map((d) => +d.best.toFixed(1)), showSymbol: false, lineStyle: { width: 2, color: s[0] }, itemStyle: { color: s[0] } },
      { type: 'line', name: lb, data: b.map((d) => +d.best.toFixed(1)), showSymbol: false, lineStyle: { width: 2, color: s[1] }, itemStyle: { color: s[1] } },
    ],
  };
}
