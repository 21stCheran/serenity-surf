/** ECharts option builders for the forecast views. One y-axis per chart: measures
 * with different units are stacked as small multiples sharing the time axis. */
import type { Forecast, Spread } from '../core/forecast';
import { sunTimes } from '../core/sun';
import type { Tides } from '../core/tide';
import type { HourScore } from '../core/types';
import { compass, fmtDateTime, fmtDay, fmtHour, fmtTime, istDayStart, KT_TO_KMH, M_TO_FT } from '../core/units';
import { WAVE_MODELS, WIND_MODELS } from '../data/openmeteo';
import type { DaySummary } from '../core/windows';
import type { EOption } from './EChart';
import { scoreColor, SERIES, TOKENS, windColor, withAlpha, type Mode } from './theme';

export interface Units {
  height: 'ft' | 'm';
  wind: 'kt' | 'kmh';
}

export const windVal = (kt: number | null | undefined, u: Units) => (kt == null ? null : u.wind === 'kt' ? kt : kt * KT_TO_KMH);
export const windUnit = (u: Units) => (u.wind === 'kt' ? 'kt' : 'km/h');

/** Night bands (sunset -> next sunrise) for time-axis charts. */
export function nightAreas(t0: number, t1: number, mode: Mode) {
  const out: [{ xAxis: number; itemStyle: { color: string } }, { xAxis: number }][] = [];
  for (let d = istDayStart(t0) - 86400; d <= t1 + 86400; d += 86400) {
    const a = sunTimes(d + 43200);
    const b = sunTimes(d + 86400 + 43200);
    const s = Math.max(a.sunset, t0) * 1000;
    const e = Math.min(b.sunrise, t1) * 1000;
    if (e > s) out.push([{ xAxis: s, itemStyle: { color: mode === 'dark' ? 'rgba(255,255,255,0.035)' : 'rgba(11,11,11,0.035)' } }, { xAxis: e }]);
  }
  return out;
}

const timeAxis = (t0: number, t1: number, show = true) => ({
  type: 'time' as const,
  min: t0 * 1000,
  max: t1 * 1000,
  axisLabel: {
    show,
    hideOverlap: true,
    formatter: (v: number) => {
      const t = v / 1000;
      const h = new Date((t + 19800) * 1000).getUTCHours();
      return h === 0 ? fmtDay(t) : fmtHour(t);
    },
  },
  splitLine: { show: false },
});

const grid = (bottom = 22) => ({ left: 44, right: 14, top: 26, bottom, containLabel: false });

/** Category-grid cells drawn as rounded rects with a 2px surface gap (full colour control). */
export function cellSeries(data: (number | string)[][], color: (d: any[]) => string, gap = 2, radius = 3): any {
  return {
    type: 'custom',
    renderItem: (params: any, api: any) => {
      const p = api.coord([api.value(0), api.value(1)]);
      const s = api.size([1, 1]);
      return {
        type: 'rect',
        shape: { x: p[0] - s[0] / 2 + gap / 2, y: p[1] - s[1] / 2 + gap / 2, width: Math.max(1, s[0] - gap), height: Math.max(1, s[1] - gap), r: radius },
        style: { fill: color(data[params.dataIndex]) },
        emphasis: { style: { stroke: 'rgba(127,127,127,.9)', lineWidth: 1 } },
      };
    },
    data,
    encode: { x: 0, y: 1 },
  };
}

/** Hourly score strip (one row), nights greyed. */
export function ribbonOption(hours: HourScore[], mode: Mode): EOption {
  const data = hours.map((h, i) => [i, 0, h.score, h.daylight ? 1 : 0]);
  return {
    grid: { left: 4, right: 4, top: 4, bottom: 22 },
    xAxis: {
      type: 'category',
      data: hours.map((h) => h.t),
      axisLabel: {
        interval: (i: number) => new Date((hours[i].t + 19800) * 1000).getUTCHours() % 6 === 0,
        formatter: (v: string) => {
          const t = Number(v);
          const h = new Date((t + 19800) * 1000).getUTCHours();
          return h === 0 ? fmtDay(t).split(' ')[0] : fmtHour(t);
        },
      },
      axisLine: { show: false },
      splitLine: { show: false },
    },
    yAxis: { type: 'category', data: [''], show: false },
    tooltip: {
      formatter: (p: any) => {
        const h = hours[p.data[0]];
        return `<b>${fmtDateTime(h.t)}</b><br/>${h.label} · ${h.score.toFixed(1)}<br/>${h.faceLo.toFixed(0)}–${h.faceHi.toFixed(0)} ft · ${h.windType}${h.daylight ? '' : '<br/><i>dark</i>'}`;
      },
    },
    series: [cellSeries(data, (d) => (d[3] ? scoreColor(d[2], mode) : withAlpha(scoreColor(d[2], mode), 0.28)), 1, 2)],
  };
}

