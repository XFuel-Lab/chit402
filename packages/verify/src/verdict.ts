/**
 * @xfuel/verify 0.4 verdict.
 * `verified` is only when every check passed. A failed check is `invalid`
 * even when another check could not be completed. Human lines for
 * COULD_NOT_CHECK do not contain the words invalid or INVALID.
 */

import { payerCheckOutcome } from './payer.js';

export type CheckState = 'pass' | 'fail' | 'could_not_check';

/**
 * `verified_public` is the public-attestation result (0.4.6). It is exit 0,
 * but its scope is the signed public fields only: settled amount, payee, tx, and log
 * position. It does not claim the payer or fulfillment.
 */
export type VerdictResult = 'verified' | 'verified_public' | 'invalid' | 'could_not_check';

export interface VerdictLog {
  leaf_index: number | null;
  tree_size: number | null;
  root: string | null;
  anchors: {
    base: string | null;
    solana: string | null;
  };
  /** 0.4.10: an anchor lookup that failed while another chain confirmed. */
  warnings?: string[];
  /** 0.4.10: true when a claimed anchor chain was not checked this run. */
  partial?: true;
  /** 0.4.10: the claimed chains this run did not check. */
  unchecked_anchors?: ('base' | 'solana')[];
  /**
   * Set only when the verified head carries an EIP-712 fixed head and it
   * says the same as the JWS head under the same key.
   */
  fixed_head?: 'verified';
}

/** Payer binding next to the receipt (owner view). Absent when the receipt has none. */
export interface VerdictPayerBinding {
  checked: boolean;
  valid: boolean;
  reason: string | null;
}

export interface VerifyVerdict {
  result: VerdictResult;
  exit_code: 0 | 1 | 2;
  reason: string | null;
  message: string;
  next_step: string | null;
  receipt_id: string | null;
  display_id: string | null;
  payload_version: number | null;
  checks: {
    signature: CheckState;
    key_window: CheckState;
    payment_binding: CheckState;
    log_inclusion: CheckState;
    anchor: CheckState;
    shape: CheckState;
    /** Public scope only: the payer is not part of the claim. */
    payer?: 'not_claimed';
  };
  /** Present only when the receipt carries a signed payer binding. */
  payer_binding?: VerdictPayerBinding;
  /** Present only on the public-attestation path. */
  scope?: 'public';
  public?: {
    claims: string;
    payer: 'not_claimed';
    chain_from: string | null;
    task_id_to_leaf: 'issuer_signature';
  };
  history: {
    source: 'file' | 'live' | 'bundled' | null;
    head_hash: string | null;
    entry_count: number | null;
    as_of: string | null;
  };
  log: VerdictLog | null;
  verifier: {
    name: 'chit402-verify';
    version: string;
  };
}

const VERSION_WINDOW_FAIL = new Set([
  'version_window_closed',
  'version_window_not_open',
  'version_window_missing',
  'log_time_after_window',
]);

const WINDOW_FAIL = new Set([
  'kid_revoked_before_issuance',
  'issued_before_not_before',
  'issued_after_not_after',
  'issued_at_missing',
  'not_before_missing',
  'not_after_invalid',
  'revoked_at_missing',
  'kid_status_regression',
  'issuer_history_invalid',
  'issuer_history_pin_mismatch',
  'issuer_history_pin_missing',
  'issuer_history_version_mismatch',
  'issuer_history_seq_mismatch',
  'signature_invalid',
  'typ_mismatch',
  'key untrusted',
  'prev_hash_mismatch',
  'entry_hash_mismatch',
  'head_hash_mismatch',
  'introduced_key_signature',
  'inherited_key_window',
  'issuer_history_not_extension',
  'version_window_closed',
  'version_window_not_open',
  'version_window_missing',
  'log_time_after_window',
]);

