// Fixture for run-tests-limits.test.mjs, not discovered by run-tests (no .test.mjs suffix).
// Three tests: one runs, one is skipped and one is todo. Two count as skipped.
// Top-level { skip } and { todo } only: they count the same on Node 20 and 22
// (3 tests, 2 skipped, checked on 20.19.2 and 22.23.4). A skipped suite,
// describe.todo or t.skip() inside a test count differently between them.
import { test } from 'node:test';

test('skips one runs', () => {});
test('skips two is skipped', { skip: 'fixture' }, () => {});
test('skips three is todo', { todo: 'fixture' }, () => {});
