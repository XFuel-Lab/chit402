/**
 * Merkle set over pre-v11 receipt payload hashes.
 *
 * This is the legacy_receipts_pre_v11 freeze set. It is not the daily
 * receipt tree in receipt-merkle.js (that one promotes a trailing odd node
 * and is append-only). This set is sorted and built once.
 *
 * Leaf = SHA-256(0x00 || payload_hash bytes). The payload_hash is the 32
 * raw bytes already stored on the receipt, not the hex text and not a
 * recomputed canonical object.
 * Node = SHA-256(0x01 || left || right).
 * Leaves are sorted by payload_hash ascending (byte order, which for
 * equal-length lowercase hex is lexicographic). Duplicate payload hashes
 * stay as separate leaves so enumerated_count equals the receipt count.
 * Equal hashes keep input order (stable sort).
 * When a level has more than one node and an odd count, the last node is
 * duplicated and hashed with itself. A single leaf is the root. An empty
 * set's root is SHA-256(0x00).
 *
 * The contract branch cursor/chit-issuer-root-contract was not on origin
 * when this was written. These rules are the ones the verify package should
 * copy. Test vectors live in test/fixtures/legacy-merkle-vectors.json.
 */
import crypto from 'crypto';
import { jcsCanonicalize } from './offer-receipt.js';

export const LEGACY_SET_SCHEMA = 'chit402.legacy_receipt_set.v1';
export const LEGACY_UNIVERSE_SCHEMA = 'chit402.universe.v1';
export const LEGACY_PREDICATE_SCHEMA = 'chit402.universe_predicate.v1';
export const LEGACY_BOOK_ID = 'chit402:global';
export const LEGACY_WINDOW_ID = 'legacy_receipts_pre_v11';

export const LEGACY_LEAF_RULE = 'sha256(0x00 || payload_hash bytes)';
export const LEGACY_NODE_RULE = 'sha256(0x01 || left || right)';
export const LEGACY_SORT_RULE = 'payload_hash bytes ascending';
export const LEGACY_ODD_RULE = 'duplicate last node when a level has more than one node and an odd count';

/**
 * Predicate whose hash goes into the universe id. The wording is part of
 * the hash. Change it and the universe id changes.
 */
export function legacyPredicateDocument() {
  return {
    schema: LEGACY_PREDICATE_SCHEMA,
    name: LEGACY_WINDOW_ID,
    subject: 'book receipt',
    include: 'book row with a stored issuer signature, payload_version below 11, and no issuer_root claim in the JWS payload',
    exclude: 'rows with no issuer signature; payload_version 11 or greater; any issuer_root claim',
    leaf: 'stored payload_hash bytes',
    re_sign: false,
  };
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest();
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export function legacyPredicateHash() {
  return sha256Hex(jcsCanonicalize(legacyPredicateDocument()));
}

/** Body inside the universe-id preimage. Keys are JCS-sorted at hash time. */
export function legacyUniverseBody() {
  return {
    schema: LEGACY_UNIVERSE_SCHEMA,
    book_id: LEGACY_BOOK_ID,
    window_id: LEGACY_WINDOW_ID,
    predicate_hash: legacyPredicateHash(),
  };
}

/** sha256(JCS(universe body)), lowercase hex, no 0x prefix. */
export function legacyUniverseId() {
  return sha256Hex(jcsCanonicalize(legacyUniverseBody()));
}

export function normalizePayloadHash(value) {
  if (typeof value !== 'string') return null;
  const hex = value.trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  return hex;
}

export function payloadHashBytes(value) {
  const hex = normalizePayloadHash(value);
  if (!hex) throw new Error('payload_hash must be 32 bytes');
  return Buffer.from(hex, 'hex');
}

export function legacyLeaf(payloadHash) {
  return sha256(Buffer.concat([Buffer.from([0x00]), payloadHashBytes(payloadHash)]));
}

export function legacyNode(left, right) {
  return sha256(Buffer.concat([
    Buffer.from([0x01]),
    Buffer.from(left),
    Buffer.from(right),
  ]));
}

/** Empty-set root. SHA-256 of a single 0x00 byte. */
export function emptyLegacyRoot() {
  return sha256(Buffer.from([0x00]));
}

/**
 * @param {string[]} payloadHashes
 * @returns {Buffer}
 */
export function legacyRoot(payloadHashes) {
  const leaves = payloadHashes.map((hash) => legacyLeaf(hash));
  if (leaves.length === 0) return emptyLegacyRoot();
  let level = leaves;
  while (level.length > 1) {
    if (level.length % 2 === 1) level = [...level, level[level.length - 1]];
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(legacyNode(level[i], level[i + 1]));
    }
    level = next;
  }
  return level[0];
}

