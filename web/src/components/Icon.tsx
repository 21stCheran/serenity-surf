const PATHS: Record<string, string> = {
  wave: 'M2 15c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M2 19c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M7 11c0-3.3 2.7-6 6-6 1.7 0 3 1 3 2.5S14.8 10 13.5 10c-1 0-1.5-.6-1.5-1.2',
  wind: 'M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7',
  tide: 'M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4',
  sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
  sunrise: 'M12 2v6M8.5 5.5 12 2l3.5 3.5M4 18h16M2 22h20M5.6 11.6l1.4 1.4M18.4 11.6 17 13M7 18a5 5 0 0 1 10 0',
  temp: 'M14 14.8V4a2 2 0 1 0-4 0v10.8a4 4 0 1 0 4 0z',
  rain: 'M20 16.6A5 5 0 0 0 18 7h-1.3A8 8 0 1 0 4 15.3M8 19v2M8 13v2M16 19v2M16 13v2M12 21v2M12 15v2',
  bolt: 'M13 2 3 14h9l-1 8 10-12h-9l1-8z',
  alert: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  cyclone: 'M12 12m-2 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0M12 4c-4.4 0-8 3.6-8 8M20 12c0 4.4-3.6 8-8 8M5 5c3-1 7 0 9 2M19 19c-3 1-7 0-9-2',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  pin: 'M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  refresh: 'M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  table: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18',
  chart: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  drop: 'M12 2.7 6.3 8.3a8 8 0 1 0 11.4 0z',
  water: 'M2 12c2 0 2-1.5 4-1.5S8 12 10 12s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5M2 17c2 0 2-1.5 4-1.5S8 17 10 17s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5',
  menu: 'M3 6h18M3 12h18M3 18h18',
  close: 'M18 6 6 18M6 6l12 12',
  check: 'M20 6 9 17l-5-5',
  star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z',
  play: 'M6 4l14 8-14 8z',
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  layers: 'M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  board: 'M12 2c3 4 4 9 4 13 0 4-2 7-4 7s-4-3-4-7c0-4 1-9 4-13zM12 6v14',
  compass: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM16.2 7.8l-2.1 6.4-6.3 2 2.1-6.3z',
  sand: 'M3 20h18M5 16c2-3 4-3 6 0s4 3 6 0 3-2 4-1M8 11c1.5-2 3-2 4.5 0',
  plus: 'M12 5v14M5 12h14',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15',
  satellite: 'M13 7 9 3 5 7l4 4M17 11l4 4-4 4-4-4M8 12l4 4M16 8l-3 3M15 21a6 6 0 0 0 6-6M15 17a2 2 0 0 0 2-2',
};

export function Icon({ name, size = 18, className = '', strokeWidth = 1.8 }: { name: keyof typeof PATHS | string; size?: number; className?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={PATHS[name] ?? PATHS.info} />
    </svg>
  );
}
