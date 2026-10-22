/**
 * Synthetic corpus cases: label, version and timing. Built fresh on every
 * run under a throwaway P-256 key, so no private key is stored. Verdicts do
 * not depend on the key bytes.
 *
 * Each case names the spec section it covers and a `target`: the result the
 * redesign must reach (rev 5, §2 and §5.1). The baseline is what 0.4.11 does
 * today. The corpus fails if a case becomes more permissive than its
 * baseline; reaching the target is tracked, and tightened through
 * changes.json by the PR that implements it.
 */
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeCoveringHistory } from '../history-file.mjs';

const fixtures = fileURLToPath(new URL('../fixtures/', import.meta.url));
const readFixture = (rel) => JSON.parse(readFileSync(join(fixtures, rel), 'utf8'));

export const TEST_KID = 'corpus-test-kid';

// Fixed signing times.
const T_SEP05 = Date.parse('2026-09-05T12:00:00Z') / 1000;
const T_OCT22 = Date.parse('2026-10-22T12:00:00Z') / 1000;

function testKey(kid = TEST_KID) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const e = publicKey.export({ format: 'jwk' });
  return { kid, privateKey, publicJwk: { kty: 'EC', crv: 'P-256', x: e.x, y: e.y, kid, alg: 'ES256', use: 'sig' } };
}

function b64(value) {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
}

