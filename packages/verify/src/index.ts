/**
 * @xfuel/verify — Offline verification for Chit402 receipts.
 *
 * Verify payment binding and output commitment WITHOUT calling the Chit402 API.
 * Third parties use this to confirm:
 *   1. The receipt's payment binding matches on-chain settlement
 *   2. The output hash commitment is correct
 *   3. The issuer signature is valid (ES256/JWKS)
 *   4. (Optional) The SP1 nullifier is anchored on-chain
 *
 * See docs/specs/RECEIPT_V2_SEMANTICS.md for the verification algorithm.
 */

import { JsonRpcProvider, Contract, keccak256, toUtf8Bytes } from 'ethers';
import { leafHash, verifyMerkleInclusion, type InclusionStep } from './anchor-witness.js';
import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import {
  computePaymentCommitment,
  computeInferenceBinding,
  type PaymentCommitmentInput,
  type InferenceBindingInput,
} from './binding.js';
import {
  verifyBasePayer,
  parseBasePaymentRef,
  isEvmAddress,
  sumUsdcTransfersFromPayer,
  fetchBaseTransactionReceipt,
  USDC_ADDRESSES,
  ERC20_TRANSFER_TOPIC,
  BASE_RPC_URL,
  type BasePayerVerification,
  type BaseReceiptFetcher,
} from './base-payer.js';
import {
  verifySolanaPayer,
  parseSolanaPaymentRef,
  isSolanaBase58Pubkey,
  extractUsdcTransfersFromTx,
  inferUsdcOutflowFromBalances,
  fetchSolanaTransaction,
  SOLANA_RPC_URL,
  SOLANA_USDC_MINT_MAINNET,
  SOLANA_USDC_MINT_DEVNET,
  type SolanaPayerVerification,
  type SolanaRpcFetcher,
  type SolanaRpcGetTransactionResult,
} from './solana-payer.js';
import {
  verifyPayerBinding,
  receiptPayerClaimsFromEnvelope,
  decodeJwsPayload,
  type PayerBindingVerification,
  type ReceiptPayerClaims,
  type PayerRail,
} from './payer.js';
import {
  resolvePinnedIssuerJwk,
  verifyIssuerJws,
  DEFAULT_TRUSTED_ISSUER_KIDS,
  DEFAULT_TRUSTED_JWKS_HOSTS,
  KEY_UNTRUSTED,
  jwkThumbprint,
  isEs256PublicJwk,
  isPinnedTrustedJwk,
  readJwsHeader,
  jwksHostAllowed,
} from './jws.js';
import {
  headBindingVerdict,
  outerHeadDisagrees,
  signedHeadBinding,
} from './head-binding.js';
import {
  receiptLaneFromVerification,
  type ReceiptLane,
  type ReceiptTreeHead,
} from './receipt-lane.js';
import { isRefusalDocument, REFUSAL_SCHEMA } from './refusal.js';
import { verifyPublishedPreimages, type PreimageCheck } from './preimage.js';
import {
  checkReceiptIssuerHistory,
  readIssuerHistoryPin,
  type IssuerHistoryCheck,
  type IssuerHistoryDocument,
} from './issuer-history.js';
import { verifyCanonicalPreimageBytes, CANONICAL_PAYLOAD_VERSION } from './canonical-preimage.js';

export {
  computePaymentCommitment,
  computeInferenceBinding,
  type PaymentCommitmentInput,
  type InferenceBindingInput,
  verifyBasePayer,
  parseBasePaymentRef,
  isEvmAddress,
  sumUsdcTransfersFromPayer,
  fetchBaseTransactionReceipt,
  USDC_ADDRESSES,
  ERC20_TRANSFER_TOPIC,
  BASE_RPC_URL,
  type BasePayerVerification,
  type BaseReceiptFetcher,
  verifySolanaPayer,
  parseSolanaPaymentRef,
  isSolanaBase58Pubkey,
  extractUsdcTransfersFromTx,
  inferUsdcOutflowFromBalances,
  fetchSolanaTransaction,
  SOLANA_RPC_URL,
  SOLANA_USDC_MINT_MAINNET,
  SOLANA_USDC_MINT_DEVNET,
  type SolanaPayerVerification,
  type SolanaRpcFetcher,
  type SolanaRpcGetTransactionResult,
  verifyPayerBinding,
  receiptPayerClaimsFromEnvelope,
  decodeJwsPayload,
  type PayerBindingVerification,
  type ReceiptPayerClaims,
  type PayerRail,
};

/** ZKVerifierSP1 contract on Base mainnet. */
export const ZK_VERIFIER_ADDRESS = '0x9373499645292715a2275A78eD65B14215C41c06';

/** Base Sepolia testnet RPC. */
export const BASE_SEPOLIA_RPC_URL = 'https://sepolia.base.org';

/** Minimal ABI for nullifier check. */
const ZK_VERIFIER_ABI = [
  'function usedNullifiers(bytes32) view returns (bool)',
];

/** Chit402 receipt (v2/v3 compatible). */
export interface XFuelReceipt {
  schema?: string;
  task_id: string;
  created_at?: number | string;
  status: string;
  proof_outcome?: string;
  verify_url?: string;
  route?: {
    model?: string;
    provider?: string;
    model_commitment?: {
      commitment?: string;
    } | null;
  };
  payment?: {
    rail?: string;
    ref?: string | null;
    gross_amount?: string | null;
    settled_amount?: string | null;
    net_amount?: string | null;
    fee_amount?: string | null;
    fee_bps?: number | null;
    protocol_fee_bps?: number | null;
    platform_fee?: string | null;
    platform_fee_bps?: number | null;
    asset?: string | null;
    payee?: string | null;
    accounting?: {
      kind?: string;
      scope?: string;
      note?: string;
      internal_breakdown?: {
        route_margin_bps?: number | null;
        route_margin_amount?: string | null;
        receipt_floor_amount?: string | null;
        provider_cogs_amount?: string | null;
        tier2_proof_amount?: string | null;
      };
    } | null;
  };
  payment_meta?: {
    network?: string;
  } | null;
  provider_cogs?: {
    actual?: string;
  };
  output?: {
    hash?: string;
    kind?: string;
  } | null;
  proof?: {
    tier?: string;
    has_proof?: boolean;
    nullifier?: string | null;
  };
  binding?: {
    expected_commitment?: string;
    recomputed_commitment?: string;
    matches?: boolean;
    covers?: string[];
    model_commitment?: string | null;
    output_hash?: string | null;
    amount?: string;
    rail?: string;
  } | null;
  signature?: {
    alg?: string;
    value?: string;
    payload_version?: number;
  };
  hmac_attestation?: {
    payload_version?: number;
  };
  issuer_signature?: {
    alg?: string;
    value?: string;
    kid?: string;
    jws?: string;
    payload_version?: number;
    payload_hash?: string;
    canonical_preimage?: string;
    issuer_jwk?: Es256Jwk;
  };
  verification?: {
    source_of_truth?: string;
    jwks_uri?: string;
    issuer_jwk_pin?: string;
    offline_key_source?: string;
  };
  caller_binding?: {
    payer_wallet?: string | null;
    agent_pubkey?: string | null;
    api_key_hash?: string | null;
    agent_id?: string | number | null;
  } | null;
  /** Book agent_id. Present on claim_id-era JWS payloads. Absent on older v8 receipts. */
  claim_id?: string | null;
  /**
   * v9. Transparency-log head hash inside the issuer JWS. The outer copy is
   * display only. Absent on v8 and earlier.
   */
  tree_head_hash?: string | null;
  /** v9. Clock tolerance bound inside the issuer JWS. Absent on v8 and earlier. */
  tolerance?: { base?: number; solana?: number } | null;
  /** Append position. Unsigned relative to the payment JWS; signed inside book_chain. */
  book_seq?: number | null;
  book_chain?: { seq?: number | null; row_hash?: string | null } | null;
  /** Unsigned derived refusal section. Ignored by signature verification. */
  receipt_lane?: {
    anchor_at_binding?: {
      root: string | null;
      tree_size: number | null;
      anchor_tx: string | null;
      solana_signature: string | null;
    } | null;
    anchor_current?: {
      root: string | null;
      tree_size: number | null;
      anchor_tx: string | null;
      solana_signature: string | null;
    } | null;
    freeze?: boolean;
    anchor_changed_since_binding?: boolean | null;
  } | null;
  tree_head?: ReceiptTreeHead | null;
  head?: ReceiptTreeHead | null;
}

