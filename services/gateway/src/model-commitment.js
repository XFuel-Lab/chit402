/**
 * PoMA — Proof of Model Authenticity: commitment tool + resolver (Phase 1).
 *
 * Two jobs:
 *   1. Offline: turn the exact weight shards a provider serves into a deterministic
 *      `commitment` (a keccak256 Merkle root) + `modelId`, ready to `registerModel(...)`
 *      on the on-chain `ModelRegistry` (contracts/core/ModelRegistry.sol).
 *   2. Runtime: resolve a served model slug/id → its registered commitment so the gateway
 *      can stamp `model_commitment` onto the receipt (anti-downgrade wedge).
 *
 * Commitment scheme (KECCAK_MERKLE, scheme id 0) — see docs/POMA_SPEC.md:
 *   - Canonical slug  : "<arch-or-family>:<quant>" lowercased, e.g. "llama-3-70b:q4_k_m"
 *   - modelId         : keccak256(utf8(canonicalSlug))
 *   - leaf(i)         : keccak256( 0x00 || shardBytes(i) )        (ordered by shard index)
 *   - node(l, r)      : keccak256( 0x01 || l || r )               (domain-separated)
 *   - odd node        : promoted (carried up) unchanged
 *   - commitment      : Merkle root over ordered leaves (single shard → its leaf)
 *
 * Domain-separation bytes (0x00 leaf / 0x01 node) prevent second-preimage/leaf-node
 * confusion. The exact same scheme is what the ZK tier will later prove against; the
 * MLE_POLY scheme (id 1) is the documented upgrade path and NOT computed here.
 */

import fs from 'fs';
import path from 'path';
import { keccak256, toUtf8Bytes, concat, getBytes } from 'ethers';

const LEAF_PREFIX = '0x00';
const NODE_PREFIX = '0x01';

/** keccak256 of the domain-separated leaf for a shard buffer. */
export function shardLeaf(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : getBytes(buffer);
  return keccak256(concat([LEAF_PREFIX, bytes]));
}

/** Combine two child hashes into a domain-separated parent. */
function hashPair(left, right) {
  return keccak256(concat([NODE_PREFIX, left, right]));
}

/**
 * Merkle root over ordered leaves. Odd nodes at any level are promoted unchanged.
 * @param {string[]} leaves 0x-hex keccak leaves, in shard order.
 * @returns {string} 0x-hex root (or ZeroHash for empty input).
 */
export function merkleRoot(leaves) {
  if (!leaves || leaves.length === 0) return '0x' + '0'.repeat(64);
  let level = leaves.slice();
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        next.push(hashPair(level[i], level[i + 1]));
      } else {
        next.push(level[i]); // promote odd tail
      }
    }
    level = next;
  }
  return level[0];
}

/** Canonical model slug → stable modelId (keccak256 of the lowercased slug). */
export function modelIdFromSlug(slug) {
  return keccak256(toUtf8Bytes(String(slug).trim().toLowerCase()));
}

/**
 * Compute a model commitment from in-memory shard buffers.
 * @param {object} p
 * @param {Buffer[]|Uint8Array[]} p.shards  Ordered weight shard buffers.
 * @param {string} p.slug                   Canonical slug ("<family>:<quant>").
 * @param {string} [p.arch]
 * @param {string} [p.quant]
 * @returns {{ modelId, commitment, scheme, slug, arch, quant, shardCount, leaves }}
 */
export function computeModelCommitment({ shards, slug, arch = '', quant = '' }) {
  if (!Array.isArray(shards) || shards.length === 0) {
    throw new Error('computeModelCommitment: at least one shard buffer is required');
  }
  const leaves = shards.map(shardLeaf);
  return {
    modelId: modelIdFromSlug(slug),
    commitment: merkleRoot(leaves),
    scheme: 0, // KECCAK_MERKLE
    slug: String(slug).trim().toLowerCase(),
    arch,
    quant,
    shardCount: shards.length,
    leaves,
  };
}

/**
 * Compute a model commitment from files on disk (weight shards).
 * @param {object} p
 * @param {string[]} p.files  Ordered shard file paths (order is significant).
 * @param {string} p.slug
 * @param {string} [p.arch]
 * @param {string} [p.quant]
 * @returns {object} Same shape as computeModelCommitment + per-shard file/size/leaf manifest.
 */