/** Day x hour heatmap of scores for the forecast horizon. */
export function dayHourOption(days: DaySummary[], mode: Mode): EOption {
  const data: [number, number, number, number][] = [];
  days.forEach((d, di) => {
    for (const h of d.hours) {
      const hr = new Date((h.t + 19800) * 1000).getUTCHours();
      data.push([hr, di, h.score, h.daylight ? 1 : 0]);
    }
  });
  return {
    grid: { left: 78, right: 10, top: 10, bottom: 26 },
    xAxis: { type: 'category', data: Array.from({ length: 24 }, (_, h) => (h % 3 === 0 ? `${h}:00` : '')), splitLine: { show: false }, axisLine: { show: false } },
    yAxis: { type: 'category', inverse: true, data: days.map((d) => fmtDay(d.t)), axisLine: { show: false }, splitLine: { show: false } },
    tooltip: {
      formatter: (p: any) => {
        const d = days[p.data[1]];
        const h = d.hours.find((x) => new Date((x.t + 19800) * 1000).getUTCHours() === p.data[0]);
        if (!h) return '';
        return `<b>${fmtDateTime(h.t)}</b><br/>${h.label} · ${h.score.toFixed(1)}<br/>${h.faceLo.toFixed(0)}–${h.faceHi.toFixed(0)} ft${h.tdom ? ` @ ${h.tdom.toFixed(0)} s` : ''} ${compass(h.swellDir)}<br/>wind: ${h.windType}`;
      },
    },
    series: [cellSeries(data, (d) => (d[3] ? scoreColor(d[2], mode) : withAlpha(scoreColor(d[2], mode), 0.25)))],
  };
}

/** Surf height: face-height range bars coloured by score. */
export function surfHeightOption(hours: HourScore[], u: Units, mode: Mode, t0: number, t1: number): EOption {
  const k = u.height === 'ft' ? 1 : 1 / M_TO_FT;
  return {
    grid: grid(),
    xAxis: timeAxis(t0, t1),
    yAxis: { type: 'value', name: u.height, min: 0, splitNumber: 3 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line' },
      formatter: (ps: any) => {
        const h = hours[ps[0].dataIndex];
        return `<b>${fmtDateTime(h.t)}</b><br/>Surf ${(h.faceLo * k).toFixed(1)}–${(h.faceHi * k).toFixed(1)} ${u.height}<br/>Score ${h.score.toFixed(1)} (${h.label})`;
      },
    },
    series: [
      {
        type: 'bar',
        name: 'Surf height',
        barMaxWidth: 8,
        data: hours.map((h) => ({ value: [h.t * 1000, +(h.faceHi * k).toFixed(2)], itemStyle: { color: h.daylight ? scoreColor(h.score, mode) : withAlpha(scoreColor(h.score, mode), 0.35), borderRadius: [3, 3, 0, 0] } })),
        markArea: { silent: true, data: nightAreas(t0, t1, mode) as any },
      },
      {
        type: 'line',
        name: 'Low end',
        data: hours.map((h) => [h.t * 1000, +(h.faceLo * k).toFixed(2)]),
        showSymbol: false,
        lineStyle: { width: 1.5, color: TOKENS[mode].ink2 },
      },
    ],
  };
}

