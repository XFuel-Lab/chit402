import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  formatHit,
  isTestFixture,
  scanContent,
} from './check-public-identifiers.mjs';

const bip39 = readFileSync(new URL('./bip39-english.txt', import.meta.url), 'utf8')
  .trim()
  .split(/\r?\n/);

const phrase12 = bip39.slice(0, 12).join(' ');
const phrase24 = bip39.slice(0, 24).join(' ');
const secretName = ['aws', 'secret', 'access', 'key'].join('_');
const secretValue = 'B'.repeat(40);
const accessKey = ['AK', 'IA'].join('') + 'IOSFODNN7EXAMPLE';
const badIp = ['10', '1', '2', '3'].join('.');
const docIp = ['192', '0', '2', '10'].join('.');
const loopback = ['127', '0', '0', '1'].join('.');
const accountId = '1'.repeat(12);
const serverPath = ['/home', 'ubuntu', 'app'].join('/');

function rules(hits) {
  return hits.map((hit) => hit.rule);
}

test('ipv4 allowlist keeps documentation, loopback, and any-address', () => {
  const text = [`${docIp}`, `${loopback}`, '0.0.0.0'].join('\n');
  assert.deepEqual(scanContent('deploy/readme.md', text), []);
});

test('ipv4 outside the allowlist is reported without the value', () => {
  const hits = scanContent('deploy/readme.md', `host ${badIp}\n`);
  assert.deepEqual(rules(hits), ['ipv4']);
  assert.equal(hits[0].line, 1);
  assert.equal(Object.hasOwn(hits[0], 'value'), false);
  assert.equal(formatHit(hits[0]).includes(badIp), false);
});

test('rfc section numbers are not addresses', () => {
  const section = 'RFC 9162 §2.1.3.2 inclusion';
  assert.deepEqual(scanContent('docs/product/receipt-merkle.md', section), []);
});

test('ipv4 in a test fixture is allowed', () => {
  assert.equal(isTestFixture('packages/verify/test/fixtures/sample.json'), true);
  assert.deepEqual(scanContent('services/gateway/test/prover.test.mjs', badIp), []);
});

test('aws account id next to arn or account is reported', () => {
  const arn = scanContent('deploy/task.json', `arn:aws:iam::${accountId}:role/x\n`);
  assert.deepEqual(rules(arn), ['aws-account']);
  const acct = scanContent('README.md', `account ${accountId}\n`);
  assert.deepEqual(rules(acct), ['aws-account']);
  const hex = `0x${'0'.repeat(40)} account\n`;
  assert.deepEqual(scanContent('README.md', hex), []);
  assert.equal(formatHit(arn[0]).includes(accountId), false);
});

test('server home path is reported', () => {
  const hits = scanContent('docs/ops.md', `cd ${serverPath}\n`);
  assert.deepEqual(rules(hits), ['server-path']);
  assert.equal(formatHit(hits[0]).includes(serverPath), false);
});

test('aws secret and access key ids are reported', () => {
  const secretHits = scanContent('deploy/notes.md', `${secretName.toUpperCase()}=${secretValue}\n`);
  assert.deepEqual(rules(secretHits), ['aws-secret']);
  const keyHits = scanContent('deploy/notes.md', `${accessKey}\n`);
  assert.deepEqual(rules(keyHits), ['aws-access-key']);
  assert.equal(formatHit(keyHits[0]).includes(accessKey), false);
});

test('secret names without a value are ignored', () => {
  const line = `${secretName.toUpperCase()}=(.+)$`;
  assert.deepEqual(scanContent('deploy/load.ps1', line), []);
});

test('credential allowlist requires a test fixture and a fake marker', () => {
  const marked = `${accessKey} EXAMPLE`;
  assert.deepEqual(scanContent('test/fixtures/keys.txt', marked), []);
  assert.deepEqual(rules(scanContent('test/fixtures/keys.txt', accessKey)), ['aws-access-key']);
  assert.deepEqual(rules(scanContent('README.md', `${accessKey} EXAMPLE`)), ['aws-access-key']);
});

test('mnemonic assignment and dotenv phrases are reported', () => {
  const assigned = scanContent('config/local.md', `MNEMONIC=${phrase12}\n`);
  assert.deepEqual(rules(assigned), ['mnemonic']);
  const long = scanContent('.env', `${phrase24}\n`);
  assert.deepEqual(rules(long), ['mnemonic']);
  assert.deepEqual(scanContent('README.md', phrase12), []);
  const allowed = scanContent('test/fixtures/wallet.env', `SEED=${phrase12} PLACEHOLDER\n`);
  assert.deepEqual(allowed, []);
  assert.equal(formatHit(assigned[0]).includes(phrase12.split(' ')[0]), false);
});

const retiredMailbox = ['founder', 'xfuel'].join('') + '@' + ['gmail', 'com'].join('.');
const givenName = ['Christ', 'opher'].join('');
const consumerMailbox = ['ada', ['gmail', 'com'].join('.')].join('@');

test('retired mailbox, consumer mail, and the given name are reported', () => {
  const mailboxHits = scanContent('README.md', `mailto:${retiredMailbox}\n`);
  assert.ok(rules(mailboxHits).includes('personal-mailbox'));
  assert.ok(rules(mailboxHits).includes('personal-email'));
  assert.equal(formatHit(mailboxHits[0]).includes(retiredMailbox), false);

  const consumerHits = scanContent('docs/note.md', `write ${consumerMailbox}\n`);
  assert.deepEqual(rules(consumerHits), ['personal-email']);
  assert.equal(formatHit(consumerHits[0]).includes(consumerMailbox), false);

  const nameHits = scanContent('docs/note.md', `Owner: ${givenName}, 2026-09-24\n`);
  assert.deepEqual(rules(nameHits), ['personal-name']);
  assert.equal(formatHit(nameHits[0]).toLowerCase().includes(givenName.toLowerCase()), false);

  const lower = scanContent('docs/note.md', givenName.toLowerCase());
  assert.deepEqual(rules(lower), ['personal-name']);
});

test('role addresses are not personal mail', () => {
  const text = [
    'hello@chit402.com',
    'chris@chit402.com',
    'security@xfuel.app',
    'conduct@xfuel.app',
  ].join('\n');
  assert.deepEqual(scanContent('README.md', text), []);
  assert.deepEqual(scanContent('docs/note.md', 'contact i@izs.me'), []);
});

test('personal contact rules are not waived for test fixtures', () => {
  const hits = scanContent('test/fixtures/contact.txt', `${retiredMailbox} EXAMPLE`);
  assert.ok(rules(hits).includes('personal-mailbox'));
  assert.ok(rules(scanContent('test/fixtures/contact.txt', givenName)).includes('personal-name'));
});
