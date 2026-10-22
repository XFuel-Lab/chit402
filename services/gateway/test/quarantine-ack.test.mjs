/**
 * Public quarantine acknowledgement (chit402.quarantine_ack.v2): shape,
 * consistency proof, signing with a throwaway key, and journal fill.
 * No production key and no network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const {
  FILL_FROM_JOURNAL,
  QUARANTINE_ACK_TYP,
  fillQuarantineAckFromJournal,
  jcs,
  quarantineAckDocumentHash,
  signQuarantineAck,
  validateQuarantineAckClaims,
  verifyConsistencyProof,
  verifyQuarantineAck,
  journalHeads,
} = await import('../src/quarantine-ack.js');
const { leafHash, rootOf, consistencyProof } = await import('../src/receipt-merkle.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..', '..');
const draftPath = path.join(repoRoot, 'docs', 'log', 'quarantine-acks', 'epoch-2-size-11-cf9f998f.draft.json');
const scriptPath = path.join(here, '..', 'scripts', 'sign-quarantine-ack.mjs');

function thumbprint(jwk) {
  return crypto.createHash('sha256').update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })).digest('base64url');
}

function throwawaySigner() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const publicJwk = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
  const kid = thumbprint(publicJwk);
  return {
    kind: 'test',
    kid,
    publicJwk,
    privateKey,
    async sign(input) {
      return crypto.sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' });
    },
  };
}

function signJson(signer, header, payload) {
  const input = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
  const sig = crypto.sign('sha256', Buffer.from(input), { key: signer.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${input}.${sig.toString('base64url')}`;
}

const leaves = Array.from({ length: 11 }, (_, i) => leafHash(Buffer.from(`xfuel-test-${i}|row${i}`)));
const prefixRoot = rootOf(leaves.slice(0, 10)).toString('hex');
const goodRoot = rootOf(leaves).toString('hex');
const proof = consistencyProof(leaves, 10, 11);
const BASE_RACED = `0x${'a1'.repeat(32)}`;
const BASE_GOOD = `0x${'b2'.repeat(32)}`;

/** Journal with a raced head (size 11 over the size-10 root) and the replacement head. */
function raceJournal(signer, { racedPublishedAt = '2026-10-09T10:23:54.100Z', goodPublishedAt = '2026-10-09T10:23:55.863Z', duplicateRaced = false } = {}) {
  const head = (root, publishedAt, tx) => {
    const payload = {
      schema: 'chit402.tree_head.v2', payload_version: 2, epoch: 2, tree_size: 11, root, published_at: publishedAt,
      anchors: { base: { chain: 'base', chain_id: 8453, tx } },
    };
    const jws = signJson(signer, { alg: 'ES256', typ: 'chit402-tree-head+jwt', kid: signer.kid }, payload);
    return { v: 1, op: 'head', head: { ...payload, issuer_signature: { alg: 'ES256', jws, kid: signer.kid } } };
  };
  const rows = [{ v: 1, op: 'epoch_open', epoch: 2 }];
  rows.push(head(prefixRoot, racedPublishedAt, BASE_RACED));
  if (duplicateRaced) rows.push(head(prefixRoot, racedPublishedAt, BASE_RACED));
  rows.push(head(goodRoot, goodPublishedAt, BASE_GOOD));
  return `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;
}

function draftFor(signer) {
  return {
    schema: 'chit402.quarantine_ack.v2',
    payload_version: 2,
    iss: 'chit402',
    iat: null,
    epoch: 2,
    quarantined_head: {
      tree_size: 11,
      prefix_size: 10,
      root: prefixRoot,
      published_at: FILL_FROM_JOURNAL,
      kid: signer.kid,
      head_jws_sha256: FILL_FROM_JOURNAL,
      anchors: { base: { chain_id: 8453, tx: BASE_RACED } },
    },
    reason: 'publish_append_race',
    replacement_head: {
      tree_size: 11,
      root: goodRoot,
      published_at: '2026-10-09T10:23:55.863Z',
      anchors: { base: { chain_id: 8453, tx: BASE_GOOD } },
    },
    consistency: { first_tree_size: 10, second_tree_size: 11, proof },
    handling: {
      head_served: false,
      inclusion_against_head: 'not_evidence',
      receipts_only_in_head: 0,
      covered_by: 'replacement_head',
      escrow_register: 'excluded',
      scope: 'this_head_only',
    },
  };
}

function filledClaims(signer) {
  return fillQuarantineAckFromJournal(draftFor(signer), raceJournal(signer), { nowSeconds: 1792000000 });
}

test('the committed draft carries the public 10 to 11 consistency proof for the two production roots', () => {
  const draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
  const q = draft.quarantined_head;
  const r = draft.replacement_head;
  assert.equal(draft.schema, 'chit402.quarantine_ack.v2');
  assert.equal(q.published_at, FILL_FROM_JOURNAL);
  assert.equal(q.head_jws_sha256, FILL_FROM_JOURNAL);
  assert.equal(draft.iat, null);
  assert.equal(verifyConsistencyProof(10, 11, q.root, r.root, draft.consistency.proof), true);
  assert.equal(verifyConsistencyProof(10, 11, r.root, q.root, draft.consistency.proof), false);
  const filledShape = { ...draft, iat: 1, quarantined_head: { ...q, published_at: '2026-10-09T10:23:55.000Z', head_jws_sha256: 'c'.repeat(64) } };
  assert.deepEqual(validateQuarantineAckClaims(filledShape), { ok: true, errors: [] });
});

test('consistency check agrees with receipt-merkle on every (m, n) up to 20 and rejects bit flips', () => {
  const many = Array.from({ length: 20 }, (_, i) => leafHash(Buffer.from(`leaf-${i}`)));
  for (let n = 1; n <= 20; n++) {
    for (let m = 1; m <= n; m++) {
      const p = consistencyProof(many, m, n);
      const oldRoot = rootOf(many.slice(0, m)).toString('hex');
      const newRoot = rootOf(many.slice(0, n)).toString('hex');
      assert.equal(verifyConsistencyProof(m, n, oldRoot, newRoot, p), true, `${m}->${n}`);
      if (p.length) {
        const bad = [...p];
        bad[0] = (bad[0][0] === '0' ? '1' : '0') + bad[0].slice(1);
        assert.equal(verifyConsistencyProof(m, n, oldRoot, newRoot, bad), false, `flip ${m}->${n}`);
        assert.equal(verifyConsistencyProof(m, n, oldRoot, newRoot, p.slice(1)), false, `short ${m}->${n}`);
      }
    }
  }
});

test('journal fill sets the signed head time, kid and JWS hash, and the result validates', () => {
  const signer = throwawaySigner();
  const claims = filledClaims(signer);
  assert.equal(claims.quarantined_head.published_at, '2026-10-09T10:23:54.100Z');
  assert.equal(claims.quarantined_head.kid, signer.kid);
  assert.match(claims.quarantined_head.head_jws_sha256, /^[0-9a-f]{64}$/);
  assert.equal(claims.iat, 1792000000);
  assert.deepEqual(validateQuarantineAckClaims(claims), { ok: true, errors: [] });
});

test('journal fill refuses a draft that disagrees with the journal', () => {
  const signer = throwawaySigner();
  const journal = raceJournal(signer);
  const wrongTime = draftFor(signer);
  wrongTime.replacement_head.published_at = '2026-10-09T10:23:56.000Z';
  assert.throws(() => fillQuarantineAckFromJournal(wrongTime, journal, { nowSeconds: 1 }), /replacement_head.published_at/);
  const wrongTx = draftFor(signer);
  wrongTx.quarantined_head.anchors.base.tx = `0x${'cc'.repeat(32)}`;
  assert.throws(() => fillQuarantineAckFromJournal(wrongTx, journal, { nowSeconds: 1 }), /Base tx/);
  const wrongKid = draftFor(signer);
  wrongKid.quarantined_head.kid = 'A'.repeat(43);
  assert.throws(() => fillQuarantineAckFromJournal(wrongKid, journal, { nowSeconds: 1 }), /kid/);
  assert.throws(
    () => fillQuarantineAckFromJournal(draftFor(signer), raceJournal(signer, { duplicateRaced: true }), { nowSeconds: 1 }),
    /exactly one/,
  );
  const other = throwawaySigner();
  assert.throws(
    () => fillQuarantineAckFromJournal(draftFor(signer), journal, { nowSeconds: 1, verifyKey: { ...other.publicJwk, kid: signer.kid } }),
    /does not verify/,
  );
});

test('a throwaway-key ack signs, verifies under that kid only, and hashes stably', async () => {
  const signer = throwawaySigner();
  const doc = await signQuarantineAck(filledClaims(signer), signer);
  const keys = [{ ...signer.publicJwk, kid: signer.kid }];
  const ok = verifyQuarantineAck(doc, { keys });
  assert.equal(ok.ok, true, ok.reason);
  assert.equal(doc.issuer_signature.typ, QUARANTINE_ACK_TYP);
  const [h, p] = doc.issuer_signature.jws.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'ES256', typ: QUARANTINE_ACK_TYP, kid: signer.kid });
  assert.equal(Buffer.from(p, 'base64url').toString('utf8'), jcs(ok.claims));
  assert.equal(quarantineAckDocumentHash(doc), quarantineAckDocumentHash(JSON.parse(JSON.stringify(doc))));
  const other = throwawaySigner();
  assert.equal(verifyQuarantineAck(doc, { keys: [{ ...other.publicJwk, kid: other.kid }] }).reason, 'kid_not_trusted');
  assert.equal(verifyQuarantineAck(doc, { keys: [{ ...other.publicJwk, kid: signer.kid }] }).reason, 'signature_invalid');
  assert.equal(verifyQuarantineAck(doc, { keys: [] }).reason, 'kid_not_trusted');
});

test('verify refuses wrong typ, v1 schema, outer drift, non-canonical bytes and bad claims', async () => {
  const signer = throwawaySigner();
  const keys = { keys: [{ ...signer.publicJwk, kid: signer.kid }] };
  const claims = filledClaims(signer);
  const doc = await signQuarantineAck(claims, signer);

  const sigBlock = (jws, typ = QUARANTINE_ACK_TYP) => ({ alg: 'ES256', typ, payload_version: 2, kid: signer.kid, jws });

  const asHead = signJson(signer, { alg: 'ES256', typ: 'chit402-tree-head+jwt', kid: signer.kid }, claims);
  assert.equal(verifyQuarantineAck({ ...claims, issuer_signature: sigBlock(asHead) }, keys).reason, 'wrong_typ');

  const v1 = { schema: 'chit402.quarantine_ack.v1', root: claims.quarantined_head.root, epoch: 2, tree_size: 11, prefix_size: 10 };
  const v1Jws = signJson(signer, { alg: 'ES256', typ: QUARANTINE_ACK_TYP, kid: signer.kid }, v1);
  assert.equal(verifyQuarantineAck({ ...v1, issuer_signature: sigBlock(v1Jws) }, keys).reason, 'payload_not_canonical');
  const v1Canon = `${Buffer.from(JSON.stringify({ alg: 'ES256', typ: QUARANTINE_ACK_TYP, kid: signer.kid })).toString('base64url')}.${Buffer.from(jcs(v1)).toString('base64url')}`;
  const v1Sig = crypto.sign('sha256', Buffer.from(v1Canon), { key: signer.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  assert.equal(verifyQuarantineAck({ ...v1, issuer_signature: sigBlock(`${v1Canon}.${v1Sig}`) }, keys).reason, 'claims_invalid');

  const drift = JSON.parse(JSON.stringify(doc));
  drift.replacement_head.root = 'f'.repeat(64);
  assert.equal(verifyQuarantineAck(drift, keys).reason, 'outer_mismatch');
  const extra = { ...JSON.parse(JSON.stringify(doc)), note: 'x' };
  assert.equal(verifyQuarantineAck(extra, keys).reason, 'outer_mismatch');

  const reordered = signJson(signer, { alg: 'ES256', typ: QUARANTINE_ACK_TYP, kid: signer.kid }, { iss: 'chit402', ...claims });
  assert.equal(verifyQuarantineAck({ ...claims, issuer_signature: sigBlock(reordered) }, keys).reason, 'payload_not_canonical');

  const unsigned = { ...claims };
  assert.equal(verifyQuarantineAck(unsigned, keys).reason, 'unsigned');

  const tampered = JSON.parse(JSON.stringify(doc));
  const parts = tampered.issuer_signature.jws.split('.');
  parts[2] = Buffer.alloc(64, 1).toString('base64url');
  tampered.issuer_signature.jws = parts.join('.');
  assert.equal(verifyQuarantineAck(tampered, keys).reason, 'signature_invalid');
});

test('claim rules: proof, prefix, sizes, handling, keys and reason are all enforced', () => {
  const signer = throwawaySigner();
  const base = filledClaims(signer);
  const mutate = (fn) => {
    const c = JSON.parse(JSON.stringify(base));
    fn(c);
    return validateQuarantineAckClaims(c);
  };
  assert.equal(mutate((c) => { c.consistency.proof[0] = '0'.repeat(64); }).ok, false);
  assert.equal(mutate((c) => { c.consistency.first_tree_size = 9; }).ok, false);
  assert.equal(mutate((c) => { c.quarantined_head.prefix_size = 11; }).ok, false);
  assert.equal(mutate((c) => { c.replacement_head.root = c.quarantined_head.root; }).ok, false);
  assert.equal(mutate((c) => { c.replacement_head.tree_size = 10; c.consistency.second_tree_size = 10; }).ok, false);
  assert.equal(mutate((c) => { c.handling.scope = 'all_heads'; }).ok, false);
  assert.equal(mutate((c) => { c.handling.receipts_only_in_head = 1; }).ok, false);
  assert.equal(mutate((c) => { c.reason = 'operator_choice'; }).ok, false);
  assert.equal(mutate((c) => { c.extra = true; }).ok, false);
  assert.equal(mutate((c) => { c.quarantined_head.root = c.quarantined_head.root.toUpperCase(); }).ok, false);
  assert.equal(mutate((c) => { c.iat = 1.5; }).ok, false);
  assert.equal(mutate((c) => { c.quarantined_head.anchors.base.tx = c.quarantined_head.anchors.base.tx.toUpperCase().replace('0X', '0x'); }).ok, false);
  assert.equal(mutate((c) => { c.quarantined_head.anchors.base.chain_id = 84532; }).ok, false);
});

test('signing refuses invalid claims and a signer without a public key', async () => {
  const signer = throwawaySigner();
  const bad = { ...filledClaims(signer), reason: 'other' };
  await assert.rejects(() => signQuarantineAck(bad, signer), /claims invalid/);
  await assert.rejects(() => signQuarantineAck(filledClaims(signer), { kid: signer.kid, sign: signer.sign }), /publicJwk/);
});

test('script: dry run fills from a journal file, prints claims, writes nothing; signing paths are gated', () => {
  const signer = throwawaySigner();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qack-'));
  try {
    const journal = path.join(dir, 'journal.jsonl');
    const draft = path.join(dir, 'draft.json');
    fs.writeFileSync(journal, raceJournal(signer));
    fs.writeFileSync(draft, JSON.stringify(draftFor(signer)));
    const before = fs.readdirSync(dir).sort();
    const env = { ...process.env, ISSUER_SIGNER: '', ISSUER_PRIVATE_KEY: '' };
    const dry = spawnSync(process.execPath, [scriptPath, '--draft', draft, '--journal', journal, '--expect-kid', signer.kid, '--dry-run'], { encoding: 'utf8', env });
    assert.equal(dry.status, 0, dry.stderr);
    const printed = JSON.parse(dry.stdout);
    assert.equal(validateQuarantineAckClaims(printed).ok, true);
    assert.match(dry.stderr, /DRY RUN: nothing was signed/);
    assert.deepEqual(fs.readdirSync(dir).sort(), before);

    const noConfirm = spawnSync(process.execPath, [scriptPath, '--draft', draft, '--journal', journal, '--expect-kid', signer.kid], { encoding: 'utf8', env });
    assert.equal(noConfirm.status, 1);
    assert.match(noConfirm.stderr, /--confirm SIGN/);

    const envSigner = spawnSync(process.execPath, [scriptPath, '--draft', draft, '--journal', journal, '--expect-kid', signer.kid, '--confirm', 'SIGN'], { encoding: 'utf8', env: { ...env, ISSUER_SIGNER: 'env' } });
    assert.equal(envSigner.status, 1);
    assert.match(envSigner.stderr, /ISSUER_SIGNER must be kms/);
    assert.deepEqual(fs.readdirSync(dir).sort(), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an ack excludes only the head it names by all four parts, never by root alone', async () => {
  const { ackExcludesHead, headIdentity } = await import('../src/quarantine-ack.js');
  const signer = throwawaySigner();
  const claims = filledClaims(signer);
  const id = { epoch: 2, tree_size: 11, root: claims.quarantined_head.root, head_jws_sha256: claims.quarantined_head.head_jws_sha256 };
  assert.equal(ackExcludesHead(claims, id), true);
  assert.equal(ackExcludesHead(claims, { root: id.root }), false);
  assert.equal(ackExcludesHead(claims, { epoch: 2, tree_size: 11, root: id.root }), false);
  assert.equal(ackExcludesHead(claims, { ...id, tree_size: 10 }), false);
  assert.equal(ackExcludesHead(claims, { ...id, epoch: 1 }), false);
  assert.equal(ackExcludesHead(claims, { ...id, head_jws_sha256: '0'.repeat(64) }), false);
  const raced = journalHeads(raceJournal(signer)).find((e) => e.decoded.payload.root === id.root);
  assert.equal(ackExcludesHead(claims, { epoch: 2, tree_size: 11, root: id.root, jws: raced.jws }), false, 'a different journal, so a different JWS');
  assert.equal(headIdentity({ ...id, jws: 'a.b.c' }), null, 'jws and hash must agree');
});
