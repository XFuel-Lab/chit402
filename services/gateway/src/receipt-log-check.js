/**
 * Page-side check of a receipt's log inclusion, tree head and chain anchor.
 *
 * Nothing here trusts the holder copy. The leaf is rebuilt from the signed
 * task id, the tree head must be an issuer JWS with typ chit402-tree-head+jwt,
 * and the root and size come from that signed head. The audit path, the leaf
 * index and the row hash are only inputs to the check: if they are wrong, the
 * check fails; if they are missing, it could not run. Each part is
 * 'checked', 'couldnt_check' or 'failed'.
 *
 * The anchor is checked against the gateway's own anchor records (tracker
 * and committed pin), cross-checked against the anchor the signed head names.
 * Live RPC is never made on render. An optional, bounded and cached Base
 * lookup can be warmed ahead of a render with `warmAnchorRpcCheck`.
 */
import {
  leafHash,
  normalizeRoot,
  verifyMerkleInclusion,
  assessBaseAnchor,
  fetchBaseAnchorTransaction,
} from '../../../packages/verify/dist/anchor-witness.js';
import { verifyJwsWithJwks, getJwks } from './issuer-key.js';
import { getReceiptMerkleTree, closedEpochAnchorPair, readReceiptLogPin, TREE_HEAD_JWT_TYP } from './receipt-merkle.js';

export const LOG_CHECKED = 'checked';
export const LOG_COULDNT_CHECK = 'couldnt_check';
export const LOG_FAILED = 'failed';
export const BASE_ANCHOR_CHAIN = 8453;

function part(state, reason, extra = {}) {
  return { state, reason, ...extra };
}

function sameHex(a, b) {
  const x = String(a || '').toLowerCase().replace(/^0x/, '');
  const y = String(b || '').toLowerCase().replace(/^0x/, '');
  return Boolean(x) && x === y;
}

function readHeader(jws) {
  try {
    return JSON.parse(Buffer.from(String(jws).split('.')[0], 'base64url').toString('utf8')) || {};
  } catch {
    return null;
  }
}

function headJwsOf(inclusion) {
  const cands = [
    inclusion?.head?.signature,
    inclusion?.head?.issuer_signature,
    inclusion?.signature,
    inclusion?.issuer_signature,
  ];
  for (const c of cands) {
    if (typeof c === 'string' && c.split('.').length === 3) return c;
    if (c && typeof c.jws === 'string') return c.jws;
  }
  return null;
}

/**
 * Verify a tree-head JWS. Returns { state, reason, payload }.
 * A JWS that does not verify, or the wrong typ, is 'failed'. No key to check
 * with is 'couldnt_check'.
 */
export function checkTreeHeadJws(jws, jwks) {
  if (!jws) return part(LOG_COULDNT_CHECK, 'no_tree_head');
  const header = readHeader(jws);
  if (!header) return part(LOG_FAILED, 'tree_head_malformed');
  if (header.typ !== TREE_HEAD_JWT_TYP) return part(LOG_FAILED, 'tree_head_typ');
  if (header.alg !== 'ES256') return part(LOG_FAILED, 'tree_head_alg');
  if (!jwks || !Array.isArray(jwks.keys) || jwks.keys.length === 0) return part(LOG_COULDNT_CHECK, 'no_issuer_key');
  if (header.kid && !jwks.keys.some((k) => k && k.kid === header.kid)) {
    return part(LOG_COULDNT_CHECK, 'tree_head_key_unknown');
  }
  const res = verifyJwsWithJwks(jws, jwks);
  if (!res.valid) return part(LOG_FAILED, 'tree_head_signature');
  const payload = res.payload || {};
  const root = normalizeRoot(payload.root);
  const size = Number(payload.tree_size);
  if (!root || !Number.isSafeInteger(size) || size < 1) return part(LOG_FAILED, 'tree_head_claims');
  return part(LOG_CHECKED, 'tree_head_signed', { payload, root, tree_size: size });
}

