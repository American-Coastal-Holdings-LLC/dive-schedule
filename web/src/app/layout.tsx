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

// CACHE POSTURE — deliberate, and load-bearing for the embed. Do not remove without replacing.
//
// Next statically prerenders this shell by default (the build reports `/` as ○ Static), and a
// prerendered document ships `cache-control: s-maxage=31536000` — a YEAR of shared-cache lifetime.
// Combined with content-hashed chunks that are immutable-cached on purpose, any cache in the path
// can serve an old document plus its matching old chunks: a fully working OLD app, indefinitely
// after a deploy. Hard-refreshing the parent workspace page does NOT force an iframe's document to
// revalidate, so an embedded tenant has no self-service way out of it.
//
// force-dynamic drops the prerender and gets no-store semantics on the DOCUMENT only. Hashed assets
// under /_next/static keep their immutable caching, so this does not trade staleness for latency.
export const dynamic = 'force-dynamic';

// Rendered into the served HTML in a machine-readable place so verifying a deploy is one command:
//   curl -s https://<host>/ | grep -o 'data-build-sha="[^"]*"'
const BUILD_SHA = process.env.NEXT_PUBLIC_BUILD_SHA ?? 'unknown';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: BRAND.color,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} data-build-sha={BUILD_SHA}>
      <body>{children}</body>
    </html>
  );
}
