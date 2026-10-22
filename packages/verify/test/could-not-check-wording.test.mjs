/**
 * COULD_NOT_CHECK human text must not read as INVALID.
 * --json fields and exit codes 0, 1, and 2 stay on the 0.4 contract.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const { buildVerifyVerdict, humanVerdictLines } = await import('../dist/verdict.js');

const CHECKS = ['signature', 'key_window', 'payment_binding', 'log_inclusion', 'anchor', 'shape'];

function runCli(args) {
  const proc = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 8000 });
  return { ...proc, text: `${proc.stdout || ''}\n${proc.stderr || ''}` };
}

function assertNoInvalidWord(text) {
  assert.equal(/invalid/i.test(text), false, text);
}

test('exit codes 0, 1, and 2 stay on the locked verdict', () => {
  const verified = buildVerifyVerdict({
    version: '0.4.2',
    signatureValid: true,
    signatureChecked: true,
    historyChecked: true,
    historyOk: true,
    logInclusion: 'pass',
    anchor: 'pass',
  });
  assert.equal(verified.exit_code, 0);
  assert.equal(verified.result, 'verified');
  assert.equal(humanVerdictLines(verified)[0], 'VERIFIED');

  const invalid = buildVerifyVerdict({
    version: '0.4.2',
    signatureValid: false,
    signatureChecked: true,
    errors: ['key untrusted'],
    historyChecked: true,
    historyOk: true,
    logInclusion: 'could_not_check',
    anchor: 'could_not_check',
  });
  assert.equal(invalid.exit_code, 1);
  assert.equal(invalid.result, 'invalid');
  assert.equal(humanVerdictLines(invalid)[0], 'INVALID');

  const unchecked = buildVerifyVerdict({
    version: '0.4.2',
    absentReason: 'receipt_unavailable',
  });
  assert.equal(unchecked.exit_code, 2);
  assert.equal(unchecked.result, 'could_not_check');
  const lines = humanVerdictLines(unchecked);
  assert.equal(lines[0], 'COULD_NOT_CHECK');
  assert.equal(lines.includes('The receipt could not be checked.'), true);
  assert.equal(lines.includes('The receipt could not be fetched.'), true);
  assertNoInvalidWord(lines.join('\n'));
  assert.equal(unchecked.message, 'The receipt could not be fetched.');
});

test('offline COULD_NOT_CHECK human text and JSON message do not say invalid', () => {
  const target = 'http://127.0.0.1:9/receipt/chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96';
  const human = runCli([target]);
  assert.equal(human.status, 2, human.text);
  assert.match(human.stdout, /^COULD_NOT_CHECK\n/);
  assert.match(human.stdout, /The receipt could not be fetched\./);
  assert.match(human.stdout, /The receipt could not be checked\./);
  assert.match(human.stdout, /Details: https:\/\/chit402\.com\/docs\/verify#receipt_unavailable/);
  assert.match(human.stdout, /Fetch the receipt again, then re-run\./);
  assertNoInvalidWord(human.stdout);
  assert.doesNotMatch(human.stdout, /NOT found invalid/);
  assert.equal(human.stderr, '');

  const json = runCli([target, '--json']);
  assert.equal(json.status, 2, json.text);
  const body = JSON.parse(json.stdout);
  assert.deepEqual(body, {
    result: 'could_not_check',
    exit_code: 2,
    reason: 'receipt_unavailable',
    message: 'The receipt could not be fetched.',
    next_step: 'Fetch the receipt again, then re-run.',
    receipt_id: null,
    display_id: null,
    payload_version: null,
    checks: {
      signature: 'could_not_check',
      key_window: 'could_not_check',
      payment_binding: 'could_not_check',
      log_inclusion: 'could_not_check',
      anchor: 'could_not_check',
      shape: 'could_not_check',
    },
    history: {
      source: null,
      head_hash: null,
      entry_count: null,
      as_of: null,
    },
    log: null,
    verifier: {
      name: 'chit402-verify',
      version: '0.5.0-pre.0',
    },
  });
  for (const name of CHECKS) assert.equal(body.checks[name], 'could_not_check', name);

  const version = runCli(['--version']);
  assert.equal(version.status, 0, version.text);
  assert.match(version.stdout, /^chit402-verify 0\.5\.0-pre\.0\n/);

  const removed = runCli(['--strict', '--json']);
  assert.equal(removed.status, 1, removed.text);
  const flag = JSON.parse(removed.stdout);
  assert.equal(flag.exit_code, 1);
  assert.equal(flag.result, 'invalid');
  assert.equal(flag.reason, 'removed_flag');
});

test('a local receipt whose log was not checked does not print invalid', () => {
  const house = JSON.parse(readFileSync(new URL('./fixtures/public/chit-1ebc5616.json', import.meta.url), 'utf8'));
  delete house.verify_url;
  if (house.verification) delete house.verification.jwks_uri;
  const dir = mkdtempSync(join(tmpdir(), 'chit-could-not-check-'));
  const receiptPath = join(dir, 'receipt.json');
  writeFileSync(receiptPath, JSON.stringify(house));

  const human = runCli([receiptPath]);
  assert.equal(human.status, 2, human.text);
  assert.match(human.stdout, /^COULD_NOT_CHECK\n/);
  assert.match(human.stdout, /The receipt could not be checked\./);
  assert.match(human.stdout, /Details: https:\/\/chit402\.com\/docs\/verify#log_unreachable/);
  assertNoInvalidWord(human.stdout);

  const json = runCli([receiptPath, '--json']);
  assert.equal(json.status, 2, json.text);
  const body = JSON.parse(json.stdout);
  assert.equal(body.result, 'could_not_check');
  assert.equal(body.exit_code, 2);
  assert.equal(body.reason, 'log_unreachable');
  assert.equal(body.checks.signature, 'pass');
  assert.equal(body.checks.key_window, 'pass');
  assert.equal(body.checks.log_inclusion, 'could_not_check');
  assert.equal(body.checks.anchor, 'could_not_check');
  assert.equal(body.verifier.version, '0.5.0-pre.0');
  assert.equal(/invalid/i.test(body.message), false);
  assert.equal(body.message, 'The receipt log or anchor could not be fetched.');
});
