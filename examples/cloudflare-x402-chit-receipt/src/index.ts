/**
 * Buyer-side Worker. Pays UPSTREAM_ORIGIN with an x402 client, posts the
 * PAYMENT-RESPONSE to Chit foreign ingest, and returns the upstream body with
 * `X-Chit-Receipt` set to the verify URL.
 *
 * Settlement stays with the seller's facilitator (Coinbase, for Monetization
 * Gateway). Chit only records the transfer. Evidence is foreign_ingest.
 * Base USDC only.
 */

const STAMP_CAP_ATOMIC = 2000n;
const DEFAULT_CALL_CAP = 100000n;
const BASE_NETWORKS = new Set(['base', 'eip155:8453']);
const USDC_ASSETS = new Set([
  'usdc',
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
]);
const HOP_HEADERS = ['host', 'connection', 'content-length', 'transfer-encoding'];
const PAYMENT_HEADERS = [
  'payment-signature',
  'payment-required',
  'payment-response',
  'x-payment',
  'x-payment-response',
  'payment-nonce',
  'x-payment-nonce',
];

export interface Env {
  UPSTREAM_ORIGIN: string;
  CHIT_API_URL?: string;
  CHIT_AGENT_ID?: string;
  CHIT_BOOK_SESSION?: string;
  X402_PAYER_PRIVATE_KEY?: string;
  CHIT_STAMP_PRIVATE_KEY?: string;
  CHIT_API_KEY?: string;
  MAX_ATOMIC_USDC?: string;
}

export interface PayResult {
  headers: Record<string, string>;
}

export interface ProxyDeps {
  fetch?: typeof fetch;
  pay?: (challenge: unknown, privateKey: string) => Promise<PayResult>;
}

interface Accept {
  scheme?: string;
  network?: string;
  amount?: string;
  maxAmountRequired?: string;
  asset?: string;
  payTo?: string;
}

interface Settlement {
  tx: string;
  network: string;
  payer: string;
  amount?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleProxy(request, env);
  },
};

export async function handleProxy(request: Request, env: Env, deps: ProxyDeps = {}): Promise<Response> {
  const incoming = new URL(request.url);
  if (request.method === 'GET' && incoming.pathname === '/__chit/health') {
    return Response.json({ ok: true, service: 'cloudflare-x402-chit-receipt' });
  }

  const origin = String(env.UPSTREAM_ORIGIN || '').replace(/\/$/, '');
  if (!origin) return jsonError(500, 'upstream_unset', 'UPSTREAM_ORIGIN is not set');

  const fetchImpl = deps.fetch ?? fetch;
  const upstreamUrl = `${origin}${incoming.pathname}${incoming.search}`;
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const body = hasBody ? await request.arrayBuffer() : undefined;
  const headers = forwardedHeaders(request.headers);

  const probe = await fetchImpl(upstreamUrl, { method: request.method, headers, body });
  if (probe.status !== 402) return probe;

  const probeText = await probe.text();
  let challenge: Record<string, unknown>;
  try {
    challenge = readChallenge(probe, probeText);
  } catch (err) {
    return jsonError(502, 'unreadable_challenge', messageOf(err));
  }

  let accepted: Accept;
  try {
    accepted = pickBaseUsdcAccept(challenge, callCap(env));
  } catch (err) {
    return jsonError(402, 'payment_refused', messageOf(err));
  }

  const pay = deps.pay ?? defaultPay;
  const payerKey = env.X402_PAYER_PRIVATE_KEY || '';
  if (!deps.pay && !payerKey) {
    return jsonError(500, 'payer_unset', 'X402_PAYER_PRIVATE_KEY is not set');
  }

  let payment: PayResult;
  try {
    payment = await pay(challengeFor(challenge, accepted), payerKey);
  } catch (err) {
    return jsonError(502, 'payment_sign_failed', messageOf(err));
  }

  const paid = await fetchImpl(upstreamUrl, {
    method: request.method,
    headers: { ...headers, ...payment.headers },
    body,
  });
  if (paid.status === 402) {
    return jsonError(402, 'payment_rejected', 'upstream still returned 402 after PAYMENT-SIGNATURE');
  }

  const settlementHeader = paid.headers.get('payment-response') || paid.headers.get('x-payment-response');
  if (!settlementHeader) {
    return withReceiptError(paid, 'missing PAYMENT-RESPONSE');
  }

  let settlement: Settlement;
  try {
    settlement = decodeSettlement(settlementHeader);
  } catch (err) {
    return withReceiptError(paid, messageOf(err));
  }
  if (!BASE_NETWORKS.has(settlement.network.toLowerCase())) {
    return withReceiptError(paid, 'Base USDC only');
  }

  const amount = digit(settlement.amount) || digit(accepted.amount) || digit(accepted.maxAmountRequired);
  if (!amount) return withReceiptError(paid, 'settled amount missing');

  try {
    const verifyUrl = await stampIngest({
      fetchImpl,
      env,
      pay,
      resource: resourceOf(challenge, upstreamUrl),
      amount,
      payTo: String(accepted.payTo || ''),
      settlement,
    });
    return withReceipt(paid, verifyUrl);
  } catch (err) {
    return withReceiptError(paid, messageOf(err));
  }
}

