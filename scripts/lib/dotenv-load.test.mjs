/**
 * Root .env loading ignores the DOTENV_* environment (scripts/lib/dotenv-load.cjs).
 *
 * hardhat.config.cjs and scripts/verify-deployment.cjs read
 * DEPLOYER_PRIVATE_KEY / PRIVATE_KEY. dotenv 18 fills options a caller leaves
 * out from DOTENV_PATH, DOTENV_OVERRIDE, DOTENV_QUIET, DOTENV_DEBUG,
 * DOTENV_ENCODING and DOTENV_FAST (DOTENV_CONFIG_* as fallbacks). These tests
 * run the real loader in child processes with all of them set, in the
 * environment and as lines inside the .env files, and check that exported
 * values stay, the decoy file is not read, and no value is ever logged.
 * Dummy values only. They pass on root dotenv 17 and on 18.
 *
 * Layout: 5 child-process tests (one a control that runs plain
 * dotenv.config() to show the hostile switches are live), 1 in-process test,
 * 1 scanner self-test and 2 static scans. The scans are a tripwire, not a
 * proof: they flag any require()/import() whose specifier is not one plain
 * string literal (e.g. require('dot' + 'env')), and any createRequire or
 * module.require, but code built at runtime (eval, new Function) cannot be
 * seen statically. The behavioural tests are the real guard.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const HELPER = path.join(here, 'dotenv-load.cjs');
const rootRequire = createRequire(path.join(repoRoot, 'package.json'));
const DOTENV_MAJOR = Number(rootRequire('dotenv/package.json').version.split('.')[0]);
const DOTENV_ENTRY = rootRequire.resolve('dotenv');

/** Made-up values. Neither may show up in any child's stdout or stderr. */
const MARKER = 's3-marker-4c1d9e7a2b';
const DUMMY_KEY_BASH = 'dummy-deployer-key-from-bash';
const DUMMY_KEY_FILE = `dummy-deployer-key-from-file-${MARKER}`;

const HOSTILE_FILE_LINES = [
  'DOTENV_CONFIG_QUIET=false',
  'DOTENV_CONFIG_DEBUG=true',
  'DOTENV_CONFIG_FAST=true',
  'DOTENV_QUIET=false',
  'DOTENV_DEBUG=true',
  'DOTENV_FAST=true',
  'DOTENV_OVERRIDE=true',
  'DOTENV_CONFIG_OVERRIDE=true',
];

function fixture({ hostileLines = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'root-dotenv-pin-'));
  const extra = hostileLines ? HOSTILE_FILE_LINES : [];
  fs.writeFileSync(path.join(dir, '.env.local'), [
    `DEPLOYER_PRIVATE_KEY=${DUMMY_KEY_FILE}`,
    'BOTH_FILES_KEY=from-env-local',
    `SECRET_MARKER_KEY=${MARKER}`,
    ...extra,
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(dir, '.env'), [
    `PRIVATE_KEY=${DUMMY_KEY_FILE}`,
    'BOTH_FILES_KEY=from-env',
    'ENV_ONLY_KEY=from-env',
    'EMPTY_PRESET_KEY=from-env',
    'UTF8_KEY=caf\u00e9',
    ...extra,
  ].join('\n') + '\n');
  const other = path.join(dir, 'other.env');
  fs.writeFileSync(other, `DEPLOYER_PRIVATE_KEY=${DUMMY_KEY_FILE}\nOTHER_ONLY_KEY=from-other\n`);
  return { dir, other };
}

function hostileEnv(other) {
  return {
    DOTENV_OVERRIDE: 'true',
    DOTENV_CONFIG_OVERRIDE: 'true',
    DOTENV_PATH: other,
    DOTENV_CONFIG_PATH: other,
    DOTENV_ENCODING: 'latin1',
    DOTENV_CONFIG_ENCODING: 'latin1',
    DOTENV_FAST: 'true',
    DOTENV_CONFIG_FAST: 'true',
    DOTENV_QUIET: 'false',
    DOTENV_CONFIG_QUIET: 'false',
    DOTENV_DEBUG: 'true',
    DOTENV_CONFIG_DEBUG: 'true',
    DOTENV_KEY: 'dotenv://:key_0000000000000000000000000000000000000000000000000000000000000000@dotenvx.com/vault/.env.vault?environment=production',
  };
}

