import { useMemo } from 'react';
import { Icon } from '../components/Icon';
import { ScoreDial } from '../components/ScoreDial';
import { Arrow, Card, ErrorBox, FlagChips, LabelChip, Loading, Pill, Stat } from '../components/ui';
import { explain } from '../core/score';
import { sunTimes } from '../core/sun';
import { faceText, faceWords } from '../core/surf';
import { tideWord } from '../core/tide';
import type { HourScore } from '../core/types';
import { compass, fmtDay, fmtTime, istDayKey, KT_TO_KMH, M_TO_FT, nowS, relTime } from '../core/units';
import { sessionsForDay, type Session } from '../core/windows';
import { go } from '../state/router';
import { useGenesis, useImd, useJtwc, useScoredForecast, useTides } from '../state/data';
import { useSettings } from '../state/settings';
import { EChart } from '../viz/EChart';
import { ribbonOption } from '../viz/charts';

function SessionRow({ s, highlight }: { s: Session; highlight?: boolean }) {
  const p = s.peak;
  return (
    <div className={`flex items-center gap-3 py-2.5 ${highlight ? '' : ''}`}>
      <div className="w-[92px] shrink-0">
        <div className="text-[15px] font-semibold text-ink tabular-nums">
          {fmtTime(s.start)}–{fmtTime(s.end)}
        </div>
        <div className="text-[11.5px] text-muted">{fmtDay(s.start)}</div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <LabelChip label={s.label} score={s.score} size="sm" />
          <span className="text-[13px] text-ink">{faceText(p.faceLo, p.faceHi)}</span>
          {p.tdom != null && <span className="text-[13px] text-ink2">@ {p.tdom.toFixed(0)} s {compass(p.swellDir)}</span>}
        </div>
        <div className="text-[12px] text-ink2 mt-0.5">{p.windType} wind{p.flags.length ? ` · ${p.flags.map((f) => f.text).join(' · ')}` : ''}</div>
      </div>
    </div>
  );
}

