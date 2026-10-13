import { useMemo, useState } from 'react';
import { Card, ChartCard, DataTable, LabelChip, Loading, Segmented, SectionTitle, Stat } from '../components/ui';
import { cycloneDays, dayStats, monthHour, monthlyFaceBoxes, periodStats, weekOdds, type DayStat } from '../core/history';
import { labelOf } from '../core/score';
import { compass, fmtDate, MONTHS } from '../core/units';
import { go } from '../state/router';
import { useClimatology, useScoredHistory, useStorms } from '../state/data';
import { useMode, useProfile } from '../state/settings';
import { EChart } from '../viz/EChart';
import { calendarOption, climateWheelOption, compareOption, faceBoxOption, monthHourOption, rainOption, roseOption, seaBreezeOption, weekOddsOption } from '../viz/seasonCharts';
import { scoreColor } from '../viz/theme';

function ScaleLegend() {
  const mode = useMode();
  const labels: [number, string][] = [
    [0.5, 'Flat'],
    [1.8, 'Poor'],
    [3.5, 'Fair'],
    [5.5, 'Good'],
    [7.5, 'Great'],
    [9.2, 'Epic'],
  ];
  return (
    <div className="flex items-center gap-3 text-[12px] text-ink2 flex-wrap">
      {labels.map(([v, l]) => (
        <span key={l} className="inline-flex items-center gap-1.5">
          <span style={{ width: 12, height: 12, borderRadius: 3, background: scoreColor(v, mode), display: 'inline-block' }} />
          {l}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span style={{ width: 12, height: 12, borderRadius: 3, border: `1.5px solid ${mode === 'dark' ? '#fff' : '#0b0b0b'}`, display: 'inline-block' }} />
        cyclone swell day
      </span>
    </div>
  );
}

export default function Seasons() {
  const { hours, inputs, loading, progress } = useScoredHistory();
  const storms = useStorms();
  const clim = useClimatology();
  const profile = useProfile();
  const [metric, setMetric] = useState<'best' | 'face'>('best');
  const [month, setMonth] = useState(new Date().getMonth());
  const [roseKind, setRoseKind] = useState<'wave' | 'windAM' | 'windPM'>('wave');
  const [calYear, setCalYear] = useState(new Date().getFullYear() - 1);
  const [cmpA, setCmpA] = useState({ y: 2020, m: 11 });
  const [cmpB, setCmpB] = useState({ y: 2024, m: 11 });

  const cyc = useMemo(() => (storms.data ? cycloneDays(storms.data.storms) : {}), [storms.data]);
  const days = useMemo(() => (hours && inputs ? dayStats(hours, inputs, cyc) : null), [hours, inputs, cyc]);
  const odds = useMemo(() => (days ? weekOdds(days) : null), [days]);
  const mh = useMemo(() => (hours ? monthHour(hours) : null), [hours]);
  const boxes = useMemo(() => (days ? monthlyFaceBoxes(days) : null), [days]);
  const years = useMemo(() => (days ? [...new Set(days.map((d) => d.year))] : []), [days]);
  const summary = useMemo(() => {
    if (!days || !mh) return null;
    const full = days.filter((d) => d.year < new Date().getFullYear());
    const nYears = new Set(full.map((d) => d.year)).size || 1;
    const st = periodStats(full);
    const byMonth = MONTHS.map((_, m) => {
      const sel = full.filter((d) => d.month === m + 1);
      return sel.filter((d) => d.best >= 4.5).length / (sel.length || 1);
    });
    const bestMonth = byMonth.indexOf(Math.max(...byMonth));
    const big = [...days].sort((a, b) => b.maxFace - a.maxFace)[0];
    // best hour overall
    const hourMeans = Array.from({ length: 24 }, (_, h) => {
      const v = mh.map((r) => r[h]).filter((x) => Number.isFinite(x));
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : -1;
    });
    const bestHour = hourMeans.indexOf(Math.max(...hourMeans));
    return { goodPerYear: st.good / nYears, greatPerYear: st.great / nYears, epic: st.epic, bestMonth, byMonth, big, bestHour, nYears };
  }, [days, mh]);

  const top = useMemo(() => (days ? [...days].sort((a, b) => b.maxFace - a.maxFace).slice(0, 25) : []), [days]);
  const pick = (p: { y: number; m: number }) => (days ?? []).filter((d) => d.year === p.y && d.month === p.m);
  const A = pick(cmpA);
  const B = pick(cmpB);
  const sa = periodStats(A);
  const sb = periodStats(B);

  if (loading || !days || !summary) return <Loading text="Loading 12 years of hourly history and scoring every hour for your profile…" progress={progress} />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[24px] font-semibold text-ink">Seasons & history</h1>
        <p className="text-[13px] text-ink2">
          Every hour since {days[0].year}, rescored for <b>{profile.name}</b>. {days.length.toLocaleString()} days · waves from ERA5 (mapped to the 8 km model climate), MFWAM partitions from Oct 2021, winds from ECMWF IFS 9 km.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <Stat label="Good+ days per year" value={Math.round(summary.goodPerYear)} sub={`${Math.round((summary.goodPerYear / 365) * 100)}% of days`} />
        </Card>
        <Card>
          <Stat label="Great+ days per year" value={Math.round(summary.greatPerYear)} />
        </Card>
        <Card>
          <Stat label="Best month" value={MONTHS[summary.bestMonth]} sub={`${Math.round(summary.byMonth[summary.bestMonth] * 100)}% of days Good+`} />
        </Card>
        <Card>
          <Stat label="Best hour of day" value={`${summary.bestHour}:30`} sub="highest average score" />
        </Card>
        <Card>
          <Stat label="Biggest day" value={`${summary.big.maxFace.toFixed(0)} ft`} sub={`${fmtDate(summary.big.t)}${summary.big.cyclone ? ` · ${summary.big.cyclone}` : ''}`} />
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_1fr]">
        <ChartCard
          title="The surf climate wheel"
          subtitle="Each ring is a year, each sliver a day (January at the top, clockwise). Colour = the day's best session. Outlined = a cyclone was sending swell."
          right={<Segmented size="sm" value={metric} onChange={setMetric} options={[{ value: 'best', label: 'Score' }, { value: 'face', label: 'Size' }]} />}
          chart={
            <>
              <EChart height={Math.min(560, Math.max(320, (typeof window !== 'undefined' ? window.innerWidth : 600) - 40))} option={(m) => climateWheelOption(days, m, metric)} onClick={(p) => p?.dataIndex != null && setCalYear(days[p.dataIndex].year)} />
              <ScaleLegend />
            </>
          }
          table={
            <DataTable
              rows={years.map((y) => ({ y, s: periodStats(days.filter((d) => d.year === y)) }))}
              columns={[
                { key: 'y', label: 'Year', render: (r) => r.y },
                { key: 'g', label: 'Good+ days', align: 'right', render: (r) => r.s.good },
                { key: 'gr', label: 'Great+ days', align: 'right', render: (r) => r.s.great },
                { key: 'e', label: 'Epic days', align: 'right', render: (r) => r.s.epic },
                { key: 'c', label: 'Cyclone swell days', align: 'right', render: (r) => r.s.cycloneDays },
                { key: 'm', label: 'Max face (ft)', align: 'right', render: (r) => r.s.maxFace.toFixed(0) },
              ]}
            />
          }
        />
        <div className="grid gap-4">
          <ChartCard
            title="Odds by week of the year"
            subtitle="Share of days with at least one Good+ / Great+ session, and days with cyclone swell running"
            chart={<EChart height={250} option={(m) => weekOddsOption(odds!, m)} />}
            table={
              <DataTable
                rows={odds!}
                columns={[
                  { key: 'w', label: 'Week', render: (r) => r.week },
                  { key: 'g', label: 'Good+ %', align: 'right', render: (r) => r.good.toFixed(0) },
                  { key: 'gr', label: 'Great+ %', align: 'right', render: (r) => r.great.toFixed(0) },
                  { key: 'c', label: 'Cyclone swell %', align: 'right', render: (r) => r.cyclone.toFixed(0) },
                ]}
              />
            }
          />
          <ChartCard
            title="When in the day? Average score by month and hour"
            subtitle="IST, daylight only, coloured relative to the best and worst hour (tooltip shows the average score). Mornings win most of the year — the sea breeze turns onshore around midday."
            chart={<EChart height={290} option={(m) => monthHourOption(mh!, m)} />}
          />
        </div>
      </div>

      <SectionTitle kicker="Wind & swell">What drives it</SectionTitle>
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-1"
          title={`${roseKind === 'wave' ? 'Swell' : 'Wind'} rose — ${MONTHS[month]}`}
          subtitle={roseKind === 'wave' ? 'Direction waves come from, by height (offshore, m)' : `Direction wind comes from, by speed (kt), ${roseKind === 'windAM' ? '05:30–10:30' : '12:30–18:30'}`}
          right={
            <select value={month} onChange={(e) => setMonth(+e.target.value)} aria-label="Month">
              {MONTHS.map((m, i) => (
                <option key={m} value={i}>
                  {m}
                </option>
              ))}
            </select>
          }
          chart={
            clim.data ? (
              <>
                <Segmented size="sm" value={roseKind} onChange={setRoseKind} options={[{ value: 'wave', label: 'Swell' }, { value: 'windAM', label: 'Wind AM' }, { value: 'windPM', label: 'Wind PM' }]} />
                <EChart height={330} option={(m) => roseOption(clim.data!.roses[roseKind][month], roseKind === 'wave' ? clim.data!.roses.hsBins : clim.data!.roses.wsBins, roseKind === 'wave' ? 'm' : 'kt', m)} />
              </>
            ) : (
              <Loading />
            )
          }
        />
        <ChartCard
          title="When does the sea breeze kick in?"
          subtitle={
            clim.data?.seaBreeze.validation
              ? `Typical time the wind turns onshore (≥ 6 kt). Puducherry airport reports vs the model: directions agree within 45° ${clim.data.seaBreeze.validation.dirWithin45Pct}% of the time.`
              : 'Typical time the wind turns onshore (≥ 6 kt)'
          }
          chart={clim.data ? <EChart height={330} option={(m) => seaBreezeOption(clim.data!, m)} /> : <Loading />}
        />
        <ChartCard
          title="How big, by month"
          subtitle="Daily maximum face height: box = middle half of days, whiskers = 10th–90th percentile"
          chart={<EChart height={330} option={(m) => faceBoxOption(boxes!, m)} />}
          table={
            <DataTable
              rows={boxes!.map((b, i) => ({ m: MONTHS[i], b }))}
              columns={[
                { key: 'm', label: 'Month', render: (r) => r.m },
                ...['10%', '25%', 'median', '75%', '90%'].map((l, i) => ({ key: l, label: `${l} (ft)`, align: 'right' as const, render: (r: { b: number[] }) => r.b[i].toFixed(1) })),
              ]}
            />
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Rain by month"
          subtitle="Pondicherry gets most of its rain in the Oct–Dec northeast monsoon — the same season as the cyclones"
          right={
            <select value={calYear} onChange={(e) => setCalYear(+e.target.value)} aria-label="Year">
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          }
          chart={clim.data ? <EChart height={260} option={(m) => rainOption(clim.data!, String(calYear), m)} /> : <Loading />}
        />
        <ChartCard
          title={`${calYear} day by day`}
          subtitle="Each square is a day's best session. Click the wheel or pick a year."
          right={
            <select value={calYear} onChange={(e) => setCalYear(+e.target.value)} aria-label="Calendar year">
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          }
          chart={<EChart height={190} option={(m) => calendarOption(days, calYear, m)} />}
        />
      </div>

      <SectionTitle kicker="Compare">Two months side by side</SectionTitle>
      <Card>
        <div className="flex flex-wrap gap-3 items-center mb-2">
          {[
            ['A', cmpA, setCmpA],
            ['B', cmpB, setCmpB],
          ].map(([k, v, set]: any) => (
            <div key={k} className="flex items-center gap-1.5">
              <span className="text-[12.5px] text-ink2">{k}</span>
              <select value={v.m} onChange={(e) => set({ ...v, m: +e.target.value })}>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
              <select value={v.y} onChange={(e) => set({ ...v, y: +e.target.value })}>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <EChart height={240} option={(m) => compareOption(A, B, `${MONTHS[cmpA.m - 1]} ${cmpA.y}`, `${MONTHS[cmpB.m - 1]} ${cmpB.y}`, m)} />
        <DataTable
          rows={[
            ['Good+ days', sa.good, sb.good],
            ['Great+ days', sa.great, sb.great],
            ['Epic days', sa.epic, sb.epic],
            ['Average best score', sa.meanBest.toFixed(1), sb.meanBest.toFixed(1)],
            ['Average daily max face (ft)', sa.meanFace.toFixed(1), sb.meanFace.toFixed(1)],
            ['Biggest face (ft)', sa.maxFace.toFixed(0), sb.maxFace.toFixed(0)],
            ['Offshore mornings (%)', sa.offshoreMornings.toFixed(0), sb.offshoreMornings.toFixed(0)],
            ['Rain (mm)', sa.rain.toFixed(0), sb.rain.toFixed(0)],
            ['Cyclone swell days', sa.cycloneDays, sb.cycloneDays],
          ]}
          columns={[
            { key: 'k', label: '', render: (r) => r[0] },
            { key: 'a', label: `${MONTHS[cmpA.m - 1]} ${cmpA.y}`, align: 'right', render: (r) => r[1] },
            { key: 'b', label: `${MONTHS[cmpB.m - 1]} ${cmpB.y}`, align: 'right', render: (r) => r[2] },
          ]}
        />
      </Card>

      <SectionTitle kicker="Hall of fame">The biggest days since {days[0].year}</SectionTitle>
      <Card>
        <DataTable
          rows={top}
          maxHeight={420}
          onRow={(d: DayStat) => d.cyclone && go('cyclones')}
          columns={[
            { key: 'd', label: 'Date', render: (d) => fmtDate(d.t) },
            { key: 'f', label: 'Max face', align: 'right', render: (d) => `${d.maxFace.toFixed(0)} ft` },
            { key: 'h', label: 'Offshore Hs', align: 'right', render: (d) => (d.hs != null ? `${d.hs.toFixed(1)} m` : '–') },
            { key: 'p', label: 'Period', align: 'right', render: (d) => (d.tp ? `${d.tp.toFixed(0)} s` : '–') },
            { key: 'dir', label: 'From', render: (d) => compass(d.dir) },
            { key: 's', label: 'Best session', render: (d) => <LabelChip label={labelOf(d.best)} score={d.best} size="sm" /> },
            { key: 'c', label: 'Cause', render: (d) => d.cyclone ?? '' },
          ]}
        />
        <p className="text-[12px] text-muted mt-2">Big days are often blown out — the best session score shows whether the wind cooperated.</p>
      </Card>
    </div>
  );
}
