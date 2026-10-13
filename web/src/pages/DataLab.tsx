import { useMemo, useState } from 'react';
import { Card, ChartCard, Loading, Segmented, SectionTitle, Stat } from '../components/ui';
import type { HourInput, HourScore } from '../core/types';
import { fmtDate, fmtDateTime, ist, istDayKey } from '../core/units';
import { useClimatology, useMetar, useScoredHistory } from '../state/data';
import { EChart, type EOption } from '../viz/EChart';
import { SERIES, withAlpha, type Mode } from '../viz/theme';

interface VarDef {
  id: string;
  label: string;
  unit: string;
  get: (x: HourInput, s: HourScore) => number | null;
}

const VARS: VarDef[] = [
  { id: 'score', label: 'Surf score', unit: '/10', get: (_, s) => s.score },
  { id: 'face', label: 'Face height', unit: 'ft', get: (_, s) => s.faceMid },
  { id: 'hs', label: 'Offshore wave height', unit: 'm', get: (x) => x.hs },
  { id: 'tp', label: 'Peak period', unit: 's', get: (x) => x.tp },
  { id: 'dir', label: 'Wave direction', unit: '°', get: (x) => x.dir },
  { id: 'ws', label: 'Wind speed', unit: 'kt', get: (x) => x.ws },
  { id: 'wd', label: 'Wind direction', unit: '°', get: (x) => x.wd },
  { id: 'wg', label: 'Wind gust', unit: 'kt', get: (x) => x.wg ?? null },
  { id: 'pr', label: 'Rain', unit: 'mm/h', get: (x) => x.pr ?? null },
  { id: 'tide', label: 'Tide', unit: 'm', get: (x) => x.tide ?? null },
  { id: 'sl', label: 'Sea level (incl. surge)', unit: 'm', get: (x) => x.sl ?? null },
  { id: 'sst', label: 'Water temperature', unit: '°C', get: (x) => x.sst ?? null },
];

type Agg = 'hour' | 'day' | 'month';

