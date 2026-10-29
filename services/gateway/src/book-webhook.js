import crypto from 'crypto';
import fs from 'node:fs';
import path from 'node:path';
import logger from './logger.js';
import { deriveEvidence, BOOK_EVIDENCE } from './usage-settled.js';
import { buildVerifyUrl, explorerUrlForRef } from './receipt.js';
import { testSwitchesOn } from './test-switch.js';
import { persistFailed } from './persist-error.js';
import { writeAtomicJsonFile } from './atomic-json-file.js';

/** Signed envelope schema for treasury desk push. */
export const BOOK_WEBHOOK_SCHEMA = 'chit402.book_webhook.v1';

/** Book row events integrators can subscribe to. */
export const BOOK_WEBHOOK_EVENTS = Object.freeze({
  SETTLE: 'settle',
  INFLOW: 'inflow',
  POLICY_BLOCKED: 'policy_blocked',
  COLLECTED: 'collected',
});

const VALID_EVENTS = new Set(Object.values(BOOK_WEBHOOK_EVENTS));

function rejectWebhookRow() {
  throw persistFailed(new Error('bad webhook row'), 'book-webhook: load failed');
}

/** Rebuild one stored row or refuse the file. Events stay in file order. */
function validateStoredWebhook(key, row) {
  const id = Number(key);
  if (!Number.isInteger(id) || id < 1 || String(id) !== key) rejectWebhookRow();
  if (!row || typeof row !== 'object' || Array.isArray(row) || row.agent_id !== id) rejectWebhookRow();
  if (typeof row.url !== 'string') rejectWebhookRow();
  try {
    validateWebhookUrl(row.url);
  } catch {
    rejectWebhookRow();
  }
  if (typeof row.secret !== 'string' || row.secret.length < 1) rejectWebhookRow();
  if (!Array.isArray(row.events)) rejectWebhookRow();
  const events = new Set();
  for (const event of row.events) {
    if (!VALID_EVENTS.has(event) || events.has(event)) rejectWebhookRow();
    events.add(event);
  }
  if (typeof row.enabled !== 'boolean') rejectWebhookRow();
  if (!Number.isInteger(row.createdAt) || !Number.isInteger(row.updatedAt)) rejectWebhookRow();
  if (!Number.isInteger(row.deliveries) || row.deliveries < 0) rejectWebhookRow();
  if (!Number.isInteger(row.failures) || row.failures < 0) rejectWebhookRow();
  if (!(row.lastStatus === null || Number.isInteger(row.lastStatus))) rejectWebhookRow();
  if (!(row.lastError === null || typeof row.lastError === 'string')) rejectWebhookRow();
  return {
    agent_id: id,
    url: row.url,
    secret: row.secret,
    events,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deliveries: row.deliveries,
    failures: row.failures,
    lastStatus: row.lastStatus,
    lastError: row.lastError,
  };
}

/**
 * Per-agent webhook registry.
 * One webhook URL per agent_id — treasury desk endpoint registered via possession session.
 * When persist is on, the map is book-webhooks.json in the agents dir.
 */
export class BookWebhookRegistry {
  /**
   * @param {{ dir?: string|null, persist?: boolean, fs?: typeof import('node:fs') }} [opts]
   */
  constructor({ dir = null, persist = false, fs: fsImpl = fs } = {}) {
    this.dir = persist && dir ? String(dir) : null;
    this.persist = !!this.dir;
    this._fs = fsImpl;
    /** @type {Map<number, object>} */
    this._hooks = new Map();
    if (this.persist) {
      try {
        this._fs.mkdirSync(this.dir, { recursive: true });
        this._load();
      } catch (err) {
        throw err?.code === 'persist_failed' ? err : persistFailed(err, 'book-webhook: mkdir failed');
      }
    }
  }

  _file() {
    return path.join(this.dir, 'book-webhooks.json');
  }

