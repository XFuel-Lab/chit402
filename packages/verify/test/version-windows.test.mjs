/**
 * Verifier redesign step 3: signed version validity windows, the L1 closed
 * list (empty, enforced), the L5 log-time check, and the library-only test
 * snapshot seam.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const windowsPath = join(pkgDir, 'version-windows.json');
const helper = join(pkgDir, 'scripts', 'version-windows.mjs');

const {
  VERSION_WINDOWS_SHA256,
  VERSION_WINDOWS_PRODUCTION_KID,
  loadBundledVersionWindows,
  activeVersionWindows,
  enforceableVersionWindows,
  parseVersionWindows,
  versionWindowsBodyHash,
  checkSignedTime,
  checkLogTime,
} = await import('../dist/version-windows.js');
const { earliestLogTime, logTimeReason } = await import('../dist/log-time.js');
const { TEST_SNAPSHOT, readTestSnapshot, parseLegacyAllowlistForTest } = await import('../dist/internal/test-seam.js');
const index = await import('../dist/index.js');
const { verifyReceipt, VERSION_REGISTRY, legacyReceiptFingerprint } = index;
const { buildVerifyVerdict } = await import('../dist/verdict.js');

// GitHub merge times of the PRs that shipped each payload version.
const MERGED = {
  5: '2026-09-04T08:52:05Z', // #293, also the production key not_before
  6: '2026-09-05T15:59:45Z', // #314
  7: '2026-09-13T15:11:38Z', // #359
  8: '2026-09-27T12:49:47Z', // #429
  9: '2026-10-02T14:50:24Z', // #468
  10: '2026-10-05T08:49:28Z', // #473
  11: '2026-10-08T20:40:53Z', // #483
};
const H72 = 72 * 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const kid = createHash('sha256').update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })).digest('base64url');
  return { privateKey, jwk: { ...jwk, kid, alg: 'ES256', use: 'sig' }, kid };
}

function signWindows(body, key, kid = key.kid) {
  const dir = mkdtempSync(join(tmpdir(), 'vw-'));
  const bodyPath = join(dir, 'body.json');
  writeFileSync(bodyPath, JSON.stringify(body));
  const input = execFileSync(process.execPath, [helper, 'signing-input', bodyPath, kid, '1792674000']).toString();
  const sig = sign('sha256', Buffer.from(input), { key: key.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const out = join(dir, 'doc.json');
  execFileSync(process.execPath, [helper, 'assemble', bodyPath, kid, '1792674000', sig, out]);
  return readFileSync(out, 'utf8');
}

const bundledBody = () => {
  const doc = JSON.parse(readFileSync(windowsPath, 'utf8'));
  delete doc.issuer_signature;
  return doc;
};

// ---------- the bundled document ----------

test('the bundled windows document is the pinned, test-signed one', () => {
  const bytes = readFileSync(windowsPath, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), VERSION_WINDOWS_SHA256);
  const w = loadBundledVersionWindows();
  assert.equal(w.ok, true, w.reason);
  // PR builds carry a test signature; the signing ceremony replaces it and
  // the publish check refuses anything else.
  assert.equal(w.signature, 'not_production');
  assert.match(w.signed_kid, /^test-version-windows-/);
  assert.notEqual(w.signed_kid, VERSION_WINDOWS_PRODUCTION_KID);
});

test('the publish check refuses the test-signed document', () => {
  let failed = null;
  try {
    execFileSync(process.execPath, [helper, 'check'], { stdio: 'pipe' });
  } catch (err) {
    failed = String(err.stderr);
  }
  assert.match(failed ?? '', /not signed by the production issuer key/);
});

test('every registry version outside the L1 list has exactly one window', () => {
  const w = loadBundledVersionWindows();
  const expected = VERSION_REGISTRY.filter((r) => !r.l1_allowlist).map((r) => r.id).sort();
  assert.deepEqual([...w.windows.keys()].sort(), expected);
  for (const r of VERSION_REGISTRY.filter((v) => v.l1_allowlist)) assert.equal(w.windows.has(r.id), false, r.id);
});

test('windows open at the merge time and close at the next merge plus 72 h', () => {
  const w = loadBundledVersionWindows().windows;
  for (let v = 5; v <= 9; v += 1) {
    const row = w.get(`pv${v}`);
    assert.equal(row.not_before, MERGED[v], `pv${v} open`);
    assert.equal(row.not_after, iso(Date.parse(MERGED[v + 1]) + H72), `pv${v} close`);
    assert.equal(row.floor, false);
  }
  for (let v = 1; v <= 4; v += 1) {
    assert.equal(w.get(`pv${v}`).not_after, MERGED[5], `pv${v} never issued`);
  }
  assert.equal(w.get('pv10').not_before, MERGED[10]);
  assert.equal(w.get('pv10').not_after, null);
  assert.equal(w.get('pv10').floor, false);
  for (const id of ['pv11-issuer-root', 'v11']) {
    assert.equal(w.get(id).not_before, MERGED[11]);
    assert.equal(w.get(id).not_after, null);
    assert.equal(w.get(id).floor, true, `${id} floor`);
  }
  assert.equal(loadBundledVersionWindows().log_grace_seconds, 14 * 86400);
});

test('sanity: fixture xfuel-c5a3860d (pv5, iat 09:39Z) sits inside the pv5 window', () => {
  // Production signed #293 code 47 minutes after the merge: merge time is
  // at most minutes early, and the upper bound holds.
  const w = loadBundledVersionWindows();
  const iat = Date.parse('2026-09-04T09:39:00Z') / 1000;
  assert.equal(checkSignedTime('pv5', iat, w).ok, true);
  assert.ok(iat * 1000 - Date.parse(MERGED[5]) < 60 * 60 * 1000);
});

test('the helper signs the same body hash the verifier checks', () => {
  const body = bundledBody();
  const input = execFileSync(process.execPath, [helper, 'signing-input', windowsPath, 'k', '1']).toString();
  const payload = JSON.parse(Buffer.from(input.split('.')[1], 'base64url').toString('utf8'));
  assert.equal(payload.body_sha256, versionWindowsBodyHash(body));
  assert.equal(payload.schema, 'chit402.version_windows.v1');
});

// ---------- parsing ----------

test('the parser fails closed and reports the signer', () => {
  const bytes = readFileSync(windowsPath, 'utf8');
  assert.equal(parseVersionWindows(bytes.replace('"pv10"', '"pv10 "')).reason, 'version_windows_digest_mismatch');
  assert.equal(parseVersionWindows('{', { expectedSha256: null }).reason, 'version_windows_unreadable');
  const body = bundledBody();
  const k = keyPair();
  const parse = (b, keys = []) => parseVersionWindows(signWindows(b, k), { expectedSha256: null, keys });
  assert.equal(parse({ ...body, schema: 'x' }).reason, 'version_windows_schema');
  assert.equal(parse({ ...body, log_grace_seconds: -1 }).reason, 'version_windows_log_grace');
  assert.equal(parse({ ...body, windows: [...body.windows, body.windows[0]] }).reason, 'version_windows_duplicate');
  assert.equal(parse({ ...body, windows: [{ ...body.windows[5], extra: 1 }] }).reason, 'version_windows_entry');
  assert.equal(parse({ ...body, windows: [{ ...body.windows[5], not_after: '2026-01-01T00:00:00Z' }] }).reason, 'version_windows_entry');
  const prodKeys = (jwk) => [{ kid: VERSION_WINDOWS_PRODUCTION_KID, jwk }];
  assert.equal(parseVersionWindows(signWindows(body, k, VERSION_WINDOWS_PRODUCTION_KID), { expectedSha256: null, keys: prodKeys(k.jwk) }).signature, 'production');
  const other = keyPair();
  assert.equal(parseVersionWindows(signWindows(body, k, VERSION_WINDOWS_PRODUCTION_KID), { expectedSha256: null, keys: prodKeys(other.jwk) }).signature, 'invalid');
  const edited = JSON.parse(signWindows(body, k, VERSION_WINDOWS_PRODUCTION_KID));
  edited.log_grace_seconds = 999999999;
  assert.equal(parseVersionWindows(JSON.stringify(edited), { expectedSha256: null, keys: prodKeys(k.jwk) }).signature, 'invalid');
});

// ---------- signed time ----------

test('signed time: closed, open, floor, missing', () => {
  const w = loadBundledVersionWindows();
  const s = (ts) => Date.parse(ts) / 1000;
  assert.equal(checkSignedTime('pv7', s('2026-09-20T00:00:00Z'), w).ok, true);
  assert.equal(checkSignedTime('pv7', s('2026-09-30T12:49:47Z'), w).ok, true, 'close is inclusive');
  assert.equal(checkSignedTime('pv7', s('2026-09-30T12:49:48Z'), w).reason, 'version_window_closed');
  assert.equal(checkSignedTime('pv6', s('2026-10-20T00:00:00Z'), w).reason, 'version_window_closed');
  // Up to v10 the issuer re-signed on read with the original iat: no floor.
  assert.equal(checkSignedTime('pv10', s('2026-09-26T00:00:00Z'), w).ok, true);
  assert.equal(checkSignedTime('pv8', s('2026-09-01T00:00:00Z'), w).ok, true);
  assert.equal(checkSignedTime('v11', '2026-10-08T20:40Z', w).reason, 'version_window_not_open');
  assert.equal(checkSignedTime('v11', '2026-10-09T00:00Z', w).ok, true);
  assert.equal(checkSignedTime('pv9', null, w).reason, 'issued_at_missing');
  assert.equal(checkSignedTime('pv10', null, w).ok, true, 'open window without a floor needs no iat');
  assert.equal(checkSignedTime('pv12', s('2026-10-20T00:00:00Z'), w).reason, 'version_window_missing');
  assert.equal(checkSignedTime(null, 1, w).reason, 'version_window_missing');
  assert.equal(checkSignedTime('pv7', 1, { ...w, ok: false }).reason, 'version_window_missing');
});

const kp = keyPair();
function compact(header, claims, key = kp) {
  const input = `${b64(header)}.${b64(claims)}`;
  return `${input}.${sign('sha256', Buffer.from(input), { key: key.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}
function signedReceipt(claims) {
  return {
    task_id: claims.task_id,
    payment: claims.payment,
    issuer_signature: { alg: 'ES256', kid: kp.kid, jws: compact({ alg: 'ES256', typ: 'chit402-receipt+jwt', kid: kp.kid }, claims), payload_version: claims.payload_version },
  };
}
const payment = { rail: 'usdc', ref: `base:0x${'12'.repeat(32)}`, gross_amount: '2000', settled_amount: '2000' };
const trust = { jwks: { keys: [kp.jwk] }, trustedKids: [kp.kid] };

// The bundled document is test-signed in this build, so outside tests it is
// not enforced. These cases pass windows through the library-only test seam.
const seamOpts = (windows) => ({ ...trust, [TEST_SNAPSHOT]: { versionWindows: windows } });

test('outside tests a test-signed bundled document is not enforced: no new refusal', async () => {
  assert.equal(loadBundledVersionWindows().signature, 'not_production');
  assert.equal(activeVersionWindows(), null);
  const late = signedReceipt({ task_id: 'xfuel-00000000-0000-4000-8000-0000000000c4', payload_version: 7, iat: Date.parse('2026-10-20T00:00:00Z') / 1000, payment });
  const res = await verifyReceipt(late, trust);
  assert.equal(res.issuer_signature.valid, true);
  assert.equal(res.errors.some((e) => /version_window|issued_at_missing/.test(e)), false, res.errors.join('; '));
  const noIat = await verifyReceipt(signedReceipt({ task_id: 'xfuel-00000000-0000-4000-8000-0000000000c5', payload_version: 9, payment }), trust);
  assert.equal(noIat.errors.some((e) => /version_window|issued_at_missing/.test(e)), false);
});

test('enforcement: production-signed is enforced, test-signed only through the test option, a failed parse never', () => {
  const body = bundledBody();
  const k = keyPair();
  const prod = parseVersionWindows(signWindows(body, k, VERSION_WINDOWS_PRODUCTION_KID), { expectedSha256: null, keys: [{ kid: VERSION_WINDOWS_PRODUCTION_KID, jwk: k.jwk }] });
  assert.equal(prod.signature, 'production');
  assert.equal(enforceableVersionWindows(prod), prod);
  const test = parseVersionWindows(signWindows(body, k), { expectedSha256: null, keys: [{ kid: k.kid, jwk: k.jwk }] });
  assert.equal(test.signature, 'not_production');
  assert.equal(enforceableVersionWindows(test), null);
  assert.equal(enforceableVersionWindows(test, true), test);
  const wrongKey = parseVersionWindows(signWindows(body, k, VERSION_WINDOWS_PRODUCTION_KID), { expectedSha256: null, keys: [{ kid: VERSION_WINDOWS_PRODUCTION_KID, jwk: keyPair().jwk }] });
  assert.equal(wrongKey.signature, 'invalid');
  assert.equal(enforceableVersionWindows(wrongKey), null);
  assert.equal(enforceableVersionWindows(parseVersionWindows('{', { expectedSha256: null })), null);
  assert.equal(enforceableVersionWindows(parseVersionWindows('{', { expectedSha256: null }), true), null);
  assert.equal(activeVersionWindows(test), test);
});

test('library (enforced windows): a v7 receipt signed after v7 closed is refused (key_window, exit 1)', async () => {
  const windows = loadBundledVersionWindows();
  const late = signedReceipt({ task_id: 'xfuel-00000000-0000-4000-8000-0000000000c1', payload_version: 7, iat: Date.parse('2026-10-20T00:00:00Z') / 1000, payment });
  const res = await verifyReceipt(late, seamOpts(windows));
  assert.equal(res.issuer_signature.valid, true);
  assert.equal(res.overall, 'failed');
  assert.equal(res.issuer_history.reason, 'version_window_closed');
  assert.ok(res.errors.includes('issuer history: version_window_closed'));
  assert.equal(res.verdict.exit_code, 1);
  assert.equal(res.verdict.checks.key_window, 'fail');
  assert.equal(res.verdict.reason, 'version_window_closed');
  const inside = signedReceipt({ task_id: 'xfuel-00000000-0000-4000-8000-0000000000c2', payload_version: 7, iat: Date.parse('2026-09-20T00:00:00Z') / 1000, payment });
  const ok = await verifyReceipt(inside, seamOpts(windows));
  assert.equal(ok.errors.some((e) => /version_window/.test(e)), false, ok.errors.join('; '));
});

test('library (enforced windows, production-signed): the same refusal holds for a production-status document', async () => {
  const k = keyPair();
  const prod = parseVersionWindows(signWindows(bundledBody(), k, VERSION_WINDOWS_PRODUCTION_KID), { expectedSha256: null, keys: [{ kid: VERSION_WINDOWS_PRODUCTION_KID, jwk: k.jwk }] });
  const late = signedReceipt({ task_id: 'xfuel-00000000-0000-4000-8000-0000000000c6', payload_version: 6, iat: Date.parse('2026-10-20T00:00:00Z') / 1000, payment });
  const res = await verifyReceipt(late, seamOpts(prod));
  assert.equal(res.issuer_history.reason, 'version_window_closed');
  assert.equal(res.verdict.exit_code, 1);
});

test('library (enforced windows): a closed-version receipt with no iat is refused', async () => {
  const res = await verifyReceipt(signedReceipt({ task_id: 'xfuel-00000000-0000-4000-8000-0000000000c3', payload_version: 9, payment }), seamOpts(loadBundledVersionWindows()));
  assert.equal(res.overall, 'failed');
  assert.equal(res.issuer_history.reason, 'issued_at_missing');
});

// ---------- L1 ----------

const l1Claims = { task_id: 'task-unversioned', iat: 1, payment: { rail: 'usdc', ref: `base:0x${'11'.repeat(32)}`, gross_amount: '2000', net_amount: '1900' } };
const l1Receipt = (outer, jws) => ({ task_id: l1Claims.task_id, payment: l1Claims.payment, issuer_signature: { alg: 'ES256', kid: kp.kid, jws, payload_version: outer } });

test('L1: the list is empty, so v4/v5 inferred and detached forms are refused (exit 1, shape)', async () => {
  const jws = compact({ alg: 'ES256', typ: 'chit402-receipt+jwt', kid: kp.kid }, l1Claims);
  for (const outer of [4, 5]) {
    const res = await verifyReceipt(l1Receipt(outer, jws), trust);
    assert.deepEqual(res.errors, ['legacy_form_not_allowlisted'], `v${outer}`);
    assert.equal(res.verdict.exit_code, 1);
    assert.equal(res.verdict.checks.shape, 'fail');
    assert.equal(res.verdict.reason, 'legacy_form_not_allowlisted');
  }
  const detached = await verifyReceipt({ task_id: 'task-detached', payment: l1Claims.payment, issuer_signature: { alg: 'ES256', kid: kp.kid, value: 'A'.repeat(86) } }, trust);
  assert.deepEqual(detached.errors, ['legacy_form_not_allowlisted']);
  assert.equal(detached.verdict.exit_code, 1);
});

test('L1: a listed receipt still needs a valid signature (the list never replaces it)', async () => {
  const jws = compact({ alg: 'ES256', typ: 'chit402-receipt+jwt', kid: kp.kid }, l1Claims);
  const listed = l1Receipt(4, jws);
  const fp = legacyReceiptFingerprint(listed);
  const list = parseLegacyAllowlistForTest(JSON.stringify({ schema: 'chit402.legacy_allowlist.v1', status: 'final', note: '', entries: [fp] }), { unpinnedForTest: true });
  const opts = { ...trust, [TEST_SNAPSHOT]: { legacyAllowlist: list } };
  const good = await verifyReceipt(listed, opts);
  assert.equal(good.issuer_signature.valid, true, good.errors.join('; '));
  // Same payload and signature under an alg:none header: same fingerprint
  // (the header is not fingerprinted), so it passes the list, and the
  // signature check refuses it.
  const [, payloadPart, sigPart] = jws.split('.');
  const noneJws = `${b64({ alg: 'none', typ: 'chit402-receipt+jwt', kid: kp.kid })}.${payloadPart}.${sigPart}`;
  const none = l1Receipt(4, noneJws);
  assert.deepEqual(legacyReceiptFingerprint(none), fp);
  const refused = await verifyReceipt(none, opts);
  assert.equal(refused.issuer_signature.valid, false);
  assert.equal(refused.overall, 'failed');
  assert.notDeepEqual(refused.errors, ['legacy_form_not_allowlisted']);
  // Signed by another key: same payload, other signature, not listed.
  const secondKey = keyPair();
  const other = await verifyReceipt(l1Receipt(4, compact({ alg: 'ES256', typ: 'chit402-receipt+jwt', kid: kp.kid }, l1Claims, secondKey)), opts);
  assert.deepEqual(other.errors, ['legacy_form_not_allowlisted']);
});

// ---------- L5 ----------

function signHead(claims, key) {
  const header = { alg: 'ES256', typ: 'chit402-tree-head+jwt', kid: key.kid };
  return { ...claims, issuer_signature: { alg: 'ES256', kid: key.kid, jws: compact(header, claims, key), issuer_jwk: key.jwk } };
}
const rootFor = (n) => createHash('sha256').update(`root-${n}`).digest('hex');
function head(size, key = kp) {
  return signHead({
    schema: 'chit402.tree_head.v2', payload_version: 2, epoch: 2, root: rootFor(size), tree_size: size,
    published_at: '2026-10-21T00:00:00.000Z', anchors: { solana: { signature: `sig-${size}` } },
  }, key);
}
function solanaTx(root, blockTime, err = null) {
  return {
    blockTime,
    meta: { err },
    transaction: { message: { instructions: [{ program: 'spl-memo', parsed: `chit402:root:v1:scope:2026-10-21:${root}:${'0'.repeat(64)}` }] } },
  };
}
function logInput({ heads, times, leafIndex = 34, verifiedSize = 37 }) {
  const calls = [];
  return {
    calls,
    input: {
      origin: 'http://127.0.0.1:1',
      leafIndex,
      verifiedHead: head(verifiedSize),
      history: null,
      trustedKids: [kp.kid],
      solanaRpcUrls: ['http://127.0.0.1:2'],
      getJson: async (url) => {
        calls.push(url);
        const size = Number(new URL(url).searchParams.get('tree_size'));
        return heads[size] ?? { error: 'no_signed_head' };
      },
      fetchSolanaTx: async (signature) => {
        const size = Number(signature.slice(4));
        return times[size] === undefined ? null : solanaTx(times[size].root ?? rootFor(size), times[size].t, times[size].err ?? null);
      },
    },
  };
}

test('L5 log time: the earliest anchored signed head that covers the leaf', async () => {
  const t36 = Date.parse('2026-10-06T00:00:00Z') / 1000;
  const t37 = Date.parse('2026-10-21T00:00:00Z') / 1000;
  const { input, calls } = logInput({ heads: { 36: head(36) }, times: { 36: { t: t36 }, 37: { t: t37 } } });
  assert.deepEqual(await earliestLogTime(input), { ok: true, ms: t36 * 1000, tree_size: 36, source: 'earliest_probe' });
  assert.deepEqual(calls.map((u) => new URL(u).searchParams.get('tree_size')), ['35', '36']);
});

test('L5 log time: unsigned, foreign-key, wrong-root or failed heads are skipped; the verified head is the fallback', async () => {
  const t37 = Date.parse('2026-10-21T00:00:00Z') / 1000;
  const secondKey = keyPair();
  const unsigned = { ...head(35) };
  delete unsigned.issuer_signature;
  const { input } = logInput({ heads: { 35: unsigned, 36: head(36, secondKey) }, times: { 35: { t: 1 }, 36: { t: 1 }, 37: { t: t37 } } });
  assert.deepEqual(await earliestLogTime(input), { ok: true, ms: t37 * 1000, tree_size: 37, source: 'verified_head' });
  const wrongRoot = logInput({ heads: { 35: head(35) }, times: { 35: { t: 1, root: 'ab'.repeat(32) }, 37: { t: t37 } } });
  assert.equal((await earliestLogTime(wrongRoot.input)).source, 'verified_head');
  const failedTx = logInput({ heads: { 35: head(35) }, times: { 35: { t: 1, err: { InstructionError: [0, 'x'] } }, 37: { t: t37 } } });
  assert.equal((await earliestLogTime(failedTx.input)).source, 'verified_head');
  const none = logInput({ heads: {}, times: {} });
  assert.deepEqual(await earliestLogTime(none.input), { ok: false, reason: 'log_time_unavailable' });
});

// KNOWN LIMIT of 0.5.0-pre, EXPECTED TO CHANGE before 0.5.0 final: the probe
// does not fetch an inclusion proof for the leaf at tree_size=k and does not
// require the probed head to be in the verified head's epoch. A trusted signed
// head for an unrelated log (other root, epoch 1) that was anchored early can
// therefore set the log time. When the inclusion proof and same-epoch rule
// land, flip the expectation below to 'log_time_after_window'.
test('known limit (expected to change before 0.5.0): an unrelated epoch-1 head anchored early sets the log time', async () => {
  const pv9Close = Date.parse('2026-10-08T08:49:28Z') / 1000;
  const late = pv9Close + 14 * 86400 + 3600;
  const unrelatedRoot = 'cd'.repeat(32);
  const unrelated = signHead({
    schema: 'chit402.tree_head.v2', payload_version: 2, epoch: 1, root: unrelatedRoot, tree_size: 35,
    published_at: '2026-10-01T00:00:00.000Z', anchors: { solana: { signature: 'sig-35' } },
  }, kp);
  const windows = loadBundledVersionWindows();
  const baseline = logInput({ heads: {}, times: { 37: { t: late } } });
  assert.equal(await logTimeReason({ ...baseline.input, claims: { payload_version: 9 }, windows }), 'log_time_after_window');
  const { input } = logInput({ heads: { 35: unrelated }, times: { 35: { t: Date.parse('2026-10-01T00:00:00Z') / 1000, root: unrelatedRoot }, 37: { t: late } } });
  const r = await logTimeReason({ ...input, claims: { payload_version: 9 }, windows });
  assert.equal(r, null, 'known limit: expected to become log_time_after_window once inclusion at tree_size=k and same epoch are required');
});

test('L5 decision: open versions are not probed; closed versions need a log time inside close + grace', async () => {
  const windows = loadBundledVersionWindows();
  const pv9Close = Date.parse('2026-10-08T08:49:28Z') / 1000;
  const grace = 14 * 86400;
  const run = async (pv, t, extra = {}) => {
    const { input, calls } = logInput({ heads: {}, times: t == null ? {} : { 37: { t } } });
    const r = await logTimeReason({ ...input, ...extra, claims: { payload_version: pv }, windows });
    return { r, calls };
  };
  const open = await run(10, null);
  assert.equal(open.r, null);
  assert.equal(open.calls.length, 0, 'open window: no probe');
  assert.equal((await run(9, pv9Close + grace)).r, null, 'inside the grace');
  assert.equal((await run(9, pv9Close + grace + 1)).r, 'log_time_after_window');
  assert.equal((await run(9, null)).r, 'log_time_unavailable');
  assert.equal((await run(9, pv9Close, { leafIndex: null })).r, 'log_time_unavailable');
  assert.equal(checkLogTime(windows.windows.get('pv10'), Date.parse('2030-01-01T00:00:00Z'), windows), true);
});

test('L5 reasons map to the verdict: after-window is exit 1, unavailable is exit 2', () => {
  const base = { version: 'test', signatureChecked: true, signatureValid: true, payerRequired: false, logInclusion: 'pass', anchor: 'pass', historyChecked: true, historyOk: false };
  const after = buildVerifyVerdict({ ...base, historyReason: 'log_time_after_window' });
  assert.equal(after.exit_code, 1);
  assert.equal(after.checks.key_window, 'fail');
  assert.equal(after.reason, 'log_time_after_window');
  const unavailable = buildVerifyVerdict({ ...base, historyReason: 'log_time_unavailable', historyUnreachable: true });
  assert.equal(unavailable.exit_code, 2);
  assert.equal(unavailable.reason, 'log_time_unavailable');
});

// ---------- test seam ----------

test('the test seam is not public API', () => {
  assert.equal(Object.values(index).includes(TEST_SNAPSHOT), false);
  assert.deepEqual(Object.getOwnPropertySymbols(index).filter((sym) => sym !== Symbol.toStringTag), []);
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  assert.equal(Object.keys(pkg.exports).some((k) => k.includes('internal')), false);
  assert.doesNotMatch(readFileSync(join(pkgDir, 'dist', 'index.d.ts'), 'utf8'), /test-seam|TEST_SNAPSHOT/);
  assert.doesNotMatch(readFileSync(join(pkgDir, 'dist', 'cli.js'), 'utf8'), /test-seam|TEST_SNAPSHOT/);
  assert.notEqual(TEST_SNAPSHOT, Symbol.for('chit402-verify test snapshot'));
  assert.equal(readTestSnapshot({ [Symbol.for('chit402-verify test snapshot')]: { versionWindows: {} } }), null);
});

test('the test seam swaps the windows for one call', async () => {
  const late = signedReceipt({ task_id: 'xfuel-00000000-0000-4000-8000-0000000000c4', payload_version: 7, iat: Date.parse('2026-10-20T00:00:00Z') / 1000, payment });
  const body = bundledBody();
  body.windows = body.windows.map((w) => (w.id === 'pv7' ? { ...w, not_after: null } : w));
  const windows = parseVersionWindows(JSON.stringify(body), { expectedSha256: null });
  const swapped = await verifyReceipt(late, { ...trust, [TEST_SNAPSHOT]: { versionWindows: windows } });
  assert.equal(swapped.errors.some((e) => /version_window/.test(e)), false, swapped.errors.join('; '));
  const normal = await verifyReceipt(late, { ...trust, [TEST_SNAPSHOT]: { versionWindows: loadBundledVersionWindows() } });
  assert.equal(normal.issuer_history.reason, 'version_window_closed');
});

test('the test seam replaces the bundled issuer history in the CLI resolver', async () => {
  const { resolveIssuerHistory, loadBundledIssuerHistory } = await import('../dist/issuer-history.js');
  const { writeCoveringHistory } = await import('./history-file.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'vw-seam-'));
  const historyPath = await writeCoveringHistory(dir, { privateKey: kp.privateKey, kid: kp.kid, publicJwk: kp.jwk }, '2026-09-01T00:00:00.000Z');
  const bytes = readFileSync(historyPath, 'utf8');
  const document = JSON.parse(bytes);
  const plain = await resolveIssuerHistory({});
  assert.equal(plain.source, 'bundled');
  assert.equal(plain.headHash, loadBundledIssuerHistory().document.head_hash);
  const seamed = await resolveIssuerHistory({ trustedKids: [kp.kid], bundledOverride: { document, bytes } });
  assert.equal(seamed.source, 'bundled');
  assert.equal(seamed.headHash, document.head_hash);
});
