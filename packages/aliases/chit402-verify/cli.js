#!/usr/bin/env node
/**
 * chit402-verify CLI — Chit402 receipt verification
 *
 * This is the public-facing CLI. Internally it runs @xfuel/verify.
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { constants as osConstants } from 'node:os';

const require = createRequire(import.meta.url);
// Resolve via the package exports map. Deep imports of dist/cli.js throw
// ERR_PACKAGE_PATH_NOT_EXPORTED unless @xfuel/verify lists that subpath.
const verifyCliPath = require.resolve('@xfuel/verify/dist/cli.js');

const child = spawn(process.execPath, [verifyCliPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});

// Forward termination signals so killing the wrapper (CI timeout, supervisor) also stops the verifier.
const FORWARDED = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'];
for (const sig of FORWARDED) {
  process.on(sig, () => {
    try { child.kill(sig); } catch { /* child already gone */ }
  });
}

// Mirror the verifier's result exactly. A verifier killed by a signal (crash, heap-OOM abort,
// timeout) must never look like success: exit 128 + signal number, as a shell would report it.
child.on('exit', (code, signal) => {
  if (signal) {
    const n = osConstants.signals[signal];
    process.exit(typeof n === 'number' ? 128 + n : 1);
  }
  process.exit(typeof code === 'number' ? code : 1);
});

child.on('error', (err) => {
  console.error('Failed to start chit402-verify:', err.message);
  process.exit(1);
});