function hostileEnv18Names(other) {
  const env = hostileEnv(other);
  for (const k of Object.keys(env)) if (k.startsWith('DOTENV_CONFIG_')) delete env[k];
  return env;
}

/** Exported by the shell before the load. */
const EXPORTED = { DEPLOYER_PRIVATE_KEY: DUMMY_KEY_BASH, PRIVATE_KEY: '', EMPTY_PRESET_KEY: '' };

/** Prints booleans and non-secret values only, never a key value. */
const PRINT = `console.log('RESULT=' + JSON.stringify({
  deployerKeptBash: process.env.DEPLOYER_PRIVATE_KEY === ${JSON.stringify(DUMMY_KEY_BASH)},
  privateKeyEmpty: process.env.PRIVATE_KEY === '',
  emptyPreset: process.env.EMPTY_PRESET_KEY ?? null,
  both: process.env.BOTH_FILES_KEY ?? null,
  envOnly: process.env.ENV_ONLY_KEY ?? null,
  otherOnly: process.env.OTHER_ONLY_KEY ?? null,
  utf8: process.env.UTF8_KEY ?? null,
  markerLoaded: process.env.SECRET_MARKER_KEY === ${JSON.stringify(MARKER)},
}));`;

function runChild(body, { cwd, env }) {
  const res = spawnSync(process.execPath, ['--input-type=commonjs', '-e', body], {
    cwd,
    env: { PATH: process.env.PATH, TMPDIR: os.tmpdir(), ...env },
    encoding: 'utf8',
    timeout: 60_000,
  });
  const out = `${res.stdout}${res.stderr}`;
  assert.ok(!out.includes(MARKER), 'a .env value appeared in child output');
  assert.ok(!out.includes(DUMMY_KEY_BASH), 'the exported key value appeared in child output');
  return res;
}

function result(res) {
  assert.equal(res.status, 0, `child failed: ${res.stderr}`);
  const line = res.stdout.split('\n').find((l) => l.startsWith('RESULT='));
  assert.ok(line, `child printed no result: ${res.stdout}`);
  return JSON.parse(line.slice('RESULT='.length));
}

function assertOnlyCountsAndPaths(res, { switchesLive }) {
  if (DOTENV_MAJOR < 18 && switchesLive) {
    assert.ok(/inject(?:ed|ing) env \(\d+\)/.test(res.stdout), 'dotenv 17 did not see the hostile logging switches; this test is not exercising them');
  }
  const lines = `${res.stdout}\n${res.stderr}`.split('\n').filter((l) => l.trim() !== '' && !l.startsWith('RESULT='));
  if (DOTENV_MAJOR >= 18) {
    assert.deepEqual(lines, [], `dotenv ${DOTENV_MAJOR} logged: ${lines.join(' | ')}`);
    return;
  }
  for (const line of lines) {
    const plain = line.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(
      /inject(?:ed|ing) env \(\d+\) from \S+( (?:\/\/|--) tip: .*)?$/.test(plain) || /failed to load \S+ ENOENT/i.test(plain),
      `dotenv 17 logged more than counts and paths: ${plain}`,
    );
    for (const key of ['DEPLOYER_PRIVATE_KEY', 'PRIVATE_KEY', 'SECRET_MARKER_KEY', 'BOTH_FILES_KEY']) {
      assert.ok(!plain.includes(key), `dotenv 17 logged key name ${key}`);
    }
  }
}

const LOAD = `require(${JSON.stringify(HELPER)}).loadRootEnv();`;

