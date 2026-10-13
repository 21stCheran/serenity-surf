import type { CycloneModel, StormSwell } from '../core/cyclone';
import { compass, fmtDate, fmtDateTime, fmtDay, MONTHS } from '../core/units';
import type { Climatology, Genesis, Indices, StormRecord, StormSeries } from '../data/static';
import type { EOption } from './EChart';
import { BLUE, SERIES, TOKENS, windColor, withAlpha, type Mode } from './theme';

const tAxis = (show = true) => ({
  type: 'time' as const,
  axisLabel: { show, hideOverlap: true, formatter: (v: number) => fmtDay(v / 1000) },
  splitLine: { show: false },
});

/** Predicted offshore wave height at Serenity from a storm (likely + 10–90% band). */
export function stormSwellOption(sw: StormSwell, mode: Mode): EOption {
  const c = SERIES[mode][1];
  const tl = sw.timeline;
  return {
    grid: { left: 40, right: 12, top: 30, bottom: 24 },
    legend: { data: ['Likely', 'Range (10–90%)'] },
    xAxis: tAxis(),
    yAxis: { type: 'value', name: 'Hs m', min: 0 },
    tooltip: {
      trigger: 'axis',
      formatter: (ps: any) => {
        const p = tl[ps[0].dataIndex];
        return `<b>${fmtDateTime(p.t)}</b><br/>Offshore ${p.p50.toFixed(1)} m (${p.p10.toFixed(1)}–${p.p90.toFixed(1)})<br/>Cyclone swell ${p.swellHs.toFixed(1)} m @ ${p.tp.toFixed(0)} s from ${compass(p.dir)}<br/>At the beach ≈ ${p.faceLo.toFixed(0)}–${p.faceHi.toFixed(0)} ft`;
      },
    },
    series: [
      { type: 'line', name: 'lo', stack: 'b', data: tl.map((p) => [p.t * 1000, +p.p10.toFixed(2)]), showSymbol: false, lineStyle: { opacity: 0 }, tooltip: { show: false } } as any,
      { type: 'line', name: 'Range (10–90%)', stack: 'b', data: tl.map((p) => [p.t * 1000, +(p.p90 - p.p10).toFixed(2)]), showSymbol: false, lineStyle: { opacity: 0 }, areaStyle: { color: withAlpha(c, 0.18) }, itemStyle: { color: withAlpha(c, 0.4) } },
      { type: 'line', name: 'Likely', data: tl.map((p) => [p.t * 1000, +p.p50.toFixed(2)]), showSymbol: false, lineStyle: { width: 2, color: c }, itemStyle: { color: c } },
    ],
  };
}

/** Daily probability of a cyclone-like low, by ensemble. */
export function genesisOption(g: Genesis, which: 'pAnyByDay' | 'pZoneByDay', mode: Mode): EOption {
  const s = SERIES[mode];
  const start = g.models[0]?.start ?? 0;
  const days = Array.from({ length: 15 }, (_, i) => fmtDay(start + i * 86400));
  return {
    grid: { left: 36, right: 10, top: 30, bottom: 26 },
    legend: { data: g.models.map((m) => m.label) },
    xAxis: { type: 'category', data: days, axisLabel: { interval: 1, hideOverlap: true } },
    yAxis: { type: 'value', name: '% of members', min: 0, max: (v: any) => Math.max(20, Math.ceil(v.max / 10) * 10) },
    tooltip: { trigger: 'axis', valueFormatter: (v: any) => `${v}%` },
    series: g.models.map((m, i) => ({ type: 'bar' as const, name: m.label, data: m[which], barMaxWidth: 12, barGap: '20%', itemStyle: { color: s[i], borderRadius: [4, 4, 0, 0] } })),
  };
}

