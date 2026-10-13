import { useEffect, useState } from 'react';

export const PAGES = [
  { id: 'today', label: 'Today', short: 'Today' },
  { id: 'forecast', label: '16-day forecast', short: 'Forecast' },
  { id: 'cyclones', label: 'Cyclone swell', short: 'Cyclones' },
  { id: 'seasons', label: 'Seasons & history', short: 'Seasons' },
  { id: 'planner', label: 'Planner', short: 'Planner' },
  { id: 'spot', label: 'Spot & sandbanks', short: 'Spot' },
  { id: 'lab', label: 'Data lab', short: 'Lab' },
  { id: 'log', label: 'Log & settings', short: 'Settings' },
] as const;

export type PageId = (typeof PAGES)[number]['id'];

function parse(): { page: PageId; params: URLSearchParams } {
  const h = window.location.hash.replace(/^#\/?/, '');
  const [path, q] = h.split('?');
  const page = (PAGES.find((p) => p.id === path)?.id ?? 'today') as PageId;
  return { page, params: new URLSearchParams(q ?? '') };
}

export function useRoute() {
  const [r, setR] = useState(parse);
  useEffect(() => {
    const h = () => {
      setR(parse());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  return r;
}

export function go(page: PageId, params?: Record<string, string>) {
  const q = params ? '?' + new URLSearchParams(params).toString() : '';
  window.location.hash = `#/${page}${q}`;
}
