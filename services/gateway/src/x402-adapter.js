import crypto from 'crypto';
import logger from './logger.js';
import { testSwitchesOn } from './test-switch.js';
import { alertStuckPayment } from './stuck-payment-alert.js';
import { buildIconUrl } from './xfuel-icon.js';
import { OFFER_RECEIPT_KEY, buildOfferExtension, buildReceiptExtension } from './offer-receipt.js';
import {
  verifyViaFacilitator,
  settleViaFacilitator,
  defaultFacilitatorUrlForNetwork,
  toCaip2Network,
  fromCaip2Network,
  usdcFor,
  isSolanaNetwork,
  isEvmNetwork,
  PAYAI_FACILITATOR_URL,
  PAYAI_DEFAULT_FEE_PAYER,
  SOLANA_NETWORKS,
  decodePaymentHeader,
} from './x402-facilitator.js';

export { toCaip2Network, fromCaip2Network, usdcFor, isSolanaNetwork, isEvmNetwork };

/** CDP Bazaar search tags (≤5). Desk/book first; openai-compatible retained for drop-in catalogs. */
export const BAZAAR_DISCOVERY_TAGS = [
  'treasury',
  'possession-book',
  'spend-receipt',
  'x402',
  'usdc',
];

// ─── CDP Bazaar Discovery Extension ──────────────────────────────────────────
// Per https://docs.x402.org/extensions/bazaar: the bazaar extension makes a
// resource discoverable via CDP Bazaar / facilitator `/discovery/resources`.
// Cataloging requires:
//   1. Server advertises a spec-conformant bazaar extension on the 402
//   2. A paying client echoes that extension in the PaymentPayload
//   3. One successful settlement through the CDP Facilitator
//
// This file handles step 1 and persists the extension on the bound challenge
// so x402-facilitator.js can echo it on settle (step 2) even if the buyer
// SDK omits it. See docs/X402_ADAPTER.md.

/** Bazaar extension key per spec */
export const BAZAAR_EXTENSION_KEY = 'bazaar';

/** Example POST /task-request body advertised to Bazaar buyers (EVM/Base). */
export const TASK_REQUEST_BODY_EXAMPLE = {
  message_type: 'inference_request',
  chain_id: 'base',
  sender: '0xYourWalletAddress',
  model_id: 'xfuel/auto',
  messages: [{ role: 'user', content: 'Hello' }],
  max_tokens: 500,
  payment: { rail: 'usdc' },
};

/** Example POST /v1/chat/completions body advertised to Bazaar buyers. */
export const CHAT_COMPLETIONS_BODY_EXAMPLE = {
  model: 'xfuel/auto',
  messages: [{ role: 'user', content: 'Hello' }],
  max_tokens: 500,
};

/** Example POST /task-request body advertised to Solana/PayAI buyers. */
export const TASK_REQUEST_BODY_EXAMPLE_SOLANA = {
  message_type: 'inference_request',
  chain_id: 'base',  // Routing chain; payment network is separate (Solana)
  sender: 'YourSolanaWalletPubkey',  // Base58 Solana address
  model_id: 'xfuel/auto',
  messages: [{ role: 'user', content: 'Hello' }],
  max_tokens: 500,
  payment: { rail: 'usdc' },
};

/** JSON Schema for that body — lives on bazaar.schema, not on info.input. */
const TASK_REQUEST_BODY_SCHEMA = {
  type: 'object',
  properties: {
    message_type: {
      type: 'string',
      enum: ['inference_request'],
      description: 'Task type; only inference_request is supported via x402',
    },
    chain_id: {
      type: 'string',
      description: 'Settlement chain; "base" for USDC settlement',
    },
    amount: {
      type: 'string',
      description: 'Gross task value in USDC base units (6 decimals)',
    },
    sender: {
      type: 'string',
      description: '0x address that owns/pays for the task',
    },
    model_id: {
      type: 'string',
      description: 'Model id from GET /v1/models; xfuel/auto routes automatically',
    },
    input_hash: {
      type: 'string',
      description: 'keccak256 of your input (optional; for proof binding)',
    },
    messages: {
      type: 'array',
      description: 'OpenAI-style chat messages array',
      items: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: ['system', 'user', 'assistant'] },
          content: { type: 'string' },
        },
        required: ['role', 'content'],
      },
    },
    max_tokens: {
      type: 'integer',
      description: 'Output token budget (default 500)',
    },
    payment: {
      type: 'object',
      properties: {
        rail: { type: 'string', enum: ['usdc'], description: 'Payment rail; use "usdc"' },
      },
    },
  },
  required: ['message_type', 'chain_id', 'sender'],
};

/** JSON Schema for OpenAI chat-completions POST body (bazaar.schema). */
const CHAT_COMPLETIONS_BODY_SCHEMA = {
  type: 'object',
  properties: {
    model: {
      type: 'string',
      description: 'Model id from GET /v1/models; xfuel/auto routes automatically',
    },
    messages: {
      type: 'array',
      description: 'OpenAI-style chat messages array',
      items: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: ['system', 'user', 'assistant'] },
          content: { type: 'string' },
        },
        required: ['role', 'content'],
      },
    },
    max_tokens: {
      type: 'integer',
      description: 'Output token budget',
    },
    temperature: { type: 'number', minimum: 0, maximum: 2 },
    stream: { type: 'boolean' },
  },
  required: ['messages'],
};

const TASK_REQUEST_OUTPUT_EXAMPLE = {
  task_id: 'ai-task-12345',
  status: 'accepted',
  payment_rail: 'usdc',
  payment_ref: 'base:0x...',
  verify_url: 'https://api.chit402.com/receipt/chit-ai-task-12345',
  gross_amount: '50000',
  fee_amount: '250',
  net_amount: '49750',
};

const CHAT_COMPLETIONS_OUTPUT_EXAMPLE = {
  id: 'chatcmpl-abc123',
  object: 'chat.completion',
  created: 1700000000,
  model: 'xfuel/auto',
  choices: [{
    index: 0,
    message: { role: 'assistant', content: 'Hello!' },
    finish_reason: 'stop',
  }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  xfuel: { verify_url: 'https://api.chit402.com/receipt/chit-abc123' },
};

/**
 * Build the bazaar discovery extension for XFuel's /task-request resource.
 *
 * Shape matches `@x402/extensions` `declareDiscoveryExtension({ method:'POST',
 * bodyType:'json', input, output })`: `info.input` is `{ type, method, bodyType,
 * body }` and a Draft 2020-12 `schema` validates that `info`. CDP rejects
 * declarations that put `inputSchema` on `info.input` (additionalProperties:
 * false) or omit `schema` entirely.
 *
 * @param {Object} opts
 * @param {string} [opts.method='POST']  HTTP method
 * @param {Object} [opts.exampleBody]    Custom example body (default: TASK_REQUEST_BODY_EXAMPLE)
 * @param {Object} [opts.bodySchema]     JSON Schema for example body (default: TASK_REQUEST_BODY_SCHEMA)
 * @param {Object} [opts.outputExample]  Example response (default: TASK_REQUEST_OUTPUT_EXAMPLE)
 * @returns {Object} extensions object to spread into the 402 accepts entry
 */
export function buildBazaarExtension(opts = {}) {
  const method = opts.method || 'POST';
  const exampleBody = opts.exampleBody || TASK_REQUEST_BODY_EXAMPLE;
  const bodySchema = opts.bodySchema || TASK_REQUEST_BODY_SCHEMA;
  const outputExample = opts.outputExample || TASK_REQUEST_OUTPUT_EXAMPLE;

  return {
    [BAZAAR_EXTENSION_KEY]: {
      info: {
        input: {
          type: 'http',
          method,
          bodyType: 'json',
          body: exampleBody,
        },
        output: {
          type: 'json',
          example: outputExample,
        },
      },
      schema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {
          input: {
            type: 'object',
            properties: {
              type: { type: 'string', const: 'http' },
              method: { type: 'string', enum: ['POST', 'PUT', 'PATCH'] },
              bodyType: { type: 'string', enum: ['json', 'form-data', 'text'] },
              body: bodySchema,
            },
            required: ['type', 'method', 'bodyType', 'body'],
            additionalProperties: false,
          },
          output: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              example: { type: 'object' },
            },
            required: ['type'],
          },
        },
        required: ['input'],
      },
    },
  };
}

