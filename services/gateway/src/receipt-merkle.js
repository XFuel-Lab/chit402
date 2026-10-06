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
import logger from './logger.js';
import { signJws, verifyJwsWithJwks, getIssuerPublicKeyJwk, getJwks } from './issuer-key.js';
import { verifierBuildDigest } from './verifier-digest.js';
import { clockToleranceClaim, gatePublishedAnchor, gatePublishedSolana } from './receipt-anchor-clock.js';
import {
  describeSolanaAnchor,
  parseAnchorMemo,
  solanaAnchorCluster,
  solanaAnchorMemo,
  ZERO_ROOT,
} from './solana-receipt-anchor.js';
import { bundleIndexHash, emptyBundleIndex } from './receipt-log-s3.js';
import {
  appendJournal,
  freshGenesisAllowed,
  readReceiptLog,
  ReceiptLogRefused,
  receiptLogBootRequested,
  receiptLogStrict,
  writeAnchorState,
  writeBundleIndexFile,
  writeCheckpoint,
  writeEpochRecordFile,
} from './receipt-log-store.js';
import {
  assertJournalMatchesPin,
  assertLatestBaseAnchor,
  FRESH_GENESIS_LOG,
  lookupBaseTxByNonceOrHash,
  normalizeRoot,
  readReceiptLogPin,
  resolveAnchorSender,
} from './receipt-log-anchor.js';
import { assertPinnedEpochRecord } from './receipt-log-epoch.js';
export { FRESH_GENESIS_LOG, assertLatestBaseAnchor, readReceiptLogPin };

export { ReceiptLogRefused, freshGenesisAllowed, receiptLogBootRequested, receiptLogStrict };
export const TREE_HEAD_SCHEMA_V1 = 'chit402.tree_head.v1';
export const TREE_HEAD_SCHEMA = 'chit402.tree_head.v2';
// Version 2 adds epoch, prev_epoch_root, prev_epoch_size, prev_root, and
// bundle_index_hash. A head signed at version 1 still verifies.
export const TREE_HEAD_VERSION = 2;
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

const FIXED_ANCHOR_FEES = {
  gasLimit: 100_000n,
  maxFeePerGas: 1_000_000_000n,
  maxPriorityFeePerGas: 100_000_000n,
};

function baseRpcUrl() {
  return process.env.BASE_RPC_URL || process.env.SETTLEMENT_RPC_URL || '';
}

/**
 * Sign the zero-value self-transfer. The caller fsyncs `raw` and `hash`
 * before any broadcast. The hash is keccak256 of the signed bytes.
 */
export async function signBaseAnchorRaw({ privateKey, nonce, calldata, fees = null }) {
  const { Wallet, keccak256 } = await import('ethers');
  const wallet = new Wallet(privateKey);
  const fromEnv = process.env.RECEIPT_ANCHOR_FROM || '';
  if (fromEnv && fromEnv.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new ReceiptLogRefused(
      'anchor_sender_mismatch',
      'RECEIPT_ANCHOR_FROM does not match the address of RECEIPT_ANCHOR_PRIVATE_KEY',
    );
  }
  const fee = fees || FIXED_ANCHOR_FEES;
  const raw = await wallet.signTransaction({
    to: wallet.address,
    value: 0n,
    data: calldata,
    nonce: Number(nonce),
    chainId: 8453,
    type: 2,
    gasLimit: fee.gasLimit,
    maxFeePerGas: fee.maxFeePerGas,
    maxPriorityFeePerGas: fee.maxPriorityFeePerGas,
  });
  return { raw, hash: keccak256(raw), from: wallet.address, to: wallet.address };
}

async function baseAnchorFees(request) {
  const url = baseRpcUrl();
  if (!url && !request) return FIXED_ANCHOR_FEES;
  const { JsonRpcProvider } = await import('ethers');
  const call = request || (async (rpcUrl, method, params) => {
    const provider = new JsonRpcProvider(rpcUrl);
    return provider.send(method, params);
  });
  const block = await call(url, 'eth_getBlockByNumber', ['latest', false]);
  if (!block?.baseFeePerGas) return FIXED_ANCHOR_FEES;
  const base = BigInt(block.baseFeePerGas);
  let tip = FIXED_ANCHOR_FEES.maxPriorityFeePerGas;
  try {
    const quoted = await call(url, 'eth_maxPriorityFeePerGas', []);
    if (quoted != null) tip = BigInt(quoted);
  } catch {
    tip = FIXED_ANCHOR_FEES.maxPriorityFeePerGas;
  }
  return {
    gasLimit: FIXED_ANCHOR_FEES.gasLimit,
    maxPriorityFeePerGas: tip,
    maxFeePerGas: base * 2n + tip,
  };
}

async function broadcastBaseRaw(raw) {
  const rpc = baseRpcUrl();
  if (!rpc) throw new Error('no_rpc');
  const { JsonRpcProvider } = await import('ethers');
  const provider = new JsonRpcProvider(rpc);
  const tx = await provider.broadcastTransaction(raw);
  return tx.hash;
}

/**
 * Describe the Base anchor. Sends a zero-value self-transfer only when
 * RECEIPT_ANCHOR_PRIVATE_KEY is set. Otherwise the head stays pending.
 * The durable path signs and fsyncs before this runs.
 */
async function sendBaseAnchorTx({ from, calldata, privateKey, nonce = null }) {
  const signed = await signBaseAnchorRaw({
    privateKey,
    nonce: nonce == null ? await readBaseAnchorNonce() : nonce,
    calldata,
    fees: await baseAnchorFees(),
  });
  if (from && from.toLowerCase() !== signed.from.toLowerCase()) {
    throw new ReceiptLogRefused(
      'anchor_sender_mismatch',
      'RECEIPT_ANCHOR_FROM does not match the address of RECEIPT_ANCHOR_PRIVATE_KEY',
    );
  }
  await broadcastBaseRaw(signed.raw);
  return signed.hash;
}

async function readBaseAnchorNonce() {
  const rpc = baseRpcUrl();
  const key = process.env.RECEIPT_ANCHOR_PRIVATE_KEY || null;
  if (!rpc || !key) throw new Error('no_rpc');
  const { Wallet, JsonRpcProvider } = await import('ethers');
  const provider = new JsonRpcProvider(rpc);
  const wallet = new Wallet(key, provider);
  const from = resolveAnchorSender() || wallet.address;
  return provider.getTransactionCount(from, 'pending');
}

