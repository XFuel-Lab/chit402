/**
 * OpenRouter Broadcast → Chit book.
 *
 * Any OpenRouter customer can point a Webhook destination at
 * POST /v1/openrouter/broadcast with a per-book ingest key. Each generation
 * span becomes one signed receipt. The payment rail is `reported`: a book holder
 * reported the spend via OpenRouter Broadcast. Chit did not verify the payload
 * with OpenRouter and did not settle it. Idempotency is (book family, generation
 * id). The receipt id is random and is not derived from the generation id.
 *
 * Prompt and completion text is never required and never stored. Privacy Mode
 * on the OpenRouter destination is the recommended setup; if content arrives
 * anyway, it is dropped before the receipt is built.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import logger from './logger.js';
import { STAMP_FEE_UNITS } from './pricing.js';
import {
  buildReceipt,
  buildVerifyUrl,
  baseUrlFromReq,
  mergeReceiptView,
  REPORTED_ATTESTED_BY,
  REPORTED_ATTESTATION_NOTE,
} from './receipt.js';

export const SOURCE = 'openrouter_broadcast';
export const JOB_KIND = 'openrouter_broadcast';
export const PAYMENT_RAIL = 'reported';
export const ATTESTED_BY = REPORTED_ATTESTED_BY;
export const ATTESTATION_NOTE = REPORTED_ATTESTATION_NOTE;

const DEFAULT_DAILY_CAP = 10_000;
const DEFAULT_RATE_PER_MIN = 60;
const DEFAULT_CREATE_PER_HOUR = 30;
const METADATA_MAX = 256;

const CONTENT_KEYS = new Set([
  'input',
  'output',
  'prompt',
  'completion',
  'messages',
  'content',
  'choices',
  'gen_ai.prompt',
  'gen_ai.completion',
  'gen_ai.input.messages',
  'gen_ai.output.messages',
  'gen_ai.request.messages',
  'gen_ai.response.choices',
  'gen_ai.content.prompt',
  'gen_ai.content.completion',
  'llm.input',
  'llm.output',
]);

const SKIP_OBSERVATION_TYPES = new Set([
  'SPAN',
  'PROVIDER_ATTEMPT',
  'PROVIDER-ATTEMPT',
  'AGENT',
  'TOOL',
  'EVENT',
]);

/** @type {Map<string, object>} */
const books = new Map();
/** @type {Map<string, string>} */
const keys = new Map();
/** Idempotency index keyed by book family and generation id. Not global on generation id. */
const byFamilyGeneration = new Map();
/** @type {Map<string, object>} */
const byTask = new Map();
/** @type {object[]} */
const receipts = [];

let persistDir = null;

class WindowLimiter {
  constructor(windowMs) {
    this.windowMs = windowMs;
    /** @type {Map<string, number[]>} */
    this.buckets = new Map();
    this._gcTimer = setInterval(() => this._gc(), 5 * 60_000);
    if (typeof this._gcTimer.unref === 'function') this._gcTimer.unref();
  }

  allow(key, maxHits) {
    const now = Date.now();
    const max = Number(maxHits);
    if (!Number.isFinite(max) || max < 0) return true;
    let hits = this.buckets.get(key);
    if (!hits) {
      hits = [];
      this.buckets.set(key, hits);
    }
    const cutoff = now - this.windowMs;
    while (hits.length && hits[0] <= cutoff) hits.shift();
    if (hits.length >= max) return false;
    hits.push(now);
    return true;
  }

  retryAfterSec(key) {
    const hits = this.buckets.get(key) || [];
    if (!hits.length) return 1;
    const resetMs = hits[0] + this.windowMs - Date.now();
    return Math.max(1, Math.ceil(resetMs / 1000));
  }

  reset() {
    this.buckets.clear();
  }

  _gc() {
    const cutoff = Date.now() - this.windowMs;
    for (const [key, hits] of this.buckets) {
      const active = hits.filter((t) => t > cutoff);
      if (active.length === 0) this.buckets.delete(key);
      else this.buckets.set(key, active);
    }
  }

  destroy() {
    clearInterval(this._gcTimer);
    this.buckets.clear();
  }
}

const minuteLimiter = new WindowLimiter(60_000);
const hourLimiter = new WindowLimiter(60 * 60_000);

function flagOn(raw, defaultOn) {
  if (raw == null || String(raw).trim() === '') return defaultOn;
  return !/^(0|false|off|no)$/i.test(String(raw).trim());
}

export function broadcastEnabled(env = process.env) {
  return flagOn(env.OPENROUTER_BROADCAST_ENABLED, true);
}

export function pilotFree(env = process.env) {
  return flagOn(env.OPENROUTER_BROADCAST_PILOT_FREE, true);
}

export function dailyCap(env = process.env) {
  const raw = env.OPENROUTER_BROADCAST_DAILY_CAP;
  if (raw == null || String(raw).trim() === '') return DEFAULT_DAILY_CAP;
  const n = Number(String(raw).trim());
  if (!Number.isInteger(n) || n < 0) return DEFAULT_DAILY_CAP;
  return n;
}

