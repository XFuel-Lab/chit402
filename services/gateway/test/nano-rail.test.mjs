import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatXno,
  multiplyDecimal,
  parseNanoIngest,
  verifyNanoSend,
  normalizeNanoHash,
} from '../src/nano-rail.js';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'nano');
const NANO_SEND = JSON.parse(readFileSync(join(fixtureDir, 'block_info_324B1CED.json'), 'utf8'));
const NANO_HASH = '324B1CED853848219956F60B43065ECF08F0AB0C35B54BA2516EBE39C4E5C19B';

test('formatXno and the Kraken product for 1 XNO', () => {
  assert.equal(formatXno('1000000000000000000000000000000'), '1');
  assert.equal(formatXno('1500000000000000000000000000000'), '1.5');
  assert.equal(multiplyDecimal('1', '0.80'), '0.8');
  assert.equal(multiplyDecimal('1.5', '0.80'), '1.2');
});

test('parseNanoIngest requires hash, recipient, raw amount, and a description', () => {
  const bad = parseNanoIngest({ nano: { block: 'abcd', recipient: 'nano_x', amount: '1', description: 'x' } });
  assert.equal(bad.ok, false);
  const missing = parseNanoIngest({
    nano: {
      block: NANO_HASH,
      recipient: NANO_SEND.contents.link_as_account,
      amount: NANO_SEND.amount,
    },
  });
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /description/i);
  assert.equal(parseNanoIngest({ foreign_invoice: { network: 'base', amount: '1' } }), null);
  assert.equal(normalizeNanoHash(`nano:${NANO_HASH.toLowerCase()}`), NANO_HASH);
});

test('fewer than two Nano RPCs fails closed', async () => {
  const result = await verifyNanoSend({
    hash: NANO_HASH,
    recipient: NANO_SEND.contents.link_as_account,
    amountRaw: NANO_SEND.amount,
  }, {
    rpcUrls: ['http://only-one.test'],
    fetchImpl: async () => { throw new Error('should not be called'); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.match(result.message, /two public/i);
});