export function verdictCopy(reason: string | null, result: VerdictResult): { message: string; next_step: string | null } {
  if (result === 'verified') return { message: 'Every check passed.', next_step: null };
  if (result === 'verified_public') {
    return {
      message: 'The public attestation verified: settled amount, payee, tx, and log position. The link from this id to the log leaf rests on the issuer signature. The payer and fulfillment are not claimed.',
      next_step: null,
    };
  }
  if (reason === 'public_attestation_pending') {
    return {
      message: 'The public attestation is pending. It is signed after the log leaf exists.',
      next_step: 'Re-run in a few minutes.',
    };
  }
  if (reason === 'leaf_not_bound' || reason === 'leaf_index_mismatch') {
    return {
      message: 'The log leaf does not match the leaf the issuer signed.',
      next_step: null,
    };
  }
  if (reason === 'log_epoch_mismatch') {
    return {
      message: 'The log served a different epoch than the one the issuer signed.',
      next_step: 'Re-run later.',
    };
  }
  if (reason === 'invalid_jws') {
    return {
      message: 'The public attestation is malformed or not the tagged public payload.',
      next_step: null,
    };
  }
  if (reason === 'transfer_mismatch') {
    return {
      message: 'The on-chain transfer does not match the signed amount, payee, or asset.',
      next_step: null,
    };
  }
  if (reason === 'public_rail_unsupported') {
    return {
      message: 'This verifier checks public attestations on Base only.',
      next_step: null,
    };
  }
  if (reason === 'not_in_log' || reason === 'NOT_IN_LOG') {
    return {
      message: 'This receipt is not a leaf of the public log. The payment row in the book is unchanged.',
      next_step: null,
    };
  }
  if (reason === 'unsupported_version') {
    return {
      message: 'This receipt version is not supported by this verifier.',
      next_step: 'Upgrade @xfuel/verify.',
    };
  }
  if (reason === 'kid_not_in_history') {
    return {
      message: 'No issuer history covers this key.',
      next_step: 'Pass --issuer-history with a snapshot that includes this kid.',
    };
  }
  if (reason === 'signed_receipt_unavailable') {
    return {
      message: 'This document is the public shell. The signed receipt is on the owner view.',
      next_step: 'Pass the signed receipt from the owner view.',
    };
  }
  if (reason === 'receipt_unavailable') {
    return {
      message: 'The receipt could not be fetched.',
      next_step: 'Fetch the receipt again, then re-run.',
    };
  }
  if (reason === 'issuer_history_unavailable') {
    return {
      message: 'Issuer history could not be read.',
      next_step: null,
    };
  }
  if (reason === 'log_unreachable' || reason === 'anchor_unreachable') {
    return {
      message: 'The receipt log or anchor could not be fetched.',
      next_step: 'Fetch the log and the anchor again, then re-run.',
    };
  }
  if (reason === 'pending' || reason === 'pending_anchor') {
    return {
      message: 'The leaf is past the anchored tree. The anchor is not in yet.',
      next_step: 'Re-run when the anchor for this leaf is published.',
    };
  }
  if (reason === 'version_window_closed' || reason === 'version_window_not_open' || reason === 'version_window_missing') {
    return {
      message: 'The receipt was signed outside the window of its receipt version.',
      next_step: null,
    };
  }
  if (reason === 'log_time_after_window') {
    return {
      message: 'The receipt entered the public log after its receipt version closed.',
      next_step: null,
    };
  }
  if (reason === 'log_time_unavailable') {
    return {
      message: 'The log time of this receipt could not be read from the chain. Its version has closed, so it is needed.',
      next_step: 'Re-run when the chain RPC answers.',
    };
  }
  if (reason === 'legacy_form_not_allowlisted') {
    return {
      message: 'This receipt form (version not signed, or a detached signature) is accepted only for listed receipts, and it is not listed.',
      next_step: null,
    };
  }
  if (reason === 'kid_status_regression') {
    return {
      message: 'Issuer history changes not_before or restores a revoked key.',
      next_step: null,
    };
  }
  if (reason === 'kid_revoked_before_issuance' || reason === 'issued_before_not_before' || reason === 'issued_after_not_after') {
    return {
      message: 'The issuer key was revoked or this receipt is outside its window.',
      next_step: null,
    };
  }
  if (
    reason === 'version_mismatch'
    || reason === 'payload_version_mismatch'
    || reason === 'id_mismatch'
    || reason === 'id_prefix_version_mismatch'
  ) {
    return {
      message: 'The receipt id or version does not match the signature.',
      next_step: null,
    };
  }
  if (reason === 'intent_on_legacy_version') {
    return {
      message: 'A signed intent is not a payment on this receipt version.',
      next_step: null,
    };
  }
  if (reason === 'claim_mismatch') {
    return {
      message: 'A field on the receipt does not match the signature.',
      next_step: null,
    };
  }
  if (reason === 'payment_mismatch' || reason === 'binding_mismatch') {
    return {
      message: 'The payment on the receipt does not match the signature or the on-chain transfer.',
      next_step: null,
    };
  }
  if (reason === 'payer_unchecked') {
    return {
      message: 'The on-chain payment could not be checked.',
      next_step: 'Check the RPC, then re-run.',
    };
  }
  if (reason === 'typ_mismatch') {
    return {
      message: 'The signature is over a different document type, not a receipt.',
      next_step: null,
    };
  }
  if (reason === 'payer_binding_invalid') {
    return {
      message: 'The payer binding next to the receipt does not match what the issuer signed.',
      next_step: null,
    };
  }
  if (reason === 'fixed_head_invalid') {
    return {
      message: 'The EIP-712 fixed head does not match the signed tree head.',
      next_step: null,
    };
  }
  if (reason === 'key untrusted') {
    return {
      message: "Signed by a key that is not the issuer's.",
      next_step: null,
    };
  }
  if (result === 'could_not_check') {
    return {
      message: 'A check could not be completed.',
      next_step: null,
    };
  }
  return {
    message: 'The receipt does not match what the issuer signed.',
    next_step: null,
  };
}

