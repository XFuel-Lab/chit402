/**
 * Unsigned receipt-lane decision beside book_seq.
 *
 * Design by Turbo on 1F916 (post 6579, comments 88201 and 88403):
 * freeze a receipt-lane row only when seq is present, settled_by is
 * `receipt`, the anchored tree head changed after that row was bound, and
 * the row is not settled. anchor_changed_since_binding alone does not freeze.
 *
 * These fields are derived. They are not inside the payment JWS and not
 * inside the signed book_seq claims. payload_version is unchanged.
 *
 * Keep this rule in lockstep with services/gateway/src/receipt-lane.js.
 */

export const RECEIPT_LANE_SCHEMA = 'chit402.receipt_lane.v1';

export const RECEIPT_LANE_RULE =
  'Freeze when book_seq is present, settled_by is receipt, anchor_changed_since_binding is true, and settled is false. '
  + 'anchor_changed_since_binding alone does not freeze. observed_transfer is outside the receipt lane.';

const SETTLED_STATUS = new Set(['settled', 'idempotent_replay']);

const SETTLED_EVIDENCE = new Set([
  'collected',
  'foreign_ingest',
  'refund_owed',
  'board_close',
]);

const UNSETTLED_EVIDENCE = new Set([
  'policy_blocked',
  'UNVERIFIED',
  'ARRIVAL_UNVERIFIED',
  'inflow_claimed',
  'inflow_correction',
  'RECORDED_BY_SETTLE',
  'openrouter_reported',
  'a2a_escrow',
]);

const RECEIPT_ASSERTION_EVIDENCE = new Set([
  'collected',
  'RECORDED_BY_SETTLE',
  'refund_owed',
  'board_stamp',
  'board_close',
]);

export type SettledBy = 'observed_transfer' | 'receipt' | null;

export interface AnchorIdentity {
  root: string | null;
  tree_size: number | null;
  anchor_tx: string | null;
  solana_signature: string | null;
}

export interface ReceiptLane {
  schema: typeof RECEIPT_LANE_SCHEMA;
  signed: false;
  book_seq: number | null;
  settled_by: SettledBy;
  settled: boolean | null;
  anchor_at_binding: AnchorIdentity | null;
  anchor_current: AnchorIdentity | null;
  anchor_changed_since_binding: boolean | null;
  freeze: boolean;
  reason: 'unsettled_anchor_changed' | null;
  rule: string;
}

export interface LanePayer {
  checked?: boolean;
  valid?: boolean;
}

export interface LaneEntry {
  book_seq?: number | null;
  seq?: number | null;
  book_chain?: { seq?: number | null } | null;
  payment?: { ref?: string | null; rail?: string | null; collected?: boolean | null } | null;
  payment_ref?: string | null;
  rail?: string | null;
  collected?: boolean | null;
  evidence?: string | null;
  source?: string | null;
  foreign_x402?: boolean;
  arrival_status?: string | null;
  ingress_receipt?: { ref?: string | null } | null;
  settlement_status?: string | null;
  usage_settled?: { settlement_status?: string | null } | null;
}

export interface ReceiptTreeHead {
  root?: string | null;
  tree_size?: number | null;
  anchor_tx?: string | null;
  anchor?: { tx?: string | null; status?: string | null } | null;
  anchors?: {
    base?: { tx?: string | null; status?: string | null } | null;
    solana?: { signature?: string | null; status?: string | null } | null;
  } | null;
}

