import { resolve } from 'node:path';

/**
 * Second reporter for run-tests.mjs. Writes one JSON line per finished test
 * file. Node 20 and 22 flatten each file's tests into the top-level TAP and
 * print no `ok N - <file>` line for a passing file, so TAP text cannot say
 * which files finished; the file-level test:complete / test:fail events can.
 * The file-level event's name is the absolute path on Node 20 and the path as
 * passed (test/x.test.mjs) on Node 22, so compare resolved paths.
 */
export default async function* fileDoneReporter(source) {
  for await (const event of source) {
    if (event.type !== 'test:complete' && event.type !== 'test:fail') continue;
    const d = event.data || {};
    if (d.nesting !== 0 || !d.file || resolve(String(d.name)) !== d.file) continue;
    const passed = event.type === 'test:complete' ? d.details?.passed !== false : false;
    yield `${JSON.stringify({ file: d.file, passed })}\n`;
  }
}
