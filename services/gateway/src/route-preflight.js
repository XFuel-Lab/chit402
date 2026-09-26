/**
 * Fail closed before x402 settle.
 *
 * Unknown models and an OpenRouter preflight error return here, before
 * `meterV1Request` settles. A later alias table can register through
 * `resolveCatalogModel` — this function only reads the resolved row.
 */

import { getHubCatalog, resolveCatalogModel, requestShape } from './hub-catalog.js';
import { preflightOpenRouter } from './openrouter-infer.js';
import { rateForModel } from './provider-rates.js';

/**
 * @param {object} [body]
 * @returns {Promise<{ ok: true, model: object, requested: string } | { ok: false, status: number, code: string, message: string }>}
 */
export async function preflightBeforeSettle(body = {}) {
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

  if (!rateForModel(resolved.model)) {
    return {
      ok: false,
      status: 400,
      code: 'openrouter_unpriced',
      message: `${resolved.model.id} has no per-token price, so it cannot be quoted. The request was not settled.`,
    };
  }

  const pre = await preflightOpenRouter();
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
