import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Card, ChartCard, DataTable, Legend, Loading, Pill, SectionTitle, Stat } from '../components/ui';
import { imdCategory, Shadow } from '../core/cyclone';
import type { StormAssessment } from '../core/live';
import { SPOT } from '../core/spot';
import { compass, fmtDate, fmtDateTime, fmtDay, fmtTime, nowS, relTime } from '../core/units';
import type { Field, StormRecord } from '../data/static';
import { loadReplay } from '../data/static';
import {
  useClimatology,
  useCpc,
  useCycloneModel,
  useField,
  useGdacs,
  useGenesis,
  useImd,
  useIndices,
  useJtwc,
  useReplayIndex,
  useScoredForecast,
  useStorms,
  useStormSeries,
} from '../state/data';
import { useMode } from '../state/settings';
import { cvScatterOption, cycloneMonthsOption, genesisOption, mjoPhaseOption, mjoRateOption, monthBarsOption, stormResponseOption, stormSwellOption, stormWindOption } from '../viz/cycloneCharts';
import { EChart } from '../viz/EChart';
import { fieldGrid, fieldLegend, renderField } from '../viz/field';
import { circle, eumetsatTiles, fc, MapView, wedge, type GeoOverlay, type HtmlMarker, type ImageOverlay, type RasterOverlay } from '../viz/MapView';
import { SERIES, TOKENS, withAlpha } from '../viz/theme';

const RING_KM = [809, 1618, 2427]; // 24/48/72 h of 12 s swell travel (group velocity ~9.4 m/s)

