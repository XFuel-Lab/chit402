/**
 * Signed issuer documents that are not receipts never verify as one, even
 * under the receipt typ and a matching task_id. Synthetic test key only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { syntheticIssuerKey } from './fixtures/slot-typing/synthetic-key.mjs';

const { verifyReceipt } = await import('../dist/index.js');
const KEY = syntheticIssuerKey();
const OPTS = { trustedKids: [KEY.kid], skipIssuerHistory: true };

const source = JSON.parse(readFileSync(new URL('./fixtures/chit-5d775d12.v7.json', import.meta.url), 'utf8'));
const claims = JSON.parse(Buffer.from(source.issuer_signature.jws.split('.')[1], 'base64url').toString('utf8'));

function signed(payload, typ = 'chit402-receipt+jwt') {
  const header = { alg: 'ES256', typ, kid: KEY.kid };
  const input = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
  const sig = sign('sha256', Buffer.from(input), { key: KEY.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const receipt = JSON.parse(JSON.stringify(source));
  receipt.issuer_signature = { ...source.issuer_signature, jws: `${input}.${sig}`, kid: KEY.kid, issuer_jwk: KEY.publicJwk };
  delete receipt.verify_url;
  return receipt;
}

const SCHEMAS = [
  'chit402.quarantine_list.v1',
  'chit402.quarantine_ack.v1',
  'chit402.tree_head_eip712.v1',
  'chit402.receipt_binding_eip712.v1',
];

test('control: the re-signed receipt is not refused as a non-receipt', async () => {
  const out = await verifyReceipt(signed(claims), OPTS);
  assert.equal(out.issuer_signature.valid, true);
  assert.ok(!out.errors.some((e) => /not a receipt/.test(e)), out.errors.join('; '));
  assert.notEqual(out.overall, 'failed', out.errors.join('; '));
});

for (const schema of SCHEMAS) {
  test(`a signed ${schema} document does not pass as a receipt`, async () => {
    const out = await verifyReceipt(signed({ ...claims, schema }), OPTS);
    assert.equal(out.overall, 'failed');
    assert.ok(out.errors.some((e) => e === `signed payload is not a receipt (schema ${schema})`), out.errors.join('; '));
    assert.notEqual(out.verdict.exit_code, 0);
  });
}

test('a quarantine list under its own typ is refused in the receipt slot', async () => {
  const list = { schema: 'chit402.quarantine_list.v1', version: 1, seq: 1, task_id: claims.task_id };
  const out = await verifyReceipt(signed(list, 'chit402-quarantine-list+jwt'), OPTS);
  assert.notEqual(out.issuer_signature.valid, true);
  assert.notEqual(out.overall, 'verified');
  assert.notEqual(out.verdict.exit_code, 0);
});
