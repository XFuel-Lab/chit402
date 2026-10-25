// Fixture for run-tests-limits.test.mjs, not discovered by run-tests (no .test.mjs suffix).
// A passing test that opens a loopback server and never closes it (no after()),
// so the file cannot exit on its own and hits the per-file limit.
import { test } from 'node:test';
import { createServer } from 'node:http';

test('opens a server and leaves it open', async () => {
  const server = createServer(() => {});
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
});