export function computeCommitmentFromFiles({ files, slug, arch = '', quant = '' }) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('computeCommitmentFromFiles: provide at least one shard file');
  }
  const manifest = [];
  const leaves = [];
  for (const f of files) {
    const buf = fs.readFileSync(f);
    const leaf = shardLeaf(buf);
    leaves.push(leaf);
    manifest.push({ file: path.basename(f), bytes: buf.length, leaf });
  }
  return {
    modelId: modelIdFromSlug(slug),
    commitment: merkleRoot(leaves),
    scheme: 0,
    slug: String(slug).trim().toLowerCase(),
    arch,
    quant,
    shardCount: files.length,
    shards: manifest,
  };
}

// ─── Runtime resolver ────────────────────────────────────────────────────────

let _registryCache = null;

/**
 * Load the local model→commitment map used at serving time. Sources, in order:
 *   - MODEL_COMMITMENTS  : inline JSON, either { "<slug>": "<commitment>" } or
 *                          { "<slug>": { commitment, version, modelId, arch, quant } }
 *   - MODEL_REGISTRY_FILE: path to a JSON file with the same shape.
 * Returns {} when nothing is configured (PoMA off → receipts carry null commitment).
 */
export function loadModelRegistryConfig({ force = false } = {}) {
  if (_registryCache && !force) return _registryCache;
  let raw = {};
  const inline = process.env.MODEL_COMMITMENTS;
  const file = process.env.MODEL_REGISTRY_FILE;
  try {
    if (inline && inline.trim()) {
      raw = JSON.parse(inline);
    } else if (file && fs.existsSync(file)) {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch {
    raw = {};
  }
  const norm = {};
  for (const [key, val] of Object.entries(raw)) {
    const slug = key.trim().toLowerCase();
    const entry = typeof val === 'string' ? { commitment: val } : { ...val };
    entry.commitment = entry.commitment || null;
    entry.modelId = entry.modelId || modelIdFromSlug(slug);
    entry.version = entry.version ?? null;
    norm[slug] = entry;
  }
  _registryCache = norm;
  return norm;
}

/** Test/hot-reload helper. */
export function clearModelRegistryCache() {
  _registryCache = null;
}

/**
 * Resolve a served model to its registered PoMA commitment for the receipt.
 * Accepts a model slug ("llama-3-70b:q4_k_m") or a plain model id ("llama-3-70b").
 * @param {string} model
 * @returns {{ modelId, commitment, version, scheme, arch, quant } | null}
 */
export function resolveModelCommitment(model) {
  if (!model || typeof model !== 'string') return null;
  const cfg = loadModelRegistryConfig();
  const key = model.trim().toLowerCase();
  const entry = cfg[key];
  if (!entry || !entry.commitment) return null;
  return {
    modelId: entry.modelId,
    commitment: entry.commitment,
    version: entry.version ?? null,
    scheme: entry.scheme ?? 0,
    arch: entry.arch ?? null,
    quant: entry.quant ?? null,
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────
// Usage: node src/model-commitment.js --slug "llama-3-70b:q4_k_m" [--arch llama-3] [--quant q4_k_m] shard1 shard2 ...
function runCli(argv) {
  const args = argv.slice(2);
  const opts = { files: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--slug') opts.slug = args[++i];
    else if (a === '--arch') opts.arch = args[++i];
    else if (a === '--quant') opts.quant = args[++i];
    else opts.files.push(a);
  }
  if (!opts.slug || opts.files.length === 0) {
    console.error('Usage: node model-commitment.js --slug "<family>:<quant>" [--arch A] [--quant Q] <shard...>');
    process.exit(2);
  }
  const result = computeCommitmentFromFiles({
    files: opts.files,
    slug: opts.slug,
    arch: opts.arch || '',
    quant: opts.quant || '',
  });
  console.log(JSON.stringify(result, null, 2));
}

const isMain = (() => {
  try {
    return process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;
  } catch {
    return false;
  }
})();
if (isMain) runCli(process.argv);

export default {
  shardLeaf,
  merkleRoot,
  modelIdFromSlug,
  computeModelCommitment,
  computeCommitmentFromFiles,
  loadModelRegistryConfig,
  clearModelRegistryCache,
  resolveModelCommitment,
};
