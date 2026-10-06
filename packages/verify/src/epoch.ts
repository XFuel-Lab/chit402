/**
 * Epoch links for the receipt log.
 *
 * A version 1 head has no epoch claims and still verifies.
 * Epoch 1 inclusion proofs stay valid on their own root.
 * A later epoch must name the previous epoch's root and size.
 */
import { createHash } from 'node:crypto';
import { leafHash, verifyMerkleInclusion, type InclusionStep } from './anchor-witness.js';

export const TREE_HEAD_SCHEMA_V1 = 'chit402.tree_head.v1';
export const TREE_HEAD_SCHEMA_V2 = 'chit402.tree_head.v2';

/** Historical epoch 1. A self-consistent record with any other final root is forged. */
export const EPOCH1_GENESIS_DIGEST = '422cceb1be77114317043b0a00bc18cba6ca9cee34144cd23875c6dcf1b47368';
export const EPOCH1_FINAL_ROOT = 'dd20e39a39a225b7b3441bb7f61532c06562288b74ae5dc4dda015c48312f973';
export const EPOCH1_FINAL_SIZE = 4;
/** SHA-256(0x00 || genesis bytes of digest 422cceb1). Single-leaf root. */
export const EPOCH1_SIZE1_ROOT = '8665a0fcb74c2cfeca3a356efe18fe878cf94c21cd38da6b19a2bb57629bc35c';
/** Anchored size-2 head. The v9 tree_head_hash on xfuel-39af100b. */
export const EPOCH1_SIZE2_ROOT = 'ecf9a330a9e82d45e0887807261276fad2fbfb394189bb8f7f35b0e9163c70ae';
export const EPOCH2_OPENING_ROOT = 'f2043ee96b6e9f678b76bb3c512b5d911293dbb2a3bf198c98252c83802f3286';

/** Size 3 has no anchored head and the leaf preimages are not in this repo. */
const EPOCH1_PREFIX_ROOTS: Record<number, string> = {
  1: EPOCH1_SIZE1_ROOT,
  2: EPOCH1_SIZE2_ROOT,
  4: EPOCH1_FINAL_ROOT,
};

export function epoch1PrefixRoot(treeSize: number): string | null {
  return EPOCH1_PREFIX_ROOTS[Number(treeSize)] || null;
}

export function matchEpoch1Prefix(treeSize: number, root: string | null | undefined): { ok: boolean; reason?: string } {
  const want = epoch1PrefixRoot(treeSize);
  const got = String(root || '').replace(/^0x/, '').toLowerCase();
  if (!want || got !== want) return { ok: false, reason: 'epoch1_prefix' };
  return { ok: true };
}

function isGenuineV1Head(head: EpochTreeHead | null | undefined): boolean {
  if (!head) return false;
  if (head.schema === TREE_HEAD_SCHEMA_V2 || Number(head.payload_version) === 2) return false;
  return head.schema === TREE_HEAD_SCHEMA_V1 || Number(head.payload_version) === 1;
}
const ORPHAN_GENESIS_ONLY = '20d887917a4c32a49434e4b8f8db864cbf26a8e3a0daa6f5f89ab097282413f9';

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
  genesis_digest?: string | null;
  final_root?: string | null;
  final_size?: number | null;
}

export interface EpochRecordEntry {
  epoch: number;
  status?: string;
  final_root?: string | null;
  final_size?: number | null;
  opening_root?: string | null;
  opening_size?: number | null;
  genesis_digest?: string | null;
  prev_epoch_root?: string | null;
  prev_epoch_size?: number | null;
}

export interface UnloggedRow {
  task_id: string;
  agent_id: number | null;
  reason: string;
}

export interface UnloggedSection {
  count: number;
  hash: string;
  rows: UnloggedRow[];
}

export interface EpochRecord {
  schema?: string;
  payload_version?: number;
  epochs?: EpochRecordEntry[];
  orphans?: unknown[];
  unlogged?: UnloggedSection | null;
  issuer_signature?: { jws?: string | null } | null;
}