function ratePerMin(env = process.env) {
  const raw = env.OPENROUTER_BROADCAST_RATE_PER_MIN;
  if (raw == null || String(raw).trim() === '') return DEFAULT_RATE_PER_MIN;
  const n = Number(String(raw).trim());
  if (!Number.isInteger(n) || n < 1) return DEFAULT_RATE_PER_MIN;
  return n;
}

function createPerHour(env = process.env) {
  const raw = env.OPENROUTER_BOOK_CREATE_PER_HOUR;
  if (raw == null || String(raw).trim() === '') return DEFAULT_CREATE_PER_HOUR;
  const n = Number(String(raw).trim());
  if (!Number.isInteger(n) || n < 1) return DEFAULT_CREATE_PER_HOUR;
  return n;
}

export function hashIngestKey(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex');
}

function isContentKey(key) {
  const lower = String(key || '').toLowerCase();
  if (!lower) return false;
  if (CONTENT_KEYS.has(lower)) return true;
  if (lower.endsWith('.prompt') || lower.endsWith('.completion') || lower.endsWith('.messages')) return true;
  if (lower.endsWith('.choices')) return true;
  if (/(^|\.)content$/.test(lower) && !lower.includes('cost')) return true;
  if (/(^|\.)input$/.test(lower) && !lower.includes('cost') && !lower.includes('token')) return true;
  if (/(^|\.)output$/.test(lower) && !lower.includes('cost') && !lower.includes('token')) return true;
  return false;
}

function unwrapOtlp(value, dropped) {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value !== 'object') return null;
  if ('stringValue' in value) return value.stringValue;
  if ('intValue' in value) return value.intValue;
  if ('doubleValue' in value) return value.doubleValue;
  if ('boolValue' in value) return value.boolValue;
  if ('bytesValue' in value) return null;
  if (value.arrayValue && Array.isArray(value.arrayValue.values)) {
    return value.arrayValue.values.map((item) => unwrapOtlp(item, dropped));
  }
  if (value.kvlistValue && Array.isArray(value.kvlistValue.values)) {
    const obj = {};
    for (const kv of value.kvlistValue.values) {
      if (!kv || kv.key == null) continue;
      if (isContentKey(kv.key)) {
        dropped.yes = true;
        continue;
      }
      obj[kv.key] = unwrapOtlp(kv.value, dropped);
    }
    return obj;
  }
  return null;
}

function attributeMap(span) {
  const dropped = { yes: false };
  const out = {};
  const attrs = span?.attributes;
  if (Array.isArray(attrs)) {
    for (const attr of attrs) {
      if (!attr || attr.key == null) continue;
      if (isContentKey(attr.key)) {
        dropped.yes = true;
        continue;
      }
      out[attr.key] = unwrapOtlp(attr.value, dropped);
    }
  } else if (attrs && typeof attrs === 'object') {
    for (const [key, value] of Object.entries(attrs)) {
      if (isContentKey(key)) {
        dropped.yes = true;
        continue;
      }
      out[key] = unwrapOtlp(value, dropped);
    }
  }
  return { map: out, contentDropped: dropped.yes };
}

function firstAttr(map, names) {
  for (const name of names) {
    const value = map[name];
    if (value != null && value !== '') return value;
  }
  return null;
}

function asNumber(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value));
  return Number.isFinite(n) ? n : null;
}

function asInt(value) {
  const n = asNumber(value);
  if (n == null || n < 0) return null;
  return Math.round(n);
}

function asUsd(value) {
  const n = asNumber(value);
  if (n == null || n < 0) return null;
  return n;
}

function usdString(value) {
  if (value == null) return null;
  const text = String(value);
  if (!/^\d+(\.\d+)?$/.test(text)) {
    const n = asUsd(value);
    if (n == null) return null;
    return String(n);
  }
  return text;
}

export function usdToAtomic(usd) {
  const n = asUsd(usd);
  if (n == null) return null;
  return String(Math.round(n * 1_000_000));
}

