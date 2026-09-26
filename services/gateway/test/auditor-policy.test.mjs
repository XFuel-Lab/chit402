/**
 * Auditor export: in_policy is a real failure only.
 * A normal paid receipt has no principal binding and no privacy mode.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDITOR_NO_POLICY,
  buildAuditorExport,
  renderAuditorHtml,
  rollupInPolicy,
} from '../src/receipt.js';

function paidReceipt(over = {}) {
  return {
    task_id: 'xfuel-aud-normal',
    status: 'completed',
    proof_outcome: 'not_applicable',
    verify_url: 'https://api.chit402.com/receipt/chit-aud-normal',
    payment: {
      rail: 'usdc',
      ref: 'solana:sig',
      gross_amount: '2000',
      fee_amount: '10',
      net_amount: '1990',
      fee_bps: 50,
      collected: true,
    },
    route: { model: 'akash/meta-llama/Llama-3.3-70B-Instruct', provider: 'akash' },
    binding: null,
    privacy: null,
    ...over,
  };
}

test('rollup treats no_policy and null as not a failure', () => {
  assert.equal(rollupInPolicy([true, AUDITOR_NO_POLICY, null]), true);
  assert.equal(rollupInPolicy([true, false]), false);
  assert.equal(rollupInPolicy([AUDITOR_NO_POLICY, null]), AUDITOR_NO_POLICY);
});

test('normal paid receipt with no binding is in policy', () => {
  const exp = buildAuditorExport(paidReceipt());
  assert.equal(exp.checks.fee_bps_within_cap, true);
  assert.equal(exp.checks.rail_allowed, true);
  assert.equal(exp.checks.binding_ok, 'no_policy');
  assert.equal(exp.checks.privacy_vendor_blind, 'no_policy');
  assert.equal(exp.in_policy, true);
  const html = renderAuditorHtml(exp);
  assert.match(html, /in policy/);
  assert.doesNotMatch(html, /policy check failed/);
});

test('fee over cap and a binding mismatch are real failures', () => {
  const fee = buildAuditorExport(paidReceipt({
    payment: {
      rail: 'usdc',
      fee_bps: 250,
      gross_amount: '2000',
      fee_amount: '50',
      net_amount: '1950',
    },
  }));
  assert.equal(fee.checks.fee_bps_within_cap, false);
  assert.equal(fee.in_policy, false);
  assert.match(renderAuditorHtml(fee), /policy check failed/);

  const bind = buildAuditorExport(paidReceipt({
    binding: { matches: false, expected_commitment: '0xaa', recomputed_commitment: '0xbb' },
  }));
  assert.equal(bind.checks.binding_ok, false);
  assert.equal(bind.in_policy, false);

  const okBind = buildAuditorExport(paidReceipt({
    binding: { matches: true, expected_commitment: '0xaa', recomputed_commitment: '0xaa' },
  }));
  assert.equal(okBind.checks.binding_ok, true);
  assert.equal(okBind.in_policy, true);
});

test('privacy fails only when a privacy rule applies', () => {
  const forbidden = buildAuditorExport(paidReceipt({
    privacy: { mode: 'vendor_blind' },
  }), {
    policy: {
      max_fee_bps: 100,
      allowed_rails: ['usdc'],
      private_spend_ok: false,
    },
  });
  assert.equal(forbidden.checks.privacy_vendor_blind, false);
  assert.equal(forbidden.in_policy, false);

  const required = buildAuditorExport(paidReceipt(), {
    policy: {
      max_fee_bps: 100,
      allowed_rails: ['usdc'],
      require_vendor_blind: true,
    },
  });
  assert.equal(required.checks.privacy_vendor_blind, false);
  assert.equal(required.in_policy, false);
});