export interface VerdictInput {
  version: string;
  receiptId?: string | null;
  displayId?: string | null;
  payloadVersion?: number | null;
  historySource?: 'file' | 'live' | 'bundled' | null;
  historyHead?: string | null;
  historyCount?: number | null;
  historyAsOf?: string | null;
  signatureValid?: boolean | null;
  signatureChecked?: boolean;
  historyChecked?: boolean;
  historyOk?: boolean;
  historyReason?: string | null;
  /** Resolver found no document that covers this kid. */
  historyMissing?: boolean;
  /** The history read did not complete (for example a refused redirect). */
  historyUnreachable?: boolean;
  /** Published preimage bytes could not be read (for example a refused redirect). */
  paymentUnreachable?: boolean;
  bindingExpected?: boolean;
  bindingMatches?: boolean | null;
  claimMismatches?: number;
  payerChecked?: boolean;
  payerValid?: boolean;
  /**
   * The CLI requires the on-chain payer check. `pass` is the only value that
   * may leave payment_binding as pass. `fail` is a mismatch. Anything else,
   * including a missing value, is could_not_check.
   */
  payerRequired?: boolean;
  payerOutcome?: 'pass' | 'fail' | 'unchecked' | null;
  errors?: string[];
  /** `unclaimed` is could_not_check: 0.4 never passes a log or anchor it did not fetch. */
  logInclusion?: CheckState | 'unclaimed';
  anchor?: CheckState | 'unclaimed';
  logReason?: string | null;
  log?: VerdictLog | null;
  /**
   * No receipt was loaded. Every check is `could_not_check` and this string
   * is the reason. History and payment defaults must not run.
   */
  absentReason?: string | null;
  /**
   * A failure found outside the six named checks (for example an offline
   * inclusion proof the library rejected). When set and no named check
   * failed, the result is `invalid` with this reason. The CLI does not set it.
   */
  failureReason?: string | null;
}

function claimed(state: CheckState | 'unclaimed' | undefined): CheckState {
  if (!state || state === 'unclaimed') return 'could_not_check';
  return state;
}