function atomicToUsd(atomic) {
  let n;
  try { n = BigInt(String(atomic)); } catch { return '0'; }
  if (n < 0n) n = 0n;
  const whole = n / 1_000_000n;
  const frac = (n % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : String(whole);
}

function parseMaybeJson(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text.startsWith('{') && !text.startsWith('[')) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function slimGenerationMeta(value) {
  const parsed = parseMaybeJson(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const keep = ['id', 'usage', 'is_byok', 'usage_is_estimated', 'cache_write_tokens', 'inputCost', 'outputCost', 'totalCost'];
  const out = {};
  for (const key of keep) {
    if (parsed[key] != null && !isContentKey(key)) out[key] = parsed[key];
  }
  return Object.keys(out).length ? out : null;
}

function metadataFrom(map, dropped) {
  const meta = {};
  for (const [key, value] of Object.entries(map)) {
    if (!key.startsWith('trace.metadata.')) continue;
    const name = key.slice('trace.metadata.'.length);
    if (!name || isContentKey(name)) {
      dropped.yes = true;
      continue;
    }
    if (typeof value === 'string') {
      if (value.length > METADATA_MAX) {
        dropped.yes = true;
        continue;
      }
      meta[name] = value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      meta[name] = value;
    }
  }
  return meta;
}

function nanoString(value) {
  if (value == null || value === '') return null;
  const text = String(value);
  return /^\d+$/.test(text) ? text : null;
}

function spansOf(body) {
  const spans = [];
  const resources = Array.isArray(body?.resourceSpans) ? body.resourceSpans : [];
  for (const resource of resources) {
    const scopes = resource?.scopeSpans || resource?.instrumentationLibrarySpans || [];
    if (!Array.isArray(scopes)) continue;
    for (const scope of scopes) {
      if (!Array.isArray(scope?.spans)) continue;
      for (const span of scope.spans) spans.push(span);
    }
  }
  return spans;
}

function observationType(map, span) {
  const raw = firstAttr(map, [
    'openrouter.observation.type',
    'observation.type',
    'gen_ai.observation.type',
    'type',
  ]);
  if (raw != null && String(raw).trim()) return String(raw).trim().toUpperCase();
  const name = span?.name != null ? String(span.name).trim().toUpperCase() : '';
  if (name === 'GENERATION' || name === 'PROVIDER_ATTEMPT' || name === 'SPAN') return name;
  return '';
}

/**
 * Pull generation spans out of an OTLP JSON payload.
 * Fabricated fixtures may include a `_fixture` note; it is ignored.
 * @param {object} body
 * @returns {object[]}
 */
export function parseOtlpGenerations(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
  const generations = [];
  for (const span of spansOf(body)) {
    if (!span || typeof span !== 'object') continue;
    const { map, contentDropped } = attributeMap(span);
    const dropped = { yes: contentDropped };
    const type = observationType(map, span);
    if (SKIP_OBSERVATION_TYPES.has(type)) continue;

    const generationMeta = slimGenerationMeta(firstAttr(map, [
      'metadata.openrouter_generation',
      'openrouter.generation',
      'openrouter_generation',
    ]));
    const model = firstAttr(map, [
      'gen_ai.request.model',
      'gen_ai.response.model',
      'model',
      'openrouter.model',
    ]);
    const promptTokens = asInt(firstAttr(map, [
      'gen_ai.usage.prompt_tokens',
      'gen_ai.usage.input_tokens',
      'promptTokens',
      'openrouter.prompt_tokens',
    ]));
    const completionTokens = asInt(firstAttr(map, [
      'gen_ai.usage.completion_tokens',
      'gen_ai.usage.output_tokens',
      'completionTokens',
      'openrouter.completion_tokens',
    ]));
    const totalTokens = asInt(firstAttr(map, [
      'gen_ai.usage.total_tokens',
      'totalTokens',
    ]));
    let inputCost = asUsd(firstAttr(map, ['inputCost', 'gen_ai.usage.input_cost', 'openrouter.input_cost']));
    let outputCost = asUsd(firstAttr(map, ['outputCost', 'gen_ai.usage.output_cost', 'openrouter.output_cost']));
    let totalCost = asUsd(firstAttr(map, ['totalCost', 'gen_ai.usage.cost', 'openrouter.total_cost']));
    if (inputCost == null && generationMeta) inputCost = asUsd(generationMeta.inputCost);
    if (outputCost == null && generationMeta) outputCost = asUsd(generationMeta.outputCost);
    if (totalCost == null && generationMeta) totalCost = asUsd(generationMeta.totalCost ?? generationMeta.usage);
    if (totalCost == null && inputCost != null && outputCost != null) totalCost = inputCost + outputCost;

    const hasUsage = promptTokens != null || completionTokens != null || totalCost != null || inputCost != null;
    const explicitGeneration = type === 'GENERATION' || type === 'CHAT' || type === 'COMPLETION';
    if (!explicitGeneration && !(model && hasUsage)) continue;

    const explicitId = firstAttr(map, [
      'gen_ai.response.id',
      'openrouter.generation.id',
      'generation.id',
      'gen_ai.generation.id',
      'openrouter.generation_id',
    ]);
    const generationId = String(explicitId || generationMeta?.id || span.spanId || '').trim();
    if (!generationId) continue;

    const traceMetadata = metadataFrom(map, dropped);
    const userId = firstAttr(map, ['user.id', 'gen_ai.user.id', 'userId']);
    const sessionId = firstAttr(map, ['session.id', 'gen_ai.session.id', 'sessionId']);
    const providerName = firstAttr(map, ['providerName', 'provider_name', 'gen_ai.provider.name', 'openrouter.provider_name']);
    const providerSlug = firstAttr(map, ['providerSlug', 'provider_slug', 'gen_ai.system', 'openrouter.provider_slug']);

    generations.push({
      generationId,
      traceId: span.traceId != null ? String(span.traceId) : null,
      spanId: span.spanId != null ? String(span.spanId) : null,
      model: model != null ? String(model).slice(0, 200) : null,
      providerName: providerName != null ? String(providerName).slice(0, 120) : null,
      providerSlug: providerSlug != null ? String(providerSlug).slice(0, 120) : null,
      promptTokens,
      completionTokens,
      totalTokens,
      inputCostUsd: usdString(inputCost),
      outputCostUsd: usdString(outputCost),
      totalCostUsd: usdString(totalCost),
      userId: userId != null ? String(userId).slice(0, 128) : null,
      sessionId: sessionId != null ? String(sessionId).slice(0, 256) : null,
      traceMetadata,
      chitBook: traceMetadata.chit_book != null ? String(traceMetadata.chit_book) : null,
      agentId: traceMetadata.agent_id != null ? String(traceMetadata.agent_id) : null,
      startTimeUnixNano: nanoString(span.startTimeUnixNano),
      endTimeUnixNano: nanoString(span.endTimeUnixNano),
      providerTtftMs: asNumber(firstAttr(map, [
        'openrouter.provider_time_to_first_token_ms',
        'openrouter_provider_time_to_first_token_ms',
      ])),
      interTokenLatencyMs: asNumber(firstAttr(map, [
        'openrouter.inter_token_latency_ms',
        'openrouter_inter_token_latency_ms',
      ])),
      contentDropped: dropped.yes,
      openrouterGeneration: generationMeta,
    });
  }
  return generations;
}

function familyGenerationKey(familyId, generationId) {
  return `${familyId}\0${generationId}`;
}

/** Receipt id is random. Knowing the generation id does not yield the verify_url. */
function freshTaskId() {
  for (let i = 0; i < 5; i++) {
    const id = `openrouter-${crypto.randomBytes(16).toString('hex')}`;
    if (!byTask.has(id)) return id;
  }
  return `openrouter-${crypto.randomBytes(24).toString('hex')}`;
}

function durationMs(start, end) {
  if (!start || !end) return null;
  try {
    return Number((BigInt(end) - BigInt(start)) / 1_000_000n);
  } catch {
    return null;
  }
}

function stampBlock(env) {
  const waived = pilotFree(env);
  return {
    fee_units: String(STAMP_FEE_UNITS),
    fee_usd: '0.002',
    currency: 'USDC',
    charged: false,
    waived,
    pilot: waived,
    charge_status: waived ? 'pilot_waived' : 'unbilled',
    budget_debited: false,
  };
}

function presentEnvelope(envelope, { baseUrl = '', reqHost = null } = {}) {
  if (!envelope || !envelope.task_id) return null;
  const verifyUrl = buildVerifyUrl(baseUrl, envelope.task_id, { reqHost });
  return {
    ...envelope,
    verify_url: verifyUrl,
    links: {
      ...(envelope.links || {}),
      self: verifyUrl,
      json: `${verifyUrl}?format=json`,
    },
  };
}

function countToday(bookId, now) {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let n = 0;
  for (const row of receipts) {
    if (row.book_id !== bookId) continue;
    const at = Date.parse(row.created_at);
    if (Number.isFinite(at) && at >= start) n += 1;
  }
  return n;
}

function familyBooks(familyId) {
  const rows = [];
  for (const book of books.values()) {
    if (book.family_id === familyId) rows.push(book);
  }
  return rows;
}

function resolveBook(authBook, generation) {
  const family = familyBooks(authBook.family_id);
  if (generation.chitBook) {
    const hit = family.find((book) => book.book_id === generation.chitBook);
    if (hit) return { book: hit, routedBy: 'chit_book' };
  }
  if (generation.agentId) {
    const hit = family.find((book) => book.agent_id != null && book.agent_id === generation.agentId);
    if (hit) return { book: hit, routedBy: 'agent_id' };
  }
  return { book: authBook, routedBy: null };
}

function bookForKey(raw) {
  if (!raw) return null;
  const id = keys.get(hashIngestKey(raw));
  return id ? books.get(id) || null : null;
}

export function ingestKeyFromRequest(req) {
  const custom = req?.headers?.['x-chit-ingest-key'];
  if (custom != null && String(custom).trim()) return String(custom).trim();
  const auth = req?.headers?.authorization || '';
  const match = String(auth).match(/^Bearer\s+(\S+)\s*$/i);
  return match ? match[1] : null;
}

function clientIp(req) {
  return String(req?.ip || req?.socket?.remoteAddress || 'anon');
}

function cleanLabel(value) {
  if (value == null) return null;
  const text = String(value).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80);
  return text || null;
}

function cleanAgentId(value) {
  if (value == null || value === '') return { tag: null, numeric: null };
  const text = String(value).trim();
  if (!/^[A-Za-z0-9_.:@-]{1,128}$/.test(text)) {
    return { error: 'agent_id must be 1–128 characters of letters, numbers, and _.:@-' };
  }
  let numeric = null;
  if (/^[1-9]\d*$/.test(text)) {
    const n = Number(text);
    if (!Number.isSafeInteger(n)) {
      return { error: 'agent_id integer is out of range' };
    }
    numeric = n;
  }
  return { tag: text, numeric };
}

function persistBooks() {
  if (!persistDir) return;
  try {
    fs.mkdirSync(persistDir, { recursive: true });
    const file = path.join(persistDir, 'openrouter-books.json');
    const body = JSON.stringify({ books: [...books.values()] });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, file);
  } catch (err) {
    logger.warn({ err: err.message }, 'openrouter-broadcast: book persist failed');
  }
}