/** v1 discovery fallback: PaymentRequirements.outputSchema = bazaar info. */
export function v1OutputSchemaFromBazaar(extensions) {
  const info = extensions?.[BAZAAR_EXTENSION_KEY]?.info;
  if (!info?.input) return undefined;
  return { input: info.input, output: info.output };
}

/**
 * XFuel ⇄ ZAN x402 adapter.
 *
 * x402 is an agent-native payment protocol (machine-parseable HTTP 402
 * challenges, USDC settlement on Base/Solana, wallet-as-identity). This adapter
 * lets XFuel expose tasks as x402-priced resources so any x402-speaking agent
 * can pay in USDC, then maps a verified+settled payment to an XFuel task /
 * A2A settlement.
 *
 * Payment-rail strategy: USDC via x402 on Base is the DEFAULT (and go-forward)
 * buyer rail. Legacy TFUEL buyer fallback is opt-in only (X402_FALLBACK_TFUEL).
 * Provider TFUEL/ACT are prepaid float COGS (ADR 0005) — not settlement home.
 *
 * Settlement model: USDC lands in a Base treasury (X402_PAY_TO / Splits v2).
 * The payer is the AGENT's wallet (agent-side, pluggable); this module never
 * holds keys. See ../../../docs/POSITIONING.md · ../../../docs/adr/0005-provider-float-cogs.md.
 *
 * Status: adapter hardened (challenge binding, nonce/replay store, verify+settle,
 * pricing). Two facilitator protocols are supported via X402_FACILITATOR_PROVIDER:
 *   - 'x402' → the STANDARD x402 facilitator (e.g. Coinbase's public Base Sepolia
 *     reference at https://x402.org/facilitator, no API key) — see x402-facilitator.js.
 *   - 'zan'  → the bespoke ZAN gateway (default; also the shape the mock speaks).
 * Gated behind X402_ENABLED at the server layer.
 *
 * Env:
 *   X402_ENABLED=true
 *   X402_DEFAULT_RAIL=usdc|tfuel        (server default rail; default usdc)
 *   X402_FALLBACK_TFUEL=true            (usdc unavailable → fall back vs 503)
 *   X402_FACILITATOR_PROVIDER=x402|zan  (which facilitator protocol to speak)
 *   X402_FACILITATOR_URL=https://...    (standard facilitator; default public ref)
 *   X402_FACILITATOR_API_KEY=...        (optional; not needed for the public testnet)
 *   ZAN_X402_GATEWAY_URL=https://...    (ZAN facilitator; verify + settle)
 *   ZAN_X402_API_KEY=...
 *   X402_PAY_TO=0x...                   (Base USDC treasury)
 *   X402_NETWORK=base                   (base | solana)
 *   X402_ASSET=USDC
 *   X402_CHALLENGE_TTL_MS=120000
 *   X402_USDC_PRICE_DEFAULT=2000        (smallest unit, USDC 6dp; 2000 = $0.002)
 *   X402_USDC_PRICES={"llama-3-70b":"50000"}   (JSON model→price override)
 */

const DEFAULT_TTL_MS = parseInt(process.env.X402_CHALLENGE_TTL_MS, 10) || 120000;

export function isX402Enabled() {
  return process.env.X402_ENABLED === 'true';
}

/** Server default rail: "usdc" (default, Base) | "tfuel" (optional legacy). */
export function defaultRail() {
  const r = (process.env.X402_DEFAULT_RAIL || 'usdc').toLowerCase();
  return r === 'tfuel' ? 'tfuel' : 'usdc';
}

/** Whether to fall back to TFUEL when USDC/x402 is requested but unavailable. */
export function fallbackToTfuel() {
  return process.env.X402_FALLBACK_TFUEL === 'true';
}

// ─── Challenge + replay store ───────────────────────────────────────────────
// Binds an issued 402 challenge (nonce) to its amount/asset/network/resource so
// verify/settle can reject amount tampering, expired challenges, and replays.
// In-memory by design for Phase 0 (single-process); swap for Redis when the
// server path scales horizontally.

/**
 * Normalize a nonce for store lookups. After 2026-08-21 challenges emit 0x-prefixed
 * bytes32 nonces; older in-flight challenges may still have raw hex. Accept both.
 * @param {string|null} nonce
 * @returns {string[]} - Array of possible keys: [normalized, alternateForm] or [nonce] if no normalization needed
 */
function nonceVariants(nonce) {
  if (!nonce || typeof nonce !== 'string') return [];
  const trimmed = nonce.trim();
  // If it has 0x prefix, also try without
  if (trimmed.startsWith('0x')) {
    return [trimmed, trimmed.slice(2)];
  }
  // If no 0x prefix, also try with 0x prefix (padded to 64 hex chars for old short nonces)
  return [trimmed, '0x' + trimmed.padStart(64, '0')];
}

/** Same SHA-256 hex the settle path stores. A different header does not match. */
function holdPaymentMatches(stored, presented) {
  if (typeof stored !== 'string' || typeof presented !== 'string') return false;
  if (stored.length !== presented.length || stored.length === 0) return false;
  return crypto.timingSafeEqual(Buffer.from(stored), Buffer.from(presented));
}

export class ChallengeStore {
  constructor({ ttlMs = DEFAULT_TTL_MS } = {}) {
    this.ttlMs = ttlMs;
    this.map = new Map();   // nonce → record (issued | claimed | spent | released | unknown)
    this.spent = new Set(); // nonce already settled
    this.authSpent = new Map(); // authorization key → tx ref
    this.txSpent = new Set(); // normalized payment ref
    this.txFacts = new Map(); // ref → confirmed amount, payer, payTo
    this.txReserved = new Map(); // ref → { owner, until, authKey }
    this.authReserved = new Map(); // auth key → { owner, until, key }
    this.pending = []; // unsigned owner-only rows; never a receipt
    // Late-issue rows. An array, persisted with the replay store. Not a Map.
    this.late = [];
    this.lateLedger = [];
    // Public hold handles. id is random. key is the idempotency string and
    // is never returned by getHoldHandle. Unlike terminal late rows, these
    // are not pruned: a handle page stays until the store file is replaced.
    this.holdHandles = [];
  }

