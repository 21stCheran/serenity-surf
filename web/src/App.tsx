import { lazy, Suspense, useState } from 'react';
import { Icon } from './components/Icon';
import { Loading } from './components/ui';
import { SPOT } from './core/spot';
import { PAGES, go, useRoute, type PageId } from './state/router';
import { useApplyTheme, useSettings } from './state/settings';

const Today = lazy(() => import('./pages/Today'));
const Forecast = lazy(() => import('./pages/Forecast'));
const Cyclones = lazy(() => import('./pages/Cyclones'));
const Seasons = lazy(() => import('./pages/Seasons'));
const Planner = lazy(() => import('./pages/Planner'));
const Spot = lazy(() => import('./pages/Spot'));
const DataLab = lazy(() => import('./pages/DataLab'));
const Log = lazy(() => import('./pages/Log'));

const VIEWS: Record<PageId, React.ComponentType<{ params: URLSearchParams }>> = {
  today: Today,
  forecast: Forecast,
  cyclones: Cyclones,
  seasons: Seasons,
  planner: Planner,
  spot: Spot,
  lab: DataLab,
  log: Log,
};

const MOBILE_MAIN: PageId[] = ['today', 'forecast', 'cyclones', 'seasons'];
const NAV_ICON: Record<PageId, string> = { today: 'wave', forecast: 'calendar', cyclones: 'cyclone', seasons: 'chart', planner: 'star', spot: 'pin', lab: 'table', log: 'board' };

function ThemeButton() {
  const theme = useSettings((s) => s.theme);
  const set = useSettings((s) => s.set);
  const next = theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system';
  return (
    <button className="icon-btn" title={`Theme: ${theme} (click for ${next})`} aria-label="Change theme" onClick={() => set({ theme: next })}>
      <Icon name={theme === 'light' ? 'sun' : theme === 'dark' ? 'water' : 'compass'} size={16} />
    </button>
  );
}

export default function App() {
  useApplyTheme();
  const { page, params } = useRoute();
  const [more, setMore] = useState(false);
  const View = VIEWS[page];
  return (
    <div className="min-h-screen pb-24 md:pb-10">
      <header className="sticky top-0 z-30 backdrop-blur-md bg-[color-mix(in_srgb,var(--page)_82%,transparent)] border-b border-[var(--border)]">
        <div className="max-w-[1320px] mx-auto px-4 h-14 flex items-center gap-4">
          <a href="#/today" className="flex items-center gap-2 no-underline shrink-0" aria-label="Serenity Surf home">
            <span className="w-8 h-8 rounded-xl grid place-items-center text-white" style={{ background: 'linear-gradient(135deg,#2a78d6,#104281)' }}>
              <Icon name="wave" size={18} strokeWidth={2} />
            </span>
            <span className="leading-tight">
              <span className="block text-[15px] font-semibold text-ink">Serenity Surf</span>
              <span className="block text-[11px] text-muted">{SPOT.region.replace(', India', '')}</span>
            </span>
          </a>
          <nav className="hidden md:flex items-center gap-1 overflow-x-auto" aria-label="Main">
            {PAGES.map((p) => (
              <a
                key={p.id}
                href={`#/${p.id}`}
                className={`px-3 py-1.5 rounded-lg text-[13.5px] no-underline whitespace-nowrap ${page === p.id ? 'bg-[var(--surface-2)] text-ink font-semibold' : 'text-ink2 hover:bg-[var(--hover)]'}`}
                aria-current={page === p.id ? 'page' : undefined}
              >
                {p.short}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeButton />
          </div>
        </div>
      </header>

      <main className="max-w-[1320px] mx-auto px-4 pt-4">
        <Suspense fallback={<Loading />}>
          <View params={params} />
        </Suspense>
      </main>

      <footer className="max-w-[1320px] mx-auto px-4 mt-12 text-[11.5px] text-muted leading-relaxed">
        <p>
          Forecasts and history: <a href="https://open-meteo.com/">Open-Meteo</a> (CC BY 4.0) with ECMWF, NOAA, Météo-France, DWD, UK Met Office, JMA and CMA models; ERA5 reanalysis (Copernicus).
          Cyclones: IBTrACS (NOAA NCEI), JTWC, GDACS, IMD, NOAA CPC. Satellite: EUMETSAT, Esri World Imagery & Wayback, EOX Sentinel-2 cloudless. Map data © OpenStreetMap contributors; basemaps © Esri.
          Airport winds: Iowa Environmental Mesonet. Surf heights are model estimates — always check the water yourself.
        </p>
      </footer>

      {/* mobile tab bar */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_92%,transparent)] backdrop-blur-md" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} aria-label="Main">
        <div className="grid grid-cols-5">
          {MOBILE_MAIN.map((id) => {
            const p = PAGES.find((x) => x.id === id)!;
            return (
              <a key={id} href={`#/${id}`} className={`flex flex-col items-center gap-0.5 py-2 text-[10.5px] no-underline ${page === id ? 'text-[var(--accent-ink)] font-semibold' : 'text-ink2'}`}>
                <Icon name={NAV_ICON[id]} size={20} />
                {p.short}
              </a>
            );
          })}
          <button className={`flex flex-col items-center gap-0.5 py-2 text-[10.5px] bg-transparent border-0 ${!MOBILE_MAIN.includes(page) ? 'text-[var(--accent-ink)] font-semibold' : 'text-ink2'}`} onClick={() => setMore(true)}>
            <Icon name="menu" size={20} />
            More
          </button>
        </div>
      </nav>
      {more && (
        <div className="md:hidden fixed inset-0 z-50 bg-black/40" onClick={() => setMore(false)}>
          <div className="absolute bottom-0 inset-x-0 card rounded-b-none p-3" style={{ paddingBottom: 'calc(12px + env(safe-area-inset-bottom))' }} onClick={(e) => e.stopPropagation()}>
            {PAGES.filter((p) => !MOBILE_MAIN.includes(p.id)).map((p) => (
              <button
                key={p.id}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left text-ink bg-transparent border-0 hover:bg-[var(--hover)]"
                onClick={() => {
                  setMore(false);
                  go(p.id);
                }}
              >
                <Icon name={NAV_ICON[p.id]} />
                <span className="text-[15px]">{p.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
