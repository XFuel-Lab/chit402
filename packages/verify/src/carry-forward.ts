/**
 * A receipt leaf that was included under an earlier epoch head and later
 * included under the current epoch head.
 *
 * The issued time and the issued epoch come from the earlier head's signed
 * claims. The logged time, epoch, and leaf index come from the current
 * head's signed claims and from the inclusion proof that binds that leaf
 * to the current root. Unsigned receipt fields, request fields, and the
 * local clock are not a source for either date.
 *
 * Lockstep with `assessCarryForward` in services/gateway/src/receipt-merkle.js.
 */
import { verifyMerkleInclusion, type InclusionStep } from './anchor-witness.js';
import {
  isEs256PublicJwk,
  isPinnedTrustedJwk,
  readJwsHeader,
  resolvePinnedIssuerJwk,
  verifyIssuerJws,
  type Es256Jwk,
} from './jws.js';

interface Jwks {
  keys?: Es256Jwk[];
}

/** Epoch ids named by the committed receipt-log pin anchors. */
export const PINNED_ANCHOR_EPOCHS = [1, 2] as const;

export const CARRY_FORWARD_STATUS = 'VERIFIED_CARRIED_FORWARD' as const;

export interface CarryHead {
  epoch?: number | null;
  root?: string | null;
  tree_size?: number | null;
  published_at?: string | null;
  issuer_signature?: {
    jws?: string;
    kid?: string;
    issuer_jwk?: Es256Jwk;
  } | null;
}

export interface CarryInclusion {
  error?: string | null;
  leaf?: string | null;
  leaf_index?: number | null;
  tree_size?: number | null;
  proof?: InclusionStep[] | null;
}

export interface CarryForwardInput {
  leaf: Uint8Array;
  oldHead: CarryHead | null | undefined;
  oldInclusion: CarryInclusion | null | undefined;
  currentHead: CarryHead | null | undefined;
  currentInclusions: CarryInclusion[] | null | undefined;
  trustedKids?: readonly string[];
  jwks?: Jwks;
  pinnedEpochs?: readonly number[];
}

export interface CarryForwardView {
  status: typeof CARRY_FORWARD_STATUS;
  issued_at: string;
  issued_epoch: number;
  logged_at: string;
  logged_epoch: number;
  leaf_index: number;
}

export interface CarryForwardSuccess extends CarryForwardView {
  applicable: true;
  ok: true;
}

export interface CarryForwardFailure {
  applicable: true;
  ok: false;
  status: null;
  reason: string;
}

export interface CarryForwardNotApplicable {
  applicable: false;
  ok: true;
  status: null;
}

export type CarryForwardVerdict = CarryForwardSuccess | CarryForwardFailure | CarryForwardNotApplicable;

interface SignedHeadFacts {
  ok: true;
  published_at: string;
  epoch: number;
  root: string;
  tree_size: number;
}

const SIGNED_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function signedTime(value: unknown): string | null {
  if (typeof value !== 'string' || !SIGNED_TIME.test(value)) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return value;
}

function fail(reason: string): CarryForwardFailure {
  return { applicable: true, ok: false, status: null, reason };
}

function jwksCandidates(jwks: Jwks | undefined, kid: string | undefined): Es256Jwk[] {
  const keys = jwks?.keys || [];
  const es256 = keys.filter((key) => isEs256PublicJwk(key) && (key.alg == null || key.alg === 'ES256'));
  if (!kid) return es256;
  return es256.filter((key) => key.kid === kid);
}

