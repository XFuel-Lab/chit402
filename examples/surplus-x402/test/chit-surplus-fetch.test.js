import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { affordableExactAccepts, bookNetwork, STAMP_CAP_ATOMIC, SURPLUS_CAP_ATOMIC } from '../src/caps.js';
import { chitSurplusFetch, CHIT_API_URL, ENV } from '../src/chit-surplus-fetch.js';
import { formatPaidEndpoints, listPaidEndpoints } from '../src/list-endpoints.js';

const SURPLUS_URL = 'https://api.surplusintelligence.ai/v1/chat/completions';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const PAY_TO = '0x0F99fc0CBD7A114b2DA171FDa5A0167858f7afC2';
const STAMP_PAY_TO = '0x3333333333333333333333333333333333333333';
const TX = `0x${'ab'.repeat(32)}`;
const VERIFY = `${CHIT_API_URL}/receipt/foreign-x402-test`;
const ENV_NAMES = [ENV.surplusKey, ENV.stampKey, ENV.agentId, ENV.session, ENV.apiKey];

const savedEnv = new Map();
let originalFetch;

beforeEach(() => {
  for (const name of ENV_NAMES) {
    savedEnv.set(name, process.env[name]);
    delete process.env[name];
  }
  originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('network forbidden');
  };
});