  _load() {
    let raw;
    try {
      raw = this._fs.readFileSync(this._file(), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw persistFailed(err, 'book-webhook: load failed');
    }
    let snap;
    try {
      snap = JSON.parse(raw);
    } catch (err) {
      throw persistFailed(err, 'book-webhook: load failed');
    }
    if (!snap || typeof snap !== 'object' || Array.isArray(snap) || snap.version !== 1) {
      throw persistFailed(new Error('book-webhook shape'), 'book-webhook: load failed');
    }
    const webhooks = snap.webhooks;
    if (!webhooks || typeof webhooks !== 'object' || Array.isArray(webhooks)) {
      throw persistFailed(new Error('webhooks map missing'), 'book-webhook: load failed');
    }
    for (const [key, row] of Object.entries(webhooks)) {
      const hook = validateStoredWebhook(key, row);
      this._hooks.set(hook.agent_id, hook);
    }
  }

  _save() {
    if (!this.persist) return;
    const webhooks = {};
    for (const [key, hook] of this._hooks) {
      webhooks[String(key)] = {
        agent_id: hook.agent_id,
        url: hook.url,
        secret: hook.secret,
        events: [...hook.events],
        enabled: hook.enabled !== false,
        createdAt: hook.createdAt,
        updatedAt: hook.updatedAt,
        deliveries: hook.deliveries,
        failures: hook.failures,
        lastStatus: hook.lastStatus ?? null,
        lastError: hook.lastError ?? null,
      };
    }
    writeAtomicJsonFile(this._file(), JSON.stringify({ version: 1, webhooks }), {
      fs: this._fs,
      label: 'book-webhook: save failed',
    });
  }

  /**
   * @param {number|string} agentId
   * @param {{ url: string, secret?: string|null, events?: string[]|null }} input
   * @returns {{ config: object, secret_once?: string }}
   */
  upsert(agentId, { url, secret, events }) {
    const id = Number(agentId);
    if (!Number.isInteger(id) || id < 1) {
      throw new Error('invalid agent_id');
    }
    validateWebhookUrl(url);

    const normalizedEvents = normalizeBookWebhookEvents(events);
    const existing = this._hooks.get(id);
    const now = Date.now();
    let generatedSecret = null;
    let hookSecret = secret != null && String(secret).trim() !== ''
      ? String(secret)
      : (existing?.secret || null);
    if (!hookSecret) {
      hookSecret = crypto.randomBytes(32).toString('hex');
      generatedSecret = hookSecret;
    }

    const hook = {
      agent_id: id,
      url,
      secret: hookSecret,
      events: normalizedEvents,
      enabled: true,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      deliveries: existing?.deliveries || 0,
      failures: existing?.failures || 0,
      lastStatus: existing?.lastStatus || null,
      lastError: existing?.lastError || null,
    };
    const had = this._hooks.has(id);
    const prior = had ? this._hooks.get(id) : undefined;
    this._hooks.set(id, hook);
    try {
      this._save(); // upsert persist
    } catch (err) {
      if (had) this._hooks.set(id, prior);
      else this._hooks.delete(id);
      logger.warn({ agent_id: id, code: 'book_webhook_save_failed' }, 'book webhook save failed');
      throw err;
    }
    const out = { config: publicBookWebhookConfig(hook) };
    if (generatedSecret) out.secret_once = generatedSecret;
    return out;
  }

  /** @returns {object|null} internal hook (includes secret) */
  get(agentId) {
    const id = Number(agentId);
    if (!Number.isInteger(id) || id < 1) return null;
    return this._hooks.get(id) || null;
  }

  /** @returns {object|null} redacted public config */
  getPublic(agentId) {
    const hook = this.get(agentId);
    if (!hook) return null;
    return publicBookWebhookConfig(hook);
  }

  /** @returns {object|null} redacted config that was removed */
  remove(agentId) {
    const id = Number(agentId);
    const hook = this._hooks.get(id);
    if (!hook) return null;
    this._hooks.delete(id);
    try {
      this._save(); // remove persist
    } catch (err) {
      this._hooks.set(id, hook);
      logger.warn({ agent_id: id, code: 'book_webhook_save_failed' }, 'book webhook save failed');
      throw err;
    }
    return publicBookWebhookConfig(hook);
  }

  /**
   * Persist delivery counters for the hook the delivery was scheduled for.
   * A late result for a deleted or replaced hook is ignored.
   * A failed counter write is logged and does not throw.
   * @param {number|string} agentId
   * @param {object} hookRef
   * @param {{ ok?: boolean, status?: number|null, error?: string|null, threw?: boolean }} result
   */
  recordDelivery(agentId, hookRef, result) {
    const id = Number(agentId);
    let current = this._hooks.get(id);
    if (current !== hookRef) return;
    const priorDeliveries = current.deliveries;
    const priorFailures = current.failures;
    const priorStatus = current.lastStatus;
    const priorError = current.lastError;
    if (result?.ok) {
      current.deliveries += 1;
      current.lastStatus = result.status ?? null;
      current.lastError = null;
    } else if (result?.threw) {
      current.failures += 1;
      current.lastError = result.error || null;
    } else {
      current.failures += 1;
      current.lastStatus = result?.status ?? null;
      current.lastError = result?.error || null;
    }
    try {
      this._save(); // counter persist
    } catch {
      current.deliveries = priorDeliveries;
      current.failures = priorFailures;
      current.lastStatus = priorStatus;
      current.lastError = priorError;
      logger.warn({ agent_id: id, code: 'book_webhook_counter_persist_failed' }, 'book webhook counter persist failed');
    }
  }
}

let _registry = null;
export function getBookWebhookRegistry() {
  if (!_registry) _registry = new BookWebhookRegistry();
  return _registry;
}

export function resetBookWebhookRegistry(next = null) {
  _registry = next || null;
}

/** HTTPS only; localhost allowed only in NODE_ENV=test. */
export function validateWebhookUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('url is required');
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('url must be a valid absolute URL');
  }
  const isTest = testSwitchesOn();
  if (parsed.protocol === 'http:') {
    if (!isTest) throw new Error('url must use https');
  } else if (parsed.protocol !== 'https:') {
    throw new Error('url must use https');
  }
  const host = parsed.hostname.toLowerCase();
  if (!isTest && (host === 'localhost' || host === '127.0.0.1' || host === '::1')) {
    throw new Error('localhost urls are not allowed');
  }
}

