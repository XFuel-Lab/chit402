/**
 * Basic smoke test for chit402-sdk re-exports.
 * Run: node test.mjs
 */
import assert from 'node:assert';

// Test ESM re-exports
const sdk = await import('./index.mjs');

assert.ok(sdk.XFuelClient, 'XFuelClient should be exported');
assert.ok(sdk.Chit402Client, 'Chit402Client alias should be exported');
assert.strictEqual(sdk.Chit402Client, sdk.XFuelClient, 'Chit402Client should be the same as XFuelClient');
assert.ok(sdk.DEFAULT_BASE_URL, 'DEFAULT_BASE_URL should be exported');
assert.ok(sdk.PUBLIC_DEMO_API_KEY, 'PUBLIC_DEMO_API_KEY should be exported');
assert.ok(sdk.XFuelApiError, 'XFuelApiError should be exported');
assert.ok(sdk.selectAccept, 'selectAccept should be exported');
assert.ok(sdk.verifyReceiptSignature, 'verifyReceiptSignature should be exported');

// Test default export
assert.ok(sdk.default, 'default export should exist');

console.log('✓ chit402-sdk re-exports verified');
