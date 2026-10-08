#!/usr/bin/env node
/**
 * Append book rows that are not leaves yet.
 *
 * Dry-run is the default. --apply writes leaves and does not publish or
 * broadcast. Rows are the book file in order, after epoch 1's last receipt
 * leaf, skipping any task_id already in an epoch.
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
import { ReceiptMerkleTree } from '../src/receipt-merkle.js';
import { planReceiptBackfill } from '../src/receipt-log-anchor.js';
import { JOURNAL_NAME } from '../src/receipt-log-store.js';

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

if (plan.append.length === 0) {
  console.error(`no rows to append after ${plan.last_task_id}`);
  process.exit(0);
}

for (const row of plan.append) {
  if (apply) {
    tree.appendReceipt(row.task_id, row.row_hash, { publish: false });
    console.log(`appended ${row.task_id}`);
  } else {
    console.log(`would append ${row.task_id}`);
  }
}
console.error(`${apply ? 'appended' : 'would append'} ${plan.append.length} row(s)`);
if (!apply) console.error('dry-run only. Pass --apply to write leaves. This does not broadcast.');
