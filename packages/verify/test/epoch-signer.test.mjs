/**
 * The epoch record is a trust path. A history key signs it only while that
 * key was active, and never after a revocation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { epochRecordSignatureOk } from '../dist/check-input.js';
import { jwkThumbprint } from '../dist/jws.js';

const AT = '2026-06-01T00:00:00.000Z';
const BEFORE = '2020-01-01T00:00:00.000Z';

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const exported = publicKey.export({ format: 'jwk' });
  const kid = jwkThumbprint(exported);
  const jwk = { kty: 'EC', crv: 'P-256', x: exported.x, y: exported.y, kid, alg: 'ES256', use: 'sig' };
  return { privateKey, kid, jwk };
}

function b64url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signEpoch(claims, pair) {
  const header = { alg: 'ES256', typ: 'chit402-tree-epoch+jwt', kid: pair.kid };
  const input = `${b64url(header)}.${b64url(claims)}`;
  const signature = sign('sha256', Buffer.from(input), { key: pair.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${input}.${signature.toString('base64url')}`;
}

function recordFor(pair, claims) {
  return {
    ...claims,
    issuer_signature: { jws: signEpoch(claims, pair), kid: pair.kid, issuer_jwk: pair.jwk },
  };
}

function history(pair, status, extra = {}) {
  return {
    schema: 'chit402.issuer_history.v1',
    entries: [{
      kid: pair.kid,
      jwk: pair.jwk,
      alg: 'ES256',
      not_before: BEFORE,
      not_after: null,
      status,
      revoked_at: null,
      ...extra,
    }],
  };
}

const claims = {
  schema: 'chit402.tree_epoch.v1',
  payload_version: 1,
  epochs: [{ epoch: 1 }],
  orphans: [],
  unlogged: null,
};

test('an active history key signs the epoch record', () => {
  const pair = keyPair();
  const record = recordFor(pair, claims);
  assert.equal(
    epochRecordSignatureOk(record, record.issuer_signature.jws, history(pair, 'active'), AT),
    true,
  );
});

test('a revoked history key does not sign the epoch record', () => {
  const pair = keyPair();
  const record = recordFor(pair, claims);
  const revoked = history(pair, 'revoked', { revoked_at: '2026-01-01T00:00:00.000Z' });
  assert.equal(epochRecordSignatureOk(record, record.issuer_signature.jws, revoked, AT), false);
  const later = history(pair, 'revoked', { revoked_at: '2026-12-01T00:00:00.000Z' });
  assert.equal(
    epochRecordSignatureOk(record, record.issuer_signature.jws, later, AT),
    false,
  );
});

test('a retired history key does not sign the epoch record', () => {
  const pair = keyPair();
  const record = recordFor(pair, claims);
  assert.equal(
    epochRecordSignatureOk(record, record.issuer_signature.jws, history(pair, 'retired'), AT),
    false,
  );
});

test('an active key is not active before not_before', () => {
  const pair = keyPair();
  const record = recordFor(pair, claims);
  assert.equal(
    epochRecordSignatureOk(record, record.issuer_signature.jws, history(pair, 'active'), '2019-01-01T00:00:00.000Z'),
    false,
  );
});

test('a retired key cannot backdate the epoch with its own iat', () => {
  const pair = keyPair();
  const retiredAt = '2026-07-01T00:00:00.000Z';
  const doc = {
    schema: 'chit402.issuer_history.v1',
    entries: [
      {
        kid: pair.kid,
        jwk: pair.jwk,
        alg: 'ES256',
        not_before: BEFORE,
        not_after: null,
        status: 'active',
        revoked_at: null,
      },
      {
        kid: pair.kid,
        jwk: pair.jwk,
        alg: 'ES256',
        not_before: retiredAt,
        not_after: null,
        status: 'retired',
        revoked_at: null,
      },
    ],
  };
  const earlyIat = recordFor(pair, { ...claims, iat: AT });
  assert.equal(
    epochRecordSignatureOk(earlyIat, earlyIat.issuer_signature.jws, doc, '2026-08-01T00:00:00.000Z'),
    false,
  );
  const lateIat = recordFor(pair, { ...claims, iat: '2026-08-01T00:00:00.000Z' });
  assert.equal(
    epochRecordSignatureOk(lateIat, lateIat.issuer_signature.jws, doc, AT),
    true,
  );
});