/** Swell components (stacked energy shares shown as heights) for the consensus. */
export function swellPartsOption(f: Forecast, mode: Mode, t0: number, t1: number, u: Units): EOption {
  const k = u.height === 'ft' ? M_TO_FT : 1;
  const hrs = f.hours.filter((h) => h.t >= t0 && h.t <= t1 && h.hs != null);
  const comp = (kind: 'swell1' | 'swell2' | 'wind') =>
    hrs.map((h) => {
      const sw = (h.parts ?? []).filter((p) => p.kind === 'swell');
      const ww = (h.parts ?? []).filter((p) => p.kind === 'wind');
      let v = 0;
      if (!h.parts) v = kind === 'swell1' ? h.hs ?? 0 : 0;
      else if (kind === 'swell1') v = sw[0]?.h ?? 0;
      else if (kind === 'swell2') v = sw[1]?.h ?? 0;
      else v = ww[0]?.h ?? 0;
      return [h.t * 1000, +(v * k).toFixed(2)];
    });
  const s = SERIES[mode];
  // heights combine by energy, so components are drawn side by side (never stacked)
  const line = (name: string, data: any[], color: string) => ({
    type: 'line' as const,
    name,
    data,
    showSymbol: false,
    lineStyle: { width: 2, color },
    itemStyle: { color },
  });
  const total = hrs.map((h) => [h.t * 1000, h.hs == null ? null : +(h.hs * k).toFixed(2)]);
  return {
    grid: grid(),
    legend: { data: ['Combined sea', 'Primary swell', 'Secondary swell', 'Wind sea'] },
    xAxis: timeAxis(t0, t1),
    yAxis: { type: 'value', name: u.height === 'ft' ? 'ft (offshore)' : 'm (offshore)', min: 0, splitNumber: 3 },
    tooltip: {
      trigger: 'axis',
      formatter: (ps: any) => {
        const h = hrs[ps[0].dataIndex];
        const parts = (h.parts ?? [{ h: h.hs ?? 0, p: h.tp ?? 0, d: h.dir ?? 0, kind: 'swell' }])
          .map((p) => `${p.kind === 'wind' ? 'Wind sea' : 'Swell'} ${(p.h * k).toFixed(1)} ${u.height} @ ${p.p.toFixed(0)} s ${compass(p.d)}`)
          .join('<br/>');
        return `<b>${fmtDateTime(h.t)}</b><br/>Combined ${((h.hs ?? 0) * k).toFixed(1)} ${u.height}<br/>${parts}`;
      },
    },
    series: [
      { ...line('Combined sea', total, TOKENS[mode].ink2), areaStyle: { color: withAlpha(TOKENS[mode].ink2, 0.06) } },
      line('Primary swell', comp('swell1'), s[0]),
      line('Secondary swell', comp('swell2'), s[1]),
      line('Wind sea', comp('wind'), s[2]),
    ],
  };
}

/** Period with direction arrows (custom series). */
export function periodOption(f: Forecast, mode: Mode, t0: number, t1: number): EOption {
  const hrs = f.hours.filter((h) => h.t >= t0 && h.t <= t1 && h.tp != null);
  const ink = TOKENS[mode].ink2;
  return {
    grid: grid(),
    xAxis: timeAxis(t0, t1),
    yAxis: { type: 'value', name: 's', min: 0, splitNumber: 3 },
    tooltip: { trigger: 'axis', formatter: (ps: any) => `<b>${fmtDateTime(hrs[ps[0].dataIndex].t)}</b><br/>Peak period ${hrs[ps[0].dataIndex].tp?.toFixed(1)} s<br/>From ${compass(hrs[ps[0].dataIndex].dir)} (${Math.round(hrs[ps[0].dataIndex].dir ?? 0)}°)` },
    series: [
      { type: 'line', name: 'Peak period', data: hrs.map((h) => [h.t * 1000, h.tp]), showSymbol: false, lineStyle: { width: 2, color: SERIES[mode][0] }, itemStyle: { color: SERIES[mode][0] } },
      {
        type: 'custom',
        name: 'Direction',
        renderItem: ((params: any, api: any) => {
          const i = params.dataIndex;
          if (i % 3 !== 0) return null;
          const h = hrs[i];
          const [x] = api.coord([h.t * 1000, 0]);
          const y = params.coordSys.y + 8;
          return {
            type: 'path',
            x,
            y,
            rotation: (-((h.dir ?? 0) + 180) * Math.PI) / 180,
            shape: { pathData: 'M0,-6 L4,4 L0,2 L-4,4 Z', width: 8, height: 10, x: -4, y: -5 },
            style: { fill: ink },
          };
        }) as any,
        data: hrs.map((h) => [h.t * 1000, 0]),
        silent: true,
      },
    ],
  };
}

