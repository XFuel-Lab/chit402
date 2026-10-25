// Fixture for run-tests-limits.test.mjs, not discovered by run-tests (no .test.mjs suffix).
// Three tests, but the second ends the process with exit code 0, so the third
// never runs. The file still reports success. Only the count check catches it.
import { test } from 'node:test';

test('early one', () => {});

test('early two exits the process', () => {
  process.exit(0);
});

test('early three never runs', () => {});
