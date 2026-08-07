# Dive Schedule — production image.
#
# Built and run by EOS hosting-ops exactly like SprocketSuite's: platform-plugins/hosting-ops/
# deploy-vendor.sh does `docker build --build-arg BUILD_SHA=<sha> -t <img> .` at the repo root and
# brings it up under the shared vendor compose skeleton. That skeleton runs ONE `app` service and
# expects the backend on port 8080, with Postgres and Caddy as siblings.
#
# THE SHAPE PROBLEM THIS SOLVES: SprocketSuite is a single Next app, so its image is one process.
# This repo is two — a NestJS API and a Next frontend. Rather than ask hosting-ops for a bespoke
# compose (which would make this plugin operationally different from its sibling, the one thing we
# are trying to avoid), both run in this one image behind the frontend:
#
#   Caddy → :8080 Next (standalone server.js) ─┬─ app pages/assets
#                                              ├─ /api/*      ─┐ rewrite proxy
#                                              └─ /webhooks/* ─┘ → 127.0.0.1:4310 NestJS
#
# The rewrites already exist in web/next.config.ts for local dev, so production reuses the exact
# path the app is developed against instead of a second, untested routing story.
#
# No secrets are baked in anywhere: everything is env at runtime, from /opt/vendor/.env.

# ---- deps: install both workspaces' dependencies against their own lockfiles ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY api/package.json api/package-lock.json* ./api/
COPY web/package.json web/package-lock.json* ./web/
RUN cd api && npm ci
RUN cd web && npm ci

# ---- build: prisma generate + nest build + next build ----
FROM node:20-alpine AS build
WORKDIR /app

# Build-time public config. NEXT_PUBLIC_* is INLINED into the client bundle at build time, so it
# must be a build arg — setting it only at runtime silently ships the default.
ARG BUILD_SHA
ARG NEXT_PUBLIC_APP_ORIGIN
ARG NEXT_PUBLIC_EOS_HOST_ORIGIN
ARG FRAME_ANCESTORS
ENV BUILD_SHA=${BUILD_SHA}
ENV NEXT_PUBLIC_APP_ORIGIN=${NEXT_PUBLIC_APP_ORIGIN}
ENV NEXT_PUBLIC_EOS_HOST_ORIGIN=${NEXT_PUBLIC_EOS_HOST_ORIGIN}
ENV FRAME_ANCESTORS=${FRAME_ANCESTORS}

COPY --from=deps /app/api/node_modules ./api/node_modules
COPY --from=deps /app/web/node_modules ./web/node_modules
COPY . .

RUN cd api && npx prisma generate && npm run build
RUN cd web && npm run build

# ---- runtime: slim image carrying only what actually serves ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# The API: compiled dist + its production dependency tree + the Prisma schema/migrations, which
# `migrate deploy` needs at boot.
COPY --from=build /app/api/dist ./api/dist
COPY --from=build /app/api/node_modules ./api/node_modules
COPY --from=build /app/api/package.json ./api/package.json
COPY --from=build /app/api/prisma ./api/prisma

# The frontend: standalone output already contains a pruned node_modules and its own server.js.
#
# NOTE THE `/web` ON THE SOURCE PATHS. There is a package.json at the repo root, so Next treats this
# as a monorepo and nests the output one level down — server.js lands at
# `.next/standalone/web/server.js`, not `.next/standalone/server.js`, and the pruned node_modules
# goes with it. Copying `.next/standalone` wholesale would produce /app/web/web/server.js and a CMD
# that cannot find its entrypoint. Verified against an actual build; re-check if the root
# package.json ever moves.
COPY --from=build /app/web/.next/standalone/web ./web/

# Static assets are NOT included in standalone output — Next expects them served from
# `<app>/.next/static`, which here is inside the copied tree.
COPY --from=build /app/web/.next/static ./web/.next/static

# No `public/` copy: this app has no public directory, and COPY of a missing path fails the build.
# Add one here if a public/ is ever introduced.

# Port 8080 is the vendor compose skeleton's contract for the `app` service. Next serves it; the
# API stays on loopback and is never published — the only way in is through the frontend, which is
# also what keeps /api/* same-origin.
ENV PORT=8080
ENV HOSTNAME="0.0.0.0"
ENV API_PORT=4310
ENV API_URL=http://127.0.0.1:4310
EXPOSE 8080

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

CMD ["/usr/local/bin/docker-entrypoint.sh"]
