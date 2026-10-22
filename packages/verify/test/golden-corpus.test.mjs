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
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { corpusDir, compare, consistency, pool, runPathAsync } from './corpus/lib.mjs';
import { buildSynthetic } from './corpus/synthetic.mjs';
import { GET_HOSTS } from './corpus/tape-hosts.mjs';

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
  // The latest entry for a case wins; changes.json is append-only.
  return [...changes].reverse().find((ch) => ch.case === id && ch.path === path && ch.kind !== 'registry') || null;
}

test('corpus inventory: every case has a baseline, no blocked receipt', () => {
  for (const job of jobs) assert.ok(baseline[job.key], `no baseline for ${job.key}`);
  for (const key of Object.keys(baseline)) assert.ok(jobs.some((j) => j.key === key), `baseline for a case that is gone: ${key}`);
  assert.equal(BLOCKED.test(JSON.stringify(manifest)), false);
  for (const ch of changes) {
    if (ch.kind === 'registry') { assert.ok(ch.entry && ch.pr && ch.spec, `incomplete registry entry ${JSON.stringify(ch)}`); continue; }
    assert.ok(ch.case && ch.path && ch.to !== undefined && ch.pr && ch.spec, `incomplete change entry ${JSON.stringify(ch)}`);
    assert.ok([undefined, 'tighten', 'corpus_fix', 'corpus_fix_reason'].includes(ch.kind), `unknown kind ${ch.kind}`);
  }
});

test('corpus covers signed v6 to v10 receipts and v6 to v10 receipt ids', () => {
  const signedVersion = (file) => {
    const m = readFileSync(file, 'utf8').match(/"(?:jws|value)":\s*"(ey[^"]+\.[^"]+\.[^"]+)"/);
    return m ? JSON.parse(Buffer.from(m[1].split('.')[1], 'base64url')).payload_version : null;
  };
  const signed = new Set(manifest.files.map((c) => signedVersion(join(fixtures, c.fixture))));
  const tape = readJson(publicTape);
  const shells = new Set();
  for (const e of Object.values(tape.entries)) {
    try { const b = JSON.parse(e.body); if (b && b.receipt_id) shells.add(b.payload_version); } catch { /* not JSON */ }
  }
  for (const v of [6, 7, 8, 9, 10]) {
    assert.ok(signed.has(v), `no signed v${v} receipt file in the corpus`);
    assert.ok(shells.has(v), `no v${v} receipt id in the corpus`);
  }
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
  for (const key of [
    'id-chit-43c98110-8ad4-4a65-8fa7-fa3a04424c0e|cli',
    'id-chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96|cli',
    'id-xfuel-1ebc5616-d9ce-4da9-b56c-847062ff6b96|cli',
    'file-chit-1ebc5616|cli',
    'file-chit-43c98110-prelog-shell|cli',
  ]) {
    const r = results.get(key);
    assert.ok(r, `missing case ${key}`);
    assert.equal(r.exit, 1, key);
    assert.equal(r.result, 'invalid', key);
    assert.equal(r.reason, 'not_in_log', key);
    assert.equal(r.checks.log_inclusion, 'fail', key);
  }
  // Exit 0 needs chain reads; the GET-only tape has none. The chain tier below covers exit 0.
  const ref = results.get('id-xfuel-3155b7d8-4315-44bc-bfdc-bf6b78ff2d15|cli');
  assert.equal(ref.checks.signature, 'pass');
  assert.equal(ref.checks.key_window, 'pass');
  assert.equal(ref.checks.log_inclusion, 'pass');
  assert.notEqual(ref.exit, 1);
});

test('synthetic verdict cases are never VERIFIED', async (t) => {
  await runAll;
  for (const c of synthetic) {
    for (const path of c.paths) {
      if (path === 'signature') continue; // signature-only path, not a verdict
      const r = results.get(`${c.id}|${path}`);
      assert.notEqual(r.exit, 0, `${c.id}|${path}`);
      assert.notEqual(r.result, 'verified', `${c.id}|${path}`);
      t.diagnostic(`${c.id}|${path}: ${r.exit} ${r.reason} (${r.cause ?? '-'}); target ${c.target}`);
    }
  }
});