function rowHashOf(receipt, inclusion) {
  const cands = [inclusion?.row_hash, receipt?.row_hash, receipt?.book_chain?.row_hash];
  for (const c of cands) {
    if (typeof c === 'string' && /^(0x)?[0-9a-fA-F]{64}$/.test(c)) return c;
  }
  return null;
}

/** Gateway anchor record for a signed root: tracker first, then the committed pin. */
export function gatewayAnchorRecord(root, payload, { tree = null, pin } = {}) {
  const want = normalizeRoot(root);
  if (!want) return null;
  let t = tree;
  if (!t) {
    try { t = getReceiptMerkleTree(); } catch { t = null; }
  }
  const base = t?.anchorState?.base;
  const entry = base && typeof base === 'object' ? (base[want] || base[`0x${want}`] || null) : null;
  if (entry && entry.tx) {
    return {
      source: 'anchor_state',
      tx: entry.tx,
      chain_id: entry.chain_id != null ? Number(entry.chain_id) : null,
      confirmed: entry.status === 'anchored' && entry.receipt_confirmed === true,
    };
  }
  let p = pin;
  if (p === undefined) {
    try { p = readReceiptLogPin(); } catch { p = null; }
  }
  if (p && payload?.epoch != null) {
    const pair = closedEpochAnchorPair(p, payload.epoch, want, payload.tree_size);
    if (pair?.base?.tx) {
      return { source: 'pin', tx: pair.base.tx, chain_id: BASE_ANCHOR_CHAIN, confirmed: true };
    }
  }
  return null;
}

function signedBaseTx(payload) {
  const b = payload?.anchors?.base || payload?.anchor || null;
  if (!b || !b.tx) return null;
  if (b.status != null && b.status !== 'anchored') return null;
  return b.tx;
}

// ── Bounded, cached Base RPC (opt-in; never called on render) ──────────────
const RPC_CACHE_MAX = 512;
const RPC_TTL_MS = 10 * 60 * 1000;
const RPC_TTL_UNCHECKED_MS = 60 * 1000;
const RPC_TIMEOUT_MS = 4_000;
const RPC_MAX_INFLIGHT = 2;
const rpcCache = new Map();
const rpcInflight = new Map();

function rpcKey(root, tx) {
  return `${normalizeRoot(root)}:${String(tx).toLowerCase()}`;
}

function cacheGet(key, now = Date.now()) {
  const hit = rpcCache.get(key);
  if (!hit) return null;
  if (hit.expires <= now) {
    rpcCache.delete(key);
    return null;
  }
  return hit.value;
}

function cachePut(key, value, ttl) {
  if (rpcCache.has(key)) rpcCache.delete(key);
  rpcCache.set(key, { value, expires: Date.now() + ttl });
  while (rpcCache.size > RPC_CACHE_MAX) rpcCache.delete(rpcCache.keys().next().value);
}

/** Test hook. */
export function resetAnchorRpcCache() {
  rpcCache.clear();
  rpcInflight.clear();
}

/**
 * Warm the anchor cache for one signed root and tx. Opt-in: a no-op unless
 * RECEIPT_PAGE_ANCHOR_RPC_URL (or opts.rpcUrl) is set. Single-flight per key,
 * at most RPC_MAX_INFLIGHT lookups at once (extra calls return without a
 * lookup), a hard timeout, and results cached with a TTL in a bounded map.
 */
