#!/usr/bin/env node
/**
 * Append book rows that are not leaves yet.
 *
 * Dry-run is the default. It prints `would append` and `would list as
 * unlogged`. --apply writes the clean leaves and a payload version 2 epoch
 * record. It does not publish, broadcast, derive a row_hash, or write the
 * book. A forked agent's rows, an empty row_hash, and a row whose chain
 * depends on one of those are listed and skipped. The version 1 epoch
 * record stays in the journal.
 *
 *   node scripts/backfill-receipt-log.mjs \
 *     --jsonl .data/agents/usage-settled.jsonl \
 *     --dir .data/receipt-log
 *   node scripts/backfill-receipt-log.mjs --jsonl ... --dir ... --apply
 *
 * Loads `.env` the same way the server does. A directory with no journal
 * exits before planning, so a missing file is not reported as
 * epoch1_has_no_receipt_leaf.
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
import { ReceiptMerkleTree } from '../src/receipt-merkle.js';
import { planReceiptBackfill } from '../src/receipt-log-anchor.js';
import { EPOCH_RECORD_JWT_TYP, epochRecordWithUnlogged } from '../src/receipt-log-epoch.js';
import { JOURNAL_NAME, appendSignedEpochRecord } from '../src/receipt-log-store.js';

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) return null;
  return process.argv[i + 1];
}

const jsonl = arg('--jsonl');
const dir = arg('--dir');
const apply = process.argv.includes('--apply');
if (!jsonl || !dir) {
  console.error('usage: backfill-receipt-log.mjs --jsonl <usage-settled.jsonl> --dir <receipt-log-dir> [--apply]');
  process.exit(2);
}

const rows = fs.readFileSync(jsonl, 'utf8')
  .split('\n')
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line));

const abs = path.resolve(dir);
const journalPath = path.join(abs, JOURNAL_NAME);
if (!fs.existsSync(journalPath)) {
  console.error(`REFUSED: no journal at ${abs}`);
  process.exit(1);
}

const tree = new ReceiptMerkleTree();
tree.load(abs);
let plan;
try {
  plan = planReceiptBackfill(tree, rows);
} catch (err) {
  console.error(`REFUSED: ${err.message}`);
  for (const row of err.refusals || []) {
    const id = row.task_id || `agent ${row.agent_id}`;
    console.error(`refuse ${id}: ${row.reason}`);
  }
  process.exit(1);
}

function printPlan(prefixAppend, prefixList) {
  for (const row of plan.append) console.log(`${prefixAppend} ${row.task_id}`);
  for (const row of plan.unlogged) console.log(`${prefixList} ${row.task_id} ${row.reason}`);
  console.error(`${prefixAppend} ${plan.append.length} row(s)`);
  console.error(`${prefixList} ${plan.unlogged.length} row(s)`);
}

if (!apply) {
  printPlan('would append', 'would list as unlogged');
  console.error('dry-run only. Pass --apply to write leaves and the unlogged list. This does not broadcast.');
  process.exit(0);
}
if (plan.append.length === 0 && plan.unlogged.length === 0) {
  console.error(`no rows to append after ${plan.last_task_id}`);
  process.exit(0);
}
if (!String(process.env.ISSUER_PRIVATE_KEY || '').trim()) {
  console.error('REFUSED: ISSUER_PRIVATE_KEY is not set. Refusing to sign the epoch record with an ephemeral key.');
  process.exit(1);
}
let record;
try {
  initIssuerKey();
  const claims = epochRecordWithUnlogged(tree.epochRecord, plan.unlogged);
  const { jws, kid } = signJws(claims, { typ: EPOCH_RECORD_JWT_TYP });
  record = {
    ...claims,
    issuer_signature: {
      alg: 'ES256',
      typ: EPOCH_RECORD_JWT_TYP,
      payload_version: 2,
      jws,
      kid,
      issuer_jwk: getIssuerPublicKeyJwk(),
    },
  };
  const verified = verifyJwsWithJwks(jws, getJwks());
  if (!verified.valid) {
    console.error(`REFUSED: epoch record failed verification (${verified.reason || 'invalid'})`);
    process.exit(1);
  }
} catch (err) {
  console.error(`REFUSED: ${err.message}`);
  process.exit(1);
}
for (const row of plan.append) {
  tree.appendReceipt(row.task_id, row.row_hash, { publish: false });
}
appendSignedEpochRecord(abs, record);
printPlan('appended', 'listed as unlogged');
console.error(`epoch record kid: ${record.issuer_signature.kid}`);
console.error('epoch record signed: true');
console.error('No transaction was broadcast. No receipt was re-signed. The book file was not written.');
