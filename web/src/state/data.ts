/** Data hooks: static products + live feeds, scored with the current profile. */
import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { buildForecast, modelSpread, scoreForecast, type Forecast, type Spread } from '../core/forecast';
import { assessStorms, cycloneContext, type StormAssessment } from '../core/live';
import { scoreMany } from '../core/score';
import type { HourInput, HourScore } from '../core/types';
import { istDayStart } from '../core/units';
import { dailySummaries, type DaySummary } from '../core/windows';
import { fetchGdacs, fetchImd } from '../data/alerts';
import { fetchJtwc } from '../data/jtwc';
import { fetchLive } from '../data/openmeteo';
import * as S from '../data/static';
import { useCal, useProfile } from './settings';

const MIN = 60_000;

export const useMeta = () => useQuery({ queryKey: ['meta'], queryFn: S.loadMeta, staleTime: 60 * MIN });
export const useTides = () => useQuery({ queryKey: ['tides'], queryFn: S.loadTides, staleTime: Infinity });
export const useCycloneModel = () => useQuery({ queryKey: ['cyclone-model'], queryFn: S.loadCycloneModel, staleTime: Infinity });
export const useStorms = () => useQuery({ queryKey: ['storms'], queryFn: S.loadStorms, staleTime: Infinity });
export const useStormSeries = () => useQuery({ queryKey: ['storm-series'], queryFn: S.loadStormSeries, staleTime: Infinity });
export const useClimatology = () => useQuery({ queryKey: ['climatology'], queryFn: S.loadClimatology, staleTime: Infinity });
export const useCoastal = () => useQuery({ queryKey: ['coastal'], queryFn: S.loadCoastal, staleTime: Infinity });
export const useIndices = () => useQuery({ queryKey: ['indices'], queryFn: S.loadIndices, staleTime: Infinity });
export const useGenesis = () => useQuery({ queryKey: ['genesis'], queryFn: S.loadGenesis, staleTime: 30 * MIN });
export const useField = () => useQuery({ queryKey: ['field'], queryFn: S.loadField, staleTime: 30 * MIN });
export const useCpc = () => useQuery({ queryKey: ['cpc'], queryFn: S.loadCpc, staleTime: 60 * MIN });
export const useImagery = () => useQuery({ queryKey: ['imagery'], queryFn: S.loadImagery, staleTime: Infinity });
export const useOsm = () => useQuery({ queryKey: ['osm'], queryFn: S.loadOsm, staleTime: Infinity });
export const useMetar = () => useQuery({ queryKey: ['metar'], queryFn: S.loadMetar, staleTime: Infinity });
export const useReplayIndex = () => useQuery({ queryKey: ['replays'], queryFn: S.loadReplayIndex, staleTime: Infinity });

export const useLiveRaw = () =>
  useQuery({ queryKey: ['live'], queryFn: ({ signal }) => fetchLive(signal), staleTime: 20 * MIN, refetchInterval: 30 * MIN, retry: 2 });
export const useJtwc = () =>
  useQuery({ queryKey: ['jtwc'], queryFn: ({ signal }) => fetchJtwc(signal), staleTime: 10 * MIN, refetchInterval: 20 * MIN, retry: 1 });
export const useGdacs = () => useQuery({ queryKey: ['gdacs'], queryFn: ({ signal }) => fetchGdacs(signal), staleTime: 20 * MIN, retry: 1 });
export const useImd = () => useQuery({ queryKey: ['imd'], queryFn: ({ signal }) => fetchImd(signal), staleTime: 20 * MIN, retry: 1 });

export function useForecast(): { forecast: Forecast | null; loading: boolean; error: unknown; fetchedAt: number | null; refetch: () => void } {
  const meta = useMeta();
  const tides = useTides();
  const live = useLiveRaw();
  const forecast = useMemo(() => {
    if (!live.data) return null;
    return buildForecast(live.data, meta.data?.forecastCalibration ?? {}, tides.data ?? null);
  }, [live.data, meta.data, tides.data]);
  return { forecast, loading: live.isLoading, error: live.error, fetchedAt: live.data?.fetchedAt ?? null, refetch: () => void live.refetch() };
}

export function useStormAssessments(baseHs: number | null): StormAssessment[] {
  const jtwc = useJtwc();
  const model = useCycloneModel();
  return useMemo(() => {
    if (!jtwc.data || !model.data) return [];
    return assessStorms(jtwc.data.storms, model.data, baseHs ?? 0.8);
  }, [jtwc.data, model.data, baseHs]);
}

export interface Scored {
  forecast: Forecast | null;
  hours: HourScore[];
  days: DaySummary[];
  spread: Spread[];
  storms: StormAssessment[];
  loading: boolean;
  error: unknown;
  fetchedAt: number | null;
  refetch: () => void;
}

export function useScoredForecast(): Scored {
  const { forecast, loading, error, fetchedAt, refetch } = useForecast();
  const profile = useProfile();
  const cal = useCal();
  const now = Math.floor(Date.now() / 1000);
  const base = forecast?.hours.find((h) => h.t >= now - 1800 && h.hs != null)?.hs ?? null;
  const storms = useStormAssessments(base);
  const scored = useMemo(() => {
    if (!forecast) return { hours: [], days: [], spread: [] };
    // keep the past 2 days out of the forecast views (they are only fetched for the 48 h rain total)
    const today0 = istDayStart(Math.floor(Date.now() / 1000));
    const hours = scoreForecast(forecast, profile, cal, cycloneContext(storms)).filter((h) => h.t >= today0);
    return { hours, days: dailySummaries(hours), spread: modelSpread(forecast, profile, cal).filter((s) => s.t >= today0) };
  }, [forecast, profile, cal, storms]);
  return { forecast, ...scored, storms, loading, error, fetchedAt, refetch };
}

/** All history years (2015 ->), decoded. Heavy: only used by history-based pages. */
export function useHistoryInputs(): { inputs: HourInput[] | null; loading: boolean; progress: number } {
  const meta = useMeta();
  const tides = useTides();
  const years = meta.data?.history.files.map((f) => f.year) ?? [];
  const qs = useQueries({ queries: years.map((y) => ({ queryKey: ['hist', y], queryFn: () => S.loadHistoryYear(y), staleTime: Infinity })) });
  const done = qs.filter((q) => q.data).length;
  const all = years.length > 0 && done === years.length;
  const inputs = useMemo(() => {
    if (!all) return null;
    return S.decodeHistory(qs.map((q) => q.data!), tides.data ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, tides.data]);
  return { inputs, loading: !all, progress: years.length ? done / years.length : 0 };
}

export function useScoredHistory(): { hours: HourScore[] | null; inputs: HourInput[] | null; loading: boolean; progress: number } {
  const { inputs, loading, progress } = useHistoryInputs();
  const profile = useProfile();
  const cal = useCal();
  const hours = useMemo(() => (inputs ? scoreMany(inputs, profile, cal) : null), [inputs, profile, cal]);
  return { hours, inputs, loading, progress };
}
