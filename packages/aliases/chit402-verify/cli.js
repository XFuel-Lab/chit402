#!/usr/bin/env node
/**
 * chit402-verify CLI — Chit402 receipt verification
 *
 * This is the public-facing CLI. Internally it runs @xfuel/verify.
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const verifyCliPath = require.resolve('@xfuel/verify/dist/cli.js');

const child = spawn(process.execPath, [verifyCliPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});

child.on('error', (err) => {
  console.error('Failed to start chit402-verify:', err.message);
  process.exit(1);
});