export async function describeAnchor(rootHex, { send = null } = {}) {
  const from = (() => {
    try {
      return resolveAnchorSender();
    } catch (err) {
      if (err?.code === 'anchor_sender_mismatch' || err?.code === 'anchor_key' || err?.code === 'anchor_from') {
        throw err;
      }
      return null;
    }
  })();
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

/**
 * Prev root for the anchor. The previous stored head, not a published_at
 * scan. Zeros only when this epoch has no earlier head (true genesis, or a
 * republish of that genesis head that already recorded zeros).
 */
export function anchorPrevRoot(heads, currentRoot) {
  const list = Array.isArray(heads) ? heads : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const root = list[i]?.root;
    if (root && root !== currentRoot) return root;
  }
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i]?.root === currentRoot && list[i]?.prev_root) return list[i].prev_root;
  }
  return ZERO_ROOT;
}

function solanaAnchoredForDay(heads, day, scope, anchorState) {
  const disk = anchorState?.solana?.[`${scope}|${day}`];
  if (disk?.status === 'anchored' && disk.signature) {
    return {
      status: 'anchored',
      signature: disk.signature,
      slot: disk.slot ?? null,
      cluster: disk.cluster || null,
      memo: disk.memo || null,
      reason: null,
    };
  }
  for (let i = heads.length - 1; i >= 0; i -= 1) {
    if (dayOf(heads[i].published_at) !== day) continue;
    const sol = heads[i].anchors?.solana;
    const parsed = parseAnchorMemo(sol?.memo);
    if (sol?.status === 'anchored' && sol.signature && parsed?.scope === scope) return sol;
  }
  return null;
}

function baseAnchoredForRoot(heads, root, anchorState) {
  const disk = anchorState?.base?.[root];
  if (disk?.status === 'anchored' && disk.tx) return disk;
  for (let i = heads.length - 1; i >= 0; i -= 1) {
    if (heads[i].root !== root) continue;
    const base = heads[i].anchors?.base || heads[i].anchor;
    if (base?.status === 'anchored' && base.tx) return base;
  }
  return null;
}

