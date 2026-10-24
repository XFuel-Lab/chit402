/**
 * EIP-712 fixed tree heads and payer bindings. Vectors were signed by the
 * gateway code under the synthetic test key (fixtures/eip712). Offline: no
 * network, no chain, no production key.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from './tmp-dirs.mjs';
import { syntheticIssuerKey } from './fixtures/slot-typing/synthetic-key.mjs';

const lib = await import('../dist/index.js');
const E = await import('../dist/eip712.js');
const { fixedHeadOutcome, checkReceiptInput } = await import('../dist/check-input.js');
const { buildVerifyVerdict, humanVerdictLines, VERDICT_DOC_ANCHORS } = await import('../dist/verdict.js');

const V = JSON.parse(readFileSync(new URL('./fixtures/eip712/eip712-vectors.json', import.meta.url), 'utf8'));
const GATEWAY_VECTORS = new URL('../../../services/gateway/test/fixtures/escrow-eip712-vectors.json', import.meta.url);
const B1_FILE = new URL('../../../services/gateway/test/fixtures/payer-binding-b1-main.json', import.meta.url);
const B1_SHA256 = '36cd1a58f1c4b0a12dd080a2b54df1ab25c9feefb0d78e52e12ef7060abae139';
const KEY = syntheticIssuerKey();
const JWK = V.key.public_jwk;
const OTHER_REF = `0x${'ab'.repeat(32)}`;

const clone = (v) => JSON.parse(JSON.stringify(v));
const claimsOfJws = (jws) => JSON.parse(Buffer.from(jws.split('.')[1], 'base64url').toString('utf8'));
const B1_CLAIMS = claimsOfJws(V.payer_binding.holder_jws);

function bindingArgs(over = {}) {
  return {
    claims: B1_CLAIMS,
    kid: V.key.kid,
    jwk: JWK,
    rowHash: V.payer_binding.row_hash,
    payerSalt: V.payer_binding.payer_salt,
    ...over,
  };
}

function withPayment(patch) {
  const claims = clone(B1_CLAIMS);
  claims.payment = { ...claims.payment, ...patch };
  return claims;
}

function signTyped(kind, message, key = KEY.privateKey) {
  const { preimage } = E.typedDigest(kind, message, E.EXPECTED_LOG_SALT);
  const raw = sign('sha256', preimage, { key, dsaEncoding: 'ieee-p1363' });
  return { r: `0x${raw.subarray(0, 32).toString('hex')}`, s: `0x${raw.subarray(32).toString('hex')}` };
}

test('constants and domain separators match the gateway and escrow vectors', () => {
  const g = JSON.parse(readFileSync(GATEWAY_VECTORS, 'utf8'));
  assert.equal(E.EIP712_CHAIN_ID, 84532);
  assert.equal(E.EIP712_CHAIN_ID, g.chain_id);
  assert.equal(E.EXPECTED_LOG_SALT, g.log_id.salt);
  assert.equal(E.EIP712_DOMAIN_TYPEHASH, g.domain_typehash);
  assert.equal(E.TREE_HEAD_TYPEHASH, g.tree_head.typehash);
  assert.equal(E.RECEIPT_BINDING_TYPEHASH, g.receipt_binding.typehash);
  assert.equal(E.PAYER_COMMITMENT_TAG, g.receipt_binding.payer_tag);
  assert.equal(E.BASE_USDC_ASSET_ID, g.receipt_binding.asset_id);
  assert.equal(E.domainSeparator(E.TREE_HEAD_DOMAIN_NAME, E.EXPECTED_LOG_SALT), g.tree_head.domain_separator);
  assert.equal(E.domainSeparator(E.RECEIPT_BINDING_DOMAIN_NAME, E.EXPECTED_LOG_SALT), g.receipt_binding.domain_separator);
  for (const [k, v] of Object.entries(V.constants)) {
    const mine = {
      chain_id: E.EIP712_CHAIN_ID,
      log_salt: E.EXPECTED_LOG_SALT,
      domain_typehash: E.EIP712_DOMAIN_TYPEHASH,
      tree_head_typehash: E.TREE_HEAD_TYPEHASH,
      receipt_binding_typehash: E.RECEIPT_BINDING_TYPEHASH,
      tree_head_domain_separator: E.domainSeparator(E.TREE_HEAD_DOMAIN_NAME, E.EXPECTED_LOG_SALT),
      receipt_binding_domain_separator: E.domainSeparator(E.RECEIPT_BINDING_DOMAIN_NAME, E.EXPECTED_LOG_SALT),
      payer_commitment_tag: E.PAYER_COMMITMENT_TAG,
      base_usdc_asset_id: E.BASE_USDC_ASSET_ID,
    }[k];
    assert.equal(mine, v, k);
  }
  for (const vec of g.tree_head.vectors) {
    assert.equal(`0x${E.typedDigest('TreeHead', vec.message, E.EXPECTED_LOG_SALT).preimage.toString('hex')}`, vec.preimage);
  }
  for (const vec of g.receipt_binding.vectors) {
    assert.equal(`0x${E.typedDigest('ReceiptBinding', vec.message, E.EXPECTED_LOG_SALT).preimage.toString('hex')}`, vec.preimage);
    assert.equal(E.payerCommitment(vec.payer, Buffer.from(vec.payer_salt.slice(2), 'hex')), vec.message.payer_commitment);
  }
  assert.equal(E.kidBytes32(V.key.kid), V.key.kid_bytes32);
  assert.equal(V.key.kid, KEY.kid);
});

test('gateway-signed preimages match the verifier encoder', () => {
  assert.equal(`0x${E.typedDigest('TreeHead', V.fixed_head.object.message, E.EXPECTED_LOG_SALT).preimage.toString('hex')}`, V.fixed_head.preimage);
  assert.equal(`0x${E.typedDigest('ReceiptBinding', V.payer_binding.object.message, E.EXPECTED_LOG_SALT).preimage.toString('hex')}`, V.payer_binding.preimage);
  assert.equal(E.receiptLeafHash(B1_CLAIMS.task_id, V.payer_binding.row_hash), V.payer_binding.leaf_hash);
});

test('a gateway-signed fixed head verifies against its JWS head claims', () => {
  const check = E.verifyFixedHeadEip712(V.fixed_head.object, { claims: V.fixed_head.head_claims, kid: V.key.kid, jwk: JWK });
  assert.deepEqual(check, { ok: true });
});

test('fixed head negatives: wrong chainId, forged, tampered, other head', () => {
  const base = { claims: V.fixed_head.head_claims, kid: V.key.kid, jwk: JWK };
  const reason = (fixed, opts = base) => {
    const r = E.verifyFixedHeadEip712(fixed, opts);
    assert.equal(r.ok, false);
    return r.reason;
  };
  const f = () => clone(V.fixed_head.object);

  let x = f(); x.domain.chainId = 8453;
  assert.equal(reason(x), 'domain');
  x = f(); x.domain.chainId = '84532';
  assert.equal(reason(x), 'domain');
  x = f(); x.r = V.fixed_head.wrong_chain.r; x.s = V.fixed_head.wrong_chain.s;
  assert.equal(reason(x), 'signature', 'a signature over a chainId 8453 domain');
  x = f(); x.domain.salt = `0x${'00'.repeat(32)}`;
  assert.equal(reason(x), 'domain');
  x = f(); x.domain.name = 'Chit402ReceiptBinding';
  assert.equal(reason(x), 'domain');
  x = f(); x.schema = 'chit402.tree_head_eip712.v2';
  assert.equal(reason(x), 'schema');
  x = f(); x.types = E.RECEIPT_BINDING_TYPE;
  assert.equal(reason(x), 'type');
  x = f(); x.message.extra = 1;
  assert.equal(reason(x), 'message');
  x = f(); x.message.root = `0x${'11'.repeat(32)}`;
  assert.equal(reason(x), 'message');
  x = f(); x.message.tree_size += 1;
  assert.equal(reason(x), 'message');

  const other = { ...V.fixed_head.head_claims, tree_size: V.fixed_head.head_claims.tree_size + 1 };
  assert.equal(reason(f(), { ...base, claims: other }), 'message', 'fixed head for another head');
  assert.equal(reason(f(), { ...base, claims: { ...other, published_at: 'yesterday' } }), 'head_claims');

  const otherKey = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const forged = f();
  Object.assign(forged, signTyped('TreeHead', forged.message, otherKey.privateKey));
  assert.equal(reason(forged), 'signature', 'forged by another key');
  x = f(); x.s = `0x${(BigInt(x.s) ^ 1n).toString(16).padStart(64, '0')}`;
  assert.equal(reason(x), 'signature');

  const otherJwk = otherKey.publicKey.export({ format: 'jwk' });
  const otherKid = createHash('sha256').update(JSON.stringify({ crv: 'P-256', kty: 'EC', x: otherJwk.x, y: otherJwk.y })).digest('base64url');
  assert.equal(reason(f(), { ...base, kid: otherKid, jwk: otherJwk }), 'kid');
  assert.equal(reason(null), 'schema');
});

test('a gateway-signed payer binding verifies and opens for the B1 receipt', () => {
  assert.deepEqual(E.verifyReceiptBindingEip712(V.payer_binding.object, bindingArgs()), { checked: true, valid: true });
});

test('normalizeBaseRef follows the gateway: base or eip155:8453, string only', () => {
  const tx = `0x${'Cd'.repeat(32)}`;
  assert.equal(E.normalizeBaseRef(`base:${tx}`), `base:${tx.toLowerCase()}`);
  assert.equal(E.normalizeBaseRef(`eip155:8453:${tx}`), `base:${tx.toLowerCase()}`);
  assert.equal(E.normalizeBaseRef(`  base:${tx}  `), `base:${tx.toLowerCase()}`);
  for (const bad of [`eip155:84532:${tx}`, `base-sepolia:${tx}`, `solana:${tx}`, `base:${tx.slice(0, -1)}`, `eip155:${tx}`,
    [`base:${tx}`], { toString: () => `base:${tx}` }, 1, null, undefined]) {
    assert.equal(E.normalizeBaseRef(bad), null, String(bad));
  }
});

test('payer binding negatives: forged, wrong network, wrong chainId, non-string ref', () => {
  const reason = (binding, over = {}) => {
    const r = E.verifyReceiptBindingEip712(binding, bindingArgs(over));
    assert.equal(r.checked, true, JSON.stringify(r));
    assert.equal(r.valid, false);
    return r.reason;
  };
  const b = () => clone(V.payer_binding.object);
  const tx = B1_CLAIMS.payment.ref.slice('base:'.length);

  // Forged.
  const otherKey = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const forged = b();
  Object.assign(forged, signTyped('ReceiptBinding', forged.message, otherKey.privateKey));
  assert.equal(reason(forged), 'signature', 'forged by another key');
  let x = b(); x.message.amount_atomic = '20000';
  assert.equal(reason(x), 'signature', 'amount changed after signing');
  x = b(); x.message.payer_commitment = `0x${'22'.repeat(32)}`;
  assert.equal(reason(x), 'signature');

  // Wrong network on the signed receipt.
  assert.equal(reason(b(), { claims: withPayment({ ref: `eip155:84532:${tx}` }) }), 'network');
  assert.equal(reason(b(), { claims: withPayment({ ref: `base-sepolia:${tx}` }) }), 'network');
  assert.equal(reason(b(), { claims: withPayment({ network: 'base-sepolia' }) }), 'network');
  assert.equal(reason(b(), { claims: withPayment({ network: 'eip155:84532' }) }), 'network');
  assert.equal(reason(b(), { claims: withPayment({ ref: null }) }), 'no_payment_ref');
  assert.equal(reason(b(), { claims: withPayment({ ref: '  ' }) }), 'no_payment_ref');

  // Non-string ref that stringifies to a valid ref.
  assert.equal(reason(b(), { claims: withPayment({ ref: [B1_CLAIMS.payment.ref] }) }), 'network');
  assert.equal(reason(b(), { claims: withPayment({ ref: { ref: B1_CLAIMS.payment.ref } }) }), 'network');

  // Wrong chainId.
  x = b(); x.domain.chainId = 8453;
  assert.equal(reason(x), 'domain');
  x = b(); x.r = V.payer_binding.wrong_chain.r; x.s = V.payer_binding.wrong_chain.s;
  assert.equal(reason(x), 'signature', 'a signature over a chainId 8453 domain');
  x = b(); x.domain.chainId = 8453; x.r = V.payer_binding.wrong_chain.r; x.s = V.payer_binding.wrong_chain.s;
  assert.equal(reason(x), 'domain');

  // Binding for another receipt or payer.
  assert.equal(reason(b(), { claims: withPayment({ gross_amount: '2001' }) }), 'amount');
  assert.equal(reason(b(), { claims: withPayment({ asset: '0x0000000000000000000000000000000000000001' }) }), 'asset');
  assert.equal(reason(b(), { rowHash: 'ff'.repeat(32) }), 'leaf');
  assert.equal(reason(b(), { claims: { ...clone(B1_CLAIMS), task_id: 'xfuel-pb-other' } }), 'leaf');
  const otherPayer = clone(B1_CLAIMS);
  otherPayer.caller_binding.payer_wallet = '0x000000000000000000000000000000000000dEaD';
  assert.equal(reason(b(), { claims: otherPayer }), 'commitment');
  assert.equal(reason(b(), { payerSalt: `0x${'00'.repeat(32)}` }), 'commitment');
  assert.equal(reason(b(), { payerSalt: '0x1234' }), 'payer_salt');
  // Signed by the right key, but for another kid or another asset.
  x = b(); x.message.kid = `0x${'33'.repeat(32)}`; Object.assign(x, signTyped('ReceiptBinding', x.message));
  assert.equal(reason(x), 'kid');
  x = b(); x.message.asset_id = `0x${'44'.repeat(32)}`; Object.assign(x, signTyped('ReceiptBinding', x.message));
  assert.equal(reason(x), 'asset');
  x = b(); x.schema = 'chit402.receipt_binding_eip712.v0';
  assert.equal(reason(x), 'schema');
  assert.equal(reason(null), 'schema');
});

test('a binding that cannot be opened is unchecked, not a pass', () => {
  assert.deepEqual(E.verifyReceiptBindingEip712(V.payer_binding.object, bindingArgs({ rowHash: null })),
    { checked: false, valid: false, reason: 'row_hash_missing' });
  assert.deepEqual(E.verifyReceiptBindingEip712(V.payer_binding.object, bindingArgs({ payerSalt: undefined })),
    { checked: false, valid: false, reason: 'payer_salt_missing' });
});

test('B1 flag-off golden is pinned and carries no fixed head or binding', () => {
  // Hash the committed (LF) bytes: a Windows checkout may have CRLF.
  const raw = Buffer.from(readFileSync(B1_FILE, 'utf8').replace(/\r\n/g, '\n'), 'utf8');
  assert.equal(createHash('sha256').update(raw).digest('hex'), B1_SHA256);
  assert.equal(V.payer_binding.source_sha256, B1_SHA256);
  const b1 = JSON.parse(raw.toString('utf8'));
  assert.equal(b1.holder_jws, V.payer_binding.holder_jws);
  assert.equal(b1.row_hash, V.payer_binding.row_hash);
  const owner = JSON.parse(b1.owner.body);
  assert.ok(!('payer_binding' in owner), 'owner view has no payer_binding with the flag off');
  for (const key of ['json', 'auditor', 'accept_json']) {
    assert.ok(!/payer_binding|fixed_head/.test(b1.public[key]), key);
  }
});

function thumbprint(jwk) {
  return createHash('sha256').update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })).digest('base64url');
}

/** Re-sign a real v7 receipt fixture under the synthetic key. */
function resignedReceipt() {
  const source = JSON.parse(readFileSync(new URL('./fixtures/chit-5d775d12.v7.json', import.meta.url), 'utf8'));
  const payload = claimsOfJws(source.issuer_signature.jws);
  const header = { alg: 'ES256', typ: 'chit402-receipt+jwt', kid: KEY.kid };
  const input = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
  const sig = sign('sha256', Buffer.from(input), { key: KEY.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const receipt = clone(source);
  receipt.issuer_signature = { ...source.issuer_signature, jws: `${input}.${sig}`, kid: KEY.kid, issuer_jwk: KEY.publicJwk };
  delete receipt.verify_url;
  if (receipt.verification) delete receipt.verification.jwks_uri;
  return { receipt, payload };
}

function bindingFor(payload, rowHash, payerSalt) {
  const message = {
    leaf_hash: `0x${E.receiptLeafHash(payload.task_id, rowHash)}`,
    payer_commitment: E.payerCommitment(payload.caller_binding.payer_wallet, Buffer.from(payerSalt.slice(2), 'hex')),
    amount_atomic: String(payload.payment.gross_amount),
    asset_id: E.BASE_USDC_ASSET_ID,
    kid: E.kidBytes32(KEY.kid),
  };
  return {
    schema: E.PAYER_BINDING_SCHEMA,
    digest_alg: 'sha256(eip712_preimage)',
    domain: { name: E.RECEIPT_BINDING_DOMAIN_NAME, version: '1', chainId: 84532, salt: E.EXPECTED_LOG_SALT },
    types: E.RECEIPT_BINDING_TYPE,
    message,
    ...signTyped('ReceiptBinding', message),
  };
}

const OPTS = { trustedKids: [KEY.kid], skipIssuerHistory: true };
const ROW = 'ee'.repeat(32);
const SALT = `0x${'5a'.repeat(32)}`;

test('verifyReceipt: no binding leaves the result shape unchanged', async () => {
  assert.equal(thumbprint(KEY.publicJwk), KEY.kid);
  const { receipt } = resignedReceipt();
  const plain = await lib.verifyReceipt(receipt, OPTS);
  assert.ok(!('payer_binding' in plain), 'no payer_binding key when the receipt has none');
  const pending = await lib.verifyReceipt({ ...receipt, payer_binding: { status: 'pending' } }, OPTS);
  assert.ok(!('payer_binding' in pending));
  assert.equal(pending.overall, plain.overall);
});

test('verifyReceipt: a valid binding is checked; a forged one fails the receipt', async () => {
  const { receipt, payload } = resignedReceipt();
  const plain = await lib.verifyReceipt(receipt, OPTS);
  assert.notEqual(plain.overall, 'failed', JSON.stringify(plain.errors));
  const binding = bindingFor(payload, ROW, SALT);
  const good = await lib.verifyReceipt({ ...receipt, row_hash: ROW, payer_binding: { status: 'signed', binding, payer_salt: SALT } }, OPTS);
  assert.deepEqual(good.payer_binding, { checked: true, valid: true });
  assert.equal(good.overall, plain.overall);
  assert.ok(!good.errors.includes('payer_binding_invalid'));

  const otherKey = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const forged = { ...clone(binding), ...signTyped('ReceiptBinding', binding.message, otherKey.privateKey) };
  const cases = [
    ['forged', { status: 'signed', binding: forged, payer_salt: SALT }, ROW, 'signature'],
    ['wrong chainId', { status: 'signed', binding: { ...clone(binding), domain: { ...binding.domain, chainId: 8453 } }, payer_salt: SALT }, ROW, 'domain'],
    ['wrong salt', { status: 'signed', binding, payer_salt: `0x${'00'.repeat(32)}` }, ROW, 'commitment'],
    ['other row', { status: 'signed', binding, payer_salt: SALT }, 'dd'.repeat(32), 'leaf'],
  ];
  for (const [label, view, rowHash, why] of cases) {
    const bad = await lib.verifyReceipt({ ...receipt, row_hash: rowHash, payer_binding: view }, OPTS);
    assert.equal(bad.overall, 'failed', label);
    assert.ok(bad.errors.includes('payer_binding_invalid'), label);
    assert.equal(bad.payer_binding.reason, why, label);
    assert.equal(bad.verdict.reason, 'payer_binding_invalid', label);
    assert.equal(bad.verdict.exit_code, 1, label);
  }

  const unopened = await lib.verifyReceipt({ ...receipt, payer_binding: { status: 'signed', binding } }, OPTS);
  assert.equal(unopened.payer_binding.checked, false);
  assert.equal(unopened.overall, plain.overall);
});

test('verifyReceipt: the binding reads row_hash like the log leaf (boundRowHash)', async () => {
  const { receipt, payload } = resignedReceipt();
  const binding = bindingFor(payload, ROW, SALT);
  const view = { status: 'signed', binding, payer_salt: SALT };
  const WRONG = 'dd'.repeat(32);
  const run = (rows) => lib.verifyReceipt({ ...receipt, ...rows, payer_binding: view }, OPTS);

  // Probe A4d: a correct row_hash next to a wrong book_chain.row_hash does not pass.
  const a4d = await run({ row_hash: ROW, book_chain: { row_hash: WRONG } });
  assert.deepEqual(a4d.payer_binding, { checked: true, valid: false, reason: 'row_hash_mismatch' });
  assert.equal(a4d.overall, 'failed');
  assert.ok(a4d.errors.includes('payer_binding_invalid'));
  assert.equal(a4d.verdict.exit_code, 1);
  assert.equal(a4d.verdict.reason, 'payer_binding_invalid');

  // A4e, the reverse, is the same mismatch.
  const a4e = await run({ row_hash: WRONG, book_chain: { row_hash: ROW } });
  assert.deepEqual(a4e.payer_binding, { checked: true, valid: false, reason: 'row_hash_mismatch' });

  // An empty row_hash is a present source, as for the leaf: it does not fall through.
  const empty = await run({ row_hash: '', book_chain: { row_hash: ROW } });
  assert.deepEqual(empty.payer_binding, { checked: true, valid: false, reason: 'row_hash_mismatch' });

  // One source, or two that agree, is checked.
  for (const rows of [{ row_hash: ROW }, { book_chain: { row_hash: ROW } }, { row_hash: ROW, book_chain: { row_hash: ROW } }]) {
    const ok = await run(rows);
    assert.deepEqual(ok.payer_binding, { checked: true, valid: true }, JSON.stringify(rows));
  }
  // No row hash at all is not checked.
  const none = await run({});
  assert.deepEqual(none.payer_binding, { checked: false, valid: false, reason: 'row_hash_missing' });
});

test('verifyReceipt: a binding on a non-Base receipt fails as network', async () => {
  const { receipt, payload } = resignedReceipt();
  const claims = clone(payload);
  claims.payment.ref = `eip155:84532:${claims.payment.ref.slice('base:'.length)}`;
  const header = { alg: 'ES256', typ: 'chit402-receipt+jwt', kid: KEY.kid };
  const input = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  const sig = sign('sha256', Buffer.from(input), { key: KEY.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const sepolia = { ...receipt, payment: { ...receipt.payment, ref: claims.payment.ref } };
  sepolia.issuer_signature = { ...receipt.issuer_signature, jws: `${input}.${sig}` };
  const binding = bindingFor(payload, ROW, SALT);
  const out = await lib.verifyReceipt({ ...sepolia, row_hash: ROW, payer_binding: { status: 'signed', binding, payer_salt: SALT } }, OPTS);
  assert.equal(out.payer_binding?.reason, 'network', JSON.stringify(out.payer_binding));
  assert.equal(out.overall, 'failed');
});

test('CLI path: a forged binding exits 1 with payer_binding_invalid', async () => {
  const { receipt, payload } = resignedReceipt();
  const binding = bindingFor(payload, ROW, SALT);
  const good = { ...receipt, row_hash: ROW, payer_binding: { status: 'signed', binding, payer_salt: SALT } };
  const dir = tempDir('chit-eip712-');
  const file = (name, doc) => {
    const out = join(dir, name);
    writeFileSync(out, `${JSON.stringify(doc)}\n`);
    return out;
  };
  const ok = await checkReceiptInput(file('good.json', good), { trustedKids: [KEY.kid] });
  assert.notEqual(ok.verdict.exit_code, 1, JSON.stringify(ok.verdict));
  assert.deepEqual(ok.verdict.payer_binding, { checked: true, valid: true, reason: null });
  const bad = { ...good, payer_binding: { ...good.payer_binding, payer_salt: `0x${'00'.repeat(32)}` } };
  const out = await checkReceiptInput(file('bad.json', bad), { trustedKids: [KEY.kid] });
  assert.equal(out.verdict.exit_code, 1);
  assert.equal(out.verdict.reason, 'payer_binding_invalid');
  assert.deepEqual(out.verdict.payer_binding, { checked: true, valid: false, reason: 'commitment' });
  assert.ok(humanVerdictLines(out.verdict).some((line) => /payer binding/i.test(line)));
  const plain = await checkReceiptInput(file('plain.json', receipt), { trustedKids: [KEY.kid] });
  assert.ok(!('payer_binding' in plain.verdict), 'no binding, no payer_binding in the verdict');
  assert.equal(plain.verdict.exit_code, ok.verdict.exit_code);
  assert.equal(plain.verdict.reason, ok.verdict.reason);
});

function sealHead(claims) {
  const header = { alg: 'ES256', typ: 'chit402-tree-head+jwt', kid: KEY.kid };
  const input = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  const sig = sign('sha256', Buffer.from(input), { key: KEY.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return {
    ...claims,
    issuer_signature: { alg: 'ES256', typ: 'chit402-tree-head+jwt', jws: `${input}.${sig}`, kid: KEY.kid, issuer_jwk: KEY.publicJwk },
  };
}

test('fixedHeadOutcome on a signed tree head', () => {
  const head = sealHead(V.fixed_head.head_claims);
  assert.equal(fixedHeadOutcome(head, null, [KEY.kid]), null, 'no fixed head (flag off) is not checked');
  assert.deepEqual(fixedHeadOutcome({ ...head, fixed_head: V.fixed_head.object }, null, [KEY.kid]), { ok: true });
  const bad = clone(V.fixed_head.object);
  bad.domain.chainId = 8453;
  assert.deepEqual(fixedHeadOutcome({ ...head, fixed_head: bad }, null, [KEY.kid]), { ok: false, reason: 'domain' });
  const other = sealHead({ ...V.fixed_head.head_claims, tree_size: 40 });
  assert.deepEqual(fixedHeadOutcome({ ...other, fixed_head: V.fixed_head.object }, null, [KEY.kid]), { ok: false, reason: 'message' });
  assert.deepEqual(fixedHeadOutcome({ ...head, fixed_head: V.fixed_head.object }, null, ['someone-else']),
    { ok: false, reason: 'head_untrusted' });
  // Outer head fields that the JWS does not say: the head is not trusted.
  const relabelled = { ...head, tree_size: 40, fixed_head: V.fixed_head.object };
  assert.deepEqual(fixedHeadOutcome(relabelled, null, [KEY.kid]), { ok: false, reason: 'head_untrusted' });
});

test('verdict: fixed_head_invalid and payer_binding_invalid are INVALID with doc anchors', () => {
  for (const reason of ['fixed_head_invalid', 'payer_binding_invalid']) {
    assert.ok(VERDICT_DOC_ANCHORS.includes(reason), reason);
    const v = buildVerifyVerdict({
      version: 'test', signatureValid: true, signatureChecked: true, historyChecked: true, historyOk: true,
      logInclusion: 'pass', anchor: 'pass', failureReason: reason,
    });
    assert.equal(v.exit_code, 1, reason);
    assert.equal(v.result, 'invalid');
    assert.equal(v.reason, reason);
    assert.equal(humanVerdictLines(v)[0], 'INVALID');
    assert.ok(typeof v.message === 'string' && v.message.length > 0);
  }
  const fine = buildVerifyVerdict({
    version: 'test', signatureValid: true, signatureChecked: true, historyChecked: true, historyOk: true,
    logInclusion: 'pass', anchor: 'pass', log: { fixed_head: 'verified' },
  });
  assert.equal(fine.exit_code, 0);
  assert.ok(humanVerdictLines(fine).some((line) => /fixed head/i.test(line)));
});