export async function warmAnchorRpcCheck(root, tx, opts = {}) {
  const rpcUrl = opts.rpcUrl ?? process.env.RECEIPT_PAGE_ANCHOR_RPC_URL ?? null;
  if (!rpcUrl || !normalizeRoot(root) || !/^0x[0-9a-fA-F]{64}$/.test(String(tx || ''))) return null;
  const key = rpcKey(root, tx);
  const cached = cacheGet(key);
  if (cached) return cached;
  if (rpcInflight.has(key)) return await rpcInflight.get(key);
  if (rpcInflight.size >= RPC_MAX_INFLIGHT) return null;
  const fetchTx = opts.fetchBaseTx || ((h, url) => fetchBaseAnchorTransaction(h, url, RPC_TIMEOUT_MS));
  const run = (async () => {
    let timer;
    try {
      const found = await Promise.race([
        fetchTx(tx, rpcUrl),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('base_rpc_timeout')), RPC_TIMEOUT_MS); }),
      ]);
      const assessed = assessBaseAnchor(found, BASE_ANCHOR_CHAIN);
      let value;
      if (!found) value = part(LOG_FAILED, 'anchor_tx_not_found');
      else if (!assessed.ok) {
        value = ['tx_reverted', 'chain_mismatch'].includes(assessed.reason)
          ? part(LOG_FAILED, `anchor_${assessed.reason}`)
          : part(LOG_COULDNT_CHECK, `anchor_${assessed.reason}`);
      } else if (!String(found.input || '').toLowerCase().includes(normalizeRoot(root))) {
        value = part(LOG_FAILED, 'anchor_calldata_mismatch');
      } else value = part(LOG_CHECKED, 'anchor_rpc', { chain: 'base', tx });
      cachePut(key, value, value.state === LOG_COULDNT_CHECK ? RPC_TTL_UNCHECKED_MS : RPC_TTL_MS);
      return value;
    } catch {
      const value = part(LOG_COULDNT_CHECK, 'anchor_rpc_unavailable');
      cachePut(key, value, RPC_TTL_UNCHECKED_MS);
      return value;
    } finally {
      clearTimeout(timer);
      rpcInflight.delete(key);
    }
  })();
  rpcInflight.set(key, run);
  return await run;
}

function checkAnchor(head, opts) {
  const root = head.root;
  const payload = head.payload;
  const signedTx = signedBaseTx(payload);
  const lookup = typeof opts.anchorRecord === 'function'
    ? opts.anchorRecord
    : (r, p) => gatewayAnchorRecord(r, p);
  let rec = null;
  try { rec = lookup(root, payload); } catch { rec = null; }
  if (rec) {
    if (signedTx && !sameHex(rec.tx, signedTx)) return part(LOG_FAILED, 'anchor_mismatch');
    if (rec.chain_id != null && Number(rec.chain_id) !== BASE_ANCHOR_CHAIN) return part(LOG_FAILED, 'anchor_chain_mismatch');
    if (!rec.confirmed) return part(LOG_COULDNT_CHECK, 'anchor_unconfirmed');
    return part(LOG_CHECKED, `anchor_${rec.source}`, { chain: 'base', tx: rec.tx });
  }
  if (signedTx) {
    const cached = cacheGet(rpcKey(root, signedTx));
    if (cached) return cached;
    return part(LOG_COULDNT_CHECK, 'no_anchor_record');
  }
  return part(LOG_COULDNT_CHECK, 'not_anchored');
}

/**
 * Check inclusion, tree head and anchor for one receipt.
 * @param {object} receipt  the (redacted) receipt as served; only used for inputs
 * @param {object} claims   decoded issuer claims (the signed receipt)
 * @param {{ jwks?: object, anchorRecord?: Function }} [opts]
 */
