/**
 * Append-only RFC 6962 Merkle tree over book rows.
 *
 * Leaf hash is SHA-256(0x00 || leaf bytes). Internal nodes are
 * SHA-256(0x01 || left || right). A trailing odd node is promoted.
 *
 * The first leaf is genesis (verifier build digest, when one is published).
 * Receipt leaves follow. A signed tree head is published on the first append
 * of each UTC day. The root is anchored on Base (calldata) and on Solana
 * (SPL Memo). Each side stays pending until its own key and RPC are set.
 * Base: RECEIPT_ANCHOR_FROM, RECEIPT_ANCHOR_PRIVATE_KEY. Solana:
 * SOLANA_ANCHOR_SECRET_KEY, SOLANA_RPC_URL, optional SOLANA_ANCHOR_CLUSTER.
 * None of those are committed.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { signJws, verifyJwsWithJwks, getIssuerPublicKeyJwk, getJwks } from './issuer-key.js';
import { verifierBuildDigest } from './verifier-digest.js';
import {
  describeSolanaAnchor,
  parseAnchorMemo,
  solanaAnchorCluster,
  solanaAnchorMemo,
  ZERO_ROOT,
} from './solana-receipt-anchor.js';

export const TREE_HEAD_SCHEMA = 'chit402.tree_head.v1';
export const TREE_HEAD_VERSION = 1;
export const TREE_HEAD_JWT_TYP = 'chit402-tree-head+jwt';
export const GENESIS_SCHEMA = 'chit402.tree_genesis.v1';

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest();
}

export function leafHash(bytes) {
  return sha256(Buffer.concat([Buffer.from([0x00]), Buffer.from(bytes)]));
}

export function nodeHash(left, right) {
  return sha256(Buffer.concat([Buffer.from([0x01]), left, right]));
}

/** Root of an ordered list of leaf hashes. Empty tree hashes a single 0x00. */
export function rootOf(leaves) {
  if (!leaves.length) return sha256(Buffer.from([0x00]));
  let level = leaves.map((h) => Buffer.from(h));
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 === level.length) next.push(level[i]);
      else next.push(nodeHash(level[i], level[i + 1]));
    }
    level = next;
  }
  return level[0];
}

export function inclusionProof(leaves, index) {
  if (index < 0 || index >= leaves.length) return null;
  const proof = [];
  let idx = index;
  let level = leaves.map((h) => Buffer.from(h));
  while (level.length > 1) {
    const sibling = idx ^ 1;
    if (sibling < level.length) {
      proof.push({
        hash: level[sibling].toString('hex'),
        position: sibling < idx ? 'left' : 'right',
      });
    }
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 === level.length) next.push(level[i]);
      else next.push(nodeHash(level[i], level[i + 1]));
    }
    idx = Math.floor(idx / 2);
    level = next;
  }
  return proof;
}

export function verifyInclusion(leaf, index, treeSize, rootHex, proof) {
  if (!Array.isArray(proof) || index < 0 || index >= treeSize) return false;
  let hash = Buffer.from(leaf);
  let idx = index;
  for (const step of proof) {
    const sib = Buffer.from(step.hash, 'hex');
    hash = step.position === 'left' ? nodeHash(sib, hash) : nodeHash(hash, sib);
    idx = Math.floor(idx / 2);
  }
  return hash.toString('hex') === String(rootHex).replace(/^0x/, '');
}

function largestPowerOfTwoLessThan(n) {
  let p = 1;
  while (p * 2 < n) p *= 2;
  return p;
}

/**
 * Consistency proof that the first `m` leaves are a prefix of the first `n`.
 * Node hashes, hex, oldest first. RFC 6962 §2.1.4 shape: subtrees that
 * complete the old tree and the new tree.
 */
export function consistencyProof(leaves, m, n) {
  if (!Number.isInteger(m) || !Number.isInteger(n) || m < 1 || n < m || n > leaves.length) {
    throw new Error('bad_tree_size');
  }
  if (m === n) return [];
  const proof = [];
  function mth(start, end) {
    return rootOf(leaves.slice(start, end));
  }
  function prove(start, end, oldEnd) {
    const size = end - start;
    if (size === 0) return;
    if (end <= oldEnd) {
      proof.push(mth(start, end).toString('hex'));
      return;
    }
    if (start >= oldEnd) {
      proof.push(mth(start, end).toString('hex'));
      return;
    }
    const k = largestPowerOfTwoLessThan(size);
    prove(start, start + k, oldEnd);
    prove(start + k, end, oldEnd);
  }
  prove(0, n, m);
  return proof;
}

/**
 * Recompute the old and new roots from a consistency proof.
 * Returns true when both match the supplied roots.
 */
export function verifyConsistency(m, n, oldRoot, newRoot, proof) {
  const oldHex = String(oldRoot || '').replace(/^0x/, '');
  const newHex = String(newRoot || '').replace(/^0x/, '');
  if (m === n) return oldHex === newHex && (!proof || proof.length === 0);
  if (!Array.isArray(proof) || proof.length === 0) return false;
  let i = 0;
  function take() {
    if (i >= proof.length) throw new Error('short_proof');
    return Buffer.from(proof[i++], 'hex');
  }
  function check(start, end, oldEnd) {
    if (end <= oldEnd) {
      const hash = take();
      return { hash, old: hash };
    }
    if (start >= oldEnd) return { hash: take(), old: null };
    const k = largestPowerOfTwoLessThan(end - start);
    const left = check(start, start + k, oldEnd);
    const right = check(start + k, end, oldEnd);
    const hash = nodeHash(left.hash, right.hash);
    let old = null;
    if (left.old && right.old) old = nodeHash(left.old, right.old);
    else if (left.old && start + k >= oldEnd) old = left.old;
    return { hash, old };
  }
  try {
    const rebuilt = check(0, n, m);
    if (i !== proof.length || !rebuilt.old) return false;
    return rebuilt.hash.toString('hex') === newHex && rebuilt.old.toString('hex') === oldHex;
  } catch {
    return false;
  }
}

function hex(buf) {
  return Buffer.from(buf).toString('hex');
}

export function anchorCalldata(rootHex) {
  const root = String(rootHex || '').replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{64}$/.test(root)) throw new Error('root must be 32 bytes');
  return `0x${root.toLowerCase()}`;
}

/**
 * Describe the Base anchor. Sends a zero-value self-transfer only when
 * RECEIPT_ANCHOR_PRIVATE_KEY is set. Otherwise the head stays pending.
 */
async function sendBaseAnchorTx({ from, calldata, privateKey }) {
  const rpc = process.env.BASE_RPC_URL || process.env.SETTLEMENT_RPC_URL || null;
  if (!rpc) throw new Error('no_rpc');
  const { Wallet, JsonRpcProvider } = await import('ethers');
  const provider = new JsonRpcProvider(rpc);
  const wallet = new Wallet(privateKey, provider);
  const tx = await wallet.sendTransaction({
    to: from || wallet.address,
    value: 0n,
    data: calldata,
  });
  return tx.hash;
}

export async function describeAnchor(rootHex, { send = null } = {}) {
  const from = process.env.RECEIPT_ANCHOR_FROM || null;
  const key = process.env.RECEIPT_ANCHOR_PRIVATE_KEY || null;
  const calldata = anchorCalldata(rootHex);
  const pending = (reason) => ({
    status: 'pending',
    chain: 'base',
    chain_id: 8453,
    from,
    tx: null,
    calldata,
    reason,
  });
  if (!key) return pending('no_key');
  try {
    const sender = typeof send === 'function'
      ? send
      : (args) => sendBaseAnchorTx({ ...args, privateKey: key });
    const tx = await sender({ from, calldata, value: '0' });
    return {
      status: 'anchored',
      chain: 'base',
      chain_id: 8453,
      from,
      tx: tx || null,
      calldata,
      reason: null,
    };
  } catch (err) {
    return pending(err.message || 'send_failed');
  }
}

function dayOf(iso) {
  return String(iso || '').slice(0, 10);
}

function previousRoot(heads, day) {
  for (let i = heads.length - 1; i >= 0; i -= 1) {
    if (dayOf(heads[i].published_at) < day && heads[i].root) return heads[i].root;
  }
  return ZERO_ROOT;
}

function solanaAnchoredForDay(heads, day, scope) {
  for (let i = heads.length - 1; i >= 0; i -= 1) {
    if (dayOf(heads[i].published_at) !== day) continue;
    const sol = heads[i].anchors?.solana;
    const parsed = parseAnchorMemo(sol?.memo);
    if (sol?.status === 'anchored' && sol.signature && parsed?.scope === scope) return sol;
  }
  return null;
}

