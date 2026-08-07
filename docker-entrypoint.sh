#!/bin/sh
# Container entrypoint: apply migrations, then run the API and the frontend as one unit.
#
# THE RULE THIS ENFORCES: if EITHER process dies, the container exits.
#
# That is the entire reason this is a script and not `nest & next`. With a naive background-and-wait,
# a crashed API leaves the frontend serving happily on :8080 — Caddy's health check passes, compose
# sees a running container, and the app returns 502 on every /api/* call with nothing restarting it.
# A container that is half-dead but reports healthy is worse than one that is cleanly dead, because
# `restart: unless-stopped` can fix the second and cannot see the first.
set -eu

echo "[entrypoint] applying database migrations"
cd /app/api
node node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma

# Track children so a signal or a death takes the whole container with it.
API_PID=""
WEB_PID=""

shutdown() {
  # shellcheck disable=SC2086
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null || true
  [ -n "$WEB_PID" ] && kill "$WEB_PID" 2>/dev/null || true
}
trap 'shutdown; exit 0' TERM INT

echo "[entrypoint] starting API on 127.0.0.1:${API_PORT:-4310} (loopback only — never published)"
cd /app/api
PORT="${API_PORT:-4310}" node dist/main.js &
API_PID=$!

echo "[entrypoint] starting frontend on 0.0.0.0:${PORT:-8080}"
cd /app/web
node server.js &
WEB_PID=$!

# Supervise by polling, NOT with `wait -n`: this image is node:20-alpine, whose /bin/sh is busybox
# ash, and `wait -n` is a bash builtin. Under ash it either errors or blocks until ALL children
# exit — which is exactly the half-dead-container case above, reintroduced by the supervisor meant
# to prevent it. `kill -0` is POSIX and cheap.
while true; do
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "[entrypoint] API exited — shutting the container down"
    break
  fi
  if ! kill -0 "$WEB_PID" 2>/dev/null; then
    echo "[entrypoint] frontend exited — shutting the container down"
    break
  fi
  sleep 2
done

shutdown
wait 2>/dev/null || true
# Always non-zero: we only reach here because something died, and compose's restart policy needs a
# failure to act on.
exit 1