/** @param {string[]|undefined|null} events */
export function normalizeBookWebhookEvents(events) {
  if (!events || (Array.isArray(events) && events.length === 0)) {
    return new Set(VALID_EVENTS);
  }
  const list = Array.isArray(events) ? events : [events];
  const out = new Set();
  for (const e of list) {
    if (!VALID_EVENTS.has(e)) {
      throw new Error(`unknown event "${e}"; valid: ${[...VALID_EVENTS].join(', ')}`);
    }
    out.add(e);
  }
  return out;
}

function publicBookWebhookConfig(hook) {
  let urlHost = null;
  let urlPath = null;
  try {
    const u = new URL(hook.url);
    urlHost = u.host;
    urlPath = u.pathname + u.search;
  } catch {
    urlHost = null;
  }
  return {
    agent_id: hook.agent_id,
    enabled: hook.enabled !== false,
    url_host: urlHost,
    url_path: urlPath,
    events: [...hook.events],
    has_secret: !!hook.secret,
    createdAt: hook.createdAt,
    updatedAt: hook.updatedAt,
    deliveries: hook.deliveries,
    failures: hook.failures,
    lastStatus: hook.lastStatus,
    lastError: hook.lastError,
  };
}

/**
 * Map a ledger row to a webhook event name.
 * @param {object} entry
 * @returns {string|null}
 */
export function bookWebhookEventOf(entry) {
  const evidence = deriveEvidence(entry);
  if (evidence === BOOK_EVIDENCE.POLICY_BLOCKED) return BOOK_WEBHOOK_EVENTS.POLICY_BLOCKED;
  if (evidence === BOOK_EVIDENCE.INFLOW_CLAIMED) return BOOK_WEBHOOK_EVENTS.INFLOW;
  if (evidence === BOOK_EVIDENCE.RECORDED_BY_SETTLE
    || evidence === BOOK_EVIDENCE.ARRIVAL_UNVERIFIED) {
    return BOOK_WEBHOOK_EVENTS.SETTLE;
  }
  if (evidence === BOOK_EVIDENCE.COLLECTED) return BOOK_WEBHOOK_EVENTS.COLLECTED;
  return null;
}

/**
 * Build a flat envelope aligned with book export columns (hemei specimen shape).
 * @param {object} entry — ledger row (final state)
 * @param {string} baseUrl
 * @param {{ deliveryId?: string }} [opts]
 */
