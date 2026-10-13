/** Live Open-Meteo requests for the spot (browser + Node). CORS-enabled, no key. */
import { SPOT } from '../core/spot';

export const WAVE_MODELS = [
  { id: 'meteofrance_wave', label: 'Météo-France MFWAM 8 km', short: 'MFWAM', parts: true },
  { id: 'ecmwf_wam', label: 'ECMWF WAM 9 km', short: 'ECMWF', parts: false },
  { id: 'ncep_gfswave016', label: 'NOAA GFS-Wave 16 km', short: 'GFS', parts: true },
  { id: 'ecmwf_wam025', label: 'ECMWF WAM 25 km', short: 'ECMWF-25', parts: false },
] as const;

export const WIND_MODELS = [
  { id: 'ecmwf_ifs', label: 'ECMWF IFS 9 km', short: 'ECMWF' },
  { id: 'ecmwf_aifs025_single', label: 'ECMWF AIFS (AI)', short: 'AIFS' },
  { id: 'gfs_seamless', label: 'NOAA GFS', short: 'GFS' },
  { id: 'icon_seamless', label: 'DWD ICON', short: 'ICON' },
  { id: 'ukmo_seamless', label: 'UK Met Office', short: 'UKMO' },
  { id: 'jma_seamless', label: 'JMA', short: 'JMA' },
  { id: 'meteofrance_seamless', label: 'Météo-France', short: 'MF' },
  { id: 'cma_grapes_global', label: 'CMA GRAPES', short: 'CMA' },
] as const;

export type WaveModelId = (typeof WAVE_MODELS)[number]['id'];
export type WindModelId = (typeof WIND_MODELS)[number]['id'];

const WAVE_VARS = [
  'wave_height', 'wave_direction', 'wave_period', 'wave_peak_period',
  'swell_wave_height', 'swell_wave_direction', 'swell_wave_period',
  'secondary_swell_wave_height', 'secondary_swell_wave_direction', 'secondary_swell_wave_period',
  'wind_wave_height', 'wind_wave_direction', 'wind_wave_period',
];
const OCEAN_VARS = ['sea_level_height_msl', 'sea_surface_temperature', 'ocean_current_velocity', 'ocean_current_direction'];
const WX_VARS = [
  'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'precipitation', 'precipitation_probability',
  'weather_code', 'cape', 'cloud_cover', 'temperature_2m', 'pressure_msl',
];

export interface OMHourly {
  time: number[];
  [k: string]: (number | null)[];
}
export interface OMResponse {
  latitude: number;
  longitude: number;
  hourly: OMHourly;
  daily?: Record<string, (number | null)[]>;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`Open-Meteo ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()) as T;
}

function qs(p: Record<string, string | number>): string {
  return Object.entries(p)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
}

export async function fetchMarine(signal?: AbortSignal, days = 16): Promise<OMResponse> {
  const url =
    'https://marine-api.open-meteo.com/v1/marine?' +
    qs({
      latitude: SPOT.wavePoint.lat,
      longitude: SPOT.wavePoint.lon,
      hourly: WAVE_VARS.join(','),
      models: WAVE_MODELS.map((m) => m.id).join(','),
      forecast_days: days,
      past_days: 2,
      cell_selection: 'sea',
      timeformat: 'unixtime',
      timezone: 'GMT',
    });
  return getJson(url, signal);
}

export async function fetchOcean(signal?: AbortSignal): Promise<OMResponse> {
  const url =
    'https://marine-api.open-meteo.com/v1/marine?' +
    qs({
      latitude: SPOT.wavePoint.lat,
      longitude: SPOT.wavePoint.lon,
      hourly: OCEAN_VARS.join(','),
      forecast_days: 10,
      past_days: 2,
      cell_selection: 'sea',
      timeformat: 'unixtime',
      timezone: 'GMT',
    });
  return getJson(url, signal);
}

export async function fetchWeather(signal?: AbortSignal, days = 16): Promise<OMResponse> {
  const url =
    'https://api.open-meteo.com/v1/forecast?' +
    qs({
      latitude: SPOT.windPoint.lat,
      longitude: SPOT.windPoint.lon,
      hourly: WX_VARS.join(','),
      daily: 'uv_index_max',
      models: ['best_match', ...WIND_MODELS.map((m) => m.id)].join(','),
      forecast_days: days,
      past_days: 2,
      cell_selection: 'sea',
      wind_speed_unit: 'kn',
      timeformat: 'unixtime',
      timezone: 'GMT',
    });
  return getJson(url, signal);
}

export interface LiveRaw {
  marine: OMResponse;
  ocean: OMResponse | null;
  weather: OMResponse;
  fetchedAt: number;
}

export async function fetchLive(signal?: AbortSignal): Promise<LiveRaw> {
  const [marine, ocean, weather] = await Promise.all([
    fetchMarine(signal),
    fetchOcean(signal).catch(() => null),
    fetchWeather(signal),
  ]);
  return { marine, ocean, weather, fetchedAt: Math.floor(Date.now() / 1000) };
}
