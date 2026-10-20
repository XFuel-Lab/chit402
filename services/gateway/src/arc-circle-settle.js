/**
 * Circle Facilitator client for the Arc rail. Not wired into the settle path
 * yet; callers reach it only when ARC_RAIL_ENABLED is on.
 *
 * Every call carries a Facilitator-Seller-Proof: an EIP-712 SellerRequest
 * signed by the payTo key, bound to the route purpose, method and body hash.
 * The key is read from ARC_SELLER_PROOF_KEY at call time. It is absent by
 * default, and without it every call fails closed before any network I/O.
 * The key is never logged or returned.
 */
import crypto from 'node:crypto';
import { ethers } from 'ethers';
import { ARC_CHAINS, arcNetwork } from './arc-rail.js';

export const CIRCLE_FACILITATOR_BASE = 'https://api.circle.com/v1/facilitator/x402';

const SELLER_TYPES = {
  SellerRequest: [
    { name: 'purpose', type: 'string' },
    { name: 'method', type: 'string' },
    { name: 'bodyHash', type: 'bytes32' },
    { name: 'network', type: 'string' },
    { name: 'payTo', type: 'address' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'issuedAt', type: 'uint64' },
    { name: 'expiresAt', type: 'uint64' },
  ],
};

function sellerSigner(env) {
  const raw = String(env?.ARC_SELLER_PROOF_KEY || '').trim();
  if (!raw) return null;
  try {
    return new ethers.Wallet(raw.startsWith('0x') ? raw : `0x${raw}`);
  } catch {
    return null;
  }
}

/**
 * Base64url seller proof. Returns null when the key is missing or does not
 * control payTo (the proof would be rejected, so do not send it).
 */
export async function buildSellerProof({
  purpose, method, body = '', network, payTo, env = process.env, now = Date.now(), ttlSeconds = 300,
}) {
  const short = arcNetwork(network, env);
  if (!short) return null;
  const signer = sellerSigner(env);
  if (!signer || !payTo || signer.address.toLowerCase() !== String(payTo).toLowerCase()) return null;
  const chain = ARC_CHAINS[short];
  const nonce = `0x${crypto.randomBytes(32).toString('hex')}`;
  const issuedAt = Math.floor(now / 1000);
  const expiresAt = issuedAt + ttlSeconds;
  const signature = await signer.signTypedData(
    { name: 'Circle Facilitator Seller Request', version: '1', chainId: chain.chainId },
    SELLER_TYPES,
    {
      purpose,
      method: String(method).toUpperCase(),
      bodyHash: ethers.keccak256(ethers.toUtf8Bytes(body)),
      network: chain.caip,
      payTo: ethers.getAddress(payTo),
      nonce,
      issuedAt,
      expiresAt,
    },
  );
  const envelope = { version: 1, signature, network: chain.caip, payTo: ethers.getAddress(payTo), nonce, issuedAt, expiresAt };
  return Buffer.from(JSON.stringify(envelope)).toString('base64url');
}

/**
 * POST /settle. Returns the facilitator's settle object on HTTP 200, or
 * { ok:false, code } without calling out when the rail is off or the key is
 * missing. A pending answer (success:false, settlement_pending) is returned
 * as-is; it is never treated as paid.
 */
export async function circleSettle({
  paymentPayload, paymentRequirements, env = process.env, fetchImpl = fetch, timeoutMs = 15000, baseUrl = CIRCLE_FACILITATOR_BASE,
}) {
  const network = paymentRequirements?.network;
  if (!arcNetwork(network, env)) return { ok: false, code: 'network_not_accepted' };
  const payTo = paymentRequirements?.payTo;
  const body = JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements });
  const proof = await buildSellerProof({ purpose: 'settle', method: 'POST', body, network, payTo, env });
  if (!proof) return { ok: false, code: 'gateway_not_configured' };
  let res;
  try {
    res = await fetchImpl(`${baseUrl}/settle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Facilitator-Seller-Proof': proof },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { ok: false, code: 'settle_unconfirmed', pending: true };
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (res.status !== 200 || !data || typeof data !== 'object') {
    return { ok: false, code: 'settle_failed', status: res.status };
  }
  if (data.success !== true) {
    const pending = data.errorReason === 'settlement_pending';
    return { ok: false, code: pending ? 'settle_pending' : 'settle_failed', pending, settle: data };
  }
  return { ok: true, settle: data };
}