  put(nonce, data) {
    this._gc();
    const prev = this.map.get(nonce);
    const expiresAt = data?.expiresAt || prev?.expiresAt || (Date.now() + this.ttlMs);
    this.map.set(nonce, {
      ...data,
      nonce,
      expiresAt,
      state: data?.state || 'issued',
    });
    return this.map.get(nonce);
  }

  patch(nonce, fields) {
    const rec = this._find(nonce);
    if (!rec) return null;
    Object.assign(rec.rec, fields);
    return rec.rec;
  }

  _find(nonce) {
    for (const key of nonceVariants(nonce)) {
      const rec = this.map.get(key);
      if (rec) return { key, rec };
    }
    return null;
  }

  get(nonce) {
    const found = this._find(nonce);
    if (!found) return null;
    const { key, rec } = found;
    if (rec.state === 'spent') return null;
    if (rec.state === 'unknown' || rec.state === 'submitted') return rec;
    if (rec.state === 'claimed' && rec.lease_until && Date.now() > rec.lease_until) {
      rec.state = 'unknown';
      return rec;
    }
    if (rec.state !== 'claimed' && rec.state !== 'submitted' && Date.now() > rec.expiresAt) {
      this.map.delete(key);
      return null;
    }
    return rec;
  }

  isSpent(nonce) {
    for (const key of nonceVariants(nonce)) {
      if (this.spent.has(key)) return true;
      const rec = this.map.get(key);
      if (rec?.state === 'spent') return true;
    }
    return false;
  }

  /** Spent challenge, including its settlement. `get` hides spent rows. */
  replayRecord(nonce) {
    const found = this._find(nonce);
    if (!found || found.rec.state !== 'spent') return null;
    return found.rec;
  }

  markSpent(nonce, meta = null) {
    if (!nonce) return;
    this.spent.add(nonce);
    for (const key of nonceVariants(nonce)) {
      this.spent.add(key);
      const rec = this.map.get(key);
      if (rec) {
        rec.state = 'spent';
        if (meta && typeof meta === 'object') Object.assign(rec, { settlement: meta });
      }
    }
  }

  /**
   * Atomic in-process claim. Callers must not await between the check and the set.
   * A second caller gets payment_in_flight. An expired lease becomes unknown
   * and is not released.
   */
  claim(nonce, owner, leaseMs = 60_000) {
    if (this.isSpent(nonce)) return { ok: false, reason: 'payment_replayed' };
    const found = this._find(nonce);
    if (!found) return { ok: false, reason: 'challenge_required' };
    const rec = found.rec;
    if (rec.state === 'submitted') {
      if (rec.lease_until && Date.now() > rec.lease_until) {
        return { ok: false, reason: 'settle_unconfirmed' };
      }
      return { ok: false, reason: 'payment_in_flight' };
    }
    if (rec.state === 'unknown') {
      return { ok: false, reason: 'settle_unconfirmed' };
    }
    if (rec.state === 'spent') return { ok: false, reason: 'payment_replayed' };
    if (rec.state === 'claimed') {
      if (rec.lease_until && Date.now() > rec.lease_until) {
        rec.state = 'unknown';
        return { ok: false, reason: 'settle_unconfirmed' };
      }
      return { ok: false, reason: 'payment_in_flight' };
    }
    if (rec.state && rec.state !== 'issued') return { ok: false, reason: 'payment_in_flight' };
    if (Date.now() > rec.expiresAt) {
      this.map.delete(found.key);
      return { ok: false, reason: 'challenge_required' };
    }
    rec.state = 'claimed';
    rec.lease_owner = owner || 'local';
    rec.lease_until = Date.now() + leaseMs;
    return { ok: true, challenge: rec };
  }

  release(nonce, owner) {
    const found = this._find(nonce);
    if (!found) return false;
    const rec = found.rec;
    if (rec.state !== 'claimed') return false;
    if (owner && rec.lease_owner && rec.lease_owner !== owner) return false;
    rec.state = 'issued';
    rec.lease_owner = null;
    rec.lease_until = null;
    return true;
  }

  markUnknown(nonce) {
    const found = this._find(nonce);
    if (!found) return;
    found.rec.state = 'unknown';
  }

  /** Claimed → submitted. Only the settle path, and only before the fetch. */
  markSubmitted(nonce) {
    const found = this._find(nonce);
    if (!found || found.rec.state !== 'claimed') return false;
    found.rec.state = 'submitted';
    return true;
  }

  /** A pre-fetch failure may undo submitted. A sent settle never calls this. */
  revertSubmitted(nonce, owner) {
    const found = this._find(nonce);
    if (!found || found.rec.state !== 'submitted') return false;
    found.rec.state = 'claimed';
    found.rec.lease_owner = owner || found.rec.lease_owner || 'local';
    return this.release(nonce, owner);
  }

  isAuthSpent(key) {
    return !!(key && this.authSpent.has(key));
  }

  markAuthSpent(key, ref) {
    if (key) {
      this.authSpent.set(key, ref || true);
      this.authReserved.delete(key);
    }
  }

  isTxSpent(key) {
    return !!(key && this.txSpent.has(key));
  }

  markTxSpent(key, facts = null) {
    if (!key) return;
    this.txSpent.add(key);
    const reserved = this.txReserved.get(key);
    this.txReserved.delete(key);
    if (reserved?.authKey) this.authReserved.delete(reserved.authKey);
    if (facts && typeof facts === 'object') this.txFacts.set(key, facts);
  }

  /**
   * One lock covers the spent check and the lease. False when the key is
   * spent or another owner holds a live lease. The same owner may refresh.
   */
  reserveTx(key, authKey, owner, leaseMs = 180_000, now = Date.now()) {
    if (!key || !owner) return false;
    if (this.isTxSpent(key)) return false;
    if (authKey && this.isAuthSpent(authKey)) return false;
    const held = this.txReserved.get(key);
    if (held && Number(held.until) > now && held.owner !== owner) return false;
    if (authKey) {
      const auth = this.authReserved.get(authKey);
      if (auth && Number(auth.until) > now && auth.owner !== owner) return false;
      if (auth && auth.key && auth.key !== key && Number(auth.until) > now) return false;
    }
    const until = now + (Number(leaseMs) > 0 ? Number(leaseMs) : 180_000);
    this.txReserved.set(key, { owner, until, authKey: authKey || null });
    if (authKey) this.authReserved.set(authKey, { owner, until, key });
    return true;
  }

  releaseTx(key, authKey, owner) {
    const rec = key ? this.txReserved.get(key) : null;
    if (!rec) return false;
    if (owner && rec.owner !== owner) return false;
    this.txReserved.delete(key);
    const ak = authKey || rec.authKey;
    if (ak) {
      const auth = this.authReserved.get(ak);
      if (auth && (!owner || auth.owner === owner)) this.authReserved.delete(ak);
    }
    return !this.isTxSpent(key);
  }

  txFactsOf(key) {
    return (key && this.txFacts.get(key)) || null;
  }

