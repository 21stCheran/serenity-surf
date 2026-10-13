import maplibregl, { type LayerSpecification, type Map as MLMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { useMode } from '../state/settings';

export type Basemap = 'auto' | 'dark' | 'light' | 'satellite' | 'ocean';

export interface GeoOverlay {
  id: string;
  data: GeoJSON.FeatureCollection;
  layers: Omit<LayerSpecification, 'source'>[];
}
export interface RasterOverlay {
  id: string;
  tiles: string[];
  opacity?: number;
  attribution?: string;
  tileSize?: number;
  maxzoom?: number;
}
export interface ImageOverlay {
  id: string;
  url: string;
  coordinates: [[number, number], [number, number], [number, number], [number, number]];
  opacity?: number;
}
export interface HtmlMarker {
  id: string;
  lngLat: [number, number];
  html: string;
  anchor?: maplibregl.PositionAnchor;
  onClick?: () => void;
}

const ESRI = 'https://services.arcgisonline.com/arcgis/rest/services';
const BASE: Record<Exclude<Basemap, 'auto'>, { tiles: string[]; ref?: string[]; attribution: string; maxzoom?: number }> = {
  dark: {
    tiles: [`${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`],
    ref: [`${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`],
    attribution: 'Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS user community',
    maxzoom: 16,
  },
  light: {
    tiles: [`${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`],
    ref: [`${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`],
    attribution: 'Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS user community',
    maxzoom: 16,
  },
  ocean: {
    tiles: [`${ESRI}/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}`],
    ref: [`${ESRI}/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}`],
    attribution: 'Esri, GEBCO, NOAA, National Geographic, Garmin, HERE, and other contributors',
    maxzoom: 13,
  },
  satellite: {
    tiles: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`],
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    maxzoom: 19,
  },
};

export function eumetsatTiles(layer = 'msg_iodc:ir108', time?: string): string[] {
  const t = time ? `&time=${encodeURIComponent(time)}` : '';
  return [
    `https://view.eumetsat.int/geoserver/ows?service=WMS&request=GetMap&version=1.3.0&layers=${layer}&styles=&format=image/png&transparent=true&crs=EPSG:3857&width=256&height=256&bbox={bbox-epsg-3857}${t}`,
  ];
}

export function MapView({
  height = 480,
  center,
  zoom,
  basemap = 'auto',
  geo = [],
  rasters = [],
  images = [],
  markers = [],
  fitBounds,
  onReady,
  interactive = true,
}: {
  height?: number | string;
  center: [number, number];
  zoom: number;
  basemap?: Basemap;
  geo?: GeoOverlay[];
  rasters?: RasterOverlay[];
  images?: ImageOverlay[];
  markers?: HtmlMarker[];
  fitBounds?: [[number, number], [number, number]] | null;
  onReady?: (m: MLMap) => void;
  interactive?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const loaded = useRef(false);
  const markerObjs = useRef(new Map<string, maplibregl.Marker>());
  const mode = useMode();
  const bm = basemap === 'auto' ? mode : basemap;
  const pending = useRef<() => void>(() => {});

  // create once
  useEffect(() => {
    if (!ref.current) return;
    const b = BASE[bm];
    const m = new maplibregl.Map({
      container: ref.current,
      style: {
        version: 8,
        sources: {
          base: { type: 'raster', tiles: b.tiles, tileSize: 256, attribution: b.attribution, maxzoom: b.maxzoom ?? 19 },
          ...(b.ref ? { baseref: { type: 'raster' as const, tiles: b.ref, tileSize: 256, maxzoom: b.maxzoom ?? 19 } } : {}),
        },
        layers: [{ id: 'base', type: 'raster', source: 'base' }, ...(b.ref ? [{ id: 'baseref', type: 'raster' as const, source: 'baseref' }] : [])],
      },
      center,
      zoom,
      attributionControl: { compact: true },
      interactive,
      maxZoom: 19,
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('load', () => {
      loaded.current = true;
      pending.current();
      onReady?.(m);
    });
    map.current = m;
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      markerObjs.current.forEach((mk) => mk.remove());
      markerObjs.current.clear();
      m.remove();
      map.current = null;
      loaded.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // sync everything that can change
  useEffect(() => {
    const apply = () => {
      const m = map.current;
      if (!m || !loaded.current) return;
      // basemap
      const b = BASE[bm];
      const src = m.getSource('base') as maplibregl.RasterTileSource | undefined;
      if (src && (src as any).tiles?.[0] !== b.tiles[0]) {
        for (const id of ['baseref', 'base']) {
          if (m.getLayer(id)) m.removeLayer(id);
          if (m.getSource(id)) m.removeSource(id);
        }
        const first = m.getStyle().layers?.[0]?.id;
        m.addSource('base', { type: 'raster', tiles: b.tiles, tileSize: 256, attribution: b.attribution, maxzoom: b.maxzoom ?? 19 });
        m.addLayer({ id: 'base', type: 'raster', source: 'base' }, first);
        if (b.ref) {
          m.addSource('baseref', { type: 'raster', tiles: b.ref, tileSize: 256, maxzoom: b.maxzoom ?? 19 });
          m.addLayer({ id: 'baseref', type: 'raster', source: 'baseref' }, first);
        }
      }
      const wanted = new Set<string>(['base', 'baseref']);
      // raster overlays
      for (const r of rasters) {
        const id = `r-${r.id}`;
        wanted.add(id);
        const s = m.getSource(id) as any;
        if (s && s.tiles?.[0] !== r.tiles[0]) {
          m.removeLayer(id);
          m.removeSource(id);
        }
        if (!m.getSource(id)) {
          m.addSource(id, { type: 'raster', tiles: r.tiles, tileSize: r.tileSize ?? 256, attribution: r.attribution, maxzoom: r.maxzoom ?? 22 });
          m.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': r.opacity ?? 0.7 } });
        } else m.setPaintProperty(id, 'raster-opacity', r.opacity ?? 0.7);
      }
      // image overlays
      for (const im of images) {
        const id = `i-${im.id}`;
        wanted.add(id);
        const s = m.getSource(id) as maplibregl.ImageSource | undefined;
        if (s) s.updateImage({ url: im.url, coordinates: im.coordinates });
        else {
          m.addSource(id, { type: 'image', url: im.url, coordinates: im.coordinates });
          m.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': im.opacity ?? 0.8, 'raster-fade-duration': 0, 'raster-resampling': 'linear' } });
        }
      }
      // geojson overlays
      for (const g of geo) {
        const id = `g-${g.id}`;
        wanted.add(id);
        const s = m.getSource(id) as maplibregl.GeoJSONSource | undefined;
        if (s) s.setData(g.data);
        else m.addSource(id, { type: 'geojson', data: g.data });
        g.layers.forEach((l, i) => {
          const lid = `${id}-${l.id ?? i}`;
          wanted.add(lid);
          if (!m.getLayer(lid)) m.addLayer({ ...(l as any), id: lid, source: id });
        });
      }
      // remove stale
      for (const l of [...(m.getStyle().layers ?? [])]) {
        if (!wanted.has(l.id)) m.removeLayer(l.id);
      }
      for (const sid of Object.keys(m.getStyle().sources ?? {})) {
        if (!wanted.has(sid)) m.removeSource(sid);
      }
      // order: base < raster/image overlays < basemap labels < vector overlays
      const firstVec = (m.getStyle().layers ?? []).find((l) => l.id.startsWith('g-'))?.id;
      for (const r of [...rasters.map((x) => `r-${x.id}`), ...images.map((x) => `i-${x.id}`), 'baseref']) {
        if (!m.getLayer(r)) continue;
        if (firstVec) m.moveLayer(r, firstVec);
        else m.moveLayer(r);
      }
      // markers
      const keep = new Set<string>();
      for (const mk of markers) {
        keep.add(mk.id);
        let o = markerObjs.current.get(mk.id);
        if (!o) {
          const el = document.createElement('div');
          el.innerHTML = mk.html;
          if (mk.onClick) {
            el.style.cursor = 'pointer';
            el.addEventListener('click', (e) => {
              e.stopPropagation();
              mk.onClick?.();
            });
          }
          o = new maplibregl.Marker({ element: el, anchor: mk.anchor ?? 'center' }).setLngLat(mk.lngLat).addTo(m);
          markerObjs.current.set(mk.id, o);
        } else {
          o.setLngLat(mk.lngLat);
          const el = o.getElement();
          if (el.innerHTML !== mk.html) el.innerHTML = mk.html;
        }
      }
      for (const [id, o] of markerObjs.current) {
        if (!keep.has(id)) {
          o.remove();
          markerObjs.current.delete(id);
        }
      }
    };
    pending.current = apply;
    apply();
  }, [bm, geo, rasters, images, markers]);

  useEffect(() => {
    if (fitBounds && map.current) map.current.fitBounds(fitBounds, { padding: 40, duration: 900, maxZoom: 7 });
  }, [fitBounds]);

  return <div ref={ref} style={{ width: '100%', height, borderRadius: 14, overflow: 'hidden' }} />;
}

/** Circle polygon (km radius) for GeoJSON. */
export function circle(lon: number, lat: number, km: number, n = 72): GeoJSON.Polygon {
  const coords: [number, number][] = [];
  const R = 6371;
  const d = km / R;
  const la = (lat * Math.PI) / 180;
  const lo = (lon * Math.PI) / 180;
  for (let i = 0; i <= n; i++) {
    const b = (i / n) * 2 * Math.PI;
    const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
    const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
    coords.push([(lo2 * 180) / Math.PI, (la2 * 180) / Math.PI]);
  }
  return { type: 'Polygon', coordinates: [coords] };
}

/** A wedge (sector) polygon from a centre, bearings from..to (deg), radius km. */
export function wedge(lon: number, lat: number, from: number, to: number, km: number, steps = 40): GeoJSON.Polygon {
  const pts: [number, number][] = [[lon, lat]];
  const R = 6371;
  const d = km / R;
  const la = (lat * Math.PI) / 180;
  const lo = (lon * Math.PI) / 180;
  for (let i = 0; i <= steps; i++) {
    const b = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
    const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
    const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
    pts.push([(lo2 * 180) / Math.PI, (la2 * 180) / Math.PI]);
  }
  pts.push([lon, lat]);
  return { type: 'Polygon', coordinates: [pts] };
}

export const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });
