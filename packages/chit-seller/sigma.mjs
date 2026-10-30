/**
 * Seller sigma signer.
 *
 * Sigma is Sig(H("cs2-sig" ‖ payment id ‖ K ‖ alg)) on P-256, low-S, 64-byte
 * r‖s, and only when the on-chain payment matches this call's payer, payee,
 * price and nonce. Alg must be one isAllowedAlg accepts. One successful
 * signature claims the payment id and the authorization; a second request
 * for either is refused. Failures return a fixed reason and nothing else.
 */

import { randomBytes } from 'node:crypto';
import { authorizationKey, isAllowedAlg, sigmaDigest } from '../cs2-core/line/index.mjs';
import { P256 } from '../cs2-core/ecdsa/curves.js';
import { bytesToBig, bytesToHex, hexToBytes } from '../cs2-core/ecdsa/bytes.js';
import { publicPoint, signRawDigest } from '../cs2-core/ecdsa/sign.js';
import { yParityByTrial } from '../cs2-core/ecdsa/recover.js';
import { fromCodec, refuse } from './reasons.mjs';
import { parseScalar } from './hex.mjs';
import { isLowS } from './low-s.mjs';
import { createOnceStore } from './store.mjs';
import { matchAuthorization, matchObservedSettle, requireObservedTriple } from './match.mjs';
import { readCanonicalPayment, selectNonce } from './chain.mjs';

function deny(reason, onRefuse) {
  const out = refuse(reason);
  if (typeof onRefuse === 'function') {
    try { onRefuse(out.reason); } catch { /* the refusal stands */ }
  }
  return out;
}

function randomScalar(order) {
  for (let i = 0; i < 64; i += 1) {
    const k = bytesToBig(randomBytes(32));
    if (k > 0n && k < order) return k;
  }
  return null;
}

export function compressP256(publicKey) {
  if (!(publicKey instanceof Uint8Array) || publicKey.length !== 65 || publicKey[0] !== 0x04) return null;
  const y = bytesToBig(publicKey.subarray(33));
  const prefix = (y & 1n) === 1n ? 0x03 : 0x02;
  const out = new Uint8Array(33);
  out[0] = prefix;
  out.set(publicKey.subarray(1, 33), 1);
  return out;
}

async function signInner(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return refuse('bad_type');
  const onRefuse = input.onRefuse;
  const payment = input.payment;
  const authorization = input.authorization;
  const triple = requireObservedTriple(payment, authorization);
  if (!triple.ok) return deny(triple.reason, onRefuse);
  if (typeof input.alg !== 'number' || !isAllowedAlg(input.alg)) return deny('bad_alg', onRefuse);
  if (!input.store || typeof input.store.claim !== 'function' || typeof input.store.release !== 'function') {
    return deny('bad_type', onRefuse);
  }

  const read = await readCanonicalPayment(input.reader, payment);
  if (!read.ok) return deny(read.reason, onRefuse);
  const bound = await selectNonce(read, authorization.nonce);
  if (!bound.ok) return deny(bound.reason, onRefuse);
  const matched = matchAuthorization(authorization, bound);
  if (!matched.ok) return deny(matched.reason, onRefuse);
  const settled = matchObservedSettle(
    { txHash: payment.txHash, localLogIndex: payment.localLogIndex },
    bound,
  );
  if (!settled.ok) return deny(settled.reason, onRefuse);

  const digest = sigmaDigest({
    chainId: bound.chainId,
    blockHash: bound.blockHash,
    txIndex: bound.txIndex,
    localLogIndex: bound.localLogIndex,
  }, input.K, input.alg);
  if (!digest.ok) return deny(fromCodec(digest).reason, onRefuse);

  const authKey = authorizationKey({
    chainId: bound.chainId,
    token: hexToBytes(bound.token),
    authorizer: hexToBytes(bound.payer),
    nonce: hexToBytes(bound.nonce),
  });
  if (!authKey.ok) return deny(fromCodec(authKey).reason, onRefuse);

  const payClaim = `pay:${bound.paymentId}`;
  const authClaim = `auth:${authKey.hex}`;
  if (!input.store.claim(payClaim)) return deny('duplicate_sigma', onRefuse);
  if (!input.store.claim(authClaim)) {
    input.store.release(payClaim);
    return deny('duplicate_sigma', onRefuse);
  }

  const d = parseScalar(input.privateKey, P256.order);
  const k = input.k == null ? randomScalar(P256.order) : parseScalar(input.k, P256.order);
  if (d == null || k == null) {
    input.store.release(payClaim);
    input.store.release(authClaim);
    return deny('bad_key', onRefuse);
  }
  let sig;
  try {
    sig = signRawDigest(digest.bytes, d, k, P256);
  } catch {
    input.store.release(payClaim);
    input.store.release(authClaim);
    return deny('bad_key', onRefuse);
  }
  if (!isLowS(sig.s, P256)) {
    input.store.release(payClaim);
    input.store.release(authClaim);
    return deny('bad_sigma', onRefuse);
  }
  return {
    ok: true,
    alg: input.alg,
    sigma: sig.raw,
    digest: digest.bytes,
    paymentId: bound.paymentId,
  };
}

export async function signSigma(input) {
  try {
    return await signInner(input);
  } catch {
    return refuse('bad_payment');
  }
}

export function verifySigma({ digest, sigma, publicKey } = {}) {
  try {
    if (!(digest instanceof Uint8Array) || digest.length !== 32) return refuse('bad_length');
    if (!(sigma instanceof Uint8Array) || sigma.length !== 64) return refuse('bad_sigma');
    const r = sigma.subarray(0, 32);
    const s = sigma.subarray(32);
    if (bytesToBig(r) <= 0n || bytesToBig(r) >= P256.order) return refuse('bad_sigma');
    if (!isLowS(s, P256)) return refuse('bad_sigma');
    const parity = yParityByTrial(digest, sigma, publicKey, P256);
    if (parity !== 0 && parity !== 1) return refuse('bad_signature');
    return { ok: true };
  } catch {
    return refuse('bad_signature');
  }
}

export function createSeller({ privateKey, store = createOnceStore(), reader, k } = {}) {
  const d = parseScalar(privateKey, P256.order);
  if (d == null) return refuse('bad_key');
  let publicKey;
  try {
    publicKey = publicPoint(d, P256);
  } catch {
    return refuse('bad_key');
  }
  const compressedKey = compressP256(publicKey);
  if (!compressedKey) return refuse('bad_key');
  return {
    publicKey,
    compressedKey,
    sign(request) {
      const nonceK = request && request.k != null ? request.k : k;
      return signSigma({ ...request, privateKey: d, store, reader, k: nonceK });
    },
  };
}

export function publicKeyHex(publicKey) {
  return bytesToHex(publicKey);
}