/** Wind: bars coloured offshore (blue) -> onshore (red), gust line, direction arrows. */
export function windOption(f: Forecast, hours: HourScore[], u: Units, mode: Mode, t0: number, t1: number): EOption {
  const hrs = f.hours.filter((h) => h.t >= t0 && h.t <= t1 && h.ws != null);
  const sc = new Map(hours.map((h) => [h.t, h]));
  return {
    grid: grid(),
    xAxis: timeAxis(t0, t1),
    yAxis: { type: 'value', name: windUnit(u), min: 0, splitNumber: 3 },
    tooltip: {
      trigger: 'axis',
      formatter: (ps: any) => {
        const h = hrs[ps[0].dataIndex];
        const s = sc.get(h.t);
        return `<b>${fmtDateTime(h.t)}</b><br/>Wind ${windVal(h.ws, u)?.toFixed(0)} ${windUnit(u)} from ${compass(h.wd)} (gust ${windVal(h.wg, u)?.toFixed(0) ?? '–'})<br/>${s ? s.windType : ''}`;
      },
    },
    series: [
      {
        type: 'bar',
        name: 'Wind',
        barMaxWidth: 8,
        data: hrs.map((h) => ({ value: [h.t * 1000, +(windVal(h.ws, u) ?? 0).toFixed(1)], itemStyle: { color: windColor(sc.get(h.t)?.windRel ?? null, h.ws, mode), borderRadius: [3, 3, 0, 0] } })),
        markArea: { silent: true, data: nightAreas(t0, t1, mode) as any },
      },
      { type: 'line', name: 'Gusts', data: hrs.map((h) => [h.t * 1000, windVal(h.wg, u)]), showSymbol: false, lineStyle: { width: 1.5, color: TOKENS[mode].muted } },
      {
        type: 'custom',
        name: 'Direction',
        renderItem: ((params: any, api: any) => {
          const i = params.dataIndex;
          if (i % 3 !== 0) return null;
          const h = hrs[i];
          const [x] = api.coord([h.t * 1000, 0]);
          const y = params.coordSys.y + 8;
          return {
            type: 'path',
            x,
            y,
            rotation: (-((h.wd ?? 0) + 180) * Math.PI) / 180,
            shape: { pathData: 'M0,-6 L4,4 L0,2 L-4,4 Z', width: 8, height: 10, x: -4, y: -5 },
            style: { fill: windColor(sc.get(h.t)?.windRel ?? null, h.ws, mode) },
          };
        }) as any,
        data: hrs.map((h) => [h.t * 1000, 0]),
        silent: true,
      },
    ],
  };
}

export function tideOption(tides: Tides, mode: Mode, t0: number, t1: number, u: Units, surge?: [number, number | null][]): EOption {
  const k = u.height === 'ft' ? M_TO_FT : 1;
  const s = tides.series(t0, t1, 1800);
  const ex = tides.extremes(t0, t1);
  return {
    grid: grid(),
    legend: surge?.length ? { data: ['Tide', 'Sea level (incl. surge)'] } : undefined,
    xAxis: timeAxis(t0, t1),
    yAxis: { type: 'value', name: u.height, splitNumber: 3 },
    tooltip: { trigger: 'axis', valueFormatter: (v: any) => (v == null ? '–' : `${Number(v).toFixed(2)} ${u.height}`) },
    series: [
      {
        type: 'line',
        name: 'Tide',
        data: s.map(([t, h]) => [t * 1000, +(h * k).toFixed(2)]),
        showSymbol: false,
        smooth: true,
        lineStyle: { width: 2, color: SERIES[mode][0] },
        itemStyle: { color: SERIES[mode][0] },
        areaStyle: { color: withAlpha(SERIES[mode][0], 0.1) },
        markPoint: {
          symbol: 'circle',
          symbolSize: 8,
          itemStyle: { color: SERIES[mode][0], borderColor: TOKENS[mode].surface, borderWidth: 2 },
          label: { show: true, position: 'top', color: TOKENS[mode].ink2, fontSize: 10, formatter: (p: any) => p.name },
          data: ex.map((e) => ({ name: `${e.type === 'high' ? 'H' : 'L'} ${fmtTime(e.t)}`, coord: [e.t * 1000, +(e.h * k).toFixed(2)] })),
        },
      },
      ...(surge?.length
        ? [{ type: 'line' as const, name: 'Sea level (incl. surge)', data: surge.map(([t, v]) => [t * 1000, v == null ? null : +(v * k).toFixed(2)]), showSymbol: false, lineStyle: { width: 1.5, color: SERIES[mode][1] }, itemStyle: { color: SERIES[mode][1] } }]
        : []),
    ],
  };
}

