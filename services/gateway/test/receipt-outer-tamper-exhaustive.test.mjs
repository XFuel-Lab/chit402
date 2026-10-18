/**
 * Exhaustive outer-field tamper: for real public receipts, change every outer
 * leaf one at a time (strings, numbers, nulls, flipped booleans) and inject
 * absent keys that renderers have read. No rendered output may change:
 * holder/foreign page, share meta, og card, shell JSON and HTML, auditor export
 * and its HTML. Only the issuer JWS is trusted.
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
  '': 'status proof_outcome verify_url claim_id kind source evidence foreign_x402 verified_with privacy lineage refund attestation_note usage created_at receipt_id',
};

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
function render(r) {
  const c = () => structuredClone(r);
  const out = {};
  const t = (k, f) => { try { out[k] = norm(f()); } catch (e) { out[k] = `ERR ${e.message}`; } };
  t('page', () => renderReceiptHtml(c()));
  t('share', () => {
    const p = signedReceiptProjection(redactPublicReceipt(c()));
    return JSON.stringify(buildReceiptOgMeta(p, displayReceiptView(p)));
  });
  t('og', () => buildReceiptOgSvg(c()));
  t('shell', () => JSON.stringify(toPublicShell(c())));
  t('shellHtml', () => renderReceiptShellHtml(toPublicShell(c()), { publicBaseUrl: 'https://chit402.com' }));
  t('export', () => { const e = buildAuditorExport(c()); delete e.generated_at; return JSON.stringify(e); });
  t('exportHtml', () => renderAuditorHtml(buildAuditorExport(c())));
  return out;
}

let walked = 0;
let injected = 0;
for (const id of Object.keys(RECEIPTS)) {
  test(`no outer leaf or injected key changes any rendered output: ${id}`, () => {
    const orig = load(id);
    const base = render(orig);
    for (const [k, v] of Object.entries(base)) assert.ok(!v.startsWith('ERR'), `${id} ${k} ${v}`);
    const leaks = [];
    const check = (label, r) => {
      const out = render(r);
      for (const k of Object.keys(out)) if (out[k] !== base[k]) leaks.push(`${label} -> ${k}`);
    };
    leaves(orig).forEach((p, i) => {
      walked += 1;
      const r = structuredClone(orig);
      setPath(r, p, sentinel(getPath(orig, p), i));
      check(p.join('.'), r);
    });
    let i = 0;
    for (const [blk, keys] of Object.entries(INJECT)) {
      for (const k of keys.split(' ')) {
        const p = blk ? [blk, k] : [k];
        if (getPath(orig, p) !== undefined) continue;
        injected += 1; i += 1;
        const r = structuredClone(orig);
        if (blk && (r[blk] == null || typeof r[blk] !== 'object')) r[blk] = {};
        setPath(r, p, sentinel(/amount|bps|units|usd|actual|estimated|quoted/.test(k) ? '1' : 's', 9000 + i));
        check(`${p.join('.')}(inject)`, r);
      }
    }
    assert.deepEqual(leaks, [], `${id}: ${leaks.length} outer changes reached output`);
  });
}

test('tamper walk covered every receipt', () => {
  assert.ok(walked > 500, `walked ${walked} leaves`);
  assert.ok(injected > 100, `injected ${injected} keys`);
  console.log(`# outer tamper: ${walked} leaves walked, ${injected} keys injected`);
});
