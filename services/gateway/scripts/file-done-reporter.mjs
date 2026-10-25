import { resolve } from 'node:path';

/**
 * Second reporter for run-tests.mjs. Writes one JSON line per finished test
 * file. Node 20 and 22 flatten each file's tests into the top-level TAP and
 * print no `ok N - <file>` line for a passing file, so TAP text cannot say
 * which files finished; the file-level test:complete / test:fail events can.
 * The file-level event's name is the absolute path on Node 20 and the path as
 * passed (test/x.test.mjs) on Node 22, so compare resolved paths.
 */
// A file that hits the per-file time limit is one testTimeoutFailure on Node 20
// and its own tests are not counted, so the summary can still say fail 0.
// Cancelled tests are dropped the same way. run-tests.mjs fails the run and
// names the file for either. The problem is read from test:complete, which
// comes before test:fail, and rides on the completion row itself: with
// --test-force-exit a later write to this file can be lost at exit.
const PROBLEMS = new Set(['testTimeoutFailure', 'cancelledByParent']);

export default async function* fileDoneReporter(source) {
  for await (const event of source) {
    if (event.type !== 'test:complete' && event.type !== 'test:fail') continue;
    const d = event.data || {};
    if (!d.file) continue;
    const failureType = d.details?.error?.failureType;
    const problem = PROBLEMS.has(failureType) ? failureType : null;
    const fileLevel = d.nesting === 0 && resolve(String(d.name)) === d.file;
    if (!fileLevel) {
      if (problem) yield `${JSON.stringify({ file: d.file, problem, test: String(d.name) })}\n`;
      continue;
    }
    const passed = event.type === 'test:complete' ? d.details?.passed !== false : false;
    const row = problem ? { file: d.file, passed, problem, test: String(d.name) } : { file: d.file, passed };
    yield `${JSON.stringify(row)}\n`;
  }
}
