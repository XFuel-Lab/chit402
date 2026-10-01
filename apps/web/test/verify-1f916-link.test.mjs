import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { bookRowHash, formatReport, verifyLink } from '../../../scripts/verify-1f916-link.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const positivePath = join(root, 'apps/web/public/specimens/1f916-link-1.json');
const tamperedPath = join(root, 'apps/web/public/specimens/1f916-link-1-tampered.json');
const FINGERPRINT = 'a09e1e0b0aed6a7826b55281ef1e8af19fb164034a662d122adaa503b54f7dc2';
const TAMPERED = 'a09e1e0b0aed6a7826b55281ef1e8af19fb164034a662d122adaa503b54f7dc3';

function load(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('specimen files pin the same receipt and differ by one fingerprint nibble', () => {
  const positive = load(positivePath);
  const tampered = load(tamperedPath);
  assert.equal(positive.label, 'Specimen 1');
  assert.equal(tampered.role, 'falsifier');
  assert.equal(positive.chit_receipt_id, 'chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96');
  assert.equal(tampered.chit_receipt_id, positive.chit_receipt_id);
  assert.equal(tampered.chit_verify_url, positive.chit_verify_url);
  assert.equal(positive.entry.event_id, 20498);
  assert.equal(tampered.entry.event_id, 20498);
  assert.equal(positive.entry.handle, 'chit402');
  assert.equal(positive.agent_record_entry.fingerprint, FINGERPRINT);
  assert.equal(positive.agent_record_entry.fingerprint_alg, '1f916-entry-hash');
  assert.equal(positive.agent_record_entry.registry, '1f916');
  assert.equal(positive.agent_record_entry.signed, false);
  assert.equal(tampered.agent_record_entry.fingerprint, TAMPERED);
  assert.equal(tampered.entry.hash, FINGERPRINT);
  const page = readFileSync(join(root, 'apps/web/src/pages/OneF916Link.tsx'), 'utf8');
  assert.match(page, new RegExp(FINGERPRINT));
  assert.match(page, /Who issues the receipt/);
});

test('book row hash matches the Specimen 1 receipt head', () => {
  assert.equal(bookRowHash({
    book_id: 146,
    seq: 1,
    task_id: 'xfuel-1ebc5616-d9ce-4da9-b56c-847062ff6b96',
    prev_hash: null,
    event: null,
  }), '43651fc3fbc8c678bd41c40c6158be0878896c213e9b6809cbd4f4851c2c1835');
});

describe('live 1F916 link specimens', () => {
  test('Specimen 1 passes every step', { timeout: 60000 }, async () => {
    const result = await verifyLink(load(positivePath));
    assert.equal(formatReport(result).includes('VERDICT PASS'), true, formatReport(result));
    for (const name of ['fetch_receipt', 'issuer_signature', 'receipt_chain', 'on_chain_tx', 'entry_fingerprint']) {
      assert.equal(result.steps[name].status, 'PASS', `${name}: ${result.steps[name].detail}`);
    }
    assert.match(result.steps.entry_fingerprint.detail, new RegExp(FINGERPRINT));
    assert.equal(result.verdict, 'PASS');
  });

  test('tampered fingerprint fails only the fingerprint step', { timeout: 60000 }, async () => {
    const result = await verifyLink(load(tamperedPath));
    for (const name of ['fetch_receipt', 'issuer_signature', 'receipt_chain', 'on_chain_tx']) {
      assert.equal(result.steps[name].status, 'PASS', `${name}: ${result.steps[name].detail}`);
    }
    assert.equal(result.steps.entry_fingerprint.status, 'FAIL');
    assert.match(result.steps.entry_fingerprint.detail, /fingerprint_mismatch/);
    assert.match(result.steps.entry_fingerprint.detail, new RegExp(TAMPERED));
    assert.equal(result.verdict, 'FAIL');
  });

  test('CLI prints PASS for Specimen 1 and FAIL for the falsifier', { timeout: 90000 }, () => {
    const script = join(root, 'scripts/verify-1f916-link.mjs');
    const ok = spawnSync(process.execPath, [script, positivePath], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /PASS entry_fingerprint/);
    assert.match(ok.stdout, /VERDICT PASS/);

    const bad = spawnSync(process.execPath, [script, tamperedPath], { encoding: 'utf8' });
    assert.equal(bad.status, 1, bad.stdout + bad.stderr);
    assert.match(bad.stdout, /PASS on_chain_tx/);
    assert.match(bad.stdout, /FAIL entry_fingerprint\s+fingerprint_mismatch/);
    assert.match(bad.stdout, /VERDICT FAIL/);
  });
});
