/**
 * External hold / settle API for clients that are not the chat gateway.
 *
 * Fold into PR #495 (or the commit that follows it). Mounted only when
 * SPEND_HOLD_ENABLED=true, on the same SpendHoldStore the chat door uses.
 * A missing SPEND_HOLD_API_TOKEN fails closed. Networks other than Base
 * Sepolia are rejected. The package never signs; this process does, once.
 *
 *   POST /v1/spend/holds
 *     body: { request_id, amount, funder, network, asset, pay_to, entry_at }
 *     201 hold placed | 200 same request_id | 409 CEILING_EXCEEDED
 *   GET  /v1/spend/holds?funder=0x…
 *     open and consumed entries plus cap, held, spent, remaining
 *   POST /v1/spend/holds/:request_id/release
 *     drops an open hold; consumed holds stay
 *   POST /v1/spend/holds/:request_id/settle
 *     body: { tx, payer, resource, agent_id? }
 *     consumes the hold and returns the stored receipt (verify_url).
 *     A second call returns that same issuer JWS and does not sign again.
 *
 * Caps come from SPEND_HOLD_CEILINGS_JSON, not from the client:
 *   { "0xFunder": { "cap": "1000000" } }
 * The cap is lifetime settled spend plus open holds. It is not CDP's
 * rolling window. Auth: Authorization: Bearer <SPEND_HOLD_API_TOKEN>
 * or X-Chit-Spend-Token.
 *
 * The receipt is a normal issuer-signed Chit402 receipt (payer, payment
 * ref, amount, hub/model). It records the x402 settle response the client
 * reported. It does not read the USDC Transfer log. Unsigned field
 * spend_hold.onchain_check is "not_performed". claim_id is set only when
 * settle includes a positive integer agent_id; otherwise xfuel-verify can
 * refuse the paid receipt for a null book seat.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { ceilingErrorBody, parseAtomic } from './spend-hold.js';
import {
  buildVerifyUrl,
  canonicalSignedClaims,
  explorerUrlForRef,
} from './receipt.js';
import { RECEIPT_CANONICAL_FIELDS, sealCanonicalObject } from './canonical-preimage.js';
import { getIssuerPublicKeyJwk, signJws } from './issuer-key.js';
import { bookNetwork, extractRouteFromResource } from './foreign-x402-ingest.js';
import logger from './logger.js';

export const FUNDER_SCOPE = 'funder';
export const BASE_SEPOLIA_NETWORKS = new Set(['eip155:84532', 'base-sepolia']);
export const BASE_SEPOLIA_USDC = '0x036cbd53842c5426634e7929541ec2318f3dcf7e';
const MAINNET_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const ISSUER_JWKS_URI = 'https://api.chit402.com/.well-known/jwks.json';
const MAX_BODY = 16 * 1024;

/**
 * @param {string | undefined | null} json
 * @returns {Map<string, bigint>}
 */
export function parseCeilings(json) {
  const map = new Map();
  if (json == null || String(json).trim() === '') return map;
  let data;
  try {
    data = JSON.parse(String(json));
  } catch (err) {
    logger.warn({ err: err.message }, 'spend-hold api: ceilings JSON ignored');
    return map;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return map;
  for (const [funder, spec] of Object.entries(data)) {
    const key = normalizeFunder(funder);
    const cap = parseAtomic(spec && typeof spec === 'object' ? spec.cap : spec);
    if (!key || cap == null) continue;
    map.set(key, cap);
  }
  return map;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeFunder(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(s)) return null;
  return s;
}

function replaceFile(target, body) {
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, body);
  try {
    fs.renameSync(tmp, target);
    return;
  } catch {
    /* Windows rename will not replace an existing file. */
  }
  try {
    fs.rmSync(target, { force: true });
    fs.renameSync(tmp, target);
  } catch {
    try {
      fs.copyFileSync(tmp, target);
    } finally {
      try { fs.rmSync(tmp, { force: true }); } catch { /* leftover temp is harmless */ }
    }
  }
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function isSepoliaNetwork(network) {
  return BASE_SEPOLIA_NETWORKS.has(String(network || '').trim().toLowerCase());
}

function isSepoliaUsdc(asset) {
  return String(asset || '').trim().toLowerCase() === BASE_SEPOLIA_USDC;
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(payload);
}

function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return Promise.resolve(req.body);
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('invalid JSON'), { status: 400, code: 'invalid_json' }));
      }
    });
    req.on('error', reject);
  });
}

function requestPath(req) {
  const raw = String(req.originalUrl || req.url || '/').split('?')[0];
  const holdsAt = raw.indexOf('/holds');
  if (holdsAt >= 0) return raw.slice(holdsAt);
  if (raw.startsWith('/receipt/')) return raw;
  const prefix = '/v1/spend';
  if (raw.startsWith(prefix)) return raw.slice(prefix.length) || '/';
  return raw;
}