function persistReceipt(record) {
  if (!persistDir) return;
  try {
    fs.mkdirSync(persistDir, { recursive: true });
    const file = path.join(persistDir, 'openrouter-receipts.jsonl');
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
  } catch (err) {
    logger.warn({ err: err.message }, 'openrouter-broadcast: receipt persist failed');
  }
}

function indexReceipt(record, { persist = true } = {}) {
  receipts.push(record);
  const familyId = record.family_id || record.book_id;
  if (familyId && record.generation_id) {
    byFamilyGeneration.set(familyGenerationKey(familyId, record.generation_id), record);
  }
  byTask.set(record.task_id, record);
  if (persist) persistReceipt(record);
}

function loadPersisted() {
  books.clear();
  keys.clear();
  byFamilyGeneration.clear();
  byTask.clear();
  receipts.length = 0;
  if (!persistDir) return;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(persistDir, 'openrouter-books.json'), 'utf8'));
    for (const book of raw?.books || []) {
      if (!book?.book_id || !book?.key_hash) continue;
      books.set(book.book_id, book);
      keys.set(book.key_hash, book.book_id);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') logger.warn({ err: err.message }, 'openrouter-broadcast: book load failed');
  }
  try {
    const text = fs.readFileSync(path.join(persistDir, 'openrouter-receipts.jsonl'), 'utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      if (!row?.generation_id || !row?.task_id) continue;
      indexReceipt(row, { persist: false });
    }
  } catch (err) {
    if (err.code !== 'ENOENT') logger.warn({ err: err.message }, 'openrouter-broadcast: receipt load failed');
  }
}

