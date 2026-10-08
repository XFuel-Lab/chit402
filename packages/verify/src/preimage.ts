/**
 * Recompute published receipt preimages.
 * A missing or mismatched preimage fails closed when the caller requires it,
 * and whenever a `preimages` block is present.
 */
import { createHash } from 'node:crypto';
import { keccak256 } from 'ethers';
import { inclusionRoot } from './anchor-witness.js';
import { boundRowHash } from './row-hash.js';

export interface PreimageLeaf {
  preimage_utf8?: string;
  preimage_hex?: string;
}

export interface AuditSibling {
  hash?: string;
  /** Ignored. Index and tree size choose the side. */
  position?: string;
}

export interface AuditPath {
  index?: number;
  tree_size?: number;
  siblings?: AuditSibling[];
  root?: string;
}

export interface PreimageEntry {
  field?: string;
  alg?: string;
  recomputable?: boolean;
  preimage_utf8?: string;
  preimage_hex?: string;
  hash?: string;
  merkle?: string;
  /** Old public shape: every leaf body in the prefix. Still accepted. */
  leaves?: PreimageLeaf[];
  /** This receipt's leaf body. Other leaves are not on this object. */
  leaf?: PreimageLeaf & { index?: number; task_id?: string; kind?: string };
  audit_path?: AuditPath;
  url?: string;
}

export interface PreimageBlock {
  schema?: string;
  fields?: Record<string, PreimageEntry>;
  not_recomputable?: { field?: string; hash?: string | null; reason?: string }[];
  links?: { preimage?: string };
}

export interface PreimageCheck {
  checked: boolean;
  ok: boolean;
  errors: string[];
  fields: { field: string; ok: boolean; reason?: string }[];
}

const ALWAYS_REQUIRED = [
  'row_hash',
  'book_chain.row_hash',
  'book_row.row_hash',
  'inclusion.leaf',
  'binding.expected_commitment',
  'job_spec_hash',
  'response_hash',
];

function sha256(buf: Buffer): Buffer {
  return createHash('sha256').update(buf).digest();
}

function bytesOf(entry: { preimage_utf8?: string; preimage_hex?: string } | null | undefined): Buffer | null {
  if (!entry) return null;
  if (typeof entry.preimage_hex === 'string' && entry.preimage_hex !== '') {
    const hex = entry.preimage_hex.replace(/^0x/, '');
    if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2) return null;
    return Buffer.from(hex, 'hex');
  }
  if (typeof entry.preimage_utf8 === 'string') return Buffer.from(entry.preimage_utf8, 'utf8');
  return null;
}

function leafInput(leaf: PreimageLeaf): Buffer | null {
  if (typeof leaf.preimage_hex === 'string' && leaf.preimage_hex !== '') {
    return bytesOf(leaf);
  }
  if (typeof leaf.preimage_utf8 === 'string') {
    return Buffer.concat([Buffer.from([0x00]), Buffer.from(leaf.preimage_utf8, 'utf8')]);
  }
  return null;
}

function merkleRoot(leaves: PreimageLeaf[]): string | null {
  const level: Buffer[] = [];
  for (const leaf of leaves) {
    const input = leafInput(leaf);
    if (!input) return null;
    level.push(sha256(input));
  }
  if (!level.length) return null;
  let nodes = level;
  while (nodes.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < nodes.length; i += 2) {
      if (i + 1 === nodes.length) next.push(nodes[i]);
      else next.push(sha256(Buffer.concat([Buffer.from([0x01]), nodes[i], nodes[i + 1]])));
    }
    nodes = next;
  }
  return nodes[0].toString('hex');
}

function hasAuditPath(entry: PreimageEntry): boolean {
  return !!entry.audit_path && !!entry.leaf && Array.isArray(entry.audit_path.siblings);
}

/** The audit path folds to this receipt's leaf. A different leaf in the same prefix is not this receipt. */
export const LEAF_NOT_BOUND = 'leaf_not_bound';