async function defaultPay(challenge: unknown, privateKey: string): Promise<PayResult> {
  const mod = await import('./x402-client.js');
  return mod.payExactChallenge(privateKey, challenge);
}

function callCap(env: Env): bigint {
  const raw = String(env.MAX_ATOMIC_USDC || DEFAULT_CALL_CAP).trim();
  if (!/^[0-9]+$/.test(raw)) return DEFAULT_CALL_CAP;
  return BigInt(raw);
}

function pickBaseUsdcAccept(challenge: Record<string, unknown>, cap: bigint): Accept {
  const accepts = Array.isArray(challenge.accepts) ? challenge.accepts as Accept[] : [];
  const exact = accepts.filter((entry) => entry && entry.scheme === 'exact' && isBase(entry.network) && isUsdc(entry.asset));
  if (exact.length === 0) {
    throw new Error('challenge has no Base USDC exact accept. This proxy signs exact only. Refusing before signature.');
  }
  const priced = exact.map((entry) => ({ entry, amount: atomic(entry) }));
  const under = priced.filter((row) => row.amount <= cap);
  if (under.length === 0) {
    const lowest = priced.reduce((min, row) => (row.amount < min.amount ? row : min));
    throw new Error(
      `quoted ${lowest.amount} atomic USDC is above the ${cap} atomic cap. Refusing before signature.`,
    );
  }
  under.sort((a, b) => (a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0));
  return under[0].entry;
}

function atomic(accept: Accept): bigint {
  const raw = digit(accept.amount) || digit(accept.maxAmountRequired);
  if (!raw) throw new Error('accept amount is missing or not atomic USDC. Refusing before signature.');
  return BigInt(raw);
}

function challengeFor(challenge: Record<string, unknown>, accepted: Accept) {
  return { ...challenge, accepts: [accepted] };
}

async function stampIngest(opts: {
  fetchImpl: typeof fetch;
  env: Env;
  pay: NonNullable<ProxyDeps['pay']>;
  resource: string;
  amount: string;
  payTo: string;
  settlement: Settlement;
}): Promise<string> {
  const agentId = String(opts.env.CHIT_AGENT_ID || '').trim();
  const session = String(opts.env.CHIT_BOOK_SESSION || '').trim();
  if (!/^[1-9][0-9]*$/.test(agentId)) throw new Error('CHIT_AGENT_ID must be the registered book id');
  if (!session) throw new Error('CHIT_BOOK_SESSION is required');
  if (!opts.payTo) throw new Error('challenge is missing payTo');

  const apiUrl = String(opts.env.CHIT_API_URL || 'https://api.chit402.com').replace(/\/$/, '');
  const url = `${apiUrl}/v1/agents/${agentId}/book/ingest`;
  const payload = JSON.stringify({
    session,
    payment_required: {
      resource: opts.resource,
      amount: opts.amount,
      payTo: opts.payTo,
      network: 'eip155:8453',
      asset: 'USDC',
    },
    payment_response: {
      success: true,
      transaction: opts.settlement.tx,
      network: 'eip155:8453',
      payer: opts.settlement.payer,
    },
    job_kind: 'other',
  });
  const baseHeaders: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
    'x-xfuel-session': session,
  };
  if (opts.env.CHIT_API_KEY) baseHeaders['x-api-key'] = opts.env.CHIT_API_KEY;

  const post = (extra?: Record<string, string>) => opts.fetchImpl(url, {
    method: 'POST',
    headers: extra ? { ...baseHeaders, ...extra } : baseHeaders,
    body: payload,
  });

  const first = await post();
  const firstBody = await readJson(first);
  if (first.status === 201 || first.ok) return verifyUrlOf(firstBody, apiUrl, opts.settlement.tx);
  if (first.status === 409) return byTxUrl(apiUrl, opts.settlement.tx);
  if (first.status !== 402) throw new Error(ingestMessage(first.status, firstBody));

  const stampChallenge = readStampChallenge(firstBody, first.headers.get('payment-required'));
  const stampAccept = pickBaseUsdcAccept(stampChallenge, STAMP_CAP_ATOMIC);
  if (atomic(stampAccept) > STAMP_CAP_ATOMIC) {
    throw new Error('Chit stamp is above 2000 atomic USDC. Refusing before signature.');
  }
  const stampKey = opts.env.CHIT_STAMP_PRIVATE_KEY || opts.env.X402_PAYER_PRIVATE_KEY || '';
  if (!stampKey) throw new Error('CHIT_STAMP_PRIVATE_KEY is not set');
  const signed = await opts.pay(challengeFor(stampChallenge, stampAccept), stampKey);
  const paid = await post(signed.headers);
  const paidBody = await readJson(paid);
  if (paid.status === 201 || paid.ok) return verifyUrlOf(paidBody, apiUrl, opts.settlement.tx);
  if (paid.status === 409) return byTxUrl(apiUrl, opts.settlement.tx);
  throw new Error(ingestMessage(paid.status, paidBody));
}

