#!/usr/bin/env node
/**
 * eos-webhook-sim — CLI entry point. All logic lives in `../webhook-sim.ts`
 * (importable programmatically); this file is just argv/exit-code plumbing,
 * guarded so importing it (e.g. from a test) never auto-runs `main()`.
 */
import { runWebhookSim } from '../webhook-sim.ts';

function isRunAsScript(): boolean {
  const entry = process.argv[1];
  return typeof entry === 'string' && import.meta.url === `file://${entry}`;
}

if (isRunAsScript()) {
  runWebhookSim(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    },
  );
}