function receiptTaskId(receipt: Record<string, unknown>): string {
  return receipt.task_id == null || receipt.task_id === '' ? '' : String(receipt.task_id);
}

/**
 * The row hash the leaf must name. `boundRowHash` agrees top-level
 * `row_hash`, `book_chain.row_hash`, and `inclusion.row_hash`. Null and `''`
 * are missing: do not hash `task_id|`. A disagreement is missing here too.
 */
function agreedRowHash(receipt: Record<string, unknown>): string | null {
  const inclusion = receipt.inclusion;
  const extra = inclusion && typeof inclusion === 'object'
    ? inclusion as { row_hash?: string | null }
    : null;
  const bound = boundRowHash(
    receipt as { row_hash?: string | null; book_chain?: { row_hash?: string | null } | null },
    extra,
  );
  if (!bound.ok || bound.row == null || bound.row === '') return null;
  return bound.row;
}

function decodeHexBytes(value: string): Buffer | null {
  const hex = value.replace(/^0x/, '');
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  return Buffer.from(hex, 'hex');
}

function unknownPreimageKey(leaf: object): boolean {
  return Object.keys(leaf).some((key) => key.startsWith('preimage_') && key !== 'preimage_utf8' && key !== 'preimage_hex');
}

/**
 * One leaf body, in bytes. `preimage_utf8` is that body. `preimage_hex` is
 * either the same body or `0x00 || body` (the hash input). A leading `0x00`
 * is the domain byte; a body that itself starts with `0x00` is ambiguous.
 * Two encodings must name the same body. Any other encoding is rejected.
 */
function canonicalMerkleBody(leaf: PreimageLeaf): Buffer | null {
  if (!leaf || typeof leaf !== 'object' || unknownPreimageKey(leaf)) return null;
  const utf8Present = typeof leaf.preimage_utf8 === 'string';
  const hexPresent = typeof leaf.preimage_hex === 'string' && leaf.preimage_hex !== '';
  if (!utf8Present && !hexPresent) return null;
  if (utf8Present && leaf.preimage_utf8 === '') return null;
  const utf8Body = utf8Present ? Buffer.from(leaf.preimage_utf8 as string, 'utf8') : null;
  let hexBody: Buffer | null = null;
  if (hexPresent) {
    const raw = decodeHexBytes(leaf.preimage_hex as string);
    if (!raw || raw.length === 0) return null;
    if (raw[0] === 0x00) {
      if (raw.length < 2 || raw[1] === 0x00) return null;
      hexBody = raw.subarray(1);
    } else {
      hexBody = raw;
    }
  }
  if (utf8Body && hexBody && !utf8Body.equals(hexBody)) return null;
  return utf8Body ?? hexBody;
}

/** SHA-256 input for an audit-path leaf: `0x00 ||` the canonical body. */
function auditLeafHashInput(leaf: PreimageLeaf): Buffer | null {
  const body = canonicalMerkleBody(leaf);
  if (!body) return null;
  return Buffer.concat([Buffer.from([0x00]), body]);
}

/**
 * Bind an audit path to this receipt. Returns `leaf_not_bound` when any
 * check fails, including when the agreed row hash is null, empty, or
 * disagreed, or the leaf encoding does not canonicalize to `task_id|row_hash`.
 * Inclusion leaf hash and leaf index are checked only when that field is present.
 * Inclusion tree size is not compared: the witness can cover a longer log.
 */