  /**
   * One handle per key. A second call returns the first row and does not
   * allocate another id. The only class change is resolvable → terminal,
   * and only for the payment hash stored when the row was created.
   * A different payment gets null and the class stays. The return value
   * has no key and no payment facts.
   */
  ensureHoldHandle({ key, holdClass, code, paymentHash } = {}) {
    if (typeof key !== 'string' || key.length < 8 || key.length > 200) return null;
    if (holdClass !== 'resolvable' && holdClass !== 'terminal') return null;
    const publicCode = typeof code === 'string' && code ? code : null;
    const presented = typeof paymentHash === 'string' && paymentHash ? paymentHash : null;
    const existing = this.holdHandles.find((row) => row.key === key);
    if (existing) {
      if (existing.hold_class === 'resolvable' && holdClass === 'terminal') {
        if (!holdPaymentMatches(existing.payment_hash, presented)) return null;
        existing.hold_class = 'terminal';
        if (publicCode) existing.code = publicCode;
      } else if (existing.payment_hash && !holdPaymentMatches(existing.payment_hash, presented)) {
        return null;
      } else if (!existing.code && publicCode) existing.code = publicCode;
      return { pending_id: existing.pending_id, hold_class: existing.hold_class, code: existing.code || null };
    }
    const pending_id = crypto.randomBytes(16).toString('hex');
    this.holdHandles.push({
      pending_id,
      key,
      hold_class: holdClass,
      code: publicCode,
      payment_hash: presented,
    });
    return { pending_id, hold_class: holdClass, code: publicCode };
  }

  /** Public read. Unknown ids return null. The key is not included. */
  getHoldHandle(id) {
    if (typeof id !== 'string' || !/^[0-9a-f]{32}$/.test(id)) return null;
    const row = this.holdHandles.find((item) => item.pending_id === id);
    if (!row) return null;
    return { pending_id: row.pending_id, hold_class: row.hold_class, code: row.code || null };
  }

  /**
   * Read-only. Used when a retry meets a nonce already marked unknown.
   * Returns the id, class, the first public code, and the payment hash
   * so the retry can match the payment that created the row. The hash
   * is not a public page field.
   */
  findHoldHandleByKey(key) {
    if (typeof key !== 'string' || !key) return null;
    const row = this.holdHandles.find((item) => item.key === key);
    if (!row) return null;
    return {
      pending_id: row.pending_id,
      hold_class: row.hold_class,
      code: row.code || null,
      payment_hash: row.payment_hash || null,
    };
  }

  /**
   * Point an existing handle at the late row, or at the receipt task id.
   * Does not allocate an id. No-op when the key has no handle yet.
   * `linked` is a 32-hex late id, or `{ taskId }`.
   */
  linkHoldHandle(key, linked) {
    const row = this.holdHandles.find((item) => item.key === key);
    if (!row) return null;
    if (linked && typeof linked === 'object') {
      const taskId = typeof linked.taskId === 'string' ? linked.taskId : '';
      if (!taskId || taskId.length > 200) return null;
      row.linked_task_id = taskId;
      return { pending_id: row.pending_id };
    }
    if (!/^[0-9a-f]{32}$/.test(String(linked || ''))) return null;
    row.linked_pending_id = String(linked);
    return { pending_id: row.pending_id };
  }

  /** Page lookup. Includes the late-row link. The idempotency key is not returned. */
  holdPageLink(id) {
    if (typeof id !== 'string' || !/^[0-9a-f]{32}$/.test(id)) return null;
    const row = this.holdHandles.find((item) => item.pending_id === id);
    if (!row) return null;
    return {
      pending_id: row.pending_id,
      hold_class: row.hold_class,
      linked_pending_id: row.linked_pending_id || null,
      linked_task_id: row.linked_task_id || null,
    };
  }

  async recordPending(row) {
    const rec = {
      id: `pending-${Date.now().toString(36)}-${this.pending.length}`,
      at: new Date().toISOString(),
      status: 'pending',
      ...row,
    };
    this.pending.push(rec);
    void await alertStuckPayment({
      tx: rec.tx || null,
      network: rec.network || null,
      amount: rec.amount != null ? rec.amount : null,
      reason: rec.reason || rec.why || null,
    });
    return rec;
  }

  listPending() {
    return this.pending.slice();
  }

  updatePending(id, fields) {
    const rec = this.pending.find((p) => p.id === id);
    if (!rec) return null;
    Object.assign(rec, fields);
    return rec;
  }

  /**
   * Insert one late-issue row. Refuses a second row for the same authorization
   * identity. The raw header is not a field.
   */
  putLate(row) {
    if (!row || !row.pending_id) return { ok: false, reason: 'replay_store_unavailable' };
    if (this.late.some((r) => r.pending_id === row.pending_id)) {
      return { ok: false, reason: 'payment_replayed' };
    }
    if (row.auth_key && this.late.some((r) => r.auth_key === row.auth_key)) {
      return { ok: false, reason: 'payment_replayed' };
    }
    this.late.push(row);
    return { ok: true, row };
  }

  getLate(id) {
    return this.late.find((r) => r.pending_id === id) || null;
  }

  findLate(query = {}) {
    return this.late.find((row) => {
      if (query.pendingId && row.pending_id !== query.pendingId) return false;
      if (query.nonce && row.nonce !== query.nonce) return false;
      if (query.authKey && row.auth_key !== query.authKey) return false;
      if (query.txRef && row.tx_ref !== query.txRef) return false;
      if (query.idempotencyKey && row.idempotency_key !== query.idempotencyKey) return false;
      if (query.principal && row.principal !== query.principal) return false;
      return !!(query.pendingId || query.nonce || query.authKey || query.txRef || query.idempotencyKey);
    }) || null;
  }

  /**
   * Compare-and-set. `from` is one state or a list. A tx ref already on
   * another row loses the CAS.
   */
  casLate(id, from, to, patch = {}) {
    const rec = this.late.find((r) => r.pending_id === id);
    if (!rec) return null;
    const allowed = Array.isArray(from) ? from : [from];
    if (!allowed.includes(rec.state)) return null;
    if (patch.tx_ref) {
      const clash = this.late.find((r) => r !== rec && r.tx_ref === patch.tx_ref);
      if (clash) return null;
    }
    Object.assign(rec, patch, { state: to });
    return rec;
  }

  abortLate(id) {
    const idx = this.late.findIndex((r) => r.pending_id === id);
    if (idx < 0) return false;
    if (this.late[idx].sent === true) return false;
    if (this.late[idx].state !== 'submitted') return false;
    this.late.splice(idx, 1);
    return true;
  }

  listLate() {
    return this.late.slice();
  }

  /** One ledger row per auth key and per normalized tx ref. */
  appendLateLedger(row) {
    if (!row) return { ok: false, reason: 'invalid' };
    const dup = this.lateLedger.find((r) =>
      (row.auth_key && r.auth_key === row.auth_key)
      || (row.tx_ref && r.tx_ref === row.tx_ref));
    if (dup) return { ok: true, row: dup, duplicate: true };
    this.lateLedger.push(row);
    return { ok: true, row, duplicate: false };
  }

  listLateLedger() {
    return this.lateLedger.slice();
  }

