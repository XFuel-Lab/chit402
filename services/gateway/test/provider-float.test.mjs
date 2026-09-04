import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProviderFloatManager,
  parseFloatsJson,
  estimateCogs,
  normalizeProviderId,
  resetFloatManagerForTests,
} from '../src/provider-float.js';
import { buildReceipt, providerCogsOf, mergeReceiptView } from '../src/receipt.js';

test('parseFloatsJson loads enabled floats', () => {
  const map = parseFloatsJson(JSON.stringify({
    'theta-edgecloud': { asset: 'USDC', balance: '1000000', low_water: '100000', enabled: true },
    akash: { asset: 'ACT', balance: '0', enabled: false },
  }));
  assert.equal(map.size, 2);
  assert.equal(map.get('theta-edgecloud').balance, 1000000n);
  assert.equal(map.get('akash').enabled, false);
});

test('estimateCogs applies bps of USDC quote', () => {
  assert.equal(estimateCogs('10000', 7000), 7000n);
  assert.equal(estimateCogs('10000', 10000), 10000n);
});

test('selectForQuote prefers default float that can cover COGS', () => {
  const mgr = new ProviderFloatManager({
    floatsJson: JSON.stringify({
      'theta-edgecloud': { asset: 'USDC', balance: '100000', low_water: '1000', enabled: true },
    }),
    cogsBps: 7000,
    defaultProvider: 'theta-edgecloud',
    enforce: true,
  });
  const pick = mgr.selectForQuote('10000');
  assert.equal(pick.ok, true);
  assert.equal(pick.float.id, 'theta-edgecloud');
  assert.equal(pick.estimated, 7000n);
});

test('selectForQuote uses a real COGS estimate when given, not 70% of our price', () => {
  const mgr = new ProviderFloatManager({
    floatsJson: JSON.stringify({
      'theta-edgecloud': { asset: 'USDC', balance: '100000', low_water: '1000', enabled: true },
    }),
    cogsBps: 7000,
    defaultProvider: 'theta-edgecloud',
    enforce: true,
  });
  const pick = mgr.selectForQuote('10000', 'theta-edgecloud', { estimatedCogs: 18400n });
  assert.equal(pick.ok, true);
  assert.equal(pick.estimated, 18400n);
});

test('selectForQuote enforce rejects when exhausted', () => {
  const mgr = new ProviderFloatManager({
    floatsJson: JSON.stringify({
      'theta-edgecloud': { asset: 'USDC', balance: '100', low_water: '0', enabled: true },
    }),
    cogsBps: 7000,
    defaultProvider: 'theta-edgecloud',
    enforce: true,
  });
  const pick = mgr.selectForQuote('10000');
  assert.equal(pick.ok, false);
  assert.equal(pick.reason, 'provider_float_exhausted');
});

test('burn decrements balance and flags low water', () => {
  const mgr = new ProviderFloatManager({
    floatsJson: JSON.stringify({
      'theta-edgecloud': { asset: 'USDC', balance: '10000', low_water: '5000', enabled: true },
    }),
    enforce: true,
  });
  const r = mgr.burn('theta-edgecloud', 6000n);
  assert.equal(r.burned, '6000');
  assert.equal(r.balance, '4000');
  assert.equal(r.below_low_water, true);
});

test('normalizeProviderId maps router tags to float ids', () => {
  assert.equal(normalizeProviderId('edgecloud'), 'theta-edgecloud');
  assert.equal(normalizeProviderId('theta-edgecloud'), 'theta-edgecloud');
  assert.equal(normalizeProviderId('akash'), 'akash-network');
  assert.equal(normalizeProviderId('akash-network'), 'akash-network');
  assert.equal(normalizeProviderId('akashml'), 'akash-network');
});

test('reconcileAfterServe burns the ACTUAL provider float, not preferred', () => {
  const mgr = new ProviderFloatManager({
    floatsJson: JSON.stringify({
      'theta-edgecloud': { asset: 'USDC', balance: '100000', low_water: '1000', enabled: true },
      'akash-network': { asset: 'USDC', balance: '100000', low_water: '1000', enabled: true },
    }),
    cogsBps: 7000,
    defaultProvider: 'theta-edgecloud',
    enforce: true,
  });
  // Prefer theta at quote time…
  const pick = mgr.selectForQuote('10000', 'theta-edgecloud');
  assert.equal(pick.ok, true);
  assert.equal(pick.float.id, 'theta-edgecloud');
  // …but AkashML actually served → burn akash float.
  const { provider, record } = mgr.reconcileAfterServe({
    preferredProvider: 'theta-edgecloud',
    actualProvider: 'akash-network',
    estimated: pick.estimated,
  });
  assert.equal(provider, 'akash-network');
  assert.equal(record.provider, 'akash-network');
  assert.equal(record.float_id, 'akash-network');
  assert.equal(mgr.get('akash-network').balance, 100000n - pick.estimated);
  assert.equal(mgr.get('theta-edgecloud').balance, 100000n);
});

test('buildReceipt emits provider_cogs from task.meta', () => {
  const task = {
    taskId: 'task-float-1',
    status: 'completed',
    intent: { type: 'inference_request', paymentRail: 'usdc', amount: '10000', model: 'llama' },
    feeAmount: '50',
    netAmount: '9950',
    feeBps: 50,
    meta: {
      chain: 'base',
      provider: 'theta-edgecloud',
      providerCogs: {
        provider: 'theta-edgecloud',
        float_id: 'theta-edgecloud',
        currency: 'USDC',
        estimated: '7000',
        actual: '7000',
        usd_mark: '7000',
        below_low_water: false,
      },
    },
  };
  const cogs = providerCogsOf(task);
  assert.equal(cogs.provider, 'theta-edgecloud');
  const r = buildReceipt(task, { baseUrl: 'https://api-testnet.xfuel.app' });
  const v = mergeReceiptView(r);
  assert.equal(v.payment.rail, 'usdc');
  assert.equal(r.provider_cogs.currency, 'USDC');
  assert.equal(r.provider_cogs.decimals, 6);
  assert.equal(r.provider_cogs.unit, 'atomic_usdc');
  assert.equal(r.provider_cogs.estimated, '7000');
  assert.equal(v.route.provider, 'theta-edgecloud');
});

test('buildReceipt defaults payment rail to usdc (not tfuel)', () => {
  const r = buildReceipt({
    taskId: 't1',
    status: 'pending',
    intent: { type: 'inference_request' },
    meta: {},
  });
  assert.equal(mergeReceiptView(r).payment.rail, 'usdc');
});

test('resetFloatManagerForTests clears singleton', () => {
  resetFloatManagerForTests();
  assert.ok(true);
});