/**
 * @param {{ dir?: string|null, persist?: boolean }} [opts]
 */
export function configureOpenRouterBroadcast({ dir = null, persist = false } = {}) {
  persistDir = persist && dir ? String(dir) : null;
  loadPersisted();
}

export function resetOpenRouterBroadcastForTests() {
  books.clear();
  keys.clear();
  byFamilyGeneration.clear();
  byTask.clear();
  receipts.length = 0;
  minuteLimiter.reset();
  hourLimiter.reset();
  persistDir = null;
}

function issueKey() {
  return `chit_or_${crypto.randomBytes(32).toString('base64url')}`;
}

/**
 * Mint a book. The ingest key is returned once and stored only as a hash.
 * A presented family key creates another book in that family.
 */
export function createOpenRouterBook(body = {}, { familyBook = null, now = new Date() } = {}) {
  const agent = cleanAgentId(body.agent_id);
  if (agent.error) {
    return { ok: false, status: 400, error: 'validation_error', message: agent.error };
  }
  const ingestKey = issueKey();
  const bookId = `orb_${crypto.randomBytes(16).toString('hex')}`;
  const book = {
    book_id: bookId,
    family_id: familyBook?.family_id || bookId,
    key_hash: hashIngestKey(ingestKey),
    agent_id: agent.tag,
    agent_id_numeric: agent.numeric,
    label: cleanLabel(body.label),
    created_at: now.toISOString(),
  };
  books.set(book.book_id, book);
  keys.set(book.key_hash, book.book_id);
  persistBooks();
  return { ok: true, status: 201, book, ingestKey };
}

export function publicBook(book) {
  if (!book) return null;
  return {
    book_id: book.book_id,
    family_id: book.family_id,
    agent_id: book.agent_id,
    label: book.label,
    created_at: book.created_at,
  };
}

