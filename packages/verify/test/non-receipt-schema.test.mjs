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

// N5: an allowlist, not a denylist. Every other chit402 schema, and case,
// space and separator variants of the listed ones, are refused by schema.
const MORE = [
  'chit402.tree_head.v1',
  'chit402.tree_head.v2',
  'chit402.tree_epoch.v1',
  'chit402.issuer_history.v1',
  'chit402.public_receipt.v1',
  'chit402.guardian_set.v1',
  'chit402.issuer_key_pin.v1',
  'chit402.supersession.v1',
  'chit402.version_windows.v1',
  'chit402.legacy_allowlist.v1',
  'chit402.book_audit.v1',
  'chit402.receipt_lane.v1',
  'chit402.consistency.v1',
  'chit402.receipt_shell.v1',
  'Chit402.quarantine_list.v1',
  'CHIT402.QUARANTINE_LIST.V1',
  ' chit402.quarantine_list.v1',
  '\tchit402.quarantine_list.v1',
  'chit402.quarantine-list.v1',
  'chit402..quarantine_list.v1',
  'chit402:quarantine_list.v1',
  'chit402',
  'Chit402.foreign_payout.v1',
  ' chit402.foreign_payout.v1',
  // Non-ASCII and control or format characters are refused before the allowlist.
  '\u200bchit402.tree_head.v1',
  '\u200cchit402.tree_head.v1',
  '\u200dchit402.tree_head.v1',
  '\u2060chit402.tree_head.v1',
  '\ufeffchit402.tree_head.v1',
  '\u00adchit402.tree_head.v1',
  '\u202echit402.tree_head.v1',
  '\u00a0chit402.tree_head.v1',
  '\u3000chit402.tree_head.v1',
  'chit402\u0130.x',
  'chit402.foreign_payout.v1\u200b',
  'chit402.foreign_payout.v1\u0000',
  '\u0000chit402.tree_head.v1',
  '\u007fchit402.tree_head.v1',
  'xfuel.receipt.v4\u200b',
  '\u0441hit402.tree_head.v1',
  'chit402.tree_head.v1\n',
  // N-E1 (646): the ASCII rule on its own, with no chit402 prefix for the trimmed rule to see.
  'xfuel.receipt.v4\n',
  'x\nchit402.tree_head.v1',
  'xfuel.receipt.v4\t',
];

for (const schema of MORE) {
  test(`allowlist: signed schema ${JSON.stringify(schema)} is not a receipt`, async () => {
    const out = await verifyReceipt(signed({ ...claims, schema }), OPTS);
    assert.equal(out.overall, 'failed');
    assert.ok(out.errors.some((e) => e === `signed payload is not a receipt (schema ${schema})`), out.errors.join('; '));
    assert.notEqual(out.verdict.exit_code, 0);
  });
}

test('allowlist: the receipt schemas are not refused by schema', async () => {
  for (const schema of ['chit402.foreign_payout.v1', 'xfuel.receipt.v4', 'chit402x.other.v1', 'receipt.v7', '']) {
    const out = await verifyReceipt(signed({ ...claims, schema }), OPTS);
    assert.ok(!out.errors.some((e) => /not a receipt \(schema/.test(e)), `${schema}: ${out.errors.join('; ')}`);
  }
  const none = await verifyReceipt(signed(claims), OPTS);
  assert.ok(!none.errors.some((e) => /not a receipt/.test(e)));
});