const UNLOGGED_REASONS = new Set(['missing_row_hash', 'forked', 'depends_on_refused']);

export function canonicalUnloggedRows(rows: Array<Partial<UnloggedRow>> | null | undefined): UnloggedRow[] {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    task_id: String(row?.task_id || ''),
    agent_id: row?.agent_id == null || (row.agent_id as unknown) === '' ? null : Number(row.agent_id),
    reason: String(row?.reason || ''),
  }));
}

export function unloggedListHash(rows: UnloggedRow[]): string {
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

export function verifyUnloggedSection(section: UnloggedSection | null | undefined): { ok: boolean; reason?: string } {
  if (!section || !Array.isArray(section.rows)) return { ok: false, reason: 'unlogged_missing' };
  const list = canonicalUnloggedRows(section.rows);
  if (JSON.stringify(list) !== JSON.stringify(section.rows)) return { ok: false, reason: 'unlogged_canonical' };
  for (const row of list) {
    if (!row.task_id) return { ok: false, reason: 'unlogged_task' };
    if (!UNLOGGED_REASONS.has(row.reason)) return { ok: false, reason: 'unlogged_reason' };
  }
  if (Number(section.count) !== list.length) return { ok: false, reason: 'unlogged_count' };
  if (section.hash !== unloggedListHash(list)) return { ok: false, reason: 'unlogged_hash' };
  return { ok: true };
}

/** Reason for a task the issuer attested as outside the tree. Null if the list does not verify. */
export function unloggedReasonForTask(
  record: EpochRecord | null | undefined,
  taskId: string | null | undefined,
): UnloggedRow | null {
  if (Number(record?.payload_version) !== 2) return null;
  const checked = verifyUnloggedSection(record?.unlogged);
  if (!checked.ok || !record?.unlogged) return null;
  const id = String(taskId || '');
  return record.unlogged.rows.find((row) => row.task_id === id) || null;
}

export interface EpochRecordOptions {
  verifySignature?: (jws: string) => boolean;
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
  const explicitEpoch = head?.epoch == null ? null : Number(head.epoch);
  if (explicitEpoch == null) {
    if (!isGenuineV1Head(head)) return { ok: false, reason: 'epoch_missing' };
    if (head?.prev_epoch_root) return { ok: false, reason: 'epoch1_has_prev' };
    return { ok: true };
  }
  const epoch = explicitEpoch;
  if (!Number.isInteger(epoch) || epoch < 1) return { ok: false, reason: 'bad_epoch' };
  if (epoch === 1) {
    if (head?.prev_epoch_root) return { ok: false, reason: 'epoch1_has_prev' };
    const sizeRaw = head?.tree_size ?? head?.final_size;
    const size = sizeRaw == null ? null : Number(sizeRaw);
    const rootRaw = head?.root ?? head?.final_root;
    const root = typeof rootRaw === 'string' ? rootRaw.replace(/^0x/, '').toLowerCase() : '';
    if (size !== EPOCH1_FINAL_SIZE || root !== EPOCH1_FINAL_ROOT) {
      return { ok: false, reason: 'epoch1_root' };
    }
    const recordShape = head?.final_size != null || head?.genesis_digest != null;
    if (recordShape && head?.genesis_digest !== EPOCH1_GENESIS_DIGEST) {
      return { ok: false, reason: 'epoch1_genesis' };
    }
    return { ok: true };
  }
  if (!previous?.root) return { ok: false, reason: 'missing_previous_epoch' };
  if (head?.prev_epoch_root !== previous.root) return { ok: false, reason: 'prev_epoch_root' };
  if (Number(head?.prev_epoch_size) !== Number(previous.tree_size)) return { ok: false, reason: 'prev_epoch_size' };
  return { ok: true };
}

/**
 * Epoch 1 is pinned to dd20e39a, size 4, genesis 422cceb1.
 * A self-consistent chain with another root does not verify.
 * The issuer signature is required. d7f6c548 must be present, root null,
 * and marked unrecoverable.
 */
export function verifyEpochRecord(
  record: EpochRecord | null | undefined,
  options: EpochRecordOptions = {},
): { ok: boolean; reason?: string } {
  const jws = record?.issuer_signature?.jws;
  if (!jws) return { ok: false, reason: 'epoch_signature_missing' };
  if (typeof options.verifySignature !== 'function') {
    return { ok: false, reason: 'epoch_signature_unverified' };
  }
  if (!options.verifySignature(jws)) return { ok: false, reason: 'epoch_signature_invalid' };
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
  if (!Array.isArray(record?.orphans)) return { ok: false, reason: 'orphans_missing' };
  const epoch1 = epochs.find((row) => Number(row.epoch) === 1);
  if (!epoch1) return { ok: false, reason: 'epoch1_missing' };
  if (epoch1.final_root !== EPOCH1_FINAL_ROOT || Number(epoch1.final_size) !== EPOCH1_FINAL_SIZE) {
    return { ok: false, reason: 'epoch1_root' };
  }
  if (epoch1.genesis_digest !== EPOCH1_GENESIS_DIGEST) return { ok: false, reason: 'epoch1_genesis' };
  const epoch2 = epochs.find((row) => Number(row.epoch) === 2);
  if (epoch2) {
    if (epoch2.prev_epoch_root !== EPOCH1_FINAL_ROOT || Number(epoch2.prev_epoch_size) !== EPOCH1_FINAL_SIZE) {
      return { ok: false, reason: 'prev_epoch_root' };
    }
    if (epoch2.opening_root && epoch2.opening_root !== EPOCH2_OPENING_ROOT) {
      return { ok: false, reason: 'epoch2_opening' };
    }
  }
  const orphans = record.orphans as Array<{ root?: string | null; root_prefix?: string; unrecoverable?: boolean }>;
  const lost = orphans.find((row) => row?.root_prefix === 'd7f6c548');
  if (!lost) return { ok: false, reason: 'orphan_d7f6c548_missing' };
  if (lost.root != null) return { ok: false, reason: 'orphan_d7f6c548_root_invented' };
  if (lost.unrecoverable !== true) return { ok: false, reason: 'orphan_d7f6c548_unmarked' };
  if (!orphans.some((row) => row?.root === ORPHAN_GENESIS_ONLY)) return { ok: false, reason: 'orphans_incomplete' };
  if (!orphans.some((row) => row?.root === EPOCH2_OPENING_ROOT)) return { ok: false, reason: 'orphans_incomplete' };
  const version = Number(record.payload_version) || 1;
  if (version === 1) {
    if (record.unlogged != null) return { ok: false, reason: 'unlogged_unexpected' };
  } else if (version === 2) {
    const listed = verifyUnloggedSection(record.unlogged);
    if (!listed.ok) return listed;
  } else {
    return { ok: false, reason: 'epoch_record_version' };
  }
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
  const epoch = input.epoch == null ? 1 : Number(input.epoch);
  if (epoch === 1) {
    const prefix = matchEpoch1Prefix(input.treeSize, input.root);
    if (!prefix.ok) return prefix;
  }
  let leaf: Uint8Array | null = input.leaf ? new Uint8Array(input.leaf) : null;
  if (!leaf && input.taskId) {
    leaf = leafHash(Buffer.from(`${input.taskId}|${input.rowHash || ''}`));
  }
  if (!leaf) return { ok: false, reason: 'no_leaf' };
  const included = verifyMerkleInclusion(Buffer.from(leaf), input.index, input.treeSize, input.root, input.proof);
  if (!included) return { ok: false, reason: 'inclusion_failed' };
  if (epoch === 1) return { ok: true };
  return verifyEpochLink({
    schema: TREE_HEAD_SCHEMA_V2,
    payload_version: 2,
    epoch,
    prev_epoch_root: input.prevEpochRoot,
    prev_epoch_size: input.prevEpochSize,
  }, input.previous);
}
