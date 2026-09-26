/**
 * OpenRouter Broadcast webhook → Chit receipts.
 *
 * Fixtures are FABRICATED OTLP JSON (see test/fixtures/openrouter/). They are
 * not captured customer traces. Prompt and completion strings in the fixture
 * must never appear on a receipt.
 */
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.TASK_STORE_PERSIST = 'false';
process.env.RECEIPT_SIGNING_SECRET = 'test-receipt-secret';
process.env.OPENROUTER_BROADCAST_ENABLED = 'true';
process.env.OPENROUTER_BROADCAST_PILOT_FREE = 'true';
process.env.OPENROUTER_KEY_ENCRYPTION_SECRET = 'test-only-openrouter-key-secret';

const { createApp } = await import('../src/server.js');
const { UsageSettledLedger, entryQualifiesForCap, entryQualifiesForTotals } = await import('../src/usage-settled.js');
const {
  resetOpenRouterBroadcastForTests,
  createOpenRouterBook,
  ingestOpenRouterBroadcast,
  parseOtlpGenerations,
  publicOpenRouterSummary,
  setOpenRouterGenerationClientForTests,
  setOpenRouterVerificationDelayForTests,
  flushOpenRouterVerifications,
  encryptOpenRouterApiKey,
  decryptOpenRouterApiKey,
  configureOpenRouterBroadcast,
} = await import('../src/openrouter-broadcast.js');
const { mergeReceiptView, verifyReceiptEcdsaWithJwks } = await import('../src/receipt.js');
const { getJwks } = await import('../src/issuer-key.js');

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'openrouter', 'broadcast-generation.json');
const FIXTURE = JSON.parse(readFileSync(fixturePath, 'utf8'));
const PROMPT = 'FABRICATED_PROMPT_DO_NOT_STORE';
const COMPLETION = 'FABRICATED_COMPLETION_DO_NOT_STORE';