export function buildBookWebhookEnvelope(entry, baseUrl, { deliveryId = null } = {}) {
  const event = bookWebhookEventOf(entry);
  if (!event) return null;

  const evidence = deriveEvidence(entry);
  const isBlocked = evidence === BOOK_EVIDENCE.POLICY_BLOCKED;
  const hideAmount = evidence === BOOK_EVIDENCE.UNVERIFIED
    || evidence === BOOK_EVIDENCE.ARRIVAL_UNVERIFIED;

  const taskId = entry.task_id;
  const paymentRef = entry.payment_ref ?? null;
  const verifyUrl = buildVerifyUrl(baseUrl, taskId);
  const explorerUrl = explorerUrlForRef(paymentRef) || null;

  const delivery_id = deliveryId || crypto.createHash('sha256')
    .update(`${entry.agent_id}:${taskId}:${event}:${entry.recorded_at || entry.collected_at || ''}`)
    .digest('hex')
    .slice(0, 32);

  const envelope = {
    schema: BOOK_WEBHOOK_SCHEMA,
    delivery_id,
    event,
    agent_id: Number(entry.agent_id),
    task_id: taskId,
    receipt_id: taskId,
    evidence,
    collected_at: entry.collected_at || entry.recorded_at || null,
    hub: entry.hub || null,
    model: entry.model || null,
    amount: hideAmount ? null : (entry.amount ?? null),
    payment_ref: paymentRef,
    rail: entry.rail ?? null,
    bucket: entry.bucket || entry.inflow_claim?.bucket || null,
    payer_wallet: entry.payer || null,
    intent_id: entry.intent_id || null,
    attempt_index: entry.attempt_index ?? null,
    replay_count: entry.replay_events?.length ?? null,
    verify_url: verifyUrl,
    explorer_url: explorerUrl,
    emitted_at: new Date().toISOString(),
  };

  if (isBlocked) {
    envelope.policy_code = entry.policy_code || 'policy_blocked';
    envelope.reason = entry.reason || null;
    envelope.collected = false;
    if (entry.amount_requested != null) envelope.amount_requested = String(entry.amount_requested);
    if (entry.refusal?.refusal_id) {
      envelope.refusal_id = entry.refusal.refusal_id;
      const root = baseUrl ? String(baseUrl).replace(/\/$/, '') : '';
      envelope.refusal_verify_url = `${root}/refusal/${encodeURIComponent(entry.refusal.refusal_id)}`;
    }
    if (entry.policy_key) envelope.policy_key = entry.policy_key;
    if (entry.spent_atomic != null) envelope.spent_atomic = String(entry.spent_atomic);
    if (entry.cap_atomic != null) envelope.cap_atomic = String(entry.cap_atomic);
    if (entry.period_start) envelope.period_start = entry.period_start;
  } else if (entry.inflow_claim) {
    envelope.inflow_claim = entry.inflow_claim;
    envelope.collected = entry.collected === true;
  } else if (evidence === BOOK_EVIDENCE.RECORDED_BY_SETTLE) {
    envelope.recorded_by = 'settle';
    envelope.arrival_status = entry.arrival_status || 'pending';
    envelope.collected = false;
  } else {
    envelope.collected = entry.collected === true;
  }

  return envelope;
}

/**
 * POST a signed envelope. Headers: X-Chit-Signature (+ X-XFuel-Signature alias).
 * @returns {Promise<{ ok: boolean, status: number|null, error?: string }>}
 */
export async function deliverBookWebhook(url, envelope, secret, ref = '') {
  const body = JSON.stringify(envelope);
  const headers = {
    'Content-Type': 'application/json',
    'X-Chit-Event': envelope?.event || '',
    'X-XFuel-Event': envelope?.event || '',
  };

  if (secret) {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(body);
    const sig = `sha256=${hmac.digest('hex')}`;
    headers['X-Chit-Signature'] = sig;
    headers['X-XFuel-Signature'] = sig;
  }

  const attempts = 2;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        return { ok: true, status: res.status };
      }
      lastError = `HTTP ${res.status}`;
      logger.warn({ url, status: res.status, attempt, ref, agentId: envelope?.agent_id }, 'Book webhook non-2xx');
    } catch (err) {
      lastError = err.message?.slice(0, 160) || 'delivery error';
      logger.warn({ url, attempt, ref, err: lastError, agentId: envelope?.agent_id }, 'Book webhook delivery failed');
    }
    if (attempt < attempts) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  return { ok: false, status: null, error: lastError };
}

