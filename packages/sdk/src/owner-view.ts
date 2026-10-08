/**
 * Owner-view client helpers. Tokens, salts, and signatures are not logged.
 */
import { createPublicKey, verify as verifySig } from 'node:crypto';

export const EIP712_DOMAIN_NAME = 'Chit402 Receipt Owner View';
export const EIP712_VERSION = '1';
export const EIP712_CHAIN_ID = 8453;
export const OWNER_STATEMENT = 'Open the private Chit402 receipt view for the audience and scope in this message. This is not a transfer, permit, or payment authorization.';
export const SOLANA_PREFIX = 'Chit402 owner view. This message is not a Solana transaction.\n';

export type OwnerScope =
  | { agent_id: number }
  | { receipt_ids: string[] }
  | { payer: true }
  | { house: true };

export interface OwnerChallenge {
  action: string;
  audience: string;
  scope: OwnerScope;
  nonce: string;
  issued_at: string;
  expires_at: string;
}

export interface TypedOwnerChallenge {
  domain: { name: string; version: string; chainId: number };
  types: { OwnerView: Array<{ name: string; type: string }> };
  primaryType: 'OwnerView';
  message: {
    action: string;
    audience: string;
    scope: string;
    nonce: string;
    issuedAt: string;
    expiresAt: string;
    statement: string;
  };
}

function jcs(value: unknown): string {
  return JSON.stringify(sort(value));
}

function sort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child === undefined) continue;
      out[key] = sort(child);
    }
    return out;
  }
  return value;
}

export function typedDataFor(challenge: OwnerChallenge): TypedOwnerChallenge {
  return {
    domain: {
      name: EIP712_DOMAIN_NAME,
      version: EIP712_VERSION,
      chainId: EIP712_CHAIN_ID,
    },
    types: {
      OwnerView: [
        { name: 'action', type: 'string' },
        { name: 'audience', type: 'string' },
        { name: 'scope', type: 'string' },
        { name: 'nonce', type: 'string' },
        { name: 'issuedAt', type: 'string' },
        { name: 'expiresAt', type: 'string' },
        { name: 'statement', type: 'string' },
      ],
    },
    primaryType: 'OwnerView',
    message: {
      action: challenge.action,
      audience: challenge.audience,
      scope: jcs(challenge.scope),
      nonce: challenge.nonce,
      issuedAt: challenge.issued_at,
      expiresAt: challenge.expires_at,
      statement: OWNER_STATEMENT,
    },
  };
}

export function solanaMessageBytes(challenge: OwnerChallenge): Uint8Array {
  const prefix = Buffer.from(SOLANA_PREFIX, 'utf8');
  const body = Buffer.from(jcs(challenge), 'utf8');
  return Buffer.concat([prefix, body]);
}

type EvmSigner = {
  signTypedData: (domain: unknown, types: unknown, message: unknown) => Promise<string>;
};

type SolanaSigner = {
  publicKey: Uint8Array | string;
  signMessage: (message: Uint8Array) => Promise<Uint8Array> | Uint8Array;
};

type AgentSigner = {
  signMessage: (message: string) => Promise<string>;
};

export async function signChallenge(
  challenge: OwnerChallenge,
  signer: EvmSigner | SolanaSigner | AgentSigner,
): Promise<{ signature: string; kind: 'evm' | 'solana' | 'agent' }> {
  if ('signTypedData' in signer && typeof signer.signTypedData === 'function') {
    const typed = typedDataFor(challenge);
    const signature = await signer.signTypedData(typed.domain, typed.types, typed.message);
    return { signature, kind: 'evm' };
  }
  if ('publicKey' in signer && typeof signer.signMessage === 'function') {
    const signed = await signer.signMessage(solanaMessageBytes(challenge));
    const signature = Buffer.from(signed).toString('base64');
    return { signature, kind: 'solana' };
  }
  if ('signMessage' in signer && typeof signer.signMessage === 'function') {
    const signature = await (signer as AgentSigner).signMessage(jcs(challenge));
    return { signature, kind: 'agent' };
  }
  throw new Error('signer cannot sign an owner challenge');
}

export async function verifyOwnerJws(
  jws: string | undefined,
  fetchJwks: (path: string) => Promise<{ keys?: Array<Record<string, string>> }>,
): Promise<{ ok: boolean; reason?: string }> {
  if (!jws || jws.split('.').length !== 3) return { ok: false, reason: 'invalid_jws' };
  const [headerB64, payloadB64, signatureB64] = jws.split('.');
  let header: { alg?: string; kid?: string };
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'invalid_jws' };
  }
  if (header.alg !== 'ES256') return { ok: false, reason: 'unsupported_alg' };
  let jwks: { keys?: Array<Record<string, string>> };
  try {
    jwks = await fetchJwks('/.well-known/jwks.json');
  } catch {
    return { ok: false, reason: 'jwks_unavailable' };
  }
  const jwk = (jwks.keys || []).find((key) => !header.kid || key.kid === header.kid);
  if (!jwk?.x || !jwk?.y) return { ok: false, reason: 'kid_not_found' };
  try {
    const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, format: 'jwk' });
    const signature = Buffer.from(signatureB64, 'base64url');
    const ok = verifySig('sha256', Buffer.from(`${headerB64}.${payloadB64}`), { key, dsaEncoding: 'ieee-p1363' }, signature);
    return ok ? { ok: true } : { ok: false, reason: 'bad_signature' };
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }
}
