/**
 * Phase 4 — TEE attestation verifier tests (dev secp256k1 attestor).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import { verifyAttestation, canonicalAttestation, attestationNonce, registerAttestor } from '../src/tee-attestation.js';

const MODEL_ROOT = '0x' + 'ab'.repeat(32);
const MEASUREMENT = '0x' + 'cd'.repeat(32);

async function signedEnvelope(wallet, over = {}) {
  const env = {
    vendor: 'dev',
    measurement: MEASUREMENT,
    model_root: MODEL_ROOT,
    nonce: attestationNonce('task-1', MODEL_ROOT),
    quote: '0xdeadbeef',
    ...over,
  };
  env.signer = wallet.address;
  env.signature = await wallet.signMessage(canonicalAttestation(env));
  return env;
}

test('verifies a well-formed dev attestation bound to the task', async () => {
  const wallet = Wallet.createRandom();
  const env = await signedEnvelope(wallet);
  const res = verifyAttestation(env, {
    policy: { allowedVendors: ['dev'], allowedSigners: [wallet.address], allowedMeasurements: [MEASUREMENT] },
    expectedModelRoot: MODEL_ROOT,
    expectedNonce: attestationNonce('task-1', MODEL_ROOT),
  });
  assert.equal(res.verified, true);
  assert.equal(res.trust, 'software'); // honest: dev attestor is software trust, not hardware
  assert.equal(res.method, 'dev-secp256k1');
});

test('rejects a signer not in the allowed set', async () => {
  const wallet = Wallet.createRandom();
  const env = await signedEnvelope(wallet);
  const res = verifyAttestation(env, { policy: { allowedVendors: ['dev'], allowedSigners: [Wallet.createRandom().address] } });
  assert.equal(res.verified, false);
  assert.ok(res.reasons.some((r) => /signer not in allowedSigners/.test(r)));
});

test('rejects model_root mismatch (enclave loaded a different model)', async () => {
  const wallet = Wallet.createRandom();
  const env = await signedEnvelope(wallet);
  const res = verifyAttestation(env, {
    policy: { allowedVendors: ['dev'], allowedSigners: [wallet.address] },
    expectedModelRoot: '0x' + '99'.repeat(32),
  });
  assert.equal(res.verified, false);
  assert.ok(res.reasons.some((r) => /model_root/.test(r)));
});

test('rejects nonce mismatch (replay / not bound to task)', async () => {
  const wallet = Wallet.createRandom();
  const env = await signedEnvelope(wallet);
  const res = verifyAttestation(env, {
    policy: { allowedVendors: ['dev'], allowedSigners: [wallet.address] },
    expectedNonce: attestationNonce('other-task', MODEL_ROOT),
  });
  assert.equal(res.verified, false);
  assert.ok(res.reasons.some((r) => /nonce/.test(r)));
});

test('tampering the measurement breaks the signature', async () => {
  const wallet = Wallet.createRandom();
  const env = await signedEnvelope(wallet);
  env.measurement = '0x' + '00'.repeat(32); // tamper after signing
  const res = verifyAttestation(env, { policy: { allowedVendors: ['dev'], allowedSigners: [wallet.address] } });
  assert.equal(res.verified, false);
});

test('unwired vendor is not trusted', async () => {
  const res = verifyAttestation(
    { vendor: 'nvidia-cc', measurement: MEASUREMENT, model_root: MODEL_ROOT, quote: '0x00' },
    { policy: { allowedVendors: ['nvidia-cc'] } },
  );
  assert.equal(res.verified, false);
  assert.equal(res.trust, 'none');
  assert.ok(res.reasons.some((r) => /not wired/.test(r)));
});

test('a registered vendor attestor can verify (hardware trust)', async () => {
  registerAttestor('test-hw', () => ({ verified: true, method: 'test-hw-quote', trust: 'hardware', reasons: [] }));
  const res = verifyAttestation(
    { vendor: 'test-hw', measurement: MEASUREMENT, model_root: MODEL_ROOT },
    { policy: { allowedVendors: ['test-hw'] } },
  );
  assert.equal(res.verified, true);
  assert.equal(res.trust, 'hardware');
});
