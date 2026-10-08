/**
 * Hemei stranger-auditable specimens (gaps A+B): public GET /public/specimens/* → 200.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'false';

const { createApp } = await import('../src/server.js');
const { resetHubCatalogCache } = await import('../src/hub-catalog.js');
const { initAIListener } = await import('../src/ai-listener.js');

let server;
let base;

before(async () => {
  resetHubCatalogCache();
  await initAIListener();
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address();
      base = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  if (!server) return;
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const SPECIMENS = [
  {
    path: '/public/specimens/hemei-stranger-export.csv',
    contentType: /text\/csv/,
    bodyMatch: /task_id,evidence,collected_at,hub,model,amount,payment_ref/,
  },
  {
    path: '/public/specimens/hemei-stranger-export.json',
    contentType: /application\/json/,
    schema: 'chit402.book_audit.v1',
  },
  {
    path: '/public/specimens/hemei-path-rotate-observe.json',
    contentType: /application\/json/,
    schema: 'chit402.path_rotate_observe.v1',
  },
  {
    path: '/public/specimens/tier2-in-proof-binding.json',
    contentType: /application\/json/,
    schema: 'chit402.tier2_in_proof_binding.v1',
  },
  {
    path: '/public/specimens/fulfillment-foreign-research.json',
    contentType: /application\/json/,
    schema: 'chit402.fulfillment_receipt_specimen.v1',
  },
];

for (const specimen of SPECIMENS) {
  test(`GET ${specimen.path} → 200 (no auth)`, async () => {
    const res = await fetch(`${base}${specimen.path}`);
    assert.equal(res.status, 200, `expected 200 for ${specimen.path}`);
    assert.match(res.headers.get('content-type') ?? '', specimen.contentType);
    const body = await res.text();
    if (specimen.bodyMatch) {
      assert.match(body, specimen.bodyMatch);
    }
    if (specimen.schema) {
      const json = JSON.parse(body);
      assert.equal(json.schema, specimen.schema);
      assert.equal(json.specimen, true);
    }
  });
}

test('GET unknown specimen → 404', async () => {
  const res = await fetch(`${base}/public/specimens/not-a-real-specimen.json`);
  assert.equal(res.status, 404);
});

test('public specimens omit the retired specimen row and the export totals add up', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/specimens');
  const retired = /chit-1e57cdd7/;
  for (const name of readdirSync(dir)) {
    const text = readFileSync(path.join(dir, name), 'utf8');
    assert.doesNotMatch(text, retired, `${name} still cites the retired specimen row`);
  }

  const pack = JSON.parse(readFileSync(path.join(dir, 'hemei-stranger-export.json'), 'utf8'));
  const csv = readFileSync(path.join(dir, 'hemei-stranger-export.csv'), 'utf8').trim().split('\n');
  const amountRows = pack.rows.filter((row) => row.amount != null && row.amount !== '');
  const summed = amountRows.reduce((sum, row) => sum + BigInt(row.amount), 0n);
  assert.equal(pack.row_count, pack.rows.length);
  assert.equal(pack.rows.length, 4);
  assert.equal(csv.length, pack.rows.length + 1);
  assert.equal(pack.totals.count, amountRows.length);
  assert.equal(pack.totals.usdc_sum, summed.toString());
  assert.equal(pack.totals.usdc_sum, '28000');
  assert.equal(pack.totals.by_rail.usdc.count, amountRows.length);
  assert.equal(pack.totals.by_rail.usdc.amount, summed.toString());
  assert.ok(pack.rows.some((row) => row.evidence === 'policy_blocked' && row.amount == null));

  const rotate = JSON.parse(readFileSync(path.join(dir, 'hemei-path-rotate-observe.json'), 'utf8'));
  assert.equal(rotate.before_rotate.totals_usdc_sum, rotate.parent_receipt.amount);
  assert.equal(rotate.after_rotate.totals_usdc_sum, rotate.parent_receipt.amount);
  assert.equal(rotate.before_rotate.payment_ref, rotate.after_rotate.payment_ref);
  assert.equal(rotate.after_rotate.verify_url, rotate.parent_receipt.verify_url);
});