export default function Today() {
  const { forecast, hours, days, storms, loading, error, fetchedAt, refetch } = useScoredForecast();
  const tides = useTides();
  const jtwc = useJtwc();
  const imd = useImd();
  const genesis = useGenesis();
  const units = useSettings((s) => s.units);
  const now = nowS();

  const cur: HourScore | undefined = useMemo(() => hours.find((h) => h.t >= now - 1800) ?? hours[hours.length - 1], [hours, now]);
  const curIn = forecast?.hours.find((h) => h.t === cur?.t);
  const todayKey = istDayKey(now);
  const todaySessions = useMemo(() => sessionsForDay(hours.filter((h) => istDayKey(h.t) === todayKey && h.t >= now - 1800), 2), [hours, todayKey, now]);
  const tomorrow = days.find((d) => d.day > todayKey);
  const tomorrowSessions = useMemo(() => (tomorrow ? sessionsForDay(tomorrow.hours, 2) : []), [tomorrow]);
  const next72 = useMemo(() => hours.filter((h) => h.t >= now - 3600 && h.t < now + 72 * 3600), [hours, now]);
  const nextGreat = days.find((d) => d.best && d.best.score >= 6.5 && d.best.start > now);
  const sun = sunTimes(now);
  const stage = cur && tides.data ? tides.data.stage(cur.t) : null;
  const nextEx = tides.data?.extremes(now, now + 24 * 3600).slice(0, 2) ?? [];
  const relevant = storms.filter((s) => s.relevant);
  const imdRel = (imd.data ?? []).filter((a) => a.relevant);
  const g = genesis.data?.combined;

  if (error && !forecast) return <ErrorBox error={error} retry={refetch} />;
  if (loading || !cur) return <Loading text="Fetching the latest forecast from 12 weather and wave models…" />;

  const hU = units.height;
  const wv = (kt: number | null | undefined) => (kt == null ? '–' : units.wind === 'kt' ? `${Math.round(kt)} kt` : `${Math.round(kt * KT_TO_KMH)} km/h`);
  const fh = (lo: number, hi: number) => (hU === 'ft' ? faceText(lo, hi) : `${(lo / M_TO_FT).toFixed(1)}–${(hi / M_TO_FT).toFixed(1)} m`);

  return (
    <div className="space-y-4">
      {/* hero */}
      <section className="card hero overflow-hidden">
        <div className="p-4 md:p-6 grid gap-6 lg:grid-cols-[auto_1fr_minmax(280px,360px)] items-start">
          <div className="flex flex-col items-center gap-2">
            <div className="text-[12px] text-ink2 flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#0ca30c' }} /> Right now · {fmtTime(cur.t)}
            </div>
            <ScoreDial score={cur.score} label={cur.label} />
            <div className="text-center">
              <div className="text-[22px] font-semibold text-ink">{fh(cur.faceLo, cur.faceHi)}</div>
              <div className="text-[13px] text-ink2">{faceWords(cur.faceMid)}</div>
            </div>
          </div>

          <div className="min-w-0">
            <h1 className="text-[22px] md:text-[26px] font-semibold text-ink leading-tight">Serenity Beach</h1>
            <p className="text-[13px] text-ink2 mt-1">
              Kottakuppam, Puducherry · beach faces ESE (106°) · offshore wind from the WNW
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4 mt-5">
              <Stat
                icon="wave"
                label="Swell"
                value={
                  <span className="inline-flex items-center gap-1.5">
                    {curIn?.hs != null ? (hU === 'ft' ? `${(curIn.hs * M_TO_FT).toFixed(1)} ft` : `${curIn.hs.toFixed(1)} m`) : '–'}
                    <span className="text-ink2 text-[15px]">@ {curIn?.tp?.toFixed(0) ?? '–'} s</span>
                  </span>
                }
                sub={
                  <span className="inline-flex items-center gap-1">
                    <Arrow deg={curIn?.dir ?? null} size={13} /> from {compass(curIn?.dir)} ({Math.round(curIn?.dir ?? 0)}°)
                  </span>
                }
              />
              <Stat
                icon="wind"
                label="Wind"
                value={wv(curIn?.ws)}
                sub={
                  <span className="inline-flex items-center gap-1">
                    <Arrow deg={curIn?.wd ?? null} size={13} /> {compass(curIn?.wd)} · {cur.windType}
                  </span>
                }
              />
              <Stat
                icon="tide"
                label="Tide"
                value={stage ? `${stage.h >= 0 ? '+' : ''}${stage.h.toFixed(2)} m` : '–'}
                sub={stage ? `${tideWord(stage.norm, stage.rising)}${nextEx[0] ? ` · ${nextEx[0].type} ${fmtTime(nextEx[0].t)}` : ''}` : ''}
              />
              <Stat icon="temp" label="Water" value={curIn?.sst != null ? `${curIn.sst.toFixed(1)}°C` : '–'} sub="boardshorts" />
              <Stat icon="sunrise" label="Daylight" value={`${fmtTime(sun.sunrise)}–${fmtTime(sun.sunset)}`} sub="first light ~20 min before" />
              <Stat icon="rain" label="Rain (next 3 h)" value={`${forecast!.hours.filter((h) => h.t >= now && h.t < now + 3 * 3600).reduce((a, h) => a + (h.pr ?? 0), 0).toFixed(1)} mm`} sub={curIn?.pp != null ? `${curIn.pp}% chance this hour` : ''} />
            </div>
            <div className="mt-4">
              <FlagChips flags={cur.flags} />
            </div>
            <details className="mt-3 text-[12.5px] text-ink2">
              <summary className="cursor-pointer select-none">Why {cur.score.toFixed(1)}?</summary>
              <ul className="mt-1.5 list-disc pl-5 space-y-0.5">
                {explain(cur).map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </details>
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="text-[13px] font-semibold text-ink">Best sessions</div>
            <div className="text-[11.5px] text-muted">Today (remaining) and tomorrow · 2–3 h windows in daylight</div>
            <div className="divide-y divide-[var(--grid)] mt-1">
              {todaySessions.map((s) => (
                <SessionRow key={s.start} s={s} />
              ))}
              {!todaySessions.length && <div className="py-3 text-[13px] text-ink2">Nothing left today — it's dark or the window has passed.</div>}
              {tomorrowSessions.map((s) => (
                <SessionRow key={s.start} s={s} />
              ))}
            </div>
            {nextGreat && (
              <button className="btn w-full justify-center mt-3" onClick={() => go('forecast', { day: nextGreat.day })}>
                <Icon name="star" size={15} /> Next Great+: {fmtDay(nextGreat.best!.start)} {fmtTime(nextGreat.best!.start)} ({relTime(nextGreat.best!.start)})
              </button>
            )}
          </div>
        </div>
      </section>

      {/* next 72h ribbon */}
      <Card
        title="Next 72 hours"
        subtitle="Hourly surf score for your profile · faded cells are dark hours · tap the Forecast tab for detail"
        right={
          <button className="btn" onClick={() => go('forecast')}>
            16 days <Icon name="calendar" size={15} />
          </button>
        }
      >
        <EChart height={64} option={(m) => ribbonOption(next72, m)} />
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-3">
          {days.slice(0, 6).map((d) => (
            <button key={d.day} className="text-left rounded-xl border border-[var(--border)] p-2.5 hover:bg-[var(--hover)] bg-transparent cursor-pointer" onClick={() => go('forecast', { day: d.day })}>
              <div className="text-[12px] text-ink2">{fmtDay(d.t)}</div>
              <div className="mt-1">
                <LabelChip label={d.label} size="sm" />
              </div>
              <div className="text-[12px] text-ink mt-1 tabular-nums">{d.best ? `${fmtTime(d.best.start)} · ${d.best.score.toFixed(1)}` : '—'}</div>
            </button>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title={
            <span className="inline-flex items-center gap-2">
              <Icon name="cyclone" /> Cyclone watch
            </span>
          }
          subtitle={jtwc.data ? `JTWC checked ${relTime(jtwc.data.fetchedAt)}` : jtwc.isLoading ? 'Checking JTWC…' : 'JTWC unavailable'}
          right={
            <button className="btn" onClick={() => go('cyclones')}>
              Open tracker
            </button>
          }
        >
          {relevant.length ? (
            <div className="space-y-3">
              {relevant.map((s) => (
                <div key={s.id} className="rounded-xl border border-[var(--border)] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-ink">
                      {s.kind.toLowerCase()} {s.name}
                    </div>
                    <Pill tone={s.distanceKm < 500 ? 'critical' : 'serious'}>{Math.round(s.distanceKm)} km away</Pill>
                  </div>
                  <div className="text-[13px] text-ink2 mt-1">
                    {s.category.name} · {s.windKt ?? '–'} kt · predicted swell at Serenity {Math.round(s.peakFaceLo)}–{Math.round(s.peakFaceHi)} ft
                    {s.firstArrival ? `, arriving ${fmtDay(s.firstArrival)} ${fmtTime(s.firstArrival)}` : ''}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[13.5px] text-ink">
              No active storms sending swell to Serenity.
              {storms.length > 0 && <span className="text-ink2"> Tracking {storms.length} storm{storms.length > 1 ? 's' : ''} elsewhere in the region.</span>}
            </div>
          )}
          {g && (
            <div className="mt-4 grid grid-cols-3 gap-3">
              <Stat label="Cyclone-like low, 15 d" value={`${Math.round(g.pAny15d)}%`} sub="ECMWF + GFS ensembles" />
              <Stat label="Cyclone swell ≥ 4 ft" value={`${g.pSwell4ft.toFixed(0)}%`} sub="next 15 days" />
              <Stat label="Cyclone swell ≥ 6 ft" value={`${g.pSwell6ft.toFixed(0)}%`} sub="next 15 days" />
            </div>
          )}
          {jtwc.data?.invests?.length ? (
            <div className="mt-3 text-[12.5px] text-ink2">
              JTWC is watching {jtwc.data.invests.map((i) => `${i.id ?? 'a disturbance'} (${i.lat.toFixed(1)}°, ${i.lon.toFixed(1)}° — ${i.chance ?? '?'} chance)`).join(', ')}.
            </div>
          ) : null}
          {imdRel.length > 0 && (
            <div className="mt-3 space-y-1">
              {imdRel.slice(0, 3).map((a) => (
                <a key={a.link} href={a.link} target="_blank" rel="noreferrer" className="block text-[12.5px]">
                  IMD: {a.title}
                </a>
              ))}
            </div>
          )}
        </Card>

        <Card title="How sure is this?" subtitle={fetchedAt ? `Updated ${relTime(fetchedAt)} · ${forecast!.hours.length} hours from 4 wave + 8 wind models` : ''} right={<button className="icon-btn" onClick={refetch} aria-label="Refresh"><Icon name="refresh" size={15} /></button>}>
          <p className="text-[13.5px] text-ink leading-relaxed">
            Heights come from the median of four wave models (Météo-France MFWAM, ECMWF WAM 9 km, GFS-Wave, ECMWF WAM 25 km), each calibrated onto the same climate as the
            10-year history. Wind is the median of eight models. They were transformed to breaking waves at the beach for the beach's angle (106°).
          </p>
          <p className="text-[12.5px] text-ink2 mt-2">
            Your logged sessions tune the size estimate — see <a href="#/log">Log & settings</a>. Days 1–3 are usually reliable; beyond a week treat it as a trend.
          </p>
        </Card>
      </div>
    </div>
  );
}
