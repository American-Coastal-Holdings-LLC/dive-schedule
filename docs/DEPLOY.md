# Deploying to EOS

This plugin is vendor-hosted on its own AWS Lightsail box and operated by EOS hosting-ops, exactly
like SprocketSuite. Deploys are **manual and operator-run** — there is no CI, and no autodeploy.

| | |
|---|---|
| Hosting slug | `diveschedule` |
| Box | `eos-vendor-diveschedule`, static IP `3.219.250.121` (`small_3_0`) |
| Origin | `https://diveschedule.3.219.250.121.sslip.io` |
| Repo | `AmericanCoastalHoldingsLLC/dive-schedule`, branch `main` |
| Operator tooling | `EOS/platform-plugins/hosting-ops/` |
| Workspace (where the embed renders) | `https://workspace.54.235.203.98.sslip.io` |

## Read this first — four ways a deploy lies to you

1. **`deploy-vendor.sh` silently dry-runs and exits 0 without `HOSTING_OPS_ALLOW_LIVE=1`.** It
   prints success having changed nothing. Always verify the build SHA afterwards (below).
2. **Autodeploy is not installed and never has been.** Moving a `release` ref deploys nothing. The
   box changes only when someone runs `deploy-vendor.sh` by hand.
3. **The build happens on the VM from the GitHub ref, not from your working copy.** Unpushed commits
   do not deploy. If `Dockerfile` is missing from the ref, the script silently falls through to
   nixpacks and builds something that will not work.
4. **`NEXT_PUBLIC_*` is inlined at BUILD time.** Setting it with `set-runtime-env.sh` does nothing;
   it must be a build arg, and it only takes effect on the next deploy.

## One-time setup

Already done: box provisioned, firewall (`80,443` world; `22` operator-only; `5432` closed),
NetworkOut alarm + kill-switch watch armed, repo connected.

Still required before the first successful deploy:

- [ ] Deploy key added to **`dive-schedule`** as read-only (`.../settings/keys`)
- [ ] `manifest.submit.json` submitted through SOP Stages 1–3 → yields `client_id`, `client_secret`,
      webhook `kid` + secret. **The app hard-fails at boot without real credentials.**
- [ ] APP PROVISION CLEARED addendum recorded in `_LANE-LOG.md` for this plugin
- [ ] `INTERNAL_SERVICE_TOKEN` + `WORKSPACE_API_URL` in `hosting-ops.conf`, or the partner portal's
      Hosting page stays empty (the push skips silently)
- [ ] `reg_set diveschedule vendor_id 01KYB0GQ5WAX6710VY4QXY3PFH`

## Configure the box

Build args — take effect at the **next** deploy:

```bash
./set-build-args.sh diveschedule "--build-arg NEXT_PUBLIC_APP_ORIGIN=https://diveschedule.3.219.250.121.sslip.io --build-arg FRAME_ANCESTORS=https://workspace.54.235.203.98.sslip.io"
```

Runtime env — takes effect immediately (the container is recreated):

| Key | Value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | selects the real identity/webhook/platform implementations |
| `DATABASE_URL` | `postgresql://vendor:<pw>@postgres:5432/vendor` | the compose sibling; `<pw>` is the literal from `/opt/vendor/.env` (`env_file` does no interpolation) |
| `EOS_API_BASE` | `https://workspace-api.54.235.203.98.sslip.io` | everything else derives from it |
| `CSP_FRAME_ANCESTORS` | `https://workspace.54.235.203.98.sslip.io` | **the workspace origin, not ours** — who may frame us |
| `EOS_VENDOR_SLUG` | `ach` | ACH's assigned slug; shared with SprocketSuite, never re-minted |
| `EOS_PLUGIN_SLUG` | `dive` | must equal `INTERNAL_PERMISSION_PREFIX`, or every permission check fails silently |
| `EOS_CLIENT_ID` / `EOS_CLIENT_SECRET` | from Stage 3 | boot fails on the dev placeholders |
| `EOS_WEBHOOK_SECRETS` | `{"<kid>":"<secret>"}` | a MAP — two entries during a rotation overlap |

Never set `USE_DEV_IDENTITY_STUB`, `USE_DEV_WEBHOOK_STUB` or `USE_DEV_PLATFORM_STUBS` on the box.
They are opt-in to insecure stubs, and the stubs additionally refuse to boot in production.

## Deploy

```bash
cd EOS/platform-plugins/hosting-ops
HOSTING_OPS_ALLOW_LIVE=1 ./deploy-vendor.sh diveschedule main
```

Fetch @ ref → `docker build --build-arg BUILD_SHA=<sha>` → tag by SHA → `compose up -d`. The prior
image is retained, which is what makes rollback cheap.

## Verify — do not skip

```bash
curl -s https://diveschedule.3.219.250.121.sslip.io/ | grep -o 'data-build-sha="[^"]*"'
```

That must match the commit you deployed. It is the only reliable evidence the deploy landed, given
trap #1. Then check the API and the embed:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://diveschedule.3.219.250.121.sslip.io/api/healthz
```

Finally, log in at the workspace and open the plugin. A blank iframe almost always means
`CSP_FRAME_ANCESTORS` is wrong or missing — check the browser console for a frame-ancestors refusal
before suspecting the app.

## Roll back

The previous image is retained, so rollback is a redeploy of the prior SHA:

```bash
HOSTING_OPS_ALLOW_LIVE=1 ./deploy-vendor.sh diveschedule <previousSHA>
```

`/opt/vendor/deploy-history.log` on the box lists what was deployed when.

## Migrations

`docker-entrypoint.sh` runs `prisma migrate deploy` before serving. It is idempotent and a no-op
when nothing is pending. A failed migration fails the boot rather than serving against a schema the
code does not expect — the container exits and the prior image is still there to roll back to.

## Local pre-flight

```bash
npm run typecheck && npm run build
npx tsx scripts/dev-checks/inspection-model.mjs
```

The webhook signature check needs a running API with the real verifier — see the header of
`scripts/dev-checks/webhook-signature.mjs`.
