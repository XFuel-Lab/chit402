/**
 * Exhaustive outer-field tamper: for real public receipts, change every outer
 * leaf one at a time (strings, numbers, nulls, flipped booleans) and inject
 * absent keys that renderers have read. No rendered output may change:
 * holder/foreign page, share meta, og card, shell JSON and HTML, auditor export
 * and its HTML. Only the issuer JWS is trusted.
 *
 * Proof and anchor inputs (the served inclusion proof, its tree head, the
 * row hash and carry-forward) are checked by the page. A change to one of
 * them may only move a check to 'failed' or 'couldnt_check' (and the outcome
 * to 'invalid' or 'couldnt_check'); it may never produce a different positive
 * value, and nothing outside the checked parts may change.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import {
  renderReceiptHtml, buildAuditorExport, renderAuditorHtml, displayReceiptView,
  redactPublicReceipt, signedReceiptProjection,
} from '../src/receipt.js';
import { buildReceiptOgMeta } from '../src/receipt-og-meta.js';
import { buildReceiptOgSvg } from '../src/receipt-og.js';
import { toPublicShell, renderReceiptShellHtml } from '../src/receipt-shell.js';

const FIX = new URL('../../../packages/verify/test/fixtures/', import.meta.url);
// Full receipt id -> fixture file holding that public receipt.
const RECEIPTS = {
  'foreign-x402-muy1hh8y-66555d036df8': 'public/foreign-x402-muy1hh8y.json',
  'xfuel-4d6e8331-c30f-400d-a76e-fcce0cfde209': 'chit-4d6e8331.json',
  'xfuel-1ebc5616-d9ce-4da9-b56c-847062ff6b96': 'public/chit-1ebc5616.json',
  'xfuel-5d775d12-f43a-460f-8b4a-9299b4eedf20': 'chit-5d775d12.v7.json',
  'xfuel-c5a3860d-df26-490d-ab92-8f3069dac8c8': 'slot-typing/v5-xfuel-c5a3860d.json',
  'xfuel-546baa6c-0959-4c3c-9732-4b72bdad144b': 'slot-typing/v10-xfuel-546baa6c.json',
  'xfuel-39af100b-23dd-4d86-a16b-4556ca6796af': 'public/chit-39af100b.json',
};

// Absent keys that gateway renderers have read from outer blocks.
const INJECT = {
  payment: 'rail ref asset network chain explorer explorer_url explorer_link gross_amount settled_amount net_amount fee_amount fee_bps protocol_fee_bps platform_fee platform_fee_bps fee_units fee_usd amount amount_raw amount_xno usd_estimate payTo pay_to payee payer payer_wallet payer_address sender_address quoted_amount atomicAmount txHash tx paymentRef payment_ref payment_asset collected collects_on basis floor_applied tier2_proof accounting',
  payment_meta: 'collected collects_on network chain asset ref explorer_url gross_amount payer payee basis floor_applied tier2_proof',
  stamp: 'fee_usd fee_units waived amount network rail paid_by',
  links: 'explorer self json',
  settlement: 'ref network amount gross_amount',
  caller_binding: 'payer_wallet agent_id',
  provider_cogs: 'actual estimated basis provider float_id quoted',
  fulfillment: 'authorization intent output_commitment',
  route: 'model provider chain_id message_type hub',
  route_meta: 'model provider chain_id message_type requested_model substituted',
  output: 'hash kind',
  book_chain: 'payment_ref seq act row_hash book_id',
  proof: 'outcome tier has_proof',
  binding: 'matches expected_commitment recomputed_commitment in_proof',
  inclusion: 'root tree_size leaf_index proof status head anchor_tx anchors row_hash leaf',
  carry_forward: 'status leaf_index logged_epoch',
  '': 'status proof_outcome verify_url claim_id kind source evidence foreign_x402 verified_with privacy lineage refund attestation_note usage created_at receipt_id',
};

// Production signed head (epoch 2, size 3) that covers the foreign receipt's leaf.
const HEAD = JSON.parse(fs.readFileSync(new URL('pardal-head-honest.json', FIX), 'utf8'));
const ANCHOR_OK = () => ({ source: 'anchor_state', tx: HEAD.anchors.base.tx, chain_id: 8453, confirmed: true });

// Render cases: the gateway-supplied head and anchor records, the head the
// served proof carries, and no gateway records at all.
const CASES = {
  'foreign-x402-muy1hh8y-66555d036df8': [
    { name: 'gateway-head', opts: { treeHead: HEAD, anchorRecord: ANCHOR_OK } },
    { name: 'embedded-head', opts: { anchorRecord: ANCHOR_OK }, embedHead: true },
  ],
};
const NO_RECORDS = { anchorRecord: () => null };

const isProofPath = (p) => p[0] === 'inclusion' || p[0] === 'carry_forward' || p[0] === 'row_hash'
  || p.join('.') === 'book_chain.row_hash';

function load(id) {
  const o = JSON.parse(fs.readFileSync(new URL(RECEIPTS[id], FIX), 'utf8'));
  const r = o.receipt && o.receipt.issuer_signature ? o.receipt : o;
  assert.equal(r.task_id, id);
  return r;
}

function sentinel(v, i) {
  if (typeof v === 'boolean') return !v;
  if (typeof v === 'number') return v + 7300003 + i;
  if (v === null) return `ZZT${i}Q`;
  const s = String(v);
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) return `0x5e7a${String(i).padStart(6, '0')}${'a'.repeat(30)}`;
  if (/^[a-z-]+:/.test(s)) return `${s.split(':')[0]}:0xee5e7a${String(i).padStart(6, '0')}${'b'.repeat(52)}`;
  if (/^\d+$/.test(s)) return String(7300003 + i);
  if (/^\d+\.\d+$/.test(s)) return `7${i}3.7`;
  if (/^https?:/.test(s)) return `https://zzt${i}q.evil.example/x`;
  return `ZZT${i}Q`;
}

function leaves(o, path = [], acc = []) {
  for (const k of Object.keys(o)) {
    const p = [...path, k];
    if (p.join('.') === 'issuer_signature.jws') continue;
    const v = o[k];
    if (v && typeof v === 'object') leaves(v, p, acc);
    else acc.push(p);
  }
  return acc;
}

function setPath(o, p, value) {
  let cur = o;
  for (const k of p.slice(0, -1)) {
    if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k];
  }
  cur[p.at(-1)] = value;
}
const getPath = (o, p) => p.reduce((c, k) => (c == null ? c : c[k]), o);

const norm = (s) => String(s).replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, 'T');
function render(r, opts = NO_RECORDS) {
  const c = () => structuredClone(r);
  const out = {};
  const t = (k, f) => { try { out[k] = norm(f()); } catch (e) { out[k] = `ERR ${e.message}`; } };
  t('page', () => renderReceiptHtml(c(), opts));
  t('share', () => {
    const p = signedReceiptProjection(redactPublicReceipt(c()));
    return JSON.stringify(buildReceiptOgMeta(p, displayReceiptView(p)));
  });
  t('og', () => buildReceiptOgSvg(c()));
  t('shell', () => JSON.stringify(toPublicShell(c())));
  t('shellHtml', () => renderReceiptShellHtml(toPublicShell(c()), { publicBaseUrl: 'https://chit402.com' }));
  t('export', () => { const e = buildAuditorExport(c(), opts); delete e.generated_at; return JSON.stringify(e); });
  t('exportHtml', () => renderAuditorHtml(buildAuditorExport(c(), opts)));
  return out;
}

const NEGATIVE = new Set(['failed', 'couldnt_check', 'invalid']);
const WITNESS = /<section class="card">\s*<h2>Outside witness[\s\S]*?<\/section>/;

/** Checked states and the masked remainder of every surface. */
function split(out) {
  const st = {};
  for (const m of out.page.matchAll(/data-log-part="(\w+)" data-log-state="(\w+)"/g)) st[`page.${m[1]}`] = m[2];
  const o = out.page.match(/data-outcome="(\w+)"/);
  st['page.outcome'] = o ? o[1] : null;
  const witness = (out.page.match(WITNESS) || [''])[0];
  const masked = { ...out };
  masked.page = out.page.replace(WITNESS, '<W>').replace(/<span class="badge \w+" data-outcome="\w+">[^<]*<\/span>/, '<O>');
  try {
    const e = JSON.parse(out.export);
    st['export.outcome'] = e.proof_outcome;
    for (const k of ['head', 'inclusion', 'anchor']) st[`export.${k}`] = e.log_check?.[k]?.state;
    st.exportLog = JSON.stringify(e.log_check);
    delete e.proof_outcome; delete e.log_check;
    masked.export = JSON.stringify(e);
  } catch { /* an ERR string stays as-is */ }
  masked.exportHtml = out.exportHtml.replace(/<div class="row"><span class="k">(Proof outcome|Inclusion|Tree head|Anchor)<\/span>.*?<\/div>/g, '<L>');
  return { st, witness, masked };
}

