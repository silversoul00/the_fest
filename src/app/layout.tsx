import type { Metadata, Viewport } from 'next';
import '@fontsource/bebas-neue/400.css';
import '@fontsource/space-mono/400.css';
import '@fontsource/space-mono/700.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import './globals.css';
import { SwRegister } from '@/components/SwRegister';

const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://thefest.in';

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: { default: 'THE FEST — Festival Operating System', template: '%s · THE FEST' },
  description:
    'Tickets, gates, sponsors & schedules — one operating system for every college fest in India. Signed QR tickets, live sponsor analytics, volunteer check-in.',
  applicationName: 'THE FEST',
  appleWebApp: { capable: true, title: 'THE FEST', statusBarStyle: 'black-translucent' },
  icons: { icon: '/icons/favicon-48.png', apple: '/icons/apple-touch-icon.png' },
  openGraph: {
    type: 'website',
    siteName: 'THE FEST',
    title: 'THE FEST — Festival Operating System',
    description: 'Tickets, gates, sponsors & schedules — one OS for every college fest in India.',
    images: [{ url: '/og-image.png', width: 1200, height: 630 }],
    locale: 'en_IN',
  },
  twitter: { card: 'summary_large_image', images: ['/og-image.png'] },
};

export const viewport: Viewport = {
  themeColor: '#080808',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        {children}
        <SwRegister />
      </body>
    </html>
  );
}