export function auditLeafBinding(receipt: Record<string, unknown>, entry: PreimageEntry): string | null {
  const leaf = entry.leaf;
  const path = entry.audit_path;
  if (!leaf || !path) return LEAF_NOT_BOUND;
  const taskId = receiptTaskId(receipt);
  if (!taskId || leaf.task_id == null || String(leaf.task_id) !== taskId) return LEAF_NOT_BOUND;
  const rowHash = agreedRowHash(receipt);
  const body = canonicalMerkleBody(leaf);
  if (rowHash == null || !body) return LEAF_NOT_BOUND;
  const expected = Buffer.from(`${taskId}|${rowHash}`, 'utf8');
  if (!body.equals(expected)) return LEAF_NOT_BOUND;
  const inclusion = receipt.inclusion;
  if (inclusion && typeof inclusion === 'object') {
    const claimedLeaf = (inclusion as { leaf?: unknown }).leaf;
    if (claimedLeaf != null && claimedLeaf !== '') {
      const input = auditLeafHashInput(leaf);
      if (!input) return LEAF_NOT_BOUND;
      const hashed = sha256(input).toString('hex');
      const want = String(claimedLeaf).replace(/^0x/, '').toLowerCase();
      if (hashed !== want) return LEAF_NOT_BOUND;
    }
    const claimedIndex = (inclusion as { leaf_index?: unknown }).leaf_index;
    if (claimedIndex != null && claimedIndex !== '') {
      const want = Number(claimedIndex);
      const got = Number(path.index);
      if (!Number.isSafeInteger(want) || got !== want) return LEAF_NOT_BOUND;
    }
  }
  return null;
}

/**
 * Recompute the prefix root from this leaf and the sibling hashes.
 * A full `leaves` array is the pre-redaction shape and is not read here.
 */
function auditRoot(entry: PreimageEntry): string | null {
  const path = entry.audit_path;
  const leaf = entry.leaf;
  if (!path || !leaf || !Array.isArray(path.siblings)) return null;
  const index = Number(path.index);
  const treeSize = Number(path.tree_size);
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(treeSize)) return null;
  if (leaf.index != null && Number(leaf.index) !== index) return null;
  const input = auditLeafHashInput(leaf);
  if (!input) return null;
  const got = inclusionRoot(
    sha256(input),
    index,
    treeSize,
    path.siblings.map((step) => ({ hash: String(step?.hash || '') })),
  );
  if (!got) return null;
  if (path.root != null && path.root !== '') {
    const claimed = String(path.root).replace(/^0x/, '').toLowerCase();
    if (claimed !== got) return null;
  }
  return got;
}

function digestHex(entry: PreimageEntry): string | null {
  if (hasAuditPath(entry)) return auditRoot(entry);
  if (entry.merkle === 'rfc6962' && Array.isArray(entry.leaves) && entry.leaves.length > 0) {
    return merkleRoot(entry.leaves);
  }
  const bytes = bytesOf(entry);
  if (!bytes) return null;
  if (entry.alg === 'keccak256') return keccak256(bytes).toLowerCase();
  if (entry.alg === 'sha256') {
    const hex = sha256(bytes).toString('hex');
    const published = String(entry.hash || '');
    if (published.startsWith('0x') || published.startsWith('sha256:')) return `0x${hex}`;
    return hex;
  }
  return null;
}

function sameHash(left: string, right: string): boolean {
  const norm = (value: string) => value.trim().toLowerCase().replace(/^sha256=/, '');
  return norm(left) === norm(right);
}

function readPath(receipt: Record<string, unknown>, field: string): unknown {
  if (field === 'job_spec_hash') {
    return receipt.job_spec_hash
      ?? (receipt.board as { job_spec_hash?: unknown } | undefined)?.job_spec_hash
      ?? (receipt.a2a_escrow as { job_spec_hash?: unknown } | undefined)?.job_spec_hash
      ?? null;
  }
  return field.split('.').reduce<unknown>((obj, key) => {
    if (obj == null || typeof obj !== 'object') return undefined;
    return (obj as Record<string, unknown>)[key];
  }, receipt);
}

function hasHash(value: unknown): boolean {
  return value != null && value !== '';
}

function withheld(block: PreimageBlock | null, field: string): boolean {
  return (block?.not_recomputable || []).some((row) => row.field === field);
}

/**
 * Fields a stranger is expected to recompute when they are present.
 * Coverage and tree_head_hash count only when the issuer published a preimage.
 * Output, HMAC, and book-row universe hashes do not.
 */