function epochHeadCovering(heads, leaves, rootHex) {
  for (let i = heads.length - 1; i >= 0; i -= 1) {
    const head = heads[i];
    if (!head?.issuer_signature?.jws) continue;
    if (Number(head.tree_size) === leaves.length && head.root === rootHex) return head;
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
    this.durable = false;
    this.allowFreshGenesis = false;
    this.epoch = 1;
    this.prevEpochRoot = null;
    this.prevEpochSize = 0;
    this.closedEpochs = [];
    this.anchorState = { schema: 'chit402.receipt_anchor_state.v1', solana: {}, base: {} };
    this.epochRecord = null;
    this.bundleIndex = emptyBundleIndex();
    this.anchorIntents = [];
    this.lastBundleOkAt = null;
    this.bundleFailures = 0;
    this.bootWarnings = [];
    this._epochOpened = false;
    this._warnedUninitialized = false;
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
    if (this.durable && !this.allowFreshGenesis) {
      throw new ReceiptLogRefused('no_genesis', 'receipt log has no stored genesis');
    }
    if (this.durable && this.allowFreshGenesis) {
      logger.error(
        { flag: 'RECEIPT_LOG_ACCEPT_FRESH_GENESIS', dir: this.dir },
        'RECEIPT LOG FRESH GENESIS: the operator flag is set. This starts a new public receipt log and does not extend the anchored history.',
      );
    }
    const g = this.genesisLeaf();
    this._push(g.task_id, g.bytes, g.kind);
  }

  _push(taskId, bytes, kind) {
    const buf = Buffer.from(bytes);
    const hash = leafHash(buf);
    const index = this.leaves.length;
    if (this.dir) {
      this._ensureEpochOpen();
      appendJournal(this.dir, {
        v: 1,
        op: 'leaf',
        epoch: this.epoch,
        index,
        task_id: taskId,
        kind,
        preimage_b64: buf.toString('base64'),
      });
    }
    this.leaves.push(hash);
    this.meta.push({
      task_id: taskId,
      index,
      kind,
      leaf: hash.toString('hex'),
      preimage_b64: buf.toString('base64'),
      epoch: this.epoch,
    });
    if (taskId) this.byTask.set(String(taskId), index);
    if (this.dir) this._writeSnapshot();
    return index;
  }

  _ensureEpochOpen() {
    if (!this.dir || this._epochOpened) return;
    appendJournal(this.dir, {
      v: 1,
      op: 'epoch_open',
      epoch: this.epoch,
      prev_epoch_root: this.prevEpochRoot,
      prev_epoch_size: this.prevEpochSize,
    });
    this._epochOpened = true;
  }

  /**
   * Exact leaf inputs for the prefix that ends at this receipt.
   * Each preimage is the UTF-8 leaf body. The leaf hash is SHA-256(0x00 || body).
   * A stored leaf whose body is not retained, or whose bytes do not match the
   * stored hash, is not returned.
   * @param {unknown} taskId
   * @param {(taskId: string) => string|null|undefined} [rowHashOf]
   */
  prefixLeafPreimages(taskId, rowHashOf = null) {
    const closed = this._findClosed(taskId);
    const index = closed
      ? closed.byTask.get(String(taskId))
      : this.byTask.get(String(taskId));
    if (index == null) return { ok: false, reason: 'not_in_tree' };
    const metaList = closed ? closed.meta : this.meta;
    const leafList = closed ? closed.leaves : this.leaves;
    const leaves = [];
    for (let i = 0; i <= index; i += 1) {
      const meta = metaList[i] || {};
      let body = null;
      if (meta.preimage_b64) {
        body = Buffer.from(meta.preimage_b64, 'base64');
      } else if (typeof rowHashOf === 'function' && meta.task_id && meta.kind !== 'genesis' && meta.task_id !== 'genesis') {
        const rowHash = rowHashOf(meta.task_id);
        if (rowHash != null) body = Buffer.from(`${meta.task_id}|${rowHash}`);
      }
      if (!body) return { ok: false, reason: 'leaf_preimage_unavailable', index: i };
      const hashed = leafHash(body);
      const stored = leafList[i];
      if (!stored || hashed.toString('hex') !== Buffer.from(stored).toString('hex')) {
        return { ok: false, reason: 'leaf_preimage_mismatch', index: i };
      }
      leaves.push({
        index: i,
        kind: meta.kind || (meta.task_id === 'genesis' ? 'genesis' : 'receipt'),
        task_id: meta.task_id || null,
        preimage_utf8: body.toString('utf8'),
      });
    }
    return {
      ok: true,
      leaves,
      root: hex(rootOf(leafList.slice(0, index + 1))),
      leaf_index: index,
    };
  }

  appendReceipt(taskId, rowHash, { publish = true } = {}) {
    if (!taskId) return null;
    if (this.byTask.has(String(taskId))) return this.inclusion(taskId);
    if (this._findClosed(taskId)) return this.inclusion(taskId);
    if (this.leaves.length === 0) {
      if (this.durable && !this.allowFreshGenesis) {
        if (!this._warnedUninitialized) {
          this._warnedUninitialized = true;
          logger.error(
            { dir: this.dir },
            'receipt log append refused: no stored genesis. Rebuild epoch 1, or set RECEIPT_LOG_ACCEPT_FRESH_GENESIS to the documented flag.',
          );
        }
        return null;
      }
      this.ensureGenesis();
    }
    const bytes = Buffer.from(`${taskId}|${rowHash || ''}`);
    this._push(String(taskId), bytes, 'receipt');
    if (publish) this._maybePublishDaily();
    return this.inclusion(taskId);
  }

  /**
   * Root of the prefix that ends at this receipt. Stable after later appends.
   * An inclusion proof of size `leaf_index + 1` verifies against it, so the
   * bound head can prove this leaf. Null when the task is not in the log.
   * @param {unknown} taskId
   * @returns {string|null}
   */
  _findClosed(taskId) {
    const id = String(taskId);
    for (let i = this.closedEpochs.length - 1; i >= 0; i -= 1) {
      const epoch = this.closedEpochs[i];
      if (epoch.byTask?.has(id)) return epoch;
    }
    return null;
  }

  prefixRoot(taskId) {
    const closed = this._findClosed(taskId);
    if (closed) {
      const index = closed.byTask.get(String(taskId));
      return hex(rootOf(closed.leaves.slice(0, index + 1)));
    }
    const index = this.byTask.get(String(taskId));
    if (index == null) return null;
    return hex(rootOf(this.leaves.slice(0, index + 1)));
  }

  inclusion(taskId) {
    const closed = this._findClosed(taskId);
    if (closed) return this._inclusionIn(closed, taskId);
    const index = this.byTask.get(String(taskId));
    if (index == null) return null;
    return this._inclusionIn({
      epoch: this.epoch,
      leaves: this.leaves,
      byTask: this.byTask,
      heads: this.heads,
      prevEpochRoot: this.prevEpochRoot,
      prevEpochSize: this.prevEpochSize,
    }, taskId);
  }

  _inclusionIn(epoch, taskId) {
    const index = epoch.byTask.get(String(taskId));
    if (index == null) return null;
    const proof = inclusionProof(epoch.leaves, index);
    const root = hex(rootOf(epoch.leaves));
    const head = epochHeadCovering(epoch.heads, epoch.leaves, root);
    const baseSide = head ? (head.anchors?.base || head.anchor || null) : null;
    const baseTx = baseSide?.status === 'anchored' ? (baseSide.tx || null) : null;
    const solana = head ? (head.anchors?.solana || null) : null;
    const solanaSig = solana?.status === 'anchored' ? solana.signature : null;
    return {
      schema: 'chit402.inclusion.v1',
      payload_version: 2,
      epoch: epoch.epoch,
      prev_epoch_root: epoch.prevEpochRoot || null,
      prev_epoch_size: epoch.prevEpochSize || 0,
      task_id: String(taskId),
      leaf_index: index,
      leaf: epoch.leaves[index].toString('hex'),
      tree_size: epoch.leaves.length,
      root,
      proof: proof.map((step) => ({ hash: step.hash, position: step.position })),
      anchor_status: baseTx ? 'anchored' : 'pending',
      anchor_tx: baseTx,
      solana_signature: solanaSig,
      anchors: head ? (head.anchors || null) : null,
      verified_at: new Date().toISOString(),
    };
  }

  consistency(m, n, epochNumber = null) {
    const epoch = this._epochForConsistency(m, n, epochNumber);
    const proof = consistencyProof(epoch.leaves, m, n);
    const oldRoot = hex(rootOf(epoch.leaves.slice(0, m)));
    const newRoot = hex(rootOf(epoch.leaves.slice(0, n)));
    return {
      schema: 'chit402.consistency.v1',
      payload_version: 2,
      epoch: epoch.epoch,
      first_tree_size: m,
      second_tree_size: n,
      first_root: oldRoot,
      second_root: newRoot,
      proof,
    };
  }

  _epochForConsistency(m, n, epochNumber) {
    if (epochNumber != null) {
      const wanted = Number(epochNumber);
      if (wanted === this.epoch) return { epoch: this.epoch, leaves: this.leaves };
      const closed = this.closedEpochs.find((row) => row.epoch === wanted);
      if (!closed) throw new Error('bad_tree_size');
      return closed;
    }
    if (n <= this.leaves.length) return { epoch: this.epoch, leaves: this.leaves };
    const closed = [...this.closedEpochs].reverse().find((row) => row.leaves.length >= n);
    if (closed) return closed;
    return { epoch: this.epoch, leaves: this.leaves };
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
    blockTimestamp,
    readBlockTs,
    solanaBlockTime,
    readSolanaBlockTs,
    nonce = null,
    lookup = null,
    request = null,
  } = {}) {
    if (this.leaves.length === 0) {
      if (this.durable && !this.allowFreshGenesis) return null;
      this.ensureGenesis();
    }
    const publishedAt = (now ? new Date(now) : new Date()).toISOString();
    const day = dayOf(publishedAt);
    const root = hex(rootOf(this.leaves));
    const prevRoot = anchorPrevRoot(this.heads, root);
    const indexHash = this.currentBundleIndexHash();
    const last = this.heads[this.heads.length - 1] || null;
    if (!force && last && last.root === root && last.tree_size === this.leaves.length && !anchorNeedsRetry(last)) {
      return last;
    }

    const priorBase = !send ? baseAnchoredForRoot(this.heads, root, this.anchorState) : null;
    let reserved = null;
    const reserveBase = Boolean(this.dir) && !priorBase && (nonce != null || process.env.RECEIPT_ANCHOR_PRIVATE_KEY);
    if (reserveBase) {
      let intentNonce = nonce;
      if (intentNonce == null) {
        try {
          intentNonce = await readBaseAnchorNonce();
        } catch {
          intentNonce = null;
        }
      }
      if (intentNonce != null) {
        this._abandonUnsignedIntents({ keepRoot: root, keepDay: day });
        reserved = this._reserveBaseIntent({ root, day, nonce: this._nextFreeNonce(intentNonce) });
      }
    }
    let anchor;
    if (priorBase) {
      anchor = priorBase;
    } else if (reserved?.anchoredTx && !send) {
      anchor = {
        status: 'anchored',
        chain: 'base',
        chain_id: 8453,
        from: reserved.from || resolveAnchorSender() || null,
        tx: reserved.anchoredTx,
        calldata: anchorCalldata(root),
        reason: null,
      };
    } else if (reserveBase && !reserved) {
      anchor = {
        status: 'pending',
        chain: 'base',
        chain_id: 8453,
        from: (() => { try { return resolveAnchorSender(); } catch { return null; } })(),
        tx: null,
        calldata: anchorCalldata(root),
        reason: 'nonce_unknown',
      };
    } else if (reserved?.raw) {
      anchor = await this._resumeSignedIntent(reserved, { send, lookup, request, root, day });
    } else if (reserved?.needsSign) {
      anchor = await this._signAndBroadcastIntent(reserved, { send, request, root, day });
    } else {
      anchor = await describeAnchor(root, { send: send || null });
    }
    const priorSolana = solanaAnchoredForDay(this.heads, day, scope, this.anchorState);
    let solana;
    if (priorSolana) {
      const parsed = parseAnchorMemo(priorSolana.memo);
      const sameMemo = parsed?.root === root && parsed?.prev === prevRoot
        && (parsed.version !== 2 || (
          Number(parsed.epoch) === Number(this.epoch)
          && parsed.bundle_index_hash === indexHash
        ));
      if (sameMemo) {
        solana = { ...priorSolana };
      } else {
        // This UTC day already has a memo. Do not send another.
        let memo = null;
        let cluster = priorSolana.cluster || null;
        try {
          cluster = solanaAnchorCluster();
          memo = solanaAnchorMemo({
            scope,
            day,
            rootHex: root,
            prevRootHex: prevRoot,
            epoch: this.epoch,
            prevEpochRoot: this.prevEpochRoot,
            prevEpochSize: this.prevEpochSize,
            bundleIndexHash: indexHash,
          });
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
        epoch: this.epoch,
        prevEpochRoot: this.prevEpochRoot,
        prevEpochSize: this.prevEpochSize,
        bundleIndexHash: indexHash,
      });
    }

    // Clock gate sits on the objects the anchor describers already returned.
    // A reused prior anchor keeps the block it was signed against.
    if (!priorBase) {
      anchor = await gatePublishedAnchor(anchor, publishedAt, { blockTimestamp, readBlockTs });
    }
    if (!priorSolana) {
      solana = await gatePublishedSolana(solana, publishedAt, {
        blockTimestamp: solanaBlockTime,
        readBlockTs: readSolanaBlockTs,
      });
    }

    anchor = { ...anchor, prev_root: prevRoot };
    solana = { ...solana, prev_root: prevRoot };
    const anchors = { base: anchor, solana };
    // Flat signed claims. clock_tolerance_s is a sibling of anchors, not a
    // field inside the Base or Solana records. Epoch fields are version 2.
    const claims = {
      schema: TREE_HEAD_SCHEMA,
      payload_version: TREE_HEAD_VERSION,
      epoch: this.epoch,
      prev_epoch_root: this.prevEpochRoot,
      prev_epoch_size: this.prevEpochSize,
      prev_root: prevRoot,
      bundle_index_hash: indexHash,
      tree_size: this.leaves.length,
      root,
      anchor_status: anchor.status,
      anchor_tx: anchor.tx,
      anchor_from: anchor.from,
      published_at: publishedAt,
      clock_tolerance_s: clockToleranceClaim(),
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
    this._rememberAnchor(day, scope, head);
    this._persistHead(head);
    return head;
  }

  currentBundleIndexHash() {
    return bundleIndexHash(this.bundleIndex || emptyBundleIndex());
  }

  /**
   * Leaf preimages and heads for an hourly bundle. `added` is the open-epoch
   * leaves past the last bundled size.
   */
  bundleView(receipts = [], now = new Date()) {
    const leafRows = (epoch, meta, leafList) => meta.map((row, index) => ({
      epoch,
      index,
      task_id: row.task_id || null,
      kind: row.kind || null,
      preimage_b64: row.preimage_b64,
      leaf: leafList[index].toString('hex'),
    }));
    const leaves = leafRows(this.epoch, this.meta, this.leaves);
    const closedEpochs = this.closedEpochs.map((epoch) => ({
      epoch: epoch.epoch,
      prev_epoch_root: epoch.prevEpochRoot || null,
      prev_epoch_size: epoch.prevEpochSize || 0,
      leaves: leafRows(epoch.epoch, epoch.meta, epoch.leaves),
    }));
    const from = this.bundledTreeSize || 0;
    const added = leaves.filter((row) => row.index >= from);
    const ids = new Set(added.map((row) => row.task_id).filter(Boolean));
    const receiptRows = (receipts || []).filter((row) => ids.has(String(row.task_id)));
    return {
      hour: new Date(now).toISOString().slice(0, 13),
      epoch: this.epoch,
      prevEpochRoot: this.prevEpochRoot,
      prevEpochSize: this.prevEpochSize,
      leaves,
      added,
      heads: this.heads,
      receipts: receiptRows,
      closedEpochs,
      root: this.leaves.length ? hex(rootOf(this.leaves)) : null,
      tree_size: this.leaves.length,
    };
  }

  noteBundle(index, treeSize) {
    this.bundleIndex = index;
    this.bundledTreeSize = treeSize;
    this.lastBundleOkAt = index?.last_bundle_ok_at || this.lastBundleOkAt;
    this.bundleFailures = index?.consecutive_failures || 0;
    if (this.dir) {
      appendJournal(this.dir, { v: 1, op: 'bundle_index', index });
      this._writeSnapshot();
    }
  }

  _latestBaseIntents() {
    const latest = new Map();
    for (const row of this.anchorIntents || []) {
      if (row.chain !== 'base') continue;
      const key = `${row.day}|${row.root}|${row.nonce}`;
      const prev = latest.get(key);
      latest.set(key, {
        ...prev,
        ...row,
        raw: row.raw || prev?.raw || null,
        tx: row.tx || prev?.tx || null,
        from: row.from || prev?.from || null,
        to: row.to || prev?.to || null,
        at: row.at || prev?.at || null,
        reason: row.reason || prev?.reason || null,
      });
    }
    return [...latest.values()];
  }

  /**
   * A row with no raw transaction was never broadcast. Free it.
   * keepRoot/keepDay leaves the open unsigned row the caller is about to sign.
   */
  _abandonUnsignedIntents({ keepRoot = null, keepDay = null } = {}) {
    for (const row of this._latestBaseIntents()) {
      if (row.raw) continue;
      if (row.status === 'abandoned_unsigned' || row.status === 'replaced' || row.status === 'anchored') continue;
      if (row.status === 'intent' && keepRoot && row.root === keepRoot && row.day === keepDay) continue;
      this._markIntent(row, 'abandoned_unsigned', { reason: 'never_broadcast' });
    }
  }

  /**
   * Lowest nonce at or above the sender's pending count that is not held by
   * a signed raw transaction. Replaced nonces stay taken. Unsigned and
   * abandoned_unsigned nonces are free, so a crash before sign leaves no gap.
   */
  _nextFreeNonce(start) {
    const occupied = new Set();
    for (const row of this._latestBaseIntents()) {
      if (row.nonce == null) continue;
      if (row.status === 'abandoned_unsigned') continue;
      if (!row.raw && row.status !== 'replaced') continue;
      occupied.add(Number(row.nonce));
    }
    let n = Number(start);
    while (occupied.has(n)) n += 1;
    return n;
  }

  _reserveBaseIntent({ root, day, nonce }) {
    this._abandonUnsignedIntents({ keepRoot: root, keepDay: day });
    const prior = this._latestBaseIntents().filter((row) => row.day === day && row.root === root);
    const anchored = [...prior].reverse().find((row) => row.status === 'anchored' && row.tx);
    if (anchored) {
      return { anchoredTx: anchored.tx, nonce: anchored.nonce, from: anchored.from, intent: anchored };
    }
    const signed = [...prior].reverse().find((row) => (
      row.raw && row.tx && row.status !== 'replaced' && row.status !== 'anchored' && row.status !== 'abandoned_unsigned'
    ));
    if (signed) {
      return {
        raw: signed.raw,
        hash: signed.tx,
        nonce: signed.nonce,
        from: signed.from,
        intent: signed,
      };
    }
    const open = [...prior].reverse().find((row) => row.status === 'intent' && row.nonce != null && !row.raw);
    if (open && Number(open.nonce) === Number(nonce)) {
      return { needsSign: true, nonce: open.nonce, intent: open };
    }
    if (open) this._markIntent(open, 'abandoned_unsigned', { reason: 'never_broadcast' });
    const record = {
      v: 1,
      op: 'anchor_intent',
      chain: 'base',
      root,
      day,
      nonce,
      status: 'intent',
      epoch: this.epoch,
    };
    appendJournal(this.dir, record);
    this.anchorIntents.push(record);
    return { needsSign: true, nonce, intent: record };
  }

  _markIntent(intent, status, extra = {}) {
    if (!intent || intent.status === status) return intent;
    const record = {
      v: 1,
      op: 'anchor_intent',
      chain: 'base',
      root: intent.root,
      day: intent.day,
      nonce: intent.nonce,
      tx: extra.tx || intent.tx || null,
      raw: extra.raw || intent.raw || null,
      from: extra.from || intent.from || null,
      to: extra.to || intent.to || null,
      status,
      reason: extra.reason || null,
      at: new Date().toISOString(),
      epoch: intent.epoch ?? this.epoch,
    };
    if (this.dir) appendJournal(this.dir, record);
    this.anchorIntents.push(record);
    return record;
  }

  async _signAndBroadcastIntent(reserved, { send, request, root, day }) {
    const key = process.env.RECEIPT_ANCHOR_PRIVATE_KEY || null;
    const calldata = anchorCalldata(root);
    const pending = (reason, from = null) => ({
      status: 'pending',
      chain: 'base',
      chain_id: 8453,
      from,
      tx: null,
      calldata,
      reason,
    });
    if (!key) return pending('no_key');
    let signed;
    try {
      const fees = typeof send === 'function' ? null : await baseAnchorFees(request);
      signed = await signBaseAnchorRaw({
        privateKey: key,
        nonce: reserved.nonce,
        calldata,
        fees,
      });
    } catch (err) {
      return pending(err.message);
    }
    const signedIntent = this._markIntent(reserved.intent || {
      root,
      day,
      nonce: reserved.nonce,
      epoch: this.epoch,
    }, 'signed', {
      raw: signed.raw,
      tx: signed.hash,
      from: signed.from,
      to: signed.to,
    });
    try {
      if (typeof send === 'function') {
        await send({
          from: signed.from,
          to: signed.to,
          calldata,
          value: '0',
          nonce: reserved.nonce,
          raw: signed.raw,
          hash: signed.hash,
        });
      } else {
        await broadcastBaseRaw(signed.raw);
      }
    } catch (err) {
      return pending(err.message, signed.from);
    }
    this._markIntent(signedIntent, 'broadcast', {
      raw: signed.raw,
      tx: signed.hash,
      from: signed.from,
      to: signed.to,
    });
    return {
      status: 'anchored',
      chain: 'base',
      chain_id: 8453,
      from: signed.from,
      tx: signed.hash,
      calldata,
      reason: null,
    };
  }

  async _resumeSignedIntent(reserved, { send, lookup, request, root, day }) {
    const intent = reserved.intent;
    const calldata = anchorCalldata(root);
    const pending = (reason) => ({
      status: 'pending',
      chain: 'base',
      chain_id: 8453,
      from: intent.from || null,
      tx: null,
      calldata,
      reason,
    });
    let found;
    try {
      found = typeof lookup === 'function'
        ? await lookup(intent)
        : await lookupBaseTxByNonceOrHash({
          txHash: intent.tx,
          root: intent.root,
          nonce: intent.nonce,
          from: intent.from,
          to: intent.to,
          request,
        });
    } catch (err) {
      this._markIntent(intent, 'blocked', { reason: err?.message || 'rpc_error' });
      return pending('rpc_error');
    }
    if (found?.receiptOk === true && normalizeRoot(found.root) === normalizeRoot(intent.root) && found.tx) {
      this._adoptBaseIntent(intent, found);
      this._markIntent(intent, 'anchored', { tx: found.tx, from: found.from || intent.from });
      return {
        status: 'anchored',
        chain: 'base',
        chain_id: 8453,
        from: found.from || intent.from || null,
        tx: found.tx,
        calldata,
        reason: null,
      };
    }
    if (found?.replaced) {
      this._markIntent(intent, 'replaced', { tx: found.tx || intent.tx || null });
      return pending(found.reason || 'nonce_replaced');
    }
    if (found?.rebroadcast) {
      if (!intent.raw) {
        this._markIntent(intent, 'abandoned_unsigned', { reason: 'never_broadcast' });
        return pending('never_broadcast');
      }
      try {
        if (typeof send === 'function') {
          await send({
            from: intent.from,
            to: intent.to,
            calldata,
            value: '0',
            nonce: intent.nonce,
            raw: intent.raw,
            hash: intent.tx,
          });
        } else {
          await broadcastBaseRaw(intent.raw);
        }
      } catch (err) {
        this._markIntent(intent, 'blocked', { reason: err.message || 'rpc_error' });
        return pending(err.message);
      }
      this._markIntent(intent, 'broadcast', { raw: intent.raw, tx: intent.tx, from: intent.from, to: intent.to });
      return {
        status: 'anchored',
        chain: 'base',
        chain_id: 8453,
        from: intent.from || null,
        tx: intent.tx,
        calldata,
        reason: null,
      };
    }
    if (!intent.raw) {
      this._markIntent(intent, 'abandoned_unsigned', { reason: 'never_broadcast' });
      return pending('never_broadcast');
    }
    this._markIntent(intent, 'blocked', { reason: found?.reason || 'rpc_error' });
    return pending(found?.reason || 'anchor_intent_blocked');
  }

  _adoptBaseIntent(intent, found = null) {
    const root = normalizeRoot(found?.root || intent?.root);
    if (!root || root !== normalizeRoot(intent?.root)) return;
    const tx = found?.tx || intent?.tx;
    if (!tx) return;
    if (found && found.receiptOk !== true && found.status !== 'anchored') return;
    if (!this.anchorState.base[root]) {
      this.anchorState.base[root] = {
        status: 'anchored',
        tx,
        calldata: anchorCalldata(root),
        from: found?.from || intent.from || resolveAnchorSender() || null,
        chain_id: 8453,
        nonce: intent.nonce ?? null,
      };
    }
  }

  /**
   * A signed raw transaction is fsynced before broadcast. Recovery looks up
   * that hash. A match is adopted. Anything else mined is replaced. An
   * unsigned intent was never broadcast: it is abandoned and the nonce is
   * free. An RPC error on a signed raw stays blocked and is retried. The
   * same raw is rebroadcast only when the nonce is still unused.
   */
  async reconcileAnchorIntents({ lookup, rebroadcast } = {}) {
    for (const intent of this._latestBaseIntents()) {
      if (intent.status === 'replaced' || intent.status === 'abandoned_unsigned') continue;
      if (!intent.raw && intent.status !== 'anchored') {
        this._markIntent(intent, 'abandoned_unsigned', { reason: 'never_broadcast' });
        continue;
      }
      if (intent.status === 'anchored' && intent.tx) {
        this._adoptBaseIntent({ ...intent, status: 'anchored' }, { ...intent, receiptOk: true, root: intent.root });
        continue;
      }
      if (typeof lookup !== 'function') continue;
      let found;
      try {
        found = await lookup(intent);
      } catch (err) {
        this._markIntent(intent, 'blocked', { reason: err?.message || 'rpc_error' });
        continue;
      }
      if (found?.replaced) {
        this._markIntent(intent, 'replaced', { tx: found.tx || intent.tx || null });
        continue;
      }
      if (found?.receiptOk === true && found.tx && normalizeRoot(found.root) === normalizeRoot(intent.root)) {
        this._adoptBaseIntent(intent, found);
        this._markIntent(intent, 'anchored', { tx: found.tx, from: found.from || intent.from });
        continue;
      }
      if (found?.receiptOk === true) {
        this._markIntent(intent, 'replaced', { tx: found.tx || intent.tx || null });
        continue;
      }
      if (found?.rebroadcast && intent.raw && typeof rebroadcast === 'function') {
        try {
          await rebroadcast(intent.raw);
          this._markIntent(intent, 'broadcast', { raw: intent.raw, tx: intent.tx });
        } catch (err) {
          this._markIntent(intent, 'blocked', { reason: err?.message || 'rpc_error' });
        }
        continue;
      }
      if (found?.blocked || found?.pending || found?.rebroadcast) {
        this._markIntent(intent, 'blocked', { reason: found.reason || 'rpc_error' });
        continue;
      }
    }
    if (this.dir) this._writeSnapshot();
  }

  bundleStatus(now = new Date()) {
    const latest = this._latestBaseIntents();
    const blocked = latest.filter((row) => row.status === 'blocked');
    const pending = latest.filter((row) => (
      row.status === 'intent' || row.status === 'signed' || row.status === 'broadcast'
    ));
    let oldest = null;
    for (const row of blocked) {
      const at = Date.parse(row.at || '');
      if (!Number.isFinite(at)) continue;
      if (oldest == null || at < oldest) oldest = at;
    }
    const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
    let lastAnchoredRoot = null;
    let lastAnchoredTx = null;
    let lastError = null;
    for (const row of this.anchorIntents || []) {
      if (row.chain !== 'base') continue;
      if (row.status === 'anchored' && row.root && row.tx) {
        lastAnchoredRoot = row.root;
        lastAnchoredTx = row.tx;
      }
      if (row.status === 'blocked' || row.status === 'replaced') {
        lastError = row.reason || row.status;
      }
    }
    if (!lastAnchoredRoot) {
      const bases = Object.entries(this.anchorState?.base || {});
      const last = bases[bases.length - 1];
      if (last?.[1]?.tx) {
        lastAnchoredRoot = last[0];
        lastAnchoredTx = last[1].tx;
      }
    }
    return {
      last_bundle_ok_at: this.lastBundleOkAt || this.bundleIndex?.last_bundle_ok_at || null,
      consecutive_failures: this.bundleFailures
        || this.bundleIndex?.consecutive_failures
        || 0,
      blocked_intents: blocked.length,
      pending_intents: pending.length,
      oldest_blocked_age_s: oldest == null ? null : Math.max(0, Math.floor((nowMs - oldest) / 1000)),
      last_anchored_root: lastAnchoredRoot,
      last_anchored_tx: lastAnchoredTx,
      last_error: lastError,
    };
  }

  noteBundleFailure() {
    this.bundleFailures = (this.bundleFailures || 0) + 1;
    if (!this.bundleIndex) this.bundleIndex = emptyBundleIndex();
    this.bundleIndex.consecutive_failures = this.bundleFailures;
    if (this.dir) writeBundleIndexFile(this.dir, this.bundleIndex);
    return this.bundleStatus();
  }

  _rememberAnchor(day, scope, head) {
    const sol = head.anchors?.solana;
    if (sol?.status === 'anchored' && sol.signature) {
      const key = `${scope}|${day}`;
      if (!this.anchorState.solana[key]) {
        this.anchorState.solana[key] = {
          status: 'anchored',
          signature: sol.signature,
          slot: sol.slot ?? null,
          cluster: sol.cluster || null,
          memo: sol.memo || null,
          root: head.root,
          prev: head.prev_root || null,
          day,
          scope,
        };
      }
    }
    const base = head.anchors?.base;
    if (base?.status === 'anchored' && base.tx && head.root && !this.anchorState.base[head.root]) {
      this.anchorState.base[head.root] = {
        status: 'anchored',
        tx: base.tx,
        calldata: base.calldata || null,
        from: base.from || null,
        chain_id: base.chain_id || 8453,
      };
    }
  }

  _persistHead(head) {
    if (!this.dir) return;
    this._ensureEpochOpen();
    appendJournal(this.dir, { v: 1, op: 'head', epoch: this.epoch, head });
    appendJournal(this.dir, {
      v: 1,
      op: 'anchor',
      epoch: this.epoch,
      day: dayOf(head.published_at),
      scope: 'global',
      root: head.root,
      prev: head.prev_root || null,
      solana: this.anchorState.solana[`${'global'}|${dayOf(head.published_at)}`] || null,
      base: this.anchorState.base[head.root] || null,
    });
    this._writeSnapshot();
  }

  _snapshotEpochs() {
    const closed = this.closedEpochs.map((row) => ({
      epoch: row.epoch,
      status: row.status || 'closed',
      tree_size: row.leaves.length,
      root: hex(rootOf(row.leaves)),
      prevEpochRoot: row.prevEpochRoot || null,
      prevEpochSize: row.prevEpochSize || 0,
    }));
    closed.push({
      epoch: this.epoch,
      status: 'open',
      tree_size: this.leaves.length,
      root: this.leaves.length ? hex(rootOf(this.leaves)) : null,
      prevEpochRoot: this.prevEpochRoot,
      prevEpochSize: this.prevEpochSize,
    });
    return closed;
  }

  _writeSnapshot() {
    if (!this.dir) return;
    writeCheckpoint(this.dir, this._snapshotEpochs());
    writeAnchorState(this.dir, this.anchorState);
    if (this.bundleIndex) writeBundleIndexFile(this.dir, this.bundleIndex);
  }

  _maybePublishDaily() {
    const last = this.heads[this.heads.length - 1];
    if (!dailyAnchorDue(last)) return null;
    return this.publishHead({ force: true }).catch(() => {});
  }

  latestHead() {
    return this.heads[this.heads.length - 1] || null;
  }

  /** Last head that carries an issuer JWS. Historical observations are not served as published. */
  latestSignedHead() {
    for (let i = this.heads.length - 1; i >= 0; i -= 1) {
      if (this.heads[i]?.issuer_signature?.jws) return this.heads[i];
    }
    return null;
  }

  /**
   * Public read when nothing has been signed yet. Does not publish or anchor.
   */
  unpublishedHead() {
    return {
      schema: TREE_HEAD_SCHEMA,
      status: 'not_yet_published',
      published: false,
      epoch: this.epoch,
      prev_epoch_root: this.prevEpochRoot,
      prev_epoch_size: this.prevEpochSize,
      tree_size: this.leaves.length,
      root: this.leaves.length ? hex(rootOf(this.leaves)) : null,
    };
  }

  /**
   * Load a durable log. Throws ReceiptLogRefused. Does not mint genesis.
   * Genesis bytes come from the journal, never from the current verifier digest.
   */
  load(dir, { strict = true } = {}) {
    const loaded = readReceiptLog(dir, { strict });
    this.dir = dir;
    this.durable = true;
    this.allowFreshGenesis = false;
    if (loaded.empty) {
      if (loaded.missingWhileAnchored) {
        logger.error(
          { dir },
          'RECEIPT LOG: journal missing while anchor state exists, and RECEIPT_LOG_STRICT is off. The process will not mint a fresh genesis.',
        );
      }
      this._epochOpened = false;
      return this;
    }
    this._applyLoaded(loaded);
    return this;
  }

  _applyLoaded(loaded) {
    const epochs = loaded.epochs || [];
    const open = epochs[epochs.length - 1];
    this.closedEpochs = epochs.slice(0, -1).map(materializeEpoch);
    const live = materializeEpoch(open);
    this.epoch = live.epoch;
    this.prevEpochRoot = live.prevEpochRoot;
    this.prevEpochSize = live.prevEpochSize;
    this.leaves = live.leaves;
    this.meta = live.meta;
    this.byTask = live.byTask;
    this.heads = live.heads;
    this.anchorState = loaded.anchorState || this.anchorState;
    this.epochRecord = loaded.epochRecord || null;
    this.anchorIntents = Array.isArray(loaded.intents) ? loaded.intents : [];
    if (loaded.bundleIndex) {
      this.bundleIndex = loaded.bundleIndex;
      this.lastBundleOkAt = loaded.bundleIndex.last_bundle_ok_at || null;
      this.bundleFailures = loaded.bundleIndex.consecutive_failures || 0;
    }
    this._epochOpened = true;
    if (this.epochRecord?.issuer_signature?.jws) {
      const signed = verifyJwsWithJwks(this.epochRecord.issuer_signature.jws, getJwks());
      if (!signed.valid) {
        throw new ReceiptLogRefused('epoch_signature', signed.reason || 'epoch record signature invalid');
      }
      const payload = signed.payload || {};
      if (JSON.stringify(payload.epochs) !== JSON.stringify(this.epochRecord.epochs)) {
        throw new ReceiptLogRefused('epoch_signature', 'epoch record epochs do not match the signature');
      }
      if (JSON.stringify(payload.orphans ?? []) !== JSON.stringify(this.epochRecord.orphans ?? [])) {
        throw new ReceiptLogRefused('epoch_signature', 'epoch record orphans do not match the signature');
      }
    } else if (this.epochRecord && receiptLogStrict()) {
      throw new ReceiptLogRefused('epoch_unsigned', 'epoch record is missing its signature');
    }
    const signedEpochs = this.epochRecord?.epochs;
    if (Array.isArray(signedEpochs)) {
      for (const want of signedEpochs) {
        const got = epochs.find((row) => row.epoch === Number(want.epoch));
        if (!got) continue;
        const finalRoot = want.final_root || (want.status === 'open' ? want.opening_root : null);
        if (want.status === 'closed' && finalRoot && got.root !== finalRoot) {
          throw new ReceiptLogRefused(
            'root_mismatch',
            `epoch ${got.epoch} recomputed ${got.root} does not match the epoch record ${finalRoot}`,
          );
        }
        if (want.status === 'open' && want.opening_root) {
          const size = Number(want.opening_size);
          const leaves = got.leaves || [];
          if (!Number.isInteger(size) || size < 1 || leaves.length < size) {
            throw new ReceiptLogRefused(
              'root_mismatch',
              `epoch ${got.epoch} has ${leaves.length} leaves; the opening prefix requires ${want.opening_size}`,
            );
          }
          const prefix = hex(rootOf(leaves.slice(0, size)));
          if (prefix !== want.opening_root) {
            throw new ReceiptLogRefused(
              'root_mismatch',
              `epoch ${got.epoch} opening root ${prefix} does not match the epoch record ${want.opening_root}`,
            );
          }
        }
      }
    }
  }
}