/** JWK public key for ES256 verification. */
export interface Es256Jwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
  kid?: string;
  alg?: string;
  use?: string;
}

/** JWKS (JSON Web Key Set) structure. */
export interface Jwks {
  keys: Es256Jwk[];
}

/** Result of ECDSA signature verification. */
export interface IssuerSignatureVerification {
  /** Whether an issuer signature was present to check. */
  checked: boolean;
  /** True only when the signature verifies under a trusted key. */
  valid: boolean;
  /** Key ID from the signature. */
  kid?: string;
  /** Reason for failure when valid=false. `key untrusted` means the verifying key is not in the trust set. */
  reason?: string;
  /** True when the key used (or the only candidate key) is in the trust set. */
  key_trusted?: boolean;
  /** How the verifying key was trusted, when valid. */
  trust?: 'jwks' | 'pinned_kid';
  /** Verified JWS claims. Present only when valid is true. */
  payload?: Record<string, unknown>;
}

/** Outer unsigned field disagrees with the JWS payload. */
export interface ClaimMismatch {
  field: string;
  outer: string | null;
  signed: string | null;
}

export interface BindingVerification {
  verified: boolean;
  expected: string | null;
  recomputed: string | null;
  matches: boolean;
  covers: string[];
  reason?: string;
}

export interface NullifierVerification {
  verified: boolean;
  nullifier: string | null;
  anchored: boolean | null;
  reason?: string;
}

export interface PayerVerification {
  checked: boolean;
  valid: boolean;
  rail?: PayerRail;
  reason?: string;
  payer_wallet?: string | null;
  payee?: string | null;
  asset?: string | null;
  amount?: string | null;
}

export interface ReceiptVerification {
  receipt_id: string;
  binding: BindingVerification;
  issuer_signature: IssuerSignatureVerification;
  payer: PayerVerification;
  nullifier: NullifierVerification;
  output_hash: string | null;
  hub: string | null;
  model: string | null;
  /** Gross amount from verified signed claims, in atomic USDC. Null when the signature is not trusted. */
  amount_usdc: string | null;
  /** Settlement ref from verified signed claims. Null when the signature is not trusted. */
  tx: string | null;
  /** Unsigned outer fields that disagree with the JWS payload. */
  claim_mismatches: ClaimMismatch[];
  /**
   * `not_present_legacy` — v8 (or older) payload with no claim_id key. Still verifies.
   * `ok` — claim_id-era payload, and a payment.ref is paired with a seat.
   * `refused` — claim_id-era payload, payment.ref set, claim_id null.
   */
  claim_id: 'not_present_legacy' | 'ok' | 'refused';
  /**
   * v9 head binding from verified claims only. Null when the signature is not
   * trusted, when the payload is v8 or earlier, or when the pair is missing.
   * Never copied from the unsigned outer fields.
   */
  head_binding: {
    tree_head_hash: string | null;
    tolerance: unknown;
  } | null;
  /**
   * Unsigned refusal decision beside book_seq. Not part of the payment JWS.
   * freeze is true only for an unsettled receipt-lane row whose anchor changed
   * after binding. It does not change `overall`.
   */
  receipt_lane: ReceiptLane;
  /** Recompute of published preimages. Absent block is skipped unless requirePreimages. */
  preimages: PreimageCheck;
  /** Kid window against the signed issuer history. Unreachable is a warning unless strict. */
  issuer_history: IssuerHistoryCheck;
  warnings: string[];
  overall: 'verified' | 'partial' | 'failed';
  errors: string[];
}

/**
 * HMAC payload version.
 * Versions <= 7 keep the historical net/fee field list.
 * Version 8 signs settled_amount plus the internal accounting breakdown.
 * Lockstep with `canonicalPayloadVersion` in services/gateway/src/receipt.js
 * for the v8 list (the v7 list here is the historical 15-field public formula).
 */
export function canonicalPayloadVersion(receipt: XFuelReceipt): number {
  const stamped = receipt.hmac_attestation?.payload_version
    ?? receipt.signature?.payload_version;
  if (stamped != null) return Number(stamped);
  const issuerV = receipt.issuer_signature?.payload_version;
  if (issuerV != null) return Number(issuerV);
  const payment = receipt.payment;
  if (payment?.accounting || (payment && Object.prototype.hasOwnProperty.call(payment, 'settled_amount'))) {
    return 8;
  }
  return 7;
}

function canonicalFieldsV7(receipt: XFuelReceipt): unknown[] {
  return [
    receipt.task_id ?? null,
    receipt.payment?.rail ?? null,
    receipt.payment?.ref ?? null,
    receipt.payment?.gross_amount ?? null,
    receipt.payment?.net_amount ?? null,
    receipt.payment?.fee_amount ?? null,
    receipt.payment?.protocol_fee_bps ?? receipt.payment?.fee_bps ?? null,
    receipt.payment?.platform_fee ?? null,
    receipt.payment?.platform_fee_bps ?? null,
    receipt.provider_cogs?.actual ?? null,
    receipt.route?.model ?? null,
    receipt.route?.model_commitment?.commitment ?? null,
    receipt.route?.provider ?? null,
    receipt.output?.hash ?? null,
    receipt.binding?.expected_commitment ?? null,
  ];
}

function canonicalFieldsV8(receipt: XFuelReceipt): unknown[] {
  const breakdown = receipt.payment?.accounting?.internal_breakdown;
  const caller = receipt.caller_binding;
  return [
    receipt.task_id ?? null,
    receipt.payment?.rail ?? null,
    receipt.payment?.ref ?? null,
    receipt.payment?.gross_amount ?? null,
    receipt.payment?.settled_amount ?? null,
    breakdown?.route_margin_bps ?? null,
    breakdown?.route_margin_amount ?? null,
    breakdown?.receipt_floor_amount ?? null,
    breakdown?.provider_cogs_amount ?? null,
    breakdown?.tier2_proof_amount ?? null,
    receipt.provider_cogs?.actual ?? null,
    receipt.route?.model ?? null,
    receipt.route?.model_commitment?.commitment ?? null,
    receipt.route?.provider ?? null,
    receipt.output?.hash ?? null,
    receipt.binding?.expected_commitment ?? null,
    caller?.payer_wallet ?? null,
    caller?.agent_pubkey ?? null,
    caller?.api_key_hash ?? null,
  ];
}

/**
 * Canonical, order-stable payload an HMAC issuer signature covers.
 * v8 matches `canonicalSignedPayload` in services/gateway/src/receipt.js.
 * v7 and earlier stay on the historical 15-field list so old signatures verify.
 */
export function canonicalIssuerPayload(receipt: XFuelReceipt): string {
  const fields = canonicalPayloadVersion(receipt) >= 8
    ? canonicalFieldsV8(receipt)
    : canonicalFieldsV7(receipt);
  return JSON.stringify(fields);
}

export interface TransferLog {
  address?: string;
  topics?: string[];
  data?: string;
}

export interface SettledAmountReconciliation {
  checked: boolean;
  /** True when the signed settled/net amount equals the USDC Transfer to payee. */
  matches: boolean;
  payload_version: number;
  signed_field: 'settled_amount' | 'gross_amount' | 'net_amount' | null;
  signed_amount: string | null;
  transfer_amount: string | null;
  payee: string | null;
  reason?: string;
}

function topicAddress(topic: string): string {
  const hex = topic.toLowerCase().replace(/^0x/, '');
  return `0x${hex.slice(-40)}`;
}

/**
 * Sum USDC Transfer values to `payee` in a transaction's logs.
 * Non-Transfer logs are ignored. When `usdcAddress` is set, other contracts are ignored.
 */
export function sumUsdcTransfersToPayee(
  logs: TransferLog[] | null | undefined,
  payee: string,
  usdcAddress?: string,
): bigint | null {
  if (!payee || !isEvmAddress(payee)) return null;
  const payeeLower = payee.toLowerCase();
  const usdcLower = usdcAddress?.toLowerCase();
  let total = 0n;
  let found = false;
  for (const log of logs || []) {
    if (usdcLower && log.address?.toLowerCase() !== usdcLower) continue;
    const topics = log.topics || [];
    if (topics[0]?.toLowerCase() !== ERC20_TRANSFER_TOPIC) continue;
    if (topics.length < 3 || !topics[2]) continue;
    if (topicAddress(topics[2]) !== payeeLower) continue;
    found = true;
    total += BigInt(log.data || '0x0');
  }
  return found ? total : null;
}

