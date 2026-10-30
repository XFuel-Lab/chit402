/**
 * Gateway CI hook for the v13 line codec. Discovery picks this file up with
 * the rest of test/*.test.mjs, so no workflow edit is required.
 * Checks the published slot keys, the committed vector file, and that the
 * signature algorithm byte changes C and the sigma digest.
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderLineJson } from '../../../packages/cs2-core/line/build-line.mjs';
import {
  canonicalPaymentId,
  commitments,
  decodeLine,
  encodeLine,
  slotKey,
} from '../../../packages/cs2-core/line/index.mjs';
import { SAMPLE } from '../../../packages/cs2-core/line/sample.mjs';

const PAYTO = 'c6b40c18d820237cb21ae8016f9f92a5a68f42b5bb30ae56969ff04c7a7b5e14';
const WALLET = '4ccc2ec4ceae1ff0046f133bb181b6d489d16271e113279784f446e081f0de9b';

test('cs2 line codec vectors verify (gateway CI hook)', () => {
  assert.equal(slotKey({ kind: 0x01, chainId: 8453, id: '11'.repeat(20) }).hex, PAYTO);
  assert.equal(slotKey({ kind: 0x02, chainId: 8453, id: '11'.repeat(20) }).hex, WALLET);

  const vectorUrl = new URL('../../../packages/cs2-core/vectors/line.json', import.meta.url);
  const committed = readFileSync(vectorUrl, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(renderLineJson().replace(/\r\n/g, '\n'), committed);
  const doc = JSON.parse(committed);
  assert.equal(doc.schema, 'chit402.cs2.line.v1');
  assert.equal(doc.slot_keys[0].key_hex, PAYTO);
  assert.equal(doc.slot_keys[1].key_hex, WALLET);
  assert.equal(doc.header_hex, '6332');

  const base = commitments(SAMPLE);
  const flipped = commitments({ ...SAMPLE, sigma: { ...SAMPLE.sigma, alg: 2 } });
  assert.equal(base.ok, true);
  assert.equal(flipped.ok, true);
  assert.notEqual(flipped.hex.C, base.hex.C);
  assert.notEqual(flipped.hex.sigmaDigest, base.hex.sigmaDigest);

  assert.equal(canonicalPaymentId({ ...SAMPLE.payment, blockHash: undefined }).reason, 'missing_block_hash');
  assert.equal(canonicalPaymentId({ ...SAMPLE.payment, blockHash: '00'.repeat(32) }).reason, 'missing_block_hash');
  const padded = Uint8Array.from(encodeLine(SAMPLE).line);
  padded[803] = 1;
  assert.equal(decodeLine(padded).reason, 'bad_padding');
});
