import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Card, ChartCard, DataTable, ErrorBox, FlagChips, LabelChip, Legend, Loading, Segmented } from '../components/ui';
import { PROFILES } from '../core/profiles';
import { faceText } from '../core/surf';
import type { HourScore } from '../core/types';
import { compass, fmtDateTime, fmtDay, fmtTime, istDayKey, KT_TO_KMH, M_TO_FT, nowS, relTime } from '../core/units';
import { sessionsForDay, type DaySummary } from '../core/windows';
import { useScoredForecast, useTides } from '../state/data';
import { useMode, useSettings } from '../state/settings';
import { dayHourOption, modelLinesOption, periodOption, rainOption, spreadOption, surfHeightOption, swellPartsOption, tideOption, windOption } from '../viz/charts';
import { EChart } from '../viz/EChart';
import { DIVERGING } from '../viz/theme';

function icsFor(hours: HourScore[], minScore: number): string {
  const byDay = new Map<string, HourScore[]>();
  for (const h of hours) {
    const k = istDayKey(h.t);
    (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(h);
  }
  const stamp = (t: number) => new Date(t * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const ev: string[] = [];
  for (const [, hs] of byDay) {
    for (const s of sessionsForDay(hs, 1)) {
      if (s.score < minScore) continue;
      const p = s.peak;
      ev.push(
        [
          'BEGIN:VEVENT',
          `UID:serenity-${s.start}@serenity-surf`,
          `DTSTAMP:${stamp(nowS())}`,
          `DTSTART:${stamp(s.start)}`,
          `DTEND:${stamp(s.end)}`,
          `SUMMARY:Surf ${s.label} ${s.score.toFixed(1)} — ${faceText(p.faceLo, p.faceHi)} @ ${p.tdom?.toFixed(0) ?? '?'} s ${compass(p.swellDir)}`,
          `DESCRIPTION:Serenity Beach forecast. Wind ${p.windType}. Generated ${new Date().toISOString()}.`,
          'LOCATION:Serenity Beach\\, Kottakuppam\\, Puducherry',
          'END:VEVENT',
        ].join('\r\n'),
      );
    }
  }
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Serenity Surf//EN', ...ev, 'END:VCALENDAR'].join('\r\n');
}

function download(name: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function DayCard({ d, active, onClick, conf }: { d: DaySummary; active: boolean; onClick: () => void; conf: string }) {
  const p = d.best?.peak;
  return (
    <button
      onClick={onClick}
      className={`text-left shrink-0 w-[150px] rounded-2xl border p-3 cursor-pointer transition-colors ${active ? 'border-[var(--accent)] bg-[var(--surface)]' : 'border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--hover)]'}`}
      aria-pressed={active}
    >
      <div className="text-[12.5px] font-semibold text-ink">{fmtDay(d.t)}</div>
      <div className="mt-1.5">
        <LabelChip label={d.label} score={d.best?.score} size="sm" />
      </div>
      <div className="mt-2 text-[13px] text-ink">{p ? faceText(p.faceLo, p.faceHi) : '—'}</div>
      <div className="text-[12px] text-ink2">{p ? `${p.tdom?.toFixed(0) ?? '–'} s ${compass(p.swellDir)} · ${p.windType}` : ''}</div>
      <div className="text-[12px] text-ink2 mt-1 tabular-nums">{d.best ? `${fmtTime(d.best.start)}–${fmtTime(d.best.end)}` : ''}</div>
      <div className="text-[11px] text-muted mt-1">{conf} confidence</div>
    </button>
  );
}

export default function Forecast({ params }: { params: URLSearchParams }) {
  const { forecast, hours, days, spread, loading, error, fetchedAt, refetch } = useScoredForecast();
  const tides = useTides();
  const mode = useMode();
  const units = useSettings((s) => s.units);
  const profileId = useSettings((s) => s.profileId);
  const set = useSettings((s) => s.set);
  const [day, setDay] = useState<string>(params.get('day') ?? istDayKey(nowS()));
  const [range, setRange] = useState<'1' | '3' | '16'>('3');

  const conf = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of days) {
      const sp = spread.filter((s) => d.hours.some((h) => h.t === s.t && h.daylight));
      const c = { high: 0, medium: 0, low: 0 } as Record<string, number>;
      sp.forEach((s) => c[s.confidence]++);
      m.set(d.day, sp.length ? Object.entries(c).sort((a, b) => b[1] - a[1])[0][0] : 'low');
    }
    return m;
  }, [days, spread]);

  const sel = days.find((d) => d.day === day) ?? days[0];
  const [t0, t1] = useMemo(() => {
    if (!sel) return [0, 0];
    if (range === '16') return [hours[0]?.t ?? 0, hours[hours.length - 1]?.t ?? 0];
    const n = range === '1' ? 1 : 3;
    return [sel.t, sel.t + n * 86400 - 3600];
  }, [sel, range, hours]);
  const hrs = useMemo(() => hours.filter((h) => h.t >= t0 && h.t <= t1), [hours, t0, t1]);

  if (error && !forecast) return <ErrorBox error={error} retry={refetch} />;
  if (loading || !forecast || !sel) return <Loading text="Building the 16-day forecast…" />;

  const surge = forecast.hours.filter((h) => h.t >= t0 && h.t <= t1).map((h) => [h.t, h.sl ?? null] as [number, number | null]);
  const wu = units.wind === 'kt' ? 'kt' : 'km/h';
  const wk = (v: number | null | undefined) => (v == null ? '–' : (units.wind === 'kt' ? v : v * KT_TO_KMH).toFixed(0));
  const hk = (ft: number) => (units.height === 'ft' ? ft.toFixed(1) : (ft / M_TO_FT).toFixed(2));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-semibold text-ink">16-day surf forecast</h1>
          <p className="text-[13px] text-ink2">
            Serenity Beach · updated {fetchedAt ? relTime(fetchedAt) : '–'} ·{' '}
            <button className="underline bg-transparent border-0 p-0 text-[var(--accent-ink)] cursor-pointer" onClick={refetch}>
              refresh
            </button>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={profileId} onChange={(e) => set({ profileId: e.target.value })} aria-label="Scoring profile">
            {PROFILES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Segmented size="sm" value={units.height} onChange={(v) => set({ units: { ...units, height: v } })} options={[{ value: 'ft', label: 'ft' }, { value: 'm', label: 'm' }]} />
          <Segmented size="sm" value={units.wind} onChange={(v) => set({ units: { ...units, wind: v } })} options={[{ value: 'kt', label: 'kt' }, { value: 'kmh', label: 'km/h' }]} />
          <button className="btn" onClick={() => download('serenity-surf-sessions.ics', icsFor(hours, 4.5), 'text/calendar')} title="Add the best session of every Good+ day to your calendar">
            <Icon name="calendar" size={15} /> Add good sessions to calendar
          </button>
        </div>
      </div>

      <div className="scroll-x -mx-4 px-4">
        <div className="flex gap-2 pb-1">
          {days.map((d) => (
            <DayCard key={d.day} d={d} active={d.day === sel.day} conf={conf.get(d.day) ?? 'low'} onClick={() => setDay(d.day)} />
          ))}
        </div>
      </div>

      <ChartCard
        title="Every hour, every day"
        subtitle="Rows are days, columns are hours (IST). Colour = surf score for your profile; faded = dark. Click a cell to inspect that day."
        chart={<EChart height={Math.max(260, days.length * 26 + 40)} option={(m) => dayHourOption(days, m)} onClick={(p) => p?.data && setDay(days[p.data[1]].day)} />}
        table={
          <DataTable
            rows={days}
            columns={[
              { key: 'd', label: 'Day', render: (d) => fmtDay(d.t) },
              { key: 'l', label: 'Rating', render: (d) => d.label },
              { key: 'b', label: 'Best window', render: (d) => (d.best ? `${fmtTime(d.best.start)}–${fmtTime(d.best.end)} (${d.best.score.toFixed(1)})` : '—') },
              { key: 'am', label: 'Morning', align: 'right', render: (d) => d.am?.toFixed(1) ?? '–' },
              { key: 'pm', label: 'Afternoon', align: 'right', render: (d) => d.pm?.toFixed(1) ?? '–' },
            ]}
          />
        }
      />

      <Card
        title={`${fmtDay(sel.t)} — detail`}
        subtitle={sel.best ? `Best: ${fmtTime(sel.best.start)}–${fmtTime(sel.best.end)} · ${sel.best.label} ${sel.best.score.toFixed(1)}` : 'No surfable window'}
        right={<Segmented size="sm" value={range} onChange={setRange} options={[{ value: '1', label: '1 day' }, { value: '3', label: '3 days' }, { value: '16', label: '16 days' }]} />}
      >
        <FlagChips flags={hrs.flatMap((h) => h.flags)} />
        <div className="mt-3 space-y-1">
          <div className="text-[12.5px] font-semibold text-ink">Surf height at the beach (face, {units.height}) · bar colour = score</div>
          <EChart height={170} group="fc" option={(m) => surfHeightOption(hrs, units, m, t0, t1)} />
          <div className="text-[12.5px] font-semibold text-ink pt-2">Offshore swell components</div>
          <EChart height={170} group="fc" option={(m) => swellPartsOption(forecast, m, t0, t1, units)} />
          <div className="text-[12.5px] font-semibold text-ink pt-2">Peak period · arrows show where the swell is heading</div>
          <EChart height={140} group="fc" option={(m) => periodOption(forecast, m, t0, t1)} />
          <div className="text-[12.5px] font-semibold text-ink pt-2 flex flex-wrap items-center gap-3">
            Wind ({wu}) and gusts
            <Legend
              items={[
                { label: 'offshore', color: DIVERGING[mode].neg },
                { label: 'cross-shore', color: DIVERGING[mode].mid },
                { label: 'onshore', color: DIVERGING[mode].pos },
              ]}
            />
          </div>
          <EChart height={150} group="fc" option={(m) => windOption(forecast, hrs, units, m, t0, t1)} />
          {tides.data && (
            <>
              <div className="text-[12.5px] font-semibold text-ink pt-2">Tide (harmonic prediction) and modelled sea level</div>
              <EChart height={150} group="fc" option={(m) => tideOption(tides.data!, m, t0, t1, units, surge)} />
            </>
          )}
          <div className="text-[12.5px] font-semibold text-ink pt-2">Rain</div>
          <EChart height={110} group="fc" option={(m) => rainOption(forecast, m, t0, t1)} />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Wave models compared"
          subtitle="Offshore significant wave height per model, calibrated to the history climate"
          chart={<EChart height={260} option={(m) => modelLinesOption(forecast, 'wave', units, m)} />}
        />
        <ChartCard
          title="Wind models compared"
          subtitle="Wind speed per model at the beach"
          chart={<EChart height={260} option={(m) => modelLinesOption(forecast, 'wind', units, m)} />}
        />
      </div>

      <ChartCard
        title="Forecast confidence"
        subtitle="Consensus score with the range across all model combinations (10th–90th percentile). Wide band = models disagree."
        chart={<EChart height={220} option={(m) => spreadOption(spread, hours, m)} />}
      />

      <ChartCard
        title="Hourly table"
        subtitle="Everything behind the charts above for the selected range"
        chart={
          <DataTable
            maxHeight={420}
            rows={hrs}
            columns={[
              { key: 't', label: 'Time', render: (h) => fmtDateTime(h.t) },
              { key: 's', label: 'Score', align: 'right', render: (h) => h.score.toFixed(1) },
              { key: 'l', label: 'Rating', render: (h) => h.label },
              { key: 'f', label: `Surf (${units.height})`, align: 'right', render: (h) => `${hk(h.faceLo)}–${hk(h.faceHi)}` },
              { key: 'p', label: 'Period', align: 'right', render: (h) => (h.tdom ? `${h.tdom.toFixed(0)} s` : '–') },
              { key: 'd', label: 'Swell from', render: (h) => compass(h.swellDir) },
              { key: 'w', label: `Wind (${wu})`, align: 'right', render: (h) => wk(forecast.hours.find((x) => x.t === h.t)?.ws) },
              { key: 'wt', label: 'Wind type', render: (h) => h.windType },
              { key: 'tide', label: 'Tide (m)', align: 'right', render: (h) => forecast.hours.find((x) => x.t === h.t)?.tide?.toFixed(2) ?? '–' },
              { key: 'r', label: 'Rain (mm)', align: 'right', render: (h) => (forecast.hours.find((x) => x.t === h.t)?.pr ?? 0).toFixed(1) },
            ]}
          />
        }
      />
    </div>
  );
}
