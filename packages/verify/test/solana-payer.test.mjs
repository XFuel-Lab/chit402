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
    assert.match(result.reason, /^payee_mismatch:/);
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
          'sig',
        ].join('.'),
      },
    };
    const claims = receiptPayerClaimsFromEnvelope(receipt);
    assert.equal(claims.payment.ref, SMOKE_REF);
    assert.equal(claims.payment.gross_amount, SMOKE_AMOUNT);
    assert.equal(claims.caller_binding.payer_wallet, SMOKE_PAYER);
  });
});