function materializeEpoch(row) {
  const byTask = new Map();
  const meta = row.meta || row.preimages.map((body, index) => ({
    task_id: null,
    index,
    kind: index === 0 ? 'genesis' : 'receipt',
    leaf: Buffer.from(row.leaves[index]).toString('hex'),
    preimage_b64: Buffer.from(body).toString('base64'),
    epoch: row.epoch,
  }));
  // Replay stored meta when the journal loader already built it.
  const useMeta = Array.isArray(row.meta) && row.meta.length === row.leaves.length
    ? row.meta
    : meta;
  useMeta.forEach((item, index) => {
    if (item?.task_id) byTask.set(String(item.task_id), index);
  });
  return {
    epoch: row.epoch,
    status: row.status,
    prevEpochRoot: row.prevEpochRoot || row.prev_epoch_root || null,
    prevEpochSize: row.prevEpochSize || row.prev_epoch_size || 0,
    leaves: row.leaves,
    meta: useMeta,
    byTask: row.byTask instanceof Map ? row.byTask : byTask,
    heads: row.heads || [],
  };
}

export function getReceiptMerkleTree() {
  if (!_tree) _tree = new ReceiptMerkleTree();
  return _tree;
}

export function resetReceiptMerkleTree() {
  _tree = new ReceiptMerkleTree();
  return _tree;
}