function stampGeneration(generation, book, routedBy, deps) {
  const existing = byFamilyGeneration.get(familyGenerationKey(book.family_id, generation.generationId));
  if (existing) {
    return { ok: true, idempotent: true, record: existing };
  }
  const cap = dailyCap(deps.env);
  if (countToday(book.book_id, deps.now) >= cap) {
    return { ok: false, status: 429, error: 'daily_cap', generationId: generation.generationId };
  }

  const taskId = freshTaskId();
  const atomic = usdToAtomic(generation.totalCostUsd) ?? '0';
  const startSec = generation.startTimeUnixNano
    ? Number(BigInt(generation.startTimeUnixNano) / 1_000_000_000n)
    : Math.floor(deps.now.getTime() / 1000);
  const endSec = generation.endTimeUnixNano
    ? Number(BigInt(generation.endTimeUnixNano) / 1_000_000_000n)
    : startSec;
  const usage = {};
  if (generation.promptTokens != null) usage.prompt_tokens = generation.promptTokens;
  if (generation.completionTokens != null) usage.completion_tokens = generation.completionTokens;
  if (generation.totalTokens != null) usage.total_tokens = generation.totalTokens;
  usage.source = ATTESTED_BY;
  const hasTokens = generation.promptTokens != null || generation.completionTokens != null;

  const task = {
    taskId,
    status: 'completed',
    createdAt: startSec,
    updatedAt: endSec,
    kind: SOURCE,
    intent: {
      type: SOURCE,
      paymentRail: PAYMENT_RAIL,
      paymentRef: `openrouter:${book.family_id}:${generation.generationId}`,
      amount: atomic,
      model: generation.model,
      proveAllowed: false,
    },
    feeBps: 0,
    feeAmount: '0',
    netAmount: atomic,
    usage: hasTokens ? usage : null,
    meta: {
      job_kind: JOB_KIND,
      provider: generation.providerSlug || generation.providerName || null,
      paymentAsset: 'USD',
      resource: 'https://openrouter.ai',
    },
    sp1Proof: { skipped: true },
  };

  const envelope = buildReceipt(task, {
    baseUrl: deps.baseUrl,
    signingSecret: deps.signingSecret,
    coSignerSecret: deps.coSignerSecret,
    reqHost: deps.reqHost,
  });
  const stamp = stampBlock(deps.env);
  envelope.source = SOURCE;
  envelope.kind = SOURCE;
  envelope.evidence = 'openrouter_reported';
  envelope.attestation_note = ATTESTATION_NOTE;
  envelope.stamp = stamp;
  envelope.reported = {
    generation_id: generation.generationId,
    trace_id: generation.traceId,
    span_id: generation.spanId,
    provider_name: generation.providerName,
    provider_slug: generation.providerSlug,
    input_cost_usd: generation.inputCostUsd,
    output_cost_usd: generation.outputCostUsd,
    total_cost_usd: generation.totalCostUsd,
    gross_amount_atomic: atomic,
    asset: 'USD',
    user_id: generation.userId,
    session_id: generation.sessionId,
    trace_metadata: generation.traceMetadata,
    chit_book: generation.chitBook,
    agent_id: generation.agentId || book.agent_id || null,
    timing: {
      start_time_unix_nano: generation.startTimeUnixNano,
      end_time_unix_nano: generation.endTimeUnixNano,
      duration_ms: durationMs(generation.startTimeUnixNano, generation.endTimeUnixNano),
      provider_ttft_ms: generation.providerTtftMs,
      inter_token_latency_ms: generation.interTokenLatencyMs,
    },
    content_dropped: generation.contentDropped === true,
    privacy: generation.contentDropped
      ? 'prompt_and_completion_dropped'
      : 'no_prompt_or_completion_present',
    routed_by: routedBy,
    book_id: book.book_id,
    attested_by: ATTESTED_BY,
    openrouter_generation: generation.openrouterGeneration,
  };

  const record = {
    generation_id: generation.generationId,
    task_id: taskId,
    book_id: book.book_id,
    family_id: book.family_id,
    created_at: deps.now.toISOString(),
    reported_atomic: atomic,
    total_cost_usd: generation.totalCostUsd,
    receipt: envelope,
  };
  indexReceipt(record);

  const numericAgent = book.agent_id_numeric;
  const registry = deps.registry;
  const knownAgent = numericAgent && registry && typeof registry.get === 'function'
    ? registry.get(numericAgent)
    : null;
  if (knownAgent && deps.ledger && typeof deps.ledger.append === 'function') {
    const view = mergeReceiptView(envelope);
    const appended = deps.ledger.append({
      ...envelope,
      payment: {
        rail: PAYMENT_RAIL,
        ref: `openrouter:${book.family_id}:${generation.generationId}`,
        collected: false,
        gross_amount: atomic,
        net_amount: atomic,
        fee_amount: '0',
        asset: 'USD',
      },
      route: {
        ...(view.route || {}),
        hub: 'openrouter',
        model: generation.model,
        provider: generation.providerSlug || generation.providerName || null,
        job_kind: JOB_KIND,
      },
      source: SOURCE,
      kind: SOURCE,
      public_receipt: envelope,
    }, { agentId: numericAgent });
    if (!appended.ok && appended.code !== 'duplicate_ref' && appended.code !== 'duplicate_task') {
      logger.warn({
        taskId,
        code: appended.code,
        reason: appended.reason,
      }, 'openrouter-broadcast: agent book append skipped');
    }
  }

  logger.info({
    bookId: book.book_id,
    taskId,
    generationId: generation.generationId,
    model: generation.model,
  }, 'openrouter-broadcast: stamped');

  return { ok: true, idempotent: false, record };
}

/**
 * Stamp one receipt per generation. Idempotent on (book family, generation id).
 */
