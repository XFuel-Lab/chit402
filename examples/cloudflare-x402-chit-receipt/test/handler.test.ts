import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeSettlement, handleProxy, type Env, type PayResult } from '../src/index.js';

const fixture = JSON.parse(readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'paid-call.json'),
  'utf8',
));

const UPSTREAM = 'https://seller.example';
const CHIT = 'https://api.chit402.com';

function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

function challenge(amount = fixture.amount) {
  return {
    x402Version: 2,
    resource: { url: fixture.resource, description: 'pdf', mimeType: 'application/json' },
    accepts: [{
      scheme: 'exact',
      network: fixture.network,
      amount: String(amount),
      asset: fixture.asset,
      payTo: fixture.payTo,
      maxTimeoutSeconds: 60,
      extra: { name: 'USD Coin', version: '2' },
    }],
  };
}

function settlement() {
  return {
    success: true,
    transaction: fixture.transaction,
    network: fixture.network,
    payer: fixture.payer,
  };
}

function stampChallenge() {
  return {
    x402Version: 2,
    accepts: [{
      scheme: 'exact',
      network: 'eip155:8453',
      amount: fixture.stampAmount,
      asset: fixture.asset,
      payTo: fixture.stampPayTo,
      maxTimeoutSeconds: 60,
      extra: { name: 'USD Coin', version: '2' },
    }],
  };
}

function env(overrides: Partial<Env> = {}): Env {
  return {
    UPSTREAM_ORIGIN: UPSTREAM,
    CHIT_API_URL: CHIT,
    CHIT_AGENT_ID: '7',
    CHIT_BOOK_SESSION: 'sess-fixture',
    MAX_ATOMIC_USDC: '100000',
    X402_PAYER_PRIVATE_KEY: '0x' + '11'.repeat(32),
    CHIT_STAMP_PRIVATE_KEY: '0x' + '22'.repeat(32),
    ...overrides,
  };
}

test('decodeSettlement maps a v2 PAYMENT-RESPONSE fixture into tx, network, and payer', () => {
  const decoded = decodeSettlement(b64(settlement()));
  assert.equal(decoded.tx, fixture.transaction);
  assert.equal(decoded.network, 'eip155:8453');
  assert.equal(decoded.payer, fixture.payer);
});