/**
 * Open the durable log and install it as the process tree.
 * Throws ReceiptLogRefused. A fresh genesis is minted only when the operator
 * flag is set and the directory has no journal.
 */
export function bootReceiptLog(dir, opts = {}) {
  resolveAnchorSender();
  const strict = opts.strict !== undefined ? opts.strict : receiptLogStrict();
  const tree = new ReceiptMerkleTree();
  tree.durable = true;
  tree.dir = dir;
  const allowFresh = opts.allowFreshGenesis !== undefined
    ? opts.allowFreshGenesis
    : freshGenesisAllowed();
  const loaded = readReceiptLog(dir, { strict, allowFresh });
  const pin = Object.prototype.hasOwnProperty.call(opts, 'pin') ? opts.pin : readReceiptLogPin();
  if (loaded.empty) {
    if (pin && !allowFresh) {
      throw new ReceiptLogRefused(
        'pin_unmet',
        `receipt log journal is empty or missing while pin epoch ${pin.epoch} root ${pin.root} is required`,
      );
    }
    if (loaded.missingWhileAnchored && !allowFresh) {
      throw new ReceiptLogRefused(
        'missing_log',
        'receipt log journal is missing while anchored heads exist on disk',
      );
    }
    tree.allowFreshGenesis = allowFresh;
    if (allowFresh) {
      tree.bootWarnings.push(FRESH_GENESIS_LOG);
      logger.error(
        { dir, flag: 'RECEIPT_LOG_ACCEPT_FRESH_GENESIS', pin: pin || null },
        FRESH_GENESIS_LOG,
      );
    }
    _tree = tree;
    return tree;
  }
  tree.allowFreshGenesis = false;
  tree._applyLoaded(loaded);
  if (!allowFresh && pin) assertJournalMatchesPin(tree, pin);
  if (!allowFresh) gateEpochRecord(tree);
  else if (tree.epochRecord) gateEpochRecord(tree);
  _tree = tree;
  return tree;
}

