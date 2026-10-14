/**
 * Background job: sign one chit402.public.v1 record per receipt.
 *
 * Dry-run is the default. --apply writes the compact JWS bytes into the
 * durable directory. The first file for an id wins. A later run does not
 * re-sign it. Refusals are skipped. This script does not serve records
 * and does not rewrite receipt, leaf, head, or anchor bytes.
 *
 *   node scripts/sign-public-records.mjs --receipts receipts.json
 *   node scripts/sign-public-records.mjs --receipts receipts.json --apply --out ./public-records
 *
 * Each input row is a receipt, or { receipt, leaf_hash, log_id }.
 * --out is the store the gateway reads (PUBLIC_RECORD_DIR). Serving stays
 * off until ROTATION_TRUST_SHIPPED is true.
 * Do not print issuer key material.
 */
import { readFileSync } from 'node:fs';

const {
  isRefusalReceipt,
  receiptIdOf,
  signMissingPublicRecords,
} = await import('../src/public-record.js');
const {
  configurePublicRecordDir,
  getPublicRecordBytes,
} = await import('../src/public-record-store.js');

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i === -1 || !process.argv[i + 1]) return null;
  return process.argv[i + 1];
}

const receiptsPath = arg('--receipts');
const apply = process.argv.includes('--apply');
const outDir = arg('--out');

if (!receiptsPath) {
  console.error('usage: sign-public-records.mjs --receipts <file.json> [--apply] [--out <dir>]');
  process.exit(3);
}

if (outDir) configurePublicRecordDir(outDir);
else if (process.env.PUBLIC_RECORD_DIR) configurePublicRecordDir(process.env.PUBLIC_RECORD_DIR);

const parsed = JSON.parse(readFileSync(receiptsPath, 'utf8'));
const rows = Array.isArray(parsed) ? parsed : [];

let refusals = 0;
const items = [];
for (const row of rows) {
  const receipt = row?.receipt || row;
  if (isRefusalReceipt(receipt)) {
    refusals += 1;
    continue;
  }
  items.push({
    receipt,
    leafHash: row?.leaf_hash ?? row?.leafHash ?? null,
    logId: row?.log_id ?? row?.logId ?? null,
  });
}

if (!apply) {
  const pending = items.filter((item) => {
    const id = receiptIdOf(item.receipt);
    return id && !getPublicRecordBytes(id);
  }).length;
  console.log(JSON.stringify({ would_sign: pending, refusals, apply: false }));
  process.exit(0);
}

const signed = signMissingPublicRecords(items);
console.log(JSON.stringify({ signed: signed.length, refusals, apply: true }));
