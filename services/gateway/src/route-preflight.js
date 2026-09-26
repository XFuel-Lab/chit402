/**
 * Fail closed before x402 settle.
 *
 * Unknown models and an OpenRouter preflight error return here, before
 * `meterV1Request` settles. A later alias table can register through
 * `resolveCatalogModel` — this function only reads the resolved row.
 */

import { getHubCatalog, resolveCatalogModel, requestShape } from './hub-catalog.js';
import { openrouterHouseResaleEnabled, preflightOpenRouter } from './openrouter-infer.js';
import { rateForModel } from './provider-rates.js';

/**
 * @param {object} [body]
 * @param {{ access?: { mode: 'byok'|'house'|'missing', apiKey: string } }} [opts]
 *   `access` is resolved by the gateway from the request. A missing key fails
 *   closed. This function does not read `OPENROUTER_API_KEY` on its own.
 * @returns {Promise<{ ok: true, model: object, requested: string } | { ok: false, status: number, code: string, message: string }>}
 */
export async function preflightBeforeSettle(body = {}, opts = {}) {
  const requested = String(body?.model || body?.model_id || '').trim() || 'xfuel/auto';
  let models = [];
  try {
    ({ models } = await getHubCatalog());
  } catch (err) {
    return {
      ok: false,
      status: 503,
      code: 'catalog_unavailable',
      message: `Model catalog unavailable (${err.message}). The request was not settled.`,
    };
  }

  const resolved = resolveCatalogModel(requested, models, {
    modality: 'chat',
    shape: requestShape(body),
  });
  if (!resolved.ok) {
    return {
      ok: false,
      status: 400,
      code: resolved.reason || 'model_not_found',
      message: resolved.hint || `Unknown model '${requested}'.`,
    };
  }

  if (resolved.model.hub !== 'openrouter') {
    return { ok: true, model: resolved.model, requested };
  }

  const access = opts.access || { mode: 'missing', apiKey: '' };
  const house = access.mode === 'house' && openrouterHouseResaleEnabled() && access.apiKey;
  const byok = access.mode === 'byok' && access.apiKey;
  if (!house && !byok) {
    return {
      ok: false,
      status: 400,
      code: 'openrouter_key_required',
      message: 'Bring your OpenRouter key on X-OpenRouter-Key (or Authorization on an openrouter/ route). '
        + 'Chit charges the $0.002 receipt. Inference is paid by you to OpenRouter. The request was not settled.',
    };
  }

  // House resale quotes upstream tokens, so an unpriced row cannot be sold.
  // BYOK charges the flat receipt and does not need a rate.
  if (house && !rateForModel(resolved.model)) {
    return {
      ok: false,
      status: 400,
      code: 'openrouter_unpriced',
      message: `${resolved.model.id} has no per-token price, so it cannot be quoted. The request was not settled.`,
    };
  }

  const pre = await preflightOpenRouter({ apiKey: access.apiKey });
  if (!pre.ok) {
    return {
      ok: false,
      status: 503,
      code: 'openrouter_preflight_failed',
      message: `OpenRouter preflight failed (${pre.reason}). The request was not settled.`,
    };
  }

  return { ok: true, model: resolved.model, requested };
}
