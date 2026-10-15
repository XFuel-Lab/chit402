import test from 'node:test';
import assert from 'node:assert/strict';
const t = await import('../dist/anchor-trust.js');
const OLD = 'BHTnbPu6UZ7zQZ7Qpkpz4LcUQbMN73YDsMtvaNXpEioD';
const NEW = '8ef3GtYNuQ6P2ANxLMPUXTAo9BhfJJqMx6cdDVh7JM4U';

test('pin list is append-only, old payer first', () => {
  assert.deepEqual([...t.PINNED_SOLANA_ANCHOR_FEE_PAYERS], [OLD, NEW]);
  assert.equal(t.PINNED_SOLANA_ANCHOR_FEE_PAYER, OLD);
  assert.ok(Object.isFrozen(t.PINNED_SOLANA_ANCHOR_FEE_PAYERS));
});

test('offline list (no history, no well-known) trusts both payers', () => {
  const list = t.compileAnchorWallets({});
  assert.deepEqual(list.sources, ['pin']);
  assert.ok(t.walletListed(list.solana, NEW, 'solana'), 'new-payer head passes offline');
  assert.ok(t.walletListed(list.solana, OLD, 'solana'), 'old BHTn head still passes');
  assert.ok(!t.walletListed(list.solana, '11111111111111111111111111111111', 'solana'));
});