function StormCard({ s, onAnalog }: { s: StormAssessment; onAnalog: (sid: string) => void }) {
  const mode = useMode();
  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          <Icon name="cyclone" /> {s.kind.toLowerCase()} {s.name} <span className="text-ink2 font-normal">({s.id})</span>
        </span>
      }
      subtitle={`${s.category.name} · ${s.windKt ?? '–'} kt (1-min) · ${s.lat.toFixed(1)}°N ${s.lon.toFixed(1)}°E · ${Math.round(s.distanceKm)} km from Serenity`}
      right={<Pill tone={s.relevant ? (s.peakFaceHi >= 6 ? 'critical' : 'serious') : 'neutral'}>{s.relevant ? 'swell for Serenity' : 'no swell expected'}</Pill>}
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label="Peak at the beach" value={`${Math.round(s.peakFaceLo)}–${Math.round(s.peakFaceHi)} ft`} sub="cyclone swell alone" />
        <Stat label="Swell arrives" value={s.firstArrival ? `${fmtDay(s.firstArrival)} ${fmtTime(s.firstArrival)}` : '—'} sub={s.firstArrival ? relTime(s.firstArrival) : ''} />
        <Stat label="Peak" value={s.peakTime ? `${fmtDay(s.peakTime)} ${fmtTime(s.peakTime)}` : '—'} sub={s.swell.peak ? `${s.swell.peak.tp.toFixed(0)} s from ${compass(s.swell.peak.dir)}` : ''} />
        <Stat label="Closest approach" value={`${Math.round(s.closestKm)} km`} sub={s.closestKm < 300 ? 'dangerous — stay out' : 'on forecast track'} />
      </div>
      {s.swell.timeline.length > 0 && <EChart height={210} option={(m) => stormSwellOption(s.swell, m)} />}
      {s.analogs.length > 0 && (
        <div className="mt-2">
          <div className="text-[12.5px] font-semibold text-ink">Most similar past storms</div>
          <div className="flex flex-wrap gap-2 mt-1.5">
            {s.analogs.map((a) => (
              <button key={a.sid} className="chip cursor-pointer hover:bg-[var(--hover)]" onClick={() => onAnalog(a.sid)}>
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: SERIES[mode][1] }} />
                {a.sid.slice(0, 4)} · {a.wind ?? '?'} kt · gave {a.obsPeak.toFixed(1)} m
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="text-[11.5px] text-muted mt-2">
        JTWC warning #{s.storm.warningNo ?? '?'} · {s.storm.issued ? fmtDateTime(s.storm.issued) : ''} · <a href={s.storm.url} target="_blank" rel="noreferrer">warning text</a>
      </div>
    </Card>
  );
}

export default function Cyclones({ params }: { params: URLSearchParams }) {
  const mode = useMode();
  const { storms: live, hours } = useScoredForecast();
  const jtwc = useJtwc();
  const gdacs = useGdacs();
  const imd = useImd();
  const genesis = useGenesis();
  const cpc = useCpc();
  const model = useCycloneModel();
  const archive = useStorms();
  const series = useStormSeries();
  const clim = useClimatology();
  const ix = useIndices();
  const field = useField();
  const replays = useReplayIndex();

  const [layers, setLayers] = useState({ satellite: false, swellField: true, genesis: true, cpc: true, rings: true, history: true });
  const [sel, setSel] = useState<string | null>(params.get('storm'));
  const [replay, setReplay] = useState<Field | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [filter, setFilter] = useState({ from: 1980, to: 2026, minWind: 0, swellOnly: true, q: '' });

  const activeField = replay ?? field.data ?? null;
  const grid = useMemo(() => (activeField ? fieldGrid(activeField) : null), [activeField]);
  useEffect(() => {
    if (!activeField) return;
    // start the forecast field at "now"
    const s = replay ? 0 : Math.max(0, Math.min(activeField.n - 1, Math.round((nowS() - activeField.t0) / activeField.dt)));
    setStep(s);
  }, [activeField, replay]);
  useEffect(() => {
    if (!playing || !activeField) return;
    const id = setInterval(() => setStep((s) => (s + 1) % activeField.n), 350);
    return () => clearInterval(id);
  }, [playing, activeField]);

  const selStorm: StormRecord | undefined = archive.data?.storms.find((s) => s.id === sel);

  // ---------------- map overlays ----------------
  const geo: GeoOverlay[] = useMemo(() => {
    const t = TOKENS[mode];
    const accent = SERIES[mode][0];
    const storm = SERIES[mode][1];
    const out: GeoOverlay[] = [];
    out.push({
      id: 'window',
      data: fc([
        { type: 'Feature', properties: { k: 'window' }, geometry: wedge(SPOT.lon, SPOT.lat, SPOT.swellWindow.min, SPOT.swellWindow.max, 1700) },
        { type: 'Feature', properties: { k: 'shadow' }, geometry: wedge(SPOT.lon, SPOT.lat, SPOT.shadow.min, SPOT.shadow.max, 1700) },
      ]),
      layers: [
        { id: 'fill', type: 'fill', paint: { 'fill-color': ['match', ['get', 'k'], 'shadow', t.muted, accent], 'fill-opacity': ['match', ['get', 'k'], 'shadow', 0.16, 0.05] } } as any,
      ],
    });
    if (layers.rings)
      out.push({
        id: 'rings',
        data: fc(RING_KM.map((km) => ({ type: 'Feature', properties: { km }, geometry: { type: 'LineString', coordinates: circle(SPOT.lon, SPOT.lat, km).coordinates[0] } }))),
        layers: [{ id: 'line', type: 'line', paint: { 'line-color': t.ink2, 'line-opacity': 0.35, 'line-width': 1 } } as any],
      });
    if (layers.cpc && cpc.data) {
      const feats = cpc.data.weeks.flatMap((w) => w.features.map((f) => ({ ...f, properties: { ...f.properties, week: w.week } })));
      out.push({
        id: 'cpc',
        data: fc(feats as GeoJSON.Feature[]),
        layers: [
          { id: 'fill', type: 'fill', paint: { 'fill-color': '#fab219', 'fill-opacity': ['interpolate', ['linear'], ['get', 'prob'], 20, 0.1, 60, 0.3] } } as any,
          { id: 'line', type: 'line', paint: { 'line-color': '#fab219', 'line-width': 1.2, 'line-opacity': 0.8 } } as any,
        ],
      });
    }
    if (layers.history && archive.data) {
      const big = archive.data.storms.filter((s) => s.response?.attributedHs != null && !s.response.confounded && s.response.attributedHs - s.response.baseHs >= 1.0);
      out.push({
        id: 'history',
        data: fc(
          big.map((s) => ({
            type: 'Feature',
            properties: { id: s.id, gain: Math.min(3, (s.response.attributedHs ?? 0) - s.response.baseHs) },
            geometry: { type: 'LineString', coordinates: s.track.map((p) => [p[2], p[1]]) },
          })),
        ),
        layers: [
          {
            id: 'line',
            type: 'line',
            paint: {
              'line-color': t.ink2,
              'line-width': ['interpolate', ['linear'], ['get', 'gain'], 1, 0.8, 3, 3],
              'line-opacity': ['interpolate', ['linear'], ['get', 'gain'], 1, 0.25, 3, 0.7],
            },
          } as any,
        ],
      });
    }
    if (layers.genesis && genesis.data) {
      const g = genesis.data;
      const pts: GeoJSON.Feature[] = [];
      g.grid.lats.forEach((la, i) =>
        g.grid.lons.forEach((lo, j) => {
          const k = i * g.grid.lons.length + j;
          const d = g.models.reduce((a, m) => a + (m.density[k] ?? 0), 0) / Math.max(1, g.models.length);
          if (d > 0) pts.push({ type: 'Feature', properties: { d }, geometry: { type: 'Point', coordinates: [lo, la] } });
        }),
      );
      const tracks = g.models.flatMap((m) =>
        m.tracks.filter((tr) => tr.track.length > 1).map((tr) => ({ type: 'Feature' as const, properties: { model: m.label }, geometry: { type: 'LineString' as const, coordinates: tr.track.map((p) => [p.lon, p.lat]) } })),
      );
      out.push({
        id: 'genesis',
        data: fc([...pts, ...tracks]),
        layers: [
          { id: 'tracks', type: 'line', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': storm, 'line-opacity': 0.35, 'line-width': 1 } } as any,
          {
            id: 'dots',
            type: 'circle',
            filter: ['==', ['geometry-type'], 'Point'],
            paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'd'], 0, 3, 5, 18], 'circle-color': storm, 'circle-opacity': 0.25, 'circle-stroke-color': storm, 'circle-stroke-width': 1 },
          } as any,
        ],
      });
    }
    // active storms (JTWC)
    const lf: GeoJSON.Feature[] = [];
    for (const s of live) {
      lf.push({ type: 'Feature', properties: { k: 'track' }, geometry: { type: 'LineString', coordinates: s.storm.fixes.map((f) => [f.lon, f.lat]) } });
      for (const f of s.storm.fixes) {
        lf.push({ type: 'Feature', properties: { k: 'fix', w: f.windKt ?? 25 }, geometry: { type: 'Point', coordinates: [f.lon, f.lat] } });
        if (f.r34Km) lf.push({ type: 'Feature', properties: { k: 'r34' }, geometry: circle(f.lon, f.lat, f.r34Km, 48) });
      }
    }
    out.push({
      id: 'active',
      data: fc(lf),
      layers: [
        { id: 'r34', type: 'fill', filter: ['==', ['get', 'k'], 'r34'], paint: { 'fill-color': storm, 'fill-opacity': 0.08 } } as any,
        { id: 'track', type: 'line', filter: ['==', ['get', 'k'], 'track'], paint: { 'line-color': storm, 'line-width': 2.5 } } as any,
        { id: 'fix', type: 'circle', filter: ['==', ['get', 'k'], 'fix'], paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'w'], 20, 4, 120, 10], 'circle-color': storm, 'circle-stroke-color': t.surface, 'circle-stroke-width': 2 } } as any,
      ],
    });
    if (selStorm) {
      out.push({
        id: 'selected',
        data: fc([
          { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: selStorm.track.map((p) => [p[2], p[1]]) } },
          ...selStorm.track.map((p) => ({ type: 'Feature' as const, properties: { w: p[3] ?? 25 }, geometry: { type: 'Point' as const, coordinates: [p[2], p[1]] } })),
        ]),
        layers: [
          { id: 'line', type: 'line', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': storm, 'line-width': 3 } } as any,
          { id: 'pts', type: 'circle', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'w'], 20, 2.5, 120, 7], 'circle-color': storm, 'circle-stroke-color': t.surface, 'circle-stroke-width': 1 } } as any,
        ],
      });
    }
    return out;
  }, [mode, layers, cpc.data, archive.data, genesis.data, live, selStorm]);

  const rasters: RasterOverlay[] = useMemo(() => (layers.satellite ? [{ id: 'sat', tiles: eumetsatTiles('msg_iodc:ir108'), opacity: 0.55, attribution: '© EUMETSAT' }] : []), [layers.satellite]);
  const shadow = useMemo(() => (model.data ? new Shadow(model.data.shadow) : null), [model.data]);
  const images: ImageOverlay[] = useMemo(() => {
    if (!layers.swellField || !activeField || !grid) return [];
    const r = renderField(activeField, grid, Math.min(step, activeField.n - 1), mode, shadow ? (la, lo) => shadow.onLand(la, lo) : undefined);
    return [{ id: 'field', url: r.url, coordinates: r.coordinates, opacity: 0.9 }];
  }, [layers.swellField, activeField, grid, step, mode, shadow]);

  const markers: HtmlMarker[] = useMemo(() => {
    const t = TOKENS[mode];
    const lab = (txt: string, color: string = t.ink) =>
      `<div style="font:600 11px system-ui;color:${color};background:${withAlpha(t.surface, 0.85)};border:1px solid ${t.border};padding:2px 6px;border-radius:6px;white-space:nowrap">${txt}</div>`;
    const m: HtmlMarker[] = [
      {
        id: 'serenity',
        lngLat: [SPOT.lon, SPOT.lat],
        anchor: 'right',
        html: `<div style="display:flex;align-items:center;gap:4px;transform:translateX(6px)">${lab('Serenity')}<span style="width:12px;height:12px;border-radius:99px;background:${SERIES[mode][0]};border:2px solid ${t.surface};display:inline-block"></span></div>`,
      },
    ];
    if (layers.rings)
      RING_KM.forEach((km, i) => {
        const la = SPOT.lat - (km / 111.2) * Math.cos(Math.PI / 4) * 0.98;
        const lo = SPOT.lon + (km / (111.2 * Math.cos((SPOT.lat * Math.PI) / 180))) * Math.sin(Math.PI / 4) * 0.98;
        m.push({ id: `ring${i}`, lngLat: [lo + 0.0, la + 0.0], html: lab(`${(i + 1) * 24} h`, t.ink2) });
      });
    for (const s of live) {
      const f = s.storm.fixes[0];
      m.push({ id: `st-${s.id}`, lngLat: [f.lon, f.lat], anchor: 'left', html: `<div style="transform:translateX(10px)">${lab(`${s.name} · ${f.windKt ?? '?'} kt`, t.ink)}</div>` });
    }
    for (const inv of jtwc.data?.invests ?? []) {
      m.push({
        id: `inv-${inv.id ?? inv.lat}`,
        lngLat: [inv.lon, inv.lat],
        html: `<div title="${inv.text.replace(/"/g, '')}" style="display:flex;align-items:center;gap:4px"><span style="width:14px;height:14px;border-radius:99px;border:2px solid #fab219;display:inline-block"></span>${lab(`${inv.id ?? 'Invest'} · ${inv.chance ?? '?'}`)}</div>`,
      });
    }
    return m;
  }, [mode, layers.rings, live, jtwc.data]);

  const fitBounds = useMemo<[[number, number], [number, number]] | null>(() => {
    if (!selStorm) return null;
    const lons = selStorm.track.map((p) => p[2]).concat(SPOT.lon);
    const lats = selStorm.track.map((p) => p[1]).concat(SPOT.lat);
    return [
      [Math.min(...lons) - 1, Math.min(...lats) - 1],
      [Math.max(...lons) + 1, Math.max(...lats) + 1],
    ];
  }, [selStorm]);

  // ---------------- archive table ----------------
  const rows = useMemo(() => {
    const st = archive.data?.storms ?? [];
    const q = filter.q.trim().toLowerCase();
    return st
      .filter((s) => s.season >= filter.from && s.season <= filter.to)
      .filter((s) => (s.maxWindKt ?? 0) >= filter.minWind)
      .filter((s) => !filter.swellOnly || ((s.response?.attributedHs ?? 0) - (s.response?.baseHs ?? 0) >= 0.5 && !s.response?.confounded))
      .filter((s) => !q || s.name.toLowerCase().includes(q) || String(s.season).includes(q))
      .sort((a, b) => b.start - a.start);
  }, [archive.data, filter]);

  const curPhase = ix.data ? ix.data.romi.phase[ix.data.romi.phase.length - 1] : undefined;
  const curAmp = ix.data ? ix.data.romi.amp[ix.data.romi.amp.length - 1] : undefined;
  const oni = ix.data ? { v: ix.data.oni.anom[ix.data.oni.anom.length - 1], s: `${ix.data.oni.season[ix.data.oni.season.length - 1]} ${ix.data.oni.year[ix.data.oni.year.length - 1]}` } : null;
  const relevantLive = live.filter((s) => s.relevant);
  const fieldT = activeField ? activeField.t0 + step * activeField.dt : null;
  const cycHours = hours.filter((h) => h.flags.some((f) => f.code === 'cyclone-swell'));

  const toggle = (k: keyof typeof layers) => setLayers((l) => ({ ...l, [k]: !l[k] }));
  const LayerChip = ({ k, label }: { k: keyof typeof layers; label: string }) => (
    <button className="chip cursor-pointer" aria-pressed={layers[k]} onClick={() => toggle(k)} style={{ opacity: layers[k] ? 1 : 0.55 }}>
      <Icon name={layers[k] ? 'check' : 'layers'} size={13} /> {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-semibold text-ink">Cyclone swell tracker</h1>
          <p className="text-[13px] text-ink2">Live JTWC storms, ensemble formation odds and 46 years of Bay of Bengal storms — all judged by the swell they send to Serenity.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill tone={relevantLive.length ? 'critical' : 'good'}>{relevantLive.length ? `${relevantLive.length} storm${relevantLive.length > 1 ? 's' : ''} sending swell` : 'No cyclone swell now'}</Pill>
          {genesis.data?.combined && <Pill tone={genesis.data.combined.pSwell4ft >= 20 ? 'serious' : 'neutral'}>{genesis.data.combined.pSwell4ft.toFixed(0)}% chance of 4 ft+ cyclone swell in 15 d</Pill>}
          {oni && <Pill tone="accent">ENSO {oni.v >= 0.5 ? 'El Niño' : oni.v <= -0.5 ? 'La Niña' : 'neutral'} ({oni.v > 0 ? '+' : ''}{oni.v.toFixed(1)})</Pill>}
          {curPhase && <Pill tone="accent">MJO phase {curPhase} ({(curAmp ?? 0).toFixed(1)})</Pill>}
        </div>
      </div>

      <Card pad={false}>
        <div className="p-3 flex flex-wrap items-center gap-2 border-b border-[var(--border)]">
          <LayerChip k="swellField" label={replay ? `Replay: ${(replay as any).name}` : 'Swell field (15-day)'} />
          <LayerChip k="genesis" label="Ensemble lows" />
          <LayerChip k="cpc" label="NOAA week 2–3" />
          <LayerChip k="history" label="Swell-makers since 1980" />
          <LayerChip k="rings" label="Swell travel time" />
          <LayerChip k="satellite" label="Live satellite (IR)" />
          {replay && (
            <button className="btn" onClick={() => { setReplay(null); setPlaying(false); }}>
              Back to forecast field
            </button>
          )}
        </div>
        <MapView height={560} center={[86, 13]} zoom={3.7} geo={geo} rasters={rasters} images={images} markers={markers} fitBounds={fitBounds} />
        {layers.swellField && activeField && (
          <div className="p-3 flex flex-wrap items-center gap-3 border-t border-[var(--border)]">
            <button className="icon-btn" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'}>
              <Icon name={playing ? 'pause' : 'play'} size={14} />
            </button>
            <input type="range" min={0} max={activeField.n - 1} value={step} onChange={(e) => setStep(+e.target.value)} className="flex-1 min-w-[160px]" aria-label="Time" />
            <span className="text-[12.5px] text-ink tabular-nums w-[150px]">{fieldT ? fmtDateTime(fieldT) : ''}</span>
            <Legend items={fieldLegend(mode).map((l) => ({ ...l, kind: 'swatch' as const }))} />
            <span className="text-[11.5px] text-muted">{activeField.model} · arrows show where waves travel</span>
          </div>
        )}
      </Card>

      {/* active storms */}
      {live.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {live.map((s) => (
            <StormCard key={s.id} s={s} onAnalog={(sid) => { setSel(sid); document.getElementById('archive')?.scrollIntoView({ behavior: 'smooth' }); }} />
          ))}
        </div>
      ) : (
        <Card title="Quiet in the Bay of Bengal right now" subtitle={jtwc.data ? `JTWC checked ${relTime(jtwc.data.fetchedAt)}` : 'Checking JTWC…'}>
          <p className="text-[13.5px] text-ink">
            There is no tropical depression or cyclone being tracked in the North Indian Ocean. Watch the ensemble lows and NOAA's week 2–3 areas on the map — that is where the next swell-maker usually shows up first.
          </p>
          {jtwc.data?.abioNorth && <pre className="mt-3 text-[11.5px] text-ink2 whitespace-pre-wrap font-mono bg-[var(--surface-2)] rounded-lg p-3">{jtwc.data.abioNorth.trim()}</pre>}
          {(gdacs.data ?? []).filter((e) => e.current).length > 0 && (
            <div className="mt-3 text-[12.5px] text-ink2">
              GDACS elsewhere in the region: {(gdacs.data ?? []).filter((e) => e.current).map((e) => `${e.name} (${e.alert})`).join(', ')}
            </div>
          )}
        </Card>
      )}
      {cycHours.length > 0 && (
        <Card title="Cyclone swell in the 16-day forecast">
          <p className="text-[13.5px] text-ink">
            The forecast flags {cycHours.length} hours of cyclone swell, from {fmtDateTime(cycHours[0].t)} to {fmtDateTime(cycHours[cycHours.length - 1].t)}.
          </p>
        </Card>
      )}

      <SectionTitle kicker="Next 15 days">Will a cyclone form?</SectionTitle>
      {genesis.isLoading ? (
        <Loading />
      ) : genesis.data ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Cyclone swell odds" subtitle={`Ensemble scan issued ${relTime(Date.parse(genesis.data.issued) / 1000)}`}>
            <div className="grid grid-cols-2 gap-4">
              <Stat label="Any cyclone-like low" value={`${genesis.data.combined?.pAny15d.toFixed(0) ?? '–'}%`} sub={`${genesis.data.combined?.members ?? 0} ensemble members`} />
              <Stat label="Swell ≥ 4 ft at Serenity" value={`${genesis.data.combined?.pSwell4ft.toFixed(0) ?? '–'}%`} sub="via the cyclone swell model" />
              <Stat label="Swell ≥ 6 ft" value={`${genesis.data.combined?.pSwell6ft.toFixed(0) ?? '–'}%`} />
              <Stat
                label="Possible arrivals"
                value={genesis.data.combined?.arrivals4ft.length ? fmtDay(genesis.data.combined.arrivals4ft[0]) : '—'}
                sub={genesis.data.combined?.arrivals4ft.length ? `${genesis.data.combined.arrivals4ft.length} member(s), earliest first` : 'none of the members'}
              />
            </div>
            <p className="text-[12px] text-muted mt-3">{genesis.data.method.note} Coarse ensembles under-do cyclone winds, so intensity is estimated from the pressure drop.</p>
          </Card>
          <ChartCard className="lg:col-span-2" title="Members with a cyclone-like low, by day" subtitle="Anywhere in the Bay of Bengal (left) vs. close enough and unblocked to send swell (right)" chart={
            <div className="grid sm:grid-cols-2 gap-2">
              <EChart height={210} option={(m) => genesisOption(genesis.data!, 'pAnyByDay', m)} />
              <EChart height={210} option={(m) => genesisOption(genesis.data!, 'pZoneByDay', m)} />
            </div>
          } table={
            <DataTable rows={Array.from({ length: 15 }, (_, i) => i)} columns={[
              { key: 'd', label: 'Day', render: (i) => fmtDay((genesis.data!.models[0]?.start ?? 0) + i * 86400) },
              ...genesis.data!.models.flatMap((m) => [
                { key: m.model + 'a', label: `${m.label} any (%)`, align: 'right' as const, render: (i: number) => m.pAnyByDay[i] },
                { key: m.model + 'z', label: `${m.label} swell zone (%)`, align: 'right' as const, render: (i: number) => m.pZoneByDay[i] },
              ]),
            ]} />
          } />
        </div>
      ) : null}
      {cpc.data && (
        <Card title="NOAA week 2–3 outlook" subtitle={cpc.data.weeks.map((w) => `Week ${w.week}: ${w.validFrom}–${w.validTo}`).join(' · ')}>
          <div className="text-[13.5px] text-ink">
            {cpc.data.weeks.map((w) => (
              <div key={w.week}>
                Week {w.week}: {w.features.length ? `${w.features.length} area(s) in the region with ${[...new Set(w.features.map((f) => (f.properties as any).prob))].join('/')}% formation probability (yellow on the map).` : 'no formation areas near India.'}
              </div>
            ))}
          </div>
        </Card>
      )}

      <SectionTitle kicker="Climate">When do swell-makers form?</SectionTitle>
      {clim.data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Bay of Bengal storms per year, by month" subtitle={`${clim.data.cyclones.total} storms since ${clim.data.cyclones.years?.[0]} (IBTrACS). Two seasons: Apr–May and Oct–Dec.`} chart={<EChart height={240} option={(m) => cycloneMonthsOption(clim.data!, m)} />} table={
            <DataTable rows={Array.from({ length: 12 }, (_, i) => i)} columns={[
              { key: 'm', label: 'Month', render: (i) => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][i] },
              { key: 'd', label: 'Depressions/yr', align: 'right', render: (i) => clim.data!.cyclones.perYearByMonth.dep[i] },
              { key: 'c', label: 'Cyclonic storms/yr', align: 'right', render: (i) => clim.data!.cyclones.perYearByMonth.cs[i] },
              { key: 's', label: 'Severe+/yr', align: 'right', render: (i) => clim.data!.cyclones.perYearByMonth.severe[i] },
              { key: 'w', label: 'Swell-makers/yr', align: 'right', render: (i) => clim.data!.cyclones.swellStormsPerYearByMonth[i] },
            ]} />
          } />
          <div className="grid gap-4">
            <ChartCard title="Storms that sent ≥ 0.5 m of swell to Serenity" subtitle="Per year, by month of formation" chart={<EChart height={130} option={(m) => monthBarsOption(clim.data!.cyclones.swellStormsPerYearByMonth, 'Swell-makers', 'per yr', m, 1)} />} />
            <ChartCard title="Big-swell days (offshore Hs ≥ 2 m)" subtitle="Days per month, 1980 onwards" chart={<EChart height={130} option={(m) => monthBarsOption(clim.data!.bigSwellDays, 'Big-swell days', 'days', m, 0)} />} />
          </div>
          {clim.data.mjo && ix.data && (
            <>
              <ChartCard title="MJO right now" subtitle={`Real-time OMI (NOAA PSL), last 40 days to ${ix.data.romi.last}. Phases 3–5 put the active pulse over the Indian Ocean.`} chart={<EChart height={300} option={(m) => mjoPhaseOption(ix.data!, m)} />} />
              <ChartCard title="Cyclone formation by MJO phase" subtitle={clim.data.mjo.note} chart={<EChart height={300} option={(m) => mjoRateOption(clim.data!, m, curAmp && curAmp >= 1 ? curPhase : undefined)} />} />
            </>
          )}
          {clim.data.enso && oni && (
            <Card title="ENSO and the Oct–Dec season" subtitle={`ONI ${oni.s}: ${oni.v > 0 ? '+' : ''}${oni.v.toFixed(2)} → ${oni.v >= 1.5 ? 'strong ' : ''}${oni.v >= 0.5 ? 'El Niño' : oni.v <= -0.5 ? 'La Niña' : 'neutral'}`} className="lg:col-span-2">
              <DataTable
                rows={Object.entries(clim.data.enso)}
                columns={[
                  { key: 'c', label: 'Oct–Dec ENSO state', render: ([k]) => k },
                  { key: 'n', label: 'Years', align: 'right', render: ([, v]) => v.years.length },
                  { key: 's', label: 'Cyclonic storms (Oct–Dec)', align: 'right', render: ([, v]) => v.meanStormsOND?.toFixed(2) ?? '–' },
                  { key: 'b', label: 'Big-swell days (Oct–Dec)', align: 'right', render: ([, v]) => v.meanBigSwellDaysOND?.toFixed(1) ?? '–' },
                ]}
              />
              <p className="text-[12px] text-muted mt-2">Averages over 1980–2025. Small samples — read them as tendencies, not rules.</p>
            </Card>
          )}
        </div>
      )}

      <SectionTitle kicker="Since 1980">
        <span id="archive">Storm archive</span>
      </SectionTitle>
      <Card>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input placeholder="Search name or year" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} className="w-44" />
          <label className="text-[12.5px] text-ink2 flex items-center gap-1">
            from <input type="number" className="w-20" value={filter.from} onChange={(e) => setFilter({ ...filter, from: +e.target.value })} />
          </label>
          <label className="text-[12.5px] text-ink2 flex items-center gap-1">
            to <input type="number" className="w-20" value={filter.to} onChange={(e) => setFilter({ ...filter, to: +e.target.value })} />
          </label>
          <select value={filter.minWind} onChange={(e) => setFilter({ ...filter, minWind: +e.target.value })} aria-label="Minimum intensity">
            <option value={0}>All systems</option>
            <option value={34}>Cyclonic storms+</option>
            <option value={64}>Very severe+</option>
          </select>
          <label className="text-[12.5px] text-ink flex items-center gap-1.5">
            <input type="checkbox" checked={filter.swellOnly} onChange={(e) => setFilter({ ...filter, swellOnly: e.target.checked })} /> only storms that sent swell
          </label>
          <span className="text-[12px] text-muted ml-auto">{rows.length} storms</span>
        </div>
        {archive.data ? (
          <DataTable
            rows={rows}
            maxHeight={340}
            onRow={(s) => setSel(s.id)}
            columns={[
              { key: 'n', label: 'Storm', render: (s) => <span className={s.id === sel ? 'font-semibold' : ''}>{s.name || 'unnamed'}</span> },
              { key: 'd', label: 'Dates', render: (s) => `${fmtDate(s.start)}` },
              { key: 'g', label: 'IMD', render: (s) => s.imd || imdCategory(s.maxWindKt).code },
              { key: 'w', label: 'Max wind', align: 'right', render: (s) => (s.maxWindKt ? `${s.maxWindKt} kt` : '–') },
              { key: 'c', label: 'Closest', align: 'right', render: (s) => `${s.closestKm} km` },
              { key: 'h', label: 'Peak Hs', align: 'right', render: (s) => (s.response?.attributedHs != null ? `${s.response.attributedHs.toFixed(1)} m` : '–') },
              { key: 'b', label: 'Gain', align: 'right', render: (s) => (s.response?.attributedHs != null ? `+${(s.response.attributedHs - s.response.baseHs).toFixed(1)} m` : '–') },
              { key: 'p', label: 'Model', align: 'right', render: (s) => (s.model ? `${s.model.predPeakHs.toFixed(1)} m` : '–') },
            ]}
          />
        ) : (
          <Loading />
        )}
      </Card>

      {selStorm && (
        <Card
          title={`${selStorm.name || 'Unnamed storm'} ${selStorm.season} — what reached Serenity`}
          subtitle={`${fmtDate(selStorm.start)} → ${fmtDate(selStorm.end)} · ${selStorm.imd || ''} · max ${selStorm.maxWindKt ?? '–'} kt · closest ${selStorm.closestKm} km (${compass(selStorm.closestBearing)})${selStorm.landfall ? ` · landfall ${selStorm.landfall.distKm} km from Serenity` : ''}`}
          right={
            replays.data?.find((r) => r.sid === selStorm.id) ? (
              <button
                className="btn primary"
                onClick={async () => {
                  const r = replays.data!.find((x) => x.sid === selStorm.id)!;
                  const d = await loadReplay(r.file);
                  setLayers((l) => ({ ...l, swellField: true }));
                  setReplay(d);
                  setPlaying(true);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              >
                <Icon name="play" size={14} /> Replay the swell
              </button>
            ) : undefined
          }
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-2">
            <Stat label="Background before" value={`${selStorm.response.baseHs.toFixed(1)} m`} />
            <Stat label="Peak at Serenity" value={`${(selStorm.response.attributedHs ?? selStorm.response.peakHs).toFixed(1)} m`} sub={selStorm.response.peakTp ? `${selStorm.response.peakTp} s from ${compass(selStorm.response.peakDir)}` : ''} />
            <Stat label="Model (hindcast)" value={selStorm.model ? `${selStorm.model.predPeakHs.toFixed(1)} m` : '–'} sub={selStorm.model ? `${selStorm.model.predTp} s` : ''} />
            <Stat label="Hours ≥ 1.5 m" value={selStorm.response.hoursAbove1_5m} sub={selStorm.response.confounded ? 'another storm overlapped' : ''} />
          </div>
          {series.data?.[selStorm.id] ? (
            <>
              <EChart height={210} group="storm" option={(m) => stormResponseOption(series.data![selStorm.id], selStorm, m)} />
              <div className="text-[12.5px] font-semibold text-ink mt-1">Wind at Serenity (blue offshore → red onshore)</div>
              <EChart height={120} group="storm" option={(m) => stormWindOption(series.data![selStorm.id], m)} />
            </>
          ) : (
            <Loading />
          )}
        </Card>
      )}

      {model.data && (
        <>
          <SectionTitle kicker="How good is the model?">Cyclone swell model skill</SectionTitle>
          <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
            <ChartCard title="Predicted vs observed peak (each dot = one storm)" subtitle={`${model.data.metrics.cv} cross-validation on ${model.data.metrics.storms} storms`} chart={<EChart height={280} option={(m) => cvScatterOption(model.data!, m)} />} />
            <Card title="What the numbers say">
              <div className="grid grid-cols-2 gap-4">
                <Stat label="Typical error" value={`${model.data.metrics.mae_m.toFixed(2)} m`} sub={`vs ${model.data.metrics.mae_background_only_m.toFixed(2)} m knowing only the background`} />
                <Stat label="Skill over background" value={`${Math.round(model.data.metrics.skill_vs_background * 100)}%`} sub="reduction in squared error" />
                <Stat label="Correlation" value={model.data.metrics.corr.toFixed(2)} />
                <Stat label="Bias" value={`${model.data.metrics.bias_m > 0 ? '+' : ''}${model.data.metrics.bias_m.toFixed(2)} m`} />
              </div>
              <p className="text-[12.5px] text-ink2 mt-3 leading-relaxed">
                The model starts from Young's (1988) hurricane-wave physics — wind speed, forward speed and size give the waves near the storm — then lets the swell spread and decay on its way to
                Pondicherry, boosts storms heading toward the coast and cuts paths blocked by Sri Lanka or India. Three constants were fitted on {model.data.metrics.storms} storms, each one predicted
                without seeing itself. It is used for live JTWC tracks next to the wave models, which tend to under-do cyclone intensity.
              </p>
            </Card>
          </div>
        </>
      )}
      {(imd.data ?? []).filter((a) => a.relevant).length > 0 && (
        <Card title="IMD official alerts">
          {(imd.data ?? []).filter((a) => a.relevant).slice(0, 8).map((a) => (
            <a key={a.link} className="block text-[13px] py-1" href={a.link} target="_blank" rel="noreferrer">
              {a.title}
            </a>
          ))}
        </Card>
      )}
    </div>
  );
}
