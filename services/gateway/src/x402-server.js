import config from './config.js';
import {
  buildPaymentChallenge,
  verifyPayment,
  settlePayment,
  challengeStore,
} from './x402-adapter.js';
import { quoteTask } from './pricing.js';
import { getHubCatalog, resolveCatalogModel, requestShape } from './hub-catalog.js';

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
  // Default rail is USDC (ADR 0002). TFUEL only when explicitly requested or X402_DEFAULT_RAIL=tfuel.
  const r = (body?.payment?.rail || cfg.defaultRail || 'usdc').toLowerCase();
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

/**
 * Price a task in USDC smallest units.
 *
 * The price is ours to set: it comes from the rate card in pricing.js, metered
 * against the request's own size with a floor. `payment.maxAmount` is the
 * buyer's ceiling, NOT a price — it used to be returned verbatim, which let a
 * buyer name any figure and settle a real 68k-token job for one base unit. A
 * buyer whose ceiling is below the quote simply declines the 402.
 *
 * Metering needs no facilitator change: prompt size and `max_tokens` are both
 * known before the work runs. Quoting output at the ceiling is what the `exact`
 * scheme requires; `upto` would let us settle actual output instead.
 */
export function priceUSDC(body = {}, cfg = config.x402) {
  const quote = quoteTask(body, {
    usdcPrices: cfg.usdcPrices,
    usdcFloor: cfg.usdcFloor ?? cfg.usdcPriceDefault,
    rateCard: cfg.rateCard,
  });
  return quote.amount;
}

/**
 * Price a task against the model that will actually serve it.
 *
 * `priceUSDC` reads `model_id` verbatim, and `xfuel/auto` matches no rate-card
 * row — so an alias request was quoted at the default rate whatever it resolved
 * to. That reopened the exact hole the per-model rows were added to close: an
 * agent-shaped `xfuel/auto` call routes to GLM-5.2, whose measured COGS on a
 * median agent call is ~$0.096, and was being quoted $0.021.
 *
 * Resolution has to happen here rather than in `pricing.js` because it needs the
 * live catalog, and `quoteTask` is deliberately sync and pure. A catalog outage
 * falls back to the requested id, which is the pre-existing behaviour.
 *
 * @returns {Promise<string>} amount in USDC base units
 */
export async function priceUSDCResolved(body = {}, cfg = config.x402) {
  const { body: priced } = await resolvePricingModel(body);
  return priceUSDC(priced, cfg);
}

/**
 * Rewrite a request body so `model_id` names the model that will serve it.
 *
 * @returns {Promise<{body: object, model: string|null, requested: string|null}>}
 *   `model` is null when nothing could be resolved (unknown id, or catalog down),
 *   in which case `body` is returned unchanged.
 */
export async function resolvePricingModel(body = {}) {
  const requested = body?.model_id || body?.model || null;
  if (!requested) return { body, model: null, requested };

  try {
    const { models } = await getHubCatalog();
    const res = resolveCatalogModel(requested, models, {
      modality: 'chat',
      shape: requestShape(body),
    });
    // An unservable model is not repriced — it will fail routing, and quoting it
    // at the default rate is the least surprising thing to do with a request that
    // is about to be rejected anyway.
    if (res.ok) {
      return { body: { ...body, model_id: res.model.id }, model: res.model.id, requested };
    }
  } catch {
    // Never fail a payable request because the catalog poll is down.
  }
  return { body, model: null, requested };
}

/**
 * Run the x402 handshake for a task request. Returns a decision the caller acts on:
 *   { kind:'challenge', body }     → no X-PAYMENT present; reply 402 with this body
 *   { kind:'settled', paymentRef, settledAmount }
 *                                  → payment verified + settled (paymentRef = network:txRef).
 *                                    `settledAmount` is the amount bound to the 402 challenge
 *                                    the buyer paid against — the only figure a receipt may
 *                                    report as gross. Callers must NOT trust `body.amount`.
 *   { kind:'failed', reason }      → verify/settle failed; caller decides fallback vs error
 *
 * @param {Object} req  Express-like request ({ headers, body })
 * @param {{ taskId:string, cfg?:Object, body?:Object }} opts
 *   `body` prices something other than `req.body` verbatim — `/v1` caps `max_tokens`
 *   before serving, and quoting the uncapped figure would bill for output the
 *   caller cannot receive.
 */
export async function runX402Handshake(req, { taskId, cfg = config.x402, body = null } = {}) {
  const priceBody = body || req.body;
  // For the standard x402 facilitator, the URL comes from cfg.facilitatorUrl
  // (falling back to the adapter's public-reference default when null).
  const provider = (cfg.facilitatorProvider || 'zan').toLowerCase() === 'x402' ? 'x402' : 'zan';
  // x402: only facilitatorUrl (null → adapter's public reference). Do NOT fall back
  // to ZAN_X402_GATEWAY_URL — that silently routes live demos through the local mock.
  const gatewayUrl = provider === 'x402' ? (cfg.facilitatorUrl || null) : cfg.gatewayUrl;
  const gwOpts = {
    provider,
    gatewayUrl,
    apiKey: cfg.apiKey,
    store: challengeStore,
    network: cfg.network,
  };
  const paymentHeader = req.headers?.['x-payment'];

  // Step 1 — no payment yet: issue a bound 402 challenge.
  if (!paymentHeader) {
    const amount = await priceUSDCResolved(priceBody, cfg);
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

  // Read the amount bound to this challenge BEFORE settling — settle marks the
  // nonce spent and drops the record. Verify is idempotent and does not.
  const boundAmount = (nonce ? challengeStore.get(nonce)?.amount : null)
    ?? await priceUSDCResolved(priceBody, cfg);

  const s = await settlePayment(paymentHeader, bound);
  if (!s.settled) return { kind: 'failed', reason: s.reason || 'settle_failed' };

  return {
    kind: 'settled',
    paymentRef: `${cfg.network}:${s.txRef}`,
    settledAmount: String(boundAmount),
  };
}
