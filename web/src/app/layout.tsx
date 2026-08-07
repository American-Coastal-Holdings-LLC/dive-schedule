import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { BRAND } from '@/lib/brand';
import './globals.css';

// TYPEFACE — the only network asset this app ships, so it is budgeted deliberately.
//
// 47 KB, one request, one preload, latin subset, weight axis 400-700 in a single variable file.
// The system stack it replaces cost nothing and rendered well (SF Pro on an iPad in a marina,
// Segoe UI on a shop PC) — what it could not do is hold still. x-height, cap-height and optical
// weight all changed per machine, so a type scale and a --lt-tight tuned on one were wrong on the
// others. This app is read on a phone in daylight on a dock; the numerals in Pay, POS and the
// ledger have to be trustworthy, and Inter's tabular figures are the reason they line up.
//
// next/font/local, NOT next/font/google: the Google loader fetches at build time, so a
// network-restricted or offline build would break. Local is deterministic and puts the byte cost
// in the repo where it can be seen.
const inter = localFont({
  src: './fonts/Inter-Variable.latin.woff2',
  weight: '400 700',
  style: 'normal',
  display: 'swap',
  preload: true,
  variable: '--font-sans',
  fallback: [
    '-apple-system',
    'BlinkMacSystemFont',
    'SF Pro Text',
    'Segoe UI Variable Text',
    'Segoe UI',
    'system-ui',
    'Roboto',
    'Helvetica Neue',
    'Arial',
    'sans-serif',
  ],
});

// Name and description come from lib/brand.ts so the pending rename is one edit. See that file
// for why the tenant's own name must never be rendered from here.
export const metadata: Metadata = {
  title: BRAND.name,
  description: BRAND.description,
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: BRAND.color,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
