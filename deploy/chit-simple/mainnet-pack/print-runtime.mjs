#!/usr/bin/env node
// Read-only. Prints the CREATE address and the runtime code hash for a
// deployer, nonce, and checkpoint on Base mainnet (chain id 8453).
// Does not broadcast and does not read a key.
//
//   node print-runtime.mjs <deployer> <nonce> <checkpoint>
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [deployer, nonce, checkpoint] = process.argv.slice(2);
if (!deployer || nonce === undefined || !checkpoint) {
  process.stderr.write('usage: node print-runtime.mjs <deployer> <nonce> <checkpoint>\n');
  process.exit(2);
}
const forge = spawnSync(
  'forge',
  ['script', 'DeployChitAnchor.s.sol:DeployChitAnchor', '--sig', 'preview(address,uint256,address)', deployer, nonce, checkpoint, '--offline', '--json'],
  { cwd: here, encoding: 'utf8' },
);
if (forge.error || forge.status !== 0) {
  process.stderr.write(forge.stderr || forge.stdout || forge.error?.message || 'preview failed\n');
  process.exit(forge.status || 1);
}
const text = `${forge.stdout || ''}\n${forge.stderr || ''}`;
const addr = text.match(/predicted:\s*(0x[0-9a-fA-F]{40})/i) || text.match(/address=(0x[0-9a-fA-F]{40})/i);
const hash = text.match(/codeHash:\s*(0x[0-9a-fA-F]{64})/i) || text.match(/runtimeCodeHash=(0x[0-9a-fA-F]{64})/i);
if (!addr || !hash) {
  process.stderr.write(text);
  process.exit(1);
}
process.stdout.write(`address=${addr[1].toLowerCase()}\n`);
process.stdout.write(`runtimeCodeHash=${hash[1].toLowerCase()}\n`);