/** A proof/anchor change may only turn a check negative. */
function proofMoveProblems(base, out) {
  const a = split(base);
  const b = split(out);
  const bad = [];
  for (const k of Object.keys(a.masked)) if (a.masked[k] !== b.masked[k]) bad.push(`${k} outside checks`);
  for (const k of Object.keys(a.st)) {
    if (k === 'exportLog') continue;
    if (a.st[k] !== b.st[k] && !NEGATIVE.has(b.st[k])) bad.push(`${k} ${a.st[k]} -> ${b.st[k]}`);
  }
  const allSame = Object.keys(a.st).every((k) => a.st[k] === b.st[k]);
  if (allSame && (a.witness !== b.witness || a.st.exportLog !== b.st.exportLog)) bad.push('checked value changed');
  // A part that stayed checked keeps its checked values.
  const ea = JSON.parse(a.st.exportLog || '{}');
  const eb = JSON.parse(b.st.exportLog || '{}');
  for (const k of ['head', 'inclusion', 'anchor']) {
    if (ea[k]?.state === 'checked' && eb[k]?.state === 'checked' && JSON.stringify(ea[k]) !== JSON.stringify(eb[k])) {
      bad.push(`${k} checked value changed`);
    }
  }
  return bad;
}

const moves = { proofLeaves: 0, unchanged: 0, negative: 0 };
let walked = 0;
let injected = 0;
const runs = [];
for (const id of Object.keys(RECEIPTS)) {
  for (const c of CASES[id] || [{ name: 'no-records', opts: NO_RECORDS }]) runs.push({ id, ...c });
}
for (const { id, name, opts, embedHead } of runs) {
  test(`outer changes: ${id} (${name})`, () => {
    const orig = load(id);
    if (embedHead) orig.inclusion.head = { signature: { jws: HEAD.issuer_signature.jws } };
    const base = render(orig, opts);
    for (const [k, v] of Object.entries(base)) assert.ok(!v.startsWith('ERR'), `${id} ${k} ${v}`);
    if (CASES[id]) {
      const st = split(base).st;
      assert.equal(st['page.head'], 'checked', `${name} head`);
      assert.equal(st['page.inclusion'], 'checked', `${name} inclusion`);
      assert.equal(st['page.anchor'], 'checked', `${name} anchor`);
      assert.equal(st['export.outcome'], 'verified', `${name} outcome`);
    }
    const leaks = [];
    const check = (label, r, p) => {
      const out = render(r, opts);
      if (isProofPath(p)) {
        moves.proofLeaves += 1;
        const bad = proofMoveProblems(base, out);
        for (const b of bad) leaks.push(`${label} -> ${b}`);
        if (!bad.length) {
          if (Object.keys(out).every((k) => out[k] === base[k])) moves.unchanged += 1;
          else moves.negative += 1;
        }
        return;
      }
      for (const k of Object.keys(out)) if (out[k] !== base[k]) leaks.push(`${label} -> ${k}`);
    };
    leaves(orig).forEach((p, i) => {
      walked += 1;
      const r = structuredClone(orig);
      setPath(r, p, sentinel(getPath(orig, p), i));
      check(p.join('.'), r, p);
    });
    // Removing the proof altogether may only make the checks unavailable.
    if (orig.inclusion) {
      const r = structuredClone(orig);
      delete r.inclusion;
      check('inclusion(removed)', r, ['inclusion']);
    }
    let i = 0;
    for (const [blk, keys] of Object.entries(INJECT)) {
      for (const k of keys.split(' ')) {
        const p = blk ? [blk, k] : [k];
        if (getPath(orig, p) !== undefined) continue;
        injected += 1; i += 1;
        const r = structuredClone(orig);
        if (blk && (r[blk] == null || typeof r[blk] !== 'object')) r[blk] = {};
        setPath(r, p, sentinel(/amount|bps|units|usd|actual|estimated|quoted/.test(k) ? '1' : 's', 9000 + i));
        check(`${p.join('.')}(inject)`, r, p);
      }
    }
    assert.deepEqual(leaks, [], `${id}: ${leaks.length} outer changes reached output`);
  });
}

test('tamper walk covered every receipt', () => {
  assert.ok(walked > 500, `walked ${walked} leaves`);
  assert.ok(injected > 100, `injected ${injected} keys`);
  assert.ok(moves.negative > 0, 'some proof changes moved a check');
  console.log(`# outer tamper: ${walked} leaves walked, ${injected} keys injected, ${runs.length} runs; proof/anchor inputs: ${moves.proofLeaves} (unchanged ${moves.unchanged}, moved negative ${moves.negative})`);
});