function baseAnchoredForRoot(heads, root) {
  for (let i = heads.length - 1; i >= 0; i -= 1) {
    if (heads[i].root !== root) continue;
    const base = heads[i].anchors?.base || heads[i].anchor;
    if (base?.status === 'anchored' && base.tx) return base;
  }
  return null;
}

function sideNeedsRetry(side, envReady) {
  if (!side) return envReady;
  if (side.status === 'anchored' && (side.tx || side.signature)) return false;
  if (side.reason === 'day_already_anchored') return false;
  if (side.reason === 'no_key' || side.reason === 'no_rpc' || side.reason === 'bad_key' || side.reason === 'bad_cluster') {
    return envReady;
  }
  return true;
}

const QUIET_REASONS = new Set(['no_key', 'no_rpc', 'bad_key', 'bad_cluster', 'day_already_anchored']);

function anchorNeedsRetry(head) {
  if (!head) return true;
  const base = head.anchors?.base || head.anchor;
  const sol = head.anchors?.solana;
  const baseReady = Boolean(process.env.RECEIPT_ANCHOR_PRIVATE_KEY);
  const solReady = Boolean(process.env.SOLANA_ANCHOR_SECRET_KEY && process.env.SOLANA_RPC_URL);
  return sideNeedsRetry(base, baseReady) || sideNeedsRetry(sol, solReady);
}

function transportFailure(side) {
  return Boolean(side && side.status !== 'anchored' && side.reason && !QUIET_REASONS.has(side.reason));
}

/** Minimum gap between failed anchor retries on the daily path. */
export const ANCHOR_RETRY_MS = 60_000;

/**
 * True when the daily publisher should try again.
 * A day that is already anchored is not due. A failed send is due once
 * ANCHOR_RETRY_MS has passed. A missing key stays quiet until the env appears,
 * and that transition is not debounced: the next append anchors.
 */
export function dailyAnchorDue(head, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  if (!head || dayOf(head.published_at) !== today) return true;
  if (!anchorNeedsRetry(head)) return false;
  const base = head.anchors?.base || head.anchor;
  const sol = head.anchors?.solana;
  if (!transportFailure(base) && !transportFailure(sol)) return true;
  const age = now.getTime() - Date.parse(head.published_at);
  if (Number.isFinite(age) && age >= 0 && age < ANCHOR_RETRY_MS) return false;
  return true;
}

let _tree = null;

export class ReceiptMerkleTree {
  constructor() {
    this.leaves = [];
    this.meta = [];
    this.byTask = new Map();
    this.heads = [];
    this.dir = null;
  }

  genesisLeaf() {
    const body = JSON.stringify({
      schema: GENESIS_SCHEMA,
      payload_version: 1,
      verifier_binary_build_digest: verifierBuildDigest(),
    });
    return { task_id: 'genesis', bytes: Buffer.from(body), kind: 'genesis' };
  }

  ensureGenesis() {
    if (this.leaves.length > 0) return;
    const g = this.genesisLeaf();
    this._push(g.task_id, g.bytes, g.kind);
  }

  _push(taskId, bytes, kind) {
    const hash = leafHash(bytes);
    const index = this.leaves.length;
    this.leaves.push(hash);
    this.meta.push({ task_id: taskId, index, kind, leaf: hash.toString('hex') });
    if (taskId) this.byTask.set(String(taskId), index);
    return index;
  }

  appendReceipt(taskId, rowHash) {
    if (!taskId) return null;
    if (this.byTask.has(String(taskId))) return this.inclusion(taskId);
    this.ensureGenesis();
    const bytes = Buffer.from(`${taskId}|${rowHash || ''}`);
    this._push(String(taskId), bytes, 'receipt');
    this._maybePublishDaily();
    this._persist();
    return this.inclusion(taskId);
  }

