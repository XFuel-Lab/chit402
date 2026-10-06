#!/usr/bin/env node
/**
 * Rebuild epoch 1 of the receipt log from usage-settled.jsonl.
 *
 * Pins genesis digest 422cceb1. Refuses unless the 4-leaf root is exactly
 * dd20e39a39a225b7b3441bb7f61532c06562288b74ae5dc4dda015c48312f973.
 * On success, writes the durable journal (epoch 1 closed, epoch 2 opened at
 * f2043ee9) and a signed epoch record. Does not broadcast, and does not
 * re-sign any receipt.
 *
 *   node scripts/rebuild-receipt-epoch1.mjs \
 *     --jsonl .data/agents/usage-settled.jsonl \
 *     --out .data/receipt-log
 */
import fs from 'fs';
import path from 'path';
import { signJws, getIssuerPublicKeyJwk } from '../src/issuer-key.js';
import {
  EPOCH1_FINAL_ROOT,
  EPOCH_RECORD_JWT_TYP,
  rebuildEpoch1FromRows,
} from '../src/receipt-log-epoch.js';
import { writeRestoredEpochs } from '../src/receipt-log-store.js';

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) return null;
  return process.argv[i + 1];
}

function signRecord(claims) {
  const { jws, kid } = signJws(claims, { typ: EPOCH_RECORD_JWT_TYP });
  return {
    ...claims,
    issuer_signature: {
      alg: 'ES256',
      typ: EPOCH_RECORD_JWT_TYP,
      payload_version: 1,
      jws,
      kid,
      issuer_jwk: getIssuerPublicKeyJwk(),
    },
  };
}

const jsonl = arg('--jsonl');
const out = arg('--out');
if (!jsonl || !out) {
  console.error('usage: rebuild-receipt-epoch1.mjs --jsonl <usage-settled.jsonl> --out <receipt-log-dir>');
  process.exit(2);
}

const rows = fs.readFileSync(jsonl, 'utf8')
  .split('\n')
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line));

let rebuilt;
try {
  rebuilt = rebuildEpoch1FromRows(rows);
} catch (err) {
  console.error(`REFUSED: ${err.message}`);
  console.error(`epoch 1 must recompute to ${EPOCH1_FINAL_ROOT}`);
  process.exit(1);
}

if (rebuilt.root !== EPOCH1_FINAL_ROOT) {
  console.error(`REFUSED: root ${rebuilt.root} is not ${EPOCH1_FINAL_ROOT}`);
  process.exit(1);
}

const record = writeRestoredEpochs(path.resolve(out), rebuilt, { signRecord });
console.error(`epoch 1 root ${rebuilt.root} size ${rebuilt.tree_size}`);
console.error(`wrote ${path.resolve(out)}`);
console.error(`epoch record signed: ${Boolean(record.issuer_signature?.jws)}`);
console.error('No transaction was broadcast. No receipt was re-signed.');