export function legacyRootHex(payloadHashes) {
  return `0x${legacyRoot(payloadHashes).toString('hex')}`;
}

/**
 * Sort payload hashes ascending. Stable for equal hashes.
 * @param {string[]} payloadHashes
 */
export function sortPayloadHashes(payloadHashes) {
  return payloadHashes.map((hash) => {
    const normalized = normalizePayloadHash(hash);
    if (!normalized) throw new Error('payload_hash must be 32 bytes');
    return normalized;
  }).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Inclusion proof against a sorted leaf list. `index` is into that list.
 * @param {string[]} sortedPayloadHashes
 * @param {number} index
 */
export function legacyInclusionProof(sortedPayloadHashes, index) {
  if (!Number.isInteger(index) || index < 0 || index >= sortedPayloadHashes.length) {
    return null;
  }
  let level = sortedPayloadHashes.map((hash) => legacyLeaf(hash));
  let idx = index;
  const proof = [];
  while (level.length > 1) {
    if (level.length % 2 === 1) level = [...level, level[level.length - 1]];
    const sibling = idx ^ 1;
    proof.push({
      hash: Buffer.from(level[sibling]).toString('hex'),
      position: sibling < idx ? 'left' : 'right',
    });
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(legacyNode(level[i], level[i + 1]));
    }
    idx = Math.floor(idx / 2);
    level = next;
  }
  return proof;
}

/**
 * @param {string} payloadHash
 * @param {{ hash: string, position: 'left'|'right' }[]} proof
 * @param {string} rootHex 0x-prefixed or bare
 */
export function verifyLegacyInclusion(payloadHash, proof, rootHex) {
  if (!Array.isArray(proof)) return false;
  let hash;
  try {
    hash = legacyLeaf(payloadHash);
  } catch {
    return false;
  }
  for (const step of proof) {
    if (!step || (step.position !== 'left' && step.position !== 'right')) return false;
    let sib;
    try {
      sib = Buffer.from(String(step.hash).replace(/^0x/, ''), 'hex');
    } catch {
      return false;
    }
    if (sib.length !== 32) return false;
    hash = step.position === 'left' ? legacyNode(sib, hash) : legacyNode(hash, sib);
  }
  const expect = String(rootHex || '').replace(/^0x/, '').toLowerCase();
  return hash.toString('hex') === expect;
}