/** Serenity's waves around a historical storm. */
export function stormResponseOption(series: StormSeries, storm: StormRecord, mode: Mode): EOption {
  const t = (i: number) => (series.t0 + i * series.dt) * 1000;
  const c = SERIES[mode][0];
  const hs = series.hs.map((v, i) => [t(i), v]);
  return {
    grid: { left: 40, right: 12, top: 30, bottom: 24 },
    legend: { data: ['Wave height at Serenity'] },
    xAxis: tAxis(),
    yAxis: { type: 'value', name: 'Hs m', min: 0 },
    tooltip: {
      trigger: 'axis',
      formatter: (ps: any) => {
        const i = ps[0].dataIndex;
        return `<b>${fmtDateTime(series.t0 + i * series.dt)}</b><br/>Hs ${series.hs[i]?.toFixed(2) ?? '–'} m · Tp ${series.tp[i]?.toFixed(1) ?? '–'} s from ${compass(series.dir[i])}<br/>Wind ${series.ws[i]?.toFixed(0) ?? '–'} kt from ${compass(series.wd[i])} · rain ${series.pr[i]?.toFixed(1) ?? 0} mm`;
      },
    },
    series: [
      {
        type: 'line',
        name: 'Wave height at Serenity',
        data: hs,
        showSymbol: false,
        lineStyle: { width: 2, color: c },
        itemStyle: { color: c },
        areaStyle: { color: withAlpha(c, 0.1) },
        markArea: {
          silent: true,
          itemStyle: { color: withAlpha(SERIES[mode][1], 0.08) },
          data: [[{ xAxis: storm.start * 1000, name: 'storm active' }, { xAxis: storm.end * 1000 }]] as any,
          label: { color: TOKENS[mode].muted, fontSize: 10, position: 'insideTop' },
        },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: TOKENS[mode].muted, width: 1, type: 'solid' },
          label: { color: TOKENS[mode].muted, fontSize: 10, formatter: 'closest approach' },
          data: [{ xAxis: storm.closestTime * 1000 }],
        },
      },
    ],
  };
}

export function stormWindOption(series: StormSeries, mode: Mode): EOption {
  const t = (i: number) => (series.t0 + i * series.dt) * 1000;
  return {
    grid: { left: 40, right: 12, top: 16, bottom: 24 },
    xAxis: tAxis(),
    yAxis: { type: 'value', name: 'kt', min: 0, splitNumber: 3 },
    tooltip: { trigger: 'axis', formatter: (ps: any) => `${fmtDateTime(series.t0 + ps[0].dataIndex * series.dt)}<br/>Wind ${series.ws[ps[0].dataIndex]?.toFixed(0)} kt from ${compass(series.wd[ps[0].dataIndex])}` },
    series: [
      {
        type: 'bar',
        name: 'Wind',
        barMaxWidth: 6,
        data: series.ws.map((v, i) => {
          const wd = series.wd[i];
          const rel = wd == null ? null : Math.abs(((((wd - 286 + 180) % 360) + 360) % 360) - 180);
          return { value: [t(i), v], itemStyle: { color: windColor(rel, v, mode), borderRadius: [3, 3, 0, 0] } };
        }),
      },
    ],
  };
}

/** Bay of Bengal storms per year by month and intensity (ordinal ramp). */
export function cycloneMonthsOption(c: Climatology, mode: Mode): EOption {
  const ramp = mode === 'light' ? [BLUE[4], BLUE[8], BLUE[12]] : [BLUE[9], BLUE[5], BLUE[1]];
  const k = c.cyclones.perYearByMonth;
  const mk = (name: string, data: number[], color: string) => ({ type: 'bar' as const, name, stack: 's', data, barMaxWidth: 22, itemStyle: { color, borderColor: TOKENS[mode].surface, borderWidth: 1 } });
  return {
    grid: { left: 36, right: 10, top: 30, bottom: 24 },
    legend: { data: ['Depression', 'Cyclonic storm', 'Severe+'] },
    xAxis: { type: 'category', data: MONTHS },
    yAxis: { type: 'value', name: 'per year' },
    tooltip: { trigger: 'axis', valueFormatter: (v: any) => Number(v).toFixed(2) },
    series: [mk('Depression', k.dep, ramp[0]), mk('Cyclonic storm', k.cs, ramp[1]), { ...mk('Severe+', k.severe, ramp[2]), itemStyle: { color: ramp[2], borderRadius: [4, 4, 0, 0] } } as any],
  };
}

export function monthBarsOption(values: number[], name: string, unit: string, mode: Mode, colorIdx = 0): EOption {
  return {
    grid: { left: 36, right: 10, top: 14, bottom: 24 },
    xAxis: { type: 'category', data: MONTHS },
    yAxis: { type: 'value', name: unit },
    tooltip: { trigger: 'axis', valueFormatter: (v: any) => `${Number(v).toFixed(2)} ${unit}` },
    series: [{ type: 'bar', name, data: values, barMaxWidth: 22, itemStyle: { color: SERIES[mode][colorIdx], borderRadius: [4, 4, 0, 0] } }],
  };
}

