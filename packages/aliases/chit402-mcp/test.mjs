/**
 * Basic smoke test for chit402-mcp.
 * Run: node test.mjs
 */
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Verify xfuel-mcp is resolvable
const xfuelMcpPath = require.resolve('xfuel-mcp');
assert.ok(xfuelMcpPath, 'xfuel-mcp should be resolvable');
assert.ok(existsSync(xfuelMcpPath), 'xfuel-mcp entry point should exist');

// Verify bin exists
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const binPath = join(__dirname, 'bin.js');
assert.ok(existsSync(binPath), 'bin.js should exist');

console.log('✓ chit402-mcp setup verified');
