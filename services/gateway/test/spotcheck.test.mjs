/**
 * Phase 4 — spot-check sampler tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldSpotCheck, buildSpotCheckRecord, outputHashOf } from '../src/spotcheck.js';

test('shouldSpotCheck is deterministic for the same seed + task', () => {
  const a = shouldSpotCheck('task-1', { seed: 'epoch-42', rateBps: 5000 });
  const b = shouldSpotCheck('task-1', { seed: 'epoch-42', rateBps: 5000 });
  assert.deepEqual(a, b);
  assert.match(a.draw, /^0x[0-9a-f]{64}$/);
});

test('rate 0 never samples; rate 10000 always samples', () => {
  assert.equal(shouldSpotCheck('t', { seed: 's', rateBps: 0 }).sampled, false);
  assert.equal(shouldSpotCheck('t', { seed: 's', rateBps: 10000 }).sampled, true);
});

test('sampling rate is approximately honored across many tasks', () => {
  const N = 2000;
  let hits = 0;
  for (let i = 0; i < N; i++) {
    if (shouldSpotCheck(`task-${i}`, { seed: 'epoch-1', rateBps: 2000 }).sampled) hits++;
  }
  const rate = hits / N;
  assert.ok(rate > 0.15 && rate < 0.25, `expected ~0.20, got ${rate}`);
});

test('buildSpotCheckRecord resolves outcome from output compare', () => {
  const seed = 'epoch-1';
  // find a taskId that is sampled at 10000 bps (always)
  const rec = buildSpotCheckRecord({
    taskId: 'task-x', seed, rateBps: 10000, method: 'reexec-compare',
    expectedOutputHash: '0x' + 'ab'.repeat(32), observedOutputHash: '0x' + 'ab'.repeat(32),
  });
  assert.equal(rec.sampled, true);
  assert.equal(rec.outcome, 'pass');
  assert.equal(rec.slashable, false);

  const bad = buildSpotCheckRecord({
    taskId: 'task-x', seed, rateBps: 10000,
    expectedOutputHash: '0x' + 'ab'.repeat(32), observedOutputHash: '0x' + 'cd'.repeat(32),
  });
  assert.equal(bad.outcome, 'mismatch');
  assert.equal(bad.slashable, true);
});

test('not-sampled tasks are never slashable', () => {
  const rec = buildSpotCheckRecord({ taskId: 't', seed: 's', rateBps: 0 });
  assert.equal(rec.sampled, false);
  assert.equal(rec.outcome, 'not-sampled');
  assert.equal(rec.slashable, false);
});

test('outputHashOf handles text and hex', () => {
  assert.match(outputHashOf('hello'), /^0x[0-9a-f]{64}$/);
  assert.match(outputHashOf('0xdeadbeef'), /^0x[0-9a-f]{64}$/);
});
