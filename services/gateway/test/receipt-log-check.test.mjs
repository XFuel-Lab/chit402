/**
 * Page-side log check: tree head typ and signature, inclusion from the signed
 * task id, anchor against gateway records (issuer_record, never checked
 * on-chain here), and the three-way outcome.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import {
  checkReceiptLog, checkTreeHeadJws, receiptOutcome,
} from '../src/receipt-log-check.js';
import { decodeReceiptClaims, renderReceiptHtml, buildAuditorExport, UNSIGNED_DETAILS_NOTE } from '../src/receipt.js';

const FIX = new URL('../../../packages/verify/test/fixtures/', import.meta.url);
const read = (f) => JSON.parse(fs.readFileSync(new URL(f, FIX), 'utf8'));
const HEAD = read('pardal-head-honest.json');
const RECEIPT = (() => { const o = read('public/foreign-x402-muy1hh8y.json'); return o.receipt || o; })();
const PROD_KEY = {
  kty: 'EC', crv: 'P-256', x: '_H7J9niXF2tez_MnF25pnrDN7iJ_VC9gBzYYW9gzSPk',
  y: 'jiorfRc9wtNaRmaFHsQaXNzcWteUA0RnpvD4SWdVl34', kid: 'IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q', alg: 'ES256', use: 'sig',
};
const JWKS = { keys: [PROD_KEY] };
const OK_RECORD = () => ({ source: 'anchor_state', tx: HEAD.anchors.base.tx, chain_id: 8453, confirmed: true });
const claims = decodeReceiptClaims(RECEIPT);

test('head and inclusion checked; a matching gateway record is issuer_record, counted as couldn\'t check', () => {
  const log = checkReceiptLog(RECEIPT, claims, { jwks: JWKS, treeHead: HEAD, anchorRecord: OK_RECORD });
  assert.equal(log.head.state, 'checked');
  assert.equal(log.inclusion.state, 'checked');
  assert.equal(log.inclusion.root, HEAD.root);
  assert.equal(log.anchor.state, 'issuer_record');
  assert.equal(log.anchor.tx, HEAD.anchors.base.tx);
  assert.equal(receiptOutcome({ verified: true, reason: 'verified' }, log), 'couldnt_check');
});

test('tree head must carry typ chit402-tree-head+jwt and verify', () => {
  const [h, p, sig] = HEAD.issuer_signature.jws.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
  const wrongTyp = `${Buffer.from(JSON.stringify({ ...header, typ: 'chit402-receipt+jwt' })).toString('base64url')}.${p}.${sig}`;
  assert.equal(checkTreeHeadJws(wrongTyp, JWKS).reason, 'tree_head_typ');
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  payload.root = 'aa'.repeat(32);
  const forged = `${h}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${sig}`;
  assert.equal(checkTreeHeadJws(forged, JWKS).state, 'failed');
  assert.equal(checkTreeHeadJws(HEAD.issuer_signature.jws, { keys: [] }).state, 'couldnt_check');
  const otherKid = { keys: [{ ...PROD_KEY, kid: 'another-kid' }] };
  const wk = checkTreeHeadJws(HEAD.issuer_signature.jws, otherKid);
  assert.equal(wk.state, 'failed');
  assert.equal(wk.reason, 'kid_mismatch');
  for (const extra of [{ crit: ['b64'] }, { b64: false }, { crit: ['b64'], b64: false }]) {
    const h2 = Buffer.from(JSON.stringify({ ...header, ...extra })).toString('base64url');
    const r = checkTreeHeadJws(`${h2}.${p}.${sig}`, JWKS);
    assert.equal(r.state, 'failed');
    assert.equal(r.reason, 'unsupported_header');
  }
  assert.equal(checkTreeHeadJws(null, JWKS).state, 'couldnt_check');
});

test('a wrong row hash or proof fails; a missing proof or head could not be checked', () => {
  const badRow = structuredClone(RECEIPT);
  badRow.book_chain.row_hash = 'bb'.repeat(32);
  assert.equal(checkReceiptLog(badRow, claims, { jwks: JWKS, treeHead: HEAD }).inclusion.state, 'failed');
  const badProof = structuredClone(RECEIPT);
  badProof.inclusion.proof[0].hash = 'cc'.repeat(32);
  assert.equal(checkReceiptLog(badProof, claims, { jwks: JWKS, treeHead: HEAD }).inclusion.state, 'failed');
  const noProof = structuredClone(RECEIPT);
  delete noProof.inclusion;
  assert.equal(checkReceiptLog(noProof, claims, { jwks: JWKS, treeHead: HEAD }).inclusion.state, 'couldnt_check');
  assert.equal(checkReceiptLog(RECEIPT, claims, { jwks: JWKS }).inclusion.state, 'couldnt_check');
});

test('anchor: a record for another tx fails; no record could not be checked', () => {
  const other = () => ({ source: 'anchor_state', tx: `0x${'11'.repeat(32)}`, chain_id: 8453, confirmed: true });
  assert.equal(checkReceiptLog(RECEIPT, claims, { jwks: JWKS, treeHead: HEAD, anchorRecord: other }).anchor.state, 'failed');
  const none = checkReceiptLog(RECEIPT, claims, { jwks: JWKS, treeHead: HEAD, anchorRecord: () => null });
  assert.equal(none.anchor.state, 'couldnt_check');
  assert.equal(receiptOutcome({ verified: true, reason: 'verified' }, none), 'couldnt_check');
  const unconfirmed = () => ({ ...OK_RECORD(), confirmed: false });
  assert.equal(checkReceiptLog(RECEIPT, claims, { jwks: JWKS, treeHead: HEAD, anchorRecord: unconfirmed }).anchor.state, 'couldnt_check');
});

test('three-way outcome', () => {
  const ok = { state: 'checked' };
  const all = { head: ok, inclusion: ok, anchor: ok };
  assert.equal(receiptOutcome({ verified: false, reason: 'signature_invalid' }, all), 'invalid');
  assert.equal(receiptOutcome({ verified: false, reason: 'key untrusted' }, all), 'couldnt_check');
  assert.equal(receiptOutcome({ verified: true }, { ...all, inclusion: { state: 'failed' } }), 'invalid');
  assert.equal(receiptOutcome({ verified: true }, { ...all, anchor: { state: 'couldnt_check' } }), 'couldnt_check');
  assert.equal(receiptOutcome({ verified: true }, all), 'verified');
});

test('page and export show checked values only, plus the unsigned-details line', () => {
  const html = renderReceiptHtml(RECEIPT, { treeHead: HEAD, anchorRecord: OK_RECORD });
  assert.match(html, /data-log-part="inclusion" data-log-state="checked">checked</);
  assert.match(html, /data-log-part="anchor" data-log-state="issuer_record">matches issuer record, not checked on-chain</);
  assert.equal(/data-outcome="verified"/.test(html), false, 'anchor is never checked in this build');
  assert.ok(html.includes(HEAD.anchors.base.tx));
  assert.ok(html.includes(UNSIGNED_DETAILS_NOTE.replace(/'/g, '&#39;')) || html.includes(UNSIGNED_DETAILS_NOTE));
  const bare = renderReceiptHtml(RECEIPT, { anchorRecord: () => null });
  assert.match(bare, /data-log-part="inclusion" data-log-state="couldnt_check">couldn't check</);
  assert.equal(bare.includes(RECEIPT.inclusion.root), false, 'unchecked root is never shown');
  assert.equal(bare.includes(RECEIPT.inclusion.anchor_tx), false, 'unchecked anchor tx is never shown');
  const exp = buildAuditorExport(RECEIPT, { treeHead: HEAD, anchorRecord: OK_RECORD });
  assert.equal(exp.proof_outcome, 'couldnt_check');
  assert.equal(exp.log_check.anchor.state, 'issuer_record');
  assert.equal(exp.log_check.anchor.tx, HEAD.anchors.base.tx);
});
