/**
 * Version registry (redesign step 2): frozen rule sets, a digest guard, and
 * the L1 closed allowlist loader. No verdict changes; the golden corpus
 * checks that.
 */
'use strict';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const lib = await import('../dist/index.js');
const {
  VERSION_REGISTRY, FEATURE_FIRST_VERSION, ruleSetDigest, registeredPayloadVersion, registeredVersion, versionHasFeature,
  SUPPORTED_RECEIPT_VERSIONS, HEAD_BINDING_PAYLOAD_VERSION, CANONICAL_PAYLOAD_VERSION,
  LEGACY_ALLOWLIST_SHA256, onLegacyAllowlist,
  legacyReceiptFingerprint, canonicalIssuerPayload,
} = lib;
// Internal module: the loader and the list-taking matcher are not package API.
const {
  parseLegacyAllowlistInternal, loadBundledLegacyAllowlistInternal, onLegacyAllowlistInternal, lowSSignature,
} = await import('../dist/legacy-allowlist.js');
const parseLegacyAllowlist = (bytes, pinned = true) => parseLegacyAllowlistInternal(bytes, { unpinnedForTest: !pinned });
const onList = onLegacyAllowlistInternal;

const frozen = JSON.parse(readFileSync(new URL('./fixtures/version-registry.frozen.json', import.meta.url), 'utf8'));
const listPath = fileURLToPath(new URL('../legacy-allowlist.json', import.meta.url));

test('every frozen rule set is unchanged and the registry only appends', () => {
  frozen.entries.forEach((f, i) => {
    const r = VERSION_REGISTRY[i];
    assert.ok(r, `frozen entry ${f.id} is gone`);
    assert.equal(r.id, f.id, `entry ${i} moved`);
    assert.equal(r.rule_set, f.rule_set, `${f.id} rule_set changed`);
    assert.equal(r.rule_set_digest, f.rule_set_digest, `${f.id} rule set edited: add a new version instead`);
    assert.equal(ruleSetDigest(r), r.rule_set_digest);
  });
  assert.equal(new Set(VERSION_REGISTRY.map((r) => r.id)).size, VERSION_REGISTRY.length);
  assert.equal(new Set(VERSION_REGISTRY.map((r) => r.rule_set)).size, VERSION_REGISTRY.length);
});

test('the registry is deeply frozen', () => {
  assert.ok(Object.isFrozen(VERSION_REGISTRY));
  for (const r of VERSION_REGISTRY) {
    assert.ok(Object.isFrozen(r) && Object.isFrozen(r.features) && Object.isFrozen(r.layers), r.id);
  }
  assert.throws(() => { VERSION_REGISTRY[0].label = 'x'; }, TypeError);
  assert.throws(() => { VERSION_REGISTRY[9].features.canonical_preimage = false; }, TypeError);
  assert.throws(() => { VERSION_REGISTRY.push({}); }, TypeError);
  assert.ok(Object.isFrozen(FEATURE_FIRST_VERSION));
});

test('the weakened path does not move the digest; any rule field does', () => {
  const r = { ...registeredPayloadVersion(7) };
  delete r.rule_set_digest;
  const base = ruleSetDigest(r);
  assert.equal(ruleSetDigest({ ...r, status: 'weakened', weakened_at: '2026-10-22', weakened_reason: 'x' }), base);
  for (const change of [{ label: 'v7: other' }, { layers: ['A'] }, { l1_allowlist: true }, { features: { ...r.features, head_binding: true } }, { version: 8 }]) {
    assert.notEqual(ruleSetDigest({ ...r, ...change }), base, JSON.stringify(change));
  }
});

