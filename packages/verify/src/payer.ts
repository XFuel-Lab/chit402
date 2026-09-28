/**
 * Unified offline payer binding verification (Base + Solana).
 */

import { verifyBasePayer, type BasePayerVerification, type BaseReceiptFetcher } from './base-payer.js';
import {
  verifySolanaPayer,
  type SolanaPayerVerification,
  type SolanaRpcFetcher,
} from './solana-payer.js';

export type PayerRail = 'base' | 'solana' | 'unknown';

export interface PayerBindingVerification {
  checked: boolean;
  valid: boolean;
  rail: PayerRail;
  payerWallet?: string | null;
  paymentRef?: string | null;
  expectedAmount?: string | null;
  base?: BasePayerVerification;
  solana?: SolanaPayerVerification;
  reason?: string;
}

export interface ReceiptPayerClaims {
  payment?: {
    ref?: string | null;
    gross_amount?: string | null;
    payee?: string | null;
    asset?: string | null;
    rail?: string | null;
  } | null;
  caller_binding?: {
    payer_wallet?: string | null;
  } | null;
}

export interface VerifyPayerBindingOptions {
  rpcUrl?: string;
  solanaRpcUrl?: string;
  fetchSolanaTransaction?: SolanaRpcFetcher;
  fetchBaseReceipt?: BaseReceiptFetcher;
}

/** Decode the payload segment of a compact JWS (no signature check). */
export function decodeJwsPayload(jws: string): Record<string, unknown> | null {
  const parts = jws.split('.');
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

interface PaymentClaim {
  ref?: string | null;
  gross_amount?: string | null;
  payee?: string | null;
  asset?: string | null;
  rail?: string | null;
}

function paymentClaims(payment: PaymentClaim | null | undefined): ReceiptPayerClaims['payment'] {
  return {
    ref: payment?.ref ?? null,
    gross_amount: payment?.gross_amount != null ? String(payment.gross_amount) : null,
    payee: payment?.payee ?? null,
    asset: payment?.asset ?? null,
    rail: payment?.rail ?? null,
  };
}

/**
 * Payer facts from the JWS payload when one is present.
 * The outer `payment` / `caller_binding` copies are unsigned and are used only
 * when the receipt has no JWS. Callers that need verified facts must check the
 * issuer signature first; this decode does not itself prove the signature.
 */
export function receiptPayerClaimsFromEnvelope(receipt: {
  payment?: PaymentClaim | null;
  caller_binding?: { payer_wallet?: string | null } | null;
  issuer_signature?: { jws?: string } | null;
}): ReceiptPayerClaims {
  const jws = receipt.issuer_signature?.jws;
  if (jws) {
    const claims = decodeJwsPayload(jws);
    if (claims) {
      const payment = claims.payment as PaymentClaim | undefined;
      const callerBinding = claims.caller_binding as { payer_wallet?: string } | undefined;
      return {
        payment: paymentClaims(payment),
        caller_binding: callerBinding ?? null,
      };
    }
  }

  if (receipt.payment?.ref || receipt.caller_binding?.payer_wallet) {
    return {
      payment: paymentClaims(receipt.payment),
      caller_binding: receipt.caller_binding ?? null,
    };
  }

  return {
    payment: { ref: null, gross_amount: null, payee: null, asset: null, rail: null },
    caller_binding: null,
  };
}

function detectRail(paymentRef: string | null | undefined): PayerRail {
  if (!paymentRef) return 'unknown';
  const lower = paymentRef.toLowerCase();
  if (lower.startsWith('solana:')) return 'solana';
  if (lower.startsWith('base:') || lower.startsWith('base-sepolia:') || lower.startsWith('eip155:')) {
    return 'base';
  }
  return 'unknown';
}

/**
 * Verify caller_binding.payer_wallet against on-chain settlement in payment.ref.
 */
export async function verifyPayerBinding(
  claims: ReceiptPayerClaims,
  options: VerifyPayerBindingOptions = {},
): Promise<PayerBindingVerification> {
  const paymentRef = claims.payment?.ref ?? null;
  const payerWallet = claims.caller_binding?.payer_wallet ?? null;
  const grossAmount = claims.payment?.gross_amount ?? null;
  const payee = claims.payment?.payee ?? null;
  const asset = claims.payment?.asset ?? null;
  const rail = detectRail(paymentRef);

  if (!paymentRef) {
    return { checked: false, valid: false, rail, reason: 'no_payment_ref' };
  }
  if (!payerWallet) {
    return { checked: false, valid: false, rail, paymentRef, reason: 'no_payer_wallet' };
  }
  if (grossAmount == null || grossAmount === '') {
    return { checked: false, valid: false, rail, paymentRef, payerWallet, reason: 'no_gross_amount' };
  }

  if (rail === 'solana') {
    const solana = await verifySolanaPayer({
      paymentRef,
      payerWallet,
      grossAmount,
      rpcUrl: options.solanaRpcUrl || options.rpcUrl,
      fetchTransaction: options.fetchSolanaTransaction,
    });
    return {
      checked: solana.checked,
      valid: solana.valid,
      rail: 'solana',
      payerWallet,
      paymentRef,
      expectedAmount: grossAmount,
      solana,
      reason: solana.reason,
    };
  }

  if (rail === 'base') {
    if (!payee) {
      return { checked: false, valid: false, rail, paymentRef, payerWallet, expectedAmount: grossAmount, reason: 'no_payee' };
    }
    if (!asset) {
      return { checked: false, valid: false, rail, paymentRef, payerWallet, expectedAmount: grossAmount, reason: 'no_asset' };
    }
    const base = await verifyBasePayer({
      paymentRef,
      payerWallet,
      grossAmount,
      payee,
      asset,
      rpcUrl: options.rpcUrl,
      fetchReceipt: options.fetchBaseReceipt,
    });
    return {
      checked: base.checked,
      valid: base.valid,
      rail: 'base',
      payerWallet,
      paymentRef,
      expectedAmount: grossAmount,
      base,
      reason: base.reason,
    };
  }

  return {
    checked: false,
    valid: false,
    rail: 'unknown',
    payerWallet,
    paymentRef,
    expectedAmount: grossAmount,
    reason: `unsupported_payment_ref: ${paymentRef}`,
  };
}
