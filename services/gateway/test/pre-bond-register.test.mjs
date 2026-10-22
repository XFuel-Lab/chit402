/**
 * PROPOSED pre-bond register (chit402.pre_bond_register.v0): shape, the
 * domain-separated hash, ack cross-checks, the bond-start rule, and the
 * four-part head identity. Throwaway keys only, no network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const {
  PRE_BOND_REGISTER_DOMAIN,
  inclusionEvidenceAllowed,
  preBondRegisterHash,
  registerExcludes,
  registerLists,
  validatePreBondRegister,
} = await import('../src/pre-bond-register.js');
const {
  jcs,
  quarantineAckDocumentHash,
  signQuarantineAck,
} = await import('../src/quarantine-ack.js');
const { leafHash, rootOf, consistencyProof } = await import('../src/receipt-merkle.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const examplePath = path.join(here, '..', '..', '..', 'docs', 'log', 'pre-bond-register.example.json');

function throwawaySigner() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const publicJwk = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
  const kid = crypto.createHash('sha256').update(JSON.stringify(publicJwk)).digest('base64url');
  return {
    kid,
    publicJwk,
    async sign(input) {
      return crypto.sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' });
    },
  };
}

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const leaves = Array.from({ length: 11 }, (_, i) => leafHash(Buffer.from(`xfuel-reg-${i}|row${i}`)));
const prefixRoot = rootOf(leaves.slice(0, 10)).toString('hex');
const goodRoot = rootOf(leaves).toString('hex');
const RACED_JWS = 'eyJhbGciOiJFUzI1NiJ9.eyJyYWNlZCI6dHJ1ZX0.c2ln';
const RACED_JWS_SHA = sha(RACED_JWS);
const GOOD_JWS_SHA = sha('replacement-head-jws');
const BOND_START = '2026-11-01T00:00:00Z';
const BOND_START_S = Math.floor(Date.parse(BOND_START) / 1000);

async function signedAck(signer, { iat = BOND_START_S - 3600, headJwsSha = RACED_JWS_SHA } = {}) {
  return signQuarantineAck({
    schema: 'chit402.quarantine_ack.v2',
    payload_version: 2,
    iss: 'chit402',
    iat,
    epoch: 2,
    quarantined_head: {
      tree_size: 11, prefix_size: 10, root: prefixRoot, published_at: '2026-10-09T10:23:54.000Z',
      kid: signer.kid, head_jws_sha256: headJwsSha, anchors: {},
    },
    reason: 'publish_append_race',
    replacement_head: { tree_size: 11, root: goodRoot, published_at: '2026-10-09T10:23:55.863Z', anchors: {} },
    consistency: { first_tree_size: 10, second_tree_size: 11, proof: consistencyProof(leaves, 10, 11) },
    handling: {
      head_served: false, inclusion_against_head: 'not_evidence', receipts_only_in_head: 0,
      covered_by: 'replacement_head', escrow_register: 'excluded', scope: 'this_head_only',
    },
  }, signer);
}

function registerFor(signer, ackDoc) {
  return {
    schema: 'chit402.pre_bond_register.v0',
    as_of: BOND_START,
    issuer_kid: signer.kid,
    heads: [
      { epoch: 2, tree_size: 11, root: prefixRoot, head_jws_sha256: RACED_JWS_SHA, status: 'excluded', ack_sha256: quarantineAckDocumentHash(ackDoc) },
      { epoch: 2, tree_size: 11, root: goodRoot, head_jws_sha256: GOOD_JWS_SHA, status: 'good', ack_sha256: null },
    ].sort((a, b) => (a.root < b.root ? -1 : 1)),
  };
}

test('the committed example register has the proposed shape once its placeholders are filled', () => {
  const example = JSON.parse(fs.readFileSync(examplePath, 'utf8'));
  assert.equal(example.schema, 'chit402.pre_bond_register.v0');
  assert.equal(example.heads.length, 1);
  const [entry] = example.heads;
  assert.deepEqual(
    { epoch: entry.epoch, tree_size: entry.tree_size, root: entry.root, status: entry.status },
    { epoch: 2, tree_size: 11, root: 'cf9f998f969c8c7c3b969b0b636a4b7bf6424ebcaf746790b33c38e168c54341', status: 'excluded' },
  );
  assert.equal(validatePreBondRegister(example).ok, false);
  const filled = {
    ...example,
    as_of: BOND_START,
    heads: [{ ...entry, head_jws_sha256: 'a'.repeat(64), ack_sha256: 'b'.repeat(64) }],
  };
  assert.deepEqual(validatePreBondRegister(filled), { ok: true, errors: [] });
});

test('register hash is sha256 over a domain prefix and the JCS bytes, independent of key order', async () => {
  const signer = throwawaySigner();
  const reg = registerFor(signer, await signedAck(signer));
  const h = preBondRegisterHash(reg);
  const manual = crypto.createHash('sha256').update(`chit402.pre_bond_register.v0\u0000${jcs(reg)}`, 'utf8').digest('hex');
  assert.equal(h, manual);
  assert.equal(PRE_BOND_REGISTER_DOMAIN.endsWith('\u0000'), true);
  assert.notEqual(h, sha(jcs(reg)));
  const reordered = { heads: reg.heads, issuer_kid: reg.issuer_kid, as_of: reg.as_of, schema: reg.schema };
  assert.equal(preBondRegisterHash(reordered), h);
  const changed = JSON.parse(JSON.stringify(reg));
  changed.heads[0].tree_size = 12;
  assert.notEqual(preBondRegisterHash(changed), h);
});

test('a register with a verified ack signed before bond start validates', async () => {
  const signer = throwawaySigner();
  const ack = await signedAck(signer);
  const reg = registerFor(signer, ack);
  const keys = [{ ...signer.publicJwk, kid: signer.kid }];
  assert.deepEqual(validatePreBondRegister(reg, { acks: [ack], keys }), { ok: true, errors: [] });
});

test('an ack signed at or after bond start excuses nothing', async () => {
  const signer = throwawaySigner();
  const keys = [{ ...signer.publicJwk, kid: signer.kid }];
  for (const iat of [BOND_START_S, BOND_START_S + 1]) {
    const ack = await signedAck(signer, { iat });
    const res = validatePreBondRegister(registerFor(signer, ack), { acks: [ack], keys });
    assert.equal(res.ok, false);
    assert.match(res.errors.join(';'), /iat is not before bond start/);
  }
});

test('excluded entries need the exact ack: hash, signature and all four head parts', async () => {
  const signer = throwawaySigner();
  const keys = [{ ...signer.publicJwk, kid: signer.kid }];
  const ack = await signedAck(signer);
  const reg = registerFor(signer, ack);
  assert.match(validatePreBondRegister(reg, { acks: [], keys }).errors.join(';'), /no ack document/);
  const other = throwawaySigner();
  assert.match(validatePreBondRegister(reg, { acks: [ack], keys: [{ ...other.publicJwk, kid: other.kid }] }).errors.join(';'), /does not verify/);

  const otherHeadAck = await signedAck(signer, { headJwsSha: 'e'.repeat(64) });
  const pointed = JSON.parse(JSON.stringify(reg));
  const idx = pointed.heads.findIndex((e) => e.status === 'excluded');
  pointed.heads[idx].ack_sha256 = quarantineAckDocumentHash(otherHeadAck);
  assert.match(validatePreBondRegister(pointed, { acks: [otherHeadAck], keys }).errors.join(';'), /names a different head/);
});

test('lookups use (epoch, tree_size, root, head JWS hash) and never the root alone', async () => {
  const signer = throwawaySigner();
  const reg = registerFor(signer, await signedAck(signer));
  const exact = { epoch: 2, tree_size: 11, root: prefixRoot, head_jws_sha256: RACED_JWS_SHA };
  assert.equal(registerExcludes(reg, exact), true);
  assert.equal(registerExcludes(reg, { epoch: 2, tree_size: 11, root: prefixRoot, jws: RACED_JWS }), true);
  assert.equal(registerExcludes(reg, { root: prefixRoot }), false);
  assert.equal(registerExcludes(reg, { epoch: 2, tree_size: 11, root: prefixRoot }), false);
  assert.equal(registerExcludes(reg, { ...exact, tree_size: 10 }), false, 'the honest size-10 head with the same root');
  assert.equal(registerExcludes(reg, { ...exact, epoch: 3 }), false);
  assert.equal(registerExcludes(reg, { ...exact, head_jws_sha256: 'f'.repeat(64) }), false, 'another signed object');
  assert.equal(registerExcludes(reg, { epoch: 2, tree_size: 11, root: prefixRoot, jws: `${RACED_JWS}x` }), false);
  assert.equal(registerExcludes(reg, { ...exact, jws: 'other.jws.bytes' }), false, 'jws and hash disagree');
  assert.equal(registerExcludes(reg, { epoch: 2, tree_size: 11, root: goodRoot, head_jws_sha256: GOOD_JWS_SHA }), false);
  assert.equal(registerLists(reg, { epoch: 2, tree_size: 11, root: goodRoot, head_jws_sha256: GOOD_JWS_SHA }), true);
  assert.equal(registerLists(reg, { epoch: 2, tree_size: 12, root: goodRoot, head_jws_sha256: GOOD_JWS_SHA }), false);
});

test('an inclusion proof against an excluded head is never evidence', async () => {
  const signer = throwawaySigner();
  const reg = registerFor(signer, await signedAck(signer));
  assert.equal(inclusionEvidenceAllowed(reg, { epoch: 2, tree_size: 11, root: prefixRoot, head_jws_sha256: RACED_JWS_SHA }), false);
  assert.equal(inclusionEvidenceAllowed(reg, { epoch: 2, tree_size: 11, root: goodRoot, head_jws_sha256: GOOD_JWS_SHA }), true);
});

test('shape rules: keys, status, ack pointer, order and duplicates', async () => {
  const signer = throwawaySigner();
  const reg = registerFor(signer, await signedAck(signer));
  const bad = (fn) => {
    const r = JSON.parse(JSON.stringify(reg));
    fn(r);
    return validatePreBondRegister(r).ok;
  };
  assert.equal(validatePreBondRegister(reg).ok, true);
  assert.equal(bad((r) => { r.extra = 1; }), false);
  assert.equal(bad((r) => { r.schema = 'chit402.pre_bond_register.v1'; }), false);
  assert.equal(bad((r) => { r.as_of = '2026-11-01T00:00:00.000Z'; }), false);
  assert.equal(bad((r) => { r.heads = []; }), false);
  assert.equal(bad((r) => { r.heads[0].status = 'pending'; }), false);
  assert.equal(bad((r) => { const g = r.heads.find((e) => e.status === 'good'); g.ack_sha256 = 'a'.repeat(64); }), false);
  assert.equal(bad((r) => { const x = r.heads.find((e) => e.status === 'excluded'); x.ack_sha256 = null; }), false);
  assert.equal(bad((r) => { r.heads.reverse(); }), false);
  assert.equal(bad((r) => { r.heads.push({ ...r.heads[r.heads.length - 1] }); }), false);
  assert.equal(bad((r) => { r.heads[0].root = r.heads[0].root.toUpperCase(); }), false);
  assert.equal(bad((r) => { delete r.heads[0].head_jws_sha256; }), false);
});
