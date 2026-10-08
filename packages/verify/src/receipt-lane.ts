/**
 * Unsigned receipt-lane decision beside book_seq.
 *
 * Design by Turbo on 1F916 (post 6579, comments 88201 and 88403):
 * freeze a receipt-lane row only when seq is present, settled_by is
 * `receipt`, the anchored tree head changed after that row was bound, and
 * the row is not settled. anchor_changed_since_binding alone does not freeze.
 *
 * Comment 88596 freezes that ordering — seq + settled_by + (anchor_changed
 * AND not settled) — and states the boundary: complete over registry marks,
 * blind to payments the registry never joined. A binding past expiry with
 * settled_by, receipt_id, observed_tx_hash, and observed_transfer_id all
 * null is unverifiable_from_registry, not unpaid.
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

/** Frozen partition order. `settled_by` here is the receipt-lane conjunct (value `receipt`). */
export const RECEIPT_LANE_ORDERING = 'seq + settled_by + (anchor_changed AND not settled)';

/** The ordering reads registry marks only. A transfer the registry never joined is outside it. */
export const RECEIPT_LANE_BOUNDARY =
  'complete over registry marks, blind to payments the registry never joined';

/**
 * Base mainnet USDC. Same contract as USDC_ADDRESSES.base in
 * services/gateway/src/foreign-x402-ingest.js. The hint does not call RPC.
 */
export const BASE_USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BASE_CHAIN_ID = 8453;

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

export type RegistryClassification =
  | 'receipt'
  | 'observed_transfer'
  | 'anchor_changed_unsettled'
  | 'unsettled'
  | 'unverifiable_from_registry';

export interface LocalCheckHint {
  method: 'base_usdc_transfer';
  chain_id: 8453;
  token: string;
  payee: string;
  amount_atomic: string;
  claims_paid: false;
}

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
  ordering: typeof RECEIPT_LANE_ORDERING;
  boundary: typeof RECEIPT_LANE_BOUNDARY;
  classification: RegistryClassification;
  local_check: LocalCheckHint | null;
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
  expiry?: number | string | null;
  receipt_id?: string | number | null;
  observed_tx_hash?: string | null;
  observed_transfer_id?: string | number | null;
  settled_by?: SettledBy;
  anchor_changed_since_binding?: boolean | null;
  chain_id?: number | string | null;
  chainId?: number | string | null;
  token?: string | null;
  asset?: string | null;
  payout_address?: string | null;
  address?: string | null;
  payee?: string | null;
  amount_atomic?: string | number | null;
  docket_id?: string | null;
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

const PAYOUT_BINDING_KEYS = [
  'payout_address',
  'address',
  'docket_id',
  'receipt_id',
  'observed_tx_hash',
  'observed_transfer_id',
  'settled_by',
] as const;

/** A 1F916 payout binding carries expiry plus a registry mark key. A book row does not. */
export function isPayoutBinding(input: LaneEntry | null | undefined): boolean {
  if (!input || typeof input !== 'object') return false;
  if (!Object.prototype.hasOwnProperty.call(input, 'expiry')) return false;
  return PAYOUT_BINDING_KEYS.some((key) => Object.prototype.hasOwnProperty.call(input, key));
}

function explicitSettledBy(input: LaneEntry | null | undefined): SettledBy {
  const value = input?.settled_by;
  if (value === 'observed_transfer' || value === 'receipt') return value;
  return null;
}

function blankMark(value: unknown): boolean {
  return value == null || String(value).trim() === '';
}