export function buildVerifyVerdict(input: VerdictInput): VerifyVerdict {
  if (input.absentReason) return absentReceiptVerdict(input);
  const errors = input.errors || [];
  const unsupported = errors.includes('unsupported_version');
  const versionMismatch = errors.includes('version_mismatch') || errors.includes('payload_version_mismatch');
  const idMismatch = errors.includes('id_mismatch') || errors.includes('task_id_mismatch') || errors.includes('receipt_id_mismatch');
  const idPrefix = errors.includes('id_prefix_version_mismatch');
  const intentLegacy = errors.includes('intent_on_legacy_version');
  const legacyForm = errors.includes('legacy_form_not_allowlisted');

  let shape: CheckState = 'pass';
  if (idPrefix || intentLegacy || legacyForm) shape = 'fail';
  else if (unsupported) shape = 'could_not_check';
  else if (versionMismatch || idMismatch) shape = 'fail';

  let signature: CheckState = 'could_not_check';
  if (unsupported) signature = 'could_not_check';
  else if (input.signatureChecked && input.signatureValid === true) signature = 'pass';
  else if (input.signatureChecked && input.signatureValid === false) signature = 'fail';
  else if (input.signatureValid === true) signature = 'pass';

  const historyReason = input.historyReason || null;
  let keyWindow: CheckState = 'could_not_check';
  // A version window refusal does not depend on the history document.
  if (input.historyChecked && historyReason && VERSION_WINDOW_FAIL.has(historyReason) && !input.historyUnreachable) keyWindow = 'fail';
  else if (input.historyMissing || historyReason === 'kid_not_in_history' || input.historyUnreachable) keyWindow = 'could_not_check';
  else if (input.historyChecked && input.historyOk) keyWindow = 'pass';
  else if (input.historyChecked && historyReason && WINDOW_FAIL.has(historyReason)) keyWindow = 'fail';
  else if (input.historyChecked && input.historyOk === false) keyWindow = 'fail';

  // Pass only after the signature was checked and passed. An unchecked or
  // failed signature did not check the payment, so it is not a pass.
  let payment: CheckState = signature === 'pass' ? 'pass' : 'could_not_check';
  const preimageFailed = errors.some((err) => /preimage|payload_hash_mismatch|canonical preimage/.test(err));
  if (signature === 'pass') {
    if ((input.claimMismatches || 0) > 0 || (input.bindingExpected && input.bindingMatches === false) || preimageFailed) payment = 'fail';
    else if (input.payerRequired && input.payerOutcome === 'fail') payment = 'fail';
    else if (input.payerRequired && input.payerOutcome !== 'pass') payment = 'could_not_check';
    else if (!input.payerRequired && input.payerChecked && input.payerValid === false) payment = 'fail';
    else if (input.bindingExpected && input.bindingMatches !== true && !unsupported) payment = 'could_not_check';
    else if (input.paymentUnreachable) payment = 'could_not_check';
  }

  const logInclusion = claimed(input.logInclusion);
  const anchor = claimed(input.anchor);

  const checks = {
    signature,
    key_window: keyWindow,
    payment_binding: payment,
    log_inclusion: logInclusion,
    anchor,
    shape,
  };

  const failed = (Object.keys(checks) as (keyof typeof checks)[]).filter((name) => checks[name] === 'fail');
  const unchecked = (Object.keys(checks) as (keyof typeof checks)[]).filter((name) => checks[name] === 'could_not_check');

  let result: VerdictResult = 'verified';
  let reason: string | null = null;
  if (failed.length) {
    result = 'invalid';
    reason = failReason(failed, historyReason, input.logReason || null, errors, payment, input.claimMismatches || 0);
  } else if (input.failureReason) {
    result = 'invalid';
    reason = input.failureReason;
  } else if (unchecked.length) {
    result = 'could_not_check';
    reason = uncheckedReason(unchecked, historyReason, input.logReason || null, errors);
  }

  const copy = verdictCopy(reason, result);
  const exit_code: 0 | 1 | 2 = result === 'verified' ? 0 : result === 'invalid' ? 1 : 2;
  return {
    result,
    exit_code,
    reason,
    message: copy.message,
    next_step: copy.next_step,
    receipt_id: input.receiptId ?? null,
    display_id: input.displayId ?? null,
    payload_version: input.payloadVersion ?? null,
    checks,
    history: {
      source: input.historySource ?? null,
      head_hash: input.historyHead ?? null,
      entry_count: input.historyCount ?? null,
      as_of: input.historyAsOf ?? null,
    },
    log: input.log ?? null,
    verifier: { name: 'chit402-verify', version: input.version },
  };
}

/** The parts of a library `ReceiptVerification` the verdict reads. */
export interface VerificationVerdictSource {
  errors: string[];
  receipt_version?: number | null;
  issuer_signature: { valid: boolean; checked: boolean; key_trusted?: boolean };
  issuer_history: { checked: boolean; ok: boolean; reason: string | null; document?: unknown; unreachable?: boolean };
  preimages?: { unreachable?: string[] };
  binding: { expected: string | null; matches: boolean };
  claim_mismatches: unknown[];
  payer: { checked: boolean; valid: boolean; reason?: string; outcome?: 'pass' | 'fail' | 'unchecked' };
}