function jws(key, claims) {
  const input = `${b64({ alg: 'ES256', typ: 'chit402-receipt+jwt', kid: key.kid })}.${b64(claims)}`;
  const sig = sign('sha256', Buffer.from(input), { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${input}.${sig.toString('base64url')}`;
}

function signedClaimsOf(doc) {
  return JSON.parse(Buffer.from(doc.issuer_signature.jws.split('.')[1], 'base64url'));
}

/** A receipt document whose JWS carries `claims`, signed by `key`. */
function docFor(key, claims, { outerPv } = {}) {
  const doc = {
    ...claims,
    issuer_signature: { alg: 'ES256', kid: key.kid, jws: jws(key, claims), issuer_jwk: key.publicJwk },
  };
  if (outerPv !== undefined) doc.issuer_signature.payload_version = outerPv;
  return doc;
}

/** v4/v5 object claims: only keys that existed before v6 (no payload_version). */
function unversionedClaims(taskId, iat) {
  return {
    task_id: taskId,
    iss: 'chit402',
    iat,
    payment: {
      rail: 'usdc',
      ref: `base:0x${'11'.repeat(32)}`,
      gross_amount: '2000',
      net_amount: '1900',
      payee: `0x${'22'.repeat(20)}`,
    },
  };
}

/**
 * Build every synthetic case into `dir`. Returns case descriptors; the
 * runner evaluates `paths` (cli = the CLI with production pins; library =
 * verifyReceipt with the test key and a covering test history).
 */
export async function buildSynthetic(dir) {
  const key = testKey();
  const historyFile = await writeCoveringHistory(dir, key);
  const jwksFile = join(dir, 'corpus-jwks.json');
  writeFileSync(jwksFile, JSON.stringify({ keys: [key.publicJwk] }));
  const out = [];
  const add = (c, doc) => {
    const file = join(dir, `${c.id}.json`);
    writeFileSync(file, JSON.stringify(doc));
    out.push({ kind: 'synthetic', paths: ['cli', 'library'], file, historyFile, jwksFile, ...c });
  };

  // --- label: the version stamp outside the signature is changed ---
  const v10 = readFixture('public/foreign-x402-muy1hh8y.json');
  {
    const doc = structuredClone(v10);
    doc.issuer_signature.payload_version = 6;
    add({ id: 'label-v10-outer-stamp-6', class: 'label', spec: '§5.1 relabel; §2 rule #1a', target: 'exit != 0; version taken from the signed claims only', paths: ['cli'] }, doc);
  }
  const v6 = readFixture('public/chit-1ebc5616.json');
  {
    const doc = structuredClone(v6);
    doc.issuer_signature.payload_version = 10;
    add({ id: 'label-v6-outer-stamp-10', class: 'label', spec: '§5.1 relabel; §2 rule #1a', target: 'never better than the unmodified v6 receipt (exit 1 NOT_IN_LOG)', paths: ['cli'] }, doc);
  }
  {
    const doc = docFor(key, unversionedClaims('xfuel-corpus-0000-label-4v5', T_SEP05), { outerPv: 4 });
    doc.hmac_attestation = { payload_version: 5 };
    add({ id: 'label-v4v5-conflicting-stamps', class: 'label', spec: '§5.1 relabel; L1', target: 'exit != 0 (stamps disagree: no inferred version)' }, doc);
  }

  // --- version: the signed version is older, newer, or missing ---
  {
    const claims = { ...signedClaimsOf(v10), payload_version: 6, iat: T_OCT22, task_id: 'xfuel-corpus-0000-version-v6-late' };
    add({ id: 'version-v10-claims-signed-as-v6-after-window', class: 'version', spec: '§5.1 relabel; §2 downgrade; PR3 window', target: 'exit != 0 (iat after the v6 window)' }, docFor(key, claims, { outerPv: 6 }));
  }
  {
    const claims = { ...signedClaimsOf(v10), payload_version: 13, iat: T_OCT22, task_id: 'xfuel-corpus-0000-version-v13' };
    add({ id: 'version-v13-unknown', class: 'version', spec: '§5.1; §2 unknown version', target: 'exit 2 unsupported_version' }, docFor(key, claims, { outerPv: 13 }));
  }
  {
    const claims = { ...signedClaimsOf(v10), iat: T_OCT22, task_id: 'chit-c0c0c0c0-0000-4000-8000-000000000012' };
    delete claims.payload_version;
    add({ id: 'version-v12-shape-no-version', class: 'version', spec: '§5.1; §2 missing version fails closed', target: 'exit 1 (no signed version outside the L1 allowlist)' }, docFor(key, claims));
  }
  {
    const claims = unversionedClaims('xfuel-corpus-0000-version-unstamped', T_OCT22);
    add({ id: 'version-unversioned-object-no-stamp', class: 'version', spec: '§2 missing version; L1', target: 'exit != 0' }, docFor(key, claims));
  }

  // --- version: L1 closed allowlist. v4/v5 and detached receipts pass only
  // when their exact fingerprint is on the bundled list; a newly signed one,
  // under any key, is not on it. No date test: a detached signature does
  // not cover created_at.
  for (const pv of [4, 5]) {
    const claims = unversionedClaims(`xfuel-corpus-0000-version-v${pv}-new`, T_OCT22);
    add({ id: `version-l1-v${pv}-not-allowlisted`, class: 'version', spec: 'L1; §5.2 registry allowlist', target: 'exit != 0 (fingerprint not on the bundled L1 list)' }, docFor(key, claims, { outerPv: pv }));
  }
  {
    const { canonicalIssuerPayload } = await import('../../dist/index.js');
    const doc = { task_id: 'xfuel-corpus-0000-version-detached-new', status: 'completed', created_at: '2026-10-22T12:00:00.000Z', payment: { rail: 'usdc', gross_amount: '1000' } };
    const value = sign('sha256', Buffer.from(canonicalIssuerPayload(doc), 'utf8'), { key: key.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    doc.issuer_signature = { alg: 'ES256', value, kid: key.kid };
    add({ id: 'version-l1-detached-not-allowlisted', class: 'version', spec: 'L1; §5.2 registry allowlist', target: 'exit != 0 (fingerprint not on the bundled L1 list)' }, doc);
    // Same detached receipt with only the unsigned created_at moved back.
    // The signature still verifies, so time is no evidence for this form.
    const moved = { ...structuredClone(doc), created_at: '2026-09-04T06:00:00.000Z' };
    add({ id: 'timing-detached-created-at-moved', class: 'timing', spec: 'L1 (no date test for detached)', target: 'same result as version-l1-detached-not-allowlisted' }, moved);
  }

  // --- timing: L5 two clocks ---
  {
    // Signed v5 with iat inside the v5 window. The log time comes from the
    // log and is later than the window. PR3 adds the anchored head fixture.
    const claims = { ...unversionedClaims('xfuel-corpus-0000-timing-backdated', T_SEP05), payload_version: 5 };
    add({ id: 'timing-l5-backdated-iat', class: 'timing', spec: 'L5; §5.3', target: 'exit != 0 (log time outside the v5 window)' }, docFor(key, claims, { outerPv: 5 }));
  }

  // --- control: a current-version receipt under the test key ---
  {
    const claims = { ...signedClaimsOf(v10), iat: T_OCT22, task_id: 'xfuel-corpus-0000-control-v10' };
    add({ id: 'control-test-key-v10', class: 'control', spec: '§5.1', target: 'unchanged (detects over-tightening)' }, docFor(key, claims, { outerPv: 10 }));
  }
  {
    const doc = readFixture('unsigned-self-binding.json');
    add({ id: 'control-unsigned-document', class: 'control', spec: '§3', target: 'exit 2 signed_receipt_unavailable', paths: ['cli'] }, doc);
  }
  return out;
}
