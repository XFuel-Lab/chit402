/**
 * Golden slot-proof vectors. Sizes at 1,024 entries are measured here.
 * SIMPLE §S5 cites 363 B mean and a max of 448–480 B from m7.out. That
 * file is not in this repository; the citation is recorded beside the
 * measurement.
 *
 *   node packages/cs2-core/smt/build-vectors.mjs
 *   node packages/cs2-core/smt/build-vectors.mjs --check
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bytesToHex } from '../ecdsa/bytes.js';
import { KIND_EPOCH, KIND_PAYTO, slotKey } from '../line/index.mjs';
import { CITED_PROOF_BYTES } from './index.mjs';
import { createTree, emptyRoot, prove, putLeaf, rootBytes } from './tree.mjs';

export const VECTOR_PATH = new URL('./vectors/slot-proofs.json', import.meta.url);

function sha256(parts) {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return new Uint8Array(hash.digest());
}

function u32(index) {
  const out = new Uint8Array(4);
  let x = index;
  for (let i = 3; i >= 0; i -= 1) {
    out[i] = x % 256;
    x = Math.floor(x / 256);
  }
  return out;
}

function sizeKey(index) {
  return sha256([Buffer.from('chit402-smt-size-v1'), u32(index)]);
}

export function measureTier() {
  let tree = createTree();
  const keys = [];
  for (let i = 0; i < 1024; i += 1) {
    const key = sizeKey(i);
    const value = sha256([Buffer.from('chit402-smt-size-val-v1'), u32(i)]);
    const placed = putLeaf(tree, key, value);
    if (!placed.ok) throw new Error(placed.reason);
    tree = placed.tree;
    keys.push({ key, value });
  }
  let sum = 0;
  let max = 0;
  let min = 32 + 32 * 256;
  const samples = [];
  for (let i = 0; i < keys.length; i += 1) {
    const proof = prove(tree, keys[i].key);
    if (!proof.ok || !proof.present) throw new Error('size proof');
    const n = proof.proof.length;
    sum += n;
    if (n > max) max = n;
    if (n < min) min = n;
    if (i === 0 || i === 1 || i === 1023) {
      samples.push({
        index: i,
        key: bytesToHex(keys[i].key),
        value: bytesToHex(keys[i].value),
        siblings: proof.siblings,
        bytes: n,
        proof: bytesToHex(proof.proof),
      });
    }
  }
  return {
    entries: 1024,
    mean: Math.round((sum / 1024) * 1000) / 1000,
    min,
    max,
    root: bytesToHex(rootBytes(tree)),
    samples,
  };
}

function tiny() {
  const keyA = new Uint8Array(32);
  const keyB = new Uint8Array(32);
  keyB[0] = 0x80;
  const valueA = sha256([Buffer.from('a')]);
  const valueB = sha256([Buffer.from('b')]);
  let tree = createTree();
  tree = putLeaf(tree, keyA, valueA).tree;
  const one = prove(tree, keyA);
  const oneRoot = bytesToHex(rootBytes(tree));
  tree = putLeaf(tree, keyB, valueB).tree;
  const two = prove(tree, keyA);
  const absentKey = new Uint8Array(32);
  absentKey[0] = 0x01;
  const absent = prove(tree, absentKey);
  return {
    empty_root: bytesToHex(emptyRoot().bytes),
    one: {
      key: bytesToHex(keyA),
      value: bytesToHex(valueA),
      root: oneRoot,
      proof: bytesToHex(one.proof),
    },
    two: {
      key: bytesToHex(keyA),
      value: bytesToHex(valueA),
      other: bytesToHex(keyB),
      root: bytesToHex(rootBytes(tree)),
      proof: bytesToHex(two.proof),
      absent_key: bytesToHex(absentKey),
      absent_proof: bytesToHex(absent.proof),
    },
  };
}

export function renderSlotProofs() {
  const payTo = slotKey({
    kind: KIND_PAYTO,
    chainId: 8453,
    id: new Uint8Array(20).fill(0x11),
  });
  const epoch = slotKey({ kind: KIND_EPOCH, chainId: 8453, id: new Uint8Array(0) });
  const measured = measureTier();
  return {
    schema: 'chit402.cs2.smt.v1',
    m7_out: 'not in this repository',
    cited: {
      source: CITED_PROOF_BYTES.source,
      entries: CITED_PROOF_BYTES.entries,
      mean_bytes: CITED_PROOF_BYTES.mean,
      max_bytes: [CITED_PROOF_BYTES.maxLow, CITED_PROOF_BYTES.maxHigh],
    },
    measured_1024: measured,
    slot_keys: {
      payTo_0x11: payTo.hex,
      epoch: epoch.hex,
    },
    proofs: tiny(),
  };
}

function canonical(doc) {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

function main() {
  const doc = renderSlotProofs();
  const text = canonical(doc);
  const check = process.argv.includes('--check');
  if (check) {
    const onDisk = readFileSync(VECTOR_PATH, 'utf8');
    if (onDisk !== text) {
      process.stderr.write('slot-proofs.json does not match the builder\n');
      process.exit(1);
    }
    process.stdout.write(`slot proofs ok mean=${doc.measured_1024.mean} max=${doc.measured_1024.max}\n`);
    return;
  }
  mkdirSync(dirname(fileURLToPath(VECTOR_PATH)), { recursive: true });
  writeFileSync(VECTOR_PATH, text);
  process.stdout.write(`wrote slot-proofs.json mean=${doc.measured_1024.mean} max=${doc.measured_1024.max}\n`);
}

if (process.argv[1] && process.argv[1].endsWith('build-vectors.mjs')) main();