function verifyHeadJws(
  head: CarryHead | null | undefined,
  options: { trustedKids?: readonly string[]; jwks?: Jwks },
): { ok: true; payload: Record<string, unknown> } | { ok: false; reason: string } {
  const jws = head?.issuer_signature?.jws;
  if (!jws) return { ok: false, reason: 'epoch_signature_missing' };
  const header = readJwsHeader(jws);
  const kid = header?.kid || head?.issuer_signature?.kid;
  const trustedKids = options.trustedKids ?? [];
  const embedded = resolvePinnedIssuerJwk({ issuer_signature: head?.issuer_signature || undefined });
  const pinned = !!(embedded && isPinnedTrustedJwk(embedded, trustedKids));
  const candidates = jwksCandidates(options.jwks, kid);
  for (const jwk of candidates) {
    const result = verifyIssuerJws(jws, jwk);
    if (result.valid && result.payload) return { ok: true, payload: result.payload };
  }
  if (pinned && embedded) {
    const result = verifyIssuerJws(jws, embedded);
    if (result.valid && result.payload) return { ok: true, payload: result.payload };
  }
  return { ok: false, reason: 'signature_invalid' };
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function hexLeaf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const hex = value.replace(/^0x/i, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}

function readSignedHead(
  head: CarryHead | null | undefined,
  options: { trustedKids?: readonly string[]; jwks?: Jwks },
  pinned: ReadonlySet<number>,
): SignedHeadFacts | CarryForwardFailure {
  const verified = verifyHeadJws(head, options);
  if (!verified.ok) return fail(verified.reason);
  const payload = verified.payload;
  const publishedAt = signedTime(payload.published_at);
  if (!publishedAt) return fail('head_mismatch');
  if (head && Object.prototype.hasOwnProperty.call(head, 'published_at')
    && head.published_at != null
    && head.published_at !== publishedAt) {
    return fail('head_mismatch');
  }
  const epoch = Number(payload.epoch);
  if (!Number.isInteger(epoch) || epoch < 1) return fail('bad_epoch');
  if (!pinned.has(epoch)) return fail('bad_epoch');
  if (head && Object.prototype.hasOwnProperty.call(head, 'epoch')
    && head.epoch != null
    && Number(head.epoch) !== epoch) {
    return fail('head_mismatch');
  }
  const root = typeof payload.root === 'string' ? payload.root.replace(/^0x/i, '').toLowerCase() : '';
  if (!/^[0-9a-f]{64}$/.test(root)) return fail('head_mismatch');
  if (head?.root != null && String(head.root).replace(/^0x/i, '').toLowerCase() !== root) {
    return fail('head_mismatch');
  }
  const treeSize = Number(payload.tree_size);
  if (!Number.isSafeInteger(treeSize) || treeSize < 1) return fail('head_mismatch');
  if (head?.tree_size != null && Number(head.tree_size) !== treeSize) return fail('head_mismatch');
  if (payload.schema != null && head && 'schema' in head && (head as { schema?: string }).schema != null
    && !sameJson(payload.schema, (head as { schema?: string }).schema)) {
    return fail('head_mismatch');
  }
  return { ok: true, published_at: publishedAt, epoch, root, tree_size: treeSize };
}

function inclusionOf(
  leaf: Uint8Array,
  inclusion: CarryInclusion | null | undefined,
  root: string,
  treeSize: number,
): { ok: true; leaf_index: number } | CarryForwardFailure {
  if (!inclusion || inclusion.error === 'not_in_tree') return fail('not_in_tree');
  if (!Array.isArray(inclusion.proof)) return fail('not_in_tree');
  const claimed = hexLeaf(inclusion.leaf);
  const got = Buffer.from(leaf).toString('hex');
  if (claimed && claimed !== got) return fail('tree_head_mismatch');
  if (inclusion.tree_size != null && Number(inclusion.tree_size) !== treeSize) return fail('inclusion_failed');
  const index = Number(inclusion.leaf_index);
  if (!Number.isSafeInteger(index)) return fail('inclusion_failed');
  const proved = verifyMerkleInclusion(Buffer.from(leaf), index, treeSize, root, inclusion.proof);
  if (!proved) return fail('inclusion_failed');
  return { ok: true, leaf_index: index };
}

/**
 * Verify a cross-epoch carry. A pair of heads in the same epoch is not a
 * carry: the caller leaves the receipt result unchanged.
 */
export function verifyCarryForward(input: CarryForwardInput): CarryForwardVerdict {
  const pinned = new Set(input.pinnedEpochs ?? PINNED_ANCHOR_EPOCHS);
  const trust = { trustedKids: input.trustedKids, jwks: input.jwks };
  const oldHead = readSignedHead(input.oldHead, trust, pinned);
  if (!('published_at' in oldHead)) return oldHead;
  const currentHead = readSignedHead(input.currentHead, trust, pinned);
  if (!('published_at' in currentHead)) return currentHead;
  if (oldHead.epoch === currentHead.epoch) {
    return { applicable: false, ok: true, status: null };
  }
  if (currentHead.epoch < oldHead.epoch) return fail('head_mismatch');
  const oldMs = Date.parse(oldHead.published_at);
  const currentMs = Date.parse(currentHead.published_at);
  if (!(currentMs >= oldMs)) return fail('head_mismatch');

  const oldLeaf = hexLeaf(input.oldInclusion?.leaf);
  const currentLeaves = (input.currentInclusions || []).map((row) => hexLeaf(row?.leaf)).filter((row): row is string => !!row);
  if (oldLeaf && currentLeaves.some((row) => row !== oldLeaf)) return fail('tree_head_mismatch');

  const oldIncluded = inclusionOf(input.leaf, input.oldInclusion, oldHead.root, oldHead.tree_size);
  if (!oldIncluded.ok) return oldIncluded;

  const inclusions = input.currentInclusions;
  if (!Array.isArray(inclusions) || inclusions.length === 0) return fail('not_in_tree');
  const positions = new Set<number>();
  for (const row of inclusions) {
    const included = inclusionOf(input.leaf, row, currentHead.root, currentHead.tree_size);
    if (!included.ok) return included;
    positions.add(included.leaf_index);
  }
  if (positions.size !== 1) return fail('inclusion_failed');
  const leafIndex = [...positions][0];
  return {
    applicable: true,
    ok: true,
    status: CARRY_FORWARD_STATUS,
    issued_at: oldHead.published_at,
    issued_epoch: oldHead.epoch,
    logged_at: currentHead.published_at,
    logged_epoch: currentHead.epoch,
    leaf_index: leafIndex,
  };
}
