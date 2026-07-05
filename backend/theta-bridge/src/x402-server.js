import config from './config.js';
import {
  buildPaymentChallenge,
  verifyPayment,
  settlePayment,
  priceTaskUSDC,
  challengeStore,
} from './x402-adapter.js';

/**
 * Server-side x402 handshake glue for POST /task-request.
 *
 * Kept in its own module so the 402 wiring in server.js is a small, cleanly
 * REVERSIBLE block (one import + one gate). All behavior is gated by
 * config.x402.enabled at the call site; TFUEL remains the fallback.
 *
 * The `cfg` param defaults to config.x402 but can be injected for tests (so the
 * full loop can run against the mock facilitator without env/import ordering).
 */

/** Resolve the payment rail for a request: "usdc" | "tfuel". */
export function resolveRail(body = {}, cfg = config.x402) {
  const r = (body?.payment?.rail || cfg.defaultRail || 'tfuel').toLowerCase();
  return r === 'usdc' ? 'usdc' : 'tfuel';
}

function decodeBase64Json(s) {
  try { return JSON.parse(Buffer.from(s, 'base64').toString('utf8')); } catch { return null; }
}

/**
 * Recover the challenge nonce the client is paying against. Accepts an explicit
 * `X-Payment-Nonce` header, or a `nonce` field inside a JSON / base64-JSON
 * `X-Payment` blob.
 */
export function extractPaymentNonce(req) {
  const explicit = req.headers?.['x-payment-nonce'];
  if (explicit && typeof explicit === 'string') return explicit.trim();
  const p = req.headers?.['x-payment'];
  if (p && typeof p === 'string') {
    try { const j = JSON.parse(p); if (j?.nonce) return String(j.nonce); } catch { /* not json */ }
    const b = decodeBase64Json(p);
    if (b?.nonce) return String(b.nonce);
  }
  return null;
}

/** Price a task in USDC smallest units (client `payment.maxAmount` caps it if provided). */
export function priceUSDC(body = {}, cfg = config.x402) {
  if (body?.payment?.maxAmount) return String(body.payment.maxAmount);
  return priceTaskUSDC(
    { model: body?.model_id },
    { prices: cfg.usdcPrices, default: cfg.usdcPriceDefault },
  );
}

/**
 * Run the x402 handshake for a task request. Returns a decision the caller acts on:
 *   { kind:'challenge', body }     → no X-PAYMENT present; reply 402 with this body
 *   { kind:'settled', paymentRef } → payment verified + settled (paymentRef = network:txRef)
 *   { kind:'failed', reason }      → verify/settle failed; caller decides fallback vs error
 *
 * @param {Object} req  Express-like request ({ headers, body })
 * @param {{ taskId:string, cfg?:Object }} opts
 */
export async function runX402Handshake(req, { taskId, cfg = config.x402 } = {}) {
  const gwOpts = { gatewayUrl: cfg.gatewayUrl, apiKey: cfg.apiKey, store: challengeStore };
  const paymentHeader = req.headers?.['x-payment'];

  // Step 1 — no payment yet: issue a bound 402 challenge.
  if (!paymentHeader) {
    const amount = priceUSDC(req.body, cfg);
    const { body } = buildPaymentChallenge(
      { taskId, maxAmountRequired: amount, network: cfg.network, asset: cfg.asset, payTo: cfg.payTo },
      { store: challengeStore },
    );
    return { kind: 'challenge', body };
  }

  // Step 2 — payment present: verify (binding) then settle (marks nonce spent).
  const nonce = extractPaymentNonce(req);
  const bound = { ...gwOpts, nonce };

  const v = await verifyPayment(paymentHeader, bound);
  if (!v.valid) return { kind: 'failed', reason: v.reason || 'verify_failed' };

  const s = await settlePayment(paymentHeader, bound);
  if (!s.settled) return { kind: 'failed', reason: s.reason || 'settle_failed' };

  return { kind: 'settled', paymentRef: `${cfg.network}:${s.txRef}` };
}