  /**
   * Drop terminal late rows older than `maxAge` (default 24h) from submitted_at.
   * submitted, unknown, confirmed, and issuing stay.
   */
  pruneLate(now = Date.now(), maxAge = 24 * 60 * 60 * 1000) {
    const terminal = new Set([
      'issued',
      'mismatch_hold',
      'expired_unresolved',
      'not_settled',
    ]);
    const cutoff = now - maxAge;
    const before = this.late.length;
    this.late = this.late.filter((row) => {
      if (!terminal.has(row.state)) return true;
      return Number(row.submitted_at || 0) > cutoff;
    });
    return before - this.late.length;
  }

  dumpState() {
    return {
      map: [...this.map.entries()],
      spent: [...this.spent],
      authSpent: [...this.authSpent.entries()],
      txSpent: [...this.txSpent],
      txFacts: [...this.txFacts.entries()],
      txReserved: [...this.txReserved.entries()],
      authReserved: [...this.authReserved.entries()],
      pending: this.pending,
      late: this.late,
      lateLedger: this.lateLedger,
      holdHandles: this.holdHandles,
    };
  }

  loadState(raw) {
    this.map = new Map(raw?.map || []);
    this.spent = new Set(raw?.spent || []);
    this.authSpent = new Map(raw?.authSpent || []);
    this.txSpent = new Set(raw?.txSpent || []);
    this.txFacts = new Map(raw?.txFacts || []);
    this.txReserved = new Map(raw?.txReserved || []);
    this.authReserved = new Map(raw?.authReserved || []);
    this.pending = Array.isArray(raw?.pending) ? raw.pending : [];
    this.late = Array.isArray(raw?.late) ? raw.late : [];
    this.lateLedger = Array.isArray(raw?.lateLedger) ? raw.lateLedger : [];
    this.holdHandles = Array.isArray(raw?.holdHandles) ? raw.holdHandles : [];
  }

  _gc() {
    const now = Date.now();
    for (const [k, v] of this.map) {
      if (v.state === 'spent' || v.state === 'unknown' || v.state === 'claimed' || v.state === 'submitted') continue;
      if (now > v.expiresAt) this.map.delete(k);
    }
  }
}

/** Module-level default store (server + tests share this unless a store is injected). */
export const challengeStore = new ChallengeStore();

// ─── Pricing ─────────────────────────────────────────────────────────────────
/**
 * Price a task in USDC smallest units (6dp string). Config-driven for Phase 1:
 * per-model overrides via X402_USDC_PRICES (JSON) or an injected `prices` map,
 * else X402_USDC_PRICE_DEFAULT, else 2000 ($0.002).
 *
 * @param {{ model?: string, serviceType?: number }} task
 * @param {{ prices?: Record<string,string>, default?: string }} [opts]
 * @returns {string} smallest-unit USDC amount
 */
export function priceTaskUSDC(task = {}, opts = {}) {
  let envPrices = {};
  if (process.env.X402_USDC_PRICES) {
    try { envPrices = JSON.parse(process.env.X402_USDC_PRICES); } catch { envPrices = {}; }
  }
  const prices = { ...envPrices, ...(opts.prices || {}) };
  const fallback = String(opts.default || process.env.X402_USDC_PRICE_DEFAULT || '2000');
  const key = task.model || (task.serviceType != null ? `service:${task.serviceType}` : null);
  const raw = (key && prices[key] != null) ? prices[key] : fallback;
  return String(raw);
}

// ─── Challenge ───────────────────────────────────────────────────────────────
/**
 * Encode a PaymentRequired body for the v2 `PAYMENT-REQUIRED` response header.
 * @param {Object} body
 * @returns {string} base64(JSON)
 */
export function encodePaymentRequiredHeader(body) {
  return Buffer.from(JSON.stringify(body), 'utf8').toString('base64');
}

/**
 * Base64 JSON settle response that `@x402/fetch` `decodePaymentResponseHeader`
 * accepts: `{ success, transaction, network, payer }`.
 *
 * `network` is CAIP-2 (`eip155:8453`, `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`),
 * the same identifier the 402 `accepts[]` entry used. `ref` stays the gateway
 * payment ref `<short-network>:<tx>` — this helper does not rewrite it.
 *
 * @param {{ ref?: string|null, network?: string|null, payer?: string|null, success?: boolean, resourceUrl?: string|null }} settle
 *   `resourceUrl` is the absolute paid resource. When set on a successful settle,
 *   the header also carries extensions["offer-receipt"].info.receipt (JWS).
 *   success, transaction, network, and payer are unchanged.
 * @returns {string|null} standard base64, or null when nothing was collected
 */
export async function encodeX402PaymentResponseHeader({
  ref, network = null, payer = null, success = true, resourceUrl = null,
} = {}) {
  if (!ref || typeof ref !== 'string') return null;
  const idx = ref.indexOf(':');
  const short = network || (idx > 0 ? ref.slice(0, idx) : null);
  if (!short) return null;
  const body = {
    success: success !== false,
    transaction: idx > 0 ? ref.slice(idx + 1) : '',
    network: toCaip2Network(short),
    payer: payer || null,
  };
  // x402 offer-receipt §5.1: extensions["offer-receipt"].info.receipt on success.
  // Omitted when resourceUrl or payer is missing — the four legacy fields still go out.
  const receiptExt = body.success && resourceUrl
    ? await buildReceiptExtension({
      network: body.network,
      resourceUrl,
      payer: body.payer,
      transaction: body.transaction,
    })
    : null;
  if (receiptExt) body.extensions = { [OFFER_RECEIPT_KEY]: receiptExt };
  return Buffer.from(JSON.stringify(body), 'utf8').toString('base64');
}

/**
 * Set `PAYMENT-RESPONSE` and `X-PAYMENT-RESPONSE` (v2 and v1 header names).
 * No-op when `settle.ref` is missing — unpaid responses stay unset.
 * @returns {boolean} true when the headers were written
 */
export async function setX402PaymentResponseHeaders(res, settle) {
  const encoded = await encodeX402PaymentResponseHeader(settle);
  if (testSwitchesOn() && process.env.X402_HEADER_THROW === '1') {
    throw new Error('header');
  }
  if (!encoded || !res || typeof res.setHeader !== 'function') return false;
  res.setHeader('PAYMENT-RESPONSE', encoded);
  res.setHeader('X-PAYMENT-RESPONSE', encoded);
  return true;
}

