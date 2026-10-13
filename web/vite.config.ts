import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/serenity-surf/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Serenity Surf — Pondicherry',
        short_name: 'Serenity Surf',
        description: 'Surf forecast and cyclone swell tracker for Serenity Beach, Pondicherry',
        theme_color: '#0d0d0d',
        background_color: '#0d0d0d',
        display: 'standalone',
        start_url: '/serenity-surf/',
        scope: '/serenity-surf/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/data/') || url.pathname.includes('/api/'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'surf-data', expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
          {
            urlPattern: ({ url }) => /open-meteo\.com$/.test(url.hostname) || url.hostname.endsWith('metoc.navy.mil') || url.hostname.endsWith('gdacs.org'),
            handler: 'NetworkFirst',
            options: { cacheName: 'surf-live', networkTimeoutSeconds: 10, expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 2 } },
          },
          {
            urlPattern: ({ url }) => /basemaps\.cartocdn\.com|arcgisonline\.com|maps\.eox\.at|arcgis\.com/.test(url.hostname),
            handler: 'CacheFirst',
            options: { cacheName: 'surf-tiles', expiration: { maxEntries: 800, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
        ],
      },
    }),
  ],
  build: { chunkSizeWarningLimit: 2500, target: 'es2022' },
  server: { port: 5173 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
} as any);
