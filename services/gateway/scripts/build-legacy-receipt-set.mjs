/**
 * Read-only builder for the legacy_receipts_pre_v11 Merkle artifact.
 *
 * Enumerates stored payload_hash values on book rows. It does not sign,
 * re-sign, mint, or broadcast. A pre-v11 receipt with no stored payload_hash
 * fails the run and writes nothing.
 *
 *   node services/gateway/scripts/build-legacy-receipt-set.mjs \
 *     --ledger <usage-settled.jsonl | directory> \
 *     --out <artifact.json>
 *
 * Broadcast is refused. Passing --broadcast, --send, or --deploy exits 2
 * before any file is read. A chain id other than Base Sepolia (84532) is
 * never a reason to send a transaction from this script: there is no send.
 */
import fs from 'fs';
import path from 'path';
import { buildLegacyReceiptSet } from '../src/legacy-receipt-merkle.js';

const BROADCAST_FLAGS = ['--broadcast', '--send', '--deploy'];

/**
 * Guard for any future send. This script has no send. A broadcast request
 * is refused unless the chain id is Base Sepolia, and even then this script
 * refuses because it does not broadcast.
 * @param {number|string} chainId
 */
export function assertBroadcastAllowed(chainId) {
  const id = Number(chainId);
  if (id !== 84532) {
    throw new Error(`refusing to broadcast unless block.chainid == 84532 (got ${chainId})`);
  }
}

function wantsBroadcast(argv) {
  return BROADCAST_FLAGS.some((flag) => argv.includes(flag));
}

function arg(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) return null;
  return value;
}

function readRows(ledgerPath) {
  const stat = fs.statSync(ledgerPath);
  const file = stat.isDirectory() ? path.join(ledgerPath, 'usage-settled.jsonl') : ledgerPath;
  const text = fs.readFileSync(file, 'utf8');
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line));
  }
  return rows;
}

function main(argv) {
  if (wantsBroadcast(argv)) {
    try {
      const chain = process.env.ISSUER_ROOT_CHAIN_ID || '';
      const id = chain === 'eip155:84532' ? 84532 : 0;
      assertBroadcastAllowed(id);
    } catch (err) {
      console.error(err.message);
      process.exit(2);
    }
    console.error('build-legacy-receipt-set is read-only and does not broadcast');
    process.exit(2);
  }
  const ledger = arg(argv, '--ledger');
  const out = arg(argv, '--out');
  if (!ledger || !out) {
    console.error('usage: build-legacy-receipt-set.mjs --ledger <jsonl|dir> --out <artifact.json>');
    process.exit(2);
  }
  const before = fs.existsSync(ledger) ? fs.statSync(ledger).mtimeMs : null;
  let artifact;
  try {
    artifact = buildLegacyReceiptSet(readRows(ledger));
  } catch (err) {
    console.error(err.message);
    if (Array.isArray(err.task_ids) && err.task_ids.length) {
      console.error(err.task_ids.join('\n'));
    }
    process.exit(1);
  }
  if (before != null && fs.statSync(ledger).mtimeMs !== before) {
    console.error('ledger mtime changed; refusing to continue');
    process.exit(1);
  }
  fs.writeFileSync(out, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`legacy_receipts_pre_v11 count=${artifact.enumerated_count} root=${artifact.root} universe=${artifact.universe_id}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) main(process.argv);