export function ingestOpenRouterBroadcast(body, {
  book,
  signingSecret = null,
  coSignerSecret = null,
  baseUrl = '',
  reqHost = null,
  ledger = null,
  registry = null,
  env = process.env,
  now = new Date(),
} = {}) {
  if (!book) {
    return { ok: false, status: 401, error: 'unauthorized', message: 'OpenRouter Broadcast requires a Chit book ingest key.' };
  }
  if (body != null && (typeof body !== 'object' || Array.isArray(body))) {
    return { ok: false, status: 400, error: 'invalid_payload', message: 'Expected an OTLP JSON object.' };
  }
  const payload = body && typeof body === 'object' ? body : {};
  if (!Array.isArray(payload.resourceSpans)) {
    return {
      ok: true,
      status: 200,
      body: { ok: true, book_id: book.book_id, stamped: 0, replayed: 0, skipped: 0, capped: 0, empty: true },
    };
  }

  const generations = parseOtlpGenerations(payload);
  const skipped = spansOf(payload).length - generations.length;
  const deps = { signingSecret, coSignerSecret, baseUrl, reqHost, ledger, registry, env, now };
  const stamped = [];
  const replayed = [];
  const capped = [];

  for (const generation of generations) {
    const target = resolveBook(book, generation);
    const result = stampGeneration(generation, target.book, target.routedBy, deps);
    const summary = {
      generation_id: generation.generationId,
      book_id: result.record?.book_id || target.book.book_id,
      task_id: result.record?.task_id || null,
      verify_url: result.record
        ? presentEnvelope(result.record.receipt, { baseUrl, reqHost }).verify_url
        : null,
      idempotent: result.idempotent === true,
    };
    if (result.ok && result.idempotent) replayed.push(summary);
    else if (result.ok) stamped.push(summary);
    else if (result.error === 'daily_cap') capped.push({ generation_id: generation.generationId, book_id: target.book.book_id });
  }

  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      book_id: book.book_id,
      stamped: stamped.length,
      replayed: replayed.length,
      skipped: Math.max(0, skipped),
      capped: capped.length,
      receipts: [...stamped, ...replayed],
      capped_generation_ids: capped.map((row) => row.generation_id),
      stamp_fee_usd: '0.002',
      stamp_charged: false,
      pilot_free: pilotFree(env),
    },
  };
}

export function listOpenRouterReceipts(book, { limit = 50, baseUrl = '', reqHost = null } = {}) {
  const n = Math.min(200, Math.max(1, Number(limit) || 50));
  const rows = [];
  for (let i = receipts.length - 1; i >= 0 && rows.length < n; i--) {
    if (receipts[i].book_id !== book.book_id) continue;
    rows.push(presentEnvelope(receipts[i].receipt, { baseUrl, reqHost }));
  }
  return {
    book_id: book.book_id,
    agent_id: book.agent_id,
    receipts: rows,
  };
}

/**
 * Public aggregate. The principal book is not a public index, so this summary
 * is counts and reported USD only — no generation ids, users, or receipt rows.
 */
export function publicOpenRouterSummary(book, { env = process.env } = {}) {
  if (!book) return null;
  let atomic = 0n;
  let count = 0;
  for (const row of receipts) {
    if (row.book_id !== book.book_id) continue;
    count += 1;
    try { atomic += BigInt(row.reported_atomic || '0'); } catch { /* skip */ }
  }
  const feeAtomic = BigInt(STAMP_FEE_UNITS) * BigInt(count);
  return {
    book_id: book.book_id,
    public: true,
    generations: count,
    reported_usd: atomicToUsd(atomic),
    stamp_fee_usd_recorded: atomicToUsd(feeAtomic),
    stamp_fee_usd_each: '0.002',
    stamp_charged: false,
    collected: false,
    verified: false,
    verified_with: null,
    pilot_free: pilotFree(env),
    note: 'Aggregate only. Figures were reported to this book via OpenRouter Broadcast. Chit did not verify them with OpenRouter and did not settle these payments. They are not collected or verified spend. Receipt rows are not listed here.',
  };
}

export function findOpenRouterPublicReceipt(taskId, { baseUrl = '', reqHost = null, ledgerRow = null } = {}) {
  if (!taskId) return null;
  const stored = byTask.get(String(taskId));
  if (stored?.receipt) return presentEnvelope(stored.receipt, { baseUrl, reqHost });
  const snap = ledgerRow?.receipt_snapshot;
  if (snap && (snap.source === SOURCE || snap.kind === SOURCE || snap.evidence === 'openrouter_reported')) {
    return presentEnvelope(snap, { baseUrl, reqHost });
  }
  return null;
}

function rateLimited(res, seconds) {
  res.set('Retry-After', String(seconds));
  return res.status(429).json({
    error: 'rate_limited',
    message: 'Too many OpenRouter Broadcast requests. Try again later.',
  });
}

function disabled(res) {
  return res.status(404).json({ error: 'not_found', message: 'OpenRouter Broadcast is not enabled.' });
}

/**
 * Mount POST /v1/openrouter/books, POST|PUT /v1/openrouter/broadcast,
 * GET receipt list (ingest key), and GET public summary.
 */
