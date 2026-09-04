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
    gross_amount?: string;
    net_amount?: string;
    fee_amount?: string;
    fee_bps?: number;
    protocol_fee_bps?: number;
    platform_fee?: string;
    platform_fee_bps?: number;
  };
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
  };
  issuer_signature?: {
    alg?: string;
    value?: string;
    kid?: string;
    jws?: string;
  };
  caller_binding?: {
    payer_wallet?: string | null;
    agent_pubkey?: string | null;
    api_key_hash?: string | null;
  } | null;
  payment_meta?: {
    network?: string;
  } | null;
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
  /** True if the ECDSA signature is valid. */
  valid: boolean;
  /** Key ID from the signature. */
  kid?: string;
  /** Reason for failure when valid=false. */
  reason?: string;
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
  amount_usdc: string | null;
  tx: string | null;
  overall: 'verified' | 'partial' | 'failed';
  errors: string[];
}

/**
 * Canonical, order-stable payload an issuer signature covers.
 * MUST match `canonicalSignedPayload` in services/gateway/src/receipt.js exactly.
 *
 * Signed fields (15 total):
 *   1. task_id
 *   2. payment.rail
 *   3. payment.ref
 *   4. payment.gross_amount
 *   5. payment.net_amount
 *   6. payment.fee_amount
 *   7. payment.protocol_fee_bps ?? payment.fee_bps
 *   8. payment.platform_fee
 *   9. payment.platform_fee_bps
 *  10. provider_cogs.actual
 *  11. route.model
 *  12. route.model_commitment.commitment
 *  13. route.provider
 *  14. output.hash
 *  15. binding.expected_commitment
 */
