#!/usr/bin/env node
/**
 * Mutation runner for the v13 verify path.
 *
 *   node packages/verify/src/v13/run-mutants.mjs [repo-root]
 *
 * Each mutant is a literal find/replace. The v13 suite must pass first.
 * A mutant whose suite fails on an assertion is killed. One that still passes survived.
 * A find that misses is not applied. Equivalents are listed and left out of the score.
 * The score is killed / (killed + survived). The run fails below 90%, or if a find misses.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const only = new Set((args.includes('--only') ? args[args.indexOf('--only') + 1] : '').split(',').filter(Boolean));

function findRoot(start) {
  let dir = resolve(start);
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return dir;
    dir = dirname(dir);
  }
  return null;
}

const rootArg = args.find((arg) => !arg.startsWith('--'));
const root = rootArg ? resolve(rootArg) : findRoot(HERE);
if (!root) {
  process.stderr.write('usage: node run-mutants.mjs [repo-root]\n');
  process.exit(2);
}

const specPath = args.includes('--spec') ? resolve(args[args.indexOf('--spec') + 1]) : join(HERE, 'mutants.json');
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const mutants = spec.mutants.filter((mutant) => only.size === 0 || only.has(mutant.id));
const equivalents = (spec.equivalents ?? []).filter((item) => only.size === 0 || only.has(item.id));
const originals = new Map();

function restoreAll() {
  for (const [abs, text] of originals) writeFileSync(abs, text);
  originals.clear();
}

process.on('exit', () => { restoreAll(); });
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { restoreAll(); process.exit(130); });
}

function sha256(abs) {
  return createHash('sha256').update(readFileSync(abs)).digest('hex');
}

function applyMutant(mutant) {
  const abs = join(root, mutant.file);
  const text = readFileSync(abs, 'utf8');
  if (text.split(mutant.find).length - 1 !== 1) return false;
  const next = text.replace(mutant.find, mutant.replace);
  if (next === text) return false;
  originals.set(abs, text);
  writeFileSync(abs, next);
  return true;
}

function run(argv, cwd) {
  return new Promise((resolveRun) => {
    const child = spawn(argv[0], argv.slice(1), { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, 180000);
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { out += chunk; });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveRun({ ok: code === 0, out });
    });
  });
}

function hollowFailure(compiled, tested) {
  if (!compiled.ok) return true;
  if (tested.ok) return false;
  return !/AssertionError|ERR_ASSERTION/.test(tested.out);
}

const verifyDir = join(root, 'packages/verify');
const baselineCompile = await run(spec.suite.argv, verifyDir);
const baselineTest = baselineCompile.ok ? await run(spec.test, verifyDir) : { ok: false, out: '' };
if (!baselineCompile.ok || !baselineTest.ok) {
  process.stderr.write('v13 suite failed before mutants\n');
  process.stderr.write(baselineCompile.out);
  process.stderr.write(baselineTest.out);
  process.exit(1);
}

let killed = 0;
let survived = 0;
let skipped = 0;
let hollow = 0;
let equivalent = 0;
for (const item of equivalents) {
  const text = readFileSync(join(root, item.file), 'utf8');
  if (text.split(item.find).length - 1 !== 1) {
    skipped += 1;
    process.stdout.write(`NOT_APPLIED ${item.id}\n`);
    continue;
  }
  equivalent += 1;
  process.stdout.write(`EQUIVALENT ${item.id} ${item.note}\n`);
}
for (const mutant of mutants) {
  const abs = join(root, mutant.file);
  const before = sha256(abs);
  if (!applyMutant(mutant)) {
    skipped += 1;
    process.stdout.write(`NOT_APPLIED ${mutant.id}\n`);
    continue;
  }
  const compiled = await run(spec.suite.argv, verifyDir);
  const tested = compiled.ok ? await run(spec.test, verifyDir) : { ok: false, out: '' };
  restoreAll();
  if (sha256(abs) !== before) {
    process.stderr.write(`restore failed ${mutant.id}\n`);
    process.exit(1);
  }
  const passed = compiled.ok && tested.ok;
  if (passed) {
    survived += 1;
    process.stdout.write(`SURVIVED ${mutant.id}\n`);
  } else if (hollowFailure(compiled, tested)) {
    hollow += 1;
    survived += 1;
    process.stdout.write(`HOLLOW ${mutant.id}\n`);
  } else {
    killed += 1;
    process.stdout.write(`KILLED ${mutant.id}\n`);
  }
}

const scored = killed + survived;
const score = scored === 0 ? 0 : killed / scored;
process.stdout.write(`killed ${killed} survived ${survived} hollow ${hollow} equivalent ${equivalent} not_applied ${skipped} score ${(score * 100).toFixed(1)}%\n`);
if (skipped > 0 || score < 0.9) process.exit(1);