export function rainOption(f: Forecast, mode: Mode, t0: number, t1: number): EOption {
  const hrs = f.hours.filter((h) => h.t >= t0 && h.t <= t1);
  return {
    grid: grid(),
    xAxis: timeAxis(t0, t1),
    yAxis: { type: 'value', name: 'mm/h', min: 0, splitNumber: 2 },
    tooltip: {
      trigger: 'axis',
      formatter: (ps: any) => {
        const h = hrs[ps[0].dataIndex];
        return `<b>${fmtDateTime(h.t)}</b><br/>Rain ${(h.pr ?? 0).toFixed(1)} mm (${h.pp ?? '–'}% chance)${(h.wc ?? 0) >= 95 ? '<br/>⚡ thunderstorm' : ''}`;
      },
    },
    series: [{ type: 'bar', name: 'Rain', barMaxWidth: 8, data: hrs.map((h) => [h.t * 1000, h.pr ?? 0]), itemStyle: { color: SERIES[mode][0], borderRadius: [3, 3, 0, 0] } }],
  };
}

/** One line per model for wave height or wind speed. */
export function modelLinesOption(f: Forecast, kind: 'wave' | 'wind', u: Units, mode: Mode): EOption {
  const s = SERIES[mode];
  const k = u.height === 'ft' ? M_TO_FT : 1;
  const models = kind === 'wave' ? WAVE_MODELS : WIND_MODELS;
  const series = models.map((m, i) => ({
    type: 'line' as const,
    name: m.short,
    showSymbol: false,
    connectNulls: false,
    lineStyle: { width: 2, color: s[i % 8] },
    itemStyle: { color: s[i % 8] },
    data: f.times.map((t, j) => {
      const v = kind === 'wave' ? f.waves[m.id][j].hs : f.wind[m.id][j].ws;
      return [t * 1000, v == null ? null : kind === 'wave' ? +(v * k).toFixed(2) : +(windVal(v, u) ?? 0).toFixed(1)];
    }),
  }));
  const t0 = f.times[0];
  const t1 = f.times[f.times.length - 1];
  return {
    grid: { ...grid(), top: 40 },
    legend: { data: models.map((m) => m.short), type: 'scroll' },
    xAxis: timeAxis(t0, t1),
    yAxis: { type: 'value', name: kind === 'wave' ? `Hs ${u.height}` : windUnit(u), min: 0 },
    tooltip: { trigger: 'axis', valueFormatter: (v: any) => (v == null ? '–' : String(v)) },
    dataZoom: [{ type: 'inside' }],
    series,
  };
}

export function spreadOption(spread: Spread[], hours: HourScore[], mode: Mode): EOption {
  const byT = new Map(spread.map((s) => [s.t, s]));
  const hs = hours.filter((h) => byT.has(h.t));
  const t0 = hs[0]?.t ?? 0;
  const t1 = hs[hs.length - 1]?.t ?? 0;
  const c = SERIES[mode][0];
  return {
    grid: grid(),
    legend: { data: ['Consensus score', 'Model range (10–90%)'] },
    xAxis: timeAxis(t0, t1),
    yAxis: { type: 'value', min: 0, max: 10, splitNumber: 5 },
    tooltip: {
      trigger: 'axis',
      formatter: (ps: any) => {
        const h = hs[ps[0].dataIndex];
        const s = byT.get(h.t)!;
        return `<b>${fmtDateTime(h.t)}</b><br/>Score ${h.score.toFixed(1)}<br/>Models ${s.p10.toFixed(1)}–${s.p90.toFixed(1)} (${s.confidence} confidence)`;
      },
    },
    series: [
      { type: 'line', name: 'low', stack: 'band', data: hs.map((h) => [h.t * 1000, byT.get(h.t)!.p10]), showSymbol: false, lineStyle: { opacity: 0 }, tooltip: { show: false } } as any,
      { type: 'line', name: 'Model range (10–90%)', stack: 'band', data: hs.map((h) => [h.t * 1000, +(byT.get(h.t)!.p90 - byT.get(h.t)!.p10).toFixed(2)]), showSymbol: false, lineStyle: { opacity: 0 }, areaStyle: { color: withAlpha(c, 0.18) }, itemStyle: { color: withAlpha(c, 0.4) } },
      { type: 'line', name: 'Consensus score', data: hs.map((h) => [h.t * 1000, h.score]), showSymbol: false, lineStyle: { width: 2, color: c }, itemStyle: { color: c }, markArea: { silent: true, data: nightAreas(t0, t1, mode) as any } },
    ],
  };
}