test('the registry matches the accepted versions and the gates', () => {
  const signed = VERSION_REGISTRY.filter((r) => r.form === 'signed').map((r) => r.version).sort((a, b) => a - b);
  assert.deepEqual(signed, [...SUPPORTED_RECEIPT_VERSIONS.payload_version].sort((a, b) => a - b));
  assert.deepEqual(VERSION_REGISTRY.filter((r) => r.form === 'v').map((r) => r.version), [...SUPPORTED_RECEIPT_VERSIONS.v]);
  assert.deepEqual(VERSION_REGISTRY.filter((r) => r.form === 'inferred').map((r) => r.version), [...SUPPORTED_RECEIPT_VERSIONS.legacy_unversioned_outer]);
  assert.deepEqual(VERSION_REGISTRY.filter((r) => r.l1_allowlist).map((r) => r.id), ['legacy-v4', 'legacy-v5', 'detached']);
  // Same values the gates had before the registry.
  assert.equal(HEAD_BINDING_PAYLOAD_VERSION, 9);
  assert.equal(CANONICAL_PAYLOAD_VERSION, 10);
  assert.equal(versionHasFeature(7, 'v8_fields'), false);
  assert.equal(versionHasFeature(8, 'v8_fields'), true);
  for (let v = 1; v <= 10; v += 1) {
    const r = registeredPayloadVersion(v);
    assert.equal(r.features.head_binding, v >= 9);
    assert.equal(r.features.canonical_preimage, v >= 10);
    assert.equal(r.features.v8_fields, v >= 8);
  }
  assert.equal(registeredPayloadVersion(12), null);
  assert.equal(registeredVersion('detached').version, null);
});

// ---------- L1 allowlist ----------

const key = (() => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return privateKey;
})();
const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
function v4Receipt(taskId = 'xfuel-l1-0001') {
  const claims = { task_id: taskId, iss: 'chit402', iat: 1788500000, payment: { rail: 'usdc', ref: `base:0x${'11'.repeat(32)}`, gross_amount: '2000' } };
  const input = `${b64({ alg: 'ES256', typ: 'chit402-receipt+jwt', kid: 'k' })}.${b64(claims)}`;
  const sig = sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return { ...claims, book_chain: { row_hash: 'ab'.repeat(32) }, issuer_signature: { alg: 'ES256', kid: 'k', jws: `${input}.${sig}`, payload_version: 4 } };
}
function detached(createdAt) {
  const doc = { task_id: 'xfuel-l1-detached', status: 'completed', created_at: createdAt, payment: { rail: 'usdc', gross_amount: '1000' } };
  const value = sign('sha256', Buffer.from(canonicalIssuerPayload(doc), 'utf8'), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return { ...doc, issuer_signature: { alg: 'ES256', kid: 'k', value } };
}
const finalList = (entries) => parseLegacyAllowlist(JSON.stringify({ schema: 'chit402.legacy_allowlist.v1', status: 'final', note: '', entries }), false);

test('the bundled list is the pinned, final, empty list', () => {
  const list = loadBundledLegacyAllowlistInternal();
  assert.equal(list.ok, true);
  assert.equal(list.status, 'final');
  assert.deepEqual([...list.entries], []);
  const bytes = readFileSync(listPath, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), LEGACY_ALLOWLIST_SHA256);
  assert.match(JSON.parse(bytes).note, /107 task files, 6 book rows/);
  assert.equal(onLegacyAllowlist(legacyReceiptFingerprint(v4Receipt())), false);
});

test('the loader fails closed', () => {
  const bytes = readFileSync(listPath, 'utf8');
  assert.equal(parseLegacyAllowlist(bytes.replace('"entries": []', '"entries": [ ]')).reason, 'legacy_allowlist_digest_mismatch');
  assert.equal(parseLegacyAllowlist('{', false).reason, 'legacy_allowlist_unreadable');
  assert.equal(parseLegacyAllowlist(JSON.stringify({ schema: 'x', status: 'final', entries: [] }), false).reason, 'legacy_allowlist_schema');
  const fp = legacyReceiptFingerprint(v4Receipt());
  assert.equal(parseLegacyAllowlist(JSON.stringify({ schema: 'chit402.legacy_allowlist.v1', status: 'placeholder', entries: [fp] }), false).reason, 'legacy_allowlist_status');
  assert.equal(finalList([{ ...fp, extra: 1 }]).reason, 'legacy_allowlist_entry');
  assert.equal(finalList([{ ...fp, payload_sha256: 'AB'.repeat(32) }]).reason, 'legacy_allowlist_entry');
  assert.equal(finalList([{ ...fp, form: 'pv6' }]).reason, 'legacy_allowlist_entry');
  assert.equal(finalList([fp, fp]).reason, 'legacy_allowlist_duplicate');
  const bad = finalList([{ ...fp, extra: 1 }]);
  assert.equal(onList(fp, bad), false);
});

