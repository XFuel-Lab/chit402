// Issuer JWS slot typing (0.4.8).
//
// Every issuer document (receipt, tree head, epoch, history, refusal, ...)
// is signed by the same key. A JWS counts only in the slot for its own `typ`,
// and verifyReceipt reports `verified` only when the signed payload names
// this receipt's task_id and covers its payment block.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  verifyReceipt,
  verifyReceiptUpToV10,
  verifyIssuerJws,
  verifyIssuerSignatureWithJwks,
  ISSUER_JWS_TYP,
} from '../dist/index.js';

const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const load = (name) => JSON.parse(readFileSync(fixture(name), 'utf8'));
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const jwksPreload = new URL('./jwks-fetch-preload.mjs', import.meta.url).href;

const jwks = load('chit402-jwks.json');
const history = load('public/issuer-history-v1.json');
const offline = async () => new Response('not found', { status: 404 });
const unwrap = (doc) => (doc.receipt && doc.receipt.issuer_signature ? doc.receipt : doc);

// A real production tree-head JWS placed in a receipt's issuer_signature.
const headInReceipt = load('slot-typing/head-jws-receipt.json');
const headInReceiptSchema = load('slot-typing/head-jws-receipt-schema.json');
const headInReceiptPinned = load('slot-typing/head-jws-receipt-pinned.json');

function header(jws) {
  return JSON.parse(Buffer.from(jws.split('.')[0], 'base64url').toString('utf8'));
}

test('the tree-head JWS really is a production-key head (fixture sanity)', () => {
  const h = header(headInReceipt.issuer_signature.jws);
  assert.equal(h.typ, 'chit402-tree-head+jwt');
  assert.equal(h.kid, jwks.keys[0].kid);
  // Without a slot the bytes verify: the key is the issuer key.
  assert.equal(verifyIssuerJws(headInReceipt.issuer_signature.jws, jwks.keys[0]).valid, true);
});

test('receipt slot refuses a tree-head typ', () => {
  const res = verifyIssuerJws(headInReceipt.issuer_signature.jws, jwks.keys[0], { expectTyp: ISSUER_JWS_TYP.receipt });
  assert.equal(res.valid, false);
  assert.equal(res.reason, 'typ_mismatch');
  const sig = verifyIssuerSignatureWithJwks(structuredClone(headInReceipt), jwks);
  assert.equal(sig.valid, false);
  assert.equal(sig.reason, 'typ_mismatch');
});

for (const [name, doc] of [
  ['head JWS', headInReceipt],
  ['head JWS with receipt-looking outer schema', headInReceiptSchema],
  ['head JWS with pinned issuer_jwk', headInReceiptPinned],
]) {
  test(`library: ${name} in a receipt is failed`, async () => {
    for (const fn of [verifyReceipt, verifyReceiptUpToV10]) {
      const res = await fn(structuredClone(doc), { jwks, fetchImpl: offline });
      assert.equal(res.overall, 'failed');
      assert.equal(res.issuer_signature.valid, false);
    }
    const pinnedOnly = await verifyReceipt(structuredClone(doc), { fetchImpl: offline });
    assert.notEqual(pinnedOnly.overall, 'verified');
  });
}

function runCli(args) {
  return spawnSync(process.execPath, ['--import', jwksPreload, cli, ...args], {
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env,
      CHIT_TEST_JWKS: JSON.stringify(jwks),
      CHIT_TEST_JWKS_URL: 'https://api.chit402.com/.well-known/jwks.json',
    },
  });
}

for (const name of ['head-jws-receipt.json', 'head-jws-receipt-schema.json', 'head-jws-receipt-pinned.json']) {
  test(`CLI: slot-typing/${name} is INVALID, exit 1`, () => {
    const human = runCli([fixture(`slot-typing/${name}`)]);
    assert.equal(human.status, 1, human.stdout + human.stderr);
    assert.match(human.stdout + human.stderr, /INVALID/);
    const json = runCli([fixture(`slot-typing/${name}`), '--json']);
    assert.equal(json.status, 1, json.stdout + json.stderr);
    const out = JSON.parse(json.stdout);
    assert.equal(out.result, 'invalid');
    assert.notEqual(out.overall, 'verified');
  });
}

// --- same-typ cases with a local key: the signature is genuine and the key
// is trusted, but the payload is not this receipt.
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pub = publicKey.export({ format: 'jwk' });
const kid = createHash('sha256')
  .update(JSON.stringify({ crv: pub.crv, kty: pub.kty, x: pub.x, y: pub.y }))
  .digest('base64url');
const localJwks = { keys: [{ ...pub, kid, alg: 'ES256', use: 'sig' }] };

function signCompact(claims, typ) {
  const h = { alg: 'ES256', kid };
  if (typ !== undefined) h.typ = typ;
  const input = `${Buffer.from(JSON.stringify(h)).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  const sig = sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${input}.${sig.toString('base64url')}`;
}

const payment = { rail: 'usdc', network: 'base', gross_amount: 2000, settled_amount: 2000 };
function receiptWith(claims, typ = 'chit402-receipt+jwt', outer = {}) {
  return {
    task_id: 'xfuel-00000000-0000-4000-8000-0000000000aa',
    payment,
    ...outer,
    issuer_signature: { alg: 'ES256', payload_version: 7, kid, jws: signCompact(claims, typ) },
  };
}
const goodClaims = {
  task_id: 'xfuel-00000000-0000-4000-8000-0000000000aa',
  payload_version: 7,
  payment,
};

