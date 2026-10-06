/**
 * Epoch links for the receipt log.
 *
 * A version 1 head has no epoch claims and still verifies.
 * Epoch 1 inclusion proofs stay valid on their own root.
 * A later epoch must name the previous epoch's root and size.
 */
import { leafHash, verifyMerkleInclusion, type InclusionStep } from './anchor-witness.js';

export const TREE_HEAD_SCHEMA_V1 = 'chit402.tree_head.v1';
export const TREE_HEAD_SCHEMA_V2 = 'chit402.tree_head.v2';

export interface EpochTreeHead {
  schema?: string;
  payload_version?: number;
  epoch?: number | null;
  root?: string | null;
  tree_size?: number | null;
  prev_epoch_root?: string | null;
  prev_epoch_size?: number | null;
  prev_root?: string | null;
  bundle_index_hash?: string | null;
}

export interface EpochRecordEntry {
  epoch: number;
  status?: string;
  final_root?: string | null;
  final_size?: number | null;
  opening_root?: string | null;
  opening_size?: number | null;
  prev_epoch_root?: string | null;
  prev_epoch_size?: number | null;
}

export interface EpochRecord {
  schema?: string;
  epochs?: EpochRecordEntry[];
  orphans?: unknown[];
}

export function acceptTreeHeadSchema(head: EpochTreeHead | null | undefined): { ok: boolean; reason?: string } {
  if (!head || typeof head !== 'object') return { ok: false, reason: 'no_head' };
  const schema = head.schema;
  const version = head.payload_version;
  if (schema == null && version == null) return { ok: true };
  if (schema === TREE_HEAD_SCHEMA_V1 || schema === TREE_HEAD_SCHEMA_V2 || schema == null) {
    if (version == null || version === 1 || version === 2) return { ok: true };
  }
  return { ok: false, reason: 'unknown_head_schema' };
}

/**
 * Epoch 1 (and a head with no epoch, the v1 shape) has no predecessor.
 * A later epoch must point at the previous epoch's root and size.
 */
export function verifyEpochLink(
  head: EpochTreeHead | null | undefined,
  previous?: { root?: string | null; tree_size?: number | null } | null,
): { ok: boolean; reason?: string } {
  const schema = acceptTreeHeadSchema(head);
  if (!schema.ok) return schema;
  const epoch = head?.epoch == null ? 1 : Number(head.epoch);
  if (!Number.isInteger(epoch) || epoch < 1) return { ok: false, reason: 'bad_epoch' };
  if (epoch === 1) {
    if (head?.prev_epoch_root) return { ok: false, reason: 'epoch1_has_prev' };
    return { ok: true };
  }
  if (!previous?.root) return { ok: false, reason: 'missing_previous_epoch' };
  if (head?.prev_epoch_root !== previous.root) return { ok: false, reason: 'prev_epoch_root' };
  if (Number(head?.prev_epoch_size) !== Number(previous.tree_size)) return { ok: false, reason: 'prev_epoch_size' };
  return { ok: true };
}

export function verifyEpochRecord(record: EpochRecord | null | undefined): { ok: boolean; reason?: string } {
  const epochs = record?.epochs;
  if (!Array.isArray(epochs) || epochs.length === 0) return { ok: false, reason: 'no_epochs' };
  for (let i = 0; i < epochs.length; i += 1) {
    const row = epochs[i];
    if (Number(row.epoch) !== i + 1) return { ok: false, reason: 'epoch_index' };
    if (i === 0) {
      if (row.prev_epoch_root != null) return { ok: false, reason: 'epoch1_has_prev' };
      if (Number(row.prev_epoch_size || 0) !== 0) return { ok: false, reason: 'epoch1_size' };
      continue;
    }
    const prev = epochs[i - 1];
    const prevRoot = prev.final_root || prev.opening_root;
    const prevSize = prev.final_size ?? prev.opening_size;
    if (row.prev_epoch_root !== prevRoot) return { ok: false, reason: 'prev_epoch_root' };
    if (Number(row.prev_epoch_size) !== Number(prevSize)) return { ok: false, reason: 'prev_epoch_size' };
  }
  if (record && !Array.isArray(record.orphans)) return { ok: false, reason: 'orphans_missing' };
  return { ok: true };
}

/**
 * Inclusion against the epoch the proof names. Epoch 1 proofs with no epoch
 * field stay valid. A later epoch also has to link to the previous epoch.
 */
export function verifyEpochInclusion(input: {
  leaf?: Uint8Array | null;
  taskId?: string | null;
  rowHash?: string | null;
  index: number;
  treeSize: number;
  root: string;
  proof: InclusionStep[];
  epoch?: number | null;
  prevEpochRoot?: string | null;
  prevEpochSize?: number | null;
  previous?: { root?: string | null; tree_size?: number | null } | null;
}): { ok: boolean; reason?: string } {
  let leaf: Uint8Array | null = input.leaf ? new Uint8Array(input.leaf) : null;
  if (!leaf && input.taskId) {
    leaf = leafHash(Buffer.from(`${input.taskId}|${input.rowHash || ''}`));
  }
  if (!leaf) return { ok: false, reason: 'no_leaf' };
  const included = verifyMerkleInclusion(Buffer.from(leaf), input.index, input.treeSize, input.root, input.proof);
  if (!included) return { ok: false, reason: 'inclusion_failed' };
  const epoch = input.epoch == null ? 1 : Number(input.epoch);
  if (epoch === 1) return { ok: true };
  return verifyEpochLink({
    schema: TREE_HEAD_SCHEMA_V2,
    payload_version: 2,
    epoch,
    prev_epoch_root: input.prevEpochRoot,
    prev_epoch_size: input.prevEpochSize,
  }, input.previous);
}
