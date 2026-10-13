import { useMemo, useState } from 'react';
import { Card, ChartCard, DataTable, Loading, Pill, SectionTitle, Stat } from '../components/ui';
import { cycloneDays, dayStats, monthHour, type DayStat } from '../core/history';
import { faceText } from '../core/surf';
import { fmtDay, ist, istDayKey, istDayStart, MONTHS, nowS } from '../core/units';
import { useClimatology, useIndices, useScoredForecast, useScoredHistory, useStorms } from '../state/data';
import { useMode, useProfile } from '../state/settings';
import { EChart, type EOption } from '../viz/EChart';
import { scoreColor, SERIES, TOKENS, withAlpha, type Mode } from '../viz/theme';

const DAY = 86400;

function doyOf(t: number) {
  return ist(t).doy;
}

/** Odds for a trip window, using every past year's same calendar dates. */
function tripOdds(days: DayStat[], start: number, end: number) {
  const d0 = doyOf(start);
  const len = Math.max(1, Math.round((end - start) / DAY) + 1);
  const byYear = new Map<number, DayStat[]>();
  for (const d of days) {
    let off = d.doy - d0;
    if (off < 0) off += 366;
    if (off < len) (byYear.get(d.year) ?? byYear.set(d.year, []).get(d.year)!).push(d);
  }
  const yrs = [...byYear.values()].filter((v) => v.length >= len * 0.8);
  const n = yrs.length || 1;
  const all = yrs.flat();
  const med = (xs: number[]) => {
    const v = [...xs].sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : 0;
  };
  return {
    years: yrs.length,
    len,
    anyGood: (yrs.filter((v) => v.some((d) => d.best >= 4.5)).length / n) * 100,
    anyGreat: (yrs.filter((v) => v.some((d) => d.best >= 6.5)).length / n) * 100,
    anyCyclone: (yrs.filter((v) => v.some((d) => d.cyclone)).length / n) * 100,
    expGood: yrs.reduce((a, v) => a + v.filter((d) => d.best >= 4.5).length, 0) / n,
    expGreat: yrs.reduce((a, v) => a + v.filter((d) => d.best >= 6.5).length, 0) / n,
    medFace: med(all.map((d) => d.maxFace)),
    offshoreAM: (all.filter((d) => (d.offshoreAM ?? 0) >= 0.5).length / (all.length || 1)) * 100,
    rain: yrs.reduce((a, v) => a + v.reduce((b, d) => b + d.rain, 0), 0) / n,
    bestYear: yrs.map((v) => ({ y: v[0].year, g: v.filter((d) => d.best >= 4.5).length })).sort((a, b) => b.g - a.g)[0],
  };
}

function outlookOptions(rows: { t: number; clim: number; fc: number | null }[], mode: Mode): { fc: EOption; clim: EOption } {
  const s = SERIES[mode];
  const x = { type: 'category' as const, data: rows.map((r) => fmtDay(r.t)), axisLabel: { interval: 3, hideOverlap: true } };
  const grid = { left: 40, right: 12, top: 12, bottom: 30 };
  return {
    fc: {
      grid,
      xAxis: x,
      yAxis: { type: 'value', min: 0, max: 10, name: 'score' },
      tooltip: { trigger: 'axis', formatter: (ps: any) => { const r = rows[ps[0].dataIndex]; return `<b>${fmtDay(r.t)}</b><br/>${r.fc != null ? `Forecast best session ${r.fc.toFixed(1)}/10` : '<i>beyond the 16-day forecast</i>'}`; } },
      series: [{ type: 'bar', name: 'Forecast best session', data: rows.map((r) => (r.fc == null ? null : { value: +r.fc.toFixed(1), itemStyle: { color: scoreColor(r.fc, mode), borderRadius: [4, 4, 0, 0] } })), barMaxWidth: 14 }],
    },
    clim: {
      grid,
      xAxis: x,
      yAxis: { type: 'value', min: 0, max: 100, name: '%' },
      tooltip: { trigger: 'axis', formatter: (ps: any) => { const r = rows[ps[0].dataIndex]; return `<b>${fmtDay(r.t)}</b><br/>Good+ on ${r.clim.toFixed(0)}% of these dates in past years`; } },
      series: [{ type: 'line', name: 'Climate odds of a Good+ day', data: rows.map((r) => +r.clim.toFixed(1)), showSymbol: false, smooth: true, lineStyle: { width: 2, color: s[1] }, itemStyle: { color: s[1] }, areaStyle: { color: withAlpha(s[1], 0.1) } }],
    },
  };
}

