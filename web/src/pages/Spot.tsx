import { useMemo, useState } from 'react';
import { Card, ChartCard, DataTable, Loading, Pill, SectionTitle, Stat } from '../components/ui';
import { cycloneDays, dayStats } from '../core/history';
import { SPOT } from '../core/spot';
import { tideWord } from '../core/tide';
import { compass, fmtDate, MONTHS, nowS } from '../core/units';
import type { Coastal } from '../data/static';
import { useCoastal, useImagery, useOsm, useScoredHistory, useStorms, useTides } from '../state/data';
import { useMode } from '../state/settings';
import { tideOption } from '../viz/charts';
import { EChart, type EOption } from '../viz/EChart';
import { fc, MapView, wedge, type GeoOverlay, type HtmlMarker, type RasterOverlay } from '../viz/MapView';
import { DIVERGING, SERIES, TOKENS, withAlpha, type Mode } from '../viz/theme';

function driftMonthsOption(c: Coastal, mode: Mode): EOption {
  const d = DIVERGING[mode];
  return {
    grid: { left: 54, right: 12, top: 16, bottom: 26 },
    xAxis: { type: 'category', data: MONTHS },
    yAxis: { type: 'value', name: 'k m³/month', axisLabel: { formatter: (v: number) => (v / 1000).toFixed(0) } },
    tooltip: { trigger: 'axis', formatter: (ps: any) => { const r = c.monthlyClimatology[ps[0].dataIndex]; return `${MONTHS[r.month - 1]}<br/>Net ${r.net > 0 ? 'north' : 'south'} ${Math.abs(r.net / 1000).toFixed(0)}k m³<br/>(north ${Math.round(r.north / 1000)}k, south ${Math.round(r.south / 1000)}k)`; } },
    series: [{ type: 'bar', data: c.monthlyClimatology.map((r) => ({ value: r.net, itemStyle: { color: r.net >= 0 ? d.neg : d.pos, borderRadius: r.net >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4] } })), barMaxWidth: 22 }],
  };
}

function omegaOption(c: Coastal, mode: Mode, days = 540): EOption {
  const n = c.daily.omega.length;
  const i0 = Math.max(0, n - days);
  const t = (i: number) => (c.daily.t0 + i * c.daily.dt) * 1000;
  const bands = c.method.states.map((s, k) => ({ from: k === 0 ? 0 : c.method.states[k - 1].maxOmega ?? 0, to: s.maxOmega ?? 8, code: s.code }));
  const s = SERIES[mode][0];
  return {
    grid: { left: 40, right: 60, top: 12, bottom: 26 },
    xAxis: { type: 'time', min: t(i0), max: t(n - 1), axisLabel: { hideOverlap: true } },
    yAxis: { type: 'value', min: 0, max: 7, name: 'Ω' },
    tooltip: { trigger: 'axis', formatter: (ps: any) => `${fmtDate(ps[0].value[0] / 1000)}<br/>Ω ${Number(ps[0].value[1]).toFixed(2)} — ${c.daily.state[i0 + ps[0].dataIndex]}` },
    series: [
      {
        type: 'line',
        data: c.daily.omega.slice(i0).map((v, i) => [t(i0 + i), v]),
        showSymbol: false,
        lineStyle: { width: 2, color: s },
        markArea: {
          silent: true,
          data: bands.map((b, k) => [
            { yAxis: b.from, itemStyle: { color: k % 2 ? withAlpha(TOKENS[mode].ink, 0.03) : 'transparent' }, label: { show: true, position: 'right', formatter: b.code, color: TOKENS[mode].muted, fontSize: 10 } },
            { yAxis: b.to },
          ]) as any,
        },
      },
    ],
  };
}