describe('OpenRouter Broadcast', { concurrency: 1 }, () => {

let server;
let base;

before(async () => {
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  resetOpenRouterBroadcastForTests();
  if (server) await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  resetOpenRouterBroadcastForTests();
  process.env.OPENROUTER_BROADCAST_ENABLED = 'true';
  process.env.OPENROUTER_BROADCAST_PILOT_FREE = 'true';
  delete process.env.OPENROUTER_BROADCAST_DAILY_CAP;
  delete process.env.OPENROUTER_BROADCAST_RATE_PER_MIN;
});

function authHeaders(key, extra = {}) {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${key}`,
    ...extra,
  };
}

async function mintBook(body = {}, key = null) {
  const res = await fetch(`${base}/v1/openrouter/books`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

test('parser keeps generation spans and drops prompt text', () => {
  assert.match(FIXTURE._fixture, /FABRICATED/);
  const generations = parseOtlpGenerations(FIXTURE);
  assert.equal(generations.length, 2);
  assert.equal(generations[0].generationId, 'gen-fixture-fabricated-001');
  assert.equal(generations[0].model, 'google/gemini-2.5-flash');
  assert.equal(generations[0].providerName, 'Google');
  assert.equal(generations[0].providerSlug, 'google');
  assert.equal(generations[0].promptTokens, 120);
  assert.equal(generations[0].completionTokens, 40);
  assert.equal(generations[0].inputCostUsd, '0.00012');
  assert.equal(generations[0].outputCostUsd, '0.00034');
  assert.equal(generations[0].totalCostUsd, '0.00046');
  assert.equal(generations[0].userId, 'user-fixture-1');
  assert.equal(generations[0].sessionId, 'session-fixture-1');
  assert.equal(generations[0].traceMetadata.environment, 'fabricated');
  assert.equal(generations[0].contentDropped, true);
  assert.equal(generations[1].agentId, 'fixture-agent');
  assert.equal(JSON.stringify(generations).includes(PROMPT), false);
  assert.equal(JSON.stringify(generations).includes(COMPLETION), false);
});

test('connection test returns 200 and a missing key is rejected', async () => {
  const created = await mintBook({ label: 'broadcast' });
  assert.equal(created.status, 201);
  assert.equal(created.json.shown_once, true);
  assert.match(created.json.ingest_key, /^chit_or_/);
  assert.match(created.json.webhook.url, /\/v1\/openrouter\/broadcast$/);

  const anon = await fetch(`${base}/v1/openrouter/broadcast`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-connection': 'true' },
    body: '{}',
  });
  assert.equal(anon.status, 401);

  const testRes = await fetch(`${base}/v1/openrouter/broadcast`, {
    method: 'POST',
    headers: authHeaders(created.json.ingest_key, { 'x-test-connection': 'true' }),
    body: '{}',
  });
  assert.equal(testRes.status, 200);
  const testBody = await testRes.json();
  assert.equal(testBody.ok, true);
  assert.equal(testBody.test, true);

  const custom = await fetch(`${base}/v1/openrouter/broadcast`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-chit-ingest-key': created.json.ingest_key,
      'x-test-connection': 'true',
    },
    body: '{}',
  });
  assert.equal(custom.status, 200);
});

test('fixture stamps reported receipts, drops content, and replays on generation id', async () => {
  const parent = await mintBook({ label: 'parent' });
  const child = await mintBook({ agent_id: 'fixture-agent', label: 'agent' }, parent.json.ingest_key);
  assert.equal(child.status, 201);
  assert.equal(child.json.family_id, parent.json.family_id);
  assert.notEqual(child.json.ingest_key, parent.json.ingest_key);

  const posted = await fetch(`${base}/v1/openrouter/broadcast`, {
    method: 'POST',
    headers: authHeaders(parent.json.ingest_key),
    body: JSON.stringify(FIXTURE),
  });
  assert.equal(posted.status, 200);
  const body = await posted.json();
  assert.equal(body.stamped, 2);
  assert.equal(body.replayed, 0);
  assert.equal(body.skipped, 1);
  assert.equal(body.capped, 0);
  assert.equal(body.stamp_charged, false);
  assert.equal(body.stamp_fee_usd, '0.002');
  assert.equal(body.pilot_free, true);
  assert.equal(JSON.stringify(body).includes(PROMPT), false);
  assert.equal(JSON.stringify(body).includes(COMPLETION), false);

  const again = await fetch(`${base}/v1/openrouter/broadcast`, {
    method: 'POST',
    headers: authHeaders(parent.json.ingest_key),
    body: JSON.stringify(FIXTURE),
  });
  const replay = await again.json();
  assert.equal(replay.stamped, 0);
  assert.equal(replay.replayed, 2);
  assert.equal(replay.receipts[0].verify_url, body.receipts[0].verify_url);

  const parentList = await fetch(`${base}/v1/openrouter/books/${parent.json.book_id}/receipts`, {
    headers: { authorization: `Bearer ${parent.json.ingest_key}` },
  });
  assert.equal(parentList.status, 200);
  const parentRows = await parentList.json();
  assert.equal(parentRows.receipts.length, 1);
  const receipt = parentRows.receipts[0];
  const view = mergeReceiptView(receipt);
  assert.equal(view.payment.rail, 'reported');
  assert.equal(view.payment.collected, false);
  assert.equal(view.payment.ref, `openrouter:${parent.json.family_id}:gen-fixture-fabricated-001`);
  assert.equal(view.payment.asset, 'USD');
  assert.equal(view.settlement.kind, 'reported');
  assert.equal(view.settlement.attested_by, 'book_holder_report');
  assert.equal(receipt.attestation_note.includes('did not verify this payload with OpenRouter'), true);
  assert.equal(receipt.task_id.includes('gen-fixture'), false);
  assert.match(receipt.task_id, /^openrouter-[0-9a-f]{32}$/);
  assert.equal(view.kind, 'openrouter_broadcast');
  assert.equal(view.route.model, 'google/gemini-2.5-flash');
  assert.equal(view.route.model, receipt.reported.model);
  assert.equal(view.route.requested_model ?? null, null);
  assert.notEqual(view.route.substituted, true);
  assert.equal(receipt.route_meta?.substituted ?? null, null);
  assert.equal(view.fulfillment.intent.job_kind, 'openrouter_broadcast');
  assert.equal(receipt.source, 'openrouter_broadcast');
  assert.equal(receipt.stamp.fee_usd, '0.002');
  assert.equal(receipt.stamp.charged, false);
  assert.equal(receipt.stamp.waived, true);
  assert.equal(receipt.reported.generation_id, 'gen-fixture-fabricated-001');
  assert.equal(receipt.reported.total_cost_usd, '0.00046');
  assert.equal(receipt.reported.user_id, 'user-fixture-1');
  assert.equal(receipt.reported.session_id, 'session-fixture-1');
  assert.equal(receipt.reported.trace_metadata.environment, 'fabricated');
  assert.equal(receipt.reported.content_dropped, true);
  assert.equal(receipt.usage.prompt_tokens, 120);
  assert.equal(receipt.usage.completion_tokens, 40);
  assert.match(receipt.verify_url, /\/receipt\/openrouter-[0-9a-f]{32}$/);
  assert.equal(receipt.verify_url.includes('gen-fixture'), false);
  const packed = JSON.stringify(parentRows);
  assert.equal(packed.includes(PROMPT), false);
  assert.equal(packed.includes(COMPLETION), false);

  const jwks = getJwks();
  const verified = verifyReceiptEcdsaWithJwks(receipt, jwks);
  assert.equal(verified.valid, true);

  const childList = await fetch(`${base}/v1/openrouter/books/${child.json.book_id}/receipts`, {
    headers: { 'x-chit-ingest-key': child.json.ingest_key },
  });
  const childRows = await childList.json();
  assert.equal(childRows.receipts.length, 1);
  assert.equal(childRows.receipts[0].reported.generation_id, 'gen-fixture-fabricated-002');
  assert.equal(childRows.receipts[0].reported.agent_id, 'fixture-agent');
  assert.equal(childRows.receipts[0].reported.routed_by, 'agent_id');

  const locked = await fetch(`${base}/v1/openrouter/books/${parent.json.book_id}/receipts`);
  assert.equal(locked.status, 401);

  const summary = await fetch(`${base}/v1/openrouter/books/${parent.json.book_id}/summary`);
  assert.equal(summary.status, 200);
  const summaryBody = await summary.json();
  assert.equal(summaryBody.generations, 0);
  assert.equal(summaryBody.reported_usd, '0');
  assert.equal(summaryBody.stamp_charged, false);
  assert.equal(summaryBody.collected, false);
  assert.equal(summaryBody.verified, false);
  assert.equal(summaryBody.verified_with, null);
  assert.equal(summaryBody.stamp_fee_usd_recorded, '0');
  assert.equal(summaryBody.public, true);
  const summaryText = JSON.stringify(summaryBody);
  assert.equal(summaryText.includes('gen-fixture'), false);
  assert.equal(summaryText.includes(PROMPT), false);
  assert.equal(summaryText.includes('user-fixture'), false);

  const verify = await fetch(receipt.verify_url.replace(/^https?:\/\/[^/]+/, base), {
    headers: { accept: 'application/json' },
  });
  assert.equal(verify.status, 200);
  const verifyBody = await verify.json();
  assert.equal(verifyBody.task_id, receipt.task_id);
  assert.equal(JSON.stringify(verifyBody).includes(PROMPT), false);
  const html = await fetch(receipt.verify_url.replace(/^https?:\/\/[^/]+/, base));
  const page = await html.text();
  assert.match(page, /Reported via OpenRouter Broadcast \(unverified\)/);
  assert.match(page, /Chit did not verify this payload with OpenRouter/);
  assert.equal(page.includes('Attested by'), false);
  assert.equal(page.includes('OpenRouter report'), false);
  assert.match(page, /REPORTED/);
  assert.equal(page.includes(PROMPT), false);
  assert.equal(page.includes(COMPLETION), false);
  assert.equal(page.includes('Foreign ingest'), false);
});

test('the same generation id on another family is a new receipt, and the id is not guessable', async () => {
  const a = await mintBook();
  const b = await mintBook();
  const one = structuredClone(FIXTURE);
  one.resourceSpans[0].scopeSpans[0].spans = [one.resourceSpans[0].scopeSpans[0].spans[0]];

  const post = (key) => fetch(`${base}/v1/openrouter/broadcast`, {
    method: 'POST',
    headers: authHeaders(key),
    body: JSON.stringify(one),
  });

  const first = await (await post(a.json.ingest_key)).json();
  const second = await (await post(b.json.ingest_key)).json();
  assert.equal(first.stamped, 1);
  assert.equal(first.replayed, 0);
  assert.equal(second.stamped, 1);
  assert.equal(second.replayed, 0);
  assert.notEqual(first.receipts[0].book_id, second.receipts[0].book_id);
  assert.notEqual(first.receipts[0].task_id, second.receipts[0].task_id);
  assert.notEqual(first.receipts[0].verify_url, second.receipts[0].verify_url);
  for (const row of [first.receipts[0], second.receipts[0]]) {
    assert.equal(row.task_id.includes('gen-fixture-fabricated-001'), false);
    assert.match(row.task_id, /^openrouter-[0-9a-f]{32}$/);
  }

  const replay = await (await post(a.json.ingest_key)).json();
  assert.equal(replay.stamped, 0);
  assert.equal(replay.replayed, 1);
  assert.equal(replay.receipts[0].verify_url, first.receipts[0].verify_url);
  assert.equal(replay.receipts[0].book_id, a.json.book_id);

  const sibling = await mintBook({ label: 'sibling' }, a.json.ingest_key);
  assert.equal(sibling.json.family_id, a.json.family_id);
  const sib = await (await post(sibling.json.ingest_key)).json();
  assert.equal(sib.stamped, 0);
  assert.equal(sib.replayed, 1);
  assert.equal(sib.receipts[0].verify_url, first.receipts[0].verify_url);

  const guessed = await fetch(`${base}/receipt/openrouter-gen-fixture-fabricated-001`, {
    headers: { accept: 'application/json' },
  });
  assert.notEqual(guessed.status, 200);
  const guessedBody = await guessed.json();
  const guessedText = JSON.stringify(guessedBody);
  assert.equal(guessedText.includes(first.receipts[0].task_id), false);
  assert.equal(guessedText.includes(second.receipts[0].task_id), false);
  assert.equal(guessedText.includes('gemini'), false);
  assert.equal(guessedText.includes(PROMPT), false);
});

test('chit_book tag routes within the family and a foreign book id does not', async () => {
  const parent = await mintBook();
  const child = await mintBook({ label: 'tagged' }, parent.json.ingest_key);
  const payload = structuredClone(FIXTURE);
  payload.resourceSpans[0].scopeSpans[0].spans[0].attributes.push({
    key: 'trace.metadata.chit_book',
    value: { stringValue: child.json.book_id },
  });
  payload.resourceSpans[0].scopeSpans[0].spans[2].attributes =
    payload.resourceSpans[0].scopeSpans[0].spans[2].attributes.filter((attr) => attr.key !== 'trace.metadata.agent_id');

  const posted = await fetch(`${base}/v1/openrouter/broadcast`, {
    method: 'POST',
    headers: authHeaders(parent.json.ingest_key),
    body: JSON.stringify(payload),
  });
  const body = await posted.json();
  assert.equal(body.stamped, 2);
  const first = body.receipts.find((row) => row.generation_id === 'gen-fixture-fabricated-001');
  const second = body.receipts.find((row) => row.generation_id === 'gen-fixture-fabricated-002');
  assert.equal(first.book_id, child.json.book_id);
  assert.equal(second.book_id, parent.json.book_id);

  const outsider = structuredClone(FIXTURE);
  const only = outsider.resourceSpans[0].scopeSpans[0].spans[0];
  only.attributes = only.attributes.map((attr) => (
    attr.key === 'gen_ai.response.id'
      ? { key: attr.key, value: { stringValue: 'gen-fixture-outsider' } }
      : attr
  ));
  only.attributes.push({
    key: 'trace.metadata.chit_book',
    value: { stringValue: 'orb_not_in_this_family' },
  });
  outsider.resourceSpans[0].scopeSpans[0].spans = [only];
  const missed = await fetch(`${base}/v1/openrouter/broadcast`, {
    method: 'POST',
    headers: authHeaders(parent.json.ingest_key),
    body: JSON.stringify(outsider),
  });
  const missedBody = await missed.json();
  assert.equal(missedBody.stamped, 1);
  assert.equal(missedBody.receipts[0].book_id, parent.json.book_id);
});

test('daily cap stops new generations and still replays the one already stamped', async () => {
  process.env.OPENROUTER_BROADCAST_DAILY_CAP = '1';
  const created = await mintBook();
  const posted = await fetch(`${base}/v1/openrouter/broadcast`, {
    method: 'POST',
    headers: authHeaders(created.json.ingest_key),
    body: JSON.stringify(FIXTURE),
  });
  const body = await posted.json();
  assert.equal(posted.status, 200);
  assert.equal(body.stamped, 1);
  assert.equal(body.capped, 1);
  assert.equal(body.capped_generation_ids.length, 1);

  const replay = await fetch(`${base}/v1/openrouter/broadcast`, {
    method: 'POST',
    headers: authHeaders(created.json.ingest_key),
    body: JSON.stringify(FIXTURE),
  });
  const again = await replay.json();
  assert.equal(again.replayed, 1);
  assert.equal(again.stamped, 0);
  assert.equal(again.capped, 1);
});

test('rate limit applies per key', async () => {
  process.env.OPENROUTER_BROADCAST_RATE_PER_MIN = '2';
  const created = await mintBook();
  const send = () => fetch(`${base}/v1/openrouter/broadcast`, {
    method: 'POST',
    headers: authHeaders(created.json.ingest_key, { 'x-test-connection': 'true' }),
    body: '{}',
  });
  assert.equal((await send()).status, 200);
  assert.equal((await send()).status, 200);
  const limited = await send();
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get('retry-after'));
});

test('feature flag hides the routes', async () => {
  process.env.OPENROUTER_BROADCAST_ENABLED = 'false';
  const created = await mintBook();
  assert.equal(created.status, 404);
  const posted = await fetch(`${base}/v1/openrouter/broadcast`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(posted.status, 404);
});

test('pilot off still records the fee and does not charge', async () => {
  process.env.OPENROUTER_BROADCAST_PILOT_FREE = 'false';
  const created = await mintBook();
  const one = structuredClone(FIXTURE);
  one.resourceSpans[0].scopeSpans[0].spans = [one.resourceSpans[0].scopeSpans[0].spans[0]];
  const posted = await fetch(`${base}/v1/openrouter/broadcast`, {
    method: 'POST',
    headers: authHeaders(created.json.ingest_key),
    body: JSON.stringify(one),
  });
  const body = await posted.json();
  assert.equal(body.pilot_free, false);
  assert.equal(body.stamp_charged, false);
  const list = await fetch(`${base}/v1/openrouter/books/${created.json.book_id}/receipts`, {
    headers: { authorization: `Bearer ${created.json.ingest_key}` },
  });
  const rows = await list.json();
  assert.equal(rows.receipts[0].stamp.charged, false);
  assert.equal(rows.receipts[0].stamp.waived, false);
  assert.equal(rows.receipts[0].stamp.charge_status, 'unbilled');
  assert.equal(rows.receipts[0].stamp.fee_usd, '0.002');
});

test('a bound numeric agent sees the row and the USDC spent total stays put', () => {
  resetOpenRouterBroadcastForTests();
  const ledger = new UsageSettledLedger();
  const registry = { get(id) { return Number(id) === 7 ? { agent_id: 7 } : null; } };
  const created = createOpenRouterBook({ agent_id: '7' });
  assert.equal(created.ok, true);
  const one = structuredClone(FIXTURE);
  one.resourceSpans[0].scopeSpans[0].spans = [one.resourceSpans[0].scopeSpans[0].spans[0]];
  const result = ingestOpenRouterBroadcast(one, {
    book: created.book,
    ledger,
    registry,
    baseUrl: 'https://api.chit402.com',
    signingSecret: 'test-receipt-secret',
  });
  assert.equal(result.body.stamped, 1);
  const rows = ledger.listByAgent(7);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].evidence, 'openrouter_reported');
  assert.equal(rows[0].rail, 'reported');
  assert.equal(rows[0].collected, false);
  assert.equal(entryQualifiesForCap(rows[0]), false);
  assert.equal(entryQualifiesForTotals(rows[0]), false);
  assert.equal(ledger.sumCollectedByAgent(7), 0n);
  assert.equal(ledger.sumCollectedByAgentToday(7), 0n);

  const other = createOpenRouterBook({ agent_id: '8' });
  const registryBoth = {
    get(id) {
      const n = Number(id);
      return n === 7 || n === 8 ? { agent_id: n } : null;
    },
  };
  const again = ingestOpenRouterBroadcast(one, {
    book: other.book,
    ledger,
    registry: registryBoth,
    baseUrl: 'https://api.chit402.com',
    signingSecret: 'test-receipt-secret',
  });
  assert.equal(again.body.stamped, 1);
  assert.notEqual(again.body.receipts[0].task_id, result.body.receipts[0].task_id);
  assert.equal(ledger.listByAgent(8).length, 1);
  assert.equal(ledger.listByAgent(8)[0].collected, false);
  assert.equal(ledger.sumCollectedByAgent(8), 0n);

  const summary = publicOpenRouterSummary(created.book);
  assert.equal(summary.generations, 0);
  assert.equal(summary.collected, false);
  assert.equal(summary.verified, false);
  assert.equal(summary.verified_with, null);
  assert.equal(JSON.stringify(summary).includes(PROMPT), false);
  assert.equal(JSON.stringify(summary).includes('gen-fixture'), false);
});

const OR_KEY = 'sk-or-v1-fixture-redact-aaa';
const OR_KEY_ROTATED = 'sk-or-v1-fixture-redact-bbb';

function oneGeneration(id = 'gen-fixture-fabricated-001') {
  const payload = structuredClone(FIXTURE);
  const span = payload.resourceSpans[0].scopeSpans[0].spans[0];
  span.attributes = span.attributes.map((attr) => (
    attr.key === 'gen_ai.response.id'
      ? { key: attr.key, value: { stringValue: id } }
      : attr
  ));
  payload.resourceSpans[0].scopeSpans[0].spans = [span];
  return payload;
}

function generationBody(over = {}) {
  return {
    data: {
      id: 'gen-fixture-fabricated-001',
      model: 'google/gemini-2.5-flash',
      native_tokens_prompt: 120,
      native_tokens_completion: 40,
      total_cost: 0.00046,
      ...over,
    },
  };
}

async function attachKey(bookId, ingestKey, apiKey) {
  const res = await fetch(`${base}/v1/openrouter/books/${bookId}/openrouter-key`, {
    method: 'PUT',
    headers: authHeaders(ingestKey),
    body: JSON.stringify({ api_key: apiKey }),
  });
  const json = await res.json();
  return { status: res.status, json };
}

test('an OpenRouter key is encrypted at rest and never returned', async () => {
  const enc = encryptOpenRouterApiKey(OR_KEY);
  assert.equal(enc.ok, true);
  assert.equal(enc.enc.includes(OR_KEY), false);
  assert.equal(decryptOpenRouterApiKey(enc.enc), OR_KEY);

  const dir = mkdtempSync(join(tmpdir(), 'or-key-'));
  try {
    configureOpenRouterBroadcast({ dir, persist: true });
    const created = await mintBook();
    const put = await attachKey(created.json.book_id, created.json.ingest_key, OR_KEY);
    assert.equal(put.status, 200);
    assert.equal(put.json.openrouter_key_attached, true);
    assert.equal(JSON.stringify(put.json).includes(OR_KEY), false);

    const storedPath = join(dir, 'openrouter-books.json');
    const stored = readFileSync(storedPath, 'utf8');
    assert.equal(stored.includes(OR_KEY), false);
    assert.match(stored, /openrouter_key_enc/);
    if (process.platform !== 'win32') {
      assert.equal(statSync(storedPath).mode & 0o777, 0o600);
      assert.equal(statSync(dir).mode & 0o777, 0o700);
    }

    const status = await fetch(`${base}/v1/openrouter/books/${created.json.book_id}/openrouter-key`, {
      headers: { authorization: `Bearer ${created.json.ingest_key}` },
    });
    const statusBody = await status.json();
    assert.equal(statusBody.openrouter_key_attached, true);
    assert.equal(JSON.stringify(statusBody).includes(OR_KEY), false);

    const removed = await fetch(`${base}/v1/openrouter/books/${created.json.book_id}/openrouter-key`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${created.json.ingest_key}` },
    });
    const removedBody = await removed.json();
    assert.equal(removed.status, 200);
    assert.equal(removedBody.openrouter_key_attached, false);
    const after = readFileSync(join(dir, 'openrouter-books.json'), 'utf8');
    assert.equal(after.includes('openrouter_key_enc'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a matching generation is verified with OpenRouter and counted in the public summary', async () => {
  const seen = [];
  setOpenRouterVerificationDelayForTests(async () => {});
  setOpenRouterGenerationClientForTests(async (id, apiKey) => {
    seen.push({ id, apiKey });
    return { status: 200, body: generationBody({ id }) };
  });
  const created = await mintBook();
  await attachKey(created.json.book_id, created.json.ingest_key, OR_KEY);
  const posted = await fetch(`${base}/v1/openrouter/broadcast`, {
    method: 'POST',
    headers: authHeaders(created.json.ingest_key),
    body: JSON.stringify(oneGeneration()),
  });
  assert.equal(posted.status, 200);
  await flushOpenRouterVerifications();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].apiKey, OR_KEY);

  const list = await fetch(`${base}/v1/openrouter/books/${created.json.book_id}/receipts`, {
    headers: authHeaders(created.json.ingest_key),
  });
  const rows = await list.json();
  const receipt = rows.receipts[0];
  assert.equal(receipt.verified_with, 'openrouter_generation_api');
  assert.equal(receipt.verification.status, 'verified');
  assert.equal(receipt.attestation_note, "Chit checked this generation against OpenRouter's own record. Chit did not settle the payment.");
  assert.equal(JSON.stringify(rows).includes(OR_KEY), false);
  const page = await (await fetch(receipt.verify_url.replace(/^https?:\/\/[^/]+/, base))).text();
  assert.match(page, /Verified with OpenRouter/);
  assert.match(page, /Chit checked this generation against OpenRouter/);
  assert.equal(page.includes(OR_KEY), false);

  const summary = await (await fetch(`${base}/v1/openrouter/books/${created.json.book_id}/summary`)).json();
  assert.equal(summary.generations, 1);
  assert.equal(summary.reported_usd, '0.00046');
  assert.equal(summary.verified, true);
  assert.equal(summary.verified_with, 'openrouter_generation_api');
  assert.equal(summary.collected, false);
});

