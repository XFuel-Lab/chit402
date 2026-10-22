/**
 * The PR3 tightenings are in the baselines themselves (baseline.json and
 * baseline-chain.json hold each tighten entry's `to`), so a later change
 * cannot undo them by appending tighten entries that hold the old values.
 * Also: the chain tier gate (append-only chain tape, never-worse chain
 * baseline).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gate, gateChain, BASELINE, CHANGES, REGISTRY_PIN, CHAIN_BASELINE, CHAIN_TAPE } from '../scripts/corpus-gate.mjs';
import { compare } from './corpus/lib.mjs';

const pkg = fileURLToPath(new URL('..', import.meta.url));
const script = join(pkg, 'scripts', 'corpus-gate.mjs');
const local = (rel) => join(pkg, rel.replace(/^packages\/verify\//, ''));
const read = (rel) => JSON.parse(readFileSync(local(rel), 'utf8'));
const baseline = read(BASELINE);
const chainBaseline = read(CHAIN_BASELINE);
const changes = read(CHANGES);
const registry = read(REGISTRY_PIN);
const chainTape = read(CHAIN_TAPE);
const clone = (v) => JSON.parse(JSON.stringify(v));

// The five PR3 tightenings and the values they replaced (main + #623).
const L1_CLI_OLD = { exit: 1, result: 'invalid', reason: 'key untrusted', checks: { signature: 'fail', key_window: 'could_not_check', payment_binding: 'could_not_check', log_inclusion: 'could_not_check', anchor: 'could_not_check', shape: 'pass' } };
const L1_LIB_OLD = { exit: 2, result: 'could_not_check', reason: 'log_unreachable', checks: { signature: 'pass', key_window: 'pass', payment_binding: 'could_not_check', log_inclusion: 'could_not_check', anchor: 'could_not_check', shape: 'pass' }, overall: 'partial' };
const PROD_KID_OLD = { exit: 1, result: 'invalid', reason: 'key untrusted', checks: { signature: 'fail', key_window: 'pass', payment_binding: 'could_not_check', log_inclusion: 'could_not_check', anchor: 'could_not_check', shape: 'pass' } };
const OLD = {
  'version-l1-v4-not-allowlisted|cli': L1_CLI_OLD,
  'version-l1-v4-not-allowlisted|library': L1_LIB_OLD,
  'version-l1-v5-not-allowlisted|cli': L1_CLI_OLD,
  'version-l1-v5-not-allowlisted|library': L1_LIB_OLD,
  'version-l1-v4-production-kid|cli': PROD_KID_OLD,
};
const tightened = changes.changes.filter((c) => /^PR3/.test(c.pr) && (c.kind ?? 'tighten') === 'tighten');

test('each PR3 tighten `to` is in baseline.json and baseline-chain.json', () => {
  assert.deepEqual(tightened.map((c) => `${c.case}|${c.path}`).sort(), Object.keys(OLD).sort());
  for (const c of tightened) {
    const key = `${c.case}|${c.path}`;
    // #629 later recorded the pinned cause in the library rows; the rest of the row is the PR3 `to`.
    const { cause: _cause, ...row } = baseline[key];
    assert.deepEqual(row, c.to, key);
    assert.deepEqual(chainBaseline[key], c.to, `chain ${key}`);
    const latest = [...changes.changes].reverse().find((x) => x.case === c.case && x.path === c.path);
    assert.deepEqual(latest.to, baseline[key], `latest entry for ${key}`);
  }
});

function revert() {
  const head = clone(baseline);
  const headChain = clone(chainBaseline);
  const added = [];
  for (const [key, old] of Object.entries(OLD)) {
    head[key] = old;
    headChain[key] = old;
    const [cs, path] = key.split('|');
    added.push({ case: cs, path, kind: 'tighten', to: old, pr: 'later', spec: 'later' });
  }
  return { head, headChain, headChanges: { ...changes, changes: [...changes.changes, ...added] } };
}

test('the review revert (5 appended tighten entries holding the old values) fails the gate', () => {
  const { head, headChain, headChanges } = revert();
  const problems = gate({ baseBaseline: baseline, headBaseline: head, baseChanges: changes, headChanges, baseRegistry: registry, headRegistry: registry });
  for (const key of Object.keys(OLD)) {
    assert.ok(problems.some((p) => p.startsWith(`${key}: more permissive than the merge base`)), `${key}: ${problems.join('; ')}`);
  }
  const chain = gateChain({ baseChainBaseline: chainBaseline, headChainBaseline: headChain, baseChainTape: chainTape, headChainTape: chainTape, baseChanges: changes, headChanges });
  for (const key of Object.keys(OLD)) {
    assert.ok(chain.some((p) => p.startsWith(`chain ${key}: more permissive than the merge base`)), `chain ${key}: ${chain.join('; ')}`);
  }
});

test('the corpus run also fails the old values against the strict baselines', () => {
  for (const [key, old] of Object.entries(OLD)) {
    assert.notDeepEqual(compare(baseline[key], old, null), [], key);
    assert.notDeepEqual(compare(chainBaseline[key], old, null), [], `chain ${key}`);
  }
});

test('chain gate: unchanged passes; the tape is append-only; rows never removed or looser', () => {
  const args = (over = {}) => ({ baseChainBaseline: chainBaseline, headChainBaseline: chainBaseline, baseChainTape: chainTape, headChainTape: chainTape, baseChanges: changes, headChanges: changes, ...over });
  assert.deepEqual(gateChain(args()), []);
  const keys = Object.keys(chainTape.entries);
  assert.ok(keys.length > 0);
  const edited = clone(chainTape);
  edited.entries[keys[0]] = { ...edited.entries[keys[0]], body: 'x' };
  assert.ok(gateChain(args({ headChainTape: edited })).some((p) => p.includes('append-only') && p.endsWith('edited')));
  const dropped = clone(chainTape);
  delete dropped.entries[keys[0]];
  assert.ok(gateChain(args({ headChainTape: dropped })).some((p) => p.endsWith('removed')));
  const grown = clone(chainTape);
  grown.entries['GET https://example.invalid/new'] = { status: 200, body: '{}' };
  assert.deepEqual(gateChain(args({ headChainTape: grown })), []);
  assert.ok(gateChain(args({ headChainTape: { ...chainTape, recorded_at: '2030-01-01T00:00:00Z' } })).some((p) => p.includes('recorded_at')));

  const REAL = 'id-chit-43c98110-8ad4-4a65-8fa7-fa3a04424c0e|cli';
  assert.equal(chainBaseline[REAL].reason, 'not_in_log');
  const removed = clone(chainBaseline);
  delete removed[REAL];
  assert.ok(gateChain(args({ headChainBaseline: removed })).some((p) => p.includes('real receipt case was removed')));
  const looser = clone(chainBaseline);
  looser[REAL] = { ...looser[REAL], exit: 0, result: 'verified', reason: null, checks: { ...looser[REAL].checks, log_inclusion: 'pass' } };
  assert.ok(gateChain(args({ headChainBaseline: looser })).some((p) => p.includes('no changes.json entry')));
  const withEntry = { ...changes, changes: [...changes.changes, { case: REAL.split('|')[0], path: 'cli', to: looser[REAL], pr: 'x', spec: 'x' }] };
  assert.ok(gateChain(args({ headChainBaseline: looser, headChanges: withEntry })).some((p) => p.includes('more permissive than the merge base: exit 1 -> 0')));
  const REF = 'id-xfuel-3155b7d8-4315-44bc-bfdc-bf6b78ff2d15|cli';
  assert.equal(chainBaseline[REF].result_detail, 'verified_public');
  const detail = clone(chainBaseline);
  delete detail[REF].result_detail;
  const refEntry = { ...changes, changes: [...changes.changes, { case: REF.split('|')[0], path: 'cli', to: detail[REF], pr: 'x', spec: 'x' }] };
  assert.ok(gateChain(args({ headChainBaseline: detail, headChanges: refEntry })).some((p) => p.includes('result_detail changed')));
});

const gitOk = spawnSync('git', ['--version']).status === 0;

test('end to end: the review revert fails the gate script; the strict head passes', { skip: !gitOk }, () => {
  const root = mkdtempSync(join(tmpdir(), 'corpus-ratchet-'));
  const git = (...a) => {
    const r = spawnSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git('init', '-q');
  for (const rel of [BASELINE, CHANGES, REGISTRY_PIN, CHAIN_BASELINE, CHAIN_TAPE]) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), readFileSync(local(rel)));
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  const clean = spawnSync(process.execPath, [script, '--base', base, '--root', root], { encoding: 'utf8' });
  assert.equal(clean.status, 0, clean.stderr);
  const { head, headChain, headChanges } = revert();
  writeFileSync(join(root, BASELINE), JSON.stringify(head, null, 1));
  writeFileSync(join(root, CHAIN_BASELINE), JSON.stringify(headChain, null, 1));
  writeFileSync(join(root, CHANGES), JSON.stringify(headChanges, null, 1));
  git('commit', '-q', '-am', 'head');
  const bad = spawnSync(process.execPath, [script, '--base', base, '--root', root], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  for (const key of Object.keys(OLD)) {
    assert.ok(bad.stderr.includes(`corpus-gate: ${key}: more permissive than the merge base`), key);
    assert.ok(bad.stderr.includes(`corpus-gate: chain ${key}: more permissive than the merge base`), `chain ${key}`);
  }
});