function decodeJwsPayload(jws) {
  if (!jws || typeof jws !== 'string') return null;
  const part = jws.split('.')[1];
  if (!part) return null;
  try {
    const parsed = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function signatureOf(row) {
  if (!row || typeof row !== 'object') return null;
  if (row.issuer_signature && typeof row.issuer_signature === 'object') return row.issuer_signature;
  const snap = row.receipt_snapshot || row.public_receipt;
  if (snap?.issuer_signature && typeof snap.issuer_signature === 'object') return snap.issuer_signature;
  return null;
}

/**
 * Read a stored payload hash. Does not canonicalize and does not sign.
 * @param {object} row book row or receipt
 * @returns {{ class: 'pre_v11'|'v11'|'not_a_receipt'|'missing_payload_hash', task_id: string|null, payload_hash: string|null, payload_version: number|null }}
 */
export function classifyLegacyRow(row) {
  const taskId = row?.task_id ? String(row.task_id) : null;
  const sig = signatureOf(row);
  if (!sig || (!sig.jws && !sig.payload_hash && !sig.canonical_preimage)) {
    return { class: 'not_a_receipt', task_id: taskId, payload_hash: null, payload_version: null };
  }
  const decoded = decodeJwsPayload(sig.jws);
  const versionRaw = sig.payload_version ?? decoded?.payload_version;
  const version = versionRaw == null || versionRaw === '' ? null : Number(versionRaw);
  const hasRoot = !!(decoded && decoded.issuer_root) || !!(sig.issuer_root);
  if (hasRoot || (version != null && Number.isFinite(version) && version >= 11)) {
    return { class: 'v11', task_id: taskId, payload_hash: null, payload_version: version };
  }
  let hash = normalizePayloadHash(sig.payload_hash) || normalizePayloadHash(decoded?.payload_hash);
  if (!hash && typeof sig.canonical_preimage === 'string') {
    hash = crypto.createHash('sha256').update(sig.canonical_preimage, 'utf8').digest('hex');
  }
  if (!hash) {
    return { class: 'missing_payload_hash', task_id: taskId, payload_hash: null, payload_version: version };
  }
  return { class: 'pre_v11', task_id: taskId, payload_hash: hash, payload_version: version };
}

/**
 * Split book rows. `missing` is non-empty when a pre-v11 receipt has no
 * stored payload_hash. The caller must not emit an artifact in that case.
 * @param {object[]} rows
 */
export function enumerateLegacyReceipts(rows) {
  const included = [];
  const missing = [];
  const skippedV11 = [];
  for (const row of rows || []) {
    const found = classifyLegacyRow(row);
    if (found.class === 'not_a_receipt') continue;
    if (found.class === 'v11') {
      skippedV11.push(found.task_id);
      continue;
    }
    if (found.class === 'missing_payload_hash') {
      missing.push(found.task_id);
      continue;
    }
    included.push({
      task_id: found.task_id,
      payload_hash: found.payload_hash,
      payload_version: found.payload_version,
    });
  }
  return { included, missing, skippedV11 };
}

/**
 * Build the JSON artifact. Throws if any pre-v11 receipt lacks a stored hash.
 * Does not sign and does not write.
 * @param {object[]} rows
 */
export function buildLegacyReceiptSet(rows) {
  const { included, missing, skippedV11 } = enumerateLegacyReceipts(rows);
  if (missing.length) {
    const error = new Error(`legacy set incomplete: ${missing.length} pre-v11 receipt(s) have no stored payload_hash`);
    error.code = 'legacy_set_incomplete';
    error.task_ids = missing;
    throw error;
  }
  const sorted = included
    .map((row, order) => ({ ...row, order }))
    .sort((a, b) => (a.payload_hash < b.payload_hash ? -1 : a.payload_hash > b.payload_hash ? 1 : a.order - b.order));
  const hashes = sorted.map((row) => row.payload_hash);
  const root = legacyRootHex(hashes);
  return {
    schema: LEGACY_SET_SCHEMA,
    universe_id: legacyUniverseId(),
    universe: legacyUniverseBody(),
    predicate: legacyPredicateDocument(),
    enumerated_count: sorted.length,
    root,
    hash_alg: 'sha256',
    leaf_rule: LEGACY_LEAF_RULE,
    node_rule: LEGACY_NODE_RULE,
    sort: LEGACY_SORT_RULE,
    odd: LEGACY_ODD_RULE,
    empty_root: `0x${emptyLegacyRoot().toString('hex')}`,
    skipped_v11_count: skippedV11.length,
    leaves: sorted.map((row, index) => ({
      index,
      task_id: row.task_id,
      payload_hash: row.payload_hash,
      payload_version: row.payload_version,
    })),
  };
}

/**
 * Proof object for one task id in an artifact, or null when it is not a leaf.
 * @param {object} artifact
 * @param {string} taskId
 */
export function legacyProofFromArtifact(artifact, taskId) {
  if (!artifact || !Array.isArray(artifact.leaves)) return null;
  const needle = String(taskId || '');
  const aliases = new Set([needle]);
  if (needle.startsWith('chit-')) aliases.add(`xfuel-${needle.slice(5)}`);
  if (needle.startsWith('xfuel-')) aliases.add(`chit-${needle.slice(6)}`);
  const leaf = artifact.leaves.find((row) => aliases.has(String(row.task_id)));
  if (!leaf) return null;
  const hashes = artifact.leaves.map((row) => row.payload_hash);
  const proof = legacyInclusionProof(hashes, leaf.index);
  if (!proof) return null;
  return {
    schema: 'chit402.legacy_proof.v1',
    task_id: leaf.task_id,
    payload_hash: leaf.payload_hash,
    index: leaf.index,
    enumerated_count: artifact.enumerated_count,
    root: artifact.root,
    universe_id: artifact.universe_id,
    leaf: legacyLeaf(leaf.payload_hash).toString('hex'),
    proof,
    tree: {
      leaf: LEGACY_LEAF_RULE,
      node: LEGACY_NODE_RULE,
      sort: LEGACY_SORT_RULE,
      odd: LEGACY_ODD_RULE,
    },
  };
}
