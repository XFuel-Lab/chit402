#!/usr/bin/env node
/**
 * Mutation runner for the v13 verify path.
 *
 *   node packages/verify/src/v13/run-mutants.mjs [repo-root]
 *
 * Each mutant is a literal find/replace. The v13 suite must pass first.
 * A mutant whose suite fails is killed. One that still passes survived.
 * A find that misses is not applied. The score is killed / (killed + survived).
 * The run fails below 90%.
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

const spec = JSON.parse(readFileSync(join(HERE, 'mutants.json'), 'utf8'));
const mutants = spec.mutants.filter((mutant) => only.size === 0 || only.has(mutant.id));
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
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, 120000);
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { out += chunk; });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveRun(code === 0);
    });
  });
}

const verifyDir = join(root, 'packages/verify');
const baseline = await run(spec.suite.argv, verifyDir) && await run(spec.test, verifyDir);
if (!baseline) {
  process.stderr.write('v13 suite failed before mutants\n');
  process.exit(1);
}

let killed = 0;
let survived = 0;
let skipped = 0;
for (const mutant of mutants) {
  const abs = join(root, mutant.file);
  const before = sha256(abs);
  if (!applyMutant(mutant)) {
    skipped += 1;
    process.stdout.write(`NOT_APPLIED ${mutant.id}\n`);
    continue;
  }
  const compiled = await run(spec.suite.argv, verifyDir);
  const passed = compiled && await run(spec.test, verifyDir);
  restoreAll();
  if (sha256(abs) !== before) {
    process.stderr.write(`restore failed ${mutant.id}\n`);
    process.exit(1);
  }
  if (passed) {
    survived += 1;
    process.stdout.write(`SURVIVED ${mutant.id}\n`);
  } else {
    killed += 1;
    process.stdout.write(`KILLED ${mutant.id}\n`);
  }
}

const scored = killed + survived;
const score = scored === 0 ? 0 : killed / scored;
process.stdout.write(`killed ${killed} survived ${survived} not_applied ${skipped} score ${(score * 100).toFixed(1)}%\n`);
if (score < 0.9) process.exit(1);