export interface ReconcileSettledTransferOptions {
  usdcAddress?: string;
  /** JWKS treated as a trust root. Keys are matched by `kid`. */
  jwks?: Jwks;
  /**
   * RFC 7638 thumbprints allowed as an offline pin.
   * Omit to use the default production pin. Pass `[]` to disable the pin.
   */
  trustedKids?: readonly string[];
}

/**
 * Payment facts for on-chain reconciliation.
 * A JWS is used only after `verifyIssuerSignatureWithJwks` accepts the key.
 * An untrusted or invalid JWS is not decoded into the comparison, and the
 * unsigned outer `payment` copy is not a fallback for those claims.
 * Receipts with no JWS still use the outer payment (legacy envelopes).
 */
function trustedPaymentForReconcile(
  receipt: XFuelReceipt,
  options: ReconcileSettledTransferOptions,
): { ok: true; version: number; payment: NonNullable<XFuelReceipt['payment']> }
  | { ok: false; version: number; reason: string } {
  const outerVersion = Number(
    receipt.issuer_signature?.payload_version ?? canonicalPayloadVersion(receipt),
  );
  const jws = receipt.issuer_signature?.jws;
  if (!jws) {
    return { ok: true, version: outerVersion, payment: receipt.payment || {} };
  }

  const verification = verifyIssuerSignatureWithJwks(receipt, options.jwks, {
    trustedKids: options.trustedKids,
  });
  if (!verification.valid || verification.key_trusted === false) {
    return {
      ok: false,
      version: outerVersion,
      reason: verification.reason || KEY_UNTRUSTED,
    };
  }

  const claims = verification.payload;
  const claimPayment = (claims?.payment && typeof claims.payment === 'object')
    ? claims.payment as NonNullable<XFuelReceipt['payment']>
    : null;
  if (!claimPayment) {
    return { ok: false, version: outerVersion, reason: 'no_signed_amount' };
  }
  const version = typeof claims?.payload_version === 'number'
    ? claims.payload_version
    : outerVersion;
  return { ok: true, version: Number(version), payment: claimPayment };
}

/**
 * Optional on-chain reconciliation. Given a tx receipt's logs, the signed
 * amount the payee was supposed to receive must equal the USDC Transfer to payee.
 *
 * The amount and payee come from JWS claims only after a key-trust check
 * (JWKS by kid, or an embedded key whose thumbprint is a pinned kid). An
 * untrusted signature does not contribute those facts.
 *
 * v8 compares `settled_amount` (falling back to `gross_amount`): that is the
 * on-chain transfer. v7 and earlier compare `net_amount`, which those receipts
 * defined as "amount after fees". A single direct transfer of gross will not
 * match a net that subtracts a fee that never moved on chain.
 */
export function reconcileSettledTransfer(
  receipt: XFuelReceipt,
  logs: TransferLog[] | null | undefined,
  options: ReconcileSettledTransferOptions = {},
): SettledAmountReconciliation {
  const trusted = trustedPaymentForReconcile(receipt, options);
  if (!trusted.ok) {
    return {
      checked: false,
      matches: false,
      payload_version: trusted.version,
      signed_field: null,
      signed_amount: null,
      transfer_amount: null,
      payee: null,
      reason: trusted.reason,
    };
  }
  const { version, payment } = trusted;
  const payee = payment.payee ?? null;
  let signed_field: SettledAmountReconciliation['signed_field'] = null;
  let signed_amount: string | null = null;
  if (version >= 8) {
    if (payment.settled_amount != null && payment.settled_amount !== '') {
      signed_field = 'settled_amount';
      signed_amount = String(payment.settled_amount);
    } else if (payment.gross_amount != null && payment.gross_amount !== '') {
      signed_field = 'gross_amount';
      signed_amount = String(payment.gross_amount);
    }
  } else {
    signed_field = 'net_amount';
    signed_amount = payment.net_amount != null ? String(payment.net_amount) : null;
  }

  if (!payee || !isEvmAddress(payee)) {
    return {
      checked: false,
      matches: false,
      payload_version: version,
      signed_field,
      signed_amount,
      transfer_amount: null,
      payee,
      reason: 'no_payee',
    };
  }
  if (signed_amount == null) {
    return {
      checked: false,
      matches: false,
      payload_version: version,
      signed_field,
      signed_amount,
      transfer_amount: null,
      payee,
      reason: 'no_signed_amount',
    };
  }

  const transfer = sumUsdcTransfersToPayee(logs, payee, options.usdcAddress);
  if (transfer == null) {
    return {
      checked: true,
      matches: false,
      payload_version: version,
      signed_field,
      signed_amount,
      transfer_amount: null,
      payee,
      reason: 'no_transfer_to_payee',
    };
  }

  const matches = BigInt(signed_amount) === transfer;
  return {
    checked: true,
    matches,
    payload_version: version,
    signed_field,
    signed_amount,
    transfer_amount: transfer.toString(),
    payee,
    reason: matches
      ? undefined
      : `amount_mismatch: signed ${signed_field} ${signed_amount} !== transfer ${transfer.toString()}`,
  };
}

/**
 * Verify a receipt's ES256 issuer signature against a JWK (public key).
 * This is the public-key verification path — no shared secret required.
 *
 * Verification steps:
 *   1. GET /receipt/:taskId?format=json → receipt.issuer_signature
 *   2. GET /.well-known/jwks.json → find key matching issuer_signature.kid
 *   3. ES256 verify canonicalIssuerPayload(receipt) against the signature
 *
 * @param receipt - Receipt JSON with issuer_signature
 * @param jwk - JWK public key { kty: 'EC', crv: 'P-256', x, y }
 */
export function verifyIssuerSignature(
  receipt: XFuelReceipt,
  jwk: Es256Jwk,
): IssuerSignatureVerification {
  const sig = receipt.issuer_signature;
  if (!sig || !sig.value) {
    return { checked: false, valid: false, reason: 'no_issuer_signature' };
  }
  if (sig.alg !== 'ES256') {
    return { checked: false, valid: false, reason: `unsupported_alg: ${sig.alg}` };
  }
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256') {
    return { checked: false, valid: false, reason: 'invalid_jwk' };
  }
  if (sig.kid && jwk.kid && sig.kid !== jwk.kid) {
    return { checked: false, valid: false, reason: 'kid_mismatch' };
  }

  try {
    const jwkInput = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } as const;
    const publicKey: KeyObject = createPublicKey({ key: jwkInput, format: 'jwk' });
    const signature = Buffer.from(sig.value, 'base64url');
    const payload = canonicalIssuerPayload(receipt);
    const valid = verify('sha256', Buffer.from(payload, 'utf8'), {
      key: publicKey,
      dsaEncoding: 'ieee-p1363',
    }, signature);
    return { checked: true, valid, kid: sig.kid };
  } catch (err) {
    return { checked: true, valid: false, kid: sig.kid, reason: `verify_error: ${(err as Error).message}` };
  }
}

/**
 * Verify a receipt's ES256 issuer signature against a JWKS (key set).
 * Finds the matching key by kid and verifies.
 *
 * @param receipt - Receipt JSON with issuer_signature
 * @param jwks - JWKS with keys array
 */
function jwksCandidates(jwks: Jwks | undefined, kid: string | undefined): Es256Jwk[] {
  const keys = jwks?.keys || [];
  const es256 = keys.filter((k) => isEs256PublicJwk(k) && (k.alg == null || k.alg === 'ES256'));
  if (!kid) return es256;
  return es256.filter((k) => k.kid === kid);
}

/**
 * Verify an issuer signature against trusted keys only.
 *
 * Trust, in order:
 *   1. A JWKS entry matched by `kid` (supplied file or fetched issuer JWKS).
 *   2. An embedded `issuer_jwk` whose RFC 7638 thumbprint equals a pinned trusted kid.
 *
 * An embedded key that merely verifies the bytes is `key untrusted`.
 */