export interface VerificationVerdictContext {
  version: string;
  receiptId?: string | null;
  /** Resolved issuer history. Omitted means only what the result itself loaded. */
  history?: {
    source: 'file' | 'live' | 'bundled' | null;
    headHash: string | null;
    entryCount: number | null;
    asOf: string | null;
    invalid: boolean;
    reason: string | null;
    documentPresent: boolean;
  };
  /** Exit 0 requires the on-chain payer check. The CLI and the library both pass true. */
  payerRequired: boolean;
  logInclusion?: CheckState | 'unclaimed';
  anchor?: CheckState | 'unclaimed';
  logReason?: string | null;
  log?: VerdictLog | null;
  failureReason?: string | null;
}

/**
 * The one mapping from a signed-receipt check to VERIFIED / INVALID /
 * COULD_NOT_CHECK (exit 0 / 1 / 2). The CLI and `verifyReceipt` both call it.
 * A check that did not run is could_not_check, never a pass.
 */
export function verdictFromVerification(
  result: VerificationVerdictSource,
  ctx: VerificationVerdictContext,
): VerifyVerdict {
  const unsupported = (result.errors || []).includes('unsupported_version');
  const history = ctx.history ?? {
    source: null,
    headHash: null,
    entryCount: null,
    asOf: null,
    invalid: false,
    reason: null,
    documentPresent: result.issuer_history.document != null,
  };
  const signatureValid = result.issuer_signature.valid === true
    && result.issuer_signature.key_trusted !== false;
  return buildVerifyVerdict({
    version: ctx.version,
    receiptId: ctx.receiptId ?? null,
    displayId: ctx.receiptId ?? null,
    payloadVersion: result.receipt_version ?? null,
    historySource: history.source,
    historyHead: history.headHash,
    historyCount: history.entryCount,
    historyAsOf: history.asOf,
    signatureValid: unsupported ? null : signatureValid,
    signatureChecked: unsupported ? false : Boolean(result.issuer_signature.checked),
    historyChecked: unsupported ? false : (history.invalid || result.issuer_history.checked),
    historyOk: unsupported ? false : (history.invalid ? false : result.issuer_history.ok),
    historyReason: history.invalid ? (history.reason || result.issuer_history.reason) : result.issuer_history.reason,
    historyMissing: unsupported ? true : (!history.documentPresent && !history.invalid),
    historyUnreachable: !history.invalid && result.issuer_history.unreachable === true,
    paymentUnreachable: (result.preimages?.unreachable?.length ?? 0) > 0,
    bindingExpected: !!result.binding.expected,
    bindingMatches: result.binding.matches,
    claimMismatches: result.claim_mismatches.length,
    payerChecked: result.payer.checked,
    payerValid: result.payer.valid,
    payerRequired: ctx.payerRequired,
    payerOutcome: ctx.payerRequired ? (result.payer.outcome ?? payerCheckOutcome(result.payer)) : null,
    errors: result.errors,
    logInclusion: ctx.logInclusion ?? 'unclaimed',
    anchor: ctx.anchor ?? 'unclaimed',
    logReason: ctx.logReason ?? null,
    log: ctx.log ?? null,
    failureReason: ctx.failureReason ?? null,
  });
}

/**
 * A document with no compact issuer JWS. The CLI and the library give the
 * same verdict: the signature was not checked, so this is COULD_NOT_CHECK
 * (exit 2) unless a log check proved it absent (NOT_IN_LOG, exit 1).
 */
export function unsignedDocumentVerdict(ctx: {
  version: string;
  history?: {
    source: 'file' | 'live' | 'bundled' | null;
    headHash: string | null;
    entryCount: number | null;
    asOf: string | null;
  };
  logInclusion?: CheckState | 'unclaimed';
  anchor?: CheckState | 'unclaimed';
  notInLog?: boolean;
  failureReason?: string | null;
}): VerifyVerdict {
  const notInLog = ctx.notInLog === true;
  return buildVerifyVerdict({
    version: ctx.version,
    receiptId: null,
    displayId: null,
    payloadVersion: null,
    historySource: ctx.history?.source ?? null,
    historyHead: ctx.history?.headHash ?? null,
    historyCount: ctx.history?.entryCount ?? null,
    historyAsOf: ctx.history?.asOf ?? null,
    signatureChecked: false,
    historyReason: notInLog ? null : 'signed_receipt_unavailable',
    historyMissing: false,
    errors: [],
    logInclusion: ctx.logInclusion ?? 'unclaimed',
    anchor: ctx.anchor ?? 'unclaimed',
    logReason: notInLog ? 'not_in_log' : null,
    failureReason: ctx.failureReason ?? null,
  });
}

