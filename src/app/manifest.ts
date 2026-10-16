import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'THE FEST — Festival Operating System',
    short_name: 'THE FEST',
    description: 'Tickets, gates, sponsors & schedules — one OS for every college fest in India.',
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#080808',
    theme_color: '#080808',
    lang: 'en-IN',
    categories: ['events', 'education', 'entertainment'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'My Tickets', url: '/tickets' },
      { name: 'Gate Scanner', url: '/scan' },
    ],
  };
}
