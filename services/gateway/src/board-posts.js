/**
 * Endpoint reports (agent board P0).
 *
 * A report cites one receipt already on the poster's own book and pays the
 * standard $0.002 stamp. Warnings are outcomes (double_charge, price_jump),
 * not a separate post type.
 *
 * v0.5 adds stamp-backed first posts (when the book has nothing left to cite),
 * comments, likes, and "I paid this too" confirms.
 * Jobs, bids, and the payout receipt live in board-jobs.js.
 * Not in this module: offers, Musegram / 1F916 mirroring.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import logger from './logger.js';
import { STAMP_FEE_UNITS } from './pricing.js';
import { deriveEvidence, BOOK_EVIDENCE } from './usage-settled.js';

export const BOARD_TYPE_ENDPOINT_REPORT = 'endpoint_report';

/** Types this phase accepts. Job and offer are later phases. */
export const BOARD_TYPES_P0 = Object.freeze([BOARD_TYPE_ENDPOINT_REPORT]);

export const DEFERRED_POST_TYPES = Object.freeze(['job', 'offer', 'warning', 'reply']);

export const REPORT_OUTCOMES = Object.freeze([
  'success',
  'error',
  'double_charge',
  'price_jump',
]);

export const WARNING_OUTCOMES = Object.freeze(['double_charge', 'price_jump']);

export const NOTE_MAX = 1000;
export const COMMENT_MAX = 500;
export const LIST_DEFAULT = 50;
export const LIST_MAX = 100;
export const BOARD_STORE_VERSION = 5;

export const BACKING_STAMP = 'stamp-backed';
export const BACKING_SPEND = 'spend-backed';

export const FOREIGN_NOTICE = 'recorded by XFuel, not attested by the merchant';

const DEFAULT_CHIT_HOSTS = ['api.chit402.com', 'api.xfuel.app'];

export function houseAgentIdsFromEnv(env = process.env) {
  return parseIdList(env.BOARD_HOUSE_AGENT_IDS);
}

export function suspendedAgentIdsFromEnv(env = process.env) {
  return parseIdList(env.BOARD_POSTING_SUSPENDED_AGENT_IDS);
}

function parseIdList(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => Number(String(s).trim()))
    .filter((n) => Number.isInteger(n) && n >= 1);
}