export function requiredPreimageFields(receipt: Record<string, unknown>): string[] {
  const block = (receipt.preimages || null) as PreimageBlock | null;
  const fields: string[] = [];
  for (const field of ALWAYS_REQUIRED) {
    if (hasHash(readPath(receipt, field)) && !withheld(block, field)) fields.push(field);
  }
  for (const field of ['tree_head_hash', 'coverage.universe_hash', 'coverage.enumerated_hash']) {
    if (block?.fields?.[field]) fields.push(field);
  }
  return [...new Set(fields)];
}

async function loadRemote(entry: PreimageEntry, fetchImpl: typeof fetch, hosts: readonly string[]): Promise<PreimageEntry | null> {
  if (!entry.url) return null;
  let url: URL;
  try {
    url = new URL(entry.url);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !hosts.some((host) => host.toLowerCase() === url.hostname.toLowerCase())) {
    return null;
  }
  const res = await fetchImpl(entry.url);
  if (!res.ok) return null;
  const body = await res.json() as PreimageEntry;
  return body && typeof body === 'object' ? { ...entry, ...body } : null;
}

export async function verifyPublishedPreimages(
  receipt: Record<string, unknown>,
  {
    requirePreimages = false,
    fetchImpl = globalThis.fetch,
    trustedHosts = ['api.chit402.com'],
  }: {
    requirePreimages?: boolean;
    fetchImpl?: typeof fetch;
    trustedHosts?: readonly string[];
  } = {},
): Promise<PreimageCheck> {
  const block = (receipt.preimages || null) as PreimageBlock | null;
  const required = requiredPreimageFields(receipt);
  if (!block && !requirePreimages) {
    return { checked: false, ok: true, errors: [], fields: [] };
  }
  if (!block && required.length === 0) {
    return { checked: true, ok: true, errors: [], fields: [] };
  }
  const errors: string[] = [];
  const fields: PreimageCheck['fields'] = [];
  const published = block?.fields || {};
  const targets = new Set<string>([...required, ...Object.keys(published)]);
  for (const field of targets) {
    if (withheld(block, field) && !published[field]) continue;
    let entry = published[field];
    if (!entry) {
      const message = `preimage missing for ${field}`;
      errors.push(message);
      fields.push({ field, ok: false, reason: 'preimage_missing' });
      continue;
    }
    if (entry.recomputable === false) continue;
    if (hasAuditPath(entry)) {
      const bound = auditLeafBinding(receipt, entry);
      if (bound) {
        errors.push(`preimage leaf is not this receipt for ${field}`);
        fields.push({ field, ok: false, reason: bound });
        continue;
      }
    }
    if (!bytesOf(entry) && !(entry.leaves && entry.leaves.length) && !hasAuditPath(entry) && entry.url && fetchImpl) {
      try {
        const remote = await loadRemote(entry, fetchImpl, trustedHosts);
        if (remote) entry = remote;
      } catch {
        /* fall through to missing */
      }
    }
    const digest = digestHex(entry);
    const expected = entry.hash != null ? String(entry.hash) : '';
    const onReceipt = readPath(receipt, field);
    if (digest == null) {
      errors.push(`preimage missing for ${field}`);
      fields.push({ field, ok: false, reason: 'preimage_missing' });
      continue;
    }
    if (!sameHash(digest, expected)) {
      errors.push(`preimage mismatch for ${field}: hash does not match the published bytes`);
      fields.push({ field, ok: false, reason: 'preimage_mismatch' });
      continue;
    }
    if (hasHash(onReceipt) && !sameHash(digest, String(onReceipt))) {
      errors.push(`preimage mismatch for ${field}: recomputed hash does not match the receipt`);
      fields.push({ field, ok: false, reason: 'preimage_mismatch' });
      continue;
    }
    fields.push({ field, ok: true });
  }
  return { checked: true, ok: errors.length === 0, errors, fields };
}
