/**
 * Receipt-slot type confusion: an issuer JWS for another document (book-seq,
 * tree head, x402 receipt, refusal) or one with crit/b64, placed in
 * issuer_signature.jws, is never read as receipt claims on the page, the
 * export, the served shell or the share card.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import {
  renderReceiptHtml, buildAuditorExport, signedReceiptProjection, verifyIssuerForHtml, decodeReceiptClaims,
} from '../src/receipt.js';
import { toPublicShell, receiptOwnsTx, decodeJwsPayload } from '../src/receipt-shell.js';
import { buildReceiptOgMeta } from '../src/receipt-og-meta.js';
import { signJws as signJwsRaw } from '../src/issuer-key.js';

const signJws = (p, o) => { const r = signJwsRaw(p, o); return typeof r === 'string' ? r : r.jws; };

const FIX = new URL('../../../packages/verify/test/fixtures/', import.meta.url);
const read = (f) => JSON.parse(fs.readFileSync(new URL(f, FIX), 'utf8'));
const HEAD = read('pardal-head-honest.json');
const RECEIPT = (() => { const o = read('public/foreign-x402-muy1hh8y.json'); return o.receipt || o; })();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const PAY_TX = `0x${'ab'.repeat(32)}`;

function rehead(jws, extra) {
  const [h, p, s] = jws.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
  return `${b64({ ...header, ...extra })}.${p}.${s}`;
}

const receiptLike = {
  task_id: RECEIPT.task_id,
  payment: { rail: 'usdc', ref: `base:${PAY_TX}`, asset: 'USDC', gross_amount: '999.00', collected: true },
  schema: null,
};
const realReceiptJws = RECEIPT.issuer_signature.jws;

const SLOTS = {
  book_seq: RECEIPT.book_chain.issuer_signature.jws,
  tree_head: HEAD.issuer_signature.jws,
  x402_typ: signJws(receiptLike, { typ: 'chit402-x402-receipt+jwt' }),
  refusal_typ: signJws(receiptLike, { typ: 'chit402-refusal+jwt' }),
  other_schema: signJws({ ...receiptLike, schema: 'chit402.book_seq.v1' }),
  crit: rehead(realReceiptJws, { crit: ['b64'] }),
  b64_false: rehead(realReceiptJws, { b64: false }),
  local_crit: rehead(signJws(receiptLike), { crit: ['exp'] }),
};

function withSlot(jws) {
  const r = structuredClone(RECEIPT);
  r.issuer_signature = { ...r.issuer_signature, jws };
  r.payment = { ...(r.payment || {}), ref: `base:${PAY_TX}`, gross_amount: '999.00' };
  return r;
}

test('control: the genuine receipt JWS is accepted', () => {
  assert.ok(decodeReceiptClaims(RECEIPT));
  assert.ok(decodeJwsPayload(realReceiptJws));
  // Same claims and key with the receipt typ are read: the refusals below are the typ/header/schema.
  assert.ok(decodeJwsPayload(signJws(receiptLike)));
});

for (const [name, jws] of Object.entries(SLOTS)) {
  test(`receipt slot holding ${name} is refused everywhere`, () => {
    const r = withSlot(jws);
    assert.equal(decodeReceiptClaims(r), null);
    const proj = signedReceiptProjection(r);
    assert.equal(proj.task_id, null);
    assert.equal(proj.payment ?? null, null);
    const v = verifyIssuerForHtml(r);
    assert.equal(v.verified, false);
    assert.ok(['typ_mismatch', 'unsupported_header', 'claims_schema_mismatch'].includes(v.reason), v.reason);

    const html = renderReceiptHtml(r, { treeHead: HEAD });
    assert.match(html, /data-outcome="invalid"/);
    assert.equal(html.includes(PAY_TX), false, 'no tx from the slot or outer copy');
    assert.equal(html.includes('999.00'), false);

    const exp = buildAuditorExport(r, { treeHead: HEAD });
    assert.equal(exp.proof_outcome, 'invalid');
    assert.equal(JSON.stringify(exp).includes(PAY_TX), false);
    assert.equal(JSON.stringify(exp).includes('999.00'), false);

    assert.equal(decodeJwsPayload(jws), null);
    const shell = toPublicShell(r);
    assert.equal(JSON.stringify(shell).includes(PAY_TX), false, 'shell shows no slot or outer tx');
    assert.equal(receiptOwnsTx(r, PAY_TX), false);

    const og = buildReceiptOgMeta(signedReceiptProjection(r));
    assert.equal(JSON.stringify(og).includes('999'), false);
    assert.equal(JSON.stringify(og).includes(PAY_TX), false);
  });
}
