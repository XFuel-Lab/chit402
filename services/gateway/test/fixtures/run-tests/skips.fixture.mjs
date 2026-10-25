// Fixture for run-tests-limits.test.mjs, not discovered by run-tests (no .test.mjs suffix).
// Three tests: one runs, one is skipped and one is todo. Two count as skipped.
import { test } from 'node:test';

test('skips one runs', () => {});
test('skips two is skipped', { skip: 'fixture' }, () => {});
test('skips three is todo', { todo: 'fixture' }, () => {});