export function chitHostsFromEnv(env = process.env) {
  const set = new Set(DEFAULT_CHIT_HOSTS);
  const base = env.PUBLIC_BASE_URL;
  if (base) {
    try { set.add(new URL(base).host.toLowerCase()); } catch { /* ignore */ }
  }
  for (const h of String(env.PUBLIC_HOSTS || '').split(',')) {
    const t = h.trim().toLowerCase();
    if (t) set.add(t.replace(/^https?:\/\//, '').replace(/\/.*$/, ''));
  }
  return set;
}

/**
 * Obvious secrets. Returns a category or null. Never returns the matched text.
 * @param {string} text
 */
export function findSecret(text) {
  const s = String(text ?? '');
  if (/sk-[A-Za-z0-9]/.test(s)) return 'api_key';
  if (/\bghp_[A-Za-z0-9]{8,}/.test(s)) return 'api_key';
  if (/\bgithub_pat_[A-Za-z0-9_]{8,}/.test(s)) return 'api_key';
  if (/\bxox[bp]-[A-Za-z0-9-]{8,}/.test(s)) return 'api_key';
  if (/\bAKIA[0-9A-Z]{16}\b/.test(s)) return 'api_key';
  if (/Bearer\s+[A-Za-z0-9\-._~+/]{8,}/i.test(s)) return 'bearer';
  if (/-----BEGIN [A-Z0-9 ]+-----/.test(s)) return 'pem';
  if (/(?:^|[^A-Fa-f0-9])(?:0x)?[A-Fa-f0-9]{64}(?![A-Fa-f0-9])/.test(s)) return 'hex_key';
  return null;
}

const LINK_TLDS = new Set([
  'com', 'net', 'org', 'io', 'ai', 'app', 'dev', 'xyz', 'co', 'gg', 'link', 'ly',
  'me', 'info', 'biz', 'cc', 'tv', 'finance', 'cash', 'shop', 'pro', 'site',
  'online', 'click', 'top', 'win',
]);

/** Hosts that may be named in post and comment text, plus the report's own endpoint. */
const TEXT_HOST_SUFFIXES = ['chit402.com', 'xfuel.app'];

function normalizeLinkHost(host) {
  return String(host || '').trim().toLowerCase().replace(/\.$/, '').replace(/:\d+$/, '');
}

function linkHostAllowed(host, allowHosts) {
  const h = normalizeLinkHost(host);
  if (!h || /[\s/]/.test(h)) return false;
  for (const raw of allowHosts || []) {
    if (normalizeLinkHost(raw) === h) return true;
  }
  for (const suffix of TEXT_HOST_SUFFIXES) {
    if (h === suffix || h.endsWith(`.${suffix}`)) return true;
  }
  return false;
}

function hostFromLoose(token) {
  const t = String(token || '').trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) {
    try { return new URL(t).hostname; } catch { return null; }
  }
  const m = t.match(/[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)+/i);
  return m ? m[0] : null;
}

function unfoldDefang(text) {
  return String(text)
    .replace(/\[\s*\.\s*\]/g, '.')
    .replace(/\(\s*\.\s*\)/g, '.')
    .replace(/\{\s*\.\s*\}/g, '.')
    .replace(/\[\s*dot\s*\]/gi, '.')
    .replace(/\(\s*dot\s*\)/gi, '.')
    .replace(/\{\s*dot\s*\}/gi, '.');
}

/**
 * Posts and comments reject links. Returns a category or null. Never returns the match.
 * `allowHosts` may name the report's own endpoint host. chit402.com and xfuel.app
 * (and their subdomains) are always allowed. Every other domain is still rejected.
 */
export function findLink(text, { allowHosts = [] } = {}) {
  const raw = String(text ?? '');
  const urls = raw.match(/https?:\/\/[^\s<>"'`)\]]+/gi) || [];
  for (const url of urls) {
    let host = null;
    try { host = new URL(url).hostname; } catch { /* unparsable URL is still a link */ }
    if (!linkHostAllowed(host, allowHosts)) return 'url';
  }
  if (/\bwww\./i.test(raw)) {
    const hits = raw.match(/\bwww\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)*/gi) || [];
    if (hits.length === 0) return 'url';
    for (const hit of hits) {
      if (!linkHostAllowed(hit, allowHosts)) return 'url';
    }
  }
  const markdown = raw.match(/\[[^\]]*\]\([^)]+\)/g) || [];
  for (const hit of markdown) {
    const target = hit.slice(hit.indexOf('(') + 1, -1);
    if (!linkHostAllowed(hostFromLoose(target), allowHosts)) return 'markdown';
  }
  const hrefs = raw.match(/\bhref\s*=\s*["']?[^"'\s>]+/gi) || [];
  for (const hit of hrefs) {
    const target = hit.replace(/\bhref\s*=\s*["']?/i, '');
    if (!linkHostAllowed(hostFromLoose(target), allowHosts)) return 'html';
  }
  const s = unfoldDefang(raw);
  const withPath = s.match(/\b[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)*\.[a-z]{2,24}(?=\/)/gi) || [];
  for (const hit of withPath) {
    if (!linkHostAllowed(hit, allowHosts)) return 'domain';
  }
  const bare = s.match(/\b[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\.[a-z]{2,24}\b/gi) || [];
  for (const hit of bare) {
    const tld = hit.slice(hit.lastIndexOf('.') + 1).toLowerCase();
    if (!LINK_TLDS.has(tld)) continue;
    if (!linkHostAllowed(hit, allowHosts)) return 'domain';
  }
  return null;
}

export function parseEndpointUrl(raw) {
  const text = String(raw ?? '').trim();
  if (!text || text.length > 2048) {
    return { ok: false, reason: 'endpoint must be an https URL' };
  }
  if (findSecret(text)) {
    return { ok: false, error: 'secret_rejected', reason: 'endpoint URL looks like a secret and was not stored' };
  }
  let url;
  try { url = new URL(text); } catch {
    return { ok: false, reason: 'endpoint must be an https URL' };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'endpoint must be https' };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'endpoint must not contain credentials' };
  }
  if (!url.hostname || url.hostname === 'localhost' || url.hostname.endsWith('.local')) {
    return { ok: false, reason: 'endpoint host is not public' };
  }
  return { ok: true, host: url.host.toLowerCase() };
}

export class BoardPostStore {
  /**
   * @param {{ dir?: string|null, persist?: boolean }} [opts]
   */
  constructor({ dir = null, persist = false } = {}) {
    this.dir = persist && dir ? String(dir) : null;
    this.persist = !!this.dir;
    /** @type {Map<string, object>} */
    this.byId = new Map();
    /** @type {Map<string, string>} type:receiptKey → post id */
    this.byReceipt = new Map();
    /** @type {Map<string, { kind: string, id: string }>} receipt key → post or confirm */
    this.backingKeys = new Map();
    /** Stamp payment refs that already backed a post. */
    this.stampRefs = new Set();
    /** @type {Map<string, object>} */
    this.comments = new Map();

    if (this.persist) {
      try {
        fs.mkdirSync(this.dir, { recursive: true });
        this._load();
      } catch (err) {
        logger.warn({ err: err.message, dir: this.dir }, 'board-posts: persist disabled');
        this.persist = false;
        this.dir = null;
      }
    }
  }

  _file() {
    return path.join(this.dir, 'board-posts.json');
  }

  _load() {
    try {
      const data = JSON.parse(fs.readFileSync(this._file(), 'utf8'));
      const migrated = migrateBoardDocument(data);
      for (const post of migrated.posts) {
        this.byId.set(post.id, post);
        if (receiptStaysIndexed(post)) this.claimReceipt(post);
        if (post.stamp_ref) this.stampRefs.add(String(post.stamp_ref));
        for (const confirm of post.confirms || []) {
          if (confirm?.receipt_key) {
            this.claimBacking(confirm.receipt_key, { kind: 'confirm', id: confirm.id });
          }
        }
      }
      for (const comment of migrated.comments) {
        this.comments.set(comment.id, comment);
      }
      if (migrated.changed) this._save();
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn({ err: err.message }, 'board-posts: load failed');
      }
    }
  }

  _save() {
    if (!this.persist) return;
    try {
      const target = this._file();
      const tmp = `${target}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify({
        version: BOARD_STORE_VERSION,
        posts: [...this.byId.values()],
        comments: [...this.comments.values()],
      }));
      fs.renameSync(tmp, target);
    } catch (err) {
      logger.warn({ err: err.message }, 'board-posts: save failed');
    }
  }

  get(id) {
    return this.byId.get(String(id)) || null;
  }

  findByReceipt(type, receiptKey) {
    const id = this.byReceipt.get(receiptIndexKey(type, receiptKey));
    return id ? this.get(id) : null;
  }

  /**
   * Ops hide drops the receipt out of the unique index so the owner can
   * re-post once. Taken-down posts keep the index.
   */
  releaseReceipt(post) {
    if (!post?.receipt_key || !post.type) return;
    const key = receiptIndexKey(post.type, post.receipt_key);
    if (this.byReceipt.get(key) === post.id) this.byReceipt.delete(key);
    const owner = this.backingKeys.get(post.receipt_key);
    if (owner && owner.kind === 'post' && owner.id === post.id) this.backingKeys.delete(post.receipt_key);
  }

  claimReceipt(post) {
    this.byReceipt.set(receiptIndexKey(post.type, post.receipt_key), post.id);
    this.claimBacking(post.receipt_key, { kind: 'post', id: post.id });
  }

  claimBacking(key, owner) {
    const id = key == null ? '' : String(key);
    if (!id) return false;
    const existing = this.backingKeys.get(id);
    if (existing) return existing.kind === owner.kind && existing.id === owner.id;
    this.backingKeys.set(id, owner);
    return true;
  }

  isReceiptTaken(key) {
    if (key == null || key === '') return false;
    return this.backingKeys.has(String(key));
  }

  reserveStamp(ref) {
    const id = ref == null ? '' : String(ref);
    if (!id) return false;
    if (this.stampRefs.has(id) || this.backingKeys.has(id)) return false;
    this.stampRefs.add(id);
    return true;
  }

  releaseStamp(ref) {
    if (ref == null) return;
    this.stampRefs.delete(String(ref));
  }

  isStampUsed(ref) {
    if (ref == null || ref === '') return false;
    const id = String(ref);
    return this.stampRefs.has(id) || this.backingKeys.has(id);
  }

  /**
   * Claim the receipt and store the post. False when that receipt already
   * backs a post or a confirm. Synchronous so two in-flight stamps cannot both win.
   */
  tryInsert(post) {
    if (post.receipt_key && this.isReceiptTaken(post.receipt_key)) return false;
    this.byId.set(post.id, post);
    this.claimReceipt(post);
    if (post.stamp_ref) this.stampRefs.add(String(post.stamp_ref));
    this._save();
    return true;
  }

  insert(post) {
    if (!this.tryInsert(post)) {
      throw new Error('receipt already backs a board row');
    }
    return post;
  }

  commentsFor(postId) {
    return [...this.comments.values()]
      .filter((c) => c.post_id === postId)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  }

  addComment(comment) {
    this.comments.set(comment.id, comment);
    this._save();
    return comment;
  }

  getComment(id) {
    return this.comments.get(String(id)) || null;
  }

  update(post) {
    this.byId.set(post.id, post);
    this._save();
    return post;
  }

  list() {
    return [...this.byId.values()];
  }
}

function receiptIndexKey(type, receiptKey) {
  return `${type}:${receiptKey}`;
}

/**
 * P0 files are `{ posts }`. v0.5 adds comments, likes, confirms, and backing.
 * Existing reports cited a spend receipt, so a missing backing becomes spend-backed.
 * Idempotent.
 */
export function migrateBoardDocument(data) {
  const src = data && typeof data === 'object' ? data : {};
  let changed = src.version !== BOARD_STORE_VERSION || !Array.isArray(src.comments);
  const posts = (Array.isArray(src.posts) ? src.posts : []).map((post) => {
    const next = { ...post };
    if (next.backing !== BACKING_STAMP && next.backing !== BACKING_SPEND) {
      next.backing = BACKING_SPEND;
      changed = true;
    }
    if (!Array.isArray(next.likes)) {
      next.likes = [];
      changed = true;
    }
    if (!Array.isArray(next.confirms)) {
      next.confirms = [];
      changed = true;
    }
    if (!Array.isArray(next.flags)) next.flags = [];
    return next;
  });
  const comments = (Array.isArray(src.comments) ? src.comments : []).map((comment) => ({ ...comment }));
  return { version: BOARD_STORE_VERSION, posts, comments, changed };
}

/**
 * A taken-down tombstone keeps its receipt forever.
 * Ops hide of a live post sets free_repost and drops the index so the owner
 * can publish that receipt once more. Any other stored row stays indexed.
 */
function receiptStaysIndexed(post) {
  if (!post?.receipt_key || !post.type) return false;
  if (post.status === 'taken_down') return true;
  if (post.status === 'hidden' && post.free_repost === true) return false;
  return true;
}

function newPostId() {
  return `rpt_${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * Public post. Callers get id, type, status, and — for a live report —
 * endpoint host, amount, outcome, latency, date, verify link, labels,
 * foreign notice, and untrusted_text. Render untrusted_text as plain text.
 * Receipt refs, payer wallets, tx ids, and rejected notes are not included.
 * A list's endpoint totals are separate and publish distinct_payers as a
 * count, never the addresses.
 */
function toPublicConfirm(confirm) {
  const house = confirm?.house === true;
  if (confirm?.foreign === true) {
    return {
      house,
      amount: confirm.amount != null ? String(confirm.amount) : null,
      foreign_notice: FOREIGN_NOTICE,
    };
  }
  return {
    house,
    amount: confirm.amount != null ? String(confirm.amount) : null,
    date: confirm.date || null,
    verify_url: confirm.verify_url || null,
    foreign_notice: null,
  };
}

export function toPublicComment(comment) {
  if (!comment || comment.status === 'hidden') return null;
  if (comment.status === 'taken_down') {
    return {
      id: comment.id,
      post_id: comment.post_id,
      status: 'taken_down',
      taken_down_at: comment.taken_down_at || null,
    };
  }
  return {
    id: comment.id,
    post_id: comment.post_id,
    status: 'live',
    untrusted_text: comment.untrusted_text ?? '',
    created_at: comment.created_at || null,
  };
}

export function toPublicPost(post, { comments = [] } = {}) {
  if (!post) return null;
  if (post.status === 'hidden') return null;
  if (post.status === 'taken_down') {
    return {
      id: post.id,
      type: post.type,
      status: 'taken_down',
      taken_down_at: post.taken_down_at || null,
    };
  }
  const publicComments = (comments || []).map(toPublicComment).filter(Boolean);
  const confirms = (Array.isArray(post.confirms) ? post.confirms : []).map(toPublicConfirm);
  return {
    id: post.id,
    type: post.type,
    status: 'live',
    endpoint_host: post.endpoint_host,
    amount: post.amount != null ? String(post.amount) : null,
    outcome: post.outcome,
    latency_ms: post.latency_ms == null ? null : post.latency_ms,
    date: post.date || null,
    verify_url: post.verify_url || null,
    untrusted_text: post.untrusted_text ?? '',
    labels: Array.isArray(post.labels) ? post.labels : [],
    foreign_notice: post.foreign_notice || null,
    counts_on_scoreboard: post.counts_on_scoreboard !== false,
    backing: post.backing === BACKING_STAMP ? BACKING_STAMP : BACKING_SPEND,
    like_count: Array.isArray(post.likes) ? post.likes.length : 0,
    confirm_count: (Array.isArray(post.confirms) ? post.confirms : []).filter((c) => c && c.house !== true).length,
    comment_count: publicComments.filter((c) => c.status === 'live').length,
    confirms,
    comments: publicComments,
  };
}

const PUBLIC_LIVE_KEYS = [
  'id', 'type', 'status', 'endpoint_host', 'amount', 'outcome', 'latency_ms',
  'date', 'verify_url', 'untrusted_text', 'labels', 'foreign_notice', 'counts_on_scoreboard',
  'backing', 'like_count', 'confirm_count', 'comment_count', 'confirms', 'comments',
];

export function publicPostKeys(post) {
  const view = toPublicPost(post);
  if (!view) return [];
  return Object.keys(view);
}

export { PUBLIC_LIVE_KEYS };

export function endpointSummaries(posts) {
  /** @type {Map<string, object>} */
  const byHost = new Map();
  for (const post of posts) {
    if (!post || post.status !== 'live') continue;
    const host = post.endpoint_host;
    if (!host) continue;
    let row = byHost.get(host);
    if (!row) {
      row = {
        endpoint_host: host,
        payers: new Set(),
        total: 0n,
        report_count: 0,
        self_report_count: 0,
        house_report_count: 0,
        warning_count: 0,
        stamp_backed_count: 0,
      };
      byHost.set(host, row);
    }
    const counts = post.counts_on_scoreboard !== false && post.self !== true && post.house !== true;
    if (post.house === true) row.house_report_count += 1;
    if (post.self === true) row.self_report_count += 1;
    if (post.backing === BACKING_STAMP) row.stamp_backed_count += 1;
    if (counts) {
      row.report_count += 1;
      if (post.payer_wallet) row.payers.add(String(post.payer_wallet).toLowerCase());
      if (post.amount != null) {
        try { row.total += BigInt(String(post.amount)); } catch { /* skip */ }
      }
      if (WARNING_OUTCOMES.includes(post.outcome)) row.warning_count += 1;
    }
  }
  return [...byHost.values()]
    .map((row) => ({
      endpoint_host: row.endpoint_host,
      distinct_payers: row.payers.size,
      total_paid: row.total.toString(),
      report_count: row.report_count,
      self_report_count: row.self_report_count,
      house_report_count: row.house_report_count,
      warning_count: row.warning_count,
      stamp_backed_count: row.stamp_backed_count,
    }))
    .sort((a, b) => a.endpoint_host.localeCompare(b.endpoint_host));
}

function fail(status, error, message, extra = {}) {
  return { ok: false, status, error, message, ...extra };
}

export function resolveBoardActor(req, { registry, verify, claim } = {}) {
  if (!registry || typeof registry.getBySession !== 'function') {
    return fail(503, 'service_unavailable', 'Registry not configured');
  }
  const body = req?.body && typeof req.body === 'object' ? req.body : {};
  const headers = req?.headers || {};
  const session = claim?.session || body.session || headers['x-xfuel-session'] || null;
  if (session) {
    const identity = registry.getBySession(String(session));
    if (!identity) return fail(403, 'forbidden', 'Session does not match a registered agent');
    if (body.agent_id != null && body.agent_id !== '' && Number(body.agent_id) !== identity.agent_id) {
      return fail(403, 'forbidden', 'Session does not match agent_id');
    }
    if (!identity.agentWallet) {
      return fail(403, 'unregistered', 'Register a wallet before posting on the board');
    }
    return { ok: true, identity };
  }
  const proof = claim?.proof || body.proof || body.hmac || headers['x-xfuel-book-proof'] || null;
  const agentId = Number(body.agent_id);
  if (proof && Number.isInteger(agentId) && agentId >= 1 && typeof verify === 'function') {
    const window = Number.isInteger(Number(claim?.limit)) ? Number(claim.limit) : 50;
    const checked = verify({ agentId, window, session: null, proof: String(proof) });
    if (!checked || checked.valid !== true) {
      return fail(403, 'forbidden', 'Book proof does not match agent_id');
    }
    const identity = registry.get(agentId);
    if (!identity?.agentWallet) {
      return fail(403, 'unregistered', 'Register a wallet before posting on the board');
    }
    return { ok: true, identity };
  }
  return fail(401, 'unauthorized', 'Possession proof (session) is required');
}

function opsToken(env = process.env) {
  const raw = env.BOARD_OPS_TOKEN;
  if (raw == null) return '';
  return String(raw).trim();
}

export function authorizeOps(header, env = process.env) {
  const expected = opsToken(env);
  if (!expected) {
    return fail(503, 'ops_unavailable', 'Board ops hide is not configured');
  }
  const got = header == null ? '' : String(header);
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return fail(got ? 403 : 401, got ? 'forbidden' : 'unauthorized', 'Ops token rejected');
  }
  return { ok: true };
}

function findOwnedReceipt(ledger, agentId, receiptRef) {
  const ref = String(receiptRef || '').trim();
  if (!ref || ref.length > 512) return null;
  const id = Number(agentId);
  const rows = [];
  if (typeof ledger?.findByRef === 'function') {
    const row = ledger.findByRef(ref);
    if (row) rows.push(row);
  }
  if (typeof ledger?.findByTask === 'function') {
    const row = ledger.findByTask(ref);
    if (row) rows.push(row);
  }
  for (const row of rows) {
    if (Number(row.agent_id) === id) return row;
  }
  return null;
}

function isForeignEntry(entry) {
  const evidence = deriveEvidence(entry);
  return evidence === BOOK_EVIDENCE.FOREIGN_INGEST
    || entry?.foreign_x402 === true
    || entry?.source === 'foreign_ingest';
}

function receiptEndpointHost(entry, chitHosts) {
  if (isForeignEntry(entry)) {
    const snap = entry.receipt_snapshot || {};
    const resource = snap.route?.resource || snap.payment?.resource || null;
    if (resource) {
      try { return { host: new URL(resource).host.toLowerCase() }; } catch { /* fall through */ }
    }
    const hub = snap.route?.hub || entry.hub;
    if (hub && String(hub).includes('.')) return { host: String(hub).toLowerCase() };
    return { host: null };
  }
  return { chit: true, hosts: chitHosts };
}

function payToOf(entry) {
  const snap = entry?.receipt_snapshot;
  return snap?.payment?.payTo || snap?.route?.payTo || entry?.pay_to || null;
}

function payerOf(entry) {
  return entry?.payer || entry?.receipt_snapshot?.payment?.payer || null;
}

function dateOf(entry) {
  const raw = entry?.collected_at || entry?.recorded_at || null;
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function verifyUrlFor(entry, baseUrl) {
  if (!entry?.task_id) return null;
  const base = String(baseUrl || 'https://api.chit402.com').replace(/\/$/, '');
  return `${base}/receipt/${encodeURIComponent(entry.task_id)}`;
}

function canonicalReceiptKey(entry, requested) {
  if (entry?.payment_ref) return String(entry.payment_ref);
  if (entry?.task_id) return String(entry.task_id);
  return String(requested);
}

function normalizeType(raw) {
  if (raw == null || raw === '') return { ok: true, type: BOARD_TYPE_ENDPOINT_REPORT };
  const type = String(raw).trim();
  if (type === 'warning') {
    return {
      ok: false,
      status: 400,
      error: 'warning_is_outcome',
      message: 'A warning is a report with outcome double_charge or price_jump',
    };
  }
  if (DEFERRED_POST_TYPES.includes(type) && type !== 'warning') {
    return {
      ok: false,
      status: 400,
      error: 'not_in_this_phase',
      message: `Post type ${type} is not available yet`,
    };
  }
  if (!BOARD_TYPES_P0.includes(type)) {
    return { ok: false, status: 400, error: 'unknown_type', message: 'Unknown post type' };
  }
  return { ok: true, type };
}

function parseOutcome(raw) {
  const outcome = String(raw ?? '').trim();
  if (!REPORT_OUTCOMES.includes(outcome)) {
    return {
      ok: false,
      status: 400,
      error: 'invalid_outcome',
      message: `outcome must be one of ${REPORT_OUTCOMES.join(', ')}`,
    };
  }
  return { ok: true, outcome };
}

function parseLatency(raw) {
  if (raw == null || raw === '') return { ok: true, latency_ms: null };
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > 86_400_000) {
    return { ok: false, status: 400, error: 'invalid_latency', message: 'latency_ms must be an integer number of milliseconds' };
  }
  return { ok: true, latency_ms: raw };
}

function parseNote(body, { allowHosts = [] } = {}) {
  const hasText = Object.prototype.hasOwnProperty.call(body, 'text');
  const hasNote = Object.prototype.hasOwnProperty.call(body, 'note');
  if (hasText && hasNote && String(body.text ?? '') !== String(body.note ?? '')) {
    return { ok: false, status: 400, error: 'invalid_text', message: 'text and note disagree' };
  }
  const raw = hasText ? body.text : (hasNote ? body.note : '');
  if (raw == null) return { ok: true, text: '' };
  if (typeof raw !== 'string') {
    return { ok: false, status: 400, error: 'invalid_text', message: 'text must be a string' };
  }
  const text = raw.trim();
  if (text.length > NOTE_MAX) {
    return { ok: false, status: 400, error: 'text_too_long', message: `text is longer than ${NOTE_MAX} characters` };
  }
  if (text.includes('\0')) {
    return { ok: false, status: 400, error: 'invalid_text', message: 'text must be plain text' };
  }
  if (findSecret(text)) {
    return {
      ok: false,
      status: 400,
      error: 'secret_rejected',
      message: 'Post text looks like a secret and was not stored',
    };
  }
  if (findLink(text, { allowHosts })) {
    return {
      ok: false,
      status: 400,
      error: 'link_rejected',
      message: 'Post text cannot contain links',
    };
  }
  return { ok: true, text };
}

async function collectStamp(ensureStamp) {
  if (typeof ensureStamp !== 'function') {
    return fail(503, 'stamp_unavailable', 'The $0.002 board stamp cannot be collected');
  }
  let stamp;
  try {
    stamp = await ensureStamp();
  } catch (err) {
    logger.warn({ err: err.message }, 'board stamp failed');
    return fail(402, 'stamp_payment_required', 'Board stamp payment failed');
  }
  if (!stamp || stamp.ok !== true) {
    return {
      ok: false,
      status: stamp?.status || 402,
      error: stamp?.error || 'stamp_payment_required',
      message: stamp?.message || 'Board stamp is $0.002 USDC (2000 atomic), paid by the poster. Prepaid budget is not debited.',
      challenge: stamp?.challenge || null,
    };
  }
  return {
    ok: true,
    waived: stamp.waived === true,
    waiverKey: stamp.waiverKey === true,
    settlement: stamp.settlement || null,
  };
}

function writeStampRow(ledger, { agentId, taskId, stamp, parentRef, purpose, postId }) {
  if (!ledger || typeof ledger.recordBoardEvent !== 'function') {
    return { ok: false, reason: 'ledger unavailable' };
  }
  const waived = stamp.waived === true;
  const paymentRef = waived
    ? `waiver:board:${taskId}`
    : (stamp.settlement?.paymentRef || null);
  return ledger.recordBoardEvent({
    agentId,
    kind: 'board_stamp',
    taskId,
    paymentRef,
    amount: String(STAMP_FEE_UNITS),
    collected: !waived && !!paymentRef,
    rail: waived ? null : 'usdc',
    parentRef,
    board: {
      post_id: postId,
      purpose,
      waived,
      waived_reason: waived ? (stamp.waiverKey === true ? 'pilot' : 'ops_repost') : null,
      fee_units: String(STAMP_FEE_UNITS),
    },
  });
}

function writePostRow(ledger, { agentId, post, phase }) {
  return ledger.recordBoardEvent({
    agentId,
    kind: 'board_post',
    taskId: phase === 'published' ? `board-post-${post.id}` : `board-post-${post.id}-${phase}`,
    parentRef: post.receipt_key,
    board: {
      post_id: post.id,
      type: post.type,
      phase,
      receipt_ref: post.receipt_key,
      backing: post.backing || BACKING_SPEND,
      endpoint_host: post.endpoint_host,
    },
  });
}

/**
 * Dry list of the house agent's own spend rows that could become reports.
 * Does not write posts and does not invent text.
 */
export function planHouseSeed(ledger, { agentId, posts, chitHosts, limit = 50 } = {}) {
  const id = Number(agentId);
  if (!ledger || typeof ledger.listByAgent !== 'function' || !Number.isInteger(id)) return [];
  const hosts = chitHosts || chitHostsFromEnv();
  const out = [];
  const rows = ledger.listByAgent(id, { limit: 200 });
  for (const entry of rows) {
    const evidence = deriveEvidence(entry);
    if (evidence !== BOOK_EVIDENCE.COLLECTED && evidence !== BOOK_EVIDENCE.FOREIGN_INGEST) continue;
    const bound = receiptEndpointHost(entry, hosts);
    const host = bound.chit ? 'api.chit402.com' : bound.host;
    if (!host) continue;
    const key = canonicalReceiptKey(entry, entry.task_id);
    if (posts && typeof posts.findByReceipt === 'function'
      && posts.findByReceipt(BOARD_TYPE_ENDPOINT_REPORT, key)) {
      continue;
    }
    out.push({
      receipt_ref: key,
      endpoint_host: host,
      amount: entry.amount != null ? String(entry.amount) : null,
      date: dateOf(entry),
      foreign: isForeignEntry(entry),
    });
    if (out.length >= limit) break;
  }
  return out;
}

function isCitableSpend(entry) {
  const evidence = deriveEvidence(entry);
  if (evidence !== BOOK_EVIDENCE.COLLECTED && evidence !== BOOK_EVIDENCE.FOREIGN_INGEST) return false;
  if (entry?.amount == null || String(entry.amount).trim() === '') return false;
  return true;
}

function agentHasUnusedCitable(ledger, agentId, posts, endpointHost, hosts) {
  const id = Number(agentId);
  const rows = Array.isArray(ledger?.entries) ? ledger.entries : [];
  for (const entry of rows) {
    if (Number(entry.agent_id) !== id) continue;
    if (!isCitableSpend(entry)) continue;
    const key = canonicalReceiptKey(entry, entry.task_id);
    if (posts.isReceiptTaken(key)) continue;
    if (assertReceiptHost(entry, endpointHost, hosts).ok) return true;
  }
  return false;
}

function assertReceiptHost(owned, endpointHost, hosts) {
  const bound = receiptEndpointHost(owned, hosts);
  if (bound.chit) {
    if (!hosts.has(endpointHost)) {
      return fail(400, 'endpoint_mismatch', 'A Chit receipt can only report the Chit gateway host');
    }
    return { ok: true };
  }
  if (!bound.host || bound.host !== endpointHost) {
    return fail(400, 'endpoint_mismatch', 'Receipt is not for this endpoint');
  }
  return { ok: true };
}

export async function createEndpointReport(body = {}, deps = {}) {
  const {
    posts,
    ledger,
    isDemo = false,
    ensureStamp = null,
    houseAgentIds = null,
    suspendedAgentIds = null,
    chitHosts = null,
    baseUrl = 'https://api.chit402.com',
    actor = null,
    commitStampWaiver = null,
  } = deps;

  if (isDemo) return fail(403, 'demo_rejected', 'Demo keys cannot post on the board');
  if (!actor?.agent_id) return fail(401, 'unauthorized', 'Possession proof (session) is required');
  if (!posts) return fail(503, 'service_unavailable', 'Board store is not configured');

  const suspended = suspendedAgentIds || suspendedAgentIdsFromEnv();
  if (suspended.includes(Number(actor.agent_id))) {
    return fail(403, 'posting_suspended', 'Posting is suspended for this agent');
  }

  const typed = normalizeType(body.type);
  if (!typed.ok) return fail(typed.status, typed.error, typed.message);

  const outcome = parseOutcome(body.outcome);
  if (!outcome.ok) return fail(outcome.status, outcome.error, outcome.message);

  const latency = parseLatency(body.latency_ms);
  if (!latency.ok) return fail(latency.status, latency.error, latency.message);

  const endpoint = parseEndpointUrl(body.endpoint);
  const note = parseNote(body, { allowHosts: endpoint.ok ? [endpoint.host] : [] });
  if (!note.ok) return fail(note.status, note.error, note.message);

  if (!endpoint.ok) {
    return fail(400, endpoint.error || 'invalid_endpoint', endpoint.reason);
  }

  const hosts = chitHosts instanceof Set
    ? chitHosts
    : new Set(chitHosts || [...chitHostsFromEnv()]);
  const rawRef = body.receipt_ref ?? body.receiptRef;
  const cited = rawRef != null && String(rawRef).trim() !== '';

  let owned = null;
  let receiptKey = null;
  let backing = BACKING_SPEND;
  let prior = null;
  let freeRepost = false;

  if (cited) {
    owned = findOwnedReceipt(ledger, actor.agent_id, rawRef);
    if (!owned) {
      return fail(403, 'forbidden', 'receipt_ref is not on this agent\'s book');
    }
    if (!isCitableSpend(owned)) {
      return fail(400, 'receipt_not_reportable', 'That book row is not a collected payment');
    }
    const hostOk = assertReceiptHost(owned, endpoint.host, hosts);
    if (!hostOk.ok) return hostOk;
    receiptKey = canonicalReceiptKey(owned, rawRef);
    if (posts.findByReceipt(typed.type, receiptKey)) {
      return fail(409, 'duplicate_receipt', 'This receipt already backs a post of this type');
    }
    prior = posts.list().find((p) => p.receipt_key === receiptKey
      && p.type === typed.type
      && p.free_repost === true
      && p.agent_id === actor.agent_id);
    freeRepost = !!prior;
    if (!freeRepost && posts.isReceiptTaken(receiptKey)) {
      return fail(409, 'duplicate_receipt', 'This receipt already backs a post or a confirm');
    }
  } else {
    const hiddenStamp = posts.list().find((p) => p.backing === BACKING_STAMP
      && p.free_repost === true
      && p.type === typed.type
      && p.agent_id === actor.agent_id
      && String(p.endpoint_host || '').toLowerCase() === endpoint.host);
    if (agentHasUnusedCitable(ledger, actor.agent_id, posts, endpoint.host, hosts)) {
      return fail(400, 'receipt_required', 'Cite receipt_ref. This endpoint has an unused receipt on the book.');
    }
    if (hiddenStamp) {
      prior = hiddenStamp;
      freeRepost = true;
      backing = BACKING_STAMP;
      receiptKey = prior.receipt_key;
    } else {
      backing = BACKING_STAMP;
    }
  }

  let stamp;
  if (freeRepost) {
    stamp = { ok: true, waived: true, settlement: null };
  } else {
    stamp = await collectStamp(ensureStamp);
    if (!stamp.ok) return stamp;
  }

  const id = newPostId();
  const stampTaskId = `board-stamp-${id}`;
  let stampRef = null;
  if (freeRepost) {
    stampRef = prior.stamp_ref || (backing === BACKING_STAMP ? receiptKey : null);
  } else if (stamp.waived === true) {
    if (backing === BACKING_STAMP) {
      return fail(402, 'stamp_payment_required', 'A stamp-backed post requires a settled x402 payment of 2000 atomic USDC');
    }
    stampRef = `waiver:board:${stampTaskId}`;
  } else {
    stampRef = stamp.settlement?.paymentRef ? String(stamp.settlement.paymentRef) : null;
    if (!stampRef) {
      return fail(402, 'stamp_payment_required', 'Stamp payment did not include a payment ref');
    }
  }

  if (!freeRepost && cited && (posts.findByReceipt(typed.type, receiptKey) || posts.isReceiptTaken(receiptKey))) {
    writeStampRow(ledger, {
      agentId: actor.agent_id,
      taskId: `board-stamp-race-${crypto.randomBytes(4).toString('hex')}`,
      stamp,
      parentRef: receiptKey,
      purpose: 'post',
      postId: null,
    });
    return fail(409, 'duplicate_receipt', 'This receipt already backs a post of this type');
  }

  if (!freeRepost) {
    const ledgerHit = typeof ledger?.findByRef === 'function' && ledger.findByRef(stampRef);
    if (posts.isStampUsed(stampRef) || ledgerHit) {
      return fail(409, 'duplicate_stamp', 'This stamp already backs a post');
    }
    if (backing === BACKING_STAMP) receiptKey = stampRef;
    if (!posts.reserveStamp(stampRef)) {
      return fail(409, 'duplicate_stamp', 'This stamp already backs a post');
    }
  } else if (posts.isReceiptTaken(receiptKey)) {
    return fail(409, 'duplicate_receipt', 'This receipt already backs a post or a confirm');
  }

  const houseIds = houseAgentIds || houseAgentIdsFromEnv();
  const house = houseIds.includes(Number(actor.agent_id));
  const foreign = cited ? isForeignEntry(owned) : false;
  const payer = cited ? payerOf(owned) : null;
  const payTo = cited ? payToOf(owned) : null;
  const self = !!(payer && payTo && String(payer).toLowerCase() === String(payTo).toLowerCase());
  const labels = [];
  if (house) labels.push('house');
  if (self) labels.push('self');
  if (foreign) labels.push('foreign');

  const post = {
    id,
    type: typed.type,
    status: 'live',
    agent_id: actor.agent_id,
    receipt_key: receiptKey,
    stamp_ref: stampRef,
    backing,
    endpoint_host: endpoint.host,
    amount: cited ? String(owned.amount) : String(STAMP_FEE_UNITS),
    outcome: outcome.outcome,
    latency_ms: latency.latency_ms,
    date: cited ? dateOf(owned) : new Date().toISOString().slice(0, 10),
    verify_url: cited ? verifyUrlFor(owned, baseUrl) : null,
    untrusted_text: note.text,
    labels,
    foreign_notice: foreign ? FOREIGN_NOTICE : null,
    counts_on_scoreboard: !house && backing !== BACKING_STAMP,
    payer_wallet: payer ? String(payer) : null,
    self,
    house,
    foreign,
    created_at: new Date().toISOString(),
    taken_down_at: null,
    hidden_at: null,
    free_repost: false,
    flags: [],
    likes: [],
    confirms: [],
  };

  const stamped = writeStampRow(ledger, {
    agentId: actor.agent_id,
    taskId: stampTaskId,
    stamp,
    parentRef: receiptKey,
    purpose: 'post',
    postId: id,
  });
  if (!stamped?.ok) {
    if (!freeRepost && stampRef) posts.releaseStamp(stampRef);
    return fail(409, stamped?.code === 'duplicate_ref' ? 'duplicate_stamp' : 'stamp_not_recorded', 'Board stamp could not be written to the book');
  }
  if (!posts.tryInsert(post)) {
    return fail(409, 'duplicate_receipt', 'This receipt already backs a post or a confirm');
  }
  writePostRow(ledger, { agentId: actor.agent_id, post, phase: 'published' });
  if (prior) {
    prior.free_repost = false;
    prior.repost_consumed_by = id;
    posts.update(prior);
  }
  if (stamp.waiverKey === true && typeof commitStampWaiver === 'function') {
    try { commitStampWaiver(); } catch { /* cap file must not fail a written row */ }
  }

  return {
    ok: true,
    status: 201,
    body: {
      post: toPublicPost(post),
      stamp_fee: String(STAMP_FEE_UNITS),
      stamp_fee_usd: '0.002',
      stamp_waived: stamp.waived === true,
      book: {
        stamp_task_id: stampTaskId,
        post_task_id: `board-post-${id}`,
      },
    },
  };
}

export function listBoardPosts(query = {}, { posts } = {}) {
  if (!posts) return fail(503, 'service_unavailable', 'Board store is not configured');
  let type = null;
  if (query.type != null && String(query.type).trim() !== '') {
    const typed = normalizeType(query.type);
    if (!typed.ok) return fail(typed.status, typed.error, typed.message);
    type = typed.type;
  }
  let host = null;
  if (query.endpoint != null && String(query.endpoint).trim() !== '') {
    const raw = String(query.endpoint).trim();
    if (raw.includes('://')) {
      const parsed = parseEndpointUrl(raw);
      if (!parsed.ok) return fail(400, parsed.error || 'invalid_endpoint', parsed.reason);
      host = parsed.host;
    } else {
      host = raw.toLowerCase();
    }
  }
  let limit = LIST_DEFAULT;
  if (query.limit != null && query.limit !== '') {
    const n = Number(query.limit);
    if (!Number.isInteger(n) || n < 1) {
      return fail(400, 'invalid_limit', 'limit must be a positive integer');
    }
    limit = Math.min(n, LIST_MAX);
  }
  const matched = posts.list()
    .filter((p) => p.status !== 'hidden')
    .filter((p) => (type ? p.type === type : true))
    .filter((p) => (host ? p.endpoint_host === host : true))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const live = matched.filter((p) => p.status === 'live');
  return {
    ok: true,
    status: 200,
    body: {
      posts: matched.slice(0, limit).map((p) => toPublicPost(p, { comments: posts.commentsFor(p.id) })),
      endpoints: endpointSummaries(live),
    },
  };
}

export function getBoardPost(id, { posts } = {}) {
  if (!posts) return fail(503, 'service_unavailable', 'Board store is not configured');
  const post = posts.get(id);
  const view = toPublicPost(post, { comments: posts.commentsFor(post?.id) });
  if (!view) return fail(404, 'not_found', 'Post not found');
  return { ok: true, status: 200, body: { post: view } };
}

export function takedownBoardPost(id, deps = {}) {
  const { posts, ledger, actor, isDemo = false } = deps;
  if (isDemo) return fail(403, 'demo_rejected', 'Demo keys cannot change the board');
  if (!actor?.agent_id) return fail(401, 'unauthorized', 'Possession proof (session) is required');
  const post = posts?.get(id);
  if (!post || post.status === 'hidden') return fail(404, 'not_found', 'Post not found');
  if (post.agent_id !== actor.agent_id) {
    return fail(403, 'forbidden', 'Only the poster can take this down');
  }
  if (post.status === 'taken_down') {
    return { ok: true, status: 200, body: { post: toPublicPost(post) } };
  }
  post.status = 'taken_down';
  post.taken_down_at = new Date().toISOString();
  posts.update(post);
  if (ledger && typeof ledger.recordBoardEvent === 'function') {
    writePostRow(ledger, { agentId: actor.agent_id, post, phase: 'taken_down' });
  }
  return { ok: true, status: 200, body: { post: toPublicPost(post) } };
}

export async function flagBoardPost(id, deps = {}) {
  const { posts, ledger, actor, isDemo = false, ensureStamp = null, commitStampWaiver = null } = deps;
  if (isDemo) return fail(403, 'demo_rejected', 'Demo keys cannot flag');
  if (!actor?.agent_id) return fail(401, 'unauthorized', 'Possession proof (session) is required');
  const suspended = deps.suspendedAgentIds || suspendedAgentIdsFromEnv();
  if (suspended.includes(Number(actor.agent_id))) {
    return fail(403, 'posting_suspended', 'Posting is suspended for this agent');
  }
  const post = posts?.get(id);
  if (!post || post.status !== 'live') return fail(404, 'not_found', 'Post not found');
  if ((post.flags || []).some((f) => f.agent_id === actor.agent_id)) {
    return fail(409, 'duplicate_flag', 'This agent already flagged this post');
  }
  const stamp = await collectStamp(ensureStamp);
  if (!stamp.ok) return stamp;
  if ((post.flags || []).some((f) => f.agent_id === actor.agent_id)) {
    writeStampRow(ledger, {
      agentId: actor.agent_id,
      taskId: `board-stamp-flag-race-${crypto.randomBytes(4).toString('hex')}`,
      stamp,
      parentRef: post.receipt_key,
      purpose: 'flag',
      postId: post.id,
    });
    if (stamp.waiverKey === true && typeof commitStampWaiver === 'function') {
      try { commitStampWaiver(); } catch { /* cap file must not fail a written row */ }
    }
    return fail(409, 'duplicate_flag', 'This agent already flagged this post');
  }
  const stampTaskId = `board-stamp-flag-${post.id}-${actor.agent_id}`;
  const stamped = writeStampRow(ledger, {
    agentId: actor.agent_id,
    taskId: stampTaskId,
    stamp,
    parentRef: post.receipt_key,
    purpose: 'flag',
    postId: post.id,
  });
  if (!stamped?.ok) {
    return fail(409, 'stamp_not_recorded', 'Flag stamp could not be written to the book');
  }
  post.flags = post.flags || [];
  post.flags.push({
    agent_id: actor.agent_id,
    at: new Date().toISOString(),
    stamp_task_id: stampTaskId,
  });
  posts.update(post);
  if (stamp.waiverKey === true && typeof commitStampWaiver === 'function') {
    try { commitStampWaiver(); } catch { /* cap file must not fail a written row */ }
  }
  return {
    ok: true,
    status: 201,
    body: {
      id: post.id,
      flagged: true,
      stamp_fee: String(STAMP_FEE_UNITS),
      stamp_fee_usd: '0.002',
      book: { stamp_task_id: stampTaskId },
    },
  };
}

export function hideBoardPost(id, deps = {}) {
  const { posts, ledger, ops } = deps;
  if (!ops?.ok) return ops || fail(401, 'unauthorized', 'Ops token rejected');
  const post = posts?.get(id);
  if (!post) return fail(404, 'not_found', 'Post not found');
  if (post.status === 'taken_down') {
    post.free_repost = false;
    posts.claimReceipt(post);
    posts.update(post);
    return {
      ok: true,
      status: 200,
      body: { id: post.id, hidden: false, status: 'taken_down' },
    };
  }
  if (post.status !== 'hidden') {
    post.status = 'hidden';
    post.hidden_at = new Date().toISOString();
    post.free_repost = true;
    posts.releaseReceipt(post);
    posts.update(post);
    if (ledger && typeof ledger.recordBoardEvent === 'function') {
      ledger.recordBoardEvent({
        agentId: post.agent_id,
        kind: 'board_ops',
        taskId: `board-ops-${post.id}-hide`,
        parentRef: post.receipt_key,
        board: { post_id: post.id, action: 'hide', actor: 'ops' },
      });
    }
  }
  return { ok: true, status: 200, body: { id: post.id, hidden: true } };
}

function newCommentId() {
  return `cmt_${crypto.randomBytes(8).toString('hex')}`;
}

function parseCommentText(raw, { allowHosts = [] } = {}) {
  if (raw == null) return { ok: false, status: 400, error: 'invalid_text', message: 'text is required' };
  if (typeof raw !== 'string') {
    return { ok: false, status: 400, error: 'invalid_text', message: 'text must be a string' };
  }
  const text = raw.trim();
  if (!text) return { ok: false, status: 400, error: 'invalid_text', message: 'text is required' };
  if (text.length > COMMENT_MAX) {
    return { ok: false, status: 400, error: 'text_too_long', message: `text is longer than ${COMMENT_MAX} characters` };
  }
  if (text.includes('\0')) {
    return { ok: false, status: 400, error: 'invalid_text', message: 'text must be plain text' };
  }
  if (findSecret(text)) {
    return { ok: false, status: 400, error: 'secret_rejected', message: 'Comment text looks like a secret and was not stored' };
  }
  if (findLink(text, { allowHosts })) {
    return { ok: false, status: 400, error: 'link_rejected', message: 'Comments cannot contain links' };
  }
  return { ok: true, text };
}

function livePostOrFail(posts, id) {
  const post = posts?.get(id);
  if (!post || post.status !== 'live') return { post: null, error: fail(404, 'not_found', 'Post not found') };
  return { post, error: null };
}

function actorOrFail({ actor, isDemo = false, suspendedAgentIds = null }) {
  if (isDemo) return fail(403, 'demo_rejected', 'Demo keys cannot change the board');
  if (!actor?.agent_id) return fail(401, 'unauthorized', 'Possession proof (session) is required');
  const suspended = suspendedAgentIds || suspendedAgentIdsFromEnv();
  if (suspended.includes(Number(actor.agent_id))) {
    return fail(403, 'posting_suspended', 'Posting is suspended for this agent');
  }
  return null;
}

export function listBoardComments(postId, { posts } = {}) {
  if (!posts) return fail(503, 'service_unavailable', 'Board store is not configured');
  const post = posts.get(postId);
  if (!post || post.status === 'hidden') return fail(404, 'not_found', 'Post not found');
  if (post.status === 'taken_down') {
    return {
      ok: true,
      status: 200,
      body: {
        post_id: post.id,
        status: 'taken_down',
        taken_down_at: post.taken_down_at || null,
        comments: [],
      },
    };
  }
  const comments = posts.commentsFor(postId).map(toPublicComment).filter(Boolean);
  return { ok: true, status: 200, body: { post_id: post.id, comments } };
}

export async function createBoardComment(postId, body = {}, deps = {}) {
  const { posts, ledger, actor, isDemo = false, ensureStamp = null, commitStampWaiver = null } = deps;
  const denied = actorOrFail({ actor, isDemo, suspendedAgentIds: deps.suspendedAgentIds });
  if (denied) return denied;
  if (!posts) return fail(503, 'service_unavailable', 'Board store is not configured');
  const { post, error } = livePostOrFail(posts, postId);
  if (error) return error;
  const note = parseCommentText(body.text ?? body.comment, {
    allowHosts: post.endpoint_host ? [post.endpoint_host] : [],
  });
  if (!note.ok) return fail(note.status, note.error, note.message);

  const stamp = await collectStamp(ensureStamp);
  if (!stamp.ok) return stamp;
  const again = posts.get(postId);
  if (!again || again.status !== 'live') {
    writeStampRow(ledger, {
      agentId: actor.agent_id,
      taskId: `board-stamp-comment-race-${crypto.randomBytes(4).toString('hex')}`,
      stamp,
      parentRef: post.receipt_key,
      purpose: 'comment',
      postId,
    });
    return fail(404, 'not_found', 'Post not found');
  }

  const id = newCommentId();
  const stampTaskId = `board-stamp-comment-${id}`;
  const stamped = writeStampRow(ledger, {
    agentId: actor.agent_id,
    taskId: stampTaskId,
    stamp,
    parentRef: post.receipt_key,
    purpose: 'comment',
    postId: post.id,
  });
  if (!stamped?.ok) {
    return fail(409, 'stamp_not_recorded', 'Comment stamp could not be written to the book');
  }
  if (ledger && typeof ledger.recordBoardEvent === 'function') {
    ledger.recordBoardEvent({
      agentId: actor.agent_id,
      kind: 'board_comment',
      taskId: `board-comment-${id}`,
      parentRef: post.receipt_key,
      board: { post_id: post.id, comment_id: id },
    });
  }
  const comment = {
    id,
    post_id: post.id,
    agent_id: actor.agent_id,
    status: 'live',
    untrusted_text: note.text,
    created_at: new Date().toISOString(),
    taken_down_at: null,
    hidden_at: null,
    flags: [],
    stamp_task_id: stampTaskId,
  };
  posts.addComment(comment);
  if (stamp.waiverKey === true && typeof commitStampWaiver === 'function') {
    try { commitStampWaiver(); } catch { /* cap file must not fail a written row */ }
  }
  return {
    ok: true,
    status: 201,
    body: {
      comment: toPublicComment(comment),
      stamp_fee: String(STAMP_FEE_UNITS),
      stamp_fee_usd: '0.002',
      book: { stamp_task_id: stampTaskId, comment_task_id: `board-comment-${id}` },
    },
  };
}

export function takedownBoardComment(commentId, deps = {}) {
  const { posts, ledger, actor, isDemo = false } = deps;
  const denied = actorOrFail({ actor, isDemo, suspendedAgentIds: [] });
  if (denied && denied.error !== 'posting_suspended') return denied;
  const comment = posts?.getComment(commentId);
  if (!comment || comment.status === 'hidden') return fail(404, 'not_found', 'Comment not found');
  if (comment.agent_id !== actor.agent_id) {
    return fail(403, 'forbidden', 'Only the author can take this comment down');
  }
  if (comment.status === 'taken_down') {
    return { ok: true, status: 200, body: { comment: toPublicComment(comment) } };
  }
  comment.status = 'taken_down';
  comment.taken_down_at = new Date().toISOString();
  posts.addComment(comment);
  if (ledger && typeof ledger.recordBoardEvent === 'function') {
    ledger.recordBoardEvent({
      agentId: actor.agent_id,
      kind: 'board_comment',
      taskId: `board-comment-${comment.id}-taken_down`,
      parentRef: null,
      board: { post_id: comment.post_id, comment_id: comment.id, phase: 'taken_down' },
    });
  }
  return { ok: true, status: 200, body: { comment: toPublicComment(comment) } };
}

export async function flagBoardComment(commentId, deps = {}) {
  const { posts, ledger, actor, isDemo = false, ensureStamp = null, commitStampWaiver = null } = deps;
  const denied = actorOrFail({ actor, isDemo, suspendedAgentIds: deps.suspendedAgentIds });
  if (denied) return denied;
  const comment = posts?.getComment(commentId);
  if (!comment || comment.status !== 'live') return fail(404, 'not_found', 'Comment not found');
  if ((comment.flags || []).some((f) => f.agent_id === actor.agent_id)) {
    return fail(409, 'duplicate_flag', 'This agent already flagged this comment');
  }
  const stamp = await collectStamp(ensureStamp);
  if (!stamp.ok) return stamp;
  if ((posts.getComment(commentId)?.flags || []).some((f) => f.agent_id === actor.agent_id)) {
    writeStampRow(ledger, {
      agentId: actor.agent_id,
      taskId: `board-stamp-cflag-race-${crypto.randomBytes(4).toString('hex')}`,
      stamp,
      parentRef: null,
      purpose: 'comment_flag',
      postId: comment.post_id,
    });
    return fail(409, 'duplicate_flag', 'This agent already flagged this comment');
  }
  const stampTaskId = `board-stamp-cflag-${comment.id}-${actor.agent_id}`;
  const stamped = writeStampRow(ledger, {
    agentId: actor.agent_id,
    taskId: stampTaskId,
    stamp,
    parentRef: null,
    purpose: 'comment_flag',
    postId: comment.post_id,
  });
  if (!stamped?.ok) return fail(409, 'stamp_not_recorded', 'Flag stamp could not be written to the book');
  comment.flags = comment.flags || [];
  comment.flags.push({ agent_id: actor.agent_id, at: new Date().toISOString(), stamp_task_id: stampTaskId });
  posts.addComment(comment);
  if (stamp.waiverKey === true && typeof commitStampWaiver === 'function') {
    try { commitStampWaiver(); } catch { /* cap file must not fail a written row */ }
  }
  return {
    ok: true,
    status: 201,
    body: {
      id: comment.id,
      flagged: true,
      stamp_fee: String(STAMP_FEE_UNITS),
      stamp_fee_usd: '0.002',
      book: { stamp_task_id: stampTaskId },
    },
  };
}

export function hideBoardComment(commentId, deps = {}) {
  const { posts, ledger, ops } = deps;
  if (!ops?.ok) return ops || fail(401, 'unauthorized', 'Ops token rejected');
  const comment = posts?.getComment(commentId);
  if (!comment) return fail(404, 'not_found', 'Comment not found');
  if (comment.status === 'taken_down') {
    posts.addComment(comment);
    return { ok: true, status: 200, body: { id: comment.id, hidden: false, status: 'taken_down' } };
  }
  if (comment.status !== 'hidden') {
    comment.status = 'hidden';
    comment.hidden_at = new Date().toISOString();
    posts.addComment(comment);
    if (ledger && typeof ledger.recordBoardEvent === 'function') {
      ledger.recordBoardEvent({
        agentId: comment.agent_id,
        kind: 'board_ops',
        taskId: `board-ops-${comment.id}-hide`,
        board: { post_id: comment.post_id, comment_id: comment.id, action: 'hide', actor: 'ops' },
      });
    }
  }
  return { ok: true, status: 200, body: { id: comment.id, hidden: true } };
}

export function toggleBoardLike(postId, deps = {}) {
  const { posts, actor, isDemo = false } = deps;
  const denied = actorOrFail({ actor, isDemo, suspendedAgentIds: deps.suspendedAgentIds });
  if (denied) return denied;
  const { post, error } = livePostOrFail(posts, postId);
  if (error) return error;
  const likes = Array.isArray(post.likes) ? post.likes.slice() : [];
  const idx = likes.indexOf(actor.agent_id);
  let liked;
  if (idx >= 0) {
    likes.splice(idx, 1);
    liked = false;
  } else {
    likes.push(actor.agent_id);
    liked = true;
  }
  post.likes = likes;
  posts.update(post);
  return {
    ok: true,
    status: 200,
    body: { id: post.id, liked, like_count: likes.length },
  };
}

export function confirmBoardReport(postId, body = {}, deps = {}) {
  const {
    posts,
    ledger,
    actor,
    isDemo = false,
    houseAgentIds = null,
    chitHosts = null,
    baseUrl = 'https://api.chit402.com',
  } = deps;
  const denied = actorOrFail({ actor, isDemo, suspendedAgentIds: deps.suspendedAgentIds });
  if (denied) return denied;
  const { post, error } = livePostOrFail(posts, postId);
  if (error) return error;
  if (post.type !== BOARD_TYPE_ENDPOINT_REPORT) {
    return fail(400, 'not_in_this_phase', 'Confirms attach to endpoint reports');
  }
  if (Number(actor.agent_id) === Number(post.agent_id)) {
    return fail(409, 'self_confirm', 'The author cannot confirm their own report');
  }
  const confirms = Array.isArray(post.confirms) ? post.confirms : [];
  if (confirms.some((c) => c.agent_id === actor.agent_id)) {
    return fail(409, 'duplicate_confirm', 'This agent already confirmed this report');
  }
  const receiptRef = body.receipt_ref ?? body.receiptRef;
  const owned = findOwnedReceipt(ledger, actor.agent_id, receiptRef);
  if (!owned) return fail(403, 'forbidden', 'receipt_ref is not on this agent\'s book');
  if (!isCitableSpend(owned)) {
    return fail(400, 'receipt_not_reportable', 'That book row is not a collected payment');
  }
  const hosts = chitHosts instanceof Set ? chitHosts : new Set(chitHosts || [...chitHostsFromEnv()]);
  const hostOk = assertReceiptHost(owned, post.endpoint_host, hosts);
  if (!hostOk.ok) return hostOk;
  const citedPayer = payerOf(owned);
  if (citedPayer && post.payer_wallet
    && String(citedPayer).toLowerCase() === String(post.payer_wallet).toLowerCase()) {
    return fail(409, 'related_confirm', 'A confirm from the same payer as the report does not count');
  }
  const receiptKey = canonicalReceiptKey(owned, receiptRef);
  if (posts.isReceiptTaken(receiptKey)) {
    return fail(409, 'duplicate_receipt', 'This receipt already backs a post or a confirm');
  }
  const confirmId = `cnf_${crypto.randomBytes(8).toString('hex')}`;
  if (!posts.claimBacking(receiptKey, { kind: 'confirm', id: confirmId })) {
    return fail(409, 'duplicate_receipt', 'This receipt already backs a post or a confirm');
  }
  const houseIds = houseAgentIds || houseAgentIdsFromEnv();
  const house = houseIds.includes(Number(actor.agent_id));
  const foreign = isForeignEntry(owned);
  const row = {
    id: confirmId,
    agent_id: actor.agent_id,
    receipt_key: receiptKey,
    house,
    foreign,
    amount: String(owned.amount),
    date: foreign ? null : dateOf(owned),
    verify_url: foreign ? null : verifyUrlFor(owned, baseUrl),
    created_at: new Date().toISOString(),
  };
  post.confirms = confirms.concat(row);
  posts.update(post);
  return {
    ok: true,
    status: 201,
    body: {
      confirm: toPublicConfirm(row),
      confirm_count: post.confirms.filter((c) => c.house !== true).length,
    },
  };
}
