/**
 * Compact JWS must be canonical base64url: URL alphabet only, no padding,
 * zero trailing bits, and a 64-byte ES256 signature. Other spellings of the
 * same bytes are malformed_jws.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { verifyIssuerJws, readJwsHeader, isCanonicalBase64url, isCanonicalCompactEs256 } = await import('../dist/jws.js');

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const e = publicKey.export({ format: 'jwk' });
const jwk = { kty: 'EC', crv: 'P-256', x: e.x, y: e.y };
const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');

function signCompact(header = { alg: 'ES256', typ: 'chit402-receipt+jwt' }, payload = { task_id: 't', n: 1 }) {
  const input = `${b64(header)}.${b64(payload)}`;
  return `${input}.${sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}

/** Same bytes, different text: set the unused low bits of the last character. */
function nonZeroTrailingBits(segment) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const unused = { 2: 4, 3: 2 }[segment.length % 4];
  assert.ok(unused, 'segment length must leave unused bits');
  const last = alphabet.indexOf(segment.at(-1));
  const variant = `${segment.slice(0, -1)}${alphabet[last | 1]}`;
  assert.notEqual(variant, segment);
  assert.deepEqual(Buffer.from(variant, 'base64url'), Buffer.from(segment, 'base64url'));
  return variant;
}

test('a canonical JWS verifies', () => {
  const jws = signCompact();
  assert.equal(isCanonicalCompactEs256(jws), true);
  assert.equal(verifyIssuerJws(jws, jwk).valid, true);
});

test('non-canonical spellings of a valid JWS are malformed_jws', () => {
  const jws = signCompact();
  const [h, p, s] = jws.split('.');
  const variants = {
    'signature trailing bits': `${h}.${p}.${nonZeroTrailingBits(s)}`,
    'signature with + and /': `${h}.${p}.${Buffer.from(s, 'base64url').toString('base64')}`.replace(/=+$/, ''),
    'signature with == padding': `${h}.${p}.${s}==`,
    'signature with a junk character': `${h}.${p}.${s.slice(0, 10)}*${s.slice(10)}`,
    'signature of 65 bytes': `${h}.${p}.${Buffer.concat([Buffer.from(s, 'base64url'), Buffer.from([0])]).toString('base64url')}`,
    'signature of 63 bytes': `${h}.${p}.${Buffer.from(s, 'base64url').subarray(1).toString('base64url')}`,
    'empty payload segment': `${h}..${s}`,
  };
  // Force + or / to appear: the plain base64 of a signature may not contain them.
  const std = Buffer.from(s, 'base64url').toString('base64').replace(/=+$/, '');
  if (!/[+/]/.test(std)) variants['signature with + and /'] = `${h}.${p}.${s.replace(/-|_|.$/, '+')}`;
  for (const [name, variant] of Object.entries(variants)) {
    assert.equal(isCanonicalCompactEs256(variant), false, name);
    assert.equal(verifyIssuerJws(variant, jwk).reason, 'malformed_jws', name);
  }
});

test('a non-canonical header or payload is malformed even when re-signed over that text', () => {
  // Pick JSON whose base64url length leaves unused trailing bits.
  const padTo = (obj, key) => {
    for (let i = 0; i < 4; i++) {
      const text = b64({ ...obj, [key]: 'x'.repeat(i) });
      if (text.length % 4 !== 0) return text;
    }
    throw new Error('unreachable');
  };
  const header = padTo({ alg: 'ES256', typ: 'chit402-receipt+jwt' }, 'x');
  const payload = padTo({ task_id: 't', n: 1 }, 'pad');
  for (const [hh, pp] of [[nonZeroTrailingBits(header), payload], [header, nonZeroTrailingBits(payload)], [`${header}=`, payload]]) {
    const input = `${hh}.${pp}`;
    const jws = `${input}.${sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
    assert.equal(verifyIssuerJws(jws, jwk).reason, 'malformed_jws');
  }
  assert.equal(readJwsHeader(`${nonZeroTrailingBits(header)}.${payload}.x`), null);
  assert.equal(readJwsHeader(`${header}==.${payload}.x`), null);
  assert.equal(readJwsHeader(`${header}.${payload}.x`)?.alg, 'ES256');
});

test('isCanonicalBase64url', () => {
  assert.equal(isCanonicalBase64url('AQ'), true);
  assert.equal(isCanonicalBase64url('AR'), false);
  assert.equal(isCanonicalBase64url('AQ=='), false);
  assert.equal(isCanonicalBase64url('a+b/'), false);
  assert.equal(isCanonicalBase64url(''), false);
});

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', 'target', '.next']);
function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) yield* files(path);
    else if (st.size < 5_000_000 && /\.(json|jsonl|mjs|js|ts|md|txt|sig)$/.test(name)) yield path;
  }
}

test('every compact JWS committed in the repo is canonical', () => {
  // Header and payload are JSON objects ("eyJ"); the signature segment may
  // carry stray characters, so match any non-separator run and test it.
  const found = new Set();
  for (const file of files(repoRoot)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_\-+/=]{80,}/g)) {
      const jws = m[0];
      const header = readJwsHeader(jws);
      if (header?.alg !== 'ES256') continue;
      found.add(jws);
    }
  }
  assert.ok(found.size >= 15, `found ${found.size}`);
  const bad = [...found].filter((jws) => !isCanonicalCompactEs256(jws));
  assert.deepEqual(bad.map((jws) => jws.slice(0, 40)), []);
  console.log(`# canonical ES256 JWS in repo: ${found.size}`);
});
