import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { renderReceiptHtml, buildAuditorExport, displayReceiptView, redactPublicReceipt } from '../src/receipt.js';
import { buildReceiptOgMeta } from '../src/receipt-og-meta.js';
import { toPublicShell, renderReceiptShellHtml } from '../src/receipt-shell.js';

const FIX = new URL('../../../packages/verify/test/fixtures/public/', import.meta.url);
const load = (name) => {
  const o = JSON.parse(fs.readFileSync(new URL(name, FIX), 'utf8'));
  return o.receipt && o.receipt.issuer_signature ? o.receipt : o;
};
const REAL = ['chit-1ebc5616.json', 'chit-39af100b.json', 'foreign-x402-muy1hh8y.json'];
const BAD_TX = `0x${'ee'.repeat(32)}`;
const MARKERS = ['eeeeeeee', 'tfuel', 'ethereum', '4321', '4322', '333333', 'etherscan'];

function tamper(r) {
  const t = structuredClone(r);
  t.payment = {
    ...(t.payment || {}),
    ref: `base:${BAD_TX}`,
    rail: 'tfuel',
    network: 'ethereum',
    chain: 'ethereum',
    fee_bps: 4321,
    protocol_fee_bps: 4321,
    platform_fee: '4322',
    platform_fee_bps: 4322,
    explorer_url: `https://etherscan.io/tx/${BAD_TX}`,
    accounting: { internal_breakdown: { route_margin_bps: 4321, route_margin_amount: '333333' } },
  };
  t.payment_meta = { ...(t.payment_meta || {}), network: 'ethereum' };
  return t;
}

function surfaces(r) {
  const shell = toPublicShell(r);
  const exp = buildAuditorExport(r);
  delete exp.generated_at;
  delete exp.policy; // default policy lists allowed rail names
  return {
    page: renderReceiptHtml(r),
    og: JSON.stringify(buildReceiptOgMeta(r, displayReceiptView(redactPublicReceipt(r)))),
    shell: JSON.stringify(shell),
    shellHtml: renderReceiptShellHtml(shell),
    export: JSON.stringify(exp),
  };
}

for (const name of REAL) {
  test(`tampered outer ref/rail/network/fees/accounting never render: ${name}`, () => {
    const clean = surfaces(load(name));
    for (const [k, v] of Object.entries(clean)) {
      for (const m of MARKERS) assert.ok(!v.toLowerCase().includes(m), `${name} ${k} already contains ${m}`);
    }
    const bad = surfaces(tamper(load(name)));
    for (const [k, v] of Object.entries(bad)) {
      for (const m of MARKERS) assert.ok(!v.toLowerCase().includes(m), `${name} ${k} shows tampered ${m}`);
    }
    assert.equal(bad.page, clean.page, `${name} page changed under outer tamper`);
    assert.equal(bad.export, clean.export, `${name} export changed under outer tamper`);
  });
}

test('signed Base USDC contract renders as USDC without uppercasing', () => {
  const html = renderReceiptHtml(load('foreign-x402-muy1hh8y.json'));
  assert.match(html, /base \/ USDC/);
  assert.doesNotMatch(html, /0X833589FCD6EDB6E08F4C7C32D4F71B54BDA02913/);
});

test('auditor export reports unsigned when fee or rail is not signed', () => {
  const r = load('chit-1ebc5616.json');
  const parts = r.issuer_signature.jws.split('.');
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  delete claims.payment.protocol_fee_bps;
  delete claims.payment.fee_bps;
  delete claims.payment.accounting;
  r.issuer_signature.jws = `${parts[0]}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${parts[2]}`;
  r.payment = { ...(r.payment || {}), fee_bps: 50, protocol_fee_bps: 50 };
  const exp = buildAuditorExport(r);
  assert.equal(exp.checks.fee_bps_within_cap, 'unsigned');
  assert.equal(exp.in_policy, 'unsigned');
  assert.equal(exp.totals.fee_bps, null);
});
