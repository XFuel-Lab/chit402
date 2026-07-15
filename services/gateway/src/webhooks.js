import crypto from 'crypto';
import logger from './logger.js';

/**
 * XFuel M2M — Webhook registry + dispatcher.
 *
 * Implements the global webhook feature documented in AGENTS.md
 * (`PUT /webhook`) which previously had no implementation. Integrators
 * register a URL + secret and receive signed `TaskSettled` / `A2ASettled`
 * events when tasks reach a terminal state.
 *
 * Delivery convention matches packages/circuit-runtime/theta-inference/theta-inference-handler.js:
 *   Header: X-XFuel-Signature: sha256=<hex>
 *   HMAC-SHA256(key=<webhook secret>, message=<JSON body string>)
 *
 * Receivers verify with crypto.timingSafeEqual(expected, received).
 *
 * State is in-memory (matches the existing M2M server design). For multi-node
 * deployments, back this with Redis (see REDIS_URL in config.js).
 */

/** Terminal task statuses that trigger a TaskSettled event. */
const TERMINAL_TASK_STATUSES = new Set(['completed', 'fee_collected', 'failed']);

/** Supported event types a webhook can subscribe to. */
export const WEBHOOK_EVENTS = Object.freeze({
  TASK_SETTLED: 'TaskSettled',
  A2A_SETTLED: 'A2ASettled',
});

const VALID_EVENTS = new Set(Object.values(WEBHOOK_EVENTS));

/**
 * Registry of subscriber webhooks.
 *
 * Each entry: { id, url, secret, events:Set<string>, createdAt, updatedAt,
 *               deliveries, failures, lastStatus, lastError }
 */
export class WebhookRegistry {
  constructor() {
    /** @type {Map<string, Object>} id → webhook */
    this._hooks = new Map();
  }

  /**
   * Register or update a webhook. Keyed by URL so re-registering the same URL
   * updates the secret/events rather than duplicating.
   * @param {{ url:string, secret?:string, events?:string[] }} input
   * @returns {{ id:string, url:string, events:string[], createdAt:number, updatedAt:number }}
   */
  register({ url, secret, events }) {
    if (!url || typeof url !== 'string') {
      throw new Error('url is required');
    }
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('url must be a valid absolute URL');
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      throw new Error('url must use http or https');
    }

    const normalizedEvents = this._normalizeEvents(events);
    const id = crypto.createHash('sha256').update(url).digest('hex').slice(0, 24);
    const now = Date.now();
    const existing = this._hooks.get(id);