test('only the exact listed receipt matches', () => {
  const listed = v4Receipt();
  const fp = legacyReceiptFingerprint(listed);
  assert.equal(fp.form, 'legacy-v4');
  assert.equal(fp.row_hash, 'ab'.repeat(32));
  const list = finalList([fp]);
  assert.equal(list.ok, true);
  assert.equal(onList(fp, list), true);
  // Same claims signed again (new signature bytes): not listed.
  assert.equal(onList(legacyReceiptFingerprint(v4Receipt()), list), false);
  // Another task id, another row hash, the other outer version: not listed.
  assert.equal(onList({ ...fp, task_id: 'xfuel-l1-0002' }, list), false);
  assert.equal(onList({ ...fp, row_hash: 'cd'.repeat(32) }, list), false);
  assert.equal(onList({ ...fp, form: 'legacy-v5' }, list), false);
  // An entry without a row hash still binds payload and signature.
  const loose = finalList([{ ...fp, row_hash: null }]);
  assert.equal(onList({ ...fp, row_hash: null }, loose), true);
  assert.equal(onList({ ...fp, signature_sha256: 'ee'.repeat(32) }, loose), false);
});

test('fingerprints: forms, and why no date is used for detached', () => {
  const real = JSON.parse(readFileSync(new URL('./fixtures/public/foreign-x402-muy1hh8y.json', import.meta.url), 'utf8'));
  assert.equal(legacyReceiptFingerprint(real), null, 'signed v10 is not an L1 form');
  const v5 = v4Receipt();
  v5.issuer_signature.payload_version = 5;
  assert.equal(legacyReceiptFingerprint(v5).form, 'legacy-v5');
  const a = detached('2026-10-22T12:00:00.000Z');
  const fp = legacyReceiptFingerprint(a);
  assert.equal(fp.form, 'detached');
  // created_at is not covered by the detached signature: moving it leaves
  // the fingerprint, and the signature, unchanged.
  const moved = { ...a, created_at: '2026-09-04T06:00:00.000Z' };
  assert.deepEqual(legacyReceiptFingerprint(moved), fp);
});

test('the allowlist API: no unpinned parser, loader or caller list is exported', () => {
  for (const name of ['parseLegacyAllowlist', 'loadBundledLegacyAllowlist', 'parseLegacyAllowlistInternal', 'loadBundledLegacyAllowlistInternal', 'onLegacyAllowlistInternal']) {
    assert.equal(name in lib, false, name);
  }
  assert.equal(onLegacyAllowlist.length, 1);
  // A caller-supplied second argument is ignored: only the bundled (empty) list counts.
  const fp = legacyReceiptFingerprint(v4Receipt());
  assert.equal(onLegacyAllowlist(fp, finalList([fp])), false);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(Object.keys(pkg.exports).some((k) => /allowlist|internal/.test(k)), false);
});

test('low-S: both encodings of one signature share a fingerprint; one entry per signed payload', () => {
  const N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
  const receipt = v4Receipt();
  const parts = receipt.issuer_signature.jws.split('.');
  const sig = Buffer.from(parts[2], 'base64url');
  const s = BigInt(`0x${sig.subarray(32).toString('hex')}`);
  const flipped = Buffer.concat([sig.subarray(0, 32), Buffer.from((N - s).toString(16).padStart(64, '0'), 'hex')]);
  const other = { ...receipt, issuer_signature: { ...receipt.issuer_signature, jws: `${parts[0]}.${parts[1]}.${flipped.toString('base64url')}` } };
  const a = legacyReceiptFingerprint(receipt);
  const b = legacyReceiptFingerprint(other);
  assert.deepEqual(a, b);
  assert.ok(BigInt(`0x${lowSSignature(flipped).subarray(32).toString('hex')}`) <= N >> 1n);
  assert.deepEqual(lowSSignature(lowSSignature(sig)), lowSSignature(sig));
  // Two entries for the same (form, task_id, payload) are refused, whatever the signature.
  assert.equal(finalList([a, { ...a, signature_sha256: 'ee'.repeat(32) }]).reason, 'legacy_allowlist_duplicate');
});