export function decodeSettlement(header: string): Settlement {
  const raw = header.trim();
  if (!raw) throw new Error('PAYMENT-RESPONSE header is missing');
  const json = raw.startsWith('{') ? raw : decodeBase64(raw);
  let decoded: Record<string, unknown>;
  try {
    decoded = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new Error('PAYMENT-RESPONSE is not valid base64 JSON');
  }
  if (!decoded || typeof decoded !== 'object') throw new Error('PAYMENT-RESPONSE is not a settlement object');
  if (decoded.success === false) {
    const reason = stringField(decoded.errorReason) || stringField(decoded.error) || 'settlement failed';
    throw new Error(`PAYMENT-RESPONSE settlement failed: ${reason}`);
  }
  const tx = stringField(decoded.transaction) || stringField(decoded.tx);
  const network = stringField(decoded.network);
  const payer = stringField(decoded.payer);
  if (!tx || !network || !payer) throw new Error('PAYMENT-RESPONSE is missing tx hash, network, or payer');
  return { tx, network, payer, amount: stringField(decoded.amount) || undefined };
}

function readChallenge(response: Response, text: string): Record<string, unknown> {
  const header = response.headers.get('payment-required') || response.headers.get('x-payment-required');
  if (header) {
    const json = header.trim().startsWith('{') ? header.trim() : decodeBase64(header.trim());
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (parsed && Array.isArray(parsed.accepts)) return parsed;
  }
  if (text) {
    const body = JSON.parse(text) as Record<string, unknown>;
    if (body && Array.isArray(body.accepts)) return body;
  }
  throw new Error('402 response had no PAYMENT-REQUIRED challenge');
}

function readStampChallenge(body: Record<string, unknown> | undefined, header: string | null): Record<string, unknown> {
  if (body && Array.isArray(body.accepts)) return body;
  if (header) return readChallenge(new Response(null, { headers: { 'payment-required': header } }), '');
  throw new Error('ingest 402 had no x402 stamp challenge');
}

function resourceOf(challenge: Record<string, unknown>, upstreamUrl: string): string {
  const resource = challenge.resource;
  if (typeof resource === 'string' && resource) return resource;
  if (resource && typeof resource === 'object' && typeof (resource as { url?: string }).url === 'string') {
    return (resource as { url: string }).url;
  }
  return upstreamUrl;
}

function verifyUrlOf(body: Record<string, unknown> | undefined, apiUrl: string, tx: string): string {
  const direct = stringField(body?.verify_url);
  if (direct) return direct;
  const taskId = stringField(body?.task_id);
  if (taskId) return `${apiUrl}/receipt/${encodeURIComponent(taskId)}`;
  return byTxUrl(apiUrl, tx);
}

function byTxUrl(apiUrl: string, tx: string): string {
  return `${apiUrl}/receipt/by-tx?tx=${encodeURIComponent(tx)}`;
}

function ingestMessage(status: number, body: Record<string, unknown> | undefined): string {
  const message = stringField(body?.message) || stringField(body?.error) || `HTTP ${status}`;
  return `book ingest failed: ${message}`;
}

function forwardedHeaders(input: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  input.forEach((value, key) => {
    const name = key.toLowerCase();
    if (HOP_HEADERS.includes(name) || PAYMENT_HEADERS.includes(name)) return;
    out[key] = value;
  });
  return out;
}

function withReceipt(upstream: Response, verifyUrl: string): Response {
  const headers = new Headers(upstream.headers);
  headers.set('X-Chit-Receipt', verifyUrl);
  headers.delete('content-encoding');
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
}

function withReceiptError(upstream: Response, message: string): Response {
  const headers = new Headers(upstream.headers);
  headers.set('X-Chit-Receipt-Error', message);
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
}

function jsonError(status: number, error: string, message: string): Response {
  return Response.json({ error, message }, { status });
}

function isBase(network: string | undefined): boolean {
  return BASE_NETWORKS.has(String(network || '').toLowerCase());
}

function isUsdc(asset: string | undefined): boolean {
  return USDC_ASSETS.has(String(asset || '').trim().toLowerCase());
}

function digit(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const raw = String(value).trim();
  return /^[0-9]+$/.test(raw) ? raw : '';
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function decodeBase64(value: string): string {
  const pad = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = pad + '='.repeat((4 - (pad.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function readJson(res: Response): Promise<Record<string, unknown> | undefined> {
  try {
    const body = await res.json();
    if (body && typeof body === 'object') return body as Record<string, unknown>;
  } catch {
    return undefined;
  }
  return undefined;
}