    const hook = {
      id,
      url,
      secret: secret || existing?.secret || null,
      events: normalizedEvents,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      deliveries: existing?.deliveries || 0,
      failures: existing?.failures || 0,
      lastStatus: existing?.lastStatus || null,
      lastError: existing?.lastError || null,
    };
    this._hooks.set(id, hook);
    return this._public(hook);
  }

  /** @param {string[]|undefined} events */
  _normalizeEvents(events) {
    if (!events || (Array.isArray(events) && events.length === 0)) {
      return new Set(VALID_EVENTS); // subscribe to all by default
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

  /** @returns {Object|null} */
  remove(id) {
    const hook = this._hooks.get(id);
    if (!hook) return null;
    this._hooks.delete(id);
    return this._public(hook);
  }

  removeByUrl(url) {
    const id = crypto.createHash('sha256').update(url).digest('hex').slice(0, 24);
    return this.remove(id);
  }

  list() {
    return [...this._hooks.values()].map(h => this._public(h));
  }

  /** Subscribers interested in a given event type. */
  subscribersFor(eventType) {
    return [...this._hooks.values()].filter(h => h.events.has(eventType));
  }

  _public(hook) {
    return {
      id: hook.id,
      url: hook.url,
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
}

/**
 * Deliver a signed webhook POST with retry (3 attempts, exponential backoff).
 * Mirrors theta-inference-handler._deliverWebhook for a consistent contract.
 *
 * @param {string} url
 * @param {Object} payload
 * @param {string|null} secret   per-hook secret; falls back to WEBHOOK_SECRET
 * @param {string} ref           short reference for logs (taskId/messageId)
 * @returns {Promise<{ ok:boolean, status:number|null, error?:string }>}
 */
export async function deliverWebhook(url, payload, secret, ref = '') {
  const maxAttempts = 3;
  const baseDelayMs = 1000;
  const body = JSON.stringify(payload);

  const webhookSecret = secret || process.env.WEBHOOK_SECRET || '';
  const headers = { 'Content-Type': 'application/json', 'X-XFuel-Event': payload?.event || '' };
  if (webhookSecret) {
    const hmac = crypto.createHmac('sha256', webhookSecret);
    hmac.update(body);
    headers['X-XFuel-Signature'] = `sha256=${hmac.digest('hex')}`;
  }

  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
      logger.warn({ url, status: res.status, attempt, ref }, 'Webhook non-2xx');
    } catch (err) {
      lastError = err.message?.slice(0, 160) || 'delivery error';
      logger.warn({ url, attempt, ref, err: lastError }, 'Webhook delivery attempt failed');
    }
    if (attempt < maxAttempts) {
      await new Promise(r => setTimeout(r, baseDelayMs * Math.pow(2, attempt - 1)));
    }
  }
  return { ok: false, status: null, error: lastError };
}

/**
 * Watches the AIListener's activeTasks map for transitions into a terminal
 * state and dispatches `TaskSettled` events to all subscribed webhooks plus
 * any per-task callback_url. In-memory dedupe so each task fires once.
 */
export class WebhookDispatcher {
  /**
   * @param {WebhookRegistry} registry
   * @param {Object} aiListener   instance exposing `activeTasks` Map
   * @param {{ intervalMs?:number }} [opts]
   */
  constructor(registry, aiListener, opts = {}) {
    this.registry = registry;
    this.aiListener = aiListener;
    this.intervalMs = opts.intervalMs || parseInt(process.env.WEBHOOK_POLL_INTERVAL_MS) || 2000;
    this._fired = new Set(); // taskIds already dispatched
    this._timer = null;
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this._scan().catch(err => {
      logger.error({ err }, 'Webhook dispatcher scan failed');
    }), this.intervalMs);
    if (typeof this._timer.unref === 'function') this._timer.unref();
    logger.info({ intervalMs: this.intervalMs }, 'Webhook dispatcher started');
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  async _scan() {
    const tasks = this.aiListener?.activeTasks;
    if (!tasks || typeof tasks.values !== 'function') return;

    for (const task of tasks.values()) {
      if (!task || !task.taskId) continue;
      if (this._fired.has(task.taskId)) continue;
      if (!TERMINAL_TASK_STATUSES.has(task.status)) continue;

      this._fired.add(task.taskId);
      await this.dispatchTaskSettled(task);
    }
  }

  /** Build a TaskSettled payload from a task record. */
  buildPayload(task) {
    return {
      event: WEBHOOK_EVENTS.TASK_SETTLED,
      task_id: task.taskId,
      status: task.status,
      message_type: task.intent?.type || null,
      chain_id: task.meta?.chain || task.intent?.chain || null,
      proof_system: task.intent?.proofSystem || 'sp1',
      gross_amount: task.intent?.amount || '0',
      fee_amount: task.feeAmount || '0',
      net_amount: task.netAmount || '0',
      fee_bps: task.feeBps || null,
      payment_rail: task.intent?.paymentRail || 'tfuel',
      payment_ref: task.intent?.paymentRef || null,
      sp1_proof: task.sp1Proof
        ? {
            has_proof: !!task.sp1Proof.proof,
            nullifier: task.sp1Proof.nullifier || null,
            error: task.sp1Proof.error || null,
          }
        : null,
      result: task.result || null,
      timestamp: Date.now(),
    };
  }

  /**
   * Dispatch a TaskSettled event to subscribers + per-task callback.
   * @param {Object} task
   */
  async dispatchTaskSettled(task) {
    const payload = this.buildPayload(task);
    const targets = [];

    for (const hook of this.registry.subscribersFor(WEBHOOK_EVENTS.TASK_SETTLED)) {
      targets.push({ hook, url: hook.url, secret: hook.secret });
    }
    if (task.callbackUrl) {
      targets.push({ hook: null, url: task.callbackUrl, secret: task.callbackSecret || null });
    }

    if (targets.length === 0) return;

    await Promise.all(
      targets.map(async ({ hook, url, secret }) => {
        const res = await deliverWebhook(url, payload, secret, task.taskId);
        if (hook) {
          hook.deliveries += res.ok ? 1 : 0;
          hook.failures += res.ok ? 0 : 1;
          hook.lastStatus = res.status;
          hook.lastError = res.ok ? null : res.error || null;
        }
      })
    );
    logger.info({ taskId: task.taskId, targets: targets.length }, 'TaskSettled webhooks dispatched');
  }
}

/** Singleton registry shared across the server process. */
let _registry = null;
export function getWebhookRegistry() {
  if (!_registry) _registry = new WebhookRegistry();
  return _registry;
}