test('loadRootEnv: hostile DOTENV_* in env and in the files do not overwrite exported keys or pick another file', () => {
  const { dir, other } = fixture();
  try {
    const res = runChild(`${LOAD}\n${PRINT}`, { cwd: dir, env: { ...EXPORTED, ...hostileEnv(other) } });
    const out = result(res);
    assert.equal(out.deployerKeptBash, true, 'DEPLOYER_PRIVATE_KEY from the shell was overwritten');
    assert.equal(out.privateKeyEmpty, true, 'an exported empty PRIVATE_KEY was overwritten');
    assert.equal(out.emptyPreset, '', 'an exported empty value was overwritten');
    assert.equal(out.both, 'from-env-local', '.env.local no longer wins over .env');
    assert.equal(out.envOnly, 'from-env', './.env was not loaded');
    assert.equal(out.markerLoaded, true, './.env.local was not loaded');
    assert.equal(out.otherOnly, null, 'the DOTENV_PATH file was loaded');
    assert.equal(out.utf8, 'caf\u00e9', 'DOTENV_ENCODING changed how the file was decoded');
    assertOnlyCountsAndPaths(res, { switchesLive: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadRootEnv: DOTENV_* lines only inside the files (clean env) change nothing and log no value', () => {
  const { dir } = fixture();
  try {
    const res = runChild(`${LOAD}\n${PRINT}`, { cwd: dir, env: { ...EXPORTED } });
    const out = result(res);
    assert.equal(out.deployerKeptBash, true, 'DOTENV_OVERRIDE inside a file overwrote DEPLOYER_PRIVATE_KEY');
    assert.equal(out.privateKeyEmpty, true);
    assert.equal(out.both, 'from-env-local');
    assertOnlyCountsAndPaths(res, { switchesLive: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadRootEnv: the dotenv 18 names alone log nothing on 17 or 18, and missing files are not an error', () => {
  const { dir, other } = fixture({ hostileLines: false });
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'root-dotenv-empty-'));
  try {
    const res = runChild(`${LOAD}\n${PRINT}`, { cwd: dir, env: { ...EXPORTED, ...hostileEnv18Names(other) } });
    assert.equal(result(res).deployerKeptBash, true);
    assert.equal(res.stdout.split('\n').filter((l) => l && !l.startsWith('RESULT=')).join('\n'), '', `stdout: ${res.stdout}`);
    assert.equal(res.stderr, '', `stderr: ${res.stderr}`);
    const missing = runChild(`const r = require(${JSON.stringify(HELPER)}).loadRootEnv();
      console.log('RESULT=' + JSON.stringify(r.map((x) => x.error && x.error.code)));`, { cwd: empty, env: hostileEnv18Names(other) });
    assert.equal(missing.status, 0, missing.stderr);
    assert.equal(missing.stdout.trim(), 'RESULT=["ENOENT","ENOENT"]');
    assert.equal(missing.stderr, '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test('control: the same hostile env does reach the old bare dotenv calls (so the tests above exercise live switches)', () => {
  const { dir, other } = fixture();
  try {
    const body = `const dotenv = require(${JSON.stringify(DOTENV_ENTRY)});
      dotenv.config({ path: '.env.local' });
      dotenv.config();
      ${PRINT}`;
    const res = runChild(body, { cwd: dir, env: { ...EXPORTED, ...hostileEnv(other) } });
    const out = result(res);
    if (DOTENV_MAJOR >= 18) {
      assert.equal(out.deployerKeptBash, false, 'DOTENV_OVERRIDE did not reach dotenv 18 config()');
      assert.equal(out.otherOnly, 'from-other', 'DOTENV_PATH did not reach dotenv 18 config()');
      assert.ok(/injected env/.test(res.stderr), 'DOTENV_QUIET=false did not reach dotenv 18 config()');
      assert.ok(/"DEPLOYER_PRIVATE_KEY" is already defined/.test(res.stdout), 'DOTENV_DEBUG did not reach dotenv 18 config()');
    } else {
      assert.ok(/inject(?:ed|ing) env/.test(res.stdout), 'DOTENV_CONFIG_QUIET=false did not reach dotenv 17 config()');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('control: on dotenv 17 the old bare config() takes the DOTENV_KEY vault branch; loadRootEnv does not', () => {
  const { dir, other } = fixture({ hostileLines: false });
  try {
    const env = { ...EXPORTED, DOTENV_KEY: hostileEnv(other).DOTENV_KEY };
    const old = runChild(`require(${JSON.stringify(DOTENV_ENTRY)}).config();`, { cwd: dir, env });
    const pinned = runChild(LOAD, { cwd: dir, env });
    assert.equal(pinned.status, 0, pinned.stderr);
    assert.equal(`${pinned.stdout}${pinned.stderr}`, '', 'loadRootEnv logged with DOTENV_KEY set');
    if (DOTENV_MAJOR < 18) {
      assert.ok(/\.env\.vault/.test(`${old.stdout}${old.stderr}`), 'dotenv 17 config() did not take the vault branch');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('helper: pinned options are frozen, an empty path throws', () => {
  const { DOTENV_LOAD_OPTIONS, loadDotenvFile } = rootRequire('./scripts/lib/dotenv-load.cjs');
  assert.deepEqual({ ...DOTENV_LOAD_OPTIONS }, {
    override: false, quiet: true, debug: false, encoding: 'utf8', fast: false,
  });
  assert.ok(Object.isFrozen(DOTENV_LOAD_OPTIONS), 'DOTENV_LOAD_OPTIONS is not frozen');
  assert.throws(() => loadDotenvFile(''), TypeError);
  assert.throws(() => loadDotenvFile(undefined), TypeError);
});

/** Lookahead body: whitespace, one string literal with no `${`, then `,` or `)`. */
const PLAIN_LITERAL_ARG = String.raw`\s*(['"\x60])(?:(?!\1)(?!\$\{)[^\n\\])*\1\s*[,)]`;

/** Loads a static scan cannot resolve: a computed specifier, createRequire, module.require. */
function computedLoads(src) {
  const hits = [];
  if (new RegExp(String.raw`(?<![.\w$])(?:import|require)\s*\((?!${PLAIN_LITERAL_ARG})(?!\s*\))`).test(src)) hits.push('computed');
  if (/\bcreateRequire\b/.test(src)) hits.push('createRequire');
  if (/\bmodule\s*\.\s*require\s*\(/.test(src)) hits.push('module.require');
  return hits;
}

test('scanner self-test: computed and indirect requires are flagged, plain literals are not', () => {
  const bad = [
    "require('dot' + 'env').config({ override: true })",
    "const n = 'dotenv'.slice(0); require(n).config()",
    'require(`dot${"env"}`).config()',
    "const m = await import('dot'.concat('env'))",
    "const { createRequire: cr } = require('module'); cr(__filename)(x)",
    "module.require(x)",
  ];
  for (const src of bad) assert.ok(computedLoads(src).length > 0, `scan missed: ${src}`);
  const ok = [
    "require('ethers')",
    "const { subtask } = require('hardhat/config')",
    "try { require('hardhat-tracer') } catch (_) {}",
    "/** @type {import('hardhat/config').HardhatUserConfig} */",
    "require(\n  './x.cjs'\n)",
  ];
  for (const src of ok) assert.deepEqual(computedLoads(src), [], `scan over-flagged: ${src}`);
});

test('scan (tripwire): the two key-reading files load env only through loadRootEnv', () => {
  const sites = [
    ['hardhat.config.cjs', /^require\('\.\/scripts\/lib\/dotenv-load\.cjs'\)\.loadRootEnv\(\)$/m],
    ['scripts/verify-deployment.cjs', /^require\('\.\/lib\/dotenv-load\.cjs'\)\.loadRootEnv\(\)$/m],
  ];
  for (const [rel, re] of sites) {
    const src = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    assert.ok(re.test(src), `${rel}: loadRootEnv() call missing or changed`);
    assert.ok(!/(['"`])dotenv(?:\/[^'"`\s]*)?\1/.test(src), `${rel} references the dotenv package directly`);
    assert.ok(!/\bdotenv\s*\.\s*config\s*\(|\.config\s*\(\s*\{\s*path/.test(src), `${rel} calls dotenv config()`);
    assert.deepEqual(computedLoads(src), [], `${rel} has a load the scan cannot resolve (computed specifier, createRequire or module.require)`);
    const firstCode = src.split('\n').find((l) => /^\s*(?:require|const|let|var|import)\b/.test(l));
    assert.ok(/loadRootEnv\(\)/.test(firstCode ?? ''), `${rel}: env must load before any other require (first was: ${firstCode})`);
  }
});

test('scan (tripwire): the helper calls configDotenv with the pinned options', () => {
  const src = fs.readFileSync(HELPER, 'utf8');
  assert.ok(/return dotenv\.configDotenv\(\{ \.\.\.DOTENV_LOAD_OPTIONS, path: file \}\)/.test(src), 'helper does not call configDotenv with the pinned options and an explicit path');
  assert.ok(/override: false,/.test(src), 'override: false missing');
  assert.ok(/quiet: true,/.test(src), 'quiet: true missing');
  assert.ok(/debug: false,/.test(src), 'debug: false missing');
  assert.ok(!/\bdotenv\.config\(/.test(src), 'helper calls dotenv.config()');
  assert.ok(/path\.resolve\(cwd, '\.env\.local'\)\),\s*\n\s*loadDotenvFile\(path\.resolve\(cwd, '\.env'\)\)/.test(src), 'load order changed: .env.local must load before .env');
});
