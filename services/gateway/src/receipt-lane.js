/**
 * Unsigned receipt-lane decision beside book_seq.
 *
 * Design by Turbo on 1F916 (post 6579, comments 88201 and 88403):
 * freeze a receipt-lane row only when seq is present, settled_by is
 * `receipt`, the anchored tree head changed after that row was bound, and
 * the row is not settled. anchor_changed_since_binding alone does not freeze.
 * Turbo measured that ungated bit on 158 of 632 rows.
 *
 * Comment 88596 freezes that ordering — seq + settled_by + (anchor_changed
 * AND not settled) — and states the boundary: complete over registry marks,
 * blind to payments the registry never joined. A binding past expiry with
 * settled_by, receipt_id, observed_tx_hash, and observed_transfer_id all
 * null is unverifiable_from_registry, not unpaid.
 *
 * The fields are derived. They are not claims in the payment JWS and not
 * claims in chit402.book_seq, so those payload versions stay put and an
 * older signature still verifies.
 *
 * Keep this rule in lockstep with packages/verify/src/receipt-lane.ts.
 */
import { deriveEvidence } from './usage-settled.js';

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
 * Base mainnet USDC. Same contract as USDC_ADDRESSES.base in foreign-x402-ingest.js,
 * which checks one known transaction. This hint does not call RPC.
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

