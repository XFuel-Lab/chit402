// Fixture for run-tests-limits.test.mjs, not discovered by run-tests (no .test.mjs suffix).
// The parent returns without awaiting its subtest, so node cancels the
// subtest (cancelledByParent). The timer is unref'd so nothing holds the file open.
import { test } from 'node:test';

test('cancelled parent returns early', (t) => {
  t.test('cancelled orphan subtest', async () => {
    await new Promise((done) => setTimeout(done, 500).unref());
  });
});