export function normalizeRoot(root: string | null | undefined): string | null {
  if (root == null || root === '') return null;
  const hex = String(root).replace(/^0x/i, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? hex : String(root);
}

export function anchorIdentity(head: ReceiptTreeHead | null | undefined): AnchorIdentity | null {
  if (!head || typeof head !== 'object') return null;
  const base = head.anchors?.base || head.anchor || null;
  const sol = head.anchors?.solana || null;
  const baseAnchored = !base || base.status == null || base.status === 'anchored';
  const solAnchored = Boolean(sol && (sol.status == null || sol.status === 'anchored'));
  const tx = baseAnchored ? (base?.tx || head.anchor_tx || null) : null;
  const sig = solAnchored ? (sol?.signature || null) : null;
  const root = head.root != null && head.root !== '' ? normalizeRoot(head.root) : null;
  const size = Number(head.tree_size);
  const treeSize = Number.isInteger(size) ? size : null;
  if (root == null && !tx && !sig && treeSize == null) return null;
  return {
    root,
    tree_size: treeSize,
    anchor_tx: tx || null,
    solana_signature: sig || null,
  };
}

function sameIdentity(a: AnchorIdentity | null, b: AnchorIdentity | null): boolean | null {
  if (!a || !b) return null;
  if (a.root == null || b.root == null) return null;
  return a.root === b.root
    && (a.anchor_tx || null) === (b.anchor_tx || null)
    && (a.solana_signature || null) === (b.solana_signature || null);
}

export function anchorChangedSinceBinding(
  heads: ReceiptTreeHead[] | null | undefined,
  leafIndex: number | null | undefined,
): { changed: boolean | null; at: AnchorIdentity | null; current: AnchorIdentity | null } {
  if (!Array.isArray(heads) || heads.length === 0) {
    return { changed: null, at: null, current: null };
  }
  const current = anchorIdentity(heads[heads.length - 1]);
  const index = Number(leafIndex);
  if (!Number.isInteger(index) || index < 0) {
    return { changed: null, at: null, current };
  }
  let binding: ReceiptTreeHead | null = null;
  for (const head of heads) {
    const size = Number(head?.tree_size);
    if (Number.isInteger(size) && size > index) {
      binding = head;
      break;
    }
  }
  if (!binding) return { changed: null, at: null, current };
  const at = anchorIdentity(binding);
  const same = sameIdentity(at, current);
  return { changed: same == null ? null : same === false, at, current };
}

function paymentRefOf(input: LaneEntry | null | undefined): string | null {
  const ref = input?.payment?.ref ?? input?.payment_ref ?? null;
  if (ref == null) return null;
  const text = String(ref).trim();
  return text || null;
}

function hasIngress(input: LaneEntry): boolean {
  if (input.arrival_status === 'confirmed') return true;
  const ingress = input.ingress_receipt;
  if (!ingress || typeof ingress !== 'object') return false;
  const ref = ingress.ref != null ? String(ingress.ref).trim() : '';
  return ref.length > 0;
}

function isReported(input: LaneEntry): boolean {
  if (input.evidence === 'openrouter_reported') return true;
  if (input.source === 'openrouter_broadcast') return true;
  const rail = String(input.rail || input.payment?.rail || '').toLowerCase();
  return rail === 'reported';
}

export function deriveSettledBy(
  input: LaneEntry | null | undefined,
  { payer = null, issuerAssertsSettlement = null }: {
    payer?: LanePayer | null;
    issuerAssertsSettlement?: boolean | null;
  } = {},
): SettledBy {
  if (!input || typeof input !== 'object') return null;
  if (payer?.checked === true && payer.valid === true) return 'observed_transfer';
  if (isReported(input)) return null;
  const ref = paymentRefOf(input);
  const evidence = input.evidence || null;
  if (ref && (evidence === 'foreign_ingest' || input.source === 'foreign_ingest' || input.foreign_x402 === true)) {
    return 'observed_transfer';
  }
  if (hasIngress(input)) return 'observed_transfer';
  if (issuerAssertsSettlement === true && ref) return 'receipt';
  if (issuerAssertsSettlement === false) return null;
  if (!ref) return null;
  if (input.payment?.collected === true || input.collected === true) return 'receipt';
  const status = input.settlement_status || input.usage_settled?.settlement_status || null;
  if (status && SETTLED_STATUS.has(status)) return 'receipt';
  if (evidence && RECEIPT_ASSERTION_EVIDENCE.has(evidence)) return 'receipt';
  return null;
}

export function deriveSettled(
  input: LaneEntry | null | undefined,
  { payer = null }: { payer?: LanePayer | null } = {},
): boolean | null {
  if (!input || typeof input !== 'object') return null;
  if (payer?.checked === true && payer.valid === true) return true;
  if (payer?.checked === true && payer.valid === false) return false;
  if (isReported(input)) return false;
  const status = input.settlement_status || input.usage_settled?.settlement_status || null;
  if (status && SETTLED_STATUS.has(status)) return true;
  const evidence = input.evidence || null;
  if (evidence && UNSETTLED_EVIDENCE.has(evidence)) return false;
  if (evidence && SETTLED_EVIDENCE.has(evidence)) return true;
  if (input.payment?.collected === true || input.collected === true) return true;
  if (input.payment?.collected === false || input.collected === false) return false;
  return null;
}

export function bookSeqOf(input: LaneEntry | null | undefined): number | null {
  const raw = input?.book_seq ?? input?.seq ?? input?.book_chain?.seq ?? null;
  if (raw == null || (raw as unknown) === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function receiptLaneDecision(input: {
  book_seq: number | null;
  settled_by: SettledBy;
  settled: boolean | null;
  anchor_changed_since_binding: boolean | null;
}): { freeze: boolean; reason: 'unsettled_anchor_changed' | null } {
  const hasSeq = Number.isInteger(input.book_seq) && (input.book_seq as number) > 0;
  const freeze = hasSeq
    && input.settled_by === 'receipt'
    && input.anchor_changed_since_binding === true
    && input.settled === false;
  return {
    freeze,
    reason: freeze ? 'unsettled_anchor_changed' : null,
  };
}

function changedFromIdentities(
  at: AnchorIdentity | null,
  current: AnchorIdentity | null,
): { changed: boolean | null; at: AnchorIdentity | null; current: AnchorIdentity | null } {
  const same = sameIdentity(at, current);
  return {
    changed: same == null ? null : same === false,
    at: at || null,
    current: current || null,
  };
}

export function buildReceiptLane({
  entry = null,
  payer = null,
  leafIndex = null,
  heads = null,
  issuerAssertsSettlement = null,
  anchorAtBinding = null,
  anchorCurrent = null,
}: {
  entry?: LaneEntry | null;
  payer?: LanePayer | null;
  leafIndex?: number | null;
  heads?: ReceiptTreeHead[] | null;
  issuerAssertsSettlement?: boolean | null;
  anchorAtBinding?: AnchorIdentity | null;
  anchorCurrent?: AnchorIdentity | null;
} = {}): ReceiptLane {
  const book_seq = bookSeqOf(entry);
  const settled_by = deriveSettledBy(entry, { payer, issuerAssertsSettlement });
  const settled = deriveSettled(entry, { payer });
  const anchor = Array.isArray(heads) && heads.length > 0 && leafIndex != null
    ? anchorChangedSinceBinding(heads, leafIndex)
    : changedFromIdentities(anchorAtBinding ?? null, anchorCurrent ?? null);
  const decision = receiptLaneDecision({
    book_seq,
    settled_by,
    settled,
    anchor_changed_since_binding: anchor.changed,
  });
  return {
    schema: RECEIPT_LANE_SCHEMA,
    signed: false,
    book_seq,
    settled_by,
    settled,
    anchor_at_binding: anchor.at,
    anchor_current: anchor.current,
    anchor_changed_since_binding: anchor.changed,
    freeze: decision.freeze,
    reason: decision.reason,
    rule: RECEIPT_LANE_RULE,
  };
}

interface SignedClaims {
  payment?: { ref?: string | null; rail?: string | null; collected?: boolean | null } | null;
  settlement?: { kind?: string | null } | null;
}

interface ReceiptLaneSource {
  book_seq?: number | null;
  book_chain?: { seq?: number | null } | null;
  tree_head?: ReceiptTreeHead | null;
  head?: ReceiptTreeHead | null;
  receipt_lane?: {
    anchor_at_binding?: AnchorIdentity | null;
    anchor_current?: AnchorIdentity | null;
    freeze?: boolean;
    anchor_changed_since_binding?: boolean | null;
  } | null;
}

/**
 * Stranger view. Uses verified signed claims and an on-chain payer check.
 * Ignores a stamped freeze bit. Unsigned payment.ref is not an assertion.
 */
export function receiptLaneFromVerification({
  receipt,
  claims = null,
  issuerValid = false,
  payer = null,
  head = null,
}: {
  receipt: ReceiptLaneSource | null | undefined;
  claims?: SignedClaims | null;
  issuerValid?: boolean;
  payer?: LanePayer | null;
  head?: ReceiptTreeHead | null;
}): ReceiptLane {
  const kind = claims?.settlement?.kind ?? null;
  const signedRef = claims?.payment?.ref ?? null;
  const reported = kind === 'reported';
  const asserts = issuerValid === true && !!signedRef && !reported;
  const collected = kind === 'settled' || kind === 'inherited'
    ? true
    : (kind === 'unsettled' || reported ? false : (claims?.payment?.collected ?? null));
  const entry: LaneEntry = {
    book_seq: receipt?.book_seq ?? null,
    book_chain: receipt?.book_chain ?? null,
    payment: issuerValid ? {
      ref: signedRef,
      rail: claims?.payment?.rail ?? null,
      collected,
    } : null,
    collected,
    evidence: reported ? 'openrouter_reported' : null,
  };
  const stamped = receipt?.receipt_lane || null;
  const currentHead = head || receipt?.tree_head || receipt?.head || null;
  const anchorCurrent = currentHead ? anchorIdentity(currentHead) : (stamped?.anchor_current ?? null);
  const anchorAtBinding = stamped?.anchor_at_binding ?? null;
  return buildReceiptLane({
    entry,
    payer,
    issuerAssertsSettlement: asserts,
    anchorAtBinding,
    anchorCurrent,
  });
}
