/**
 * Append-only RFC 6962 Merkle tree over book rows.
 *
 * Leaf hash is SHA-256(0x00 || leaf bytes). Internal nodes are
 * SHA-256(0x01 || left || right). A trailing odd node is promoted.
 *
 * The first leaf is genesis (verifier build digest, when one is published).
 * Receipt leaves follow. A signed tree head is published on the first append
 * of each UTC day. Anchoring the root on Base is pending until a house wallet
 * key is configured; the address is RECEIPT_ANCHOR_FROM and the key is
 * RECEIPT_ANCHOR_PRIVATE_KEY. Neither is committed.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { signJws, verifyJwsWithJwks, getIssuerPublicKeyJwk, getJwks } from './issuer-key.js';
import { verifierBuildDigest } from './verifier-digest.js';

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
export async function describeAnchor(rootHex, { send = null } = {}) {
  const from = process.env.RECEIPT_ANCHOR_FROM || null;
  const key = process.env.RECEIPT_ANCHOR_PRIVATE_KEY || null;
  const calldata = anchorCalldata(rootHex);
  if (!key) {
    return {
      status: 'pending',
      chain: 'base',
      from,
      tx: null,
      calldata,
      reason: 'no_key',
    };
  }
  if (typeof send === 'function') {
    const tx = await send({ from, calldata, value: '0' });
    return { status: 'anchored', chain: 'base', from, tx: tx || null, calldata, reason: null };
  }
  return {
    status: 'pending',
    chain: 'base',
    from,
    tx: null,
    calldata,
    reason: 'sender_not_configured',
  };
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
    const anchored = head && head.tree_size === this.leaves.length && head.anchor?.tx;
    return {
      schema: 'chit402.inclusion.v1',
      payload_version: 1,
      task_id: String(taskId),
      leaf_index: index,
      tree_size: this.leaves.length,
      root,
      proof: proof.map((step) => ({ hash: step.hash, position: step.position })),
      anchor_status: anchored ? 'anchored' : (head ? 'pending' : 'pending'),
      anchor_tx: anchored ? head.anchor.tx : null,
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

  async publishHead({ send = null, force = false } = {}) {
    if (this.leaves.length === 0) this.ensureGenesis();
    const root = hex(rootOf(this.leaves));
    const anchor = await describeAnchor(root, { send });
    const claims = {
      schema: TREE_HEAD_SCHEMA,
      payload_version: TREE_HEAD_VERSION,
      tree_size: this.leaves.length,
      root,
      anchor_status: anchor.status,
      anchor_tx: anchor.tx,
      anchor_from: anchor.from,
    };
    const { jws, kid } = signJws(claims, { typ: TREE_HEAD_JWT_TYP });
    const head = {
      ...claims,
      published_at: new Date().toISOString(),
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
    if (!force && this.heads.length && this.heads[this.heads.length - 1].root === root
      && this.heads[this.heads.length - 1].tree_size === head.tree_size) {
      return this.heads[this.heads.length - 1];
    }
    this.heads.push(head);
    this._persist();
    return head;
  }

  _maybePublishDaily() {
    const today = new Date().toISOString().slice(0, 10);
    const last = this.heads[this.heads.length - 1];
    const lastDay = last?.published_at ? String(last.published_at).slice(0, 10) : null;
    if (lastDay === today) return;
    this.publishHead({ force: true }).catch(() => {});
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
  return { valid: true, payload };
}

export function renderInclusionSection(inclusion) {
  if (!inclusion || inclusion.root == null) return '';
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const line = inclusion.anchor_tx
    ? `included in root ${inclusion.root}, anchored in Base tx ${inclusion.anchor_tx}`
    : `included in root ${inclusion.root}, pending anchor`;
  return `<section class="card">
      <h2>Outside witness <span class="scope">chit402.inclusion.v1</span></h2>
      <div class="row"><span class="k">Inclusion</span><span class="v">${esc(line)}</span></div>
      <div class="row"><span class="k">Leaf</span><span class="v"><code>${esc(inclusion.leaf_index)}</code> of <code>${esc(inclusion.tree_size)}</code></span></div>
      <p class="muted" style="margin:8px 0 0;font-size:12px">Proves this receipt's leaf is in the issuer's append-only tree at this size. Pending anchor means the root is signed but not yet in a Base transaction. It does not prove the payment.</p>
    </section>`;
}