test('each synthetic case is decided by its own rule', async () => {
  await runAll;
  let asserted = 0;
  for (const c of synthetic) {
    for (const path of c.paths) {
      const want = c.expect?.[path];
      if (path !== 'cli') assert.ok(want, `${c.id}|${path} has no expected cause`);
      if (!want) continue;
      const r = results.get(`${c.id}|${path}`);
      const got = String(r.cause ?? r.reason ?? '');
      assert.ok(got.includes(want), `${c.id}|${path}: decided by ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
      assert.ok(!/issuer_history_pin_mismatch/.test(got), `${c.id}|${path}: test history pin does not match`);
      asserted += 1;
    }
  }
  assert.ok(asserted >= 17, `only ${asserted} causes asserted`);
});

test('every version gate is pinned on both sides of its boundary', async () => {
  await runAll;
  for (const gate of [8, 9, 10]) {
    const pair = synthetic.filter((c) => c.class === 'gate' && c.gate === gate);
    assert.equal(pair.length, 2, `gate ${gate}`);
    const path = pair[0].paths[0];
    const [before, at] = pair.map((c) => results.get(`${c.id}|${path}`));
    if (gate === 8) {
      // Both field lists verify, each under its own version only.
      assert.equal(before.exit, 0);
      assert.equal(at.exit, 0);
    } else {
      assert.notEqual(before.exit, at.exit, `gate ${gate}: the two sides must differ`);
      assert.equal(at.exit, 1, `gate ${gate}: the gated rule applies from v${gate}`);
    }
  }
});

// Chain tier: the same cases on a second tape that also carries read-only JSON-RPC answers from
// public Base and Solana RPCs (record-chain.mjs). Its baseline is 0.4.11 on that tape; the rule is
// the same (never more permissive, exactly equal unless changes.json records it).
// The comparison is the shared lib.mjs one, unchanged. It does not know the
// public-scope result `verified_public` (exit 0), so the chain baseline pins
// such a row as `result: verified` plus `result_detail: verified_public`, and
// an outcome is mapped to `verified` only when its result equals the pinned
// `result_detail` exactly. Any other verified_public stays unknown and fails.
const chainTape = join(corpusDir, 'tapes', 'public-chain.json');
const chainBaseline = readJson(join(corpusDir, 'baseline-chain.json'));
test('chain tier: no outcome is more permissive than, or different from, its baseline', async (t) => {
  await runAll;
  const chainResults = new Map();
  await pool(jobs, 4, async (job) => { chainResults.set(job.key, await runPathAsync(job.c, job.path, chainTape)); });
  const problems = [];
  let misses = 0;
  for (const job of jobs) {
    const actual = chainResults.get(job.key);
    misses += actual.misses.length;
    const base = chainBaseline[job.key];
    assert.ok(base, `no chain baseline for ${job.key}`);
    const mapped = base.result_detail && actual.result === base.result_detail && base.result === 'verified' && actual.exit === 0
      ? { ...actual, result: 'verified' }
      : actual;
    for (const p of compare(base, mapped, changeFor(job.key))) problems.push(`${job.key}: ${p}`);
  }
  t.diagnostic(`${jobs.length} case paths; ${misses} requests not on the chain tape`);
  assert.deepEqual(problems, []);
  const ref = chainResults.get('id-xfuel-3155b7d8-4315-44bc-bfdc-bf6b78ff2d15|cli');
  assert.equal(ref.exit, 0);
  assert.equal(ref.result, 'verified_public');
  for (const key of ['id-chit-43c98110-8ad4-4a65-8fa7-fa3a04424c0e|cli', 'id-xfuel-1ebc5616-d9ce-4da9-b56c-847062ff6b96|cli']) {
    assert.equal(chainResults.get(key).exit, 1, key);
    assert.equal(chainResults.get(key).reason, 'not_in_log', key);
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

// Recording is GET-only, so a chain read can only ever be stored as an
// error entry, and a GET only goes to an allowed https host. A tape holding
// an RPC answer or another host was not made by the recorder.
function tapeProblems(file) {
  const { entries } = readJson(file);
  const problems = [];
  Object.entries(entries).forEach(([key, value], i) => {
    if (key.startsWith('RPC ')) {
      const fields = value && typeof value === 'object' ? Object.keys(value) : [];
      if (typeof value?.error !== 'string' || fields.some((f) => f !== 'error')) problems.push(`entry ${i}: RPC entry is not an error entry`);
    } else if (!key.startsWith('GET ')) {
      problems.push(`entry ${i}: neither GET nor RPC`);
    } else {
      let u = null;
      try { u = new URL(key.slice(4)); } catch { /* reported below */ }
      if (!u || u.protocol !== 'https:' || !GET_HOSTS.has(u.hostname) || u.username || u.password || u.port) problems.push(`entry ${i}: GET entry is not an https URL on an allowed host`);
    }
  });
  return problems;
}

test('every RPC entry on the tapes is an error entry, every GET is on an allowed host', () => {
  const tapes = [join(corpusDir, 'tapes', 'public.json')];
  if (privateDir && existsSync(join(privateDir, 'tape.json'))) tapes.push(join(privateDir, 'tape.json'));
  for (const file of tapes) {
    // Entry indexes only: the private tape stays out of test output.
    assert.deepEqual(tapeProblems(file), [], file === tapes[0] ? 'public tape' : 'private tape');
  }
  const rpc = Object.keys(readJson(tapes[0]).entries).filter((k) => k.startsWith('RPC '));
  assert.ok(rpc.length > 0, 'the public tape has RPC error entries to check');
});

test('the tape check rejects an RPC answer and a GET off the allowed hosts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tape-check-'));
  const f = join(dir, 'tape.json');
  writeFileSync(f, JSON.stringify({ entries: {
    'RPC h getTransaction []': { status: 200, body: '{"result":{}}' },
    'RPC h getSlot []': { error: 'x', result: 1 },
    'RPC h getBlock []': { error: 'chain read not recorded' },
    'GET https://api.chit402.com/receipt/x': { status: 200, body: '{}' },
    'GET https://rpc.example.org/x': { status: 200, body: '{}' },
    'GET http://api.chit402.com/x': { status: 200, body: '{}' },
    'GET https://api.chit402.com:8443/x': { status: 200, body: '{}' },
    'POST https://api.chit402.com/x': { status: 200, body: '{}' },
  } }));
  assert.deepEqual(tapeProblems(f), [
    'entry 0: RPC entry is not an error entry',
    'entry 1: RPC entry is not an error entry',
    'entry 4: GET entry is not an https URL on an allowed host',
    'entry 5: GET entry is not an https URL on an allowed host',
    'entry 6: GET entry is not an https URL on an allowed host',
    'entry 7: neither GET nor RPC',
  ]);
});

test('every pinned outcome is well formed', () => {
  for (const [key, o] of Object.entries(baseline)) assert.deepEqual(consistency({ ...o, json_exit: null }), [], key);
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
  assert.ok(cmp(base, b2, { case: 'x', path: 'cli', to: b2, pr: 'PR3', spec: 'L1' }).some((p) => p.includes('changes.json entry: more permissive than the baseline')));
  // result is ranked on its own: verified behind exit 1 is never accepted.
  const lying = { ...base, result: 'verified' };
  assert.ok(cmp(base, lying, null).some((p) => p.includes('more permissive: result invalid -> verified')));
  assert.ok(cmp(base, lying, null).some((p) => p.includes('malformed outcome: result verified with exit 1')));
  assert.ok(cmp(lying, lying, null).some((p) => p.includes('result verified with exit 1')), 'a bad baseline cannot bless it');
  // A dropped check is not a pass.
  const dropped = { ...base, checks: { signature: 'pass' } };
  assert.ok(cmp(base, dropped, null).some((p) => p.includes('missing check: checks.log_inclusion')));
  // Any exit outside 0/1/2 fails, crashes included.
  for (const exit of [null, 3, 4, 134, -1]) {
    assert.ok(cmp(base, { ...base, exit }, null).some((p) => p.includes('outside 0/1/2')), String(exit));
  }
  // --json and the process exit must agree.
  assert.ok(cmp(base, { ...base, json_exit: 0 }, null).some((p) => p.includes('--json exit_code 0 differs')));
});

test('mutant: NOT_IN_LOG reported as VERIFIED fails, with or without a baseline edit', async () => {
  const { gate } = await import('../scripts/corpus-gate.mjs');
  const key = 'id-xfuel-1ebc5616-d9ce-4da9-b56c-847062ff6b96|cli';
  const pinnedNow = baseline[key];
  assert.equal(pinnedNow.reason, 'not_in_log');
  const mutant = { exit: 0, json_exit: 0, result: 'verified', reason: null, checks: { ...pinnedNow.checks, log_inclusion: 'pass' } };
  // 1. The mutant against the committed baseline.
  assert.ok(compare(pinnedNow, mutant, null).some((p) => p.startsWith('more permissive: exit 1 -> 0')));
  // 2. The mutant plus a baseline edit that blesses it: the run comparison
  //    passes, so the merge-base gate is what must fail.
  const edited = { ...baseline, [key]: { exit: 0, result: 'verified', reason: null, checks: mutant.checks } };
  assert.deepEqual(compare(edited[key], mutant, null), []);
  const noEntry = gate({ baseBaseline: baseline, headBaseline: edited, baseChanges: { changes }, headChanges: { changes } });
  assert.ok(noEntry.some((p) => p.includes(`${key}: baseline changed with no changes.json entry`)), noEntry.join('\n'));
  // 3. Plus a changes.json entry: still more permissive than the merge base.
  const entry = { case: key.split('|')[0], path: 'cli', to: edited[key], pr: 'x', spec: 'x' };
  const tighten = gate({ baseBaseline: baseline, headBaseline: edited, baseChanges: { changes }, headChanges: { changes: [...changes, entry] } });
  assert.ok(tighten.some((p) => p.includes('more permissive than the merge base: exit 1 -> 0')), tighten.join('\n'));
  // 4. Labelled as a corpus fix: not allowed for a real receipt.
  const fix = gate({ baseBaseline: baseline, headBaseline: edited, baseChanges: { changes }, headChanges: { changes: [...changes, { ...entry, kind: 'corpus_fix', note: 'x' }] } });
  assert.ok(fix.some((p) => p.includes('corpus_fix is only for synthetic cases')), fix.join('\n'));
});