  inclusion(taskId) {
    const index = this.byTask.get(String(taskId));
    if (index == null) return null;
    const proof = inclusionProof(this.leaves, index);
    const root = hex(rootOf(this.leaves));
    const head = this.heads[this.heads.length - 1] || null;
    const covers = head && head.tree_size === this.leaves.length;
    const baseTx = covers ? (head.anchors?.base?.tx || head.anchor?.tx || null) : null;
    const solana = covers ? (head.anchors?.solana || null) : null;
    const solanaSig = solana?.status === 'anchored' ? solana.signature : null;
    return {
      schema: 'chit402.inclusion.v1',
      payload_version: 1,
      task_id: String(taskId),
      leaf_index: index,
      leaf: this.leaves[index].toString('hex'),
      tree_size: this.leaves.length,
      root,
      proof: proof.map((step) => ({ hash: step.hash, position: step.position })),
      anchor_status: baseTx ? 'anchored' : 'pending',
      anchor_tx: baseTx,
      solana_signature: solanaSig,
      anchors: covers ? (head.anchors || null) : null,
      verified_at: new Date().toISOString(),
    };
  }

  consistency(m, n) {
    const proof = consistencyProof(this.leaves, m, n);
    const oldRoot = hex(rootOf(this.leaves.slice(0, m)));
    const newRoot = hex(rootOf(this.leaves.slice(0, n)));
    return {
      schema: 'chit402.consistency.v1',
      payload_version: 1,
      first_tree_size: m,
      second_tree_size: n,
      first_root: oldRoot,
      second_root: newRoot,
      proof,
    };
  }

  async publishHead(opts = {}) {
    const prev = this._publishChain || Promise.resolve();
    const run = prev.then(() => this._publishHeadUnlocked(opts));
    this._publishChain = run.then(() => undefined, () => undefined);
    return run;
  }

  async _publishHeadUnlocked({
    send = null,
    force = false,
    scope = 'global',
    now = null,
    solanaConnection = null,
  } = {}) {
    if (this.leaves.length === 0) this.ensureGenesis();
    const publishedAt = (now ? new Date(now) : new Date()).toISOString();
    const day = dayOf(publishedAt);
    const root = hex(rootOf(this.leaves));
    const prevRoot = previousRoot(this.heads, day);
    const last = this.heads[this.heads.length - 1] || null;
    if (!force && last && last.root === root && last.tree_size === this.leaves.length && !anchorNeedsRetry(last)) {
      return last;
    }

    const priorBase = !send ? baseAnchoredForRoot(this.heads, root) : null;
    const anchor = priorBase || await describeAnchor(root, { send });
    const priorSolana = solanaAnchoredForDay(this.heads, day, scope);
    let solana;
    if (priorSolana) {
      const parsed = parseAnchorMemo(priorSolana.memo);
      const sameMemo = parsed?.root === root && parsed?.prev === prevRoot;
      if (sameMemo) {
        solana = { ...priorSolana };
      } else {
        // This UTC day already has a memo for a different root. Do not send another.
        let memo = null;
        let cluster = priorSolana.cluster || null;
        try {
          cluster = solanaAnchorCluster();
          memo = solanaAnchorMemo({ scope, day, rootHex: root, prevRootHex: prevRoot });
        } catch {
          memo = null;
        }
        solana = {
          status: 'pending',
          signature: null,
          slot: null,
          cluster,
          memo,
          reason: 'day_already_anchored',
          prior_signature: priorSolana.signature,
        };
      }
    } else {
      solana = await describeSolanaAnchor({
        rootHex: root,
        prevRootHex: prevRoot,
        day,
        scope,
        connection: solanaConnection,
      });
    }

    const anchors = { base: anchor, solana };
    // Flat signed claims. Another witness (for example clock_tolerance_s) is a
    // sibling of anchors, not a field inside the Base or Solana records.
    const claims = {
      schema: TREE_HEAD_SCHEMA,
      payload_version: TREE_HEAD_VERSION,
      tree_size: this.leaves.length,
      root,
      anchor_status: anchor.status,
      anchor_tx: anchor.tx,
      anchor_from: anchor.from,
      anchors,
    };
    const { jws, kid } = signJws(claims, { typ: TREE_HEAD_JWT_TYP });
    const head = {
      ...claims,
      published_at: publishedAt,
      anchor,
      issuer_signature: {
        alg: 'ES256',
        typ: TREE_HEAD_JWT_TYP,
        payload_version: TREE_HEAD_VERSION,
        jws,
        kid,
        issuer_jwk: getIssuerPublicKeyJwk(),
      },
    };
    const sameSlot = last
      && dayOf(last.published_at) === day
      && last.root === root
      && last.tree_size === head.tree_size;
    const baseWorse = (last?.anchors?.base || last?.anchor)?.status === 'anchored' && anchor.status !== 'anchored';
    const solWorse = last?.anchors?.solana?.status === 'anchored' && solana.status !== 'anchored';
    if (sameSlot && !baseWorse && !solWorse) this.heads[this.heads.length - 1] = head;
    else this.heads.push(head);
    this._persist();
    return head;
  }

