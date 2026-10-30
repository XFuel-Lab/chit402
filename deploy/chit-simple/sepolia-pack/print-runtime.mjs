#!/usr/bin/env node
// Read-only. Prints the CREATE address and the runtime code hash for a
// deployer, nonce, and checkpoint on Base Sepolia (chain id 84532).
// Does not broadcast and does not read a key.
//
//   node print-runtime.mjs <deployer> <nonce> <checkpoint>
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [deployer, nonce, checkpoint] = process.argv.slice(2);
if (!deployer || nonce === undefined || !checkpoint) {
  process.stderr.write('usage: node print-runtime.mjs <deployer> <nonce> <checkpoint>\n');
  process.exit(2);
}

const forge = spawnSync(
  'forge',
  [
    'script',
    'DeployChitAnchor.s.sol:DeployChitAnchor',
    '--sig',
    'preview(address,uint256,address)',
    deployer,
    nonce,
    checkpoint,
    '--offline',
    '--json',
  ],
  { cwd: here, encoding: 'utf8' },
);
if (forge.error) {
  process.stderr.write(`${forge.error.message}\n`);
  process.exit(1);
}
const text = `${forge.stdout || ''}\n${forge.stderr || ''}`;
if (forge.status !== 0 && !text.includes('predicted')) {
  process.stderr.write(text);
  process.exit(forge.status || 1);
}

// forge --json may be one object or a line-delimited log. Fall back to the
// traced return names when the JSON shape changes.
let predicted;
let codeHash;
const start = text.indexOf('{');
const end = text.lastIndexOf('}');
if (start >= 0 && end > start) {
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    const ret = parsed.returns || parsed.returned || parsed;
    const rawPred = ret.predicted ?? ret[0];
    const rawHash = ret.codeHash ?? ret[1];
    predicted = typeof rawPred === 'object' ? rawPred.value : rawPred;
    codeHash = typeof rawHash === 'object' ? rawHash.value : rawHash;
  } catch {
    predicted = undefined;
  }
}
if (!predicted || !codeHash) {
  const addr = text.match(/predicted:\s*(0x[0-9a-fA-F]{40})/);
  const hash = text.match(/codeHash:\s*(0x[0-9a-fA-F]{64})/);
  predicted = addr && addr[1];
  codeHash = hash && hash[1];
}
if (!predicted || !codeHash) {
  process.stderr.write(text);
  process.exit(1);
}
process.stdout.write(`address=${predicted.toLowerCase()}\n`);
process.stdout.write(`runtimeCodeHash=${codeHash.toLowerCase()}\n`);
