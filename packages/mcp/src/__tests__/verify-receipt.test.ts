import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { XFuelClient } from 'xfuel-sdk';
import type { McpConfig } from '../config.js';
import { receiptTarget, runVerifyReceipt, ISSUER_RECEIPT_HOSTS } from '../verify-receipt.js';

const here = dirname(fileURLToPath(import.meta.url));
const verifyFixtures = join(here, '../../../verify/test/fixtures');
const ID = 'chit-4d6e8331-c30f-400d-a76e-fcce0cfde209';
const CANONICAL = `https://api.chit402.com/receipt/${ID}`;

const config: McpConfig = {
  apiUrl: 'https://api.chit402.com',
  apiKey: '',
  transport: 'stdio',
  port: 3033,
};
const client = {} as XFuelClient;

type Call = { url: string; redirect: RequestRedirect | undefined };

async function withFetch<T>(
  handler: (url: string, init: RequestInit | undefined) => Promise<Response>,
  fn: (calls: Call[]) => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, redirect: init?.redirect });
    return handler(url, init);
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

test('issuer hosts are the canonical gateway and its alias', () => {
  assert.deepEqual([...ISSUER_RECEIPT_HOSTS], ['api.chit402.com', 'api.xfuel.app']);
});

test('issuer receipt URLs resolve to the canonical issuer URL', () => {
  for (const raw of [
    CANONICAL,
    `${CANONICAL}?format=json`,
    `${CANONICAL}.json`,
    `${CANONICAL}/`,
    `https://API.CHIT402.COM/receipt/${ID}`,
    `https://api.xfuel.app/receipt/${ID}`,
    `https://api.chit402.com:443/receipt/${ID}`,
  ]) {
    const target = receiptTarget({ verify_url: raw });
    assert.equal(target.ok, true, raw);
    if (target.ok) assert.equal(target.url, CANONICAL, raw);
  }
  const byId = receiptTarget({ task_id: ID });
  assert.equal(byId.ok && byId.url, CANONICAL);
});

test('every other verify_url is refused before any request', async () => {
  const refused = [
    `http://api.chit402.com/receipt/${ID}`,
    `https://evil.example/receipt/${ID}`,
    `https://api.chit402.com.evil.example/receipt/${ID}`,
    `https://evilapi.chit402.com/receipt/${ID}`,
    `https://api.chit402.com./receipt/${ID}`,
    `https://api.chit402.com@evil.example/receipt/${ID}`,
    `https://user:pass@api.chit402.com/receipt/${ID}`,
    `https://user@api.chit402.com/receipt/${ID}`,
    `https://evil.example/?next=https://api.chit402.com/receipt/${ID}`,
    `https://evil.example/#https://api.chit402.com/receipt/${ID}`,
    `https://127.0.0.1/receipt/${ID}`,
    `https://[::1]/receipt/${ID}`,
    `https://3.4.5.6/receipt/${ID}`,
    `https://0x7f000001/receipt/${ID}`,
    `https://2130706433/receipt/${ID}`,
    `https://localhost/receipt/${ID}`,
    `https://api.chit402.com:8443/receipt/${ID}`,
    `https://api.chit402.com/v1/board/posts/1`,
    `https://api.chit402.com/receipt/../v1/admin`,
    `https://api.chit402.com/receipt/a%2F..%2Fadmin`,
    `https://api.chit402.com/receipt/${ID}/inclusion`,
    `https://api.chit402.com/receipt/`,
    'ftp://api.chit402.com/receipt/x',
    'file:///etc/passwd',
    'data:application/json,{}',
    'javascript:alert(1)',
    'not a url',
  ];
  await withFetch(async () => {
    throw new Error('no request expected');
  }, async (calls) => {
    for (const raw of refused) {
      assert.equal(receiptTarget({ verify_url: raw }).ok, false, raw);
      const res = await runVerifyReceipt(client, config, { verify_url: raw });
      assert.equal(res.isError, true, raw);
    }
    for (const id of ['../admin', 'a/b', 'a?b', 'a#b', '', ' chit-1', 'chit-1.json', 'x'.repeat(129)]) {
      const res = await runVerifyReceipt(client, config, { task_id: id });
      assert.equal(res.isError, true, JSON.stringify(id));
    }
    assert.equal(calls.length, 0);
  });
});

test('the receipt is fetched from the canonical host with redirects refused', async () => {
  await withFetch(async (url, init) => {
    // A redirect to another host: fetch with redirect "error" rejects.
    if (init?.redirect === 'error') throw new TypeError('fetch failed: redirect');
    return Response.redirect('https://evil.example/receipt.json', 302);
  }, async (calls) => {
    const res = await runVerifyReceipt(client, config, { verify_url: `https://api.xfuel.app/receipt/${ID}` });
    assert.equal(res.isError, undefined);
    const body = res.structuredContent as Record<string, unknown>;
    assert.equal(body.result, 'COULD_NOT_CHECK');
    assert.equal(body.exit_code, 2);
    assert.equal(body.reason, 'receipt_unavailable');
    assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0].url).origin, 'https://api.chit402.com');
    assert.equal(calls[0].redirect, 'error');
    assert.equal(calls.some((c) => c.url.includes('evil.example')), false);
  });
});

test('an unsigned document is COULD_NOT_CHECK, never a verified boolean', async () => {
  const doc = readFileSync(join(verifyFixtures, 'unsigned-self-binding.json'), 'utf8');
  await withFetch(async (url) => {
    if (new URL(url).hostname === 'api.chit402.com' && url.includes('/receipt/')) {
      return new Response(doc, { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  }, async (calls) => {
    const res = await runVerifyReceipt(client, config, { task_id: 'task-forged-0001' });
    assert.equal(res.isError, undefined);
    const body = res.structuredContent as Record<string, unknown>;
    assert.equal(body.result, 'COULD_NOT_CHECK');
    assert.equal(body.exit_code, 2);
    assert.equal(body.reason, 'signed_receipt_unavailable');
    assert.equal('overall' in body, false);
    assert.equal('verified' in body, false);
    assert.equal('receipt' in body, false);
    assert.match(res.content[0].text, /COULD_NOT_CHECK \(exit 2\)/);
    for (const call of calls) assert.equal(new URL(call.url).hostname, 'api.chit402.com');
  });
});

test('a receipt signature over another document type is INVALID', async () => {
  const doc = readFileSync(join(verifyFixtures, 'slot-typing/head-jws-receipt.json'), 'utf8');
  const parsed = JSON.parse(doc) as { task_id: string };
  await withFetch(async (url) => {
    if (new URL(url).hostname !== 'api.chit402.com') throw new Error(`unexpected host ${url}`);
    if (url.includes(`/receipt/${parsed.task_id}`)) {
      return new Response(doc, { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  }, async () => {
    const res = await runVerifyReceipt(client, config, { task_id: parsed.task_id });
    const body = res.structuredContent as Record<string, unknown>;
    assert.equal(body.result, 'INVALID');
    assert.equal(body.exit_code, 1);
    assert.equal(typeof body.reason, 'string');
  });
});