  _maybePublishDaily() {
    const last = this.heads[this.heads.length - 1];
    if (!dailyAnchorDue(last)) return null;
    return this.publishHead({ force: true }).catch(() => {});
  }

  latestHead() {
    return this.heads[this.heads.length - 1] || null;
  }

  _persist() {
    if (!this.dir) return;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const body = JSON.stringify({
        meta: this.meta,
        heads: this.heads,
      });
      fs.writeFileSync(path.join(this.dir, 'receipt-merkle.json'), body);
    } catch {
      /* persistence is best-effort; the in-memory tree still answers */
    }
  }

  load(dir) {
    this.dir = dir;
    try {
      const raw = fs.readFileSync(path.join(dir, 'receipt-merkle.json'), 'utf8');
      const parsed = JSON.parse(raw);
      this.leaves = [];
      this.meta = [];
      this.byTask = new Map();
      this.heads = Array.isArray(parsed.heads) ? parsed.heads : [];
      for (const row of parsed.meta || []) {
        if (row.kind === 'genesis') {
          const g = this.genesisLeaf();
          this._push(g.task_id, g.bytes, 'genesis');
        } else if (row.task_id) {
          const bytes = Buffer.from(`${row.task_id}|`);
          // row hash is not stored separately; keep the recorded leaf if present
          if (row.leaf) {
            const hash = Buffer.from(row.leaf, 'hex');
            const index = this.leaves.length;
            this.leaves.push(hash);
            this.meta.push(row);
            this.byTask.set(String(row.task_id), index);
          } else {
            this._push(row.task_id, bytes, 'receipt');
          }
        }
      }
    } catch {
      /* empty tree */
    }
  }
}

export function getReceiptMerkleTree() {
  if (!_tree) _tree = new ReceiptMerkleTree();
  return _tree;
}

export function resetReceiptMerkleTree() {
  _tree = new ReceiptMerkleTree();
  return _tree;
}

export function verifyTreeHead(head, jwks = null) {
  const sig = head?.issuer_signature;
  if (!sig?.jws) return { valid: false, reason: 'no_signature' };
  const result = verifyJwsWithJwks(sig.jws, jwks || getJwks());
  if (!result.valid) return { valid: false, reason: result.reason || 'signature_invalid' };
  const payload = result.payload || {};
  if (payload.root !== head.root || Number(payload.tree_size) !== Number(head.tree_size)) {
    return { valid: false, reason: 'head_mismatch' };
  }
  if (JSON.stringify(payload.anchors ?? null) !== JSON.stringify(head.anchors ?? null)) {
    return { valid: false, reason: 'anchor_mismatch' };
  }
  return { valid: true, payload };
}

function inclusionAnchorLine(inclusion) {
  const root = inclusion.root;
  const base = inclusion.anchor_tx;
  const sol = inclusion.solana_signature || null;
  if (base && sol) return `included in root ${root}, anchored in Base tx ${base} and Solana tx ${sol}`;
  if (base) return `included in root ${root}, anchored in Base tx ${base}`;
  if (sol) return `included in root ${root}, anchored in Solana tx ${sol}`;
  return `included in root ${root}, pending anchor`;
}

export function renderInclusionSection(inclusion) {
  if (!inclusion || inclusion.root == null) return '';
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const line = inclusionAnchorLine(inclusion);
  return `<section class="card">
      <h2>Outside witness <span class="scope">chit402.inclusion.v1</span></h2>
      <div class="row"><span class="k">Inclusion</span><span class="v">${esc(line)}</span></div>
      <div class="row"><span class="k">Leaf</span><span class="v"><code>${esc(inclusion.leaf_index)}</code> of <code>${esc(inclusion.tree_size)}</code></span></div>
      <p class="muted" style="margin:8px 0 0;font-size:12px">Proves this receipt's leaf is in the issuer's append-only tree at this size. The root is published as Base calldata and as a Solana memo. Pending anchor means that chain has not recorded it yet. It does not prove the payment.</p>
    </section>`;
}
