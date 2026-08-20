// x402.ts — client-side USDC/x402 payment helpers for the XFuel SDK.
//
// XFuel's default payment rail is USDC via x402: submit a task, receive a 402
// challenge, have an AGENT-SIDE payer sign a USDC payment (on Base), then retry
// with the X-PAYMENT header. This module provides the payer interface + two
// reference payers. The SDK never holds private keys — the signer is yours.
//
// See docs/payments-x402.md and skills/xfuel-submit-inference.

/** One entry of the 402 challenge `accepts[]` array (x402 `exact` scheme). */
export interface X402Accept {
  scheme: string;
  network: string;
  asset: string;
  /** x402 v2 atomic amount (USDC 6dp string). Prefer this over maxAmountRequired. */
  amount?: string;
  /** x402 v1 field — still echoed by the gateway for older clients. */
  maxAmountRequired?: string;
  resource?: string;
  payTo?: string | null;
  mimeType?: string;
  description?: string;
  maxTimeoutSeconds?: number;
  extra?: {
    name?: string;
    version?: string;
    taskId?: string;
    nonce?: string;
    expiresAt?: number | null;
  };
  /** Legacy: bazaar lived on the accept. Prefer challenge.extensions. */
  extensions?: Record<string, unknown>;
}

/** Top-level v2 resource object on PaymentRequired. */
export interface X402ResourceInfo {
  url: string;
  description?: string;
  mimeType?: string;
  serviceName?: string;
  tags?: string[];
  iconUrl?: string;
}

/** The body of a 402 Payment Required response from `POST /task-request`. */
export interface X402Challenge {
  x402Version: number;
  error?: string;
  /** x402 v2: top-level resource object. */
  resource?: X402ResourceInfo | string;
  accepts: X402Accept[];
  /** x402 v2: top-level extensions (bazaar lives here). */
  extensions?: Record<string, unknown>;
}

/** What a payer returns: the X-PAYMENT header value (+ optional nonce override). */
export interface X402PaymentAuthorization {
  /** Value for the `X-PAYMENT` header. */
  header: string;
  /** Challenge nonce (sent as `X-PAYMENT-NONCE`); defaults to accepts[0].extra.nonce. */
  nonce?: string;
}

/**
 * An agent-side payer: given a 402 challenge, return an X-PAYMENT authorization.
 * The SDK calls this to complete the handshake. It never sees your keys.
 */
export type X402Payer = (challenge: X402Challenge) => Promise<X402PaymentAuthorization>;

/** base64-encode a JSON payload for the X-PAYMENT header (Node target; btoa fallback). */
function encodePaymentHeader(obj: unknown): string {
  const json = JSON.stringify(obj);
  if (typeof Buffer !== 'undefined') return Buffer.from(json, 'utf8').toString('base64');
  // Browser-like fallback.
  return btoa(unescape(encodeURIComponent(json)));
}

/** Pick the `exact`-scheme accept (or the first one) from a challenge. */
export function selectAccept(challenge: X402Challenge): X402Accept {
  const accepts = challenge?.accepts ?? [];
  if (accepts.length === 0) throw new Error('x402 challenge has no accepts[]');
  return accepts.find((a) => a.scheme === 'exact') ?? accepts[0];
}

/** Atomic amount from a v2 (`amount`) or v1 (`maxAmountRequired`) accept. */
export function acceptAmount(accept: X402Accept): string {
  const v = accept.amount ?? accept.maxAmountRequired;
  if (v == null || v === '') throw new Error('x402 accept is missing amount');
  return String(v);
}

/** Absolute resource URL from a v2 challenge or a legacy accept.resource string. */
export function challengeResourceUrl(challenge: X402Challenge, accept?: X402Accept): string | undefined {
  const top = challenge.resource;
  if (typeof top === 'string' && top) return top;
  if (top && typeof top === 'object' && typeof top.url === 'string') return top.url;
  return accept?.resource;
}

/** Fields CDP Bazaar needs echoed from the 402 into the X-PAYMENT blob. */
function catalogEcho(challenge: X402Challenge, accept: X402Accept): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const resource = challengeResourceUrl(challenge, accept);
  if (resource) out.resource = resource;
  const extensions = challenge.extensions ?? accept.extensions;
  if (extensions) out.extensions = extensions;
  return out;
}

/**
 * Dev/test payer. Produces a structured X-PAYMENT blob that echoes the challenge
 * (nonce/amount/payTo). Works only against a **local mock facilitator**.
 *
 * The hosted demo (`api.xfuel.app`) uses Coinbase x402 on Base mainnet
 * and rejects this payload with `payment_payload_invalid`. Do not use it there.
 * Use `createEip3009Payer` from `xfuel-sdk/onchain` only when you intend to
 * spend real USDC.
 */
export function createMockPayer(opts: { from?: string } = {}): X402Payer {
  return async (challenge) => {
    const a = selectAccept(challenge);
    const nonce = a.extra?.nonce;
    const header = encodePaymentHeader({
      x402Version: challenge.x402Version ?? 1,
      scheme: a.scheme,
      network: a.network,
      asset: a.asset,
      amount: acceptAmount(a),
      payTo: a.payTo ?? null,
      from: opts.from ?? '0xMockPayer',
      nonce,
      mock: true,
      ...catalogEcho(challenge, a),
    });
    return { header, nonce };
  };
}

/**
 * Production payer adapter. You provide `signAuthorization(accept)` — typically an
 * EIP-3009 `transferWithAuthorization` over USDC on Base, signed by YOUR wallet —
 * and the SDK envelopes it into the X-PAYMENT header. The SDK never sees your key.
 *
 * The exact `authorization` object shape follows ZAN's finalized x402 gateway spec;
 * keep your signer aligned with it. Example (pseudo):
 *
 * ```ts
 * const payer = createSignerPayer(async (accept) => wallet.signUsdcTransferAuth({
 *   to: accept.payTo, value: acceptAmount(accept), network: accept.network,
 * }));
 * ```
 */
export function createSignerPayer(
  signAuthorization: (accept: X402Accept) => Promise<Record<string, unknown>>,
): X402Payer {
  if (typeof signAuthorization !== 'function') {
    throw new Error('createSignerPayer requires a signAuthorization(accept) function');
  }
  return async (challenge) => {
    const a = selectAccept(challenge);
    const authorization = await signAuthorization(a);
    const nonce = a.extra?.nonce;
    const header = encodePaymentHeader({
      x402Version: challenge.x402Version ?? 1,
      scheme: a.scheme,
      network: a.network,
      asset: a.asset,
      amount: acceptAmount(a),
      payTo: a.payTo ?? null,
      nonce,
      authorization,
      ...catalogEcho(challenge, a),
    });
    return { header, nonce };
  };
}
