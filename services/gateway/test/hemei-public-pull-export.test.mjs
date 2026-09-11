/**
 * Hemei test(3): public signed pull-export GET /public/export/:slug → 200 + JWKS-verifiable JWS.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'false';

const { createApp } = await import('../src/server.js');
const { resetHubCatalogCache } = await import('../src/hub-catalog.js');
const { initAIListener } = await import('../src/ai-listener.js');
const { _resetIssuerKey, getJwks, initIssuerKey } = await import('../src/issuer-key.js');
const {
  PUBLIC_PULL_EXPORT_SCHEMA,
  verifyPublicPullExport,
  documentDigest,
} = await import('../src/public-pull-export.js');

let server;
let base;

before(async () => {
  _resetIssuerKey();
  initIssuerKey();
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
  _resetIssuerKey();
});

test('GET /public/export/hemei-treasury → 200 signed JSON envelope (no auth)', async () => {
  const res = await fetch(`${base}/public/export/hemei-treasury`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  const envelope = await res.json();

  assert.equal(envelope.schema, PUBLIC_PULL_EXPORT_SCHEMA);
  assert.equal(envelope.slug, 'hemei-treasury');
  assert.equal(envelope.agent_id, 149);
  assert.equal(envelope.format, 'json');
  assert.equal(envelope.specimen, true);
  assert.equal(envelope.document.schema, 'chit402.book_audit.v1');
  assert.equal(envelope.document.specimen, true);
  assert.ok(envelope.issuer_signature?.jws);
  assert.equal(envelope.issuer_signature.typ, 'chit402-pull-export+jwt');
  assert.ok(envelope.verify_jwks.includes('/.well-known/jwks.json'));

  const jwks = getJwks();
  const verified = verifyPublicPullExport(envelope, jwks);
  assert.equal(verified.valid, true, verified.reason || 'verify failed');

  const expectedDigest = documentDigest(envelope.document, 'json');
  assert.equal(verified.payload.document_sha256, expectedDigest);
});

test('GET /public/export/hemei-treasury?format=csv → signed envelope with CSV document', async () => {
  const res = await fetch(`${base}/public/export/hemei-treasury?format=csv`);
  assert.equal(res.status, 200);
  const envelope = await res.json();

  assert.equal(envelope.format, 'csv');
  assert.equal(envelope.document_media_type, 'text/csv; charset=utf-8');
  assert.match(envelope.document, /task_id,evidence,collected_at/);

  const jwks = getJwks();
  const verified = verifyPublicPullExport(envelope, jwks);
  assert.equal(verified.valid, true, verified.reason || 'verify failed');
});

test('GET unknown pull-export slug → 404', async () => {
  const res = await fetch(`${base}/public/export/not-a-real-slug`);
  assert.equal(res.status, 404);
});