/**
 * Build a machine-parseable x402 v2 "Payment Required" challenge for a task and
 * record it in the store (bound to amount/asset/network/resource + a nonce) so
 * verify/settle can enforce it.
 *
 * CDP Bazaar cataloging (https://docs.cdp.coinbase.com/x402/bazaar):
 *   - Public HTTPS resource must return 402 (not 401) with this body
 *   - Top-level `resource` object + `extensions.bazaar`
 *   - `accepts[0]` uses CAIP-2 network, USDC contract `asset`, and `amount`
 *   - `PAYMENT-REQUIRED` header carries the same JSON (base64)
 *
 * Dual-network support (2026-08-22):
 *   - When `p.solana` is provided and enabled, adds a second accepts entry for Solana USDC
 *   - Base (EVM) stays as accepts[0] (primary); Solana is accepts[1]
 *   - Each network has its own nonce, payTo, and facilitator
 *   - Incoming payment's accepted.network determines which facilitator to use
 *
 * @param {Object} p
 * @param {string} p.taskId
 * @param {string} p.maxAmountRequired  smallest-unit string (USDC 6dp)
 * @param {string} [p.resource]         absolute resource URL (required for bazaar)
 * @param {string} [p.baseUrl]          base URL for building absolute links (e.g. https://api.chit402.com)
 * @param {string} [p.payTo]            Base USDC treasury address
 * @param {string} [p.network]          base | base-sepolia | eip155:8453 | …
 * @param {string} [p.description]
 * @param {boolean} [p.includeBazaar=true]  include the bazaar discovery extension
 * @param {Object} [p.solana]           Solana payment config (optional, second network)
 * @param {boolean} [p.solana.enabled]  whether to include Solana accepts entry
 * @param {string} [p.solana.payTo]     Solana USDC treasury (ATA address)
 * @param {string} [p.solana.network]   solana | solana-devnet (default: solana)
 * @param {Object} [opts]
 * @param {ChallengeStore|null} [opts.store]  store to record into (default module store; null to skip)
 * @returns {{ status:number, body:Object, headers:Record<string,string> }}
 */
export async function buildPaymentChallenge(p, opts = {}) {
  if (!p || !p.taskId) throw new Error('taskId is required');
  if (!p.maxAmountRequired) throw new Error('maxAmountRequired is required');

  // Internal short name for facilitator USDC lookup + challenge store.
  const network = fromCaip2Network(p.network || process.env.X402_NETWORK || 'base');
  const wireNetwork = toCaip2Network(network);
  const { asset: assetAddress, name: eip712Name, version: eip712Version } = usdcFor(network);
  const payTo = p.payTo || process.env.X402_PAY_TO || null;
  const amount = String(p.maxAmountRequired);
  // EIP-3009 nonce must be bytes32: 0x + 64 hex chars. CDP-native clients that
  // sign accepts[0].extra.nonce as the authorization nonce need this format.
  // Per Section 3.5 challenge binding.
  const nonce = '0x' + crypto.randomBytes(32).toString('hex');
  const maxTimeoutSeconds = Math.max(30, Math.floor((opts.ttlMs || DEFAULT_TTL_MS) / 1000));

  // Absolute URL for CDP Bazaar catalog key — per paid surface, never per-task.
  const baseUrl = p.baseUrl ? String(p.baseUrl).replace(/\/$/, '') : '';
  const resourcePath = p.resourcePath || '/task-request';
  const resourceUrl = p.resource || (baseUrl ? `${baseUrl}${resourcePath}` : resourcePath);
  const isV1Chat = resourceUrl.includes('/v1/chat/completions')
    || resourceUrl.includes('/a2a-message');

  const serviceName = 'Chit402';
  const tags = BAZAAR_DISCOVERY_TAGS;
  const iconUrl = buildIconUrl(baseUrl);

  // Update description when both networks are available.
  const solanaEnabled = p.solana?.enabled && p.solana?.payTo;
  const description = p.description || (solanaEnabled
    ? 'Signed spend receipts for agent x402 payments — who paid which call, verifiable by a third party. '
      + 'Treasury desk and possession book for agent spend — export, policy, evidence. '
      + 'POST /v1/chat/completions is the x402 USDC door on Base and Solana. Returns signed receipt + public verify_url. '
      + 'Paying this host is real mainnet USDC.'
    : 'Signed spend receipts for agent x402 payments — who paid which call, verifiable by a third party. '
      + 'Treasury desk and possession book for agent spend — export, policy, evidence. '
      + 'POST /v1/chat/completions is the x402 USDC door on Base. Returns signed receipt + public verify_url. '
      + 'Paying this host is real mainnet USDC.');

  const includeBazaar = p.includeBazaar !== false;
  let bazaarOpts;
  if (isV1Chat) {
    bazaarOpts = {
      method: 'POST',
      exampleBody: CHAT_COMPLETIONS_BODY_EXAMPLE,
      bodySchema: CHAT_COMPLETIONS_BODY_SCHEMA,
      outputExample: CHAT_COMPLETIONS_OUTPUT_EXAMPLE,
    };
  } else {
    // When Solana is enabled, use the Solana example body for PayAI discoverability.
    bazaarOpts = {
      method: 'POST',
      exampleBody: solanaEnabled ? TASK_REQUEST_BODY_EXAMPLE_SOLANA : TASK_REQUEST_BODY_EXAMPLE,
    };
  }
  const extensions = includeBazaar ? buildBazaarExtension(bazaarOpts) : undefined;
  // v1 facilitators still catalog via paymentRequirements.outputSchema on settle.
  const outputSchema = v1OutputSchemaFromBazaar(extensions);

  const store = opts.store === undefined ? challengeStore : opts.store;
  let expiresAt = null;
  let stampedBlock = null;
  if (!isSolanaNetwork(network) && opts.issueBlock != null && opts.issueBlock !== '') {
    const n = Number(opts.issueBlock);
    if (Number.isSafeInteger(n) && n >= 0) stampedBlock = n;
  }
  if (store) {
    // Persist bazaar fields so settleViaFacilitator can echo them on the
    // PaymentPayload even when the buyer SDK omits them. CDP will not catalog
    // a settle that lacks paymentPayload.resource.
    const fields = {
      taskId: p.taskId,
      amount,
      asset: assetAddress,
      network, // short name for usdcFor / facilitator
      payTo,
      resource: resourceUrl,
      description,
      mimeType: 'application/json',
      extensions,
      outputSchema,
      issuance_bind: p.issuance_bind || null,
    };
    if (stampedBlock != null) fields.issueBlock = stampedBlock;
    const rec = store.put(nonce, fields);
    expiresAt = rec.expiresAt;
  }

  // x402 v2 PaymentRequired — resource + extensions are top-level (not on accepts).
  // accepts[0]: Base (EVM) — primary network
  const baseAcceptsEntry = {
    scheme: 'exact',
    network: wireNetwork,
    amount,
    // Compat for older xfuel-sdk readers that still look at maxAmountRequired.
    maxAmountRequired: amount,
    asset: assetAddress,
    payTo,
    maxTimeoutSeconds,
    extra: {
      name: eip712Name,
      version: eip712Version,
      taskId: p.taskId,
      nonce,
      expiresAt,
    },
  };

  const accepts = [baseAcceptsEntry];

  // ── Solana accepts entry (optional, second network) ─────────────────────────
  // When Solana is enabled, add a second accepts entry for Solana USDC.
  // Solana uses Ed25519 signatures — no EIP-712 domain. PayAI handles verification.
  // feePayer is REQUIRED by @x402/svm ExactSvmScheme — PayAI's facilitator pays tx fees.
  if (solanaEnabled) {
    const solNetwork = fromCaip2Network(p.solana.network || 'solana');
    const solWireNetwork = toCaip2Network(solNetwork);
    const { asset: solAsset, feePayer: solFeePayer } = usdcFor(solNetwork);
    const solPayTo = p.solana.payTo;
    // Solana nonce: 32 random bytes as base58 (PayAI spec) or hex. PayAI accepts both.
    // Using hex for consistency with the store key format.
    const solNonce = '0x' + crypto.randomBytes(32).toString('hex');

    // Store the Solana challenge binding (include feePayer for toPaymentRequirements)
    if (store) {
      const solRec = store.put(solNonce, {
        taskId: p.taskId,
        amount,
        asset: solAsset,
        network: solNetwork,
        payTo: solPayTo,
        feePayer: solFeePayer,  // Forwarded to toPaymentRequirements for PayAI /verify
        resource: resourceUrl,
        description,
        mimeType: 'application/json',
        extensions,
        outputSchema,
        facilitator: 'payai', // Route to PayAI for Solana
      });
      // expiresAt is already set from the Base entry
    }

    const solanaAcceptsEntry = {
      scheme: 'exact',
      network: solWireNetwork,
      amount,
      maxAmountRequired: amount,
      asset: solAsset,
      payTo: solPayTo,
      maxTimeoutSeconds,
      extra: {
        // feePayer is REQUIRED by @x402/svm. PayAI GET /supported advertises this account
        // as the fee payer for Solana mainnet. Without it, ExactSvmScheme throws.
        feePayer: solFeePayer,
        taskId: p.taskId,
        nonce: solNonce,
        expiresAt,
      },
    };
    accepts.push(solanaAcceptsEntry);
  }

  const body = {
    x402Version: 2,
    error: 'Payment required',
    resource: {
      url: resourceUrl,
      description,
      mimeType: 'application/json',
      serviceName,
      tags,
      iconUrl,
    },
    accepts,
  };

  // x402 offer-receipt §4.1: one signed offer per accepts[] entry.
  // Stored challenge extensions stay bazaar-only so settle still echoes bazaar,
  // not a fresh signature the client was not shown as the catalog extension.
  // validUntil is unix seconds; accepts[].extra.expiresAt stays milliseconds.
  const offerReceipt = await buildOfferExtension(accepts, resourceUrl, { expiresAtMs: expiresAt });
  const bodyExtensions = {
    ...(extensions || {}),
    ...(offerReceipt ? { [OFFER_RECEIPT_KEY]: offerReceipt } : {}),
  };
  if (Object.keys(bodyExtensions).length) body.extensions = bodyExtensions;

  return {
    status: 402,
    body,
    headers: {
      'PAYMENT-REQUIRED': encodePaymentRequiredHeader(body),
    },
  };
}