afterEach(() => {
  for (const name of ENV_NAMES) {
    const previous = savedEnv.get(name);
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
  globalThis.fetch = originalFetch;
});

function b64(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

function surplusChallenge(amount) {
  return {
    x402Version: 2,
    resource: {
      url: SURPLUS_URL,
      description: 'Surplus chat completions',
      mimeType: 'application/json',
    },
    accepts: [{
      scheme: 'exact',
      network: 'eip155:8453',
      amount: String(amount),
      asset: USDC,
      payTo: PAY_TO,
      maxTimeoutSeconds: 120,
      extra: { name: 'USD Coin', version: '2' },
    }],
  };
}

function stampChallenge(amount) {
  return {
    x402Version: 2,
    accepts: [{
      scheme: 'exact',
      network: 'eip155:8453',
      amount: String(amount),
      maxAmountRequired: String(amount),
      asset: USDC,
      payTo: STAMP_PAY_TO,
      maxTimeoutSeconds: 60,
      extra: { name: 'USD Coin', version: '2', nonce: `0x${'11'.repeat(32)}` },
    }],
  };
}

function settlement(payer) {
  return {
    success: true,
    transaction: TX,
    network: 'eip155:8453',
    payer,
  };
}

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function spyAccount(account) {
  const calls = [];
  return {
    calls,
    account: {
      address: account.address,
      async signTypedData(args) {
        calls.push(args);
        return account.signTypedData(args);
      },
    },
  };
}

function throwingSigner() {
  const calls = [];
  return {
    calls,
    account: {
      address: PAY_TO,
      async signTypedData() {
        calls.push(true);
        throw new Error('signTypedData was called');
      },
    },
  };
}

describe('affordableExactAccepts', () => {
  it('allows 0.05 USDC and refuses one atomic unit above it', () => {
    const ok = affordableExactAccepts(surplusChallenge(SURPLUS_CAP_ATOMIC), {
      cap: SURPLUS_CAP_ATOMIC,
      usd: '0.05',
      label: 'Surplus payment',
    });
    assert.equal(ok.length, 1);
    assert.throws(
      () => affordableExactAccepts(surplusChallenge(SURPLUS_CAP_ATOMIC + 1n), {
        cap: SURPLUS_CAP_ATOMIC,
        usd: '0.05',
        label: 'Surplus payment',
      }),
      /0\.05 USDC cap \(50000 atomic\)/,
    );
  });

  it('refuses a stamp above 2000 atomic', () => {
    assert.throws(
      () => affordableExactAccepts(stampChallenge(STAMP_CAP_ATOMIC + 1n), {
        cap: STAMP_CAP_ATOMIC,
        usd: '0.002',
        label: 'Chit stamp fee',
      }),
      /2000 atomic/,
    );
  });
});

describe('bookNetwork', () => {
  it('stores Base as the short name so the book can split network:tx', () => {
    assert.equal(bookNetwork('eip155:8453'), 'base');
    assert.equal(bookNetwork('base'), 'base');
    const tx = `0x${'ab'.repeat(32)}`;
    const ref = `${bookNetwork('eip155:8453')}:${tx}`;
    const parts = ref.split(':');
    const parsed = parts.length > 1 ? parts.slice(1).join(':') : ref;
    assert.equal(parsed, tx);
  });
});

describe('chitSurplusFetch', () => {
  it('pays Surplus, stamps the book, and returns data plus verify_url', async () => {
    const surplus = spyAccount(privateKeyToAccount(generatePrivateKey()));
    const stamp = spyAccount(privateKeyToAccount(generatePrivateKey()));
    const completion = {
      id: 'chatcmpl-surplus-example',
      choices: [{ message: { role: 'assistant', content: 'pong' } }],
    };
    const calls = [];
    const fetchImpl = async (url, init) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(url), headers, body: init?.body });
      if (String(url) === SURPLUS_URL) {
        if (!headers.get('payment-signature')) {
          const challenge = surplusChallenge('3301');
          return jsonResponse(402, challenge, { 'payment-required': b64(challenge) });
        }
        return jsonResponse(200, completion, {
          'payment-response': b64(settlement(surplus.account.address)),
        });
      }
      if (String(url) === `${CHIT_API_URL}/v1/agents/7/book/ingest`) {
        if (!headers.get('x-payment')) {
          const challenge = stampChallenge('2000');
          return jsonResponse(402, challenge, { 'payment-required': b64(challenge) });
        }
        return jsonResponse(201, { task_id: 'foreign-x402-test', verify_url: VERIFY });
      }
      throw new Error(`unexpected url ${url}`);
    };

    const result = await chitSurplusFetch(SURPLUS_URL, {
      fetch: fetchImpl,
      method: 'POST',
      headers: { 'PAYMENT-SIGNATURE': 'should-not-be-forwarded-on-the-probe' },
      body: {
        model: 'llama-3.3-70b',
        messages: [{ role: 'user', content: 'Say exactly: pong' }],
        max_tokens: 8,
      },
      agentId: '7',
      session: 'sess-1',
      apiKey: 'book-key',
      surplusSigner: surplus.account,
      stampSigner: stamp.account,
    });

    assert.deepEqual(result.data, completion);
    assert.equal(result.verify_url, VERIFY);
    assert.equal(surplus.calls.length, 1);
    assert.equal(stamp.calls.length, 1);

    const probe = calls[0];
    assert.equal(probe.headers.get('payment-signature'), null);
    const paid = calls[1];
    const signature = JSON.parse(Buffer.from(paid.headers.get('payment-signature'), 'base64').toString('utf8'));
    assert.equal(signature.accepted.amount, '3301');
    assert.equal(signature.payload.authorization.value, '3301');

    const stamped = calls[3];
    assert.equal(stamped.headers.get('x-api-key'), 'book-key');
    assert.equal(stamped.headers.get('x-xfuel-session'), 'sess-1');
    const payment = JSON.parse(Buffer.from(stamped.headers.get('x-payment'), 'base64').toString('utf8'));
    assert.equal(payment.amount, '2000');
    assert.equal(payment.authorization.message.value, '2000');
    assert.equal(payment.authorization.type, 'eip3009-transferWithAuthorization');
    const body = JSON.parse(stamped.body);
    assert.equal(body.session, 'sess-1');
    assert.equal(body.job_kind, 'other');
    assert.deepEqual(body.payment_required, {
      resource: SURPLUS_URL,
      amount: '3301',
      payTo: PAY_TO,
      network: 'base',
      asset: 'USDC',
    });
    assert.deepEqual(body.payment_response, {
      tx: TX,
      payer: surplus.account.address,
      network: 'base',
    });
  });

  it('gives book ingest its own timer after Surplus has been paid', async () => {
    const surplus = spyAccount(privateKeyToAccount(generatePrivateKey()));
    const stamp = spyAccount(privateKeyToAccount(generatePrivateKey()));
    const surplusAbort = new AbortController();
    let ingestSignal;
    const fetchImpl = async (url, init) => {
      const headers = new Headers(init?.headers);
      if (String(url) === SURPLUS_URL) {
        if (!headers.get('payment-signature')) {
          const challenge = surplusChallenge('3301');
          return jsonResponse(402, challenge, { 'payment-required': b64(challenge) });
        }
        surplusAbort.abort();
        return jsonResponse(200, { id: 'chatcmpl-1' }, {
          'payment-response': b64(settlement(surplus.account.address)),
        });
      }
      ingestSignal = init?.signal;
      return jsonResponse(201, { verify_url: VERIFY });
    };

    const result = await chitSurplusFetch(SURPLUS_URL, {
      fetch: fetchImpl,
      body: '{}',
      signal: surplusAbort.signal,
      agentId: '7',
      session: 'sess-1',
      surplusSigner: surplus.account,
      stampSigner: stamp.account,
    });

    assert.equal(result.verify_url, VERIFY);
    assert.equal(surplusAbort.signal.aborted, true);
    assert.ok(ingestSignal);
    assert.equal(ingestSignal.aborted, false);
    assert.notEqual(ingestSignal, surplusAbort.signal);
  });

  it('refuses a Surplus price above 0.05 USDC before any signature', async () => {
    const surplus = throwingSigner();
    const stamp = throwingSigner();
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      const challenge = surplusChallenge('50001');
      return jsonResponse(402, challenge, { 'payment-required': b64(challenge) });
    };

    await assert.rejects(
      () => chitSurplusFetch(SURPLUS_URL, {
        fetch: fetchImpl,
        method: 'POST',
        body: '{"model":"llama-3.3-70b","messages":[{"role":"user","content":"ping"}]}',
        agentId: '7',
        session: 'sess-1',
        surplusSigner: surplus.account,
        stampSigner: stamp.account,
      }),
      /Surplus payment is 50001 atomic USDC, above the 0\.05 USDC cap \(50000 atomic\)/,
    );
    assert.equal(calls, 1);
    assert.equal(surplus.calls.length, 0);
    assert.equal(stamp.calls.length, 0);
  });

  it('refuses a Chit stamp above 2000 atomic USDC before the stamp signature', async () => {
    const surplus = spyAccount(privateKeyToAccount(generatePrivateKey()));
    const stamp = throwingSigner();
    const calls = [];
    const fetchImpl = async (url, init) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(url), headers });
      if (String(url) === SURPLUS_URL) {
        if (!headers.get('payment-signature')) {
          const challenge = surplusChallenge('3301');
          return jsonResponse(402, challenge, { 'payment-required': b64(challenge) });
        }
        return jsonResponse(200, { ok: true }, {
          'payment-response': b64(settlement(surplus.account.address)),
        });
      }
      const challenge = stampChallenge('2001');
      return jsonResponse(402, challenge, { 'payment-required': b64(challenge) });
    };

    await assert.rejects(
      () => chitSurplusFetch(SURPLUS_URL, {
        fetch: fetchImpl,
        body: '{}',
        agentId: '7',
        session: 'sess-1',
        surplusSigner: surplus.account,
        stampSigner: stamp.account,
      }),
      /Chit stamp fee is 2001 atomic USDC, above the 0\.002 USDC cap \(2000 atomic\)/,
    );
    assert.equal(surplus.calls.length, 1);
    assert.equal(stamp.calls.length, 0);
    assert.equal(calls.filter((call) => call.url.includes('/book/ingest')).length, 1);
  });

  it('rejects a missing or bad PAYMENT-RESPONSE before ingest', async () => {
    const cases = [
      { name: 'missing', headers: {} },
      { name: 'not base64', headers: { 'payment-response': '!!!!' } },
      {
        name: 'missing fields',
        headers: { 'payment-response': b64({ success: true, network: 'eip155:8453' }) },
      },
      {
        name: 'failed settlement',
        headers: {
          'payment-response': b64({
            success: false,
            transaction: TX,
            network: 'eip155:8453',
            payer: PAY_TO,
            errorReason: 'facilitator rejected',
          }),
        },
      },
    ];

    for (const item of cases) {
      const surplus = spyAccount(privateKeyToAccount(generatePrivateKey()));
      const stamp = throwingSigner();
      const urls = [];
      const fetchImpl = async (url, init) => {
        urls.push(String(url));
        const headers = new Headers(init?.headers);
        if (!headers.get('payment-signature')) {
          const challenge = surplusChallenge('1000');
          return jsonResponse(402, challenge, { 'payment-required': b64(challenge) });
        }
        return jsonResponse(200, { id: 'chatcmpl-1' }, item.headers);
      };
      await assert.rejects(
        () => chitSurplusFetch(SURPLUS_URL, {
          fetch: fetchImpl,
          body: '{}',
          agentId: '7',
          session: 'sess-1',
          surplusSigner: surplus.account,
          stampSigner: stamp.account,
        }),
        /PAYMENT-RESPONSE/,
        item.name,
      );
      assert.equal(urls.some((url) => url.includes('/book/ingest')), false, item.name);
      assert.equal(stamp.calls.length, 0, item.name);
    }
  });

  it('surfaces an ingest failure and does not sign the stamp', async () => {
    const surplus = spyAccount(privateKeyToAccount(generatePrivateKey()));
    const stamp = throwingSigner();
    const fetchImpl = async (url, init) => {
      const headers = new Headers(init?.headers);
      if (String(url) === SURPLUS_URL) {
        if (!headers.get('payment-signature')) {
          const challenge = surplusChallenge('3301');
          return jsonResponse(402, challenge, { 'payment-required': b64(challenge) });
        }
        return jsonResponse(200, { id: 'chatcmpl-1' }, {
          'payment-response': b64(settlement(surplus.account.address)),
        });
      }
      return jsonResponse(502, { error: 'verify_failed', message: 'Payment verification failed' });
    };

    await assert.rejects(
      () => chitSurplusFetch(SURPLUS_URL, {
        fetch: fetchImpl,
        body: '{}',
        agentId: '7',
        session: 'sess-1',
        surplusSigner: surplus.account,
        stampSigner: stamp.account,
      }),
      /book ingest failed: Payment verification failed/,
    );
    assert.equal(stamp.calls.length, 0);
  });
});

