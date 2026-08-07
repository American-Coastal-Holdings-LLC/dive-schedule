#!/usr/bin/env node
/**
 * eos-oauth-stub — CLI entry point for the local OAuth stub server
 * (contract 02 §4, §5 step 3, §13). All server logic lives in
 * `../oauth-stub.ts` (importable programmatically, e.g. from tests); this
 * file is argv parsing + process lifecycle, guarded so importing it never
 * auto-starts a server.
 */
import { createOAuthStubServer, type OAuthStubServerOptions } from '../oauth-stub.ts';

export const OAUTH_STUB_HELP = `eos-oauth-stub — local OAuth2 (Authorization Code + PKCE) stub server (contract 02 §4, §13)

USAGE
  eos-oauth-stub [options]

Serves, on one local port:
  GET  /plugin-api/v1/oauth/authorize        Authorization Code + PKCE (S256 only)
  POST /plugin-api/v1/oauth/token             code+PKCE exchange; refresh rotation w/ reuse-detection -> family revoke
  GET  /plugin-api/v1/.well-known/jwks.json    the stub-kit's test JWKS
  POST /plugin-api/v1/bridge/verify            fixture responder: { active, installationId, tenantId, userId, permissions }
  GET  /plugin-api/v1/{pluginName}/users       demo scoped resource (contract §6 worked example: Bearer + users.read scope,
                                               { data, pageInfo } envelope, cursor pagination, error-code taxonomy)

OPTIONS
  --port <n>                Port to listen on. Default: $STUB_OAUTH_PORT or 5102.
  --host <host>               Host to bind. Default: 127.0.0.1.
  --client-id <id>             OAuth client_id this stub accepts. Default: "stub-client".
  --client-secret <secret>     OAuth client_secret this stub accepts. Default: a fixed dev-only value (see --help output).
  --redirect-uri <uri>         Allowed redirect_uri (repeatable). Default: any redirect_uri is accepted.
  --tenant-id <id>              Fixture tenantId. Default: the stub-kit fixture tenantId.
  --installation-id <id>        Fixture installationId (token audience). Default: the stub-kit fixture installationId.
  --user-id <id>                 Fixture userId. Default: the stub-kit fixture userId.
  --plugin-name <name>           Fixture pluginName. Default: the stub-kit fixture pluginName.
  --permissions <a,b,c>           Comma-separated bridge/verify permissions fixture.
  --scope <a,b,c>                  Comma-separated default granted OAuth scope when /authorize omits one.
  --inactive                        Make bridge/verify report active:false and refresh rotation fail — simulates a killed/suspended installation.
  --lenient                        Relax /oauth/token to ALSO accept application/x-www-form-urlencoded bodies and
                                    body-embedded client_id/client_secret. Default (omitted): strictly enforce contract
                                    §4 (C11) — client_secret_basic (Authorization: Basic header) + a JSON body only.
                                    Use this only to test against legacy/non-conforming clients.
  -h, --help                        Show this help and exit.

ENV DEFAULTS (fall back to these when the matching flag is omitted)
  STUB_OAUTH_PORT              same as --port

EXAMPLES
  eos-oauth-stub
  eos-oauth-stub --port 5102 --redirect-uri http://localhost:5100/oauth/callback
  eos-oauth-stub --inactive   # test your revocation / refresh-refusal handling
  eos-oauth-stub --lenient    # accept form-encoded bodies / body-embedded creds too (legacy-client testing only)
`;

interface CliOptions {
  help: boolean;
  server: OAuthStubServerOptions;
}

function nextArg(argv: string[], i: number, flag: string): string {
  const value = argv[i + 1];
  if (value === undefined) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseOAuthStubArgs(argv: string[]): CliOptions {
  const server: OAuthStubServerOptions = {};
  const redirectUris: string[] = [];
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        help = true;
        break;
      case '--port':
        server.port = Number(nextArg(argv, i, arg));
        i++;
        break;
      case '--host':
        server.host = nextArg(argv, i, arg);
        i++;
        break;
      case '--client-id':
        server.clientId = nextArg(argv, i, arg);
        i++;
        break;
      case '--client-secret':
        server.clientSecret = nextArg(argv, i, arg);
        i++;
        break;
      case '--redirect-uri':
        redirectUris.push(nextArg(argv, i, arg));
        i++;
        break;
      case '--tenant-id':
        server.tenantId = nextArg(argv, i, arg);
        i++;
        break;
      case '--installation-id':
        server.installationId = nextArg(argv, i, arg);
        i++;
        break;
      case '--user-id':
        server.userId = nextArg(argv, i, arg);
        i++;
        break;
      case '--plugin-name':
        server.pluginName = nextArg(argv, i, arg);
        i++;
        break;
      case '--permissions':
        server.permissions = nextArg(argv, i, arg)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        i++;
        break;
      case '--scope':
        server.defaultScope = nextArg(argv, i, arg)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        i++;
        break;
      case '--inactive':
        server.active = false;
        break;
      case '--lenient':
        server.lenient = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg} (see --help)`);
    }
  }

  if (redirectUris.length > 0) {
    server.redirectUris = redirectUris;
  }

  return { help, server };
}

function isRunAsScript(): boolean {
  const entry = process.argv[1];
  return typeof entry === 'string' && import.meta.url === `file://${entry}`;
}

async function main(): Promise<void> {
  let opts: CliOptions;
  try {
    opts = parseOAuthStubArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.log(OAUTH_STUB_HELP);
    process.exit(1);
  }

  if (opts.help) {
    console.log(OAUTH_STUB_HELP);
    return;
  }

  const port = opts.server.port ?? (process.env.STUB_OAUTH_PORT ? Number(process.env.STUB_OAUTH_PORT) : 5102);
  const handle = await createOAuthStubServer({ ...opts.server, port, log: (msg) => console.log(msg) });

  console.log(`EOS OAuth stub listening at ${handle.baseUrl}`);
  console.log(`  authorize : GET  ${handle.pluginApiBaseUrl}/oauth/authorize`);
  console.log(`  token     : POST ${handle.pluginApiBaseUrl}/oauth/token`);
  console.log(`  jwks      : GET  ${handle.pluginApiBaseUrl}/.well-known/jwks.json`);
  console.log(`  verify    : POST ${handle.pluginApiBaseUrl}/bridge/verify`);
  console.log('Press Ctrl+C to stop.');

  const shutdown = (): void => {
    console.log('\nShutting down eos-oauth-stub...');
    handle
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (isRunAsScript()) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