function gateEpochRecord(tree) {
  if (!tree.epochRecord) {
    throw new ReceiptLogRefused('epoch_record_missing', 'receipt log epoch record is missing');
  }
  const pinned = assertPinnedEpochRecord(tree.epochRecord);
  if (!pinned.ok) {
    throw new ReceiptLogRefused(pinned.reason || 'epoch_record', `epoch record refused: ${pinned.reason}`);
  }
  const signed = verifyJwsWithJwks(tree.epochRecord.issuer_signature.jws, getJwks());
  if (!signed.valid) {
    throw new ReceiptLogRefused('epoch_signature', signed.reason || 'epoch record signature invalid');
  }
}

/**
 * Chain half of boot. Reconciles a write-ahead anchor intent, then refuses
 * if the latest Base root is not in the journal. The fresh-genesis flag
 * skips the refusal.
 */
export async function finishReceiptLogBoot(tree = getReceiptMerkleTree(), opts = {}) {
  if (!tree) return tree;
  resolveAnchorSender();
  const lookup = opts.lookup || ((intent) => lookupBaseTxByNonceOrHash({
    rpcUrl: opts.baseRpc,
    txHash: intent?.tx,
    root: intent?.root,
    nonce: intent?.nonce,
    from: intent?.from || opts.from || resolveAnchorSender(),
    to: intent?.to || intent?.from || opts.from || resolveAnchorSender(),
    request: opts.request,
  }));
  const rebroadcast = Object.prototype.hasOwnProperty.call(opts, 'rebroadcast')
    ? opts.rebroadcast
    : (baseRpcUrl()
      ? async (raw) => { await broadcastBaseRaw(raw); }
      : null);
  if (tree.dir) await tree.reconcileAnchorIntents({ lookup, rebroadcast });
  const allow = tree.allowFreshGenesis || opts.allowFreshGenesis === true || freshGenesisAllowed();
  if (allow) return tree;
  await assertLatestBaseAnchor(tree, opts);
  gateEpochRecord(tree);
  return tree;
}

