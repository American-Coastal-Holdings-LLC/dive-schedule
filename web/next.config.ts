import type { NextConfig } from 'next';

// The app calls the backend same-origin at /api/* and /webhooks/*; Next rewrites proxy those
// to the NestJS API. This keeps the iframe app free of CORS and cross-site-cookie concerns —
// identity arrives as a per-request bearer token via the platform bridge, never a cookie.
const API_URL = process.env.API_URL ?? 'http://localhost:4310';

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API_URL}/api/:path*` },
      { source: '/webhooks/:path*', destination: `${API_URL}/webhooks/:path*` },
    ];
  },
};

export default nextConfig;
