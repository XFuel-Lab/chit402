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
import { syntheticIssuerKey } from './fixtures/slot-typing/synthetic-key.mjs';
import { assertLibraryPass } from './library-pass.mjs';

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

const payment = { rail: 'usdc', ref: 'base:0x' + '12'.repeat(32), gross_amount: 2000, settled_amount: 2000 };
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
  // Inside the v7 validity window (version-windows.json).
  iat: 1789862400,
  payment,
};

test('control: a bound receipt-typ payload verifies under a trusted key', async () => {
  const res = await verifyReceipt(receiptWith(goodClaims), { jwks: localJwks, trustedKids: [kid], fetchImpl: offline });
  assert.equal(res.issuer_signature.valid, true);
  assertLibraryPass(res, res.errors.join('; '));
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

for (const typ of ['chit402-tree-head+jwt', 'chit402-tree-epoch+jwt', 'chit402-issuer-history+jwt', 'chit402-refusal+jwt', 'chit402-anchor-wallets+jwt', 'chit402-freeze+jwt', 'chit402-x402-offer+jwt', 'chit402-x402-receipt+jwt', 'something-else']) {
  test(`receipt slot refuses typ ${typ}`, async () => {
    const res = await verifyReceipt(receiptWith(goodClaims, typ), { jwks: localJwks, trustedKids: [kid], fetchImpl: offline });
    assert.equal(res.overall, 'failed');
    assert.equal(res.issuer_signature.reason, 'typ_mismatch');
  });
}

test('legacy receipt typ JWT is still accepted when bound', async () => {
  const res = await verifyReceipt(receiptWith(goodClaims, 'JWT'), { jwks: localJwks, trustedKids: [kid], fetchImpl: offline });
  assertLibraryPass(res, res.errors.join('; '));
});

test('an untyped JWS is refused in the receipt slot (no issued receipt lacks a typ)', async () => {
  const res = await verifyReceipt(receiptWithHeader(goodClaims, {}), localOpts);
  assert.equal(res.overall, 'failed');
  assert.equal(res.issuer_signature.reason, 'typ_mismatch');
});

test('each non-receipt slot accepts only its own typ', () => {
  const key = localJwks.keys[0];
  const slots = {
    treeHead: 'chit402-tree-head+jwt',
    treeEpoch: 'chit402-tree-epoch+jwt',
    issuerHistory: 'chit402-issuer-history+jwt',
    refusal: 'chit402-refusal+jwt',
    freeze: 'chit402-freeze+jwt',
    anchorWallets: 'chit402-anchor-wallets+jwt',
    x402Offer: 'chit402-x402-offer+jwt',
    x402Receipt: 'chit402-x402-receipt+jwt',
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
// 0.4.11: `overall` comes from the shared verdict, so a library pass that
// did not fetch the log is `partial` (verdict exit 2), not `verified`.
const PREVIOUS = {
  'slot-typing/v5-xfuel-c5a3860d.json': ['partial', 'partial', 'failed'],
  'public/chit-1ebc5616.json': ['partial', 'partial', 'partial'],
  'chit-5d775d12.v7.json': ['partial', 'partial', 'partial'],
  'chit-4d6e8331.json': ['partial', 'partial', 'partial'],
  'public/chit-39af100b.json': ['partial', 'partial', 'partial'],
  // 0.4.11: an unreachable pinned history (offline here) is could not check.
  'public/foreign-x402-muy1hh8y.json': ['partial', 'partial', 'partial'],
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

// A payload v10 receipt with the shape of an issued one (owner view, pinned
// v1 issuer history, signed coverage and book-seq), signed by a synthetic test
// key with its own v1 history. Same verdicts as an issued v10 receipt:
// [jwks only, jwks + issuer history v1, no jwks].
const synKey = syntheticIssuerKey();
const synJwks = { keys: [synKey.publicJwk] };
const synHistory = load('slot-typing/v10-synthetic-issuer-history-v1.json');

test('synthetic v10 receipt keeps the issued v10 verdicts', async () => {
  const r = unwrap(load('slot-typing/v10-synthetic.json'));
  const h = header(r.issuer_signature.jws);
  assert.equal(h.typ, 'chit402-receipt+jwt');
  assert.equal(h.kid, synKey.kid);
  const opts = { jwks: synJwks, trustedKids: [synKey.kid], fetchImpl: offline };
  const got = [
    (await verifyReceipt(structuredClone(r), opts)).overall,
    (await verifyReceipt(structuredClone(r), { ...opts, issuerHistory: synHistory })).overall,
    (await verifyReceipt(structuredClone(r), { fetchImpl: offline })).overall,
  ];
  // 0.4.11: jwks only, the pinned history is unreachable offline: could not check.
  assert.deepEqual(got, ['partial', 'partial', 'failed']);
  // The production key does not verify it.
  assert.equal((await verifyReceipt(structuredClone(r), { jwks, fetchImpl: offline, issuerHistory: synHistory })).overall, 'failed');
});

// --- header and payload edge cases (0.4.8 review follow-up).
function signWithHeader(claims, extra) {
  const h = { alg: 'ES256', kid, ...extra };
  for (const key of Object.keys(h)) if (h[key] === undefined) delete h[key];
  const input = `${Buffer.from(JSON.stringify(h)).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  const sig = sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${input}.${sig.toString('base64url')}`;
}
function receiptWithHeader(claims, extra, outer = {}) {
  return {
    task_id: goodClaims.task_id,
    payment,
    ...outer,
    issuer_signature: { alg: 'ES256', payload_version: 7, kid, jws: signWithHeader(claims, extra) },
  };
}
const localOpts = { jwks: localJwks, trustedKids: [kid], fetchImpl: offline };
const treeHeadClaims = { schema: 'chit402.tree_head.v2', payload_version: 2, tree_size: 3, root: 'a'.repeat(64) };

for (const typ of ['CHIT402-RECEIPT+JWT', 'Chit402-Receipt+Jwt', 'jwt', ' chit402-receipt+jwt', 'chit402-receipt+jwt ', 'chit402-receipt+jwt\n', '']) {
  test(`receipt slot refuses typ variant ${JSON.stringify(typ)}`, async () => {
    const res = await verifyReceipt(receiptWithHeader(goodClaims, { typ }), localOpts);
    assert.equal(res.overall, 'failed');
    assert.equal(res.issuer_signature.reason, 'typ_mismatch');
  });
}

for (const typ of [['chit402-receipt+jwt'], { v: 'chit402-receipt+jwt' }, 1, true]) {
  test(`receipt slot refuses non-string typ ${JSON.stringify(typ)}`, async () => {
    const res = await verifyReceipt(receiptWithHeader(goodClaims, { typ }), localOpts);
    assert.equal(res.overall, 'failed');
    assert.equal(res.issuer_signature.reason, 'typ_mismatch');
  });
}

test('typ moved to cty: a tree-head payload with no typ is not a receipt', async () => {
  const res = await verifyReceipt(
    receiptWithHeader({ ...treeHeadClaims, task_id: goodClaims.task_id, payment }, { cty: 'chit402-tree-head+jwt' }),
    localOpts,
  );
  assert.equal(res.overall, 'failed');
});

test('crit/b64 headers are refused in a typed slot', async () => {
  for (const extra of [
    { typ: 'chit402-receipt+jwt', crit: ['b64'], b64: false },
    { typ: 'chit402-receipt+jwt', crit: ['b64'] },
    { typ: 'chit402-receipt+jwt', b64: true },
    { crit: ['exp'] },
  ]) {
    const res = await verifyReceipt(receiptWithHeader(goodClaims, extra), localOpts);
    assert.equal(res.overall, 'failed', JSON.stringify(extra));
    assert.equal(res.issuer_signature.valid, false);
    const direct = verifyIssuerJws(signWithHeader(goodClaims, extra), localJwks.keys[0], { expectTyp: ISSUER_JWS_TYP.receipt });
    assert.equal(direct.valid, false);
    assert.ok(['unsupported_header', 'typ_mismatch'].includes(direct.reason), direct.reason);
  }
});

test('signed payment {} does not verify against an outer payment', async () => {
  const res = await verifyReceipt(receiptWith({ ...goodClaims, payment: {} }), localOpts);
  assert.equal(res.overall, 'failed');
  assert.ok(res.errors.some((e) => /payment\.\w+ is not covered/.test(e)), res.errors.join('; '));
});

test('an outer economic payment field must be signed', async () => {
  const outerPayment = { ...payment, payee: '0x' + '1'.repeat(40) };
  const res = await verifyReceipt(receiptWith(goodClaims, 'chit402-receipt+jwt', { payment: outerPayment }), localOpts);
  assert.equal(res.overall, 'failed');
  assert.ok(res.errors.some((e) => /payment\.payee is not covered/.test(e)), res.errors.join('; '));
});

test('signed payment fields compare canonically (key order does not matter, values do)', async () => {
  const p = { rail: 'usdc', ref: 'base:0x' + 'ab'.repeat(32), gross_amount: 2000, accounting: { a: 1, b: [1, 2] } };
  const signedSameDifferentOrder = { accounting: { b: [1, 2], a: 1 }, gross_amount: 2000, ref: p.ref, rail: 'usdc' };
  const ok = await verifyReceipt(
    receiptWith({ ...goodClaims, payment: signedSameDifferentOrder }, 'chit402-receipt+jwt', { payment: p }),
    localOpts,
  );
  assertLibraryPass(ok, ok.errors.join('; '));
  const bad = await verifyReceipt(
    receiptWith({ ...goodClaims, payment: { ...signedSameDifferentOrder, accounting: { a: 1, b: [2, 1] } } }, 'chit402-receipt+jwt', { payment: p }),
    localOpts,
  );
  assert.equal(bad.overall, 'failed');
});

test('display-only outer payment fields that were never signed keep verifying', async () => {
  const p = { ...payment, ref: 'base:0x' + 'cd'.repeat(32), network: 'base', explorer_url: 'https://basescan.org/tx/0x' + 'cd'.repeat(32), collected: true };
  const signedPayment = { rail: p.rail, ref: p.ref, gross_amount: p.gross_amount, settled_amount: p.settled_amount, network: p.network };
  const res = await verifyReceipt(receiptWith({ ...goodClaims, payment: signedPayment }, 'chit402-receipt+jwt', { payment: p }), localOpts);
  assertLibraryPass(res, res.errors.join('; '));
});

// Untyped x402 offer / receipt-extension payloads signed by the issuer key.
const offerClaims = {
  version: 1,
  resourceUrl: 'https://api.chit402.com/v1/chat',
  scheme: 'exact',
  network: 'eip155:8453',
  asset: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  payTo: '0x23f713411c30bbd9a989c9cbc22eb0b55f7f7334',
  amount: '2000',
  validUntil: 1792281677,
};
const x402ReceiptClaims = {
  version: 1,
  network: 'eip155:8453',
  resourceUrl: 'https://api.chit402.com/v1/chat',
  payer: '0x9f8951cb8b060f52fdf87297b3c5b00f7aa18f52',
  issuedAt: 1792281677,
  transaction: '0x' + 'ef'.repeat(32),
};
for (const [name, claims] of [
  ['offer payload', offerClaims],
  ['offer payload with payload_version', { ...offerClaims, payload_version: 6 }],
  ['x402 receipt-extension payload', x402ReceiptClaims],
  ['x402 receipt-extension payload with payload_version and task_id', { ...x402ReceiptClaims, payload_version: 6, task_id: goodClaims.task_id }],
]) {
  for (const typ of [undefined, 'JWT']) {
    test(`${name} (typ ${typ ?? 'none'}) is never a verified receipt`, async () => {
      const res = await verifyReceipt(receiptWithHeader(claims, { typ }), localOpts);
      assert.equal(res.overall, 'failed');
      const up = await verifyReceiptUpToV10(receiptWithHeader(claims, { typ }), localOpts);
      assert.notEqual(up.overall, 'verified');
    });
  }
}

test('CLI reports typ_mismatch for a non-receipt JWS in the receipt slot', () => {
  for (const name of ['head-jws-receipt.json', 'head-jws-receipt-schema.json', 'head-jws-receipt-pinned.json']) {
    const json = runCli([fixture(`slot-typing/${name}`), '--json']);
    assert.equal(json.status, 1, json.stdout + json.stderr);
    const out = JSON.parse(json.stdout);
    assert.equal(out.result, 'invalid');
    assert.equal(out.reason, 'typ_mismatch', name);
    const human = runCli([fixture(`slot-typing/${name}`)]);
    assert.equal(human.status, 1);
    assert.doesNotMatch(human.stdout, /key that is not the issuer/);
  }
});


// --- signed party binding and reason pass-through.
const PAYEE = '0x23f713411c30bbd9a989c9cbc22eb0b55f7f7334';
const PAYER = '0x9f8951cb8b060f52fdf87297b3c5b00f7aa18f52';
function foreignLike(outerExtra, signedExtra = {}) {
  const signedPayment = { ...payment, payee: PAYEE };
  const claims = { ...goodClaims, payment: signedPayment, payee: PAYEE, payer: PAYER, ...signedExtra };
  return receiptWith(claims, 'chit402-receipt+jwt', { payment: { ...payment, payee: PAYEE, ...outerExtra } });
}

test('outer payTo and payer matching the signed payee and payer (any case) verify', async () => {
  const res = await verifyReceipt(foreignLike({ payTo: PAYEE.toUpperCase().replace('0X', '0x'), payer: PAYER.toUpperCase().replace('0X', '0x') }), localOpts);
  assertLibraryPass(res, res.errors.join('; '));
});

test('an outer payTo that differs from the signed payee fails', async () => {
  const res = await verifyReceipt(foreignLike({ payTo: '0x' + '1'.repeat(40) }), localOpts);
  assert.equal(res.overall, 'failed');
  assert.ok(res.errors.some((e) => /payment\.payTo does not match/.test(e)), res.errors.join('; '));
});

test('an outer payer that differs from the signed payer fails', async () => {
  const res = await verifyReceipt(foreignLike({ payer: '0x' + '2'.repeat(40) }), localOpts);
  assert.equal(res.overall, 'failed');
  assert.ok(res.errors.some((e) => /payment\.payer does not match/.test(e)), res.errors.join('; '));
});

test('an outer payer with no signed payer fails', async () => {
  const res = await verifyReceipt(foreignLike({ payer: PAYER }, { payer: undefined }), localOpts);
  assert.equal(res.overall, 'failed');
  assert.ok(res.errors.some((e) => /payment\.payer is not covered/.test(e)), res.errors.join('; '));
});

test('a non-typ header refusal is reported with its own reason', async () => {
  const res = await verifyReceipt(receiptWithHeader(goodClaims, { typ: 'chit402-receipt+jwt', crit: ['b64'], b64: false }), localOpts);
  assert.equal(res.overall, 'failed');
  assert.equal(res.issuer_signature.reason, 'unsupported_header');
  assert.ok(res.errors.some((e) => /unsupported_header/.test(e)), res.errors.join('; '));
});

test('public attestation parser refuses crit and b64 headers (exact header keys)', async () => {
  const { parsePublicAttestation } = await import('../dist/index.js');
  const kid43 = 'A'.repeat(43);
  for (const extra of [{ crit: ['b64'], b64: false }, { b64: true }, { crit: [] }]) {
    const h = { alg: 'ES256', typ: 'chit402-public-receipt+jwt', kid: kid43, ...extra };
    const jws = `${Buffer.from(JSON.stringify(h)).toString('base64url')}.${Buffer.from('chit402.public_receipt.v1\n{}').toString('base64url')}.${'A'.repeat(86)}`;
    const parsed = parsePublicAttestation(jws);
    assert.equal(parsed.ok, false, JSON.stringify(extra));
  }
});

test('payTo/payer compare exactly except 0x-hex EVM addresses', async () => {
  const SOL = '8ef3GtYNuQ6P2ANxLMPUXTAo9BhfJKwq3dZcRk1mVpA2';
  const flip = (s, i) => s.slice(0, i) + (s[i] === s[i].toLowerCase() ? s[i].toUpperCase() : s[i].toLowerCase()) + s.slice(i + 1);
  const cases = [
    ['solana payTo case flip', { payTo: flip(SOL, 1) }, { payee: SOL, payment: { ...payment, payee: SOL } }, 'failed'],
    ['solana payer case flip', { payer: flip(SOL, 5) }, { payer: SOL }, 'failed'],
    ['solana exact', { payTo: SOL, payer: PAYER }, { payee: SOL, payment: { ...payment, payee: SOL } }, 'partial'],
    ['kelvin sign K', { payTo: SOL.replace('K', '\u212A') }, { payee: SOL, payment: { ...payment, payee: SOL } }, 'failed'],
    ['0X prefix', { payTo: '0X' + PAYEE.slice(2) }, {}, 'failed'],
    ['non-address case', { payer: 'Alice-Wallet' }, { payer: 'alice-wallet' }, 'failed'],
    ['evm mixed case', { payTo: '0x' + PAYEE.slice(2).toUpperCase() }, {}, 'partial'],
  ];
  for (const [name, outer, signed, want] of cases) {
    const claims = { ...goodClaims, payment: { ...payment, payee: PAYEE }, payee: PAYEE, payer: PAYER, ...signed };
    const r = receiptWith(claims, 'chit402-receipt+jwt', { payment: { ...payment, payee: claims.payment.payee, ...outer } });
    const res = await verifyReceipt(r, localOpts);
    assert.equal(res.overall, want, `${name}: ${res.errors.join('; ')}`);
  }
});
