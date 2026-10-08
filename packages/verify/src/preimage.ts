/**
 * Recompute published receipt preimages.
 * A missing or mismatched preimage fails closed when the caller requires it,
 * and whenever a `preimages` block is present.
 */
import { createHash } from 'node:crypto';
import { keccak256 } from 'ethers';

export interface PreimageLeaf {
  preimage_utf8?: string;
  preimage_hex?: string;
}

export interface PreimageEntry {
  field?: string;
  alg?: string;
  recomputable?: boolean;
  preimage_utf8?: string;
  preimage_hex?: string;
  hash?: string;
  merkle?: string;
  leaves?: PreimageLeaf[];
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

function digestHex(entry: PreimageEntry): string | null {
  if (entry.merkle === 'rfc6962' && Array.isArray(entry.leaves)) {
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
    if (!bytesOf(entry) && !(entry.leaves && entry.leaves.length) && entry.url && fetchImpl) {
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