test('a generation that disagrees with OpenRouter is a mismatch and is not counted', async () => {
  setOpenRouterVerificationDelayForTests(async () => {});
  setOpenRouterGenerationClientForTests(async () => ({
    status: 200,
    body: generationBody({ total_cost: 1.25, native_tokens_prompt: 999 }),
  }));
  const created = await mintBook();
  await attachKey(created.json.book_id, created.json.ingest_key, OR_KEY);
  await fetch(`${base}/v1/openrouter/broadcast`, {
    method: 'POST',
    headers: authHeaders(created.json.ingest_key),
    body: JSON.stringify(oneGeneration('gen-fixture-mismatch')),
  });
  await flushOpenRouterVerifications();
  const list = await (await fetch(`${base}/v1/openrouter/books/${created.json.book_id}/receipts`, {
    headers: authHeaders(created.json.ingest_key),
  })).json();
  const receipt = list.receipts[0];
  assert.equal(receipt.verified_with, null);
  assert.equal(receipt.verification.status, 'mismatch');
  assert.ok(receipt.verification.fields.includes('total_cost'));
  assert.ok(receipt.verification.fields.includes('native_tokens_prompt'));
  assert.equal(receipt.verification.fields.includes('model'), false);
  const page = await (await fetch(receipt.verify_url.replace(/^https?:\/\/[^/]+/, base))).text();
  assert.match(page, /mismatch/);
  assert.match(page, /Reported via OpenRouter Broadcast \(unverified\)/);
  assert.equal(page.includes('Verified with OpenRouter'), false);
  const summary = await (await fetch(`${base}/v1/openrouter/books/${created.json.book_id}/summary`)).json();
  assert.equal(summary.generations, 0);
  assert.equal(summary.verified, false);
});

