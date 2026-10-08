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
 * Loads `.env` the same way the server does (`src/config.js`). Refuses when
 * ISSUER_PRIVATE_KEY is unset so the epoch record is never signed with an
 * ephemeral key. Boot would reject that signature (`epoch_signature` /
 * `no_matching_key`).
 *
 *   node scripts/rebuild-receipt-epoch1.mjs \
 *     --jsonl .data/agents/usage-settled.jsonl \
 *     --out .data/receipt-log
 */
import '../src/config.js';
import fs from 'fs';
import path from 'path';
import {
  initIssuerKey,
  signJws,
  getIssuerPublicKeyJwk,
  getJwks,
  verifyJwsWithJwks,
} from '../src/issuer-key.js';
import {
  EPOCH1_FINAL_ROOT,
  EPOCH_RECORD_JWT_TYP,
  rebuildEpoch1FromRows,
} from '../src/receipt-log-epoch.js';
import {
  EPOCH_RECORD_NAME,
  JOURNAL_NAME,
  writeRestoredEpochs,
} from '../src/receipt-log-store.js';

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

if (!String(process.env.ISSUER_PRIVATE_KEY || '').trim()) {
  console.error('REFUSED: ISSUER_PRIVATE_KEY is not set. Refusing to sign the epoch record with an ephemeral key. Boot would reject that signature (epoch_signature / no_matching_key). Source services/gateway/.env from this directory, or export the production key, and re-run.');
  process.exit(1);
}

try {
  initIssuerKey();
} catch (err) {
  console.error(`REFUSED: ISSUER_PRIVATE_KEY could not be loaded: ${err.message}`);
  process.exit(1);
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

const outDir = path.resolve(out);
const record = writeRestoredEpochs(outDir, rebuilt, { signRecord });
const verified = verifyJwsWithJwks(record.issuer_signature?.jws, getJwks());
if (!verified.valid) {
  fs.rmSync(path.join(outDir, JOURNAL_NAME), { force: true });
  fs.rmSync(path.join(outDir, EPOCH_RECORD_NAME), { force: true });
  console.error(`REFUSED: epoch record failed verification (${verified.reason || 'invalid'}). The journal just written was removed so this command can be re-run.`);
  process.exit(1);
}
console.error(`epoch 1 root ${rebuilt.root} size ${rebuilt.tree_size}`);
console.error(`wrote ${outDir}`);
console.error(`epoch record kid: ${record.issuer_signature.kid}`);
console.error('epoch record signed: true');
console.error('No transaction was broadcast. No receipt was re-signed.');
