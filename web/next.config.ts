import type { NextConfig } from 'next';

// The app calls the backend same-origin at /api/* and /webhooks/*; Next rewrites proxy those
// to the NestJS API. This keeps the iframe app free of CORS and cross-site-cookie concerns —
// identity arrives as a per-request bearer token via the platform bridge, never a cookie.
const API_URL = process.env.API_URL ?? 'http://localhost:4310';

// Anti-clickjacking on the actual embedded surface (the Next-served HTML — the API sets its own CSP
// separately). Declares which origins may frame the app. Defaults to 'self', which allows the
// same-origin dev harness; set FRAME_ANCESTORS to the EOS workspace origin(s) plus the vendor's own
// domain (space-separated) for real deployments.
const FRAME_ANCESTORS = (process.env.FRAME_ANCESTORS ?? "'self'").trim();

// Build identity, inlined at build time so the served HTML can answer "which build is live?".
// deploy-vendor.sh passes --build-arg BUILD_SHA=<commit>; the Dockerfile promotes it to an ENV in
// the build stage. This matters more here than it looks: deploy-vendor.sh silently dry-runs and
// exits 0 without HOSTING_OPS_ALLOW_LIVE=1, so "the deploy printed success" is not evidence that
// anything changed. One curl against the served HTML is.
const BUILD_SHA = process.env.BUILD_SHA ?? process.env.NEXT_PUBLIC_BUILD_SHA ?? 'unknown';

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILD_SHA: BUILD_SHA },
  // Standalone output: a self-contained server.js plus a pruned node_modules, which is what the
  // Docker runtime stage copies. Without this the runtime image needs the whole dependency tree.
  output: 'standalone',
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API_URL}/api/:path*` },
      { source: '/webhooks/:path*', destination: `${API_URL}/webhooks/:path*` },
    ];
  },
  // NOTE: headers() only apply when the app is served by the Next Node runtime (`next start`). If this
  // frontend is ever served as a static export or straight from a CDN, replicate frame-ancestors at the
  // edge/reverse-proxy layer so the anti-clickjacking header survives the hosting change.
  async headers() {
    return [
      {
        // Every HTML/asset route except the proxied API/webhook rewrites (those carry the API's own
        // headers). The bare `/api` and `/webhooks` paths fall through and get this header too; that is
        // benign (JSON/404 responses, not framable, and multiple CSP headers intersect, not conflict).
        source: '/((?!api/|webhooks/).*)',
        headers: [{ key: 'Content-Security-Policy', value: `frame-ancestors ${FRAME_ANCESTORS}` }],
      },
    ];
  },
};

export default nextConfig;