test('control: a bound receipt-typ payload verifies under a trusted key', async () => {
  const res = await verifyReceipt(receiptWith(goodClaims), { jwks: localJwks, trustedKids: [kid], fetchImpl: offline });
  assert.equal(res.issuer_signature.valid, true);
  assert.equal(res.overall, 'verified', res.errors.join('; '));
});

test('signed task_id must match the receipt', async () => {
  const res = await verifyReceipt(
    receiptWith({ ...goodClaims, task_id: 'xfuel-00000000-0000-4000-8000-0000000000bb' }),
    { jwks: localJwks, trustedKids: [kid], fetchImpl: offline },
  );
  assert.equal(res.overall, 'failed');
  assert.ok(res.errors.some((e) => /task_id/.test(e)), res.errors.join('; '));
});

test('a signed payload with no task_id is not verified', async () => {
  const { task_id: _drop, ...rest } = goodClaims;
  const res = await verifyReceipt(receiptWith(rest), { jwks: localJwks, trustedKids: [kid], fetchImpl: offline });
  assert.equal(res.overall, 'failed');
});

test('outer payment must be covered by the signature', async () => {
  const { payment: _drop, ...rest } = goodClaims;
  const res = await verifyReceipt(receiptWith(rest), { jwks: localJwks, trustedKids: [kid], fetchImpl: offline });
  assert.equal(res.overall, 'failed');
  assert.ok(res.errors.some((e) => /payment is not covered/.test(e)), res.errors.join('; '));
});

for (const schema of ['chit402.tree_head.v2', 'chit402.tree_epoch.v1', 'chit402.issuer_history.v1']) {
  test(`signed ${schema} payload is never a verified receipt, even with a receipt typ`, async () => {
    const res = await verifyReceipt(receiptWith({ ...goodClaims, schema }), { jwks: localJwks, trustedKids: [kid], fetchImpl: offline });
    assert.equal(res.overall, 'failed');
  });
}

for (const typ of ['chit402-tree-head+jwt', 'chit402-tree-epoch+jwt', 'chit402-issuer-history+jwt', 'chit402-refusal+jwt', 'chit402-anchor-wallets+jwt', 'chit402-freeze+jwt', 'something-else']) {
  test(`receipt slot refuses typ ${typ}`, async () => {
    const res = await verifyReceipt(receiptWith(goodClaims, typ), { jwks: localJwks, trustedKids: [kid], fetchImpl: offline });
    assert.equal(res.overall, 'failed');
    assert.equal(res.issuer_signature.reason, 'typ_mismatch');
  });
}

for (const typ of ['JWT', undefined]) {
  test(`legacy receipt typ ${typ ?? '(none)'} is still accepted when bound`, async () => {
    const res = await verifyReceipt(receiptWith(goodClaims, typ), { jwks: localJwks, trustedKids: [kid], fetchImpl: offline });
    assert.equal(res.overall, 'verified', res.errors.join('; '));
  });
}

test('each non-receipt slot accepts only its own typ', () => {
  const key = localJwks.keys[0];
  const slots = {
    treeHead: 'chit402-tree-head+jwt',
    treeEpoch: 'chit402-tree-epoch+jwt',
    issuerHistory: 'chit402-issuer-history+jwt',
    refusal: 'chit402-refusal+jwt',
    freeze: 'chit402-freeze+jwt',
    anchorWallets: 'chit402-anchor-wallets+jwt',
  };
  for (const [slot, own] of Object.entries(slots)) {
    assert.equal(verifyIssuerJws(signCompact({ a: 1 }, own), key, { expectTyp: ISSUER_JWS_TYP[slot] }).valid, true, slot);
    for (const other of ['chit402-receipt+jwt', 'JWT', undefined, ...Object.values(slots).filter((t) => t !== own)]) {
      const res = verifyIssuerJws(signCompact({ a: 1 }, other), key, { expectTyp: ISSUER_JWS_TYP[slot] });
      assert.equal(res.valid, false, `${slot} accepted ${other}`);
      assert.equal(res.reason, 'typ_mismatch');
    }
  }
  // The public attestation typ is refused everywhere, with or without a slot.
  assert.equal(verifyIssuerJws(signCompact({ a: 1 }, 'chit402-public-receipt+jwt'), key).reason, 'typ_mismatch');
});

// --- real issued receipts keep their pre-0.4.8 verdicts.
// [jwks only, jwks + issuer history v1, no jwks] as returned by 0.4.7.
const PREVIOUS = {
  'slot-typing/v5-xfuel-c5a3860d.json': ['verified', 'verified', 'failed'],
  'public/chit-1ebc5616.json': ['verified', 'verified', 'verified'],
  'chit-5d775d12.v7.json': ['verified', 'verified', 'verified'],
  'chit-4d6e8331.json': ['verified', 'verified', 'verified'],
  'public/chit-39af100b.json': ['verified', 'verified', 'verified'],
  'slot-typing/v10-xfuel-546baa6c.json': ['failed', 'verified', 'failed'],
  'public/foreign-x402-muy1hh8y.json': ['failed', 'verified', 'failed'],
};

for (const [name, expected] of Object.entries(PREVIOUS)) {
  test(`issued receipt ${name} keeps its previous verdicts`, async () => {
    const r = unwrap(load(name));
    assert.ok(ISSUER_JWS_TYP.receipt.includes(header(r.issuer_signature.jws).typ ?? null));
    const got = [
      (await verifyReceipt(structuredClone(r), { jwks, fetchImpl: offline })).overall,
      (await verifyReceipt(structuredClone(r), { jwks, fetchImpl: offline, issuerHistory: history })).overall,
      (await verifyReceipt(structuredClone(r), { fetchImpl: offline })).overall,
    ];
    assert.deepEqual(got, expected);
  });
}