export function verifyTreeHead(head, jwks = null) {
  const sig = head?.issuer_signature;
  if (!sig?.jws) return { valid: false, reason: 'no_signature' };
  const result = verifyJwsWithJwks(sig.jws, jwks || getJwks());
  if (!result.valid) return { valid: false, reason: result.reason || 'signature_invalid' };
  const payload = result.payload || {};
  if (payload.schema && head.schema && payload.schema !== head.schema) {
    return { valid: false, reason: 'head_mismatch' };
  }
  if (payload.root !== head.root || Number(payload.tree_size) !== Number(head.tree_size)) {
    return { valid: false, reason: 'head_mismatch' };
  }
  // Absent on heads signed before the claim. Present claims must match.
  for (const key of ['epoch', 'prev_epoch_root', 'prev_epoch_size', 'prev_root', 'bundle_index_hash']) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
    if (JSON.stringify(payload[key] ?? null) !== JSON.stringify(head[key] ?? null)) {
      return { valid: false, reason: 'head_mismatch' };
    }
  }
  if (payload.published_at != null && payload.published_at !== head.published_at) {
    return { valid: false, reason: 'head_mismatch' };
  }
  if (payload.clock_tolerance_s != null
    && JSON.stringify(payload.clock_tolerance_s) !== JSON.stringify(head.clock_tolerance_s)) {
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