export function verifyIssuerSignatureWithJwks(
  receipt: XFuelReceipt,
  jwks?: Jwks,
  options: { trustedKids?: readonly string[] } = {},
): IssuerSignatureVerification {
  const sig = receipt.issuer_signature;
  if (!sig) {
    return { checked: false, valid: false, key_trusted: false, reason: 'no_issuer_signature' };
  }

  const trustedKids = options.trustedKids ?? DEFAULT_TRUSTED_ISSUER_KIDS;
  const header = sig.jws ? readJwsHeader(sig.jws) : null;
  const kid = header?.kid || sig.kid;
  const embedded = resolvePinnedIssuerJwk(receipt);
  const pinned = !!(embedded && isPinnedTrustedJwk(embedded, trustedKids));

  if (sig.jws) {
    const fromJwks = jwksCandidates(jwks, kid);
    for (const jwk of fromJwks) {
      const jwsResult = verifyIssuerJws(sig.jws, jwk);
      if (jwsResult.valid) {
        return {
          checked: true,
          valid: true,
          key_trusted: true,
          trust: 'jwks',
          kid: jwk.kid || kid,
          payload: jwsResult.payload,
        };
      }
    }

    if (pinned && embedded) {
      const pinResult = verifyIssuerJws(sig.jws, embedded);
      if (pinResult.valid) {
        return {
          checked: true,
          valid: true,
          key_trusted: true,
          trust: 'pinned_kid',
          kid: embedded.kid || jwkThumbprint(embedded),
          payload: pinResult.payload,
        };
      }
      return {
        checked: true,
        valid: false,
        key_trusted: true,
        kid: kid || embedded.kid,
        reason: pinResult.reason || 'signature_invalid',
      };
    }

    if (embedded && verifyIssuerJws(sig.jws, embedded).valid) {
      return {
        checked: true,
        valid: false,
        key_trusted: false,
        kid: embedded.kid || kid,
        reason: KEY_UNTRUSTED,
      };
    }

    if (fromJwks.length === 0 && !pinned) {
      return {
        checked: true,
        valid: false,
        key_trusted: false,
        kid,
        reason: KEY_UNTRUSTED,
      };
    }

    return {
      checked: true,
      valid: false,
      key_trusted: fromJwks.length > 0 || pinned,
      kid,
      reason: 'signature_invalid',
    };
  }

  if (!sig.value) {
    return { checked: false, valid: false, key_trusted: false, reason: 'no_issuer_signature' };
  }
  if (!jwks || !Array.isArray(jwks.keys)) {
    return {
      checked: false,
      valid: false,
      key_trusted: false,
      kid: sig.kid,
      reason: 'JWKS not provided — pass jwks option to verify issuer signature',
    };
  }
  if (jwks.keys.length === 0) {
    return { checked: false, valid: false, key_trusted: false, kid: sig.kid, reason: 'empty_jwks' };
  }

  // Find matching key by kid, or try all ES256 keys if no kid on signature
  const candidates = sig.kid
    ? jwks.keys.filter(k => k.kid === sig.kid && k.alg === 'ES256')
    : jwks.keys.filter(k => k.alg === 'ES256');

  if (candidates.length === 0) {
    return { checked: false, valid: false, key_trusted: false, kid: sig.kid, reason: 'no_matching_key' };
  }

  for (const jwk of candidates) {
    const result = verifyIssuerSignature(receipt, jwk);
    if (result.valid) {
      return { ...result, key_trusted: true, trust: 'jwks', kid: jwk.kid || sig.kid };
    }
  }
  return { checked: true, valid: false, key_trusted: true, kid: sig.kid, reason: 'signature_invalid' };
}

/**
 * Verify a receipt's payment binding locally (no network required).
 *
 * This recomputes the commitment from the receipt's fields and compares
 * it to the stored `binding.expected_commitment`.
 */
function noCommitmentReason(rail: string | null | undefined): string {
  if (rail === 'unmetered' || rail === 'tfuel') {
    return 'No binding present on receipt (unmetered or TFUEL rail)';
  }
  if (rail === 'usdc' || rail === 'reported') {
    return 'No payment-binding commitment (expected_commitment is null)';
  }
  return 'No binding present on receipt (may be unmetered or TFUEL rail)';
}

