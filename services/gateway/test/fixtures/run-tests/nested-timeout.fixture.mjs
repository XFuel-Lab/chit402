// Fixture for run-tests-limits.test.mjs, not discovered by run-tests (no .test.mjs suffix).
// Only a nested subtest times out, on its own short limit, so the file-level
// event is an ordinary failure and the testTimeoutFailure sits on the nested test.
// The sleep ends when the subtest's signal aborts, so nothing holds the file open.
import { test } from 'node:test';

test('nested timeout outer', async (t) => {
  await t.test('nested timeout inner', { timeout: 200 }, async (inner) => {
    await new Promise((done) => {
      const timer = setTimeout(done, 5000);
      inner.signal.addEventListener('abort', () => { clearTimeout(timer); done(); });
    });
  });
});
