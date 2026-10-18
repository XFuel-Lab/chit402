/**
 * Solana offline payer verification tests (live smoke shape).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, '..');

try {
  execSync('npm run build', { cwd: pkgDir, stdio: 'pipe' });
} catch {
  // deps may be missing in some environments
}

const {
  verifySolanaPayer,
  verifyPayerBinding,
  parseSolanaPaymentRef,
  extractUsdcTransfersFromTx,
  isSolanaBase58Pubkey,
} = await import('../dist/index.js');

const SMOKE_SIG = '2SRc9yppZtsLBJMDEiTgSMs743ZCdWmZiL1hM5FFX9x98LkTDzUx84Sxomt6bbhL4oCo6LK7j5uSjLnHPs1GVLRN';
const SMOKE_PAYER = 'E6TfVNynPrffpkssHAkLyBFcHebo4q3R631c1oT8H5mh';
const SMOKE_REF = `solana:${SMOKE_SIG}`;
const SMOKE_AMOUNT = '2000';
const SMOKE_PAYEE = '58Qo8QTJ1Sd4aXSygwAeBLNL3VrXRmfUCceB6b5RJCx6';

const smokeTx = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures/solana-smoke-tx.json'), 'utf8'),
);

const mockFetcher = async () => smokeTx;

describe('parseSolanaPaymentRef', () => {
  test('extracts signature from solana: prefix', () => {
    assert.equal(parseSolanaPaymentRef(SMOKE_REF), SMOKE_SIG);
    assert.equal(parseSolanaPaymentRef('solana:abc'), 'abc');
    assert.equal(parseSolanaPaymentRef('base:0x123'), null);
  });
});

describe('isSolanaBase58Pubkey', () => {
  test('accepts live smoke payer', () => {
    assert.equal(isSolanaBase58Pubkey(SMOKE_PAYER), true);
    assert.equal(isSolanaBase58Pubkey('0x1234'), false);
  });
});

describe('extractUsdcTransfersFromTx', () => {
  test('parses transferChecked from smoke fixture', () => {
    const transfers = extractUsdcTransfersFromTx(smokeTx);
    assert.equal(transfers.length, 1);
    assert.equal(transfers[0].authority, SMOKE_PAYER);
    assert.equal(transfers[0].amount, 2000n);
  });
});

describe('verifySolanaPayer', () => {
  test('validates live smoke shape (mocked RPC)', async () => {
    const result = await verifySolanaPayer({
      paymentRef: SMOKE_REF,
      payerWallet: SMOKE_PAYER,
      grossAmount: SMOKE_AMOUNT,
      payee: SMOKE_PAYEE,
      fetchTransaction: mockFetcher,
    });
    assert.equal(result.checked, true);
    assert.equal(result.valid, true);
    assert.equal(result.transferredAmount, '2000');
  });

  test('rejects wrong payer wallet', async () => {
    const result = await verifySolanaPayer({
      paymentRef: SMOKE_REF,
      payerWallet: '58Qo8QTJ1Sd4aXSygwAeBLNL3VrXRmfUCceB6b5RJCx6',
      grossAmount: SMOKE_AMOUNT,
      payee: SMOKE_PAYEE,
      fetchTransaction: mockFetcher,
    });
    assert.equal(result.valid, false);
    assert.match(result.reason, /payer_mismatch|no_usdc_transfer/);
  });

  test('rejects insufficient amount', async () => {
    const result = await verifySolanaPayer({
      paymentRef: SMOKE_REF,
      payerWallet: SMOKE_PAYER,
      grossAmount: '999999',
      payee: SMOKE_PAYEE,
      fetchTransaction: mockFetcher,
    });
    assert.equal(result.valid, false);
    assert.match(result.reason, /no_usdc_transfer/);
  });

  test('rejects failed transaction', async () => {
    const failedTx = { ...smokeTx, meta: { ...smokeTx.meta, err: { InstructionError: [2, 'Custom'] } } };
    const result = await verifySolanaPayer({
      paymentRef: SMOKE_REF,
      payerWallet: SMOKE_PAYER,
      grossAmount: SMOKE_AMOUNT,
      payee: SMOKE_PAYEE,
      fetchTransaction: async () => failedTx,
    });
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'transaction_failed');
  });
});

describe('verifySolanaPayer payee binding', () => {
  const OTHER = 'Vote111111111111111111111111111111111111111';
  test('a transfer from the payer to a different wallet is a payee mismatch', async () => {
    const result = await verifySolanaPayer({
      paymentRef: SMOKE_REF,
      payerWallet: SMOKE_PAYER,
      grossAmount: SMOKE_AMOUNT,
      payee: OTHER,
      fetchTransaction: mockFetcher,
    });
    assert.equal(result.checked, true);
    assert.equal(result.valid, false);
    assert.match(result.reason, /^payee_mismatch:/);
  });

  test('a legacy transfer of another token does not count as USDC to the payee', async () => {
    const junk = {
      slot: 1,
      meta: { err: null, preTokenBalances: [], postTokenBalances: [] },
      transaction: {
        signatures: [SMOKE_SIG],
        message: {
          accountKeys: [{ pubkey: SMOKE_PAYER, signer: true }],
          instructions: [{ program: 'spl-token', parsed: { type: 'transfer', info: { authority: SMOKE_PAYER, source: OTHER, destination: OTHER, amount: SMOKE_AMOUNT } } }],
        },
      },
    };
    const result = await verifySolanaPayer({
      paymentRef: SMOKE_REF,
      payerWallet: SMOKE_PAYER,
      grossAmount: SMOKE_AMOUNT,
      payee: SMOKE_PAYEE,
      fetchTransaction: async () => junk,
    });
    assert.equal(result.valid, false);
    // The legacy transfer names no USDC account, so it is not a USDC transfer at all.
    assert.match(result.reason, /^no_usdc_transfer_of_/);
  });

  test('no signed payee is unchecked, never a pass', async () => {
    const result = await verifySolanaPayer({
      paymentRef: SMOKE_REF,
      payerWallet: SMOKE_PAYER,
      grossAmount: SMOKE_AMOUNT,
      fetchTransaction: mockFetcher,
    });
    assert.equal(result.checked, false);
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'no_payee');
  });
});

describe('verifyPayerBinding', () => {
  test('routes solana payment.ref to Solana verifier', async () => {
    const result = await verifyPayerBinding(
      {
        payment: { ref: SMOKE_REF, gross_amount: SMOKE_AMOUNT, payee: SMOKE_PAYEE },
        caller_binding: { payer_wallet: SMOKE_PAYER },
      },
      { fetchSolanaTransaction: mockFetcher },
    );
    assert.equal(result.rail, 'solana');
    assert.equal(result.valid, true);
  });
});

describe('receiptPayerClaimsFromEnvelope', () => {
  test('extracts claims from issuer_signature.jws (live smoke envelope)', async () => {
    const { receiptPayerClaimsFromEnvelope } = await import('../dist/index.js');
    const receipt = {
      issuer_signature: {
        jws: [
          'eyJhbGciOiJFUzI1NiIsInR5cCI6ImNoaXQ0MDItcmVjZWlwdCtqd3QifQ',
          'eyJ0YXNrX2lkIjoieGZ1ZWwtMWE0MjJlYWEtMzhjOC00OGU4LWJjNDAtODc1ZThjMDk5YjRhIiwicGF5bWVudCI6eyJyYWlsIjoidXNkYyIsInJlZiI6InNvbGFuYToyU1JjOXlwcFp0c0xCSk1ERWlUZ1NNczc0M1pDZFdtWmlMMWhNNUZGWDl4OThMa1REelV4ODRTeG9tdDZiYmhMNG9DbzZMSzdqNXVTakxuSFBzMUdWTFJOIiwiZ3Jvc3NfYW1vdW50IjoiMjAwMCJ9LCJjYWxsZXJfYmluZGluZyI6eyJwYXllcl93YWxsZXQiOiJFNlRmVk55blByZmZwa3NzSEFrTHlCRmNIZWJvNHEzUjYzMWMxb1Q4SDVtaCJ9fQ',
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        ].join('.'),
      },
    };
    const claims = receiptPayerClaimsFromEnvelope(receipt);
    assert.equal(claims.payment.ref, SMOKE_REF);
    assert.equal(claims.payment.gross_amount, SMOKE_AMOUNT);
    assert.equal(claims.caller_binding.payer_wallet, SMOKE_PAYER);
  });
});

describe('legacy transfer mint check', () => {
  const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const FAKE_MINT = 'So11111111111111111111111111111111111111112';
  const SRC = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
  const DST = '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R';

  function legacyTx({ srcMint = USDC, dstMint = USDC, balances = true } = {}) {
    const row = (accountIndex, mint, owner, amount) => ({ accountIndex, mint, owner, uiTokenAmount: { amount } });
    return {
      slot: 1,
      meta: {
        err: null,
        preTokenBalances: balances ? [row(1, srcMint, SMOKE_PAYER, '5000'), row(2, dstMint, SMOKE_PAYEE, '0')] : [],
        postTokenBalances: balances ? [row(1, srcMint, SMOKE_PAYER, '3000'), row(2, dstMint, SMOKE_PAYEE, SMOKE_AMOUNT)] : [],
      },
      transaction: {
        signatures: [SMOKE_SIG],
        message: {
          accountKeys: [{ pubkey: SMOKE_PAYER, signer: false }, { pubkey: SRC }, { pubkey: DST }],
          instructions: [{ program: 'spl-token', parsed: { type: 'transfer', info: { authority: SMOKE_PAYER, source: SRC, destination: DST, amount: SMOKE_AMOUNT } } }],
        },
      },
    };
  }

  const run = (tx) => verifySolanaPayer({
    paymentRef: SMOKE_REF,
    payerWallet: SMOKE_PAYER,
    grossAmount: SMOKE_AMOUNT,
    payee: SMOKE_PAYEE,
    fetchTransaction: async () => tx,
  });

  test('a legacy USDC transfer from the payer passes', async () => {
    const result = await run(legacyTx());
    assert.equal(result.valid, true, result.reason);
    assert.equal(extractUsdcTransfersFromTx(legacyTx(), USDC).length, 1);
  });

  test('a legacy transfer whose source account holds another mint is not counted', async () => {
    const tx = legacyTx({ srcMint: FAKE_MINT });
    assert.equal(extractUsdcTransfersFromTx(tx, USDC).length, 0);
  });

  test('a legacy transfer whose destination holds another mint is not counted', async () => {
    const tx = legacyTx({ dstMint: FAKE_MINT });
    assert.equal(extractUsdcTransfersFromTx(tx, USDC).length, 0);
  });

  test('a legacy transfer with no readable mint is not counted and does not pass', async () => {
    const tx = legacyTx({ balances: false });
    assert.equal(extractUsdcTransfersFromTx(tx, USDC).length, 0);
    const result = await run(tx);
    assert.equal(result.valid, false);
  });

  function multisigTx(multisig) {
    const tx = legacyTx();
    const info = tx.transaction.message.instructions[0].parsed.info;
    delete info.authority;
    info.multisigAuthority = multisig;
    info.signers = ['HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH', '7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2'];
    return tx;
  }

  test('a legacy transfer whose multisig authority is the payer passes', async () => {
    const tx = multisigTx(SMOKE_PAYER);
    const parsed = extractUsdcTransfersFromTx(tx, USDC);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].authority, SMOKE_PAYER);
    const result = await run(tx);
    assert.equal(result.valid, true, result.reason);
  });

  test('a legacy transfer whose multisig authority is another account is not the payer', async () => {
    const other = 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH';
    const tx = multisigTx(other);
    // The payer is not a signer and owns no USDC account, so no fallback applies.
    tx.meta.preTokenBalances[0].owner = other;
    tx.meta.postTokenBalances[0].owner = other;
    const result = await run(tx);
    assert.equal(result.checked, true);
    assert.equal(result.valid, false);
    assert.match(result.reason, /^payer_mismatch: authority HN7c/);
  });

  test('a multisig signer listed in signers does not stand in for the multisig', async () => {
    const tx = multisigTx('HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH');
    tx.transaction.message.instructions[0].parsed.info.signers = [SMOKE_PAYER];
    tx.meta.preTokenBalances[0].owner = 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH';
    tx.meta.postTokenBalances[0].owner = 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH';
    const result = await run(tx);
    assert.equal(result.valid, false);
  });

  test('a fake-mint legacy transfer with a USDC credit elsewhere does not satisfy the payer check', async () => {
    // Payee is credited USDC by someone else; the payer only moved a fake token.
    const tx = legacyTx({ srcMint: FAKE_MINT, dstMint: FAKE_MINT });
    tx.meta.preTokenBalances.push({ accountIndex: 3, mint: USDC, owner: SMOKE_PAYEE, uiTokenAmount: { amount: '0' } });
    tx.meta.postTokenBalances.push({ accountIndex: 3, mint: USDC, owner: SMOKE_PAYEE, uiTokenAmount: { amount: SMOKE_AMOUNT } });
    tx.transaction.message.accountKeys.push({ pubkey: 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH' });
    const result = await run(tx);
    assert.equal(result.checked, true);
    assert.equal(result.valid, false);
    assert.match(result.reason, /^no_usdc_transfer_of_/);
  });
});
