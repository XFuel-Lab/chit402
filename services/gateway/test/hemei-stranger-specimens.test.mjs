/**
 * Hemei stranger-auditable specimens (gaps A+B): public GET /public/specimens/* → 200.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

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
