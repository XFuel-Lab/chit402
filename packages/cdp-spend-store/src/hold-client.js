/**
 * HTTP client for the gateway hold/settle routes. No CDP types here.
 * The same book is what a CDP SpendStore and a plain x402 client call.
 */
import crypto from 'crypto';

import { SpendCapExceeded, SpendHoldError } from './errors.js';
import { assertSandboxGateway } from './networks.js';

/**
 * Stable id for one ledger entry, before the per-attempt suffix.
 * Two identical CDP entries in the same millisecond still get distinct
 * request ids in the book; a retry of the same entry object does not.
 * @param {string} funder
 * @param {{ atomicAmount: bigint, asset: string, network: string, payTo: string, at: number }} entry
 */
export function entryRequestId(funder, entry) {
  const parts = [
    String(funder).toLowerCase(),
    entry.atomicAmount.toString(),
    String(entry.asset),
    String(entry.network),
    String(entry.payTo),
    String(entry.at),
  ];
  return crypto.createHash('sha256').update(parts.join('\n')).digest('hex');
}

function matchKey(entry) {
  return [
    entry.atomicAmount.toString(),
    String(entry.asset).toLowerCase(),
    String(entry.network).toLowerCase(),
    String(entry.payTo).toLowerCase(),
  ].join('|');
}

function resourceFrom(ctx) {
  const resource = ctx?.paymentPayload?.resource || ctx?.paymentRequired?.resource;
  if (typeof resource === 'string') return resource;
  if (resource && typeof resource.url === 'string') return resource.url;
  return null;
}

/**
 * @param {{
 *   gatewayUrl: string,
 *   token: string,
 *   funder: string,
 *   agentId?: number | string | null,
 *   env?: NodeJS.ProcessEnv,
 *   fetchImpl?: typeof fetch,
 * }} options
 */
export function createSpendBook(options) {
  const gateway = assertSandboxGateway(options.gatewayUrl, options.env || process.env);
  const base = gateway.toString().replace(/\/$/, '');
  const token = String(options.token || '');
  if (!token) {
    throw new SpendHoldError('CHIT402_SPEND_HOLD_TOKEN is required', { code: 'token_required' });
  }
  const funder = String(options.funder || '').trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(funder)) {
    throw new SpendHoldError('CHIT402_FUNDER must be a 20-byte address', { code: 'funder_required' });
  }
  const agentId = options.agentId == null || options.agentId === '' ? null : options.agentId;
  const fetchImpl = options.fetchImpl || fetch;
  const idsByObject = new WeakMap();
  /** @type {Map<string, string[]>} */
  const queues = new Map();
  const byPayload = new WeakMap();
  let lastReceipt = null;

  async function request(method, pathname, body) {
    const res = await fetchImpl(`${base}${pathname}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: body == null ? undefined : JSON.stringify(body),
    });
    let payload = null;
    const text = await res.text();
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }
    if (res.status === 409 && payload?.error?.code === 'CEILING_EXCEEDED') {
      throw new SpendCapExceeded(payload);
    }
    if (!res.ok) {
      throw new SpendHoldError(payload?.error?.message || `spend hold ${res.status}`, {
        code: payload?.error?.code || 'spend_hold_error',
        status: res.status,
        body: payload,
      });
    }
    return payload;
  }

  function pushQueue(entry, requestId) {
    const key = matchKey(entry);
    const queue = queues.get(key) || [];
    queue.push(requestId);
    queues.set(key, queue);
  }

  function dropQueue(requestId) {
    for (const [key, queue] of queues) {
      const idx = queue.indexOf(requestId);
      if (idx >= 0) queue.splice(idx, 1);
      if (queue.length === 0) queues.delete(key);
    }
  }

  return {
    funder,
    get lastReceipt() {
      return lastReceipt;
    },
    async load() {
      const body = await request('GET', `/v1/spend/holds?funder=${funder}`);
      return (body.entries || []).map((entry) => ({
        atomicAmount: BigInt(entry.atomicAmount),
        asset: entry.asset,
        network: entry.network,
        payTo: entry.payTo,
        at: Number(entry.at),
      }));
    },
    /**
     * Place a hold. Throws SpendCapExceeded when the funder's cap would
     * break. The same entry object reserves once.
     * @param {{ atomicAmount: bigint, asset: string, network: string, payTo: string, at: number }} entry
     */
    async holdEntry(entry) {
      let requestId = idsByObject.get(entry);
      const fresh = !requestId;
      if (!requestId) {
        requestId = `${entryRequestId(funder, entry)}:${crypto.randomUUID()}`;
        idsByObject.set(entry, requestId);
      }
      await request('POST', '/v1/spend/holds', {
        request_id: requestId,
        amount: entry.atomicAmount.toString(),
        funder,
        network: entry.network,
        asset: entry.asset,
        pay_to: entry.payTo,
        entry_at: entry.at,
      });
      if (fresh) pushQueue(entry, requestId);
      return { requestId };
    },
    async releaseEntry(entry) {
      const requestId = idsByObject.get(entry);
      if (!requestId) return { ok: true, idempotent: true };
      dropQueue(requestId);
      return request('POST', `/v1/spend/holds/${encodeURIComponent(requestId)}/release`);
    },
    /**
     * Bind a signed payload to the oldest unmatched hold for that amount.
     * @param {object} payload
     * @param {object} requirements
     */
    notePayload(payload, requirements) {
      const amount = requirements?.amount ?? requirements?.maxAmountRequired;
      if (amount == null || !payload) return;
      const key = matchKey({
        atomicAmount: BigInt(amount),
        asset: requirements.asset,
        network: requirements.network,
        payTo: requirements.payTo,
      });
      const queue = queues.get(key);
      if (!queue || queue.length === 0) return;
      const requestId = queue.shift();
      if (queue.length === 0) queues.delete(key);
      byPayload.set(payload, requestId);
    },
    /**
     * Success settles and returns `{ verify_url, receipt }`.
     * A failed settle response releases the hold.
     * An ambiguous response leaves the hold until the gateway TTL.
     * @param {object} ctx x402 payment-response context
     */
    async onPaymentResponse(ctx) {
      const settled = ctx?.settleResponse;
      const success = settled?.success === true;
      const failed = (settled !== undefined && settled?.success !== true)
        || ctx?.paymentRequired !== undefined;
      const requestId = ctx?.paymentPayload ? byPayload.get(ctx.paymentPayload) : undefined;
      if (success) {
        if (!requestId) return undefined;
        const body = await request(
          'POST',
          `/v1/spend/holds/${encodeURIComponent(requestId)}/settle`,
          {
            tx: settled.transaction || settled.tx,
            payer: settled.payer,
            resource: resourceFrom(ctx),
            ...(agentId != null ? { agent_id: agentId } : {}),
          },
        );
        const result = {
          verify_url: body.verify_url,
          receipt: body.receipt,
          idempotent: body.idempotent === true,
        };
        lastReceipt = result;
        return result;
      }
      if (failed && requestId) await request('POST', `/v1/spend/holds/${encodeURIComponent(requestId)}/release`);
      return undefined;
    },
  };
}
