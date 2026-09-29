import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHIT_RECEIPT_HEADER,
  STAMP_FEE_UNITS,
  STAMP_FEE_USD,
  chit402OnSettled,
  normalizeContentHash,
  priceToAtomicUsdc,
  withReceipts,
} from './index.js';
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
};

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
    expect(log).toHaveBeenCalled();
    expect(String(log.mock.calls[0]?.[0])).toMatch(/network down/);
  });

  it('logs the $0.002 stamp challenge and does not throw', async () => {
    const log = vi.fn();
    const fetchMock = vi.fn(async () => jsonResponse(402, {
      error: 'stamp_payment_required',
      stamp_fee_usd: '0.002',
    }));
    const wrapped = withReceipts(enforcer(paidResult()), { ...baseConfig, fetch: fetchMock, log });
    const out = await wrapped.enforce(requestFor(), { price: '$0.05' });
    if (out instanceof Response) throw new Error('expected a result');
    expect(out.responseHeaders[CHIT_RECEIPT_HEADER]).toBeUndefined();
    expect(String(log.mock.calls[0]?.[0])).toContain(STAMP_FEE_USD);
    expect(String(log.mock.calls[0]?.[0])).toContain(STAMP_FEE_UNITS);
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

describe('stampedEnforce alias', () => {
  it('is the same wrapper', async () => {
    const { stampedEnforce } = await import('./index.js');
    expect(stampedEnforce).toBe(withReceipts);
  });
});
