/**
 * The public box and the CLI share checkReceiptInput.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const { checkReceiptInput, classifyReceiptInput } = await import('../dist/check-input.js');

const ID = 'chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96';
const PASTE = JSON.stringify({
  task_id: ID,
  issuer_signature: { alg: 'ES256', kid: 'not-a-kid', jws: 'aaa.bbb.ccc' },
});

function cliText(args) {
  const proc = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 15000 });
  return proc;
}

test('a pasted receipt, an id, and a URL share one verdict', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('/receipt/')) {
      return new Response(PASTE, { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error('unexpected fetch');
  };
  try {
    const pasted = await checkReceiptInput(PASTE, { publicInput: true });
    const byId = await checkReceiptInput(ID, { publicInput: true });
    const byUrl = await checkReceiptInput(`https://api.chit402.com/receipt/${ID}`, { publicInput: true });
    assert.equal(pasted.report, 'lines');
    assert.equal(pasted.verdict.result, byId.verdict.result);
    assert.equal(pasted.verdict.result, byUrl.verdict.result);
    assert.deepEqual(pasted.lines, byId.lines);
    assert.deepEqual(pasted.lines, byUrl.lines);
    assert.equal(pasted.lines[0] === 'INVALID' || pasted.lines[0] === 'COULD_NOT_CHECK' || pasted.lines[0] === 'VERIFIED', true);
    assert.ok(calls.some((url) => url.startsWith(`https://api.chit402.com/receipt/${ID}`)));
  } finally {
    globalThis.fetch = original;
  }
});

test('a public path is not read from disk', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-input-'));
  const file = join(dir, 'secret-receipt.json');
  const secret = 'disk-secret-not-for-the-box';
  writeFileSync(file, JSON.stringify({ task_id: ID, note: secret, issuer_signature: { jws: 'aaa.bbb.ccc' } }));
  const outcome = await checkReceiptInput(file, { publicInput: true });
  assert.equal(outcome.report, 'stderr');
  assert.equal(JSON.stringify(outcome).includes(secret), false);
  assert.equal(classifyReceiptInput(file), 'other');
});

test('a disallowed receipt URL is not fetched', async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw new Error('should not fetch');
  };
  try {
    const outcome = await checkReceiptInput('https://evil.example/receipt/x', { publicInput: true });
    assert.equal(called, false);
    assert.equal(outcome.verdict.result, 'could_not_check');
    assert.equal(outcome.lines[0], 'COULD_NOT_CHECK');
    assert.match(outcome.lines.join('\n'), /The receipt could not be fetched\./);
  } finally {
    globalThis.fetch = original;
  }
});

test('a public issuer-history read error is COULD_NOT_CHECK', async () => {
  const snapshot = fileURLToPath(new URL('../issuer-history.snapshot.json', import.meta.url));
  const aside = `${snapshot}.aside-check`;
  renameSync(snapshot, aside);
  try {
    const outcome = await checkReceiptInput(PASTE, { publicInput: true });
    assert.equal(outcome.report, 'lines');
    assert.equal(outcome.verdict.result, 'could_not_check');
    assert.equal(outcome.verdict.exit_code, 2);
    assert.equal(outcome.verdict.reason, 'issuer_history_unavailable');
    assert.equal(outcome.lines[0], 'COULD_NOT_CHECK');
    assert.match(outcome.lines.join('\n'), /Issuer history could not be read\./);
    assert.match(outcome.lines.join('\n'), /The receipt could not be checked\./);
    assert.equal(/invalid/i.test(outcome.lines.join('\n')), false);
    assert.equal(JSON.stringify(outcome).includes(aside), false);
  } finally {
    renameSync(aside, snapshot);
  }
});

test('CLI lines for a file match checkReceiptInput', () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-input-cli-'));
  const file = join(dir, 'receipt.json');
  writeFileSync(file, PASTE);
  const run = cliText([file]);
  assert.equal(run.status, 1, run.stderr);
  return checkReceiptInput(PASTE, { publicInput: true }).then((outcome) => {
    assert.equal(outcome.lines.join('\n'), run.stdout.trim());
  });
});