const STATE_TEXT: Record<string, string> = {
  R: 'Reflective: steep, narrow beach with no bar. Waves surge up the sand — shorey closeouts.',
  LTT: 'Low-tide terrace: a flat shelf at low tide. Waves can peel across the terrace on the lower tide.',
  TBR: 'Transverse bar & rip: bars joined to the beach with rips between them — the classic peaky beachbreak.',
  RBB: 'Rhythmic bar & beach: a wavy outer bar with rip channels. Good, punchy peaks when the swell is clean.',
  LBT: 'Longshore bar-trough: a continuous outer bar and deep trough — waves break outside then reform.',
  D: 'Dissipative: wide surf zone after big swells; many lines of whitewater, sand pushed offshore.',
};

export default function Spot() {
  const mode = useMode();
  const osm = useOsm();
  const imagery = useImagery();
  const coastal = useCoastal();
  const tides = useTides();
  const storms = useStorms();
  const { hours, inputs, loading } = useScoredHistory();
  const [a, setA] = useState<string>('esri-now');
  const [b, setB] = useState<string>('eox-2018');
  const [mix, setMix] = useState(0);

  const sources = useMemo(() => {
    const out: { id: string; label: string; tiles: string[]; maxzoom: number }[] = [
      { id: 'esri-now', label: 'Esri World Imagery (latest)', tiles: ['https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], maxzoom: 19 },
    ];
    for (const w of imagery.data?.wayback ?? [])
      out.push({
        id: `wb-${w.release}`,
        label: `${w.captured ? fmtDate(w.captured) : w.releaseDate} · ${w.provider ?? 'Wayback'}${w.resolution_m ? ` ${w.resolution_m.toFixed(1)} m` : ''}`,
        tiles: [imagery.data!.waybackTemplate.replace('{release}', String(w.release))],
        maxzoom: 19,
      });
    for (const e of imagery.data?.eox ?? []) out.push({ id: `eox-${e.year}`, label: `Sentinel-2 cloudless ${e.year} (10 m)`, tiles: [e.template], maxzoom: 15 });
    return out;
  }, [imagery.data]);
  const srcA = sources.find((s) => s.id === a) ?? sources[0];
  const srcB = sources.find((s) => s.id === b) ?? sources[0];

  const geo: GeoOverlay[] = useMemo(() => {
    const t = TOKENS[mode];
    const out: GeoOverlay[] = [];
    if (osm.data)
      out.push({
        id: 'osm',
        data: osm.data,
        layers: [
          { id: 'beach', type: 'fill', filter: ['==', ['get', 'kind'], 'beach'], paint: { 'fill-color': '#eda100', 'fill-opacity': 0.12 } } as any,
          { id: 'coast', type: 'line', filter: ['==', ['get', 'kind'], 'coastline'], paint: { 'line-color': '#ffffff', 'line-opacity': 0.5, 'line-width': 1 } } as any,
          { id: 'struct', type: 'line', filter: ['!', ['in', ['get', 'kind'], ['literal', ['coastline', 'beach']]]], paint: { 'line-color': '#eb6834', 'line-width': 3.5 } } as any,
        ],
      });
    const len = 1.1; // km
    const end = (deg: number, km: number): [number, number] => [SPOT.lon + (km / (111.32 * Math.cos((SPOT.lat * Math.PI) / 180))) * Math.sin((deg * Math.PI) / 180), SPOT.lat + (km / 110.57) * Math.cos((deg * Math.PI) / 180)];
    out.push({
      id: 'geom',
      data: fc([
        { type: 'Feature', properties: { k: 'window' }, geometry: wedge(SPOT.lon, SPOT.lat, SPOT.swellWindow.min + 20, SPOT.swellWindow.max - 20, len) },
        { type: 'Feature', properties: { k: 'shadow' }, geometry: wedge(SPOT.lon, SPOT.lat, SPOT.shadow.min, SPOT.shadow.max, len) },
        { type: 'Feature', properties: { k: 'normal' }, geometry: { type: 'LineString', coordinates: [[SPOT.lon, SPOT.lat], end(SPOT.beachNormal, len * 1.15)] } },
        { type: 'Feature', properties: { k: 'offshore' }, geometry: { type: 'LineString', coordinates: [end(SPOT.offshoreFrom, 0.9), [SPOT.lon, SPOT.lat]] } },
      ]),
      layers: [
        { id: 'w', type: 'fill', filter: ['==', ['get', 'k'], 'window'], paint: { 'fill-color': SERIES[mode][0], 'fill-opacity': 0.12 } } as any,
        { id: 's', type: 'fill', filter: ['==', ['get', 'k'], 'shadow'], paint: { 'fill-color': t.muted, 'fill-opacity': 0.25 } } as any,
        { id: 'n', type: 'line', filter: ['==', ['get', 'k'], 'normal'], paint: { 'line-color': SERIES[mode][0], 'line-width': 3 } } as any,
        { id: 'o', type: 'line', filter: ['==', ['get', 'k'], 'offshore'], paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-opacity': 0.8 } } as any,
      ],
    });
    return out;
  }, [osm.data, mode]);

  const rasters: RasterOverlay[] = useMemo(
    () => [
      { id: `a-${srcA.id}`, tiles: srcA.tiles, opacity: 1, maxzoom: srcA.maxzoom, attribution: imagery.data?.attribution.wayback },
      ...(mix > 0 ? [{ id: `b-${srcB.id}`, tiles: srcB.tiles, opacity: mix, maxzoom: srcB.maxzoom, attribution: srcB.id.startsWith('eox') ? imagery.data?.attribution.eox : undefined }] : []),
    ],
    [srcA, srcB, mix, imagery.data],
  );

  const markers: HtmlMarker[] = useMemo(() => {
    const lab = (s: string) => `<div style="font:600 11px system-ui;color:#fff;background:rgba(0,0,0,.55);padding:2px 6px;border-radius:6px;white-space:nowrap">${s}</div>`;
    const end = (deg: number, km: number): [number, number] => [SPOT.lon + (km / (111.32 * Math.cos((SPOT.lat * Math.PI) / 180))) * Math.sin((deg * Math.PI) / 180), SPOT.lat + (km / 110.57) * Math.cos((deg * Math.PI) / 180)];
    return [
      { id: 'spot', lngLat: [SPOT.lon, SPOT.lat], html: `<span style="display:block;width:12px;height:12px;border-radius:99px;background:${SERIES[mode][0]};border:2px solid #fff"></span>` },
      { id: 'n', lngLat: end(SPOT.beachNormal, 1.3), html: lab(`beach faces ${SPOT.beachNormal}° ESE`) },
      { id: 'o', lngLat: end(SPOT.offshoreFrom, 1.05), html: lab('offshore wind from WNW') },
    ];
  }, [mode]);

  const coast = coastal.data;
  const last30 = coast ? coast.daily.net.slice(-30).reduce<number>((acc, v) => acc + (v ?? 0), 0) : 0;
  const omegaNow = coast ? coast.daily.omega[coast.daily.omega.length - 1] : null;
  const stateNow = coast ? coast.daily.state[coast.daily.state.length - 1] : null;
  const stateName = coast?.method.states.find((s) => s.code === stateNow)?.name;

  const best = useMemo(() => {
    if (!hours || !inputs || !storms.data) return null;
    const days = dayStats(hours, inputs, cycloneDays(storms.data.storms));
    const top = [...days].sort((x, y) => y.best - x.best).slice(0, Math.round(days.length * 0.1));
    const hourIdx = new Map(hours.map((h, i) => [h.t, i]));
    const peaks = top.map((d) => (d.bestStart != null ? hourIdx.get(d.bestStart) : undefined)).filter((i): i is number => i != null);
    const dirs = peaks.map((i) => hours[i].swellDir).filter((x): x is number => x != null);
    const sectors: Record<string, number> = {};
    dirs.forEach((d) => (sectors[compass(d)] = (sectors[compass(d)] ?? 0) + 1));
    const topDir = Object.entries(sectors).sort((x, y) => y[1] - x[1]).slice(0, 3);
    const per = peaks.map((i) => hours[i].tdom ?? 0).sort((x, y) => x - y);
    const winds: Record<string, number> = {};
    peaks.forEach((i) => (winds[hours[i].windType] = (winds[hours[i].windType] ?? 0) + 1));
    const tideN = peaks.map((i) => inputs[i].tideNorm).filter((x): x is number => x != null);
    const tideBins = [0, 0, 0];
    tideN.forEach((x) => tideBins[x < 0.33 ? 0 : x < 0.67 ? 1 : 2]++);
    const months: number[] = new Array(12).fill(0);
    top.forEach((d) => months[d.month - 1]++);
    return {
      n: top.length,
      topDir,
      perMed: per[Math.floor(per.length / 2)] ?? 0,
      winds: Object.entries(winds).sort((x, y) => y[1] - x[1]),
      tideBins: tideBins.map((v) => (v / (tideN.length || 1)) * 100),
      months,
    };
  }, [hours, inputs, storms.data]);

  const stage = tides.data?.stage(nowS());

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[24px] font-semibold text-ink">Spot & sandbanks</h1>
        <p className="text-[13px] text-ink2">
          Serenity Beach, Kottakuppam ({SPOT.lat.toFixed(4)}°N, {SPOT.lon.toFixed(4)}°E). A sand beach between rock groynes on a coastline running {SPOT.coastAxis}° (NNE), so it faces {SPOT.beachNormal}° and takes swell from the north-east round to the south.
        </p>
      </div>

      <Card pad={false}>
        <div className="p-3 grid gap-2 md:grid-cols-[1fr_1fr_auto] items-center border-b border-[var(--border)]">
          <label className="text-[12.5px] text-ink2 flex items-center gap-2">
            Base
            <select value={a} onChange={(e) => setA(e.target.value)} className="flex-1 min-w-0">
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[12.5px] text-ink2 flex items-center gap-2">
            Compare
            <select value={b} onChange={(e) => setB(e.target.value)} className="flex-1 min-w-0">
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[12.5px] text-ink2 flex items-center gap-2">
            Fade
            <input type="range" min={0} max={1} step={0.02} value={mix} onChange={(e) => setMix(+e.target.value)} className="w-40" aria-label="Fade between images" />
          </label>
        </div>
        <MapView height={540} center={[SPOT.lon + 0.004, SPOT.lat]} zoom={15.3} basemap="satellite" geo={geo} rasters={rasters} markers={markers} />
        <div className="p-3 text-[12px] text-muted flex flex-wrap gap-x-4 gap-y-1">
          <span>
            <span style={{ color: '#eb6834' }}>■</span> groynes / breakwaters / seawalls (OpenStreetMap)
          </span>
          <span>
            <span style={{ color: SERIES[mode][0] }}>■</span> swell window & beach-facing direction
          </span>
          <span>▒ Sri Lanka shadow ({SPOT.shadow.min}–{SPOT.shadow.max}°)</span>
          <span>Drag the fade slider to watch the sand move between captures.</span>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="What the best days look like" subtitle={best ? `Top 10% of days since 2015 (${best.n} days) for your profile` : 'Loading history…'}>
          {best ? (
            <div className="grid grid-cols-2 gap-4">
              <Stat label="Swell from" value={best.topDir.map(([d]) => d).join(' / ')} sub={best.topDir.map(([d, n]) => `${d} ${Math.round((n / best.n) * 100)}%`).join(' · ')} />
              <Stat label="Period" value={`${best.perMed.toFixed(0)} s`} sub="median" />
              <Stat label="Wind" value={best.winds[0]?.[0] ?? '–'} sub={best.winds.slice(0, 3).map(([w, n]) => `${w} ${Math.round((n / best.n) * 100)}%`).join(' · ')} />
              <Stat label="Tide" value={['low', 'mid', 'high'][best.tideBins.indexOf(Math.max(...best.tideBins))]} sub={`low ${best.tideBins[0].toFixed(0)}% · mid ${best.tideBins[1].toFixed(0)}% · high ${best.tideBins[2].toFixed(0)}%`} />
              <div className="col-span-2 text-[12px] text-ink2">
                Busiest months: {best.months.map((n, i) => [n, MONTHS[i]] as [number, string]).sort((x, y) => y[0] - x[0]).slice(0, 4).map(([, m]) => m).join(', ')}
              </div>
            </div>
          ) : (
            <Loading />
          )}
        </Card>
        <Card title="Sand on the move (modelled)" subtitle="Longshore drift from 10 years of waves (CERC formula)">
          {coast ? (
            <>
              <div className="flex items-center gap-2 mb-2">
                <Pill tone="accent">{last30 >= 0 ? 'Moving north' : 'Moving south'}</Pill>
                <span className="text-[13px] text-ink">{Math.abs(Math.round(last30 / 30)).toLocaleString()} m³/day over the last 30 days</span>
              </div>
              <EChart height={180} option={(m) => driftMonthsOption(coast, m)} />
              <p className="text-[12px] text-ink2">
                Blue = northward drift (south-east swell, Mar–Oct), red = southward (north-east monsoon, Nov–Feb). Groynes trap sand on their updrift side, so the banks — and the peaks — shift with the season.
              </p>
            </>
          ) : (
            <Loading />
          )}
        </Card>
        <Card title="Beach state (modelled)" subtitle="Wright & Short Ω from recent waves">
          {coast ? (
            <>
              <div className="flex items-center gap-2">
                <Pill tone="accent">{stateNow}</Pill>
                <span className="text-[14px] font-semibold text-ink">{stateName}</span>
                <span className="text-[12px] text-muted">Ω {omegaNow?.toFixed(2)}</span>
              </div>
              <p className="text-[12.5px] text-ink2 mt-2">{stateNow ? STATE_TEXT[stateNow] : ''}</p>
              <EChart height={170} option={(m) => omegaOption(coast, m)} />
            </>
          ) : (
            <Loading />
          )}
        </Card>
      </div>

      <SectionTitle kicker="Tides">A small, semi-diurnal tide</SectionTitle>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Tide right now" subtitle="Harmonic prediction from 4 years of modelled sea level (hold-out error 7 cm)">
          {tides.data && stage ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Stat label="Now" value={`${stage.h >= 0 ? '+' : ''}${stage.h.toFixed(2)} m`} sub={tideWord(stage.norm, stage.rising)} />
              <Stat label="Spring range" value={`${tides.data.d.spring_range_m.toFixed(2)} m`} />
              <Stat label="Neap range" value={`${tides.data.d.neap_range_m.toFixed(2)} m`} />
              <Stat label="Mean range" value={`${tides.data.d.mean_range_m.toFixed(2)} m`} />
              <div className="col-span-2 sm:col-span-4">
                <EChart height={180} option={(m) => tideOption(tides.data!, m, nowS() - 6 * 3600, nowS() + 66 * 3600, { height: 'm', wind: 'kt' })} />
              </div>
            </div>
          ) : (
            <Loading />
          )}
        </Card>
        <ChartCard
          title="Tidal constituents"
          subtitle="The biggest harmonic components of the Pondicherry tide"
          chart={
            tides.data?.d.constituents ? (
              <DataTable
                rows={tides.data.d.constituents.slice(0, 10)}
                columns={[
                  { key: 'n', label: 'Constituent', render: (c) => c.name },
                  { key: 'a', label: 'Amplitude (cm)', align: 'right', render: (c) => (c.amp_m * 100).toFixed(1) },
                  { key: 'p', label: 'Phase (°)', align: 'right', render: (c) => c.phase_deg.toFixed(0) },
                  { key: 'f', label: 'Period (h)', align: 'right', render: (c) => (c.cph > 0 ? (1 / c.cph).toFixed(2) : '–') },
                ]}
              />
            ) : (
              <Loading />
            )
          }
        />
      </div>
      {loading && <div className="text-[12px] text-muted">Loading history for the best-days analysis…</div>}
    </div>
  );
}
