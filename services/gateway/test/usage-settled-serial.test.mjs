/** Concurrent writers keep a gapless seq and one row per payment ref (async signer). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { UsageSettledLedger, recordCollectedSpend } = await import('../src/usage-settled.js');
const { AgentRegistry } = await import('../src/agent-registry.js');
const { initIssuerSigner, _setIssuerSignerForTest } = await import('../src/issuer-signer.js');
const paid = (t, r) => ({ schema: 'xfuel.receipt.v4', task_id: t, status: 'completed', payment: { rail: 'usdc', ref: r, collected: true, gross_amount: '2000' }, route: { model: 'xfuel/auto', hub: 'mock' } });

for (const slow of [false, true]) {
  test(`concurrent appends are serialized (${slow ? 'slow signer' : 'env signer'})`, async () => {
    _setIssuerSignerForTest(null);
    const base = await initIssuerSigner();
    if (slow) _setIssuerSignerForTest({ ...base, sign: async (b) => { await new Promise((r) => setTimeout(r, 5)); return base.sign(b); } });
    try {
      const ledger = new UsageSettledLedger();
      const registry = new AgentRegistry();
      const a = (await recordCollectedSpend(paid('r0', 'base:0xr0'), { ledger, registry })).agent_id;
      await Promise.allSettled([['r1', 'base:0xr1'], ['r2', 'base:0xr2'], ['dup', 'base:0xdup'], ['dup', 'base:0xdup']]
        .map(([t, r]) => recordCollectedSpend(paid(t, r), { ledger, registry, agentId: a })));
      const rows = ledger.entries.filter((e) => e.agent_id === a);
      assert.deepEqual(rows.map((r) => r.seq), [1, 2, 3, 4]);
      assert.equal(rows.filter((r) => r.task_id === 'dup').length, 1);
      assert.equal(ledger.seqReport(a).gapless, true);
    } finally {
      _setIssuerSignerForTest(null);
    }
  });
}