function absentReceiptVerdict(input: VerdictInput): VerifyVerdict {
  const reason = input.absentReason || 'receipt_unavailable';
  const copy = verdictCopy(reason, 'could_not_check');
  const could: CheckState = 'could_not_check';
  return {
    result: 'could_not_check',
    exit_code: 2,
    reason,
    message: copy.message,
    next_step: copy.next_step,
    receipt_id: null,
    display_id: null,
    payload_version: null,
    checks: {
      signature: could,
      key_window: could,
      payment_binding: could,
      log_inclusion: could,
      anchor: could,
      shape: could,
    },
    history: {
      source: null,
      head_hash: null,
      entry_count: null,
      as_of: null,
    },
    log: null,
    verifier: { name: 'chit402-verify', version: input.version },
  };
}

function failReason(
  failed: string[],
  historyReason: string | null,
  logReason: string | null,
  errors: string[],
  payment: CheckState,
  claimMismatches = 0,
): string {
  if (failed.includes('shape')) {
    if (errors.includes('legacy_form_not_allowlisted')) return 'legacy_form_not_allowlisted';
    if (errors.includes('id_prefix_version_mismatch')) return 'id_prefix_version_mismatch';
    if (errors.includes('intent_on_legacy_version')) return 'intent_on_legacy_version';
    if (errors.includes('version_mismatch') || errors.includes('payload_version_mismatch')) return 'version_mismatch';
    return 'id_mismatch';
  }
  if (failed.includes('signature')) {
    // A JWS of another document type in the receipt slot is reported as such,
    // not as a key or signature problem.
    if (errors.some((err) => /\btyp_mismatch\b/.test(err))) return 'typ_mismatch';
    return errors.find((err) => err === 'key untrusted') || 'signature_invalid';
  }
  if (failed.includes('key_window')) return historyReason || 'key_window';
  if (failed.includes('payment_binding') || payment === 'fail') {
    if (claimMismatches > 0) return 'claim_mismatch';
    return 'payment_mismatch';
  }
  if (failed.includes('log_inclusion')) {
    if (logReason === 'not_in_log') return 'not_in_log';
    return logReason || 'log_inclusion';
  }
  if (failed.includes('anchor')) return logReason || 'anchor';
  return 'invalid';
}

function uncheckedReason(
  unchecked: string[],
  historyReason: string | null,
  logReason: string | null,
  errors: string[],
): string {
  if (unchecked.includes('shape') || errors.includes('unsupported_version')) return 'unsupported_version';
  if (unchecked.includes('key_window')) return historyReason || 'kid_not_in_history';
  if (unchecked.includes('signature')) return 'signature_unchecked';
  if (unchecked.includes('log_inclusion') || unchecked.includes('anchor')) return logReason || 'log_unreachable';
  if (unchecked.includes('payment_binding')) return 'payer_unchecked';
  return 'could_not_check';
}

export function overallLine(verdict: VerifyVerdict, legacyOverall?: string | null): string {
  if (verdict.result === 'verified') return 'VERIFIED';
  if (verdict.result === 'verified_public') return 'VERIFIED_PUBLIC';
  if (verdict.reason === 'not_in_log') return 'NOT_IN_LOG';
  if (verdict.result === 'invalid') return 'INVALID';
  if (legacyOverall === 'pending' || verdict.reason === 'pending' || verdict.reason === 'pending_anchor') return 'PENDING';
  if (legacyOverall === 'partial') return 'PARTIAL';
  return 'COULD_NOT_CHECK';
}

/** Fragment for `https://chit402.com/docs/verify#`. Ids have no spaces. */
export function verdictDocAnchor(reason: string): string {
  if (reason === 'key untrusted') return 'key_untrusted';
  // Documented under the signature section of docs/verify.
  if (reason === 'typ_mismatch') return 'signature_invalid';
  return reason;
}

const CHAIN_LABEL: Record<'base' | 'solana', string> = { base: 'Base', solana: 'Solana' };

/** One line per claimed anchor chain this run did not check (0.4.10). */
export function uncheckedAnchorLines(verdict: VerifyVerdict): string[] {
  const unchecked = verdict.log?.unchecked_anchors || [];
  if (unchecked.length === 0) return [];
  const checked = (['base', 'solana'] as const).filter((chain) => !unchecked.includes(chain));
  return unchecked.map((chain) => {
    const other = checked.length > 0 ? checked.map((c) => CHAIN_LABEL[c]).join(' and ') : null;
    return other
      ? `${CHAIN_LABEL[chain]} not checked: its anchor RPC did not answer. The anchor was confirmed on ${other} only.`
      : `${CHAIN_LABEL[chain]} not checked: its anchor RPC did not answer.`;
  });
}