export default function Planner() {
  const { hours, inputs, loading, progress } = useScoredHistory();
  const fc = useScoredForecast();
  const storms = useStorms();
  const clim = useClimatology();
  const ix = useIndices();
  const profile = useProfile();
  const mode = useMode();
  const today0 = istDayStart(nowS());
  const iso = (t: number) => istDayKey(t);
  const [trips, setTrips] = useState<{ from: string; to: string }[]>([
    { from: iso(today0 + 30 * DAY), to: iso(today0 + 37 * DAY) },
    { from: iso(today0 + 45 * DAY), to: iso(today0 + 52 * DAY) },
  ]);

  const cyc = useMemo(() => (storms.data ? cycloneDays(storms.data.storms) : {}), [storms.data]);
  const days = useMemo(() => (hours && inputs ? dayStats(hours, inputs, cyc) : null), [hours, inputs, cyc]);
  const mh = useMemo(() => (hours ? monthHour(hours) : null), [hours]);

  const climByDoy = useMemo(() => {
    if (!days) return null;
    const arr = new Array(367).fill(0).map(() => ({ n: 0, g: 0 }));
    for (const d of days) {
      for (let k = -5; k <= 5; k++) {
        const x = ((d.doy - 1 + k + 366) % 366) + 1;
        arr[x].n++;
        if (d.best >= 4.5) arr[x].g++;
      }
    }
    return arr.map((a) => (a.n ? (a.g / a.n) * 100 : 0));
  }, [days]);

  const outlook = useMemo(() => {
    if (!climByDoy) return [];
    const fcBy = new Map(fc.days.map((d) => [d.day, d.best?.score ?? d.maxScore]));
    return Array.from({ length: 45 }, (_, i) => {
      const t = today0 + i * DAY;
      return { t, clim: climByDoy[doyOf(t + 43200)], fc: fcBy.get(iso(t)) ?? null };
    });
  }, [climByDoy, fc.days, today0]);

  const bestWeeks = useMemo(() => {
    if (!days) return [];
    const w = Array.from({ length: 52 }, (_, i) => {
      const sel = days.filter((d) => d.week === i + 1);
      return { week: i + 1, good: (sel.filter((d) => d.best >= 4.5).length / (sel.length || 1)) * 100, great: (sel.filter((d) => d.best >= 6.5).length / (sel.length || 1)) * 100 };
    });
    return w.sort((a, b) => b.good + b.great - (a.good + a.great)).slice(0, 8);
  }, [days]);

  if (loading || !days || !mh) return <Loading text="Loading history to work out the odds…" progress={progress} />;

  const oni = ix.data ? ix.data.oni.anom[ix.data.oni.anom.length - 1] : null;
  const phase = ix.data ? ix.data.romi.phase[ix.data.romi.phase.length - 1] : null;
  const amp = ix.data ? ix.data.romi.amp[ix.data.romi.amp.length - 1] : null;
  const ensoClass = oni == null ? null : oni >= 0.5 ? 'El Niño' : oni <= -0.5 ? 'La Niña' : 'Neutral';
  const ensoRow = ensoClass && clim.data?.enso?.[ensoClass];
  const weekStart = (w: number) => {
    const y = new Date().getFullYear();
    return Date.UTC(y, 0, 1) / 1000 + (w - 1) * 7 * DAY;
  };
  const results = trips.map((tr) => {
    const s = Date.parse(tr.from + 'T00:00:00+05:30') / 1000;
    const e = Date.parse(tr.to + 'T00:00:00+05:30') / 1000;
    return { tr, s, e, o: Number.isFinite(s) && Number.isFinite(e) && e >= s ? tripOdds(days, s, e) : null };
  });
  const bestHourFor = (t: number) => {
    const row = mh[ist(t).month - 1];
    let bi = -1;
    let bv = -Infinity;
    row.forEach((v, h) => {
      if (Number.isFinite(v) && v > bv) {
        bv = v;
        bi = h;
      }
    });
    return bi >= 0 ? `${bi}:30` : '–';
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[24px] font-semibold text-ink">Planner</h1>
        <p className="text-[13px] text-ink2">
          When should you be at Serenity? Days 1–16 use the live forecast; anything further uses what actually happened on the same dates since {days[0].year}, scored for <b>{profile.name}</b>.
        </p>
      </div>

      <ChartCard
        title="The next 45 days"
        subtitle="Top: the live forecast's best session per day (days 1–16). Bottom: how often the same dates delivered a Good+ day in past years (±5 days)."
        chart={
          <>
            <div className="text-[12.5px] font-semibold text-ink">Forecast best session</div>
            <EChart height={150} group="outlook" option={(m) => outlookOptions(outlook, m).fc} />
            <div className="text-[12.5px] font-semibold text-ink mt-1">Climate odds of a Good+ day</div>
            <EChart height={150} group="outlook" option={(m) => outlookOptions(outlook, m).clim} />
          </>
        }
        table={
          <DataTable
            rows={outlook}
            columns={[
              { key: 'd', label: 'Day', render: (r) => fmtDay(r.t) },
              { key: 'f', label: 'Forecast', align: 'right', render: (r) => (r.fc != null ? r.fc.toFixed(1) : '—') },
              { key: 'c', label: 'Climate odds Good+', align: 'right', render: (r) => `${r.clim.toFixed(0)}%` },
            ]}
          />
        }
      />

      <SectionTitle kicker="Trips">Compare dates</SectionTitle>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {results.map(({ tr, s, o }, i) => (
          <Card
            key={i}
            title={`Option ${String.fromCharCode(65 + i)}`}
            right={
              trips.length > 1 && (
                <button className="btn" onClick={() => setTrips(trips.filter((_, j) => j !== i))}>
                  Remove
                </button>
              )
            }
          >
            <div className="flex flex-wrap gap-2 items-center">
              <input type="date" value={tr.from} onChange={(e) => setTrips(trips.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} />
              <span className="text-ink2">→</span>
              <input type="date" value={tr.to} onChange={(e) => setTrips(trips.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} />
            </div>
            {o ? (
              <div className="grid grid-cols-2 gap-4 mt-4">
                <Stat label="At least one Good+ day" value={`${o.anyGood.toFixed(0)}%`} sub={`of the last ${o.years} years`} />
                <Stat label="Good+ days to expect" value={o.expGood.toFixed(1)} sub={`of ${o.len} days`} />
                <Stat label="At least one Great+ day" value={`${o.anyGreat.toFixed(0)}%`} />
                <Stat label="Cyclone swell chance" value={`${o.anyCyclone.toFixed(0)}%`} sub="years with a cyclone swell day" />
                <Stat label="Typical size" value={faceText(o.medFace * 0.85, o.medFace)} sub="median daily max" />
                <Stat label="Offshore mornings" value={`${o.offshoreAM.toFixed(0)}%`} sub={`best hour ~${bestHourFor(s)}`} />
                <Stat label="Rain" value={`${Math.round(o.rain)} mm`} sub="average total" />
                <Stat label="Water" value={clim.data?.sst?.[ist(s).month - 1] ? `${clim.data.sst[ist(s).month - 1]}°C` : '–'} />
              </div>
            ) : (
              <div className="text-ink2 text-[13px] mt-3">Pick a start and end date.</div>
            )}
            {o?.bestYear && <div className="text-[12px] text-muted mt-3">Best year on record for these dates: {o.bestYear.y} with {o.bestYear.g} Good+ days.</div>}
          </Card>
        ))}
        {trips.length < 3 && (
          <button className="card grid place-items-center min-h-[160px] text-ink2 cursor-pointer hover:bg-[var(--hover)]" onClick={() => setTrips([...trips, { from: iso(today0 + 60 * DAY), to: iso(today0 + 67 * DAY) }])}>
            + Add another option
          </button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Best weeks of the year" subtitle={`For ${profile.name}, ranked by Good+ and Great+ odds`}>
          <DataTable
            rows={bestWeeks}
            columns={[
              { key: 'w', label: 'Week starting', render: (r) => fmtDay(weekStart(r.week)).replace(/^\w+ /, '') },
              { key: 'g', label: 'Good+ days', align: 'right', render: (r) => `${r.good.toFixed(0)}%` },
              { key: 'gr', label: 'Great+ days', align: 'right', render: (r) => `${r.great.toFixed(0)}%` },
            ]}
          />
          <p className="text-[12px] text-muted mt-2">The southwest monsoon (Jun–Sep) brings steady south-east groundswell with offshore westerlies; Oct–Dec is the cyclone lottery.</p>
        </Card>
        <Card title="This season's climate drivers" subtitle="Slow signals that tilt the odds for the coming weeks">
          <div className="space-y-3 text-[13.5px] text-ink">
            {oni != null && (
              <div className="flex items-start gap-3">
                <Pill tone="accent">ENSO {oni > 0 ? '+' : ''}{oni.toFixed(1)}</Pill>
                <div>
                  {ensoClass}
                  {Math.abs(oni) >= 1.5 ? ' (strong)' : ''}.{' '}
                  {ensoRow && clim.data?.enso
                    ? `In ${ensoClass} autumns since 1980 the Bay averaged ${ensoRow.meanStormsOND} cyclonic storms in Oct–Dec and ${ensoRow.meanBigSwellDaysOND} big-swell days at Serenity, vs ${clim.data.enso.Neutral?.meanStormsOND} and ${clim.data.enso.Neutral?.meanBigSwellDaysOND} in neutral years.`
                    : ''}
                </div>
              </div>
            )}
            {phase != null && clim.data?.mjo && (
              <div className="flex items-start gap-3">
                <Pill tone="accent">MJO {phase}</Pill>
                <div>
                  Phase {phase}, amplitude {amp?.toFixed(1)}{(amp ?? 0) < 1 ? ' (weak)' : ''}. Cyclones form {clim.data.mjo.rateRatio[phase - 1]}× the average rate in this phase. It drifts eastward over 30–60 days; phases 3–5 are the ones to watch for Bay of Bengal storms.
                </div>
              </div>
            )}
            <div className="text-[12px] text-muted">Patterns from 1980–2025 — useful tendencies, not guarantees.</div>
          </div>
        </Card>
      </div>

      <Card title="Month by month at a glance" subtitle="Share of days with a Good+ session and with offshore mornings">
        <div className="grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-12 gap-2">
          {MONTHS.map((m, i) => {
            const sel = days.filter((d) => d.month === i + 1);
            const g = (sel.filter((d) => d.best >= 4.5).length / (sel.length || 1)) * 100;
            const off = (sel.filter((d) => (d.offshoreAM ?? 0) >= 0.5).length / (sel.length || 1)) * 100;
            return (
              <div key={m} className="rounded-xl border border-[var(--border)] p-2.5 text-center">
                <div className="text-[12px] text-ink2">{m}</div>
                <div className="text-[18px] font-semibold text-ink">{g.toFixed(0)}%</div>
                <div className="h-1.5 rounded-full mt-1" style={{ background: TOKENS[mode].grid }}>
                  <div className="h-full rounded-full" style={{ width: `${g}%`, background: SERIES[mode][0] }} />
                </div>
                <div className="text-[11px] text-muted mt-1">{off.toFixed(0)}% offshore AM</div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
