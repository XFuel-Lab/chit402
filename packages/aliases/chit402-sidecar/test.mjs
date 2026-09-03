/**
 * Basic smoke test for chit402-sidecar re-exports.
 * Run: node test.mjs
 */
import assert from 'node:assert';

// Test ESM re-exports
const sidecar = await import('./index.js');

assert.ok(sidecar.createSidecarFetch, 'createSidecarFetch should be exported');
assert.ok(sidecar.buildSidecarReceipt, 'buildSidecarReceipt should be exported');
assert.ok(sidecar.importUsageExport, 'importUsageExport should be exported');
assert.ok(sidecar.ingestToBook, 'ingestToBook should be exported');
assert.ok(sidecar.verifySidecarSignature, 'verifySidecarSignature should be exported');

console.log('✓ chit402-sidecar re-exports verified');
