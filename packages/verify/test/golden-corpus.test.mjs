/**
 * Golden never-worse corpus (verifier redesign PR1, spec rev 5 §5.1).
 *
 * Every case runs offline: the CLI and the library are started with
 * test/corpus/tape-preload.mjs, which answers every fetch from a recorded
 * tape and fixes the clock to the recording time. Chain JSON-RPC was never
 * recorded (GET-only recording), so it is answered as unreachable.
 *
 * For each case and path the outcome must
 *   1. never be more permissive than the 0.4.11 baseline (exit and every check), and
 *   2. equal the baseline exactly, unless test/corpus/changes.json records the change.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { corpusDir, compare, pool, runPathAsync } from './corpus/lib.mjs';
import { buildSynthetic } from './corpus/synthetic.mjs';

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const manifest = readJson(join(corpusDir, 'manifest.json'));
const baseline = readJson(join(corpusDir, 'baseline.json'));
const changes = readJson(join(corpusDir, 'changes.json')).changes;
const publicTape = join(corpusDir, 'tapes', 'public.json');
const fixtures = join(corpusDir, '..', 'fixtures');
const BLOCKED = /1e57cdd7/i;

const synthetic = await buildSynthetic(mkdtempSync(join(tmpdir(), 'corpus-syn-')));
const cases = [
  ...manifest.ids.map((c) => ({ ...c, kind: 'id', paths: ['cli'] })),
  ...manifest.files.map((c) => ({ ...c, kind: 'file', file: join(fixtures, c.fixture), paths: ['cli'] })),
  ...synthetic,
];
const jobs = cases.flatMap((c) => (c.paths || ['cli']).map((path) => ({ c, path, key: `${c.id}|${path}` })));
const results = new Map();
const runAll = pool(jobs, 4, async (job) => {
  results.set(job.key, await runPathAsync(job.c, job.path, publicTape));
});

function changeFor(key) {
  const [id, path] = key.split('|');
  return changes.find((ch) => ch.case === id && ch.path === path) || null;
}

test('corpus inventory: every case has a baseline, no blocked receipt', () => {
  for (const job of jobs) assert.ok(baseline[job.key], `no baseline for ${job.key}`);
  for (const key of Object.keys(baseline)) assert.ok(jobs.some((j) => j.key === key), `baseline for a case that is gone: ${key}`);
  assert.equal(BLOCKED.test(JSON.stringify(manifest)), false);
  for (const ch of changes) assert.ok(ch.case && ch.path && ch.to && ch.pr && ch.spec, `incomplete change entry ${JSON.stringify(ch)}`);
});

test('corpus: no outcome is more permissive than, or different from, the baseline', async (t) => {
  await runAll;
  const problems = [];
  let misses = 0;
  for (const job of jobs) {
    const actual = results.get(job.key);
    misses += actual.misses.length;
    for (const p of compare(baseline[job.key], actual, changeFor(job.key))) problems.push(`${job.key}: ${p}`);
  }
  t.diagnostic(`${jobs.length} case paths; ${misses} requests not on the tape`);
  assert.deepEqual(problems, []);
});

test('L3 and reference receipts hold offline', async () => {
  await runAll;
  for (const key of ['id-chit-43c98110-8ad4-4a65-8fa7-fa3a04424c0e|cli', 'id-chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96|cli', 'file-chit-1ebc5616|cli', 'file-chit-43c98110-prelog-shell|cli']) {
    const r = results.get(key);
    assert.equal(r.exit, 1, key);
    assert.equal(r.reason, 'not_in_log', key);
  }
  // Exit 0 needs live chain reads. Offline, everything before the chain passes.
  const ref = results.get('id-xfuel-3155b7d8-4315-44bc-bfdc-bf6b78ff2d15|cli');
  assert.equal(ref.checks.signature, 'pass');
  assert.equal(ref.checks.key_window, 'pass');
  assert.equal(ref.checks.log_inclusion, 'pass');
  assert.notEqual(ref.exit, 1);
});

test('label, version and timing cases are never VERIFIED', async (t) => {
  await runAll;
  for (const c of synthetic) {
    for (const path of c.paths) {
      const r = results.get(`${c.id}|${path}`);
      assert.notEqual(r.exit, 0, `${c.id}|${path}`);
      t.diagnostic(`${c.id}|${path}: ${r.exit} ${r.reason}; target ${c.target}`);
    }
  }
});

const privateDir = process.env.CHIT_CORPUS_PRIVATE_DIR;
test('local tier (holder documents, kept off the repo)', { skip: !privateDir || !existsSync(join(privateDir || '.', 'baseline.json')) }, async () => {
  const pm = readJson(join(privateDir, 'manifest.json'));
  const pb = readJson(join(privateDir, 'baseline.json'));
  const tape = join(privateDir, 'tape.json');
  const problems = [];
  await pool(pm.cases, 4, async (c) => {
    const key = `${c.id}|cli`;
    const actual = await runPathAsync({ ...c, file: join(privateDir, c.file) }, 'cli', tape);
    for (const p of compare(pb[key], actual, changeFor(key))) problems.push(`${key}: ${p}`);
  });
  assert.deepEqual(problems, []);
});

test('the comparison catches a more permissive or unrecorded change', async () => {
  const { compare: cmp } = await import('./corpus/lib.mjs');
  const base = { exit: 1, result: 'invalid', reason: 'not_in_log', checks: { signature: 'pass', log_inclusion: 'fail' } };
  assert.deepEqual(cmp(base, { ...base }, null), []);
  const looser = cmp(base, { exit: 0, result: 'verified', reason: null, checks: { signature: 'pass', log_inclusion: 'pass' } }, null);
  assert.ok(looser.some((p) => p.includes('more permissive: exit 1 -> 0')));
  assert.ok(looser.some((p) => p.includes('checks.log_inclusion fail -> pass')));
  const cnc = cmp(base, { ...base, exit: 2, result: 'could_not_check', reason: 'log_unreachable' }, null);
  assert.ok(cnc.some((p) => p.startsWith('more permissive: exit 1 -> 2')));
  const stricter = { exit: 1, result: 'invalid', reason: 'version_window', checks: base.checks };
  const b2 = { ...base, exit: 2, result: 'could_not_check', reason: 'unsupported_version' };
  assert.ok(cmp(b2, stricter, null).some((p) => p.includes('no changes.json entry')));
  assert.deepEqual(cmp(b2, stricter, { case: 'x', path: 'cli', to: stricter, pr: 'PR3', spec: 'L1' }), []);
  assert.ok(cmp(base, b2, { case: 'x', path: 'cli', to: b2, pr: 'PR3', spec: 'L1' }).some((p) => p.includes('changes.json entry is more permissive')));
});
