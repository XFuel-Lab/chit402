// Fixture for run-tests-limits.test.mjs, not discovered by run-tests (no .test.mjs suffix).
// One quick test, then one that holds a loopback server open past a reduced per-file limit.
import { test } from 'node:test';
import { createServer } from 'node:http';

test('quick', () => {});

test('sleeps past the per-file limit', async () => {
  const server = createServer(() => {});
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  try {
    await new Promise((done) => setTimeout(done, 10_000));
  } finally {
    server.close();
  }
});
