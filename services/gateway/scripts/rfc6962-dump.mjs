/**
 * Print RFC 6962 consistency proofs for every 1 <= m <= n <= max.
 * One line per pair: m n oldRoot newRoot proofNodes
 * proofNodes is comma-separated hex, or "-" when the proof is empty.
 * Leaves are SHA-256(0x00 || "leaf-XX") so a second implementation can rebuild them.
 *
 *   node services/gateway/scripts/rfc6962-dump.mjs [max]
 *   node services/gateway/scripts/rfc6962-dump.mjs --one <m> <n> <seed>
 */
import { leafHash, rootOf, consistencyProof } from '../src/receipt-merkle.js';

function hex(buf) {
  return Buffer.from(buf).toString('hex');
}

function leavesOf(n, seed) {
  const leaves = [];
  for (let i = 0; i < n; i += 1) {
    const label = seed == null ? `leaf-${String(i).padStart(2, '0')}` : `${seed}:${i}`;
    leaves.push(leafHash(Buffer.from(label)));
  }
  return leaves;
}

function line(leaves, m, n) {
  const proof = consistencyProof(leaves, m, n);
  const oldRoot = hex(rootOf(leaves.slice(0, m)));
  const newRoot = hex(rootOf(leaves.slice(0, n)));
  const body = proof.length ? proof.join(',') : '-';
  return `${m} ${n} ${oldRoot} ${newRoot} ${body}`;
}

const args = process.argv.slice(2);
if (args[0] === '--one') {
  const m = Number(args[1]);
  const n = Number(args[2]);
  const seed = args[3] ?? '0';
  process.stdout.write(`${line(leavesOf(n, seed), m, n)}\n`);
} else {
  const max = Number(args[0] || 40);
  const leaves = leavesOf(max, null);
  const lines = [];
  for (let n = 1; n <= max; n += 1) {
    for (let m = 1; m <= n; m += 1) lines.push(line(leaves, m, n));
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}
