/**
 * Test-snapshot pin for one local contract. The symbol is the verifier's
 * existing test seam. There is no CLI flag and no production pin is added.
 */
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { issuerHistoryEntryHash } from '../../packages/verify/dist/issuer-history.js';
import { jwkThumbprint } from '../../packages/verify/dist/jws.js';
import { TEST_SNAPSHOT } from '../../packages/verify/dist/internal/test-seam.js';

function b64(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function historyEntry(key, prev) {
  const body = {
    kid: key.kid,
    jwk: key.publicJwk,
    alg: 'ES256',
    not_before: '2020-01-01T00:00:00.000Z',
    not_after: null,
    status: 'active',
    revoked_at: null,
    reason: null,
    custody: 'local e2e dummy custody',
    prev_hash: prev,
  };
  return { ...body, entry_hash: issuerHistoryEntryHash(body) };
}

export function makeSnapshot(pin) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const exported = publicKey.export({ format: 'jwk' });
  const jwk = { kty: 'EC', crv: 'P-256', x: exported.x, y: exported.y, alg: 'ES256', use: 'sig' };
  const kid = jwkThumbprint(jwk);
  jwk.kid = kid;
  const key = { privateKey, publicJwk: jwk, kid };
  const entries = [historyEntry(key, null)];
  const head = entries[0].entry_hash;
  const claims = {
    schema: 'chit402.issuer_history.v1',
    payload_version: 1,
    entry_count: 1,
    head_hash: head,
    version: 1,
    seq: 1,
    narrowing: [],
    contracts: [pin],
  };
  const header = { alg: 'ES256', typ: 'chit402-issuer-history+jwt', kid };
  const input = `${b64(header)}.${b64(claims)}`;
  const signature = sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  const document = {
    schema: 'chit402.issuer_history.v1',
    payload_version: 1,
    version: 1,
    seq: 1,
    narrowing: [],
    entries,
    head_hash: head,
    issuer_signature: {
      alg: 'ES256',
      typ: 'chit402-issuer-history+jwt',
      payload_version: 1,
      jws: `${input}.${signature.toString('base64url')}`,
      kid,
      issuer_jwk: jwk,
    },
  };
  void createHash;
  return {
    kid,
    document,
    options(urls) {
      return {
        publicInput: true,
        trustedKids: [kid],
        rpcUrls: urls,
        [TEST_SNAPSHOT]: { issuerHistory: { document, bytes: JSON.stringify(document) } },
      };
    },
  };
}
