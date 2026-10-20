/**
 * Stranger recompute of coverage.universe_hash from a local public pull-export.
 *
 * Independent implementation (node:crypto only) of the rule documented in
 * docs/product/export-coverage.md. Runs against a local test server; no network.
 */
import crypto from 'node:crypto';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'false';

const { createApp } = await import('../src/server.js');
const { resetHubCatalogCache } = await import('../src/hub-catalog.js');
const { initAIListener } = await import('../src/ai-listener.js');
const { _resetIssuerKey, initIssuerKey } = await import('../src/issuer-key.js');

let server;
let base;

before(async () => {
  _resetIssuerKey();
  initIssuerKey();
  resetHubCatalogCache();
  await initAIListener();
  const app = await createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
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

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const str = (v) => (v == null ? '' : String(v));

/** Documented rule: sort by `collected_at` + TAB + `task_id` (code-unit order), commit, join with LF. */
function strangerUniverseHash(rows) {
  const sorted = [...rows].sort((a, b) => {
    const ka = `${str(a.collected_at)}\t${str(a.task_id)}`;
    const kb = `${str(b.collected_at)}\t${str(b.task_id)}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  const commitments = sorted.map((r) => sha256(
    [r.task_id, r.evidence, r.amount, r.payment_ref, r.collected_at].map(str).join('|'),
  ));
  return sha256(commitments.join('\n'));
}

function parseCsv(text) {
  const lines = text.split('\n').filter((l) => l && !l.startsWith('#'));
  const split = (line) => {
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 1; } else if (c === '"') q = false; else cur += c;
      } else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur);
    return out;
  };
  const header = split(lines[0]);
  return lines.slice(1).filter((l) => l.trim()).map((l) => {
    const cols = split(l);
    return Object.fromEntries(header.map((h, i) => [h, cols[i] ?? '']));
  });
}

test('universe_hash recomputes from the JSON pull-export rows', async () => {
  const env = await (await fetch(`${base}/public/export/hemei-treasury`)).json();
  const rows = env.document.rows;
  assert.ok(rows.length > 0);
  assert.equal(env.coverage.complete, true);
  assert.equal(env.coverage.order, 'collected_at,task_id');
  assert.equal(strangerUniverseHash(rows), env.coverage.universe_hash);
  assert.equal(strangerUniverseHash(rows), env.coverage.enumerated_hash);
});

test('universe_hash recomputes from the CSV pull-export rows', async () => {
  const env = await (await fetch(`${base}/public/export/hemei-treasury?format=csv`)).json();
  const rows = parseCsv(env.document);
  assert.ok(rows.length > 0);
  assert.equal(strangerUniverseHash(rows), env.coverage.universe_hash);
});

test('empty set is SHA-256 of the empty string; no trailing newline', () => {
  assert.equal(strangerUniverseHash([]), sha256(''));
  const one = [{ task_id: 't', evidence: 'e', amount: '1', payment_ref: null, collected_at: 'x' }];
  assert.equal(strangerUniverseHash(one), sha256(sha256('t|e|1||x')));
});
