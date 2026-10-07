import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHIT_RECEIPT_HEADER,
  MISSING_STAMP_SIGNER_WARNING,
  STAMP_FEE_UNITS,
  STAMP_FEE_USD,
  chit402OnSettled,
  normalizeContentHash,
  payerFromPrivateKey,
  priceToAtomicUsdc,
  withReceipts,
} from './index.js';
import type { StampChallenge } from './index.js';
import type { EmDashEnforcer, EmDashEnforceResult } from './types.js';

const API = 'https://api.chit402.com';
const TX = `0x${'ab'.repeat(32)}`;
const PAYER = '0x1111111111111111111111111111111111111111';
const PAY_TO = '0x2222222222222222222222222222222222222222';
const VERIFY = `${API}/receipt/foreign-x402-test`;

const baseConfig = {
  agentId: 7,
  session: 'sess-1',
  apiKey: 'book-key',
  payTo: PAY_TO,
  apiUrl: API,
  timeoutMs: 1500,
  log: () => {},
};

const CHALLENGE_NONCE = `0x${'11'.repeat(32)}`;
const STAMP_CHALLENGE: StampChallenge = {
  x402Version: 2,
  accepts: [{
    scheme: 'exact',
    network: 'eip155:8453',
    amount: STAMP_FEE_UNITS,
    maxAmountRequired: STAMP_FEE_UNITS,
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    payTo: '0x3333333333333333333333333333333333333333',
    extra: { nonce: CHALLENGE_NONCE, name: 'USD Coin', version: '2' },
  }],
};

function stamp402(): Response {
  return jsonResponse(402, {
    ...STAMP_CHALLENGE,
    error: 'stamp_payment_required',
    stamp_fee_usd: STAMP_FEE_USD,
  });
}

function paidResult(over: Partial<EmDashEnforceResult> = {}): EmDashEnforceResult {
  return {
    paid: true,
    skipped: false,
    payer: PAYER,
    settlement: {
      success: true,
      transaction: TX,
      network: 'eip155:8453',
      payer: PAYER,
      amount: '50000',
    },
    responseHeaders: {
      'PAYMENT-RESPONSE': 'cGF5bWVudA==',
    },
    ...over,
  };
}