/**
 * Fire webhook asynchronously — never blocks the settle path.
 * @param {object} entry
 * @param {{ registry?: BookWebhookRegistry, baseUrl?: string }} deps
 */
export function scheduleBookWebhook(entry, { registry, baseUrl } = {}) {
  if (!entry || entry.agent_id == null) return;
  const reg = registry || getBookWebhookRegistry();
  const hook = reg.get(entry.agent_id);
  if (!hook?.url || hook.enabled === false) return;

  const event = bookWebhookEventOf(entry);
  if (!event || !hook.events.has(event)) return;

  const url = baseUrl || process.env.PUBLIC_BASE_URL || 'https://api.chit402.com';
  const envelope = buildBookWebhookEnvelope(entry, url);
  if (!envelope) return;

  setImmediate(async () => {
    await deliverBookWebhook(hook.url, envelope, hook.secret, entry.task_id)
      .then((res) => {
        reg.recordDelivery(entry.agent_id, hook, res);
        if (res.ok) {
          logger.info({ agentId: entry.agent_id, taskId: entry.task_id, event }, 'Book webhook delivered');
        }
      })
      .catch((err) => {
        const lastError = err.message?.slice(0, 160) || 'delivery error';
        reg.recordDelivery(entry.agent_id, hook, { ok: false, threw: true, error: lastError });
        logger.warn({ err: lastError, agentId: entry.agent_id, taskId: entry.task_id }, 'Book webhook dispatch error');
      });
  });
}

/**
 * Possession-gated register / read / delete for per-agent book webhook.
 * @param {number|string} agentId
 * @param {'GET'|'PUT'|'POST'|'DELETE'} method
 * @param {{ session?: string|null, proof?: string|null }} claim
 * @param {{ url?: string, secret?: string|null, events?: string[] }} body
 * @param {{ verify: Function, registry?: BookWebhookRegistry }} deps
 */
export function manageBookWebhook(agentId, method, claim = {}, body = {}, { verify, registry } = {}) {
  const session = claim.session ? String(claim.session) : null;
  const proof = claim.proof ? String(claim.proof) : null;
  if (!session && !proof) {
    return { status: 401, body: null };
  }

  const id = Number(agentId);
  if (!Number.isInteger(id) || id < 1) {
    return { status: 403, body: null };
  }
  if (typeof verify !== 'function' || !registry) {
    return { status: 403, body: null };
  }

  const checked = verify({ agentId: id, window: 50, session, proof });
  if (!checked || checked.checked !== true || checked.valid !== true) {
    return { status: 403, body: null };
  }

  const reg = registry;

  if (method === 'GET') {
    const config = reg.getPublic(id);
    if (!config) {
      return {
        status: 200,
        body: { agent_id: id, webhook: null, supported_events: [...VALID_EVENTS] },
      };
    }
    return {
      status: 200,
      body: { agent_id: id, webhook: config, supported_events: [...VALID_EVENTS] },
    };
  }

  if (method === 'DELETE') {
    const removed = reg.remove(id);
    return {
      status: 200,
      body: {
        agent_id: id,
        status: 'removed',
        webhook: removed,
      },
    };
  }

  if (method === 'PUT' || method === 'POST') {
    const { url, secret, events } = body || {};
    if (!url) {
      return {
        status: 400,
        body: { error: 'invalid_request', message: 'url is required' },
      };
    }
    try {
      const result = reg.upsert(id, { url, secret, events });
      const response = {
        agent_id: id,
        webhook: result.config,
        supported_events: [...VALID_EVENTS],
      };
      if (result.secret_once) {
        response.secret_once = result.secret_once;
      }
      return { status: 200, body: response };
    } catch (err) {
      if (err?.code === 'persist_failed') throw err;
      return {
        status: 400,
        body: { error: 'invalid_webhook', message: err.message },
      };
    }
  }

  return { status: 405, body: { error: 'method_not_allowed' } };
}