/**
 * Human lines. COULD_NOT_CHECK says the receipt could not be checked.
 * The message line is `verdict.message`, the same string `--json` prints.
 */
export function humanVerdictLines(verdict: VerifyVerdict): string[] {
  const headline = overallLine(verdict);
  const couldNotCheck = headline === 'COULD_NOT_CHECK';
  const lines = [headline];
  if (verdict.message) lines.push(verdict.message);
  if (couldNotCheck && !/could not be checked/i.test(verdict.message)) {
    lines.push('The receipt could not be checked.');
  }
  if (verdict.result === 'verified_public') {
    lines.push('Scope: public fields only (settled amount, payee, tx, log position). Payer: not claimed.');
    if (verdict.public?.chain_from) lines.push(`On-chain sender (chain fact, not signed): ${verdict.public.chain_from}`);
    lines.push('Details: https://chit402.com/docs/verify#verified_public');
  }
  for (const line of uncheckedAnchorLines(verdict)) lines.push(line);
  if (verdict.log?.fixed_head === 'verified') lines.push('Fixed head (EIP-712): matches the signed tree head.');
  if (verdict.payer_binding) {
    const pb = verdict.payer_binding;
    if (pb.valid) lines.push('Payer binding (EIP-712): matches the signed receipt.');
    else if (pb.checked) lines.push(`Payer binding (EIP-712): does not match the signed receipt (${pb.reason}).`);
    else lines.push(`Payer binding (EIP-712): not checked (${pb.reason}).`);
  }
  if (verdict.reason) lines.push(`Details: https://chit402.com/docs/verify#${verdictDocAnchor(verdict.reason)}`);
  if (verdict.history.source === 'bundled' && verdict.history.as_of) {
    lines.push(`Issuer history: as of ${verdict.history.as_of}`);
  }
  if (verdict.next_step) lines.push(verdict.next_step);
  return lines;
}

/**
 * Reason ids printed as `https://chit402.com/docs/verify#<reason>`.
 * The public page must have one element id for each.
 */
export const VERDICT_DOC_ANCHORS = [
  'not_in_log',
  'signed_receipt_unavailable',
  'unsupported_version',
  'kid_not_in_history',
  'receipt_unavailable',
  'issuer_history_unavailable',
  'log_unreachable',
  'anchor_unreachable',
  'pending_anchor',
  'pending',
  'kid_status_regression',
  'kid_revoked_before_issuance',
  'issued_before_not_before',
  'issued_after_not_after',
  'issued_at_missing',
  'not_before_missing',
  'not_after_invalid',
  'revoked_at_missing',
  'issuer_history_invalid',
  'issuer_history_pin_mismatch',
  'issuer_history_pin_missing',
  'issuer_history_version_mismatch',
  'issuer_history_seq_mismatch',
  'issuer_history_not_extension',
  'signature_invalid',
  'key_untrusted',
  'key_window',
  'version_mismatch',
  'id_mismatch',
  'id_prefix_version_mismatch',
  'intent_on_legacy_version',
  'payment_mismatch',
  'claim_mismatch',
  'payer_unchecked',
  'log_inclusion',
  'anchor',
  'invalid',
  'signature_unchecked',
  'could_not_check',
  'prev_hash_mismatch',
  'entry_hash_mismatch',
  'head_hash_mismatch',
  'introduced_key_signature',
  'inherited_key_window',
  'head_signature_missing',
  'head_signature_invalid',
  'head_claims_mismatch',
  'head_key_untrusted',
  'inclusion_failed',
  'root_mismatch',
  'verified_public',
  'public_attestation_pending',
  'invalid_jws',
  'leaf_not_bound',
  'leaf_index_mismatch',
  'log_epoch_mismatch',
  'transfer_mismatch',
  'public_rail_unsupported',
  'version_window_closed',
  'version_window_not_open',
  'version_window_missing',
  'log_time_after_window',
  'log_time_unavailable',
  'legacy_form_not_allowlisted',
  'payer_binding_invalid',
  'fixed_head_invalid',
] as const;
