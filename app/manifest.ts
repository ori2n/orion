import type { MetadataRoute } from 'next';

/**
 * ORION web app manifest.
 *
 * `display: "standalone"` is what makes iOS "Add to Home Screen" launch
 * ORION as a full-screen app (no Safari URL bar) instead of a bookmark.
 * `scope` + `start_url` at "/" keep every section (fitness, actions,
 * freebuff…) inside the standalone window during client-side navigation.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ORION',
    short_name: 'ORION',
    description: 'Track your habits, fitness and build a second brain.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0a0a0a',
    theme_color: '#0a0a0a',
    categories: ['productivity', 'health', 'fitness'],
    icons: [
      {
        src: '/icon',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
