/**
 * One-entry issuer history for a test key. not_before is early so a
 * receipt iat in 2026 is inside the window.
 */
import { sign } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

function b64url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export async function writeCoveringHistory(dir, key, notBefore = '2020-01-01T00:00:00.000Z', extras = []) {
  const { issuerHistoryEntryHash } = await import('../dist/issuer-history.js');
  const rows = [
    { kid: key.kid, jwk: key.publicJwk, not_before: notBefore },
    ...extras.map((extra) => ({
      kid: extra.kid,
      jwk: extra.publicJwk,
      not_before: extra.notBefore || notBefore,
    })),
  ];
  let prev = null;
  const entries = rows.map((row) => {
    const body = {
      kid: row.kid,
      jwk: row.jwk,
      alg: 'ES256',
      not_before: row.not_before,
      not_after: null,
      status: 'active',
      revoked_at: null,
      reason: null,
      custody: 'test custody',
      prev_hash: prev,
    };
    const entry = { ...body, entry_hash: issuerHistoryEntryHash(body) };
    prev = entry.entry_hash;
    return entry;
  });
  const head = entries[entries.length - 1].entry_hash;
  const claims = {
    schema: 'chit402.issuer_history.v1',
    payload_version: 1,
    entry_count: entries.length,
    head_hash: head,
    version: 1,
    seq: entries.length,
  };
  const header = { alg: 'ES256', typ: 'chit402-issuer-history+jwt', kid: key.kid };
  const signingInput = `${b64url(header)}.${b64url(claims)}`;
  const signature = sign('sha256', Buffer.from(signingInput), { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
  const doc = {
    schema: 'chit402.issuer_history.v1',
    payload_version: 1,
    version: 1,
    seq: entries.length,
    entries,
    head_hash: head,
    issuer_signature: {
      alg: 'ES256',
      typ: 'chit402-issuer-history+jwt',
      payload_version: 1,
      jws: `${signingInput}.${signature.toString('base64url')}`,
      kid: key.kid,
      issuer_jwk: key.publicJwk,
    },
  };
  const path = join(dir, 'issuer-history.json');
  writeFileSync(path, JSON.stringify(doc));
  return path;
}
