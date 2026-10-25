// Fixture for run-tests-limits.test.mjs, not discovered by run-tests (no .test.mjs suffix).
// Two tests that both finish; the second fails an ordinary assertion.
import assert from 'node:assert/strict';
import { test } from 'node:test';

test('fails one passes', () => {});
test('fails two fails an assertion', () => {
  assert.equal(1, 2);
});