/** Unix seconds, unix ms, or an ISO timestamp. Null when the field is absent or not a time. */
export function expiryMillis(expiry: number | string | null | undefined): number | null {
  if (blankMark(expiry)) return null;
  if (typeof expiry === 'string' && /[T-]/.test(expiry)) {
    const parsed = Date.parse(expiry);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const n = Number(expiry);
  if (!Number.isFinite(n)) return null;
  return n < 1e12 ? n * 1000 : n;
}

export function isPastExpiry(
  expiry: number | string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  const at = expiryMillis(expiry);
  if (at == null) return false;
  return nowMs >= at;
}

function registryUnmarked(input: LaneEntry | null | undefined, settledBy: SettledBy): boolean {
  return settledBy == null
    && blankMark(input?.receipt_id)
    && blankMark(input?.observed_tx_hash)
    && blankMark(input?.observed_transfer_id);
}

/**
 * Partition a row. Expired and unmarked is unverifiable_from_registry, ahead
 * of the clean-unsettled and anchor-changed buckets, and behind a joined
 * settled_by (receipt or observed_transfer).
 */
export function classifyReceiptLane({
  entry = null,
  settled_by = null,
  settled = null,
  anchor_changed_since_binding = null,
  now = Date.now(),
}: {
  entry?: LaneEntry | null;
  settled_by?: SettledBy;
  settled?: boolean | null;
  anchor_changed_since_binding?: boolean | null;
  now?: number;
} = {}): RegistryClassification {
  if (settled_by === 'receipt') return 'receipt';
  if (settled_by === 'observed_transfer') return 'observed_transfer';
  if (isPastExpiry(entry?.expiry, now) && registryUnmarked(entry, settled_by)) {
    return 'unverifiable_from_registry';
  }
  if (anchor_changed_since_binding === true && settled !== true) return 'anchor_changed_unsettled';
  return 'unsettled';
}

/**
 * Payee and amount a stranger can feed to the existing per-tx Base USDC check.
 * Null unless this row is Base mainnet USDC. Does not claim the transfer happened
 * and does not read the chain.
 */
export function baseUsdcLocalCheckHint(entry: LaneEntry | null | undefined): LocalCheckHint | null {
  if (!entry || typeof entry !== 'object') return null;
  const chain = entry.chain_id ?? entry.chainId ?? null;
  const chainName = String(chain ?? '').toLowerCase();
  const chainOk = chain === BASE_CHAIN_ID
    || chainName === String(BASE_CHAIN_ID)
    || chainName === 'base'
    || chainName === 'eip155:8453';
  if (!chainOk) return null;
  const token = entry.token ?? entry.asset ?? null;
  if (token == null || String(token).toLowerCase() !== BASE_USDC_ADDRESS.toLowerCase()) return null;
  const payee = entry.payout_address || entry.address || entry.payee || null;
  const amount = entry.amount_atomic ?? null;
  if (blankMark(payee) || blankMark(amount)) return null;
  return {
    method: 'base_usdc_transfer',
    chain_id: BASE_CHAIN_ID,
    token: BASE_USDC_ADDRESS,
    payee: String(payee),
    amount_atomic: String(amount),
    claims_paid: false,
  };
}

export function deriveSettledBy(
  input: LaneEntry | null | undefined,
  { payer = null, issuerAssertsSettlement = null }: {
    payer?: LanePayer | null;
    issuerAssertsSettlement?: boolean | null;
  } = {},
): SettledBy {
  if (!input || typeof input !== 'object') return null;
  if (isPayoutBinding(input)) return explicitSettledBy(input);
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
  if (isPayoutBinding(input)) return explicitSettledBy(input) ? true : null;
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
  now = Date.now(),
}: {
  entry?: LaneEntry | null;
  payer?: LanePayer | null;
  leafIndex?: number | null;
  heads?: ReceiptTreeHead[] | null;
  issuerAssertsSettlement?: boolean | null;
  anchorAtBinding?: AnchorIdentity | null;
  anchorCurrent?: AnchorIdentity | null;
  now?: number;
} = {}): ReceiptLane {
  const book_seq = bookSeqOf(entry);
  const settled_by = deriveSettledBy(entry, { payer, issuerAssertsSettlement });
  const settled = deriveSettled(entry, { payer });
  let anchor;
  if (Array.isArray(heads) && heads.length > 0 && leafIndex != null) {
    anchor = anchorChangedSinceBinding(heads, leafIndex);
  } else if (anchorAtBinding || anchorCurrent) {
    anchor = changedFromIdentities(anchorAtBinding ?? null, anchorCurrent ?? null);
  } else if (typeof entry?.anchor_changed_since_binding === 'boolean') {
    anchor = { changed: entry.anchor_changed_since_binding, at: null, current: null };
  } else {
    anchor = changedFromIdentities(anchorAtBinding ?? null, anchorCurrent ?? null);
  }
  const decision = receiptLaneDecision({
    book_seq,
    settled_by,
    settled,
    anchor_changed_since_binding: anchor.changed,
  });
  const classification = classifyReceiptLane({
    entry,
    settled_by,
    settled,
    anchor_changed_since_binding: anchor.changed,
    now,
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
    ordering: RECEIPT_LANE_ORDERING,
    boundary: RECEIPT_LANE_BOUNDARY,
    classification,
    local_check: classification === 'unverifiable_from_registry' ? baseUsdcLocalCheckHint(entry) : null,
  };
}

interface SignedClaims {
  schema?: string | null;
  payment?: { ref?: string | null; rail?: string | null; collected?: boolean | null } | null;
  settlement?: { kind?: string | null } | null;
}

interface ReceiptLaneSource {
  book_seq?: number | null;
  book_chain?: { seq?: number | null } | null;
  tree_head?: ReceiptTreeHead | null;
  head?: ReceiptTreeHead | null;
  expiry?: number | string | null;
  receipt_id?: string | number | null;
  observed_tx_hash?: string | null;
  observed_transfer_id?: string | number | null;
  settled_by?: SettledBy;
  anchor_changed_since_binding?: boolean | null;
  chain_id?: number | string | null;
  token?: string | null;
  payout_address?: string | null;
  address?: string | null;
  amount_atomic?: string | number | null;
  docket_id?: string | null;
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
  now = Date.now(),
}: {
  receipt: ReceiptLaneSource | null | undefined;
  claims?: SignedClaims | null;
  issuerValid?: boolean;
  payer?: LanePayer | null;
  head?: ReceiptTreeHead | null;
  now?: number;
}): ReceiptLane {
  const kind = claims?.settlement?.kind ?? null;
  const signedRef = claims?.payment?.ref ?? null;
  const reported = kind === 'reported';
  const foreignPayout = issuerValid === true && claims?.schema === 'chit402.foreign_payout.v1';
  const asserts = issuerValid === true && !!signedRef && !reported && !foreignPayout;
  const collected = kind === 'settled' || kind === 'inherited'
    ? true
    : (kind === 'unsettled' || reported ? false : (claims?.payment?.collected ?? null));
  const binding = receipt
    && Object.prototype.hasOwnProperty.call(receipt, 'expiry')
    && (
      Object.prototype.hasOwnProperty.call(receipt, 'docket_id')
      || Object.prototype.hasOwnProperty.call(receipt, 'payout_address')
      || Object.prototype.hasOwnProperty.call(receipt, 'authorization_hash')
    )
    ? receipt
    : null;
  const entry: LaneEntry = {
    book_seq: receipt?.book_seq ?? null,
    book_chain: receipt?.book_chain ?? null,
    payment: issuerValid ? {
      ref: signedRef,
      rail: claims?.payment?.rail ?? null,
      collected,
    } : null,
    collected,
    evidence: foreignPayout ? 'foreign_ingest' : (reported ? 'openrouter_reported' : null),
    source: foreignPayout ? 'foreign_ingest' : null,
    foreign_x402: foreignPayout ? true : undefined,
    ...(binding ? {
      expiry: binding.expiry ?? null,
      receipt_id: binding.receipt_id ?? null,
      observed_tx_hash: binding.observed_tx_hash ?? null,
      observed_transfer_id: binding.observed_transfer_id ?? null,
      settled_by: binding.settled_by ?? null,
      anchor_changed_since_binding: binding.anchor_changed_since_binding,
      chain_id: binding.chain_id ?? null,
      token: binding.token ?? null,
      payout_address: binding.payout_address ?? binding.address ?? null,
      amount_atomic: binding.amount_atomic ?? null,
      docket_id: binding.docket_id ?? null,
    } : {}),
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
    now,
  });
}