export function verifyBinding(receipt: XFuelReceipt): BindingVerification {
  const binding = receipt.binding;
  const railHint = binding?.rail || receipt.payment?.rail || null;
  if (!binding) {
    return {
      verified: false,
      expected: null,
      recomputed: null,
      matches: false,
      covers: [],
      reason: noCommitmentReason(railHint),
    };
  }

  if (binding.expected_commitment == null || binding.expected_commitment === '') {
    return {
      verified: false,
      expected: null,
      recomputed: null,
      matches: false,
      covers: binding.covers || [],
      reason: noCommitmentReason(railHint),
    };
  }

  const paymentRef = receipt.payment?.ref ?? null;
  const taskId = receipt.task_id;
  const rail = (binding.rail || receipt.payment?.rail || 'usdc') as 'usdc' | 'tfuel';
  const amount = binding.amount || receipt.payment?.net_amount || '0';
  const covers = binding.covers || ['payment', 'settlement'];

  // Determine if this is a PBR (includes model + output)
  const bindsInference = covers.includes('inference') ||
    !!(binding.model_commitment && binding.output_hash);

  let recomputed: string;
  try {
    if (bindsInference) {
      const result = computeInferenceBinding({
        paymentRef,
        taskId,
        rail,
        amount,
        modelCommitment: binding.model_commitment,
        outputHash: binding.output_hash,
      });
      recomputed = result.commitment;
    } else {
      const result = computePaymentCommitment({
        paymentRef,
        taskId,
        rail,
        amount,
      });
      recomputed = result.commitment;
    }
  } catch (err) {
    return {
      verified: false,
      expected: binding.expected_commitment || null,
      recomputed: null,
      matches: false,
      covers,
      reason: `Failed to recompute commitment: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const expected = binding.expected_commitment || null;
  const matches = !!(
    expected &&
    recomputed &&
    expected.toLowerCase() === recomputed.toLowerCase()
  );

  return {
    verified: true,
    expected,
    recomputed,
    matches,
    covers,
    reason: matches ? undefined : 'Commitment mismatch — receipt may be tampered',
  };
}

/**
 * Verify a receipt's nullifier is anchored on-chain.
 *
 * Requires network access to the Base RPC.
 */
export async function verifyNullifier(
  receipt: XFuelReceipt,
  options: { rpcUrl?: string; verifierAddress?: string } = {},
): Promise<NullifierVerification> {
  const nullifier = receipt.proof?.nullifier ?? null;

  if (!nullifier) {
    return {
      verified: false,
      nullifier: null,
      anchored: null,
      reason: 'No nullifier present (Tier-1 receipt or proof pending)',
    };
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(nullifier)) {
    return {
      verified: false,
      nullifier,
      anchored: null,
      reason: 'Invalid nullifier format',
    };
  }

  const rpcUrl = options.rpcUrl || BASE_RPC_URL;
  const verifierAddress = options.verifierAddress || ZK_VERIFIER_ADDRESS;

  try {
    const provider = new JsonRpcProvider(rpcUrl);
    const contract = new Contract(verifierAddress, ZK_VERIFIER_ABI, provider);
    const isUsed: boolean = await contract.usedNullifiers(nullifier);

    return {
      verified: true,
      nullifier,
      anchored: isUsed,
      reason: isUsed ? undefined : 'Nullifier not found on-chain (proof may not be submitted yet)',
    };
  } catch (err) {
    return {
      verified: false,
      nullifier,
      anchored: null,
      reason: `Chain query failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Canonical signed payload for HMAC verification.
 * Alias of canonicalIssuerPayload — both must produce identical bytes.
 */
export const canonicalSignedPayload = canonicalIssuerPayload;

/**
 * Hash the canonical payload (for ERC-8004 response_hash).
 */
export function hashCanonicalPayload(receipt: XFuelReceipt): string {
  return keccak256(toUtf8Bytes(canonicalSignedPayload(receipt)));
}

/**
 * claim_id-era receipts include the key even when the value is null.
 * Older payloads omit the key and stay valid.
 */
export function claimIdVerdict(
  claims: Record<string, unknown> | null | undefined,
): 'not_present_legacy' | 'ok' | 'refused' {
  if (!claims || !Object.prototype.hasOwnProperty.call(claims, 'claim_id')) {
    return 'not_present_legacy';
  }
  const payment = asRecord(claims.payment);
  const ref = payment?.ref;
  const hasRef = ref != null && String(ref) !== '';
  const id = claims.claim_id;
  const missing = id == null || id === '';
  if (hasRef && missing) return 'refused';
  return 'ok';
}

function claimString(value: unknown): string | null {
  if (value == null || value === '') return null;
  return String(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normFact(value: unknown, address = false): string | null {
  const text = claimString(value);
  if (text == null) return null;
  return address ? text.toLowerCase() : text;
}

/**
 * Fields a verifier may quote. Compared only when both the unsigned outer
 * copy and the JWS payload carry a value.
 */
const CLAIM_COMPARE: Array<{
  field: string;
  outer: (receipt: XFuelReceipt) => unknown;
  signed: (claims: Record<string, unknown>) => unknown;
  address?: boolean;
}> = [
  { field: 'task_id', outer: (r) => r.task_id, signed: (c) => c.task_id },
  { field: 'payment.rail', outer: (r) => r.payment?.rail, signed: (c) => asRecord(c.payment)?.rail },
  { field: 'payment.ref', outer: (r) => r.payment?.ref, signed: (c) => asRecord(c.payment)?.ref },
  { field: 'payment.gross_amount', outer: (r) => r.payment?.gross_amount, signed: (c) => asRecord(c.payment)?.gross_amount },
  { field: 'payment.settled_amount', outer: (r) => r.payment?.settled_amount, signed: (c) => asRecord(c.payment)?.settled_amount },
  { field: 'payment.net_amount', outer: (r) => r.payment?.net_amount, signed: (c) => asRecord(c.payment)?.net_amount },
  { field: 'payment.asset', outer: (r) => r.payment?.asset, signed: (c) => asRecord(c.payment)?.asset, address: true },
  { field: 'payment.payee', outer: (r) => r.payment?.payee, signed: (c) => asRecord(c.payment)?.payee, address: true },
  { field: 'caller_binding.payer_wallet', outer: (r) => r.caller_binding?.payer_wallet, signed: (c) => asRecord(c.caller_binding)?.payer_wallet, address: true },
  { field: 'caller_binding.agent_pubkey', outer: (r) => r.caller_binding?.agent_pubkey, signed: (c) => asRecord(c.caller_binding)?.agent_pubkey },
  { field: 'caller_binding.api_key_hash', outer: (r) => r.caller_binding?.api_key_hash, signed: (c) => asRecord(c.caller_binding)?.api_key_hash },
  { field: 'claim_id', outer: (r) => r.claim_id, signed: (c) => c.claim_id },
  { field: 'route.model', outer: (r) => r.route?.model, signed: (c) => asRecord(c.route)?.model },
  { field: 'route.provider', outer: (r) => r.route?.provider, signed: (c) => asRecord(c.route)?.provider },
  { field: 'output.hash', outer: (r) => r.output?.hash, signed: (c) => asRecord(c.output)?.hash },
  { field: 'binding.expected_commitment', outer: (r) => r.binding?.expected_commitment, signed: (c) => asRecord(c.binding)?.expected_commitment },
  { field: 'provider_cogs.actual', outer: (r) => r.provider_cogs?.actual, signed: (c) => asRecord(c.provider_cogs)?.actual },
];

/** Flag unsigned outer copies that disagree with the JWS payload. */
export function diffOuterClaims(receipt: XFuelReceipt, claims: Record<string, unknown> | null): ClaimMismatch[] {
  if (!claims) return [];
  const mismatches: ClaimMismatch[] = [];
  for (const spec of CLAIM_COMPARE) {
    const outer = normFact(spec.outer(receipt), spec.address);
    const signed = normFact(spec.signed(claims), spec.address);
    if (outer == null || signed == null || outer === signed) continue;
    mismatches.push({
      field: spec.field,
      outer: claimString(spec.outer(receipt)),
      signed: claimString(spec.signed(claims)),
    });
  }
  // v9 head pair. Compared when the outer key is present, including a null
  // signed hash against a filled-in outer copy. v8 claims skip this.
  if (headBindingVerdict(claims) === 'ok') {
    const disagree = outerHeadDisagrees(receipt, claims);
    if (disagree) {
      const outerValue = disagree === 'tree_head_hash' ? receipt.tree_head_hash : receipt.tolerance;
      const signedValue = disagree === 'tree_head_hash' ? claims.tree_head_hash : claims.tolerance;
      mismatches.push({
        field: disagree,
        outer: outerValue == null ? null : JSON.stringify(outerValue),
        signed: signedValue == null ? null : JSON.stringify(signedValue),
      });
    }
  }
  return mismatches;
}

function receiptViewFromClaims(receipt: XFuelReceipt, claims: Record<string, unknown>): XFuelReceipt {
  const payment = asRecord(claims.payment);
  const binding = asRecord(claims.binding);
  const route = asRecord(claims.route);
  const output = asRecord(claims.output);
  const caller = asRecord(claims.caller_binding);
  const modelCommitment = claimString(route?.model_commitment);
  return {
    ...receipt,
    task_id: claimString(claims.task_id) || receipt.task_id,
    payment: {
      rail: claimString(payment?.rail) ?? undefined,
      ref: claimString(payment?.ref),
      gross_amount: claimString(payment?.gross_amount),
      settled_amount: claimString(payment?.settled_amount),
      net_amount: claimString(payment?.net_amount),
      asset: claimString(payment?.asset),
      payee: claimString(payment?.payee),
      fee_amount: claimString(payment?.fee_amount),
      protocol_fee_bps: typeof payment?.protocol_fee_bps === 'number' ? payment.protocol_fee_bps : null,
      platform_fee: claimString(payment?.platform_fee),
      platform_fee_bps: typeof payment?.platform_fee_bps === 'number' ? payment.platform_fee_bps : null,
    },
    route: {
      model: claimString(route?.model) ?? undefined,
      provider: claimString(route?.provider) ?? undefined,
      model_commitment: modelCommitment ? { commitment: modelCommitment } : null,
    },
    output: output?.hash ? { hash: claimString(output.hash) ?? undefined } : null,
    caller_binding: caller
      ? {
          payer_wallet: claimString(caller.payer_wallet),
          agent_pubkey: claimString(caller.agent_pubkey),
          api_key_hash: claimString(caller.api_key_hash),
        }
      : null,
    provider_cogs: asRecord(claims.provider_cogs)?.actual != null
      ? { actual: claimString(asRecord(claims.provider_cogs)?.actual) ?? undefined }
      : receipt.provider_cogs,
    binding: {
      expected_commitment: binding && 'expected_commitment' in binding
        ? (claimString(binding.expected_commitment) ?? undefined)
        : undefined,
      amount: claimString(binding?.amount)
        || claimString(payment?.net_amount)
        || claimString(payment?.gross_amount)
        || '0',
      rail: claimString(binding?.rail) || claimString(payment?.rail) || undefined,
      covers: Array.isArray(binding?.covers) ? binding.covers as string[] : ['payment', 'settlement'],
      model_commitment: claimString(binding?.model_commitment) || modelCommitment,
      output_hash: claimString(binding?.output_hash) || claimString(output?.hash),
    },
  };
}

function payerClaimsFromPayload(payload: Record<string, unknown>): ReceiptPayerClaims {
  const payment = asRecord(payload.payment);
  const caller = asRecord(payload.caller_binding);
  return {
    payment: {
      ref: claimString(payment?.ref),
      gross_amount: claimString(payment?.gross_amount),
      payee: claimString(payment?.payee),
      asset: claimString(payment?.asset),
      rail: claimString(payment?.rail),
    },
    caller_binding: caller ? { payer_wallet: claimString(caller.payer_wallet) } : null,
  };
}

function factsFromClaims(claims: Record<string, unknown> | undefined): {
  hub: string | null;
  model: string | null;
  amount_usdc: string | null;
  tx: string | null;
  output_hash: string | null;
} {
  if (!claims) {
    return { hub: null, model: null, amount_usdc: null, tx: null, output_hash: null };
  }
  const payment = asRecord(claims.payment);
  const route = asRecord(claims.route);
  const output = asRecord(claims.output);
  return {
    hub: claimString(route?.provider),
    model: claimString(route?.model),
    amount_usdc: claimString(payment?.gross_amount),
    tx: claimString(payment?.ref),
    output_hash: claimString(output?.hash),
  };
}

function issuerJwksUri(receipt: {
  verification?: { jwks_uri?: string | null };
  issuer_signature?: { jws?: string };
} | null | undefined): string | null {
  const fromVerification = receipt?.verification?.jwks_uri;
  if (typeof fromVerification === 'string' && fromVerification.startsWith('https://')) return fromVerification;
  const jws = receipt?.issuer_signature?.jws;
  const header = jws ? readJwsHeader(jws) : null;
  if (header?.jku && header.jku.startsWith('https://')) return header.jku;
  return null;
}

function httpsUrl(uri: string): boolean {
  try {
    return new URL(uri).protocol === 'https:';
  } catch {
    return false;
  }
}

function mergeJwks(primary?: Jwks, extra?: Jwks): Jwks | undefined {
  const keys = [...(primary?.keys || []), ...(extra?.keys || [])];
  if (keys.length === 0) return undefined;
  const seen = new Set<string>();
  const deduped: Es256Jwk[] = [];
  for (const key of keys) {
    const id = `${key.kid || ''}:${key.x || ''}:${key.y || ''}`;
    if (seen.has(id)) continue;
    seen.add(id);
    deduped.push(key);
  }
  return { keys: deduped };
}

/**
 * Key sources shared by receipt verification and the epoch-record check:
 * a caller-supplied JWKS, `--jwks-url` (any https URL), and `--fetch-jwks`
 * from an allowlisted host. A failed fetch is an error. It does not add a key.
 */
export async function loadIssuerJwks(
  source: {
    verification?: { jwks_uri?: string | null };
    issuer_signature?: { jws?: string };
  } | null | undefined,
  options: {
    jwks?: Jwks;
    jwksUri?: string;
    fetchJwks?: boolean;
    trustedJwksHosts?: readonly string[];
    fetchImpl?: typeof fetch;
  } = {},
): Promise<{ jwks?: Jwks; errors: string[] }> {
  const errors: string[] = [];
  let jwks = options.jwks;
  const trustedHosts = options.trustedJwksHosts ?? DEFAULT_TRUSTED_JWKS_HOSTS;
  if (options.jwksUri || options.fetchJwks) {
    const uri = options.jwksUri || issuerJwksUri(source);
    const allowed = !!uri && (options.jwksUri ? httpsUrl(uri) : jwksHostAllowed(uri, trustedHosts));
    if (uri && allowed) {
      try {
        const fetched = await fetchIssuerJwks(uri, options.fetchImpl);
        jwks = mergeJwks(jwks, fetched);
      } catch (err) {
        errors.push(`JWKS fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else if (options.jwksUri) {
      errors.push('JWKS URI rejected — only https URLs are fetched');
    } else if (options.fetchJwks && uri) {
      errors.push(`JWKS host untrusted: ${uri}`);
    }
  }
  return { jwks, errors };
}

/** Fetch a JWKS document. Caller decides whether the URL is a trust root. */
export async function fetchIssuerJwks(
  uri: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<Jwks> {
  if (!httpsUrl(uri)) throw new Error('jwks_uri must be https');
  const res = await fetchImpl(uri);
  if (!res.ok) throw new Error(`jwks_fetch_failed: ${res.status}`);
  const body = await res.json() as Jwks;
  if (!body || !Array.isArray(body.keys)) throw new Error('jwks_malformed');
  return body;
}

/**
 * Full receipt verification — trusted issuer signature, signed-claim facts,
 * optional on-chain payer and nullifier checks.
 *
 * Facts (amount, payer, payee, asset, tx, model) are taken only from a JWS
 * that verified under a trusted key. The embedded `issuer_jwk` is not trusted
 * unless its RFC 7638 thumbprint is a pinned kid, or the same key is in a JWKS.
 */
/** Extract JWS claims for payer binding. Prefers the JWS payload over the outer copy. */
export function receiptPayerClaims(receipt: XFuelReceipt): ReceiptPayerClaims {
  return receiptPayerClaimsFromEnvelope(receipt);
}

export interface VerifyReceiptOptions {
  /** Caller-supplied JWKS. Every key in it is a trust root, matched by kid. */
  jwks?: Jwks;
  /**
   * Pinned trusted kids (RFC 7638 thumbprints). Defaults to the production
   * api.chit402.com issuer kid. Pass `[]` to disable the offline pin.
   */
  trustedKids?: readonly string[];
  /** Fetch JWKS from the receipt `jwks_uri` when its host is allowlisted. */
  fetchJwks?: boolean;
  /** Explicit JWKS URL. Any https URL is fetched; this is user-supplied trust. */
  jwksUri?: string;
  /** Hosts allowed for `fetchJwks`. Defaults to api.chit402.com. */
  trustedJwksHosts?: readonly string[];
  fetchImpl?: typeof fetch;
  checkNullifier?: boolean;
  checkPayer?: boolean;
  rpcUrl?: string;
  solanaRpcUrl?: string;
  verifierAddress?: string;
  fetchSolanaTransaction?: SolanaRpcFetcher;
  fetchBaseReceipt?: BaseReceiptFetcher;
  /**
   * Tree head to check against the signed `tree_head_hash`. An equal root is
   * the issuance prefix and proves inclusion of this receipt. A different root
   * verifies only when `inclusion` proves the leaf is in that head.
   */
  head?: ReceiptTreeHead | null;
  /**
   * Inclusion witness for `head` when its root is not the signed prefix.
   * `leaf` is the 32-byte leaf hash hex. Without it the leaf is
   * SHA-256(0x00 || `${task_id}|${row_hash}`).
   */
  inclusion?: {
    leaf?: string | null;
    leaf_index?: number | null;
    tree_size?: number | null;
    row_hash?: string | null;
    proof?: InclusionStep[] | null;
  } | null;
  /**
   * Fail when a recomputable hash has no preimage. A present `preimages`
   * block is always checked, even when this is false.
   */
  requirePreimages?: boolean;
  /** Signed issuer history document. Skips the network when set. */
  issuerHistory?: IssuerHistoryDocument | null;
  /** Fetch /.well-known/issuer-history.json. Unreachable warns unless strict. */
  fetchIssuerHistory?: boolean;
  /** Fail closed when the history cannot be loaded. */
  strictIssuerHistory?: boolean;
  /** Explicit history URL. Any https URL. */
  issuerHistoryUrl?: string | null;
  /** Exact issuer-history response bytes. SHA-256 must match a signed pin. */
  issuerHistoryBytes?: string | null;
  /** `--no-issuer-history`. A signed pin is not checked. */
  skipIssuerHistory?: boolean;
  /**
   * Stored canonical object (the GET /preimage body). SHA-256 must match
   * the signed payload_hash. Absent bytes are not rebuilt.
   */
  canonicalPreimage?: string | null;
}

function normalizeBoundRoot(root: unknown): string | null {
  if (root == null || root === '') return null;
  const hex = String(root).replace(/^0x/i, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}

/**
 * True when the supplied head is the signed prefix, or a later head whose
 * inclusion proof contains this receipt's leaf.
 */
function suppliedHeadCovers(
  receipt: XFuelReceipt,
  signedRoot: string,
  head: ReceiptTreeHead,
  inclusion: VerifyReceiptOptions['inclusion'],
): boolean {
  const signed = normalizeBoundRoot(signedRoot);
  const supplied = normalizeBoundRoot(head?.root);
  if (!signed || !supplied) return false;
  if (signed === supplied) return true;
  if (!inclusion || !Array.isArray(inclusion.proof) || inclusion.leaf_index == null) return true;
  if (receipt.task_id == null) return false;
  const row = inclusion.row_hash ?? receipt.book_chain?.row_hash ?? '';
  const leaf = leafHash(Buffer.from(`${receipt.task_id}|${row}`));
  if (typeof inclusion.leaf === 'string' && /^[0-9a-fA-F]{64}$/.test(inclusion.leaf)
    && inclusion.leaf.toLowerCase() !== leaf.toString('hex')) {
    return false;
  }
  const size = inclusion.tree_size ?? head.tree_size;
  if (size == null || !Number.isInteger(Number(size))) return false;
  return verifyMerkleInclusion(
    leaf,
    Number(inclusion.leaf_index),
    Number(size),
    supplied,
    inclusion.proof,
  );
}

export async function verifyReceipt(
  receipt: XFuelReceipt,
  options: VerifyReceiptOptions = {},
): Promise<ReceiptVerification> {
  const errors: string[] = [];
  const trustedKids = options.trustedKids ?? DEFAULT_TRUSTED_ISSUER_KIDS;
  const trustedHosts = options.trustedJwksHosts ?? DEFAULT_TRUSTED_JWKS_HOSTS;

  const loadedKeys = await loadIssuerJwks(receipt, {
    jwks: options.jwks,
    jwksUri: options.jwksUri,
    fetchJwks: options.fetchJwks,
    trustedJwksHosts: trustedHosts,
    fetchImpl: options.fetchImpl,
  });
  const jwks = loadedKeys.jwks;
  errors.push(...loadedKeys.errors);

  let issuer_signature: IssuerSignatureVerification;
  if (receipt.issuer_signature?.jws || receipt.issuer_signature?.value) {
    issuer_signature = verifyIssuerSignatureWithJwks(receipt, jwks, { trustedKids });
    if (issuer_signature.checked && !issuer_signature.valid) {
      errors.push(issuer_signature.reason === KEY_UNTRUSTED
        ? KEY_UNTRUSTED
        : `Issuer signature invalid: ${issuer_signature.reason}`);
    }
  } else if (receipt.issuer_signature) {
    issuer_signature = {
      checked: false,
      valid: false,
      key_trusted: false,
      kid: receipt.issuer_signature.kid,
      reason: 'JWKS not provided — pass jwks option to verify issuer signature',
    };
  } else {
    issuer_signature = {
      checked: false,
      valid: false,
      key_trusted: false,
      reason: 'No issuer signature present on receipt',
    };
  }

  const decoded = receipt.issuer_signature?.jws
    ? decodeJwsPayload(receipt.issuer_signature.jws)
    : null;
  const claim_mismatches = diffOuterClaims(receipt, decoded);
  for (const mismatch of claim_mismatches) {
    errors.push(`outer/signed mismatch: ${mismatch.field} (outer ${mismatch.outer}, signed ${mismatch.signed})`);
  }

  const verifiedClaims = issuer_signature.valid ? issuer_signature.payload : undefined;
  const claim_id = claimIdVerdict(issuer_signature.valid ? verifiedClaims : decoded);
  if (issuer_signature.valid && claim_id === 'refused') {
    errors.push('payment.ref is set and claim_id is null');
  }

  const headVerdict = headBindingVerdict(issuer_signature.valid ? verifiedClaims : null);
  const headMissing = headVerdict === 'missing';
  if (headMissing) {
    errors.push('payload v9 requires tree_head_hash and tolerance inside signed claims');
  }
  const signedBinding = headVerdict === 'ok' ? signedHeadBinding(verifiedClaims) : null;
  // A published head may differ from the signed prefix. That is not a failure.
  // An inclusion proof, when one is supplied, must be for this receipt's leaf
  // (`task_id|row_hash`), not an arbitrary hash already in the tree.
  let headMismatch = false;
  if (signedBinding?.tree_head_hash && options.head?.root && options.inclusion) {
    if (!suppliedHeadCovers(receipt, signedBinding.tree_head_hash, options.head, options.inclusion)) {
      headMismatch = true;
      errors.push('tree_head_mismatch');
    }
  }

  let binding: BindingVerification;
  if (receipt.issuer_signature?.jws) {
    if (verifiedClaims) {
      binding = verifyBinding(receiptViewFromClaims(receipt, verifiedClaims));
    } else {
      binding = {
        verified: false,
        expected: null,
        recomputed: null,
        matches: false,
        covers: [],
        reason: issuer_signature.reason === KEY_UNTRUSTED
          ? 'Binding not checked — issuer key untrusted'
          : 'Binding not checked — issuer signature not verified',
      };
    }
  } else {
    binding = verifyBinding(receipt);
  }
  if (!binding.matches && binding.expected) {
    errors.push('Payment binding mismatch');
  }

  const signedPayerClaims = verifiedClaims ? payerClaimsFromPayload(verifiedClaims) : null;

  let payer: PayerVerification;
  if (options.checkPayer) {
    if (!signedPayerClaims) {
      payer = {
        checked: false,
        valid: false,
        reason: 'Payer facts come from verified signed claims — issuer signature is not trusted',
      };
    } else {
      const payerResult = await verifyPayerBinding(signedPayerClaims, {
        rpcUrl: options.rpcUrl,
        solanaRpcUrl: options.solanaRpcUrl,
        fetchSolanaTransaction: options.fetchSolanaTransaction,
        fetchBaseReceipt: options.fetchBaseReceipt,
      });
      payer = {
        checked: payerResult.checked,
        valid: payerResult.valid,
        rail: payerResult.rail,
        reason: payerResult.reason,
        payer_wallet: payerResult.payerWallet ?? signedPayerClaims.caller_binding?.payer_wallet ?? null,
        payee: signedPayerClaims.payment?.payee ?? null,
        asset: signedPayerClaims.payment?.asset ?? null,
        amount: payerResult.expectedAmount ?? signedPayerClaims.payment?.gross_amount ?? null,
      };
      if (payerResult.checked && !payerResult.valid) {
        errors.push(`Payer binding mismatch: ${payerResult.reason}`);
      }
    }
  } else if (signedPayerClaims?.caller_binding?.payer_wallet && signedPayerClaims.payment?.ref) {
    payer = {
      checked: false,
      valid: false,
      payer_wallet: signedPayerClaims.caller_binding.payer_wallet,
      payee: signedPayerClaims.payment.payee ?? null,
      asset: signedPayerClaims.payment.asset ?? null,
      amount: signedPayerClaims.payment.gross_amount ?? null,
      reason: 'On-chain payer check not requested — pass checkPayer: true',
    };
  } else if (!receipt.issuer_signature?.jws && receipt.caller_binding?.payer_wallet && receipt.payment?.ref) {
    payer = {
      checked: false,
      valid: false,
      reason: 'On-chain payer check not requested — pass checkPayer: true',
    };
  } else if (receipt.issuer_signature?.jws && !issuer_signature.valid) {
    payer = {
      checked: false,
      valid: false,
      reason: 'Payer facts come from verified signed claims — issuer signature is not trusted',
    };
  } else {
    payer = {
      checked: false,
      valid: false,
      reason: 'No payer_wallet or payment.ref to verify',
    };
  }

  let nullifier: NullifierVerification;
  if (options.checkNullifier && receipt.proof?.nullifier) {
    nullifier = await verifyNullifier(receipt, {
      rpcUrl: options.rpcUrl,
      verifierAddress: options.verifierAddress,
    });
    if (nullifier.verified && nullifier.anchored === false) {
      errors.push('Nullifier not anchored on-chain');
    }
  } else {
    nullifier = {
      verified: false,
      nullifier: receipt.proof?.nullifier ?? null,
      anchored: null,
      reason: options.checkNullifier
        ? 'No nullifier present'
        : 'On-chain check not requested',
    };
  }

  const facts = factsFromClaims(verifiedClaims);

  const warnings: string[] = [];
  const preimages = await verifyPublishedPreimages(receipt as unknown as Record<string, unknown>, {
    requirePreimages: options.requirePreimages === true,
    fetchImpl: options.fetchImpl,
    trustedHosts,
  });
  if (!preimages.ok) errors.push(...preimages.errors);

  const signedPayloadHash = verifiedClaims && 'payload_hash' in verifiedClaims
    ? verifiedClaims.payload_hash
    : null;
  const storedPreimage = typeof receipt.issuer_signature?.canonical_preimage === 'string'
    ? receipt.issuer_signature.canonical_preimage
    : null;
  let canonicalPreimageFailed = false;
  if (storedPreimage != null) {
    const storedCheck = verifyCanonicalPreimageBytes(storedPreimage, signedPayloadHash);
    if (!storedCheck.ok) {
      canonicalPreimageFailed = true;
      if (storedCheck.reason) errors.push(`canonical preimage: ${storedCheck.reason}`);
    }
  }
  if (typeof options.canonicalPreimage === 'string') {
    const fileCheck = verifyCanonicalPreimageBytes(options.canonicalPreimage, signedPayloadHash);
    if (!fileCheck.ok) {
      canonicalPreimageFailed = true;
      if (fileCheck.reason) errors.push(`canonical preimage: ${fileCheck.reason}`);
    }
  }

  const issuedAt = (verifiedClaims && 'iat' in verifiedClaims ? verifiedClaims.iat : null)
    ?? decoded?.iat
    ?? receipt.created_at
    ?? null;
  const historyPin = readIssuerHistoryPin(verifiedClaims as Record<string, unknown> | null);
  const payloadVersion = Number(verifiedClaims?.payload_version);
  // Payload v10 signs the history pin. A missing pin fails even when the
  // caller did not pass a history file or ask for a fetch.
  const pinRequired = !options.skipIssuerHistory
    && Number.isFinite(payloadVersion)
    && payloadVersion >= CANONICAL_PAYLOAD_VERSION;
  const historyAsked = pinRequired || (!options.skipIssuerHistory && !!(
    options.issuerHistory
    || options.issuerHistoryBytes
    || options.fetchIssuerHistory
    || options.strictIssuerHistory
    || options.issuerHistoryUrl
    || historyPin
  ));
  const issuer_history = historyAsked
    ? await checkReceiptIssuerHistory(receipt, {
      document: options.issuerHistory ?? null,
      documentBytes: options.issuerHistoryBytes ?? null,
      fetchHistory: options.fetchIssuerHistory === true || options.strictIssuerHistory === true,
      strict: options.strictIssuerHistory === true,
      historyUrl: options.issuerHistoryUrl ?? null,
      jwks,
      trustedKids,
      fetchImpl: options.fetchImpl,
      trustedHosts,
      issuedAt,
      kid: issuer_signature.kid ?? receipt.issuer_signature?.kid ?? null,
      pin: historyPin,
      requirePin: pinRequired,
    })
    : {
      checked: false,
      ok: true,
      unreachable: false,
      warning: null,
      reason: null,
      kid: issuer_signature.kid ?? receipt.issuer_signature?.kid ?? null,
    };
  if (issuer_history.warning) warnings.push(issuer_history.warning);
  if (issuer_history.checked && !issuer_history.ok && issuer_history.reason) {
    errors.push(`issuer history: ${issuer_history.reason}`);
  }

  const hasIssuerSig = !!receipt.issuer_signature;
  const jwksWasSupplied = !!(options.jwks || options.jwksUri || (options.fetchJwks && jwks));
  const claimRefused = issuer_signature.valid && claim_id === 'refused';
  const signatureFailed = hasIssuerSig && !issuer_signature.valid && (
    !!issuer_signature.checked
    || jwksWasSupplied
    || issuer_signature.reason === KEY_UNTRUSTED
    || issuer_signature.reason === 'no_matching_key'
    || issuer_signature.reason === 'empty_jwks'
  );
  const mismatchFailed = claim_mismatches.length > 0;
  const bindingFailed = !!(binding.expected && !binding.matches);
  const payerFailed = !!(options.checkPayer && payer.checked && !payer.valid);
  const nullifierFailed = !!(
    options.checkNullifier
    && receipt.proof?.nullifier
    && nullifier.anchored === false
  );
  const signatureUnchecked = hasIssuerSig && !issuer_signature.checked;

  let overall: 'verified' | 'partial' | 'failed';
  const preimageFailed = !preimages.ok;
  const historyFailed = issuer_history.checked && !issuer_history.ok;
  if (signatureFailed || mismatchFailed || bindingFailed || payerFailed || nullifierFailed || claimRefused || headMissing || headMismatch || preimageFailed || historyFailed || canonicalPreimageFailed) {
    overall = 'failed';
  } else if (signatureUnchecked) {
    overall = 'partial';
  } else if (!binding.expected && !hasIssuerSig && !options.checkPayer) {
    overall = 'partial';
  } else if (
    (binding.matches || !binding.expected)
    && (!options.checkPayer || payer.valid)
    && (!options.checkNullifier || !receipt.proof?.nullifier || nullifier.anchored === true)
    && (issuer_signature.valid || !hasIssuerSig)
  ) {
    overall = 'verified';
  } else {
    overall = 'partial';
  }

  // A refusal is a different document. Recognition uses the signed JWS
  // schema, not only the unsigned outer schema. A valid issuer signature
  // here must not be reported as a verified payment.
  const verifiedSchema = typeof verifiedClaims?.schema === 'string' ? verifiedClaims.schema : null;
  if (verifiedSchema === REFUSAL_SCHEMA || isRefusalDocument(receipt as unknown)) {
    errors.push('refusal document is not a payment receipt');
    overall = 'failed';
  }

  const signedPayment = asRecord(verifiedClaims?.payment);
  const signedSettlement = asRecord(verifiedClaims?.settlement);
  const receipt_lane = receiptLaneFromVerification({
    receipt,
    claims: {
      payment: signedPayment ? {
        ref: typeof signedPayment.ref === 'string' ? signedPayment.ref : null,
        rail: typeof signedPayment.rail === 'string' ? signedPayment.rail : null,
        collected: typeof signedPayment.collected === 'boolean' ? signedPayment.collected : null,
      } : null,
      settlement: signedSettlement ? {
        kind: typeof signedSettlement.kind === 'string' ? signedSettlement.kind : null,
      } : null,
    },
    issuerValid: issuer_signature.valid === true,
    payer: { checked: payer.checked, valid: payer.valid },
    head: options.head ?? null,
  });

  return {
    receipt_id: receipt.task_id,
    binding,
    issuer_signature,
    payer,
    nullifier,
    output_hash: facts.output_hash,
    hub: facts.hub,
    model: facts.model,
    amount_usdc: facts.amount_usdc,
    tx: facts.tx,
    claim_mismatches,
    claim_id,
    head_binding: signedBinding
      ? { tree_head_hash: signedBinding.tree_head_hash, tolerance: signedBinding.tolerance }
      : null,
    receipt_lane,
    preimages,
    issuer_history,
    warnings,
    overall,
    errors,
  };
}

export {
  resolvePinnedIssuerJwk,
  verifyIssuerJws,
  DEFAULT_TRUSTED_ISSUER_KIDS,
  DEFAULT_TRUSTED_JWKS_HOSTS,
  KEY_UNTRUSTED,
  jwkThumbprint,
  isPinnedTrustedJwk,
  jwksHostAllowed,
} from './jws.js';

export {
  buildReceiptLane,
  receiptLaneFromVerification,
  receiptLaneDecision,
  deriveSettledBy,
  deriveSettled,
  anchorChangedSinceBinding,
  RECEIPT_LANE_SCHEMA,
  RECEIPT_LANE_RULE,
  RECEIPT_LANE_ORDERING,
  RECEIPT_LANE_BOUNDARY,
  type ReceiptLane,
  type SettledBy,
  type RegistryClassification,
  type LocalCheckHint,
  type AnchorIdentity,
  type ReceiptTreeHead,
} from './receipt-lane.js';

export {
  headBindingVerdict,
  signedHeadBinding,
  outerHeadDisagrees,
  HEAD_BINDING_PAYLOAD_VERSION,
  type HeadBindingVerdict,
  type SignedHeadBinding,
} from './head-binding.js';

export {
  isRefusalDocument,
  verifyRefusal,
  REFUSAL_SCHEMA,
  REFUSAL_PAYLOAD_VERSION,
  REFUSAL_PROVES,
  REFUSAL_DOES_NOT_PROVE,
  type RefusalDocument,
  type RefusalVerification,
  type RefusalJwks,
} from './refusal.js';

export {
  acceptTreeHeadSchema,
  verifyEpochLink,
  verifyEpochRecord,
  verifyEpochInclusion,
  TREE_HEAD_SCHEMA_V1,
  TREE_HEAD_SCHEMA_V2,
  EPOCH1_FINAL_ROOT,
  EPOCH1_FINAL_SIZE,
  EPOCH1_GENESIS_DIGEST,
  EPOCH1_SIZE1_ROOT,
  EPOCH1_SIZE2_ROOT,
  epoch1PrefixRoot,
  matchEpoch1Prefix,
  EPOCH2_OPENING_ROOT,
  type EpochTreeHead,
  type EpochRecord,
  type EpochRecordEntry,
  type EpochRecordOptions,
} from './epoch.js';

export {
  verifyAnchoredRoot,
  verifyMerkleInclusion,
  verifyConsistency,
  fetchWitnessHead,
  fetchWitnessCode,
  witnessCodeMatches,
  CHIT_LOG_WITNESS_CODEHASH,
  extractMemos,
  parseAnchorMemo,
  leafHash,
  ANCHOR_PROVES,
  ANCHOR_DOES_NOT_PROVE,
  SOLANA_GENESIS,
  BASE_MAINNET_CHAIN_ID,
  type AnchorWitnessResult,
  type AnchorReceipt,
  type AnchorInclusion,
  type AnchorHead,
  type VerifyAnchoredRootInput,
  type WitnessHead,
} from './anchor-witness.js';

export {
  verifyCanonicalPreimageBytes,
  CANONICAL_PAYLOAD_VERSION,
} from './canonical-preimage.js';

export {
  readIssuerHistoryPin,
  issuerHistoryDocumentHash,
  type IssuerHistoryPin,
} from './issuer-history.js';

export default {
  verifyBinding,
  verifyIssuerSignature,
  verifyIssuerSignatureWithJwks,
  verifyIssuerJws,
  resolvePinnedIssuerJwk,
  verifyNullifier,
  verifyPayerBinding,
  verifySolanaPayer,
  verifyBasePayer,
  verifyReceipt,
  receiptPayerClaims,
  receiptPayerClaimsFromEnvelope,
  decodeJwsPayload,
  computePaymentCommitment,
  computeInferenceBinding,
  canonicalIssuerPayload,
  canonicalPayloadVersion,
  canonicalSignedPayload,
  reconcileSettledTransfer,
  sumUsdcTransfersToPayee,
  hashCanonicalPayload,
  ZK_VERIFIER_ADDRESS,
  BASE_RPC_URL,
  BASE_SEPOLIA_RPC_URL,
  SOLANA_RPC_URL,
};