// ─── Shared facilitator resolution ─────────────────────────────────────────
/**
 * Which facilitator protocol to speak:
 *   'x402' → standard x402 facilitator (e.g. Coinbase's Base Sepolia reference)
 *   'zan'  → bespoke ZAN /verify+/settle contract (default; also the mock's shape)
 */
function resolveProvider(opts = {}) {
  const p = (opts.provider || process.env.X402_FACILITATOR_PROVIDER || 'zan').toLowerCase();
  return p === 'x402' ? 'x402' : 'zan';
}

/**
 * Resolve the facilitator gateway for a payment.
 *
 * Dual-network routing (2026-08-22):
 *   - Solana payments → PayAI facilitator (https://facilitator.payai.network)
 *   - Base/EVM payments → CDP facilitator or network-aware default
 *   - The challenge.network or opts.network determines the route
 *   - If the challenge was stored with `facilitator: 'payai'`, use PayAI
 *
 * IMPORTANT (2026-08-23 bugfix): For Solana payments, opts.gatewayUrl is IGNORED.
 * The caller (runX402Handshake) passes cfg.facilitatorUrl (the Base CDP URL) as
 * opts.gatewayUrl, which is correct for EVM but wrong for Solana. Solana payments
 * must use X402_SOLANA_FACILITATOR_URL or the PayAI default — never the CDP URL.
 *
 * @param {Object} opts
 * @param {string} [opts.network] - Network from the payment blob
 * @param {Object} [opts.challenge] - Bound challenge from the store
 * @returns {{ provider: string, gateway: string, apiKey: string|null }}
 */
function allowUnbound(opts = {}) {
  if (Object.prototype.hasOwnProperty.call(opts, 'allowUnbound')) return opts.allowUnbound === true;
  return process.env.X402_ALLOW_UNBOUND === 'true';
}

function resolveGateway(opts = {}) {
  const provider = resolveProvider(opts);
  const unbound = allowUnbound(opts);

  // The route is the challenge network. A client blob network is not a route.
  const network = opts.challenge?.network || (unbound ? opts.network : null) || null;
  if (!network) {
    return { provider, gateway: null, apiKey: null, reason: 'gateway_not_configured' };
  }

  const isPayAI = opts.challenge?.facilitator === 'payai' || isSolanaNetwork(network);
  if (isPayAI) {
    const gateway = opts.solanaFacilitatorUrl
      || opts.cfg?.solana?.facilitatorUrl
      || process.env.X402_SOLANA_FACILITATOR_URL
      || null;
    return {
      provider: 'x402',
      gateway,
      apiKey: opts.apiKey || null,
      reason: gateway ? null : 'gateway_not_configured',
    };
  }

  if (provider === 'x402') {
    const mainnet = network === 'base' || network === 'eip155:8453';
    const gateway = opts.gatewayUrl
      || opts.cfg?.facilitatorUrl
      || (mainnet ? null : defaultFacilitatorUrlForNetwork(network));
    return {
      provider,
      gateway: gateway || null,
      apiKey: opts.apiKey || null,
      reason: gateway ? null : 'gateway_not_configured',
    };
  }
  const gateway = opts.gatewayUrl || opts.cfg?.gatewayUrl || null;
  return {
    provider,
    gateway,
    apiKey: opts.apiKey || null,
    reason: gateway ? null : 'gateway_not_configured',
  };
}

/**
 * Resolve + validate the challenge bound to this payment (if binding requested).
 *
 * For Solana payments via PayAI, the facilitator can verify payments independently
 * even without a matching XFuel challenge. This enables receipts for payments where:
 *   - The challenge expired before the payer responded
 *   - The payer used a different client that didn't echo our nonce
 *   - The payment was made directly without going through our 402 flow
 *
 * @returns {{ ok:true, challenge:Object|null, unbound?:boolean }|{ ok:false, reason:string }}
 */
function checkBinding(opts) {
  const store = opts.store === undefined ? challengeStore : opts.store;
  const nonce = opts.nonce || opts.challenge?.nonce || null;
  const unboundOk = allowUnbound(opts);

  if (!nonce) {
    if (unboundOk) {
      logger.error({ where: 'checkBinding' }, 'x402: unbound payment path used');
      return { ok: true, challenge: opts.challenge || null, unbound: true };
    }
    return { ok: false, reason: 'challenge_required' };
  }

  if (store && store.isSpent(nonce)) return { ok: false, reason: 'payment_replayed' };

  let challenge = opts.challenge || null;
  if (store) {
    const stored = store.get(nonce);
    if (!stored) {
      if (unboundOk) {
        logger.error({ where: 'checkBinding' }, 'x402: unbound payment path used');
        return { ok: true, challenge: null, unbound: true };
      }
      return { ok: false, reason: 'challenge_required' };
    }
    challenge = stored;
  } else if (!challenge) {
    if (unboundOk) {
      logger.error({ where: 'checkBinding' }, 'x402: unbound payment path used');
      return { ok: true, challenge: null, unbound: true };
    }
    return { ok: false, reason: 'challenge_required' };
  }
  return { ok: true, challenge };
}

