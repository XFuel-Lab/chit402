#!/usr/bin/env node
/**
 * Record the golden corpus baseline. Local only, never run in CI.
 *
 *   npm run build
 *   node test/corpus/record.mjs              # public tier: tape + baseline
 *   node test/corpus/record.mjs --private <dir> --files <list.txt>
 *                                             # local tier, kept off the repo
 *
 * Network: GET to the public receipt hosts only (see tape-preload.mjs).
 * No POST of any kind; chain JSON-RPC is recorded as not answered.
 * The baseline is what the current build does under replay of that tape.
 * Re-recording replaces the baseline: do it only through the recorded path
 * in README.md, never to make a failing corpus pass.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { corpusDir, runPath, pinned } from './lib.mjs';
import { buildSynthetic } from './synthetic.mjs';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const privateDir = opt('--private');
const BLOCKED = /1e57cdd7/i;

function record(cases, tape, out) {
  process.env.CHIT_CORPUS_MODE = 'record';
  const recorded = {};
  for (const c of cases) {
    for (const path of c.paths || ['cli']) {
      const o = runPath(c, path, tape);
      recorded[`${c.id}|${path}`] = pinned(o);
      process.stdout.write(`${c.id}|${path}\t${o.exit}\t${o.result} ${o.reason}\n`);
    }
  }
  // Replay once and require the same outcome: the tape must be complete.
  process.env.CHIT_CORPUS_MODE = 'replay';
  let unstable = 0;
  for (const c of cases) {
    for (const path of c.paths || ['cli']) {
      const o = runPath(c, path, tape);
      const key = `${c.id}|${path}`;
      if (JSON.stringify(pinned(o)) !== JSON.stringify(recorded[key])) {
        unstable += 1;
        process.stdout.write(`UNSTABLE ${key}\n  record ${JSON.stringify(recorded[key])}\n  replay ${JSON.stringify(pinned(o))}\n`);
        recorded[key] = pinned(o);
      }
    }
  }
  writeFileSync(out, `${JSON.stringify(recorded, null, 1)}\n`);
  return unstable;
}

if (privateDir) {
  // Local tier: holder documents carry payer fields, so they stay off the repo.
  const list = readFileSync(opt('--files'), 'utf8').trim().split('\n').filter((f) => f && !BLOCKED.test(f));
  mkdirSync(join(privateDir, 'files'), { recursive: true });
  const cases = list.map((src, i) => {
    const hash = createHash('sha256').update(readFileSync(src)).digest('hex').slice(0, 12);
    const file = join(privateDir, 'files', `${hash}.json`);
    if (!existsSync(file)) copyFileSync(src, file);
    return { id: `private-${String(i + 1).padStart(2, '0')}-${hash}`, kind: 'file', file, paths: ['cli'] };
  });
  writeFileSync(join(privateDir, 'manifest.json'), `${JSON.stringify({ cases: cases.map(({ id, file }) => ({ id, file: file.slice(privateDir.length + 1) })) }, null, 1)}\n`);
  const tape = join(privateDir, 'tape.json');
  const unstable = record(cases, tape, join(privateDir, 'baseline.json'));
  console.log(`private tier: ${cases.length} cases, unstable ${unstable}`);
} else {
  const manifest = JSON.parse(readFileSync(join(corpusDir, 'manifest.json'), 'utf8'));
  for (const c of [...manifest.ids, ...manifest.files]) {
    if (BLOCKED.test(JSON.stringify(c))) throw new Error(`blocked receipt in manifest: ${c.id}`);
  }
  const cases = [
    ...manifest.ids.map((c) => ({ ...c, kind: 'id', paths: ['cli'] })),
    ...manifest.files.map((c) => ({ ...c, kind: 'file', file: join(corpusDir, '..', 'fixtures', c.fixture), paths: ['cli'] })),
    ...(await buildSynthetic(mkdtempSync(join(tmpdir(), 'corpus-syn-')))),
  ];
  const tape = join(corpusDir, 'tapes', 'public.json');
  mkdirSync(join(corpusDir, 'tapes'), { recursive: true });
  const unstable = record(cases, tape, join(corpusDir, 'baseline.json'));
  console.log(`public tier: ${cases.length} cases, unstable ${unstable}`);
}