export function registerOpenRouterBroadcast(app, {
  ledger = null,
  registry = null,
  signingSecret = null,
  coSignerSecret = null,
  publicBaseUrl = null,
  publicHosts = null,
} = {}) {
  function ctx(req) {
    const reqHost = typeof req?.get === 'function' ? req.get('host') : null;
    const baseUrl = baseUrlFromReq(req, publicBaseUrl, publicHosts);
    return { reqHost, baseUrl };
  }

  app.post('/v1/openrouter/books', (req, res) => {
    try {
      if (!broadcastEnabled()) return disabled(res);
      const ip = clientIp(req);
      if (!hourLimiter.allow(`create:${ip}`, createPerHour())) {
        return rateLimited(res, hourLimiter.retryAfterSec(`create:${ip}`));
      }
      const presented = ingestKeyFromRequest(req);
      const familyBook = presented ? bookForKey(presented) : null;
      if (presented && !familyBook) {
        return res.status(401).json({
          error: 'unauthorized',
          message: 'Ingest key does not match a Chit book.',
        });
      }
      const created = createOpenRouterBook(req.body || {}, { familyBook });
      if (!created.ok) {
        return res.status(created.status).json({ error: created.error, message: created.message });
      }
      const { baseUrl } = ctx(req);
      const key = created.ingestKey;
      return res.status(201).json({
        book_id: created.book.book_id,
        family_id: created.book.family_id,
        agent_id: created.book.agent_id,
        label: created.book.label,
        ingest_key: key,
        shown_once: true,
        authorization: `Bearer ${key}`,
        headers: {
          Authorization: `Bearer ${key}`,
          'X-Chit-Ingest-Key': key,
        },
        webhook: {
          url: `${String(baseUrl || '').replace(/\/$/, '')}/v1/openrouter/broadcast`,
          method: 'POST',
        },
        stamp_fee_usd: '0.002',
        stamp_charged: false,
        pilot_free: pilotFree(),
      });
    } catch (err) {
      logger.error({ err: err.message }, 'POST /v1/openrouter/books error');
      return res.status(500).json({ error: 'internal', message: 'Internal server error' });
    }
  });

  function handleBroadcast(req, res) {
    try {
      if (!broadcastEnabled()) return disabled(res);
      const ip = clientIp(req);
      const perMin = ratePerMin();
      if (!minuteLimiter.allow(`ip:${ip}`, perMin)) {
        return rateLimited(res, minuteLimiter.retryAfterSec(`ip:${ip}`));
      }
      const presented = ingestKeyFromRequest(req);
      const book = bookForKey(presented);
      if (!book) {
        return res.status(401).json({
          error: 'unauthorized',
          message: 'OpenRouter Broadcast requires a Chit book ingest key.',
        });
      }
      const keyBucket = `key:${book.key_hash}`;
      if (!minuteLimiter.allow(keyBucket, perMin)) {
        return rateLimited(res, minuteLimiter.retryAfterSec(keyBucket));
      }
      const test = String(req.headers['x-test-connection'] || '').toLowerCase() === 'true';
      if (test) {
        return res.status(200).json({ ok: true, test: true, book_id: book.book_id });
      }
      const { baseUrl, reqHost } = ctx(req);
      const result = ingestOpenRouterBroadcast(req.body, {
        book,
        signingSecret,
        coSignerSecret,
        baseUrl,
        reqHost,
        ledger,
        registry,
        now: new Date(),
      });
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error, message: result.message });
      }
      return res.status(result.status).json(result.body);
    } catch (err) {
      logger.error({ err: err.message }, 'POST /v1/openrouter/broadcast error');
      return res.status(500).json({ error: 'internal', message: 'Internal server error' });
    }
  }

  app.post('/v1/openrouter/broadcast', handleBroadcast);
  app.put('/v1/openrouter/broadcast', handleBroadcast);

  app.get('/v1/openrouter/books/:book_id/receipts', (req, res) => {
    try {
      if (!broadcastEnabled()) return disabled(res);
      const ip = clientIp(req);
      const perMin = ratePerMin();
      if (!minuteLimiter.allow(`ip:${ip}`, perMin)) {
        return rateLimited(res, minuteLimiter.retryAfterSec(`ip:${ip}`));
      }
      const book = books.get(String(req.params.book_id || ''));
      if (!book) return res.status(404).json({ error: 'not_found', message: 'Book not found.' });
      const presented = ingestKeyFromRequest(req);
      const authBook = bookForKey(presented);
      if (!authBook || authBook.family_id !== book.family_id) {
        return res.status(401).json({
          error: 'unauthorized',
          message: 'OpenRouter book receipts require that book\'s ingest key.',
        });
      }
      if (!minuteLimiter.allow(`key:${authBook.key_hash}`, perMin)) {
        return rateLimited(res, minuteLimiter.retryAfterSec(`key:${authBook.key_hash}`));
      }
      const { baseUrl, reqHost } = ctx(req);
      return res.json(listOpenRouterReceipts(book, {
        limit: req.query.limit,
        baseUrl,
        reqHost,
      }));
    } catch (err) {
      logger.error({ err: err.message }, 'GET openrouter receipts error');
      return res.status(500).json({ error: 'internal', message: 'Internal server error' });
    }
  });

  app.get('/v1/openrouter/books/:book_id/summary', (req, res) => {
    try {
      if (!broadcastEnabled()) return disabled(res);
      const ip = clientIp(req);
      if (!minuteLimiter.allow(`ip:${ip}`, ratePerMin())) {
        return rateLimited(res, minuteLimiter.retryAfterSec(`ip:${ip}`));
      }
      const book = books.get(String(req.params.book_id || ''));
      if (!book) return res.status(404).json({ error: 'not_found', message: 'Book not found.' });
      return res.json(publicOpenRouterSummary(book));
    } catch (err) {
      logger.error({ err: err.message }, 'GET openrouter summary error');
      return res.status(500).json({ error: 'internal', message: 'Internal server error' });
    }
  });
}
