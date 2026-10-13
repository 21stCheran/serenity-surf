import { useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { Card, DataTable, Pill, Segmented, SectionTitle, Stat } from '../components/ui';
import { PROFILES } from '../core/profiles';
import { DEFAULT_CAL, faceText } from '../core/surf';
import { SPOT } from '../core/spot';
import type { HourScore } from '../core/types';
import { fmtDateTime } from '../core/units';
import { useScoredForecast, useScoredHistory } from '../state/data';
import { useSettings, type LoggedSession } from '../state/settings';

const ALERT_URL = `${SPOT.siteUrl}api/alert.json`;

function Stars({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${value} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <button key={i} type="button" className="bg-transparent border-0 p-0 cursor-pointer" onClick={() => onChange?.(i)} aria-label={`${i} star${i > 1 ? 's' : ''}`} style={{ color: i <= value ? '#eda100' : 'var(--grid)' }}>
          <Icon name="star" size={18} />
        </button>
      ))}
    </span>
  );
}

export default function Log() {
  const s = useSettings();
  const { hours: hist } = useScoredHistory();
  const fc = useScoredForecast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ date: new Date(Date.now() + 19800e3).toISOString().slice(0, 10), time: '06:30', hours: 2, rating: 4, faceFt: '', board: "6'10", notes: '' });
  const [msg, setMsg] = useState('');

  // conditions the model had for each logged session
  const byT = useMemo(() => {
    const m = new Map<number, HourScore>();
    (hist ?? []).forEach((h) => m.set(h.t, h));
    fc.hours.forEach((h) => m.set(h.t, h));
    return m;
  }, [hist, fc.hours]);
  const modelFor = (l: LoggedSession): HourScore | null => {
    const hs: HourScore[] = [];
    for (let t = Math.floor(l.t / 3600) * 3600 - 1800; t < l.t + l.hours * 3600; t += 3600) {
      const h = byT.get(t) ?? byT.get(t + 1800);
      if (h) hs.push(h);
    }
    if (!hs.length) return null;
    return hs.reduce((a, b) => (b.score > a.score ? b : a));
  };

  const rows = s.log.map((l) => ({ l, m: modelFor(l) }));
  const calib = useMemo(() => {
    const withFace = rows.filter((r) => r.m && r.l.faceFt != null && r.l.faceFt > 0);
    const ratios = withFace.map((r) => (r.l.faceFt as number) / Math.max(0.5, r.m!.faceMid / s.cal.sizeMultiplier)).sort((a, b) => a - b);
    const med = ratios.length ? ratios[Math.floor(ratios.length / 2)] : null;
    const good = rows.filter((r) => r.m && r.l.rating >= 4);
    return { n: withFace.length, sizeMultiplier: med, nGood: good.length };
  }, [rows, s.cal.sizeMultiplier]);

  const add = () => {
    const t = Date.parse(`${form.date}T${form.time}:00+05:30`) / 1000;
    if (!Number.isFinite(t)) return;
    s.addLog({ id: String(t), t, hours: +form.hours, rating: form.rating, faceFt: form.faceFt ? +form.faceFt : null, board: form.board, notes: form.notes });
    setMsg('Session saved on this device.');
  };

  const exportLog = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, settings: { profileId: s.profileId, cal: s.cal, units: s.units, tidePref: s.tidePref }, log: s.log }, null, 1)], { type: 'application/json' }));
    a.download = 'serenity-surf-log.json';
    a.click();
  };
  const importLog = async (f: File) => {
    try {
      const j = JSON.parse(await f.text());
      (j.log ?? []).forEach((l: LoggedSession) => s.addLog(l));
      if (j.settings?.cal) s.set({ cal: { ...DEFAULT_CAL, ...j.settings.cal } });
      setMsg(`Imported ${(j.log ?? []).length} sessions.`);
    } catch (e) {
      setMsg(`Import failed: ${String(e)}`);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[24px] font-semibold text-ink">Log & settings</h1>
        <p className="text-[13px] text-ink2">Everything here stays on this device (browser storage). Export it to move between phone and laptop.</p>
      </div>

      <SectionTitle kicker="Scoring">Your surfing profile</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PROFILES.map((p) => (
          <button key={p.id} onClick={() => s.set({ profileId: p.id })} className={`card text-left p-4 cursor-pointer ${s.profileId === p.id ? 'ring-2 ring-[var(--accent)]' : ''}`} aria-pressed={s.profileId === p.id}>
            <div className="flex items-center justify-between">
              <div className="font-semibold text-ink">{p.name}</div>
              {s.profileId === p.id && <Pill tone="accent">active</Pill>}
            </div>
            <div className="text-[12px] text-ink2 mt-0.5">{p.board}</div>
            <p className="text-[12.5px] text-ink2 mt-2">{p.blurb}</p>
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Units & display">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13.5px] text-ink">Wave height</span>
              <Segmented size="sm" value={s.units.height} onChange={(v) => s.set({ units: { ...s.units, height: v } })} options={[{ value: 'ft', label: 'feet' }, { value: 'm', label: 'metres' }]} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13.5px] text-ink">Wind</span>
              <Segmented size="sm" value={s.units.wind} onChange={(v) => s.set({ units: { ...s.units, wind: v } })} options={[{ value: 'kt', label: 'knots' }, { value: 'kmh', label: 'km/h' }]} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13.5px] text-ink">Theme</span>
              <Segmented size="sm" value={s.theme} onChange={(v) => s.set({ theme: v })} options={[{ value: 'system', label: 'System' }, { value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} />
            </div>
          </div>
        </Card>
        <Card title="Calibration" subtitle="Tune the model to what you actually see at Serenity">
          <div className="space-y-4">
            <label className="block">
              <div className="flex justify-between text-[13px] text-ink">
                <span>Size multiplier</span>
                <span className="tabular-nums">×{s.cal.sizeMultiplier.toFixed(2)}</span>
              </div>
              <input type="range" min={0.5} max={1.8} step={0.01} value={s.cal.sizeMultiplier} onChange={(e) => s.set({ cal: { ...s.cal, sizeMultiplier: +e.target.value } })} className="w-full" />
              <div className="text-[11.5px] text-muted">If the dashboard says 4 ft and it's really 3 ft, set ×0.75.</div>
            </label>
            <label className="block">
              <div className="flex justify-between text-[13px] text-ink">
                <span>Preferred tide</span>
                <span>{s.tidePref == null ? 'profile default (mid)' : s.tidePref < 0.33 ? 'low' : s.tidePref > 0.67 ? 'high' : 'mid'}</span>
              </div>
              <input type="range" min={0} max={1} step={0.05} value={s.tidePref ?? 0.5} onChange={(e) => s.set({ tidePref: +e.target.value })} className="w-full" />
            </label>
            <div className="flex flex-wrap gap-2">
              <button className="btn" disabled={!calib.sizeMultiplier} onClick={() => calib.sizeMultiplier && s.set({ cal: { ...s.cal, sizeMultiplier: Math.max(0.5, Math.min(1.8, +calib.sizeMultiplier.toFixed(2))) } })}>
                Auto-calibrate size from {calib.n} logged session{calib.n === 1 ? '' : 's'}
              </button>
              <button className="btn" onClick={() => s.set({ cal: DEFAULT_CAL, tidePref: null })}>
                Reset
              </button>
            </div>
            {calib.sizeMultiplier && <div className="text-[12px] text-ink2">Your logs suggest ×{calib.sizeMultiplier.toFixed(2)}.</div>}
          </div>
        </Card>
      </div>

      <SectionTitle kicker="Sessions">Surf log</SectionTitle>
      <Card title="Log a session" subtitle="Rate it and note the size you saw — the dashboard compares it with what the model said">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 items-end">
          <label className="text-[12.5px] text-ink2">
            Date
            <input type="date" className="w-full mt-1" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </label>
          <label className="text-[12.5px] text-ink2">
            Start
            <input type="time" className="w-full mt-1" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
          </label>
          <label className="text-[12.5px] text-ink2">
            Hours
            <input type="number" min={0.5} max={6} step={0.5} className="w-full mt-1" value={form.hours} onChange={(e) => setForm({ ...form, hours: +e.target.value })} />
          </label>
          <label className="text-[12.5px] text-ink2">
            Face height seen (ft)
            <input type="number" min={0} max={20} step={0.5} className="w-full mt-1" value={form.faceFt} onChange={(e) => setForm({ ...form, faceFt: e.target.value })} />
          </label>
          <label className="text-[12.5px] text-ink2">
            Board
            <input className="w-full mt-1" value={form.board} onChange={(e) => setForm({ ...form, board: e.target.value })} />
          </label>
          <div className="text-[12.5px] text-ink2">
            Rating
            <div className="mt-1">
              <Stars value={form.rating} onChange={(v) => setForm({ ...form, rating: v })} />
            </div>
          </div>
          <label className="text-[12.5px] text-ink2 sm:col-span-2 lg:col-span-5">
            Notes
            <input className="w-full mt-1" placeholder="banks, crowd, which groyne, wind…" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
          <button className="btn primary justify-center" onClick={add}>
            <Icon name="plus" size={15} /> Save session
          </button>
        </div>
        {msg && <div className="text-[12.5px] text-ink2 mt-2">{msg}</div>}
      </Card>

      <Card
        title={`${s.log.length} logged session${s.log.length === 1 ? '' : 's'}`}
        right={
          <>
            <button className="btn" onClick={exportLog}>
              <Icon name="download" size={14} /> Export
            </button>
            <button className="btn" onClick={() => fileRef.current?.click()}>
              Import
            </button>
            <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importLog(e.target.files[0])} />
          </>
        }
      >
        {s.log.length ? (
          <DataTable
            rows={rows}
            columns={[
              { key: 't', label: 'When', render: (r) => fmtDateTime(r.l.t) },
              { key: 'r', label: 'Your rating', render: (r) => <Stars value={r.l.rating} /> },
              { key: 'f', label: 'You saw', align: 'right', render: (r) => (r.l.faceFt != null ? `${r.l.faceFt} ft` : '–') },
              { key: 'mf', label: 'Model said', align: 'right', render: (r) => (r.m ? faceText(r.m.faceLo, r.m.faceHi) : 'no data') },
              { key: 'ms', label: 'Model score', align: 'right', render: (r) => (r.m ? `${r.m.score.toFixed(1)} ${r.m.label}` : '–') },
              { key: 'w', label: 'Wind', render: (r) => r.m?.windType ?? '–' },
              { key: 'n', label: 'Notes', render: (r) => r.l.notes },
              {
                key: 'x',
                label: '',
                render: (r) => (
                  <button className="icon-btn" aria-label="Delete session" onClick={() => s.removeLog(r.l.id)}>
                    <Icon name="trash" size={14} />
                  </button>
                ),
              },
            ]}
          />
        ) : (
          <p className="text-[13.5px] text-ink2">No sessions yet. After each surf, log the time, a 1–5 rating and the face height you saw. After 5–10 sessions, auto-calibrate.</p>
        )}
      </Card>

      <SectionTitle kicker="Phone">5 am alerts</SectionTitle>
      <Card title="Alert feed for iPhone Shortcuts / Android" subtitle="Refreshed every 3 hours and at 03:30 IST">
        <div className="text-[13.5px] text-ink space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <code className="text-[12.5px] bg-[var(--surface-2)] rounded-md px-2 py-1 break-all">{ALERT_URL}</code>
            <button className="btn" onClick={() => navigator.clipboard?.writeText(ALERT_URL)}>
              Copy
            </button>
            <a className="btn no-underline" href={ALERT_URL} target="_blank" rel="noreferrer">
              Open
            </a>
          </div>
          <ol className="list-decimal pl-5 space-y-1 text-[13px] text-ink2">
            <li>Shortcuts app → Automation → New → Time of Day → 5:00 AM, daily → Run Immediately.</li>
            <li>Add "Get Contents of URL" with the address above.</li>
            <li>Add "Get Dictionary Value" for key <code>notify</code> (or compare <code>score</code> with your own threshold).</li>
            <li>Add "If" notify is true → "Show Notification" with <code>title</code> and <code>message</code>.</li>
          </ol>
          <p className="text-[12px] text-muted">
            Fields: notify, notify_great, level (none/good/great/epic/cyclone), title, message, score, today, tomorrow, next_great, cyclone. The full guide lives in docs/phone-alerts.md in the repo.
          </p>
        </div>
      </Card>

      <Card title="About this dashboard">
        <div className="grid gap-4 md:grid-cols-3 text-[12.5px] text-ink2">
          <Stat label="Spot" value="Serenity Beach" sub={`${SPOT.lat}°N ${SPOT.lon}°E · faces ${SPOT.beachNormal}°`} />
          <Stat label="Models" value="4 wave + 8 wind" sub="median consensus, history-calibrated" />
          <Stat label="History" value="1980 → today" sub="hourly detail from 2015" />
        </div>
      </Card>
    </div>
  );
}
