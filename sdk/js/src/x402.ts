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
  maxAmountRequired: string;
  resource?: string;
  payTo?: string | null;
  mimeType?: string;
  description?: string;
  extra?: { taskId?: string; nonce?: string; expiresAt?: number | null };
}

/** The body of a 402 Payment Required response from `POST /task-request`. */
export interface X402Challenge {
  x402Version: number;
  error?: string;
  accepts: X402Accept[];
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

/**
 * Dev/test payer. Produces a structured X-PAYMENT blob that echoes the challenge
 * (nonce/amount/payTo). Works end-to-end against the mock facilitator
 * (`backend/theta-bridge/src/x402-mock-facilitator.js`), which accepts any
 * well-formed payment.
 *
 * ⚠️ NOT for mainnet — it does not move real funds. Use `createSignerPayer` in prod.
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
      amount: a.maxAmountRequired,
      payTo: a.payTo ?? null,
      from: opts.from ?? '0xMockPayer',
      nonce,
      mock: true,
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
 *   to: accept.payTo, value: accept.maxAmountRequired, network: accept.network,
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
      amount: a.maxAmountRequired,
      payTo: a.payTo ?? null,
      nonce,
      authorization,
    });
    return { header, nonce };
  };
}
