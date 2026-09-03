#!/usr/bin/env node
/**
 * chit402-mcp — Chit402 MCP server
 *
 * This is the public-facing CLI. Internally it runs xfuel-mcp.
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const xfuelMcpPath = require.resolve('xfuel-mcp');

const child = spawn(process.execPath, [xfuelMcpPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});

child.on('error', (err) => {
  console.error('Failed to start chit402-mcp:', err.message);
  process.exit(1);
});