function funderOfHold(hold, funder) {
  return (hold.ceilings || []).some((leg) => leg.scope === FUNDER_SCOPE && leg.key === funder);
}

/**
 * @param {{
 *   store: import('./spend-hold.js').SpendHoldStore,
 *   token: string,
 *   ceilingsJson?: string,
 *   ceilings?: Map<string, bigint>,
 *   dir?: string | null,
 *   baseUrl?: string,
 * }} opts
 */
export function createSpendHoldService({
  store,
  token,
  ceilingsJson = '',
  ceilings = null,
  dir = null,
  baseUrl = '',
} = {}) {
  if (!store) throw new Error('spend hold service requires a store');
  const caps = ceilings instanceof Map ? ceilings : parseCeilings(ceilingsJson);
  const file = dir ? path.join(dir, 'spend-hold-external.json') : null;
  /** @type {Map<string, object>} */
  const entries = new Map();
  /** @type {Map<string, object>} */
  const receipts = new Map();
  /** @type {Map<string, string>} */
  const taskIndex = new Map();
  let tail = Promise.resolve();

  if (file) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const [id, entry] of Object.entries(saved.entries || {})) entries.set(id, entry);
      for (const [id, receipt] of Object.entries(saved.receipts || {})) {
        receipts.set(id, receipt);
        if (receipt?.task_id) taskIndex.set(String(receipt.task_id), id);
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn({ err: err.message }, 'spend-hold api: meta load failed');
      }
    }
  }

  function persist() {
    if (!file) return;
    const body = JSON.stringify({
      entries: Object.fromEntries(entries),
      receipts: Object.fromEntries(receipts),
    });
    replaceFile(file, body);
  }

  function lock(fn) {
    const run = tail.then(fn, fn);
    tail = run.then(() => undefined, () => undefined);
    return run;
  }

  function authorized(req) {
    if (!token) return false;
    const header = String(req.headers?.authorization || '');
    const bearer = header.replace(/^Bearer\s+/i, '').trim();
    const alt = String(req.headers?.['x-chit-spend-token'] || '').trim();
    const presented = bearer || alt;
    if (!presented) return false;
    return timingSafeEqual(presented, token);
  }

  function statusFor(funder, holds) {
    const cap = caps.get(funder);
    let held = 0n;
    let spent = 0n;
    for (const hold of holds) {
      if (!funderOfHold(hold, funder)) continue;
      if (hold.state === 'open') held += BigInt(hold.reserved);
      if (hold.state === 'consumed' && hold.consumed_amount != null) {
        spent += BigInt(hold.consumed_amount);
      }
    }
    const committed = held + spent;
    const remaining = cap != null && cap > committed ? cap - committed : 0n;
    return {
      cap: cap == null ? null : cap.toString(),
      held: held.toString(),
      spent: spent.toString(),
      remaining: cap == null ? null : remaining.toString(),
    };
  }

  async function list(funder) {
    const holds = await store.snapshot();
    const rows = [];
    for (const hold of holds) {
      if (!funderOfHold(hold, funder)) continue;
      const meta = entries.get(hold.request_id);
      if (!meta) continue;
      rows.push({
        request_id: hold.request_id,
        atomicAmount: meta.atomicAmount,
        asset: meta.asset,
        network: meta.network,
        payTo: meta.payTo,
        at: meta.at,
        state: hold.state,
      });
    }
    return { entries: rows, ...statusFor(funder, holds) };
  }

  function issueReceipt({ requestId, hold, body, req }) {
    const meta = entries.get(requestId);
    const tx = String(body.tx || body.transaction || '').trim();
    const payer = normalizeFunder(body.payer);
    const resource = String(body.resource || '').trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(tx)) {
      return { ok: false, status: 400, error: { code: 'tx_required', message: 'settle requires a Base Sepolia tx hash' } };
    }
    if (!payer) {
      return { ok: false, status: 400, error: { code: 'payer_required', message: 'settle requires the payer address' } };
    }
    let resourceUrl;
    try {
      resourceUrl = new URL(resource);
    } catch {
      return { ok: false, status: 400, error: { code: 'resource_required', message: 'settle requires an http(s) resource URL' } };
    }
    const host = resourceUrl.hostname.toLowerCase();
    const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (resourceUrl.protocol !== 'https:' && !(resourceUrl.protocol === 'http:' && local)) {
      return { ok: false, status: 400, error: { code: 'resource_required', message: 'resource must be https, or http on localhost' } };
    }
    const route = extractRouteFromResource(resourceUrl.toString());
    const network = bookNetwork(meta?.network || 'base-sepolia');
    const amount = hold.reserved;
    const agentId = body.agent_id == null || body.agent_id === '' ? null : Number(body.agent_id);
    const claimId = Number.isInteger(agentId) && agentId >= 1 ? String(agentId) : null;
    const taskId = `xfuel-${crypto.randomUUID()}`;
    const paymentRef = `${network}:${tx}`;
    const configured = String(baseUrl || '').replace(/\/$/, '');
    const hostHeader = String(req.headers?.host || '');
    const localGateway = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(hostHeader);
    const publicBase = configured || (localGateway ? `http://${hostHeader}` : '');
    const draft = {
      schema: 'xfuel.receipt.v3',
      task_id: taskId,
      status: 'completed',
      proof_outcome: 'signed',
      source: 'spend_hold_settle',
      created_at: new Date().toISOString(),
      claim_id: claimId,
      payment: {
        rail: 'usdc',
        ref: paymentRef,
        network,
        collected: true,
        gross_amount: amount,
        settled_amount: amount,
        asset: meta?.asset || BASE_SEPOLIA_USDC,
        payee: meta?.payTo || null,
        payer,
      },
      caller_binding: {
        payer_wallet: payer,
        agent_pubkey: null,
        api_key_hash: null,
      },
      route: {
        model: route.model,
        hub: route.hub,
        provider: route.hub,
        resource: resourceUrl.toString(),
      },
      spend_hold: {
        onchain_check: 'not_performed',
        evidence: 'x402_settle_response',
        request_id: requestId,
      },
    };
    const claims = canonicalSignedClaims(draft);
    const sealed = sealCanonicalObject(claims, RECEIPT_CANONICAL_FIELDS);
    const { jws, kid } = signJws(sealed.claims, { jku: ISSUER_JWKS_URI });
    const verifyUrl = buildVerifyUrl(publicBase, taskId);
    const receipt = {
      ...draft,
      verify_url: verifyUrl,
      links: {
        self: verifyUrl,
        explorer: explorerUrlForRef(paymentRef),
      },
      issuer_signature: {
        alg: 'ES256',
        payload_version: sealed.claims.payload_version,
        kid,
        jws,
        issuer_jwk: getIssuerPublicKeyJwk(),
        hash_alg: sealed.hash_alg,
        payload_hash: sealed.payload_hash,
        canonical_preimage: sealed.preimage,
      },
      verification: {
        source_of_truth: 'issuer_signature.jws',
        jwks_uri: ISSUER_JWKS_URI,
      },
    };
    receipts.set(requestId, receipt);
    taskIndex.set(taskId, requestId);
    persist();
    return { ok: true, receipt };
  }

  async function handle(req, res) {
    try {
      const method = String(req.method || 'GET').toUpperCase();
      const pathname = requestPath(req);
      const publicReceipt = method === 'GET' && pathname.startsWith('/receipt/');
      if (!publicReceipt && !authorized(req)) {
        const code = token ? 'unauthorized' : 'spend_hold_token_unset';
        json(res, token ? 401 : 503, {
          error: {
            code,
            message: token
              ? 'SPEND_HOLD_API_TOKEN is required'
              : 'SPEND_HOLD_ENABLED is on but SPEND_HOLD_API_TOKEN is unset',
          },
        });
        return;
      }
      const url = new URL(req.url || '/', 'http://127.0.0.1');

      if (method === 'GET' && pathname.startsWith('/receipt/')) {
        const taskId = decodeURIComponent(pathname.slice('/receipt/'.length)).replace(/\.json$/, '');
        const found = lookup(taskId);
        if (!found) {
          json(res, 404, { error: { code: 'not_found', message: 'receipt not found' } });
          return;
        }
        json(res, 200, found);
        return;
      }

      if (method === 'GET' && (pathname === '/holds' || pathname === '/holds/')) {
        const funder = normalizeFunder(url.searchParams.get('funder'));
        if (!funder) {
          json(res, 400, { error: { code: 'funder_required', message: 'funder must be a 20-byte address' } });
          return;
        }
        if (!caps.has(funder)) {
          json(res, 404, { error: { code: 'no_ceiling', message: 'no cap is configured for this funder' } });
          return;
        }
        json(res, 200, await list(funder));
        return;
      }

      const releaseMatch = pathname.match(/^\/holds\/([^/]+)\/release\/?$/);
      const settleMatch = pathname.match(/^\/holds\/([^/]+)\/settle\/?$/);

      if (method === 'POST' && releaseMatch) {
        const requestId = decodeURIComponent(releaseMatch[1]);
        const result = await lock(() => store.release(requestId));
        if (!result.ok && result.code === 'hold_not_found') {
          json(res, 200, { ok: true, idempotent: true, released: false });
          return;
        }
        json(res, result.ok ? 200 : 409, result);
        return;
      }

      if (method === 'POST' && settleMatch) {
        const requestId = decodeURIComponent(settleMatch[1]);
        const body = await readBody(req);
        const outcome = await lock(async () => {
          const cached = receipts.get(requestId);
          if (cached) {
            await store.consume(requestId, cached.payment?.gross_amount ?? null);
            return { status: 200, body: { ok: true, idempotent: true, receipt: cached, verify_url: cached.verify_url } };
          }
          const holds = await store.snapshot();
          const hold = holds.find((row) => row.request_id === requestId);
          if (!hold) {
            return { status: 404, body: { error: { code: 'hold_not_found', message: 'no hold for this request_id' } } };
          }
          if (hold.state !== 'open') {
            return { status: 409, body: { error: { code: 'hold_not_open', message: 'hold is not open', state: hold.state } } };
          }
          const issued = issueReceipt({ requestId, hold, body, req });
          if (!issued.ok) return { status: issued.status, body: { error: issued.error } };
          const consumed = await store.consume(requestId, hold.reserved);
          if (!consumed.ok && consumed.code !== 'hold_not_found') {
            return {
              status: 200,
              body: {
                ok: true,
                idempotent: false,
                receipt: issued.receipt,
                verify_url: issued.receipt.verify_url,
                consume: consumed,
              },
            };
          }
          return {
            status: 200,
            body: { ok: true, idempotent: false, receipt: issued.receipt, verify_url: issued.receipt.verify_url },
          };
        });
        json(res, outcome.status, outcome.body);
        return;
      }

      if (method === 'POST' && (pathname === '/holds' || pathname === '/holds/')) {
        const body = await readBody(req);
        const outcome = await lock(async () => place(body));
        json(res, outcome.status, outcome.body);
        return;
      }

      json(res, 404, { error: { code: 'not_found', message: 'unknown spend-hold route' } });
    } catch (err) {
      const status = err.status || 500;
      json(res, status, { error: { code: err.code || 'internal', message: status === 500 ? 'spend hold failed' : err.message } });
    }
  }

  async function place(body) {
    const funder = normalizeFunder(body?.funder);
    const requestId = String(body?.request_id || '').trim();
    const amount = parseAtomic(body?.amount);
    const network = String(body?.network || '').trim();
    const asset = String(body?.asset || '').trim();
    const payTo = normalizeFunder(body?.pay_to || body?.payTo);
    const at = Number(body?.entry_at ?? body?.at);
    if (!funder) {
      return { status: 400, body: { error: { code: 'funder_required', message: 'funder must be a 20-byte address' } } };
    }
    if (!requestId || requestId.length > 200) {
      return { status: 400, body: { error: { code: 'request_id_required', message: 'request_id is required' } } };
    }
    if (!isSepoliaNetwork(network) || String(asset).toLowerCase() === MAINNET_USDC || !isSepoliaUsdc(asset)) {
      return {
        status: 400,
        body: {
          error: {
            code: 'testnet_only',
            message: 'spend holds accept Base Sepolia (eip155:84532) and Sepolia USDC only',
          },
        },
      };
    }
    if (!payTo) {
      return { status: 400, body: { error: { code: 'pay_to_required', message: 'pay_to must be a 20-byte address' } } };
    }
    if (!Number.isFinite(at)) {
      return { status: 400, body: { error: { code: 'entry_at_required', message: 'entry_at must be a finite number' } } };
    }
    const cap = caps.get(funder);
    if (cap == null) {
      return { status: 403, body: { error: { code: 'no_ceiling', message: 'no cap is configured for this funder' } } };
    }
    if (amount == null || amount <= 0n) {
      return { status: 400, body: { error: { code: 'invalid_amount', message: 'amount must be a positive atomic integer' } } };
    }
    const result = await store.reserve({
      requestId,
      amount,
      ceilings: [{ scope: FUNDER_SCOPE, key: funder, cap }],
    });
    if (!result.ok) {
      return { status: 409, body: ceilingErrorBody(result) };
    }
    if (!entries.has(requestId)) {
      entries.set(requestId, {
        atomicAmount: amount.toString(),
        asset: asset.toLowerCase(),
        network: network.toLowerCase(),
        payTo,
        at,
        funder,
      });
      persist();
    }
    return {
      status: result.idempotent ? 200 : 201,
      body: { ok: true, idempotent: !!result.idempotent, hold: result.hold },
    };
  }

  function lookup(taskId) {
    const id = taskIndex.get(String(taskId || ''));
    if (!id) return null;
    return receipts.get(id) || null;
  }

  return { handle, lookup, ceilings: caps };
}

export default createSpendHoldService;
