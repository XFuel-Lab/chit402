import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { bookRowHash, formatReport, verifyLink } from '../../../scripts/verify-1f916-link.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const positivePath = join(root, 'scripts/fixtures/1f916-link-verifier-fixture.json');
const tamperedPath = join(root, 'scripts/fixtures/1f916-link-verifier-fixture-tampered.json');
const specimen1Path = join(root, 'apps/web/public/specimens/1f916-link-1.json');
const specimen2Path = join(root, 'apps/web/public/specimens/1f916-link-2.json');
const FINGERPRINT = 'a09e1e0b0aed6a7826b55281ef1e8af19fb164034a662d122adaa503b54f7dc2';
const TAMPERED = 'a09e1e0b0aed6a7826b55281ef1e8af19fb164034a662d122adaa503b54f7dc3';

function load(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('public payout specimens are pending and the verifier fixture is not one of them', () => {
  const first = load(specimen1Path);
  const second = load(specimen2Path);
  assert.equal(first.label, 'Specimen 1');
  assert.equal(first.status, 'pending_first_stamp');
  assert.equal(first.chit_receipt_id, null);
  assert.equal(first.payout_tx, '0x909d738d79ff4c9885cd9ed0755636565ee3ddf0406ef6f454e7fbf797990ce9');
  assert.equal(first.listing_id, 55);
  assert.equal(second.label, 'Specimen 2');
  assert.equal(second.status, 'pending_first_stamp');
  assert.equal(second.chit_receipt_id, null);
  assert.equal(second.payout_tx, '0x233acdcf3d78436d63a0dba00092fb9a8fe806a3ecd1b415a4d364144baffebd');
  assert.equal(second.listing_id, 45);
  const page = readFileSync(join(root, 'apps/web/src/pages/OneF916Link.tsx'), 'utf8');
  assert.match(page, /pending first stamp/);
  assert.doesNotMatch(page, /1ebc5616/);
});

test('verifier fixture pins one receipt and a one-nibble fingerprint change', () => {
  const positive = load(positivePath);
  const tampered = load(tamperedPath);
  assert.equal(positive.role, 'verifier_test_fixture');
  assert.equal(tampered.role, 'verifier_test_fixture');
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

test('pending specimens fail the receipt step and still check the entry hash', async () => {
  const result = await verifyLink(load(specimen1Path), {
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.includes('api.chit402.com')) throw new Error(`unexpected receipt fetch ${target}`);
      assert.match(target, /1f916\.ai\/api\/record\/chit402/);
      return {
        ok: true,
        json: async () => ({
          events: [{ id: 20498, kind: 'listing', hash: FINGERPRINT }],
          events_has_more: false,
        }),
      };
    },
  });
  assert.equal(result.steps.fetch_receipt.status, 'FAIL');
  assert.equal(result.steps.fetch_receipt.detail, 'pending_first_stamp');
  assert.equal(result.steps.entry_fingerprint.status, 'PASS');
  assert.equal(result.verdict, 'FAIL');
});

describe('verifier fixture, not a public specimen', () => {
  test('fixture passes every step', { timeout: 60000 }, async () => {
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

  test('CLI prints PASS for the fixture and FAIL for the tampered fixture', { timeout: 90000 }, () => {
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