function enforcer(result: Response | EmDashEnforceResult): EmDashEnforcer & {
  enforce: ReturnType<typeof vi.fn>;
} {
  return {
    enforce: vi.fn(async () => result),
    applyHeaders(enforced, response) {
      if (enforced instanceof Response) return;
      for (const [key, value] of Object.entries(enforced.responseHeaders)) {
        response.headers.set(key, value);
      }
    },
    hasPayment: vi.fn(() => false),
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function requestFor(path = '/posts/hello'): Request {
  return new Request(`https://publisher.example${path}?utm=1`);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('priceToAtomicUsdc', () => {
  it('converts dollar prices to 6-decimal USDC', () => {
    expect(priceToAtomicUsdc('$0.05')).toBe('50000');
    expect(priceToAtomicUsdc('0.10')).toBe('100000');
    expect(priceToAtomicUsdc(0.002)).toBe('2000');
    expect(priceToAtomicUsdc('$1')).toBe('1000000');
  });

  it('keeps an atomic price object and prefers the settled amount', () => {
    expect(priceToAtomicUsdc({ amount: '50000', asset: 'USDC' })).toBe('50000');
    expect(priceToAtomicUsdc('$9.00', '50000')).toBe('50000');
  });

  it('matches the published stamp fee constants', () => {
    expect(STAMP_FEE_USD).toBe('0.002');
    expect(STAMP_FEE_UNITS).toBe('2000');
    expect(priceToAtomicUsdc(`$${STAMP_FEE_USD}`)).toBe(STAMP_FEE_UNITS);
  });
});

describe('withReceipts', () => {
  it('posts a paid read and sets X-Chit-Receipt beside PAYMENT-RESPONSE', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(201, {
      task_id: 'foreign-x402-test',
      verify_url: VERIFY,
      stamp_fee_usd: STAMP_FEE_USD,
    }));
    const x402 = enforcer(paidResult());
    const wrapped = withReceipts(x402, { ...baseConfig, fetch: fetchMock });
    const request = requestFor('/posts/hello');

    const result = await wrapped.enforce(request, { price: '$0.05', description: 'Premium article' });
    expect(result).not.toBeInstanceOf(Response);
    if (result instanceof Response) return;

    expect(result.responseHeaders['PAYMENT-RESPONSE']).toBe('cGF5bWVudA==');
    expect(result.responseHeaders[CHIT_RECEIPT_HEADER]).toBe(VERIFY);

    const headers = new Headers();
    wrapped.applyHeaders(result, { headers });
    expect(headers.get('PAYMENT-RESPONSE')).toBe('cGF5bWVudA==');
    expect(headers.get(CHIT_RECEIPT_HEADER)).toBe(VERIFY);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API}/v1/agents/7/book/ingest`);
    expect(init.method).toBe('POST');
    const sent = new Headers(init.headers);
    expect(sent.get('x-api-key')).toBe('book-key');
    expect(sent.get('x-xfuel-session')).toBe('sess-1');
    const body = JSON.parse(String(init.body));
    expect(body.session).toBe('sess-1');
    expect(body.payment_required).toEqual({
      resource: 'https://publisher.example/posts/hello',
      amount: '50000',
      payTo: PAY_TO,
      network: 'eip155:8453',
      asset: 'USDC',
    });
    expect(body.payment_response).toEqual({
      tx: TX,
      payer: PAYER,
      network: 'eip155:8453',
    });
    expect(body.job_kind).toBe('other');
    expect(body.deliverable_hash).toBeUndefined();
    expect(x402.enforce).toHaveBeenCalledWith(request, { price: '$0.05', description: 'Premium article' });
  });

  it('accepts SettleResponse.transaction and a tx alias', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(201, { verify_url: VERIFY }));
    const result = paidResult({
      settlement: { success: true, tx: TX, network: 'eip155:8453', payer: PAYER },
    });
    const wrapped = withReceipts(enforcer(result), {
      ...baseConfig,
      fetch: fetchMock,
      defaultPrice: '$0.05',
    });
    const out = await wrapped.enforce(requestFor(), {});
    if (out instanceof Response) throw new Error('expected a result');
    expect(out.responseHeaders[CHIT_RECEIPT_HEADER]).toBe(VERIFY);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.payment_response.tx).toBe(TX);
    expect(body.payment_required.amount).toBe('50000');
  });

  it('sends an optional page content hash', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(201, { task_id: 'foreign-x402-hash' }));
    const wrapped = withReceipts(enforcer(paidResult()), {
      ...baseConfig,
      fetch: fetchMock,
      contentHash: async () => 'page body',
    });
    const out = await wrapped.enforce(requestFor('/posts/a'), { price: '$0.05' });
    if (out instanceof Response) throw new Error('expected a result');
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.deliverable_hash).toBe(await normalizeContentHash('page body'));
    expect(body.deliverable_hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body.deliverable_kind).toBe('sha256');
    expect(out.responseHeaders[CHIT_RECEIPT_HEADER]).toBe(
      `${API}/receipt/${encodeURIComponent('foreign-x402-hash')}`,
    );
  });

  it('leaves a skipped human read untouched', async () => {
    const fetchMock = vi.fn();
    const skipped: EmDashEnforceResult = { paid: false, skipped: true, responseHeaders: {} };
    const wrapped = withReceipts(enforcer(skipped), { ...baseConfig, fetch: fetchMock });
    const out = await wrapped.enforce(requestFor(), { price: '$0.05' });
    expect(out).toEqual(skipped);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the unpaid 402 response without stamping', async () => {
    const fetchMock = vi.fn();
    const challenge = new Response(JSON.stringify({ error: 'payment required' }), {
      status: 402,
      headers: { 'PAYMENT-REQUIRED': 'abc' },
    });
    const wrapped = withReceipts(enforcer(challenge), { ...baseConfig, fetch: fetchMock });
    const out = await wrapped.enforce(requestFor(), { price: '$0.05' });
    expect(out).toBe(challenge);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs a stamp HTTP failure and still returns the paid page', async () => {
    const log = vi.fn();
    const fetchMock = vi.fn(async () => {
      throw new Error('network down');
    });
    const wrapped = withReceipts(enforcer(paidResult()), { ...baseConfig, fetch: fetchMock, log });
    const out = await wrapped.enforce(requestFor(), { price: '$0.05' });
    if (out instanceof Response) throw new Error('expected a result');
    expect(out.paid).toBe(true);
    expect(out.responseHeaders[CHIT_RECEIPT_HEADER]).toBeUndefined();
    expect(out.responseHeaders['PAYMENT-RESPONSE']).toBe('cGF5bWVudA==');
    const lines = log.mock.calls.map((call) => String(call[0])).join('\n');
    expect(lines).toMatch(/network down/);
  });

  it('warns once at startup when no signer is configured and does not retry', async () => {
    const log = vi.fn();
    const fetchMock = vi.fn(async () => stamp402());
    const wrapped = withReceipts(enforcer(paidResult()), { ...baseConfig, fetch: fetchMock, log });
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]?.[0]).toBe(MISSING_STAMP_SIGNER_WARNING);

    await wrapped.enforce(requestFor(), { price: '$0.05' });
    await wrapped.enforce(requestFor('/posts/again'), { price: '$0.05' });
    expect(log).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondHeaders = new Headers((fetchMock.mock.calls[1] as [string, RequestInit])[1].headers);
    expect(secondHeaders.get('x-payment')).toBeNull();
  });

  it('pays the $0.002 stamp after 402 and retries once', async () => {
    const payer = vi.fn(async () => ({ header: 'c3RhbXA=', nonce: CHALLENGE_NONCE }));
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (!headers.get('x-payment')) return stamp402();
      return jsonResponse(201, { verify_url: VERIFY, stamp_fee_usd: STAMP_FEE_USD });
    });
    const wrapped = withReceipts(enforcer(paidResult()), {
      ...baseConfig,
      fetch: fetchMock,
      signer: payer,
    });
    const out = await wrapped.enforce(requestFor(), { price: '$0.05' });
    if (out instanceof Response) throw new Error('expected a result');
    expect(out.responseHeaders[CHIT_RECEIPT_HEADER]).toBe(VERIFY);
    expect(payer).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const paidHeaders = new Headers((fetchMock.mock.calls[1] as [string, RequestInit])[1].headers);
    expect(paidHeaders.get('x-payment')).toBe('c3RhbXA=');
    expect(paidHeaders.get('x-payment-nonce')).toBe(CHALLENGE_NONCE);
    expect(paidHeaders.get('x-api-key')).toBe('book-key');
  });

  it('moves a slow stamp payment to waitUntil and sets the header only after verify_url', async () => {
    const payer = vi.fn(() => new Promise<{ header: string; nonce: string }>((resolve) => {
      setTimeout(() => resolve({ header: 'late-payment', nonce: CHALLENGE_NONCE }), 60);
    }));
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (!headers.get('x-payment')) return stamp402();
      return jsonResponse(201, { verify_url: VERIFY });
    });
    const waitUntil = vi.fn();
    const wrapped = withReceipts(enforcer(paidResult()), {
      ...baseConfig,
      fetch: fetchMock,
      signer: payer,
      timeoutMs: 25,
      hardTimeoutMs: 5000,
      waitUntil,
    });
    const out = await wrapped.enforce(requestFor(), { price: '$0.05' });
    if (out instanceof Response) throw new Error('expected a result');
    expect(out.responseHeaders[CHIT_RECEIPT_HEADER]).toBeUndefined();
    expect(waitUntil).toHaveBeenCalledOnce();
    await waitUntil.mock.calls[0]?.[0];
    expect(out.responseHeaders[CHIT_RECEIPT_HEADER]).toBe(VERIFY);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('logs a failed stamp payment and does not throw', async () => {
    const log = vi.fn();
    const payer = vi.fn(async () => {
      throw new Error('user rejected');
    });
    const fetchMock = vi.fn(async () => stamp402());
    const wrapped = withReceipts(enforcer(paidResult()), {
      ...baseConfig,
      fetch: fetchMock,
      signer: payer,
      log,
    });
    expect(log).not.toHaveBeenCalled();
    const out = await wrapped.enforce(requestFor(), { price: '$0.05' });
    if (out instanceof Response) throw new Error('expected a result');
    expect(out.responseHeaders[CHIT_RECEIPT_HEADER]).toBeUndefined();
    expect(out.responseHeaders['PAYMENT-RESPONSE']).toBe('cGF5bWVudA==');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(log.mock.calls[0]?.[0])).toMatch(/user rejected/);
  });

  it('logs when the paid retry is still 402', async () => {
    const log = vi.fn();
    const payer = vi.fn(async () => ({ header: 'c3RhbXA=', nonce: CHALLENGE_NONCE }));
    const fetchMock = vi.fn(async () => stamp402());
    const wrapped = withReceipts(enforcer(paidResult()), {
      ...baseConfig,
      fetch: fetchMock,
      signer: payer,
      log,
    });
    const out = await wrapped.enforce(requestFor(), { price: '$0.05' });
    if (out instanceof Response) throw new Error('expected a result');
    expect(out.responseHeaders[CHIT_RECEIPT_HEADER]).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(log.mock.calls[0]?.[0])).toMatch(/stamp_payment_required/);
  });

  it('points X-Chit-Receipt at the by-tx lookup when the row already exists', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(409, { error: 'duplicate_ref' }));
    const wrapped = withReceipts(enforcer(paidResult()), {
      ...baseConfig,
      fetch: fetchMock,
      log: () => {},
    });
    const out = await wrapped.enforce(requestFor(), { price: '$0.05' });
    if (out instanceof Response) throw new Error('expected a result');
    expect(out.responseHeaders[CHIT_RECEIPT_HEADER]).toBe(
      `${API}/receipt/by-tx?tx=${encodeURIComponent(TX)}`,
    );
  });

  it('returns the page on timeout and hands the stamp to waitUntil', async () => {
    let release: (value: Response) => void = () => {};
    const fetchMock = vi.fn(
      () => new Promise<Response>((resolve) => {
        release = resolve;
      }),
    );
    const waitUntil = vi.fn();
    const wrapped = withReceipts(enforcer(paidResult()), {
      ...baseConfig,
      fetch: fetchMock,
      timeoutMs: 30,
      hardTimeoutMs: 5000,
      waitUntil,
    });

    const started = Date.now();
    const out = await wrapped.enforce(requestFor(), { price: '$0.05' });
    expect(Date.now() - started).toBeLessThan(400);
    if (out instanceof Response) throw new Error('expected a result');
    expect(out.responseHeaders[CHIT_RECEIPT_HEADER]).toBeUndefined();
    expect(waitUntil).toHaveBeenCalledOnce();

    release(jsonResponse(201, { verify_url: VERIFY }));
    await waitUntil.mock.calls[0]?.[0];
    expect(out.responseHeaders[CHIT_RECEIPT_HEADER]).toBe(VERIFY);
  });

  it('uses request.waitUntil when config does not pass one', async () => {
    let release: (value: Response) => void = () => {};
    const fetchMock = vi.fn(
      () => new Promise<Response>((resolve) => {
        release = resolve;
      }),
    );
    const waitUntil = vi.fn();
    const request = requestFor();
    Object.assign(request, { waitUntil });
    const wrapped = withReceipts(enforcer(paidResult()), {
      ...baseConfig,
      fetch: fetchMock,
      timeoutMs: 20,
    });
    await wrapped.enforce(request, { price: '$0.05' });
    expect(waitUntil).toHaveBeenCalledOnce();
    release(jsonResponse(201, { verify_url: VERIFY }));
    await waitUntil.mock.calls[0]?.[0];
  });

  it('lets enforce() errors propagate', async () => {
    const x402 = enforcer(paidResult());
    x402.enforce.mockRejectedValueOnce(new Error('facilitator down'));
    const wrapped = withReceipts(x402, { ...baseConfig, fetch: vi.fn() });
    await expect(wrapped.enforce(requestFor(), { price: '$0.05' })).rejects.toThrow('facilitator down');
  });

  it('calls an optional onSettled hook and swallows its errors', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(201, { verify_url: VERIFY }));
    const log = vi.fn();
    const onSettled = vi.fn(async () => {
      throw new Error('hook broke');
    });
    const wrapped = withReceipts(enforcer(paidResult()), {
      ...baseConfig,
      fetch: fetchMock,
      onSettled,
      log,
    });
    const out = await wrapped.enforce(requestFor(), { price: '$0.05' });
    if (out instanceof Response) throw new Error('expected a result');
    expect(out.responseHeaders[CHIT_RECEIPT_HEADER]).toBe(VERIFY);
    expect(onSettled).toHaveBeenCalledOnce();
    expect(String(log.mock.calls.at(-1)?.[0])).toMatch(/hook broke/);
  });
});

describe('chit402OnSettled', () => {
  it('stamps from the future hook context', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(201, { verify_url: VERIFY }));
    const hook = chit402OnSettled({ ...baseConfig, fetch: fetchMock });
    const result = paidResult();
    await hook({
      request: requestFor('/posts/hook'),
      result,
      resource: 'https://publisher.example/posts/hook',
    });
    expect(result.responseHeaders[CHIT_RECEIPT_HEADER]).toBe(VERIFY);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.payment_required.resource).toBe('https://publisher.example/posts/hook');
    expect(body.payment_required.amount).toBe('50000');
  });

  it('ignores a skipped result', async () => {
    const fetchMock = vi.fn();
    const hook = chit402OnSettled({ ...baseConfig, fetch: fetchMock });
    const result: EmDashEnforceResult = { paid: false, skipped: true, responseHeaders: {} };
    await hook({ request: requestFor(), result });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('payerFromPrivateKey', () => {
  it('signs the standard stamp and recovers to the key', async () => {
    const { generatePrivateKey, privateKeyToAccount } = await import('viem/accounts');
    const { recoverTypedDataAddress } = await import('viem');
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const payer = payerFromPrivateKey(privateKey);
    const { header, nonce } = await payer(STAMP_CHALLENGE);
    expect(nonce).toBe(CHALLENGE_NONCE);

    const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as {
      amount: string;
      authorization: {
        type: string;
        domain: { name: string; version: string; chainId: number; verifyingContract: `0x${string}` };
        message: {
          from: `0x${string}`;
          to: `0x${string}`;
          value: string;
          validAfter: number;
          validBefore: number;
          nonce: `0x${string}`;
        };
        signature: `0x${string}`;
      };
    };
    expect(decoded.amount).toBe(STAMP_FEE_UNITS);
    expect(decoded.authorization.type).toBe('eip3009-transferWithAuthorization');
    expect(decoded.authorization.message.value).toBe(STAMP_FEE_UNITS);
    const message = decoded.authorization.message;
    const recovered = await recoverTypedDataAddress({
      domain: decoded.authorization.domain,
      types: {
        TransferWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' },
        ],
      },
      primaryType: 'TransferWithAuthorization',
      message: {
        from: message.from,
        to: message.to,
        value: BigInt(message.value),
        validAfter: BigInt(message.validAfter),
        validBefore: BigInt(message.validBefore),
        nonce: message.nonce,
      },
      signature: decoded.authorization.signature,
    });
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
  });

  it('refuses a challenge above the $0.002 stamp', async () => {
    const { generatePrivateKey } = await import('viem/accounts');
    const payer = payerFromPrivateKey(generatePrivateKey());
    const over: StampChallenge = {
      ...STAMP_CHALLENGE,
      accepts: [{ ...STAMP_CHALLENGE.accepts[0], amount: '2001', maxAmountRequired: '2001' }],
    };
    await expect(payer(over)).rejects.toThrow(/2000/);
  });
});

describe('stampedEnforce alias', () => {
  it('is the same wrapper', async () => {
    const { stampedEnforce } = await import('./index.js');
    expect(stampedEnforce).toBe(withReceipts);
  });
});