/** MJO phase diagram (RMM-style axes from ROMI) for the last `days` days. */
export function mjoPhaseOption(ix: Indices, mode: Mode, days = 40): EOption {
  const n = ix.romi.x.length;
  const pts = Array.from({ length: Math.min(days, n) }, (_, k) => n - Math.min(days, n) + k).map((i) => [ix.romi.x[i], ix.romi.y[i], i]);
  const t0 = new Date(ix.romi.t0 + 'T00:00:00Z').getTime() / 1000;
  const t = TOKENS[mode];
  const lim = 3;
  const octants = [0, 45, 90, 135].map((a) => {
    const r = (a * Math.PI) / 180;
    return [
      [-lim * Math.cos(r), -lim * Math.sin(r)],
      [lim * Math.cos(r), lim * Math.sin(r)],
    ];
  });
  const phaseLabels = [
    [-2.4, -1], [-1, -2.4], [1, -2.4], [2.4, -1], [2.4, 1], [1, 2.4], [-1, 2.4], [-2.4, 1],
  ].map((p, i) => ({ value: p, name: String(i + 1) }));
  const last = pts[pts.length - 1];
  return {
    grid: { left: 36, right: 16, top: 16, bottom: 30 },
    xAxis: { type: 'value', min: -lim, max: lim, name: 'RMM1', splitLine: { show: false } },
    yAxis: { type: 'value', min: -lim, max: lim, name: 'RMM2', splitLine: { show: false } },
    tooltip: { trigger: 'item', formatter: (p: any) => (p.seriesName === 'MJO' ? `${fmtDate(t0 + p.data[2] * 86400)}<br/>phase ${ix.romi.phase[p.data[2]]}, amplitude ${ix.romi.amp[p.data[2]].toFixed(2)}` : '') },
    series: [
      ...octants.map((seg) => ({ type: 'line' as const, data: seg, showSymbol: false, silent: true, lineStyle: { color: t.grid, width: 1 } })),
      { type: 'line', data: Array.from({ length: 73 }, (_, i) => [Math.cos((i * 5 * Math.PI) / 180), Math.sin((i * 5 * Math.PI) / 180)]), showSymbol: false, silent: true, lineStyle: { color: t.axis, width: 1 } },
      { type: 'scatter', data: phaseLabels.map((p) => p.value), symbolSize: 0, silent: true, label: { show: true, formatter: (p: any) => phaseLabels[p.dataIndex].name, color: t.muted, fontSize: 12 } },
      { type: 'line', name: 'MJO', data: pts, showSymbol: true, symbolSize: 5, lineStyle: { width: 2, color: SERIES[mode][0] }, itemStyle: { color: SERIES[mode][0] } },
      { type: 'scatter', name: 'MJO', data: [last], symbolSize: 12, itemStyle: { color: SERIES[mode][1], borderColor: t.surface, borderWidth: 2 } },
    ],
  };
}

export function mjoRateOption(c: Climatology, mode: Mode, current?: number): EOption {
  const m = c.mjo!;
  return {
    grid: { left: 36, right: 10, top: 16, bottom: 30 },
    xAxis: { type: 'category', data: m.phases.map((p) => `Phase ${p}`), axisLabel: { interval: 0, fontSize: 10 } },
    yAxis: { type: 'value', name: '× normal' },
    tooltip: { trigger: 'axis', formatter: (ps: any) => `Phase ${m.phases[ps[0].dataIndex]}<br/>${m.genesisCount[ps[0].dataIndex]} storms formed in ${m.daysInPhase[ps[0].dataIndex]} days<br/>${ps[0].value ?? '–'}× the average rate` },
    series: [
      {
        type: 'bar',
        data: m.rateRatio.map((v, i) => ({ value: v, itemStyle: { color: current === m.phases[i] ? SERIES[mode][1] : SERIES[mode][0], borderRadius: [4, 4, 0, 0] } })),
        barMaxWidth: 22,
        markLine: { silent: true, symbol: 'none', data: [{ yAxis: 1 }], lineStyle: { color: TOKENS[mode].muted, type: 'solid', width: 1 }, label: { formatter: 'average', color: TOKENS[mode].muted, fontSize: 10 } },
      },
    ],
  };
}

export function cvScatterOption(model: CycloneModel, mode: Mode): EOption {
  const pts = model.cv_points;
  const max = Math.ceil(Math.max(...pts.flat(), 1) + 0.2);
  return {
    grid: { left: 40, right: 14, top: 16, bottom: 34 },
    xAxis: { type: 'value', name: 'observed peak Hs (m)', nameLocation: 'middle', nameGap: 24, min: 0, max },
    yAxis: { type: 'value', name: 'predicted (m)', min: 0, max },
    tooltip: { trigger: 'item', formatter: (p: any) => (p.seriesName === 'storms' ? `observed ${p.data[0]} m · predicted ${p.data[1]} m` : '') },
    series: [
      { type: 'line', data: [[0, 0], [max, max]], showSymbol: false, silent: true, lineStyle: { color: TOKENS[mode].axis, width: 1 } },
      { type: 'scatter', name: 'storms', data: pts, symbolSize: 8, itemStyle: { color: withAlpha(SERIES[mode][0], 0.7), borderColor: TOKENS[mode].surface, borderWidth: 1 } },
    ],
  };
}
