/**
 * The published anchor-wallet list names the epoch-1 production wallets.
 * It does not change the epoch record.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PINNED_BASE_ANCHOR_WALLET,
  PINNED_SOLANA_ANCHOR_FEE_PAYER,
  PINNED_SOLANA_ANCHOR_FEE_PAYERS,
  currentAnchorWallets,
  resetAnchorWalletCache,
} from '../src/anchor-wallets.js';
import { getJwks, verifyJwsWithJwks } from '../src/issuer-key.js';
import { EPOCH1_FINAL_ROOT, EPOCH2_OPENING_ROOT, epochRecordClaims } from '../src/receipt-log-epoch.js';

test('anchor wallets pin the confirmed epoch-1 sender and fee payer', async () => {
  resetAnchorWalletCache();
  const doc = await currentAnchorWallets({
    ...process.env,
    RECEIPT_ANCHOR_PRIVATE_KEY: '',
    RECEIPT_ANCHOR_FROM: '',
    SOLANA_ANCHOR_SECRET_KEY: '',
    SOLANA_ANCHOR_FEE_PAYER: '',
  });
  assert.deepEqual(doc.base, [PINNED_BASE_ANCHOR_WALLET]);
  assert.deepEqual(doc.solana, [...PINNED_SOLANA_ANCHOR_FEE_PAYERS]);
  assert.equal(doc.issuer_root, null);
  assert.equal(doc.dns, null);
  assert.equal(doc.schema, 'chit402.anchor_wallets.v1');
  const verified = verifyJwsWithJwks(doc.issuer_signature.jws, getJwks());
  assert.equal(verified.valid, true);
  assert.equal(verified.payload.schema, 'chit402.anchor_wallets.v1');
  assert.deepEqual(verified.payload.base, [PINNED_BASE_ANCHOR_WALLET]);
  assert.equal(verified.payload.issuer_root, null);
  assert.equal(verified.payload.dns, null);
  const again = await currentAnchorWallets({
    ...process.env,
    RECEIPT_ANCHOR_PRIVATE_KEY: '',
    RECEIPT_ANCHOR_FROM: '',
    SOLANA_ANCHOR_SECRET_KEY: '',
    SOLANA_ANCHOR_FEE_PAYER: '',
  });
  assert.equal(again.issuer_signature.jws, doc.issuer_signature.jws);
  const record = epochRecordClaims();
  assert.equal(record.epochs[0].final_root, EPOCH1_FINAL_ROOT);
  assert.equal(record.epochs[1].opening_root, EPOCH2_OPENING_ROOT);
  assert.equal(JSON.stringify(record.epochs).includes('fee_payer'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(record, 'fee_payer'), false);
});

test('rotation: claims carry both pinned Solana payers without env', async () => {
  const m = await import('../src/anchor-wallets.js');
  const c = m.anchorWalletClaims({});
  assert.equal(c.solana[0], 'BHTnbPu6UZ7zQZ7Qpkpz4LcUQbMN73YDsMtvaNXpEioD');
  assert.ok(c.solana.includes('8ef3GtYNuQ6P2ANxLMPUXTAo9BhfJJqMx6cdDVh7JM4U'));
});
