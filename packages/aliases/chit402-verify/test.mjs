/**
 * Basic smoke test for chit402-verify re-exports.
 * Run: node test.mjs
 */
import assert from 'node:assert';

// Test ESM re-exports
const verify = await import('./index.js');

assert.ok(verify.verifyBinding, 'verifyBinding should be exported');
assert.ok(verify.verifyReceipt, 'verifyReceipt should be exported');
assert.ok(verify.verifyNullifier, 'verifyNullifier should be exported');
assert.ok(verify.computePaymentCommitment, 'computePaymentCommitment should be exported');
assert.ok(verify.verifyIssuerSignature, 'verifyIssuerSignature should be exported');
assert.ok(verify.ZK_VERIFIER_ADDRESS, 'ZK_VERIFIER_ADDRESS should be exported');
assert.ok(verify.BASE_RPC_URL, 'BASE_RPC_URL should be exported');

console.log('✓ chit402-verify re-exports verified');