function aggregate(inputs: HourInput[], hours: HourScore[], v: VarDef, t0: number, t1: number, agg: Agg, how: 'mean' | 'max') {
  const buckets = new Map<string, { t: number; s: number; n: number; m: number }>();
  for (let i = 0; i < inputs.length; i++) {
    const x = inputs[i];
    if (x.t < t0 || x.t > t1) continue;
    const val = v.get(x, hours[i]);
    if (val == null || Number.isNaN(val)) continue;
    const f = ist(x.t);
    const key = agg === 'hour' ? String(x.t) : agg === 'day' ? istDayKey(x.t) : `${f.year}-${f.month}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { t: x.t, s: 0, n: 0, m: -Infinity }));
    b.s += val;
    b.n++;
    b.m = Math.max(b.m, val);
  }
  return [...buckets.values()].map((b) => [b.t * 1000, +(how === 'max' ? b.m : b.s / b.n).toFixed(3)] as [number, number]);
}

function seriesOption(data: [number, number][], v: VarDef, color: string): EOption {
  return {
    grid: { left: 48, right: 12, top: 14, bottom: 26 },
    xAxis: { type: 'time', axisLabel: { hideOverlap: true } },
    yAxis: { type: 'value', name: v.unit, scale: true },
    tooltip: { trigger: 'axis', formatter: (ps: any) => `${fmtDateTime(ps[0].value[0] / 1000)}<br/>${v.label}: ${ps[0].value[1]} ${v.unit}` },
    dataZoom: [{ type: 'inside' }],
    series: [{ type: 'line', data, showSymbol: false, sampling: 'lttb', lineStyle: { width: 1.5, color }, itemStyle: { color }, areaStyle: { color: withAlpha(color, 0.08) } }],
  };
}

function scatterOption(pts: [number, number][], vx: VarDef, vy: VarDef, mode: Mode): EOption {
  return {
    grid: { left: 48, right: 14, top: 14, bottom: 40 },
    xAxis: { type: 'value', name: `${vx.label} (${vx.unit})`, nameLocation: 'middle', nameGap: 26, scale: true },
    yAxis: { type: 'value', name: vy.unit, scale: true },
    tooltip: { trigger: 'item', formatter: (p: any) => `${vx.label} ${p.data[0]} · ${vy.label} ${p.data[1]}` },
    series: [{ type: 'scatter', data: pts, symbolSize: 4, large: true, itemStyle: { color: withAlpha(SERIES[mode][0], 0.35) } }],
  };
}

function corr(pts: [number, number][]): number {
  const n = pts.length;
  if (n < 3) return NaN;
  const mx = pts.reduce((a, p) => a + p[0], 0) / n;
  const my = pts.reduce((a, p) => a + p[1], 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of pts) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

export default function DataLab() {
  const { hours, inputs, loading, progress } = useScoredHistory();
  const metar = useMetar();
  const clim = useClimatology();
  const [sel, setSel] = useState<string[]>(['face', 'ws', 'tide']);
  const [agg, setAgg] = useState<Agg>('day');
  const [how, setHow] = useState<'mean' | 'max'>('max');
  const [from, setFrom] = useState('2024-10-01');
  const [to, setTo] = useState('2025-01-31');
  const [xv, setXv] = useState('hs');
  const [yv, setYv] = useState('score');

  const t0 = Date.parse(from + 'T00:00:00+05:30') / 1000;
  const t1 = Date.parse(to + 'T23:59:00+05:30') / 1000;

  const scatter = useMemo(() => {
    if (!inputs || !hours) return [];
    const vx = VARS.find((v) => v.id === xv)!;
    const vy = VARS.find((v) => v.id === yv)!;
    const out: [number, number][] = [];
    for (let i = 0; i < inputs.length; i++) {
      const x = inputs[i];
      if (x.t < t0 || x.t > t1 || !hours[i].daylight) continue;
      const a = vx.get(x, hours[i]);
      const b = vy.get(x, hours[i]);
      if (a != null && b != null) out.push([+a.toFixed(2), +b.toFixed(2)]);
    }
    return out;
  }, [inputs, hours, xv, yv, t0, t1]);

  const verif = useMemo(() => {
    if (!metar.data || !inputs) return null;
    const idx = new Map(inputs.map((x, i) => [x.t, i]));
    const pts: [number, number][] = [];
    const series: { t: number; obs: number; mod: number }[] = [];
    metar.data.t.forEach((t, k) => {
      const i = idx.get(t - 1800) ?? idx.get(t + 1800) ?? idx.get(t);
      const o = metar.data!.kt[k];
      if (i == null || o == null || o > 50) return; // drop garbled reports
      const m = inputs[i].ws;
      if (m == null) return;
      pts.push([o, +m.toFixed(1)]);
      if (t >= t0 && t <= t1) series.push({ t, obs: o, mod: m });
    });
    return { pts, series };
  }, [metar.data, inputs, t0, t1]);

  const download = () => {
    if (!inputs || !hours) return;
    const rows = ['time_ist,' + VARS.map((v) => `${v.id}_${v.unit.replace(/[^a-z0-9]/gi, '')}`).join(',')];
    for (let i = 0; i < inputs.length; i++) {
      const x = inputs[i];
      if (x.t < t0 || x.t > t1) continue;
      rows.push(new Date((x.t + 19800) * 1000).toISOString().slice(0, 16).replace('T', ' ') + ',' + VARS.map((v) => v.get(x, hours[i]) ?? '').join(','));
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
    a.download = `serenity-${from}-to-${to}.csv`;
    a.click();
  };

  if (loading || !hours || !inputs) return <Loading text="Loading the hourly archive…" progress={progress} />;

  const vx = VARS.find((v) => v.id === xv)!;
  const vy = VARS.find((v) => v.id === yv)!;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[24px] font-semibold text-ink">Data lab</h1>
        <p className="text-[13px] text-ink2">Every hourly value behind the dashboard, {fmtDate(inputs[0].t)} → {fmtDate(inputs[inputs.length - 1].t)}. Pick variables and a period, compare, export.</p>
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-[12.5px] text-ink2 flex items-center gap-1.5">
            from <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="text-[12.5px] text-ink2 flex items-center gap-1.5">
            to <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <Segmented size="sm" value={agg} onChange={setAgg} options={[{ value: 'hour', label: 'Hourly' }, { value: 'day', label: 'Daily' }, { value: 'month', label: 'Monthly' }]} />
          {agg !== 'hour' && <Segmented size="sm" value={how} onChange={setHow} options={[{ value: 'max', label: 'Max' }, { value: 'mean', label: 'Mean' }]} />}
          <button className="btn ml-auto" onClick={download}>
            Download CSV
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-3">
          {VARS.map((v) => {
            const on = sel.includes(v.id);
            return (
              <button key={v.id} className="chip cursor-pointer" aria-pressed={on} style={{ opacity: on ? 1 : 0.55 }} onClick={() => setSel(on ? sel.filter((x) => x !== v.id) : [...sel, v.id].slice(-4))}>
                {v.label}
              </button>
            );
          })}
        </div>
        <p className="text-[11.5px] text-muted mt-2">Up to four variables, each on its own chart (shared time axis, scroll to zoom).</p>
      </Card>
      <div className="grid gap-3">
        {sel.map((id, i) => {
          const v = VARS.find((x) => x.id === id)!;
          const data = aggregate(inputs, hours, v, t0, t1, agg, how);
          return (
            <ChartCard key={id} title={`${v.label} (${v.unit})`} chart={<EChart height={170} group="lab" option={(m) => seriesOption(data, v, SERIES[m][i])} />} />
          );
        })}
      </div>

      <SectionTitle kicker="Relationships">Scatter any two</SectionTitle>
      <Card>
        <div className="flex flex-wrap gap-2 items-center mb-2">
          <select value={xv} onChange={(e) => setXv(e.target.value)} aria-label="X variable">
            {VARS.map((v) => (
              <option key={v.id} value={v.id}>
                x: {v.label}
              </option>
            ))}
          </select>
          <select value={yv} onChange={(e) => setYv(e.target.value)} aria-label="Y variable">
            {VARS.map((v) => (
              <option key={v.id} value={v.id}>
                y: {v.label}
              </option>
            ))}
          </select>
          <span className="text-[12.5px] text-ink2">{scatter.length.toLocaleString()} daylight hours · correlation {corr(scatter).toFixed(2)}</span>
        </div>
        <EChart height={320} option={(m) => scatterOption(scatter, vx, vy, m)} />
      </Card>

      <SectionTitle kicker="Ground truth">Model winds vs Puducherry airport</SectionTitle>
      {verif ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
          <Card title="Wind speed: airport vs model" subtitle={`${verif.pts.length.toLocaleString()} matched daytime hours (VOPC METAR)`}>
            {clim.data?.seaBreeze.validation && (
              <div className="grid grid-cols-3 gap-3 mb-2">
                <Stat label="Direction within 45°" value={`${clim.data.seaBreeze.validation.dirWithin45Pct}%`} />
                <Stat label="Speed bias" value={`${clim.data.seaBreeze.validation.speedBiasKt > 0 ? '+' : ''}${clim.data.seaBreeze.validation.speedBiasKt} kt`} sub="model minus airport" />
                <Stat label="Speed correlation" value={clim.data.seaBreeze.validation.corrSpeed.toFixed(2)} />
              </div>
            )}
            <EChart height={260} option={(m) => scatterOption(verif.pts, { id: 'o', label: 'Airport', unit: 'kt', get: () => null }, { id: 'm', label: 'Model (IFS 9 km)', unit: 'kt', get: () => null }, m)} />
            <p className="text-[12px] text-muted">The airport is ~4 km inland, so it reads lighter than the beach; direction is what matters for offshore vs onshore.</p>
          </Card>
          <ChartCard
            title="Selected period"
            subtitle="Airport observations (daytime only) and the model wind used in the history"
            chart={
              <EChart
                height={320}
                option={(m) => ({
                  grid: { left: 40, right: 12, top: 34, bottom: 26 },
                  legend: { data: ['Airport', 'Model'] },
                  xAxis: { type: 'time', axisLabel: { hideOverlap: true } },
                  yAxis: { type: 'value', name: 'kt', min: 0 },
                  tooltip: { trigger: 'axis' },
                  dataZoom: [{ type: 'inside' }],
                  series: [
                    { type: 'scatter', name: 'Airport', data: verif.series.map((r) => [r.t * 1000, r.obs]), symbolSize: 5, itemStyle: { color: SERIES[m][1] } },
                    { type: 'line', name: 'Model', data: verif.series.map((r) => [r.t * 1000, +r.mod.toFixed(1)]), showSymbol: false, lineStyle: { width: 1.5, color: SERIES[m][0] }, itemStyle: { color: SERIES[m][0] } },
                  ],
                })}
              />
            }
          />
        </div>
      ) : (
        <Loading />
      )}
      <p className="text-[12px] text-muted">Sources: ERA5 & ERA5-Ocean (ECMWF/Copernicus), Météo-France MFWAM & SMOC, ECMWF IFS via Open-Meteo; METAR via Iowa Environmental Mesonet.</p>
    </div>
  );
}
