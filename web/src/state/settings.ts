/** User settings and session log (kept on this device only). */
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { profileById } from '../core/profiles';
import { DEFAULT_CAL } from '../core/surf';
import type { Calibration, Profile } from '../core/types';
import type { Mode } from '../viz/theme';

export interface LoggedSession {
  id: string;
  t: number; // start, epoch s
  hours: number;
  rating: number; // 1..5
  faceFt: number | null; // what it looked like
  board: string;
  notes: string;
}

export interface Settings {
  profileId: string;
  units: { height: 'ft' | 'm'; wind: 'kt' | 'kmh' };
  theme: 'system' | 'light' | 'dark';
  cal: Calibration;
  tidePref: number | null; // overrides the profile's preference when set
  log: LoggedSession[];
  set: (p: Partial<Omit<Settings, 'set' | 'addLog' | 'removeLog'>>) => void;
  addLog: (s: LoggedSession) => void;
  removeLog: (id: string) => void;
}

const safeStorage = createJSONStorage(() => {
  try {
    const k = '__surf_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    const mem = new Map<string, string>();
    return { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
  }
});

export const useSettings = create<Settings>()(
  persist(
    (set) => ({
      profileId: 'all-rounder',
      units: { height: 'ft', wind: 'kt' },
      theme: 'system',
      cal: DEFAULT_CAL,
      tidePref: null,
      log: [],
      set: (p) => set(p),
      addLog: (s) => set((st) => ({ log: [...st.log.filter((x) => x.id !== s.id), s].sort((a, b) => b.t - a.t) })),
      removeLog: (id) => set((st) => ({ log: st.log.filter((x) => x.id !== id) })),
    }),
    { name: 'serenity-surf-settings', storage: safeStorage, version: 1 },
  ),
);

export function useProfile(): Profile {
  const id = useSettings((s) => s.profileId);
  const tidePref = useSettings((s) => s.tidePref);
  const p = profileById(id);
  return tidePref == null ? p : { ...p, tidePref };
}

export function useCal(): Calibration {
  return useSettings((s) => s.cal);
}

function systemDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return true;
  }
}

/** Resolved colour mode; follows the OS when the theme is 'system'. */
export function useMode(): Mode {
  const theme = useSettings((s) => s.theme);
  const [sys, setSys] = useState(systemDark());
  useEffect(() => {
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      return;
    }
    const h = () => setSys(mq!.matches);
    mq.addEventListener('change', h);
    return () => mq!.removeEventListener('change', h);
  }, []);
  return theme === 'system' ? (sys ? 'dark' : 'light') : theme;
}

export function useApplyTheme() {
  const mode = useMode();
  const theme = useSettings((s) => s.theme);
  useEffect(() => {
    const el = document.documentElement;
    if (theme === 'system') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', theme);
    el.style.colorScheme = mode;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', mode === 'dark' ? '#0d0d0d' : '#f9f9f7');
  }, [mode, theme]);
}