export function checkReceiptLog(receipt, claims, opts = {}) {
  const none = part(LOG_COULDNT_CHECK, 'not_checked');
  const out = { inclusion: none, head: none, anchor: none };
  const taskId = typeof claims?.task_id === 'string' ? claims.task_id : null;
  if (!taskId) {
    out.inclusion = part(LOG_COULDNT_CHECK, 'no_signed_task_id');
    return out;
  }
  const inclusion = receipt?.inclusion && typeof receipt.inclusion === 'object' ? receipt.inclusion : null;
  if (!inclusion) {
    out.inclusion = part(LOG_COULDNT_CHECK, 'no_inclusion_proof');
    return out;
  }
  let jwks = opts.jwks;
  if (!jwks) {
    try { jwks = getJwks(); } catch { jwks = null; }
  }
  if (opts.extraKeys?.length) {
    const have = new Set((jwks?.keys || []).map((k) => k?.kid));
    jwks = { keys: [...(jwks?.keys || []), ...opts.extraKeys.filter((k) => !have.has(k?.kid))] };
  }
  // The gateway's own stored head for this size is preferred; a head the
  // served proof carries is used only if none was supplied. Either way it
  // must verify as an issuer tree-head JWS.
  const supplied = opts.treeHead;
  const suppliedJws = typeof supplied === 'string' ? supplied : (supplied?.issuer_signature?.jws || null);
  const head = checkTreeHeadJws(suppliedJws || headJwsOf(inclusion), jwks);
  out.head = head;
  if (head.state !== LOG_CHECKED) {
    out.inclusion = part(head.state, head.state === LOG_FAILED ? 'tree_head_failed' : 'tree_head_unchecked');
    return out;
  }
  out.head = part(LOG_CHECKED, 'tree_head_signed', { root: head.root, tree_size: head.tree_size });
  if (inclusion.status === 'pending_anchor' || !Array.isArray(inclusion.proof)) {
    out.inclusion = part(LOG_COULDNT_CHECK, 'no_audit_path');
  } else {
    const rowHash = rowHashOf(receipt, inclusion);
    const index = Number(inclusion.leaf_index);
    const size = Number(inclusion.tree_size);
    if (!rowHash) out.inclusion = part(LOG_COULDNT_CHECK, 'no_row_hash');
    else if (!Number.isSafeInteger(index) || !Number.isSafeInteger(size)) out.inclusion = part(LOG_FAILED, 'bad_geometry');
    else if (size !== head.tree_size) out.inclusion = part(LOG_FAILED, 'tree_size_mismatch');
    else {
      const leaf = leafHash(Buffer.from(`${taskId}|${rowHash}`));
      const ok = verifyMerkleInclusion(leaf, index, size, head.root, inclusion.proof);
      out.inclusion = ok
        ? part(LOG_CHECKED, 'inclusion_verified', { leaf_index: index, tree_size: size, root: head.root })
        : part(LOG_FAILED, 'inclusion_failed');
    }
  }
  out.anchor = checkAnchor(head, opts);
  return out;
}

/**
 * Three-way outcome from the issuer signature plus the log check, as the
 * verifier reports it: 'verified', 'invalid', or 'couldnt_check'.
 */
export function receiptOutcome(issuer, log) {
  const sigInvalid = ['signature_invalid', 'task_id_mismatch', 'head_binding_mismatch', 'claim_id_missing']
    .includes(issuer?.reason) || (issuer?.reason === 'no_issuer_signature' && issuer?.hasJws);
  if (sigInvalid) return 'invalid';
  const parts = [log?.head, log?.inclusion, log?.anchor].filter(Boolean);
  if (parts.some((p) => p.state === LOG_FAILED)) return 'invalid';
  if (!issuer?.verified) return 'couldnt_check';
  if (parts.length === 3 && parts.every((p) => p.state === LOG_CHECKED)) return 'verified';
  return 'couldnt_check';
}

/**
 * Gather the gateway-side inputs for a page check: the stored signed head
 * at the proof's size, and the anchor record lookup. Reads the log's memory
 * and disk; makes no RPC. Optionally warms the bounded anchor RPC cache.
 */
export async function prepareReceiptLogCheck(receipt, { tree = null, warmRpc = false } = {}) {
  let t = tree;
  if (!t) {
    try { t = getReceiptMerkleTree(); } catch { t = null; }
  }
  const out = { anchorRecord: (root, payload) => gatewayAnchorRecord(root, payload, { tree: t }) };
  const size = Number(receipt?.inclusion?.tree_size);
  if (t && typeof t.signedHeadAt === 'function' && Number.isSafeInteger(size) && size > 0) {
    try {
      const head = await t.signedHeadAt(size);
      if (head?.issuer_signature?.jws) out.treeHead = head;
    } catch {
      // No stored head at that size: the page reports couldn't check.
    }
  }
  if (warmRpc && out.treeHead) {
    const b = out.treeHead.anchors?.base;
    if (b?.tx && !gatewayAnchorRecord(out.treeHead.root, out.treeHead, { tree: t })) {
      await warmAnchorRpcCheck(out.treeHead.root, b.tx);
    }
  }
  return out;
}