test('a lagged generation record is retried and then verified', async () => {
  let calls = 0;
  setOpenRouterVerificationDelayForTests(async () => {});
  setOpenRouterGenerationClientForTests(async (id) => {
    calls += 1;
    if (calls === 1) return { status: 404, body: { error: { message: 'not found yet' } } };
    return { status: 200, body: generationBody({ id }) };
  });
  const created = await mintBook();
  await attachKey(created.json.book_id, created.json.ingest_key, OR_KEY);
  await fetch(`${base}/v1/openrouter/broadcast`, {
    method: 'POST',
    headers: authHeaders(created.json.ingest_key),
    body: JSON.stringify(oneGeneration()),
  });
  await flushOpenRouterVerifications();
  assert.equal(calls, 2);
  const list = await (await fetch(`${base}/v1/openrouter/books/${created.json.book_id}/receipts`, {
    headers: authHeaders(created.json.ingest_key),
  })).json();
  assert.equal(list.receipts[0].verified_with, 'openrouter_generation_api');
  assert.equal(JSON.stringify(list).includes(OR_KEY), false);
});

test('with no OpenRouter key the receipt stays unverified and no lookup runs', async () => {
  let calls = 0;
  setOpenRouterGenerationClientForTests(async () => {
    calls += 1;
    return { status: 200, body: generationBody() };
  });
  const created = await mintBook();
  await fetch(`${base}/v1/openrouter/broadcast`, {
    method: 'POST',
    headers: authHeaders(created.json.ingest_key),
    body: JSON.stringify(oneGeneration()),
  });
  await flushOpenRouterVerifications();
  assert.equal(calls, 0);
  const list = await (await fetch(`${base}/v1/openrouter/books/${created.json.book_id}/receipts`, {
    headers: authHeaders(created.json.ingest_key),
  })).json();
  const receipt = list.receipts[0];
  assert.equal(receipt.verified_with, null);
  assert.equal(receipt.verification.status, 'unverified');
  assert.equal(receipt.verification.reason, 'no_openrouter_key');
  const page = await (await fetch(receipt.verify_url.replace(/^https?:\/\/[^/]+/, base))).text();
  assert.match(page, /Reported via OpenRouter Broadcast \(unverified\)/);
  assert.equal(page.includes('Verified with OpenRouter'), false);
  const summary = await (await fetch(`${base}/v1/openrouter/books/${created.json.book_id}/summary`)).json();
  assert.equal(summary.generations, 0);

  const rotated = await attachKey(created.json.book_id, created.json.ingest_key, OR_KEY_ROTATED);
  assert.equal(rotated.json.openrouter_key_attached, true);
  assert.equal(JSON.stringify(rotated.json).includes(OR_KEY_ROTATED), false);
  let used = null;
  setOpenRouterVerificationDelayForTests(async () => {});
  setOpenRouterGenerationClientForTests(async (id, apiKey) => {
    used = apiKey;
    return { status: 200, body: generationBody({ id }) };
  });
  await fetch(`${base}/v1/openrouter/broadcast`, {
    method: 'POST',
    headers: authHeaders(created.json.ingest_key),
    body: JSON.stringify(oneGeneration('gen-fixture-after-rotate')),
  });
  await flushOpenRouterVerifications();
  assert.equal(used, OR_KEY_ROTATED);
});
});
