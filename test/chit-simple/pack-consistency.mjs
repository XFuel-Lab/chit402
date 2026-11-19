// Packs packages/cs2-core/vectors/rfc9162.json consistency rows into a binary
// blob the Foundry vector test reads. The P0-0 file is not modified.
// max_tree_size is not written into the blob.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const REASON = {
  m_gt_n: 1,
  proof_not_empty: 2,
  root_mismatch: 3,
  proof_too_short: 4,
  proof_too_long: 5,
};

const doc = JSON.parse(readFileSync(new URL('../../packages/cs2-core/vectors/rfc9162.json', import.meta.url), 'utf8'));
if (doc.schema !== 'chit402.cs2.rfc9162.v1') throw new Error('schema');
if (doc.consistency.length !== 2145 || doc.counts.consistency !== 2145) {
  throw new Error(`consistency count ${doc.consistency.length}`);
}
if (typeof doc.implementation_limits.max_tree_size !== 'number') throw new Error('limits missing');

const negatives = doc.negative.filter((row) => row.op === 'verifyConsistency');
if (negatives.length < 9) throw new Error(`negative consistency rows ${negatives.length}`);

const chunks = [];
const u8 = (n) => chunks.push(Buffer.from([n]));
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); chunks.push(b); };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); chunks.push(b); };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); chunks.push(b); };
const b32 = (hex) => {
  const h = String(hex).replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(h)) throw new Error(`hash ${hex}`);
  chunks.push(Buffer.from(h, 'hex'));
};

function writeRecord(expectOk, reason, m, n, oldRoot, newRoot, proof) {
  u8(expectOk);
  u8(reason);
  u64(m);
  u64(n);
  b32(oldRoot);
  b32(newRoot);
  u16(proof.length);
  for (const item of proof) b32(item);
}

u32(0x91629162);
u32(doc.consistency.length);
u32(negatives.length);
for (const row of doc.consistency) {
  writeRecord(1, 0, row.m, row.n, row.old_root, row.new_root, row.proof);
}
for (const row of negatives) {
  const reason = REASON[row.reason];
  if (reason === undefined) throw new Error(`${row.id} reason ${row.reason}`);
  writeRecord(0, reason, row.m, row.n, row.old_root, row.new_root, row.proof);
}

const dest = process.argv[2];
if (!dest) throw new Error('dest path required');
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, Buffer.concat(chunks));
