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
// comes before test:fail, and rides on the completion row itself.
//
// When the stream ends, one count row per file follows: { file, tests }, the
// number of test:pass and test:fail events for tests in that file, suites and
// the file-level event left out. That is the same number the TAP `# tests`
// summary adds up. run-tests.mjs compares it with test/test-counts.json, so a
// file that stops early (an exit mid-file, a cut event stream) fails the run
// even when the file itself reports success. A file with no count row counts
// as zero. The row also carries `skipped`, the skip and todo tests among them,
// which run-tests.mjs caps.
const PROBLEMS = new Set(['testTimeoutFailure', 'cancelledByParent']);

export default async function* fileDoneReporter(source) {
  const counts = new Map();
  const skips = new Map();
  for await (const event of source) {
    if (event.type === 'test:pass' || event.type === 'test:fail') {
      const d = event.data || {};
      const fileLevel = d.nesting === 0 && d.file && resolve(String(d.name)) === d.file;
      if (d.file && !fileLevel && d.details?.type !== 'suite') {
        counts.set(d.file, (counts.get(d.file) || 0) + 1);
        if (d.skip !== undefined || d.todo !== undefined) skips.set(d.file, (skips.get(d.file) || 0) + 1);
      }
    }
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
  for (const [file, tests] of counts) yield `${JSON.stringify({ file, tests, skipped: skips.get(file) || 0 })}\n`;
}