export function normalizeRoot(root) {
  if (root == null || root === '') return null;
  const hex = String(root).replace(/^0x/i, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? hex : String(root);
}

/** Identity of a signed tree head. Pending sides contribute no tx. */
export function anchorIdentity(head) {
  if (!head || typeof head !== 'object') return null;
  const base = head.anchors?.base || head.anchor || null;
  const sol = head.anchors?.solana || null;
  const baseAnchored = !base || base.status == null || base.status === 'anchored';
  const solAnchored = Boolean(sol && (sol.status == null || sol.status === 'anchored'));
  const tx = baseAnchored ? (base?.tx || head.anchor_tx || null) : null;
  const sig = solAnchored ? (sol.signature || null) : null;
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

function sameIdentity(a, b) {
  if (!a || !b) return null;
  if (a.root == null || b.root == null) return null;
  return a.root === b.root
    && (a.anchor_tx || null) === (b.anchor_tx || null)
    && (a.solana_signature || null) === (b.solana_signature || null);
}

/**
 * First signed head whose tree_size includes this leaf, compared with the
 * latest head. Null when no head covers the leaf yet — unknown, not false.
 * An in-place rewrite of the same day's head does not keep the previous
 * anchor identity.
 */
export function anchorChangedSinceBinding(heads, leafIndex) {
  if (!Array.isArray(heads) || heads.length === 0) {
    return { changed: null, at: null, current: null };
  }
  const current = anchorIdentity(heads[heads.length - 1]);
  const index = Number(leafIndex);
  if (!Number.isInteger(index) || index < 0) {
    return { changed: null, at: null, current };
  }
  let binding = null;
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

function paymentRefOf(input) {
  const ref = input?.payment?.ref ?? input?.payment_ref ?? null;
  if (ref == null) return null;
  const text = String(ref).trim();
  return text || null;
}

function hasIngress(input) {
  if (input?.arrival_status === 'confirmed') return true;
  const ingress = input?.ingress_receipt;
  if (!ingress || typeof ingress !== 'object') return false;
  const ref = ingress.ref != null ? String(ingress.ref).trim() : '';
  return ref.length > 0;
}

function isReported(input) {
  if (input?.evidence === 'openrouter_reported') return true;
  if (input?.source === 'openrouter_broadcast') return true;
  const rail = String(input?.rail || input?.payment?.rail || '').toLowerCase();
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
];

/** A 1F916 payout binding carries expiry plus a registry mark key. A book row does not. */
export function isPayoutBinding(input) {
  if (!input || typeof input !== 'object') return false;
  if (!Object.prototype.hasOwnProperty.call(input, 'expiry')) return false;
  return PAYOUT_BINDING_KEYS.some((key) => Object.prototype.hasOwnProperty.call(input, key));
}

function explicitSettledBy(input) {
  const value = input?.settled_by;
  if (value === 'observed_transfer' || value === 'receipt') return value;
  return null;
}

function blankMark(value) {
  return value == null || String(value).trim() === '';
}

/** Unix seconds, unix ms, or an ISO timestamp. Null when the field is absent or not a time. */
export function expiryMillis(expiry) {
  if (blankMark(expiry)) return null;
  if (typeof expiry === 'string' && /[T-]/.test(expiry)) {
    const parsed = Date.parse(expiry);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const n = Number(expiry);
  if (!Number.isFinite(n)) return null;
  return n < 1e12 ? n * 1000 : n;
}

export function isPastExpiry(expiry, nowMs = Date.now()) {
  const at = expiryMillis(expiry);
  if (at == null) return false;
  return nowMs >= at;
}

/**
 * @param {object|null} input
 * @param {{ payer?: { checked?: boolean, valid?: boolean }|null, issuerAssertsSettlement?: boolean|null }} [opts]
 * @returns {'observed_transfer'|'receipt'|null}
 */
export function deriveSettledBy(input, { payer = null, issuerAssertsSettlement = null } = {}) {
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
  if (SETTLED_STATUS.has(status)) return 'receipt';
  if (RECEIPT_ASSERTION_EVIDENCE.has(evidence)) return 'receipt';
  return null;
}

/**
 * @returns {boolean|null} null when the inputs do not say
 */
export function deriveSettled(input, { payer = null } = {}) {
  if (!input || typeof input !== 'object') return null;
  if (isPayoutBinding(input)) return explicitSettledBy(input) ? true : null;
  if (payer?.checked === true && payer.valid === true) return true;
  if (payer?.checked === true && payer.valid === false) return false;
  if (isReported(input)) return false;
  const status = input.settlement_status || input.usage_settled?.settlement_status || null;
  if (SETTLED_STATUS.has(status)) return true;
  const evidence = input.evidence || null;
  if (UNSETTLED_EVIDENCE.has(evidence)) return false;
  if (SETTLED_EVIDENCE.has(evidence)) return true;
  if (input.payment?.collected === true || input.collected === true) return true;
  if (input.payment?.collected === false || input.collected === false) return false;
  return null;
}

export function bookSeqOf(input) {
  const raw = input?.book_seq ?? input?.seq ?? input?.book_chain?.seq ?? null;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function receiptLaneDecision({
  book_seq,
  settled_by,
  settled,
  anchor_changed_since_binding,
}) {
  const hasSeq = Number.isInteger(book_seq) && book_seq > 0;
  const freeze = hasSeq
    && settled_by === 'receipt'
    && anchor_changed_since_binding === true
    && settled === false;
  return {
    freeze,
    reason: freeze ? 'unsettled_anchor_changed' : null,
  };
}

function changedFromIdentities(at, current) {
  const same = sameIdentity(at, current);
  return {
    changed: same == null ? null : same === false,
    at: at || null,
    current: current || null,
  };
}

function registryUnmarked(input, settledBy) {
  return settledBy == null
    && blankMark(input?.receipt_id)
    && blankMark(input?.observed_tx_hash)
    && blankMark(input?.observed_transfer_id);
}

/**
 * Partition a row. Expired and unmarked is unverifiable_from_registry, ahead
 * of the clean-unsettled and anchor-changed buckets, and behind a joined
 * settled_by (receipt or observed_transfer).
 * @returns {'receipt'|'observed_transfer'|'anchor_changed_unsettled'|'unsettled'|'unverifiable_from_registry'}
 */
export function classifyReceiptLane({
  entry = null,
  settled_by = null,
  settled = null,
  anchor_changed_since_binding = null,
  now = Date.now(),
} = {}) {
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
export function baseUsdcLocalCheckHint(entry) {
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

/**
 * @param {object} [args]
 */
export function buildReceiptLane({
  entry = null,
  payer = null,
  leafIndex = null,
  heads = null,
  issuerAssertsSettlement = null,
  anchorAtBinding = null,
  anchorCurrent = null,
  now = Date.now(),
} = {}) {
  const book_seq = bookSeqOf(entry);
  const settled_by = deriveSettledBy(entry, { payer, issuerAssertsSettlement });
  const settled = deriveSettled(entry, { payer });
  let anchor;
  if (Array.isArray(heads) && heads.length > 0 && leafIndex != null) {
    anchor = anchorChangedSinceBinding(heads, leafIndex);
  } else if (anchorAtBinding || anchorCurrent) {
    anchor = changedFromIdentities(anchorAtBinding, anchorCurrent);
  } else if (typeof entry?.anchor_changed_since_binding === 'boolean') {
    anchor = { changed: entry.anchor_changed_since_binding, at: null, current: null };
  } else {
    anchor = changedFromIdentities(anchorAtBinding, anchorCurrent);
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

/**
 * Lane for a ledger row. Evidence comes from deriveEvidence. Anchor change
 * comes from the receipt Merkle heads when this task is already a leaf.
 * @param {object} entry
 * @param {{ tree?: object|null, payer?: object|null }} [opts]
 */
export function receiptLaneForEntry(entry, { tree = null, payer = null, now = Date.now() } = {}) {
  if (!entry || typeof entry !== 'object') {
    return buildReceiptLane({ entry: null });
  }
  const evidence = deriveEvidence(entry);
  let leafIndex = null;
  let heads = null;
  const taskId = entry.task_id;
  // Index only. inclusion() throws head_rejected / head_mismatch, and this
  // lane is on the book, lineage, and export path. A rejected frontier
  // contributes no heads, so the row stays unknown rather than
  // verified-included.
  if (tree && taskId) {
    try {
      if (typeof tree.leafIndexOf === 'function') {
        const index = tree.leafIndexOf(taskId);
        if (Number.isInteger(index) && index >= 0) leafIndex = index;
      }
      if (typeof tree.laneHeadsFor === 'function') {
        const lane = tree.laneHeadsFor(taskId);
        const laneHeads = Array.isArray(lane?.heads) ? lane.heads : [];
        if (lane?.frontierRejected !== true && laneHeads.length > 0) heads = laneHeads;
      }
    } catch {
      heads = null;
    }
  }
  return buildReceiptLane({
    entry: { ...entry, evidence },
    payer,
    leafIndex,
    heads,
    now,
  });
}