// ─── Verify ──────────────────────────────────────────────────────────────────
/**
 * Verify an x402 payment via the facilitator. When a nonce/challenge is supplied
 * (with a store), enforces expiry + replay + amount binding by forwarding the
 * expected values. Idempotent — does NOT mark spent (settle does).
 *
 * For unbound payments (challenge not found), the network is extracted from the
 * payment header to enable Solana routing even without a stored challenge.
 *
 * @param {string} paymentHeader  X-PAYMENT header value from the client
 * @param {Object} [opts]  { gatewayUrl, apiKey, store, nonce, challenge }
 * @returns {Promise<{valid:boolean, txRef?:string, reason?:string, unbound?:boolean}>}
 */
export async function verifyPayment(paymentHeader, opts = {}) {
  if (!paymentHeader) return { valid: false, reason: 'missing_payment_header' };

  // Look up the challenge FIRST so resolveGateway can determine the network.
  // This is critical for dual-network routing: Solana payments need the
  // challenge.network or challenge.facilitator to route to PayAI, not CDP.
  const bind = checkBinding(opts);
  if (!bind.ok) return { valid: false, reason: bind.reason };
  const challenge = bind.challenge;
  const unbound = !!bind.unbound;

  // Client facilitator URLs and blob networks are ignored on the enforced path.
  let networkFromHeader = null;
  if (unbound && !challenge) {
    const decoded = decodePaymentHeader(paymentHeader);
    networkFromHeader = decoded?.accepted?.network || decoded?.network || null;
  }

  const { provider, gateway, apiKey } = resolveGateway({
    ...opts,
    challenge,
    network: networkFromHeader || (unbound ? opts.network : null),
    allowUnbound: unbound,
  });
  // ZAN gateway requires an API key; the standard x402 public facilitator does not.
  if (!gateway || (provider === 'zan' && !apiKey)) {
    return { valid: false, reason: 'gateway_not_configured' };
  }

  if (provider === 'x402') {
    // Pass client x402 version (1 for X-PAYMENT, 2 for PAYMENT-SIGNATURE) to the facilitator.
    const result = await verifyViaFacilitator(paymentHeader, { gateway, apiKey, challenge, x402Version: opts.x402Version });
    return { ...result, unbound };
  }

  try {
    const res = await fetch(`${gateway.replace(/\/$/, '')}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({
        payment: paymentHeader,
        expected: challenge
          ? {
              amount: challenge.amount,
              asset: challenge.asset,
              network: challenge.network,
              payTo: challenge.payTo,
              resource: challenge.resource,
              nonce: challenge.nonce,
            }
          : undefined,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { valid: false, reason: `gateway_http_${res.status}`, unbound };
    const data = await res.json();
    return { valid: !!data.valid, txRef: data.txRef || data.transaction || null, reason: data.reason, unbound };
  } catch (err) {
    logger.warn({ err: err.message }, 'x402 verifyPayment failed');
    return { valid: false, reason: 'gateway_error', unbound };
  }
}

// ─── Settle ──────────────────────────────────────────────────────────────────
/**
 * Settle a verified x402 payment via the facilitator (broadcast/capture) and
 * mark the challenge nonce spent (replay protection). Call after verifyPayment.
 *
 * For unbound payments (challenge not found), settlement proceeds with the
 * facilitator determining validity. This enables receipts for Solana payments
 * made without our 402 handshake.
 *
 * @param {string} paymentHeader
 * @param {Object} [opts]  { gatewayUrl, apiKey, store, nonce, challenge }
 * @returns {Promise<{settled:boolean, txRef?:string, reason?:string, unbound?:boolean}>}
 */
export async function settlePayment(paymentHeader, opts = {}) {
  if (!paymentHeader) return { settled: false, reason: 'missing_payment_header' };

  // Look up the challenge FIRST so resolveGateway can determine the network.
  // This is critical for dual-network routing: Solana payments need the
  // challenge.network or challenge.facilitator to route to PayAI, not CDP.
  const bind = checkBinding(opts);
  if (!bind.ok) return { settled: false, reason: bind.reason };
  const challenge = bind.challenge;
  const unbound = !!bind.unbound;
  const store = opts.store === undefined ? challengeStore : opts.store;
  const nonce = opts.nonce || challenge?.nonce || null;

  let networkFromHeader = null;
  if (unbound && !challenge) {
    const decoded = decodePaymentHeader(paymentHeader);
    networkFromHeader = decoded?.accepted?.network || decoded?.network || null;
  }

  const { provider, gateway, apiKey } = resolveGateway({
    ...opts,
    challenge,
    network: networkFromHeader || (unbound ? opts.network : null),
    allowUnbound: unbound,
  });
  if (!gateway || (provider === 'zan' && !apiKey)) {
    return { settled: false, reason: 'gateway_not_configured' };
  }

  if (provider === 'x402') {
    // Pass client x402 version (1 for X-PAYMENT, 2 for PAYMENT-SIGNATURE) to the facilitator.
    const r = await settleViaFacilitator(paymentHeader, { gateway, apiKey, challenge, x402Version: opts.x402Version });
    if (r.settled && store && nonce && !opts.deferSpent) store.markSpent(nonce);
    return { ...r, unbound };
  }

  try {
    const res = await fetch(`${gateway.replace(/\/$/, '')}/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({
        payment: paymentHeader,
        nonce: nonce || undefined,
        network: challenge?.network || undefined,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { settled: false, reason: `gateway_http_${res.status}`, sent: true };
    const data = await res.json();
    const settled = !!(data.settled || data.success);
    const txRef = data.txRef || data.transaction || null;
    if (settled && store && nonce && !opts.deferSpent) store.markSpent(nonce);
    return {
      settled,
      success: data.success !== undefined ? !!data.success : settled,
      txRef,
      transaction: data.transaction || txRef,
      payer: data.payer || null,
      network: data.network || null,
      reason: data.reason,
      sent: true,
    };
  } catch (err) {
    logger.warn({ err: err.message }, 'x402 settlePayment failed');
    return { settled: false, reason: 'gateway_error', sent: true };
  }
}

// ─── A2A settlement mapping ──────────────────────────────────────────────────
/**
 * Map a verified+settled x402 payment to an XFuel A2A settlement plan.
 * Returns a descriptor the relayer can act on (no key handling here).
 *
 * @param {Object} p  { taskId, bidId, resultHash, txRef }
 * @returns {{ action:string, bidId:string, resultHash:string, paymentRef:string }}
 */
export function planA2ASettlement(p) {
  if (!p?.bidId || !p?.resultHash) throw new Error('bidId and resultHash are required');
  return {
    action: 'settleBidFairExchange',
    bidId: p.bidId,
    resultHash: p.resultHash,
    paymentRef: p.txRef || null,
    note: 'Submit via relayer or A2ACircuit calldata (xfuel-sdk/onchain encodeSettleBidFairExchange).',
  };
}
