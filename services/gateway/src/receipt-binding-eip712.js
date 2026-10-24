/**
 * Payer binding (EIP-712 ReceiptBinding over P-256).
 *
 * Signed once per receipt, right after that receipt's leaf is appended, by
 * the payer binding worker. Never on a read and never as backfill. The
 * signed object lives in the private binding store and is served only in
 * the owner view. The receipt JWS, public shells, attestations and the leaf
 * format are not touched.
 *
 * Flag: RECEIPT_PAYER_BINDING_EIP712, on only when exactly "true".
 */
import crypto from 'node:crypto';
import {
  BASE_USDC_ASSET_ID,
  EIP712_CHAIN_ID,
  EIP712_DIGEST_ALG,
  EIP712_DOMAIN_VERSION,
  EXPECTED_LOG_SALT,
  RECEIPT_BINDING_DOMAIN_NAME,
  RECEIPT_BINDING_TYPE,
  kidBytes32,
  logIdSalt,
  payerCommitment,
  signTypedStruct,
  typedDigest,
  verifyTypedSignature,
} from './eip712-p256.js';
import { BASE_USDC } from './public-attestation.js';

export const PAYER_BINDING_FLAG = 'RECEIPT_PAYER_BINDING_EIP712';
export const PAYER_BINDING_SCHEMA = 'chit402.receipt_binding_eip712.v1';
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const AMOUNT = /^[1-9][0-9]*$/;
const HEX32 = /^[0-9a-f]{64}$/;
const UINT64_MAX = (1n << 64n) - 1n;
/** Spellings of Base mainnet used in signed payment claims. */
const BASE_NETWORKS = new Set(['base', 'eip155:8453']);

/** Strict flag parse: only the exact string "true" turns it on. */
export function payerBindingFlagOn(env = process.env) {
  return env[PAYER_BINDING_FLAG] === 'true';
}

/**
 * Binding inputs from the signed holder claims only.
 * @returns {{ ok: true, payer: string, amount_atomic: string } | { ok: false, reason: string }}
 */
export function bindingInputsFromClaims(claims) {
  if (!claims || typeof claims !== 'object') return { ok: false, reason: 'no_claims' };
  const payer = claims.caller_binding?.payer_wallet;
  if (typeof payer !== 'string' || !EVM_ADDRESS.test(payer) || /^0x0{40}$/i.test(payer)) {
    return { ok: false, reason: 'no_payer' };
  }
  const pay = claims.payment;
  if (!pay || typeof pay !== 'object') return { ok: false, reason: 'no_payment' };
  if (pay.rail != null && pay.rail !== 'usdc') return { ok: false, reason: 'asset' };
  // When the signed claims name a network, it must be Base mainnet.
  if (pay.network != null && !BASE_NETWORKS.has(String(pay.network).trim().toLowerCase())) {
    return { ok: false, reason: 'network' };
  }
  if (typeof pay.asset !== 'string' || pay.asset.toLowerCase() !== BASE_USDC.toLowerCase()) {
    return { ok: false, reason: 'asset' };
  }
  const gross = pay.gross_amount == null ? '' : String(pay.gross_amount);
  if (!AMOUNT.test(gross) || BigInt(gross) > UINT64_MAX) return { ok: false, reason: 'amount' };
  return { ok: true, payer, amount_atomic: gross };
}

/**
 * The signed object as stored and as served in the owner view.
 */
export function bindingObject(message, salt, sig) {
  return {
    schema: PAYER_BINDING_SCHEMA,
    digest_alg: EIP712_DIGEST_ALG,
    domain: {
      name: RECEIPT_BINDING_DOMAIN_NAME,
      version: EIP712_DOMAIN_VERSION,
      chainId: EIP712_CHAIN_ID,
      salt,
    },
    types: RECEIPT_BINDING_TYPE,
    message: { ...message },
    r: sig.r,
    s: sig.s,
  };
}

/**
 * Reference check of a stored binding plus its opening.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function verifyBinding(binding, payerSaltHex, payer, jwk, { salt = EXPECTED_LOG_SALT } = {}) {
  try {
    if (binding?.schema !== PAYER_BINDING_SCHEMA) return { ok: false, reason: 'schema' };
    if (binding.domain?.name !== RECEIPT_BINDING_DOMAIN_NAME || binding.domain?.salt !== salt
      || binding.domain?.chainId !== EIP712_CHAIN_ID || binding.domain?.version !== EIP712_DOMAIN_VERSION) {
      return { ok: false, reason: 'domain' };
    }
    if (binding.message?.asset_id !== BASE_USDC_ASSET_ID) return { ok: false, reason: 'asset' };
    const digest = typedDigest('ReceiptBinding', binding.message, salt);
    if (!verifyTypedSignature(digest.preimage, binding.r, binding.s, jwk)) return { ok: false, reason: 'signature' };
    if (payer != null) {
      const opened = payerCommitment(payer, Buffer.from(String(payerSaltHex || '').replace(/^0x/, ''), 'hex'));
      if (opened !== binding.message.payer_commitment) return { ok: false, reason: 'commitment' };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}

/**
 * Sign a binding for a leaf the caller has already checked against the log.
 * Never throws; refusals carry a code only (no payer, salt or commitment).
 *
 * @param {{ leafHash: string, claims: object, ctx: {
 *   ready: { ok: boolean, reason?: string },
 *   logIdentity: { epoch1_root: string, genesis_digest: string } | null,
 *   kid: string,
 *   signer?: object|null,
 *   randomBytes?: (n: number) => Buffer,
 * } }} input
 * @returns {Promise<{ record: { leaf_hash: string, binding: object, payer_salt: string } } | { refused: string, retry: boolean }>}
 */
export async function signReceiptBinding({ leafHash, claims, ctx }) {
  if (!ctx?.ready?.ok) return { refused: ctx?.ready?.reason || 'log_not_ready', retry: true };
  let salt;
  try {
    salt = logIdSalt(ctx.logIdentity?.epoch1_root, ctx.logIdentity?.genesis_digest);
  } catch {
    return { refused: 'log_identity', retry: true };
  }
  if (salt !== EXPECTED_LOG_SALT) return { refused: 'log_identity', retry: true };
  const leaf = String(leafHash || '').replace(/^0x/, '').toLowerCase();
  if (!HEX32.test(leaf)) return { refused: 'field_range', retry: false };
  const inputs = bindingInputsFromClaims(claims);
  if (!inputs.ok) return { refused: inputs.reason, retry: false };
  let kid;
  try {
    kid = kidBytes32(ctx.kid);
  } catch {
    return { refused: 'signer_unavailable', retry: true };
  }
  const random = ctx.randomBytes || crypto.randomBytes;
  const payerSalt = random(32);
  if (!Buffer.isBuffer(payerSalt) || payerSalt.length !== 32) return { refused: 'salt_source', retry: true };
  const message = {
    leaf_hash: `0x${leaf}`,
    payer_commitment: payerCommitment(inputs.payer, payerSalt),
    amount_atomic: inputs.amount_atomic,
    asset_id: BASE_USDC_ASSET_ID,
    kid,
  };
  let sig;
  try {
    sig = await signTypedStruct('ReceiptBinding', message, { salt, signer: ctx.signer || null });
  } catch (err) {
    if (err?.code === 'eip712_field_range') return { refused: 'field_range', retry: false };
    return { refused: err?.code === 'issuer_sign_unavailable' ? 'signer_unavailable' : 'signer_error', retry: true };
  }
  return {
    record: {
      leaf_hash: leaf,
      binding: bindingObject(message, salt, sig),
      payer_salt: `0x${payerSalt.toString('hex')}`,
    },
  };
}
