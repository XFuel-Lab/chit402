/**
 * Read-only scan of a usage-settled JSONL file.
 * Counts rows whose payment ref is missing a tx, ends in ":unknown",
 * or whose payee field is empty. Writes nothing. Prints a count only.
 *
 *   node scripts/audit-payment-refs.mjs path/to/usage-settled.jsonl
 */
import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/audit-payment-refs.mjs <usage-settled.jsonl>');
  process.exit(2);
}

let rows = 0;
let unknownRef = 0;
let emptyPayee = 0;
const text = fs.readFileSync(file, 'utf8');
for (const line of text.split('\n')) {
  if (!line.trim()) continue;
  let row;
  try { row = JSON.parse(line); } catch { continue; }
  rows += 1;
  const ref = String(row.payment_ref || '');
  if (!ref || ref.endsWith(':unknown')) unknownRef += 1;
  if (row.payTo == null || row.pay_to == null && row.payTo == null) {
    if (!row.payTo && !row.pay_to) emptyPayee += 1;
  }
}
process.stdout.write(JSON.stringify({ rows, unknownRef, emptyPayee }) + '\n');