test('handler pays the fixture challenge, posts v2 PAYMENT-RESPONSE, and sets X-Chit-Receipt', async () => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const signed: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.startsWith(UPSTREAM)) {
      const headers = new Headers(init?.headers);
      if (!headers.get('payment-signature')) {
        return new Response(JSON.stringify(challenge()), {
          status: 402,
          headers: { 'payment-required': b64(challenge()), 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(fixture.upstreamBody), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-encoding': 'gzip',
          'content-length': '4',
          'payment-response': b64(settlement()),
        },
      });
    }
    if (url.startsWith(`${CHIT}/v1/agents/7/book/ingest`)) {
      const headers = new Headers(init?.headers);
      if (!headers.get('payment-signature')) {
        return new Response(JSON.stringify({
          ...stampChallenge(),
          error: 'stamp_payment_required',
          stamp_fee: '2000',
        }), {
          status: 402,
          headers: { 'content-type': 'application/json', 'payment-required': b64(stampChallenge()) },
        });
      }
      return new Response(JSON.stringify({
        task_id: 'foreign-x402-fixture',
        verify_url: fixture.verify_url,
        evidence: 'foreign_ingest',
      }), { status: 201, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const pay = async (priced: unknown): Promise<PayResult> => {
    signed.push(JSON.stringify(priced));
    return { headers: { 'payment-signature': `sig-${signed.length}` } };
  };

  const response = await handleProxy(
    new Request(`https://proxy.example${fixture.upstreamPath}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ html: '<p>hi</p>' }),
    }),
    env(),
    { fetch: fetchImpl, pay },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Chit-Receipt'), fixture.verify_url);
  assert.equal(response.headers.get('content-encoding'), null);
  assert.equal(response.headers.get('content-length'), null);
  assert.equal(response.headers.get('content-type'), 'application/json');
  assert.deepEqual(await response.json(), fixture.upstreamBody);
  assert.equal(signed.length, 2, 'upstream payment and stamp are both signed');

  const ingestPosts = calls.filter((call) => call.url.includes('/book/ingest'));
  assert.equal(ingestPosts.length, 2);
  const posted = JSON.parse(String(ingestPosts[0].init?.body));
  assert.equal(posted.payment_response.transaction, fixture.transaction);
  assert.equal(posted.payment_response.network, 'eip155:8453');
  assert.equal(posted.payment_response.payer, fixture.payer);
  assert.equal(posted.payment_response.success, true);
  assert.equal(posted.payment_required.resource, fixture.resource);
  assert.equal(posted.payment_required.amount, fixture.amount);
  assert.equal(posted.payment_required.payTo, fixture.payTo);
  assert.equal(posted.session, 'sess-fixture');

  const paidUpstream = calls.find((call) => {
    return call.url === `${UPSTREAM}${fixture.upstreamPath}`
      && new Headers(call.init?.headers).get('payment-signature');
  });
  assert.ok(paidUpstream, 'retry carries PAYMENT-SIGNATURE');
  assert.equal(calls.some((call) => call.url.startsWith('http') && !call.url.startsWith(UPSTREAM) && !call.url.startsWith(CHIT)), false);
});

test('an upto-only challenge is refused before the payer is called', async () => {
  let paid = false;
  const upto = challenge();
  upto.accepts[0].scheme = 'upto';
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (!url.startsWith(UPSTREAM)) throw new Error(`unexpected fetch ${url}`);
    return new Response('', { status: 402, headers: { 'payment-required': b64(upto) } });
  };
  const response = await handleProxy(
    new Request(`https://proxy.example${fixture.upstreamPath}`),
    env(),
    {
      fetch: fetchImpl,
      pay: async () => {
        paid = true;
        return { headers: { 'payment-signature': 'nope' } };
      },
    },
  );
  assert.equal(response.status, 402);
  const body = await response.json() as { message: string };
  assert.match(body.message, /exact only/);
  assert.equal(paid, false);
});

test('a quote above the cap is refused before the payer is called', async () => {
  let paid = false;
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.startsWith(UPSTREAM)) {
      const priced = challenge('5000000');
      return new Response(JSON.stringify(priced), {
        status: 402,
        headers: { 'payment-required': b64(priced) },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  const response = await handleProxy(
    new Request(`https://proxy.example${fixture.upstreamPath}`),
    env({ MAX_ATOMIC_USDC: '100000' }),
    {
      fetch: fetchImpl,
      pay: async () => {
        paid = true;
        return { headers: { 'payment-signature': 'nope' } };
      },
    },
  );
  assert.equal(response.status, 402);
  const body = await response.json() as { error: string; message: string };
  assert.equal(body.error, 'payment_refused');
  assert.match(body.message, /above the 100000 atomic cap/);
  assert.equal(paid, false);
});

test('a paid upstream response without PAYMENT-RESPONSE does not call ingest', async () => {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    urls.push(url);
    if (!url.startsWith(UPSTREAM)) throw new Error(`unexpected fetch ${url}`);
    const headers = new Headers(init?.headers);
    if (!headers.get('payment-signature')) {
      return new Response('', { status: 402, headers: { 'payment-required': b64(challenge()) } });
    }
    return new Response(JSON.stringify(fixture.upstreamBody), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'content-length': '4',
      },
    });
  };
  const response = await handleProxy(
    new Request(`https://proxy.example${fixture.upstreamPath}`),
    env(),
    { fetch: fetchImpl, pay: async () => ({ headers: { 'payment-signature': 'sig' } }) },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Chit-Receipt'), null);
  assert.match(response.headers.get('X-Chit-Receipt-Error') || '', /PAYMENT-RESPONSE/);
  assert.equal(response.headers.get('content-encoding'), null);
  assert.equal(response.headers.get('content-length'), null);
  assert.equal(urls.some((url) => url.includes('chit402')), false);
  assert.deepEqual(await response.json(), fixture.upstreamBody);
});