describe('list-endpoints', () => {
  it('prints manifest endpoints with prices and never sends a payment header', async () => {
    const manifest = {
      version: 1,
      resources: [
        SURPLUS_URL,
        {
          resource: 'https://api.surplusintelligence.ai/x402/resources/twitter/tweets/search/recent',
          method: 'GET',
          accepts: [{
            scheme: 'exact',
            network: 'eip155:8453',
            amount: '52000',
            asset: USDC,
            payTo: PAY_TO,
          }],
        },
      ],
    };
    const seen = [];
    const fetchImpl = async (url, init) => {
      const headers = new Headers(init?.headers);
      seen.push({ url: String(url), method: init?.method, headers });
      assert.equal(headers.get('payment-signature'), null);
      assert.equal(headers.get('x-payment'), null);
      if (String(url).endsWith('/.well-known/x402')) {
        return jsonResponse(200, manifest);
      }
      const challenge = surplusChallenge('3301');
      return jsonResponse(402, challenge, { 'payment-required': b64(challenge) });
    };

    const listed = await listPaidEndpoints({
      fetch: fetchImpl,
      origin: 'https://api.surplusintelligence.ai',
    });
    const printed = formatPaidEndpoints(listed);
    assert.match(printed, /\/\.well-known\/x402/);
    assert.match(printed, /POST\s+https:\/\/api\.surplusintelligence\.ai\/v1\/chat\/completions/);
    assert.match(printed, /3301 atomic USDC\s+\$0\.003301/);
    assert.match(printed, /52000 atomic USDC\s+\$0\.052000/);
    assert.match(printed, /over 0\.05 USDC cap/);
    assert.equal(seen.length, 2);
    assert.equal(seen[1].method, 'POST');
  });
});