export function canonicalIssuerPayload(receipt: XFuelReceipt): string {
  return JSON.stringify([
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
  ]);
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
export function verifyIssuerSignatureWithJwks(
  receipt: XFuelReceipt,
  jwks: Jwks,
): IssuerSignatureVerification {
  const sig = receipt.issuer_signature;
  if (!sig || !sig.value) {
    return { checked: false, valid: false, reason: 'no_issuer_signature' };
  }
  if (!jwks || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
    return { checked: false, valid: false, reason: 'empty_jwks' };
  }

  // Find matching key by kid, or try all ES256 keys if no kid on signature
  const candidates = sig.kid
    ? jwks.keys.filter(k => k.kid === sig.kid && k.alg === 'ES256')
    : jwks.keys.filter(k => k.alg === 'ES256');

  if (candidates.length === 0) {
    return { checked: false, valid: false, reason: 'no_matching_key' };
  }

  for (const jwk of candidates) {
    const result = verifyIssuerSignature(receipt, jwk);
    if (result.valid) {
      return result;
    }
  }
  return { checked: true, valid: false, reason: 'signature_invalid' };
}

/**
 * Verify a receipt's payment binding locally (no network required).
 *
 * This recomputes the commitment from the receipt's fields and compares
 * it to the stored `binding.expected_commitment`.
 */
export function verifyBinding(receipt: XFuelReceipt): BindingVerification {
  const binding = receipt.binding;
  if (!binding) {
    return {
      verified: false,
      expected: null,
      recomputed: null,
      matches: false,
      covers: [],
      reason: 'No binding present on receipt (may be unmetered or TFUEL rail)',
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
 * Full receipt verification — binding + issuer signature + optional nullifier check.
 *
 * @param receipt The Chit402 receipt JSON
 * @param options.jwks JWKS for issuer signature verification (no network fetch)
 * @param options.checkNullifier Whether to verify nullifier on-chain (requires network)
 * @param options.rpcUrl RPC URL for on-chain checks
 */
/** Extract JWS claims for payer binding when present. */
export function receiptPayerClaims(receipt: XFuelReceipt): ReceiptPayerClaims {
  return receiptPayerClaimsFromEnvelope(receipt);
}

export async function verifyReceipt(
  receipt: XFuelReceipt,
  options: {
    jwks?: Jwks;
    checkNullifier?: boolean;
    checkPayer?: boolean;
    rpcUrl?: string;
    solanaRpcUrl?: string;
    verifierAddress?: string;
    fetchSolanaTransaction?: SolanaRpcFetcher;
    fetchBaseReceipt?: BaseReceiptFetcher;
  } = {},
): Promise<ReceiptVerification> {
  const errors: string[] = [];

  // Verify binding locally
  const binding = verifyBinding(receipt);
  if (!binding.matches && binding.expected) {
    errors.push('Payment binding mismatch');
  }

  // Verify issuer signature if JWKS provided
  let issuer_signature: IssuerSignatureVerification;
  if (options.jwks) {
    issuer_signature = verifyIssuerSignatureWithJwks(receipt, options.jwks);
    if (issuer_signature.checked && !issuer_signature.valid) {
      errors.push(`Issuer signature invalid: ${issuer_signature.reason}`);
    }
  } else if (receipt.issuer_signature) {
    issuer_signature = {
      checked: false,
      valid: false,
      kid: receipt.issuer_signature.kid,
      reason: 'JWKS not provided — pass jwks option to verify issuer signature',
    };
  } else {
    issuer_signature = {
      checked: false,
      valid: false,
      reason: 'No issuer signature present on receipt',
    };
  }

  // Verify payer on-chain when requested (Base USDC or Solana USDC)
  let payer: PayerVerification;
  if (options.checkPayer) {
    const payerResult = await verifyPayerBinding(receiptPayerClaims(receipt), {
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
    };
    if (payerResult.checked && !payerResult.valid) {
      errors.push(`Payer binding mismatch: ${payerResult.reason}`);
    }
  } else if (receipt.caller_binding?.payer_wallet && receipt.payment?.ref) {
    payer = {
      checked: false,
      valid: false,
      reason: 'On-chain payer check not requested — pass checkPayer: true',
    };
  } else {
    payer = {
      checked: false,
      valid: false,
      reason: 'No payer_wallet or payment.ref to verify',
    };
  }

  // Verify nullifier on-chain if requested
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

  // Extract frozen fields
  const hub = receipt.route?.provider ?? null;
  const model = receipt.route?.model ?? null;
  const amount_usdc = receipt.payment?.gross_amount ?? null;
  const tx = receipt.payment?.ref ?? null;
  const output_hash = receipt.output?.hash ?? null;

  // Determine overall status with strict signature semantics:
  // - If JWKS provided and signature invalid/kid mismatch/no matching key → 'failed'
  // - If receipt has issuer_signature but no JWKS provided → 'partial' (cannot verify)
  // - Unsigned receipts can be 'partial' or 'verified' based on binding
  let overall: 'verified' | 'partial' | 'failed';

  // Check for signature verification failure (JWKS provided but signature invalid)
  const jwksProvided = !!options.jwks;
  const hasIssuerSig = !!receipt.issuer_signature;
  const issuerSigInvalid = jwksProvided && hasIssuerSig && !issuer_signature.valid;

  // Binding failure
  const bindingFailed = binding.expected && !binding.matches;
  const payerFailed = options.checkPayer && payer.checked && !payer.valid;

  if (issuerSigInvalid || bindingFailed || payerFailed) {
    // JWKS provided but signature invalid, OR binding mismatch → failed
    overall = 'failed';
  } else if (hasIssuerSig && !jwksProvided) {
    // Receipt has signature but no JWKS provided → partial (cannot verify signature)
    overall = 'partial';
  } else if (
    binding.matches
    && (!options.checkPayer || payer.valid)
    && (!options.checkNullifier || nullifier.anchored)
  ) {
    // Binding matches, signature OK (or no signature), nullifier OK → verified
    overall = 'verified';
  } else if (
    binding.matches
    || issuer_signature.valid
    || (options.checkPayer && payer.valid)
    || (nullifier.verified && nullifier.anchored)
  ) {
    // At least one check passed → partial
    overall = 'partial';
  } else if (!binding.expected && !receipt.proof?.nullifier && !hasIssuerSig) {
    // No binding/sig/nullifier to verify (unmetered/demo) → partial
    overall = 'partial';
  } else {
    overall = 'failed';
  }

  return {
    receipt_id: receipt.task_id,
    binding,
    issuer_signature,
    payer,
    nullifier,
    output_hash,
    hub,
    model,
    amount_usdc,
    tx,
    overall,
    errors,
  };
}

export default {
  verifyBinding,
  verifyIssuerSignature,
  verifyIssuerSignatureWithJwks,
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
  canonicalSignedPayload,
  hashCanonicalPayload,
  ZK_VERIFIER_ADDRESS,
  BASE_RPC_URL,
  BASE_SEPOLIA_RPC_URL,
  SOLANA_RPC_URL,
};
