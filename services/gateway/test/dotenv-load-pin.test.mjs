/**
 * .env loading ignores the DOTENV_* environment (src/dotenv-load.js).
 *
 * dotenv 18 fills options a caller leaves out from DOTENV_PATH,
 * DOTENV_OVERRIDE, DOTENV_QUIET, DOTENV_DEBUG, DOTENV_ENCODING and DOTENV_FAST
 * (DOTENV_CONFIG_* as fallbacks). The prod service exports every .env line
 * from bash, so these tests run the real loaders in a child process with those
 * variables set and check that exported values stay, the named other file is
 * not read, and no value is ever logged. They pass on dotenv 17 and 18.
 * Offline: temp files and child processes only.
 *
 * Layout: 7 child-process tests (one a control that runs plain
 * dotenv.config() to show the hostile switches are live), 1 in-process test,
 * 2 scanner self-tests and 4 source/launch-config scans. The scans are a tripwire, not a proof: a
 * static scan cannot follow every computed specifier, so it flags any
 * import()/require() whose argument is not a plain string literal and keeps a
 * reviewed allowlist of those, rather than claiming to resolve them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const gatewayDir = path.join(here, '..');
const HELPER = path.join(gatewayDir, 'src', 'dotenv-load.js');
const CONFIG = path.join(gatewayDir, 'src', 'config.js');
const gatewayRequire = createRequire(path.join(gatewayDir, 'package.json'));
const DOTENV_MAJOR = Number(gatewayRequire('dotenv/package.json').version.split('.')[0]);
/** The gateway's own dotenv entry, for the control child (its cwd is a temp dir). */
const DOTENV_ENTRY = pathToFileURL(gatewayRequire.resolve('dotenv')).href;

/** A made-up secret. It must never show up in any child's stdout or stderr. */
const MARKER = 'pin660-marker-7f3a9c1e5d2b4806';

/**
 * Logging switches dotenv 17 re-reads from process.env after it populates,
 * so as lines inside .env they reach it too. dotenv 18 reads the DOTENV_ and
 * DOTENV_CONFIG_ names from process.env only for options left out.
 */
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

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dotenv-pin-'));
}

/** A cwd with .env and a decoy other.env that DOTENV_PATH points at. */
function fixture({ withEnvFile = true, hostileLines = true } = {}) {
  const dir = tmpDir();
  if (withEnvFile) {
    const lines = [
      'SHARED_KEY=from-env-file',
      'FILE_ONLY_KEY=from-env-file',
      'EMPTY_PRESET_KEY=from-env-file',
      `SECRET_MARKER_KEY=${MARKER}`,
      'UTF8_KEY=caf\u00e9',
      ...(hostileLines ? HOSTILE_FILE_LINES : []),
    ];
    fs.writeFileSync(path.join(dir, '.env'), `${lines.join('\n')}\n`);
  }
  const other = path.join(dir, 'other.env');
  fs.writeFileSync(other, 'SHARED_KEY=from-other-file\nOTHER_ONLY_KEY=from-other-file\n');
  return { dir, other };
}

/** Every env-driven option dotenv 17 or 18 reads, set to the hostile value. */
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
    // dotenv 17 config() switches to .env.vault when this is set.
    DOTENV_KEY: 'dotenv://:key_0000000000000000000000000000000000000000000000000000000000000000@dotenvx.com/vault/.env.vault?environment=production',
  };
}

/** Only the dotenv 18 names: neither version may log anything. */
function hostileEnv18Names(other) {
  const env = hostileEnv(other);
  for (const k of Object.keys(env)) if (k.startsWith('DOTENV_CONFIG_')) delete env[k];
  return env;
}

/** Exported by "bash" before the load: one real value, one empty string. */
const EXPORTED = { SHARED_KEY: 'from-bash', EMPTY_PRESET_KEY: '' };

/** Run `body` (an ES module source) in a child with only `env` set. */
function runChild(body, { cwd, env }) {
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', body], {
    cwd,
    env: { PATH: process.env.PATH, TMPDIR: os.tmpdir(), NODE_ENV: 'test', ...env },
    encoding: 'utf8',
    timeout: 60_000,
  });
  assert.ok(!`${res.stdout}${res.stderr}`.includes(MARKER), 'a .env value appeared in child output');
  return res;
}

/**
 * dotenv 17 still ORs DOTENV_CONFIG_DEBUG/QUIET (env or .env lines) into its
 * logging. Through the helper that is at most the counts-and-paths line and
 * a failed-to-load path, never a key name or value. dotenv 18 logs nothing.
 */
function assertOnlyCountsAndPaths(res, { switchesLive }) {
  if (DOTENV_MAJOR < 18 && switchesLive) {
    // Proves the hostile DOTENV_CONFIG_QUIET/DEBUG actually reached dotenv 17.
    assert.ok(/injected env \(\d+\)/.test(res.stdout), 'dotenv 17 did not see the hostile logging switches; this test is not exercising them');
  }
  const lines = `${res.stdout}\n${res.stderr}`.split('\n').filter((l) => l.trim() !== '' && !l.startsWith('RESULT='));
  if (DOTENV_MAJOR >= 18) {
    assert.deepEqual(lines, [], `dotenv ${DOTENV_MAJOR} logged: ${lines.join(' | ')}`);
    return;
  }
  for (const line of lines) {
    const plain = line.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(
      /injected env \(\d+\) from \S+( \/\/ tip: .*)?$/.test(plain) || /failed to load \S+ ENOENT/.test(plain),
      `dotenv 17 logged more than counts and paths: ${plain}`,
    );
    for (const key of ['SHARED_KEY', 'FILE_ONLY_KEY', 'EMPTY_PRESET_KEY', 'SECRET_MARKER_KEY', 'UTF8_KEY']) {
      assert.ok(!plain.includes(key), `dotenv 17 logged key name ${key}`);
    }
  }
}

const PRINT = `console.log('RESULT=' + JSON.stringify({
  shared: process.env.SHARED_KEY ?? null,
  fileOnly: process.env.FILE_ONLY_KEY ?? null,
  otherOnly: process.env.OTHER_ONLY_KEY ?? null,
  utf8: process.env.UTF8_KEY ?? null,
  emptyPreset: process.env.EMPTY_PRESET_KEY ?? null,
  markerLoaded: process.env.SECRET_MARKER_KEY === ${JSON.stringify(MARKER)},
}));`;

function result(res) {
  assert.equal(res.status, 0, `child failed: ${res.stderr}`);
  const line = res.stdout.split('\n').find((l) => l.startsWith('RESULT='));
  assert.ok(line, `child printed no result: ${res.stdout}`);
  return JSON.parse(line.slice('RESULT='.length));
}

test('loadDotenvFile: DOTENV_OVERRIDE/PATH/ENCODING/KEY do not overwrite exported values or pick another file', () => {
  const { dir, other } = fixture();
  try {
    const body = `import { loadDotenvFile } from ${JSON.stringify(pathToFileURL(HELPER).href)};
      const r = loadDotenvFile(${JSON.stringify(path.join(dir, '.env'))});
      if (r.error) throw r.error;
      ${PRINT}`;
    const res = runChild(body, { cwd: dir, env: { ...EXPORTED, ...hostileEnv(other) } });
    const out = result(res);
    assert.equal(out.shared, 'from-bash', 'an exported value was overwritten from a .env file');
    assert.equal(out.emptyPreset, '', 'an exported empty value was overwritten from a .env file');
    assert.equal(out.fileOnly, 'from-env-file', 'the named .env file was not loaded');
    assert.equal(out.markerLoaded, true, 'the marker line was not loaded');
    assert.equal(out.otherOnly, null, 'the DOTENV_PATH file was loaded');
    assert.equal(out.utf8, 'caf\u00e9', 'DOTENV_ENCODING changed how the file was decoded');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadDotenvFile: DOTENV_QUIET=false and DOTENV_DEBUG=true (18 names) log nothing on 17 or 18', () => {
  const { dir, other } = fixture({ hostileLines: false });
  try {
    const body = `import { loadDotenvFile } from ${JSON.stringify(pathToFileURL(HELPER).href)};
      loadDotenvFile(${JSON.stringify(path.join(dir, '.env'))});
      loadDotenvFile(${JSON.stringify(path.join(dir, 'missing.env'))});`;
    const res = runChild(body, { cwd: dir, env: { ...EXPORTED, ...hostileEnv18Names(other) } });
    assert.equal(res.status, 0, `child failed: ${res.stderr}`);
    assert.equal(res.stdout, '', `dotenv wrote to stdout: ${res.stdout}`);
    assert.equal(res.stderr, '', `dotenv wrote to stderr: ${res.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadDotenvFile: DOTENV_CONFIG_QUIET/DEBUG/FAST in env and in .env log no value (17: counts and paths only; 18: nothing)', () => {
  const { dir, other } = fixture();
  try {
    const body = `import { loadDotenvFile } from ${JSON.stringify(pathToFileURL(HELPER).href)};
      loadDotenvFile(${JSON.stringify(path.join(dir, '.env'))});
      loadDotenvFile(${JSON.stringify(path.join(dir, 'missing.env'))});
      ${PRINT}`;
    const res = runChild(body, { cwd: dir, env: { ...EXPORTED, ...hostileEnv(other) } });
    const out = result(res);
    assert.equal(out.shared, 'from-bash');
    assert.equal(out.emptyPreset, '');
    assert.equal(out.markerLoaded, true);
    assertOnlyCountsAndPaths(res, { switchesLive: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('control: the same hostile env does reach a plain dotenv.config({ path }) (so the tests above exercise live switches)', () => {
  const { dir, other } = fixture();
  try {
    const body = `import dotenv from ${JSON.stringify(DOTENV_ENTRY)};
      dotenv.config({ path: ${JSON.stringify(path.join(dir, '.env'))} });
      ${PRINT}`;
    const res = runChild(body, { cwd: dir, env: { ...EXPORTED, ...hostileEnv(other) } });
    const out = result(res);
    if (DOTENV_MAJOR >= 18) {
      assert.ok(/"SHARED_KEY" is already defined/.test(res.stdout), 'DOTENV_DEBUG did not reach dotenv 18 config()');
      assert.ok(/injected env/.test(res.stderr), 'DOTENV_QUIET=false did not reach dotenv 18 config()');
      assert.equal(out.shared, 'from-env-file', 'DOTENV_OVERRIDE did not reach dotenv 18 config()');
    } else {
      assert.ok(/injected env/.test(res.stdout), 'DOTENV_CONFIG_QUIET=false did not reach dotenv 17 config()');
      assert.equal(out.shared, 'from-bash');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadDotenvFile: DOTENV_CONFIG_* lines only inside .env (clean env) log no value', () => {
  const { dir } = fixture();
  try {
    const body = `import { loadDotenvFile } from ${JSON.stringify(pathToFileURL(HELPER).href)};
      loadDotenvFile(${JSON.stringify(path.join(dir, '.env'))});
      ${PRINT}`;
    const res = runChild(body, { cwd: dir, env: { ...EXPORTED } });
    const out = result(res);
    assert.equal(out.shared, 'from-bash', 'DOTENV_OVERRIDE inside .env overwrote an exported value');
    assert.equal(out.emptyPreset, '', 'DOTENV_OVERRIDE inside .env overwrote an exported empty value');
    assert.equal(out.markerLoaded, true);
    assertOnlyCountsAndPaths(res, { switchesLive: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('src/config.js: loads ./.env from cwd, keeps exported values, ignores DOTENV_PATH', () => {
  const { dir, other } = fixture();
  try {
    const body = `await import(${JSON.stringify(pathToFileURL(CONFIG).href)});
      ${PRINT}`;
    const res = runChild(body, { cwd: dir, env: { ...EXPORTED, ...hostileEnv(other) } });
    const out = result(res);
    assert.equal(out.shared, 'from-bash', 'config.js let .env overwrite an exported value');
    assert.equal(out.emptyPreset, '', 'config.js let .env overwrite an exported empty value');
    assert.equal(out.fileOnly, 'from-env-file', 'config.js did not load ./.env');
    assert.equal(out.otherOnly, null, 'config.js loaded the DOTENV_PATH file');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('src/config.js: with no ./.env, DOTENV_PATH does not load another file', () => {
  const { dir, other } = fixture({ withEnvFile: false });
  try {
    const body = `await import(${JSON.stringify(pathToFileURL(CONFIG).href)});
      ${PRINT}`;
    const res = runChild(body, { cwd: dir, env: hostileEnv(other) });
    const out = result(res);
    assert.equal(out.shared, null, 'config.js loaded the DOTENV_PATH file');
    assert.equal(out.otherOnly, null, 'config.js loaded the DOTENV_PATH file');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadDotenvFile: a missing file is returned as error, an empty path throws', async () => {
  const { loadDotenvFile, DOTENV_LOAD_OPTIONS } = await import('../src/dotenv-load.js');
  const dir = tmpDir();
  try {
    const r = loadDotenvFile(path.join(dir, 'missing.env'));
    assert.equal(r.error?.code, 'ENOENT');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.throws(() => loadDotenvFile(''), TypeError);
  assert.throws(() => loadDotenvFile(undefined), TypeError);
  assert.deepEqual({ ...DOTENV_LOAD_OPTIONS }, {
    override: false, quiet: true, debug: false, encoding: 'utf8', fast: false,
  });
  assert.ok(Object.isFrozen(DOTENV_LOAD_OPTIONS), 'DOTENV_LOAD_OPTIONS is not frozen');
});

// ---------------------------------------------------------------------------
// Static scans. A tripwire, not a proof: they catch every way of reaching
// dotenv that a reviewer would write by accident, and flag any import() or
// require() (including a createRequire alias) whose specifier is not a plain
// string literal, because a computed specifier cannot be resolved statically.
// Each flagged load in the tree is listed in COMPUTED_ALLOWLIST by its exact
// expression and count, with the reason it is not dotenv.

const SOURCE_EXT = /\.(?:c|m)?(?:j|t)sx?$/;
const SKIP_DIRS = new Set(['node_modules', 'test']);
const HELPER_REL = 'src/dotenv-load.js';

/**
 * Lookahead body: optional whitespace, one string literal with no `${`, then
 * `,` or `)`. The whitespace sits inside the lookahead so the engine cannot
 * backtrack over it and call a multi-line literal call computed.
 */
const PLAIN_LITERAL_ARG = String.raw`\s*(['"\x60])(?:(?!\1)(?!\$\{)[^\n\\])*\1\s*[,)]`;

/** Rules a source file is checked against. */
const RULES = {
  /** 'dotenv', "dotenv/config", `dotenv` anywhere: import, require, createRequire alias, template literal. */
  literal: (src) => /(['"`])dotenv(?:\/[^'"`\s]*)?\1/.test(src),
  /** dotenv.config( or require('dotenv').config( */
  bareConfig: (src) => /\bdotenv\s*\.\s*config\s*\(|require\(\s*['"`]dotenv['"`]\s*\)\s*\.\s*config\s*\(/.test(src),
  /** import(x) / require(x) where x is not one plain string literal. */
  computed: (src) => new RegExp(`(?<![.\\w$])(?:import|require)\\s*\\((?!${PLAIN_LITERAL_ARG})(?!\\s*\\))`).test(src),
  /** A createRequire(...) result called directly or through an alias with a non-literal specifier. */
  createRequireAlias: (src) => {
    if (new RegExp(String.raw`createRequire\s*\([^()]*(?:\([^()]*\))?[^()]*\)\s*\((?!${PLAIN_LITERAL_ARG})`).test(src)) return true;
    const aliases = [...src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:module\.)?createRequire\s*\(/g)].map((m) => m[1]);
    return aliases.some((name) => {
      const esc = name.replace(/\$/g, '\\$');
      return new RegExp(String.raw`(?<![.\w$])${esc}\s*(?:\.resolve\s*)?\((?!${PLAIN_LITERAL_ARG})`).test(src);
    });
  },
};

function rulesHit(src) {
  return Object.entries(RULES).filter(([, fn]) => fn(src)).map(([name]) => name).sort();
}

/**
 * Loads the rules flag that exist today, reviewed by hand. Each entry is the
 * exact source expression and how many times it occurs. The scan requires
 * exactly that count, removes those expressions, and runs every rule on what
 * is left, so a second computed load in an allowlisted file still fails. A
 * new flagged load anywhere fails until someone checks it and adds it here.
 */
const COMPUTED_ALLOWLIST = new Map([
  ['test-setup.js', [
    // Dependency check: imports each name in a list. Importing the dotenv
    // package runs nothing; there is no config call.
    { expr: 'await import(dep)', count: 1 },
    { expr: "'dotenv',", count: 1 },
  ]],
  ['scripts/verify-receipt-payer.mjs', [
    // A path into packages/verify/dist.
    { expr: 'await import(verifyPkg)', count: 1 },
  ]],
]);

function occurrences(src, expr) {
  return src.split(expr).length - 1;
}

/** Every gateway source file outside node_modules, test/ and dot-dirs. */
function gatewaySources() {
  const out = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.') || SKIP_DIRS.has(ent.name)) continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (SOURCE_EXT.test(ent.name)) out.push(p);
    }
  };
  walk(gatewayDir);
  return out;
}

test('scanner self-test: every way of reaching dotenv in the fixtures is flagged', () => {
  const cases = [
    ["import dotenv from 'dotenv'; dotenv.config();", ['bareConfig', 'literal']],
    ["import 'dotenv/config';", ['literal']],
    ['const d = await import(`dotenv`);', ['literal']],
    ["const d = await import('dotenv'.trim());", ['computed', 'literal']],
    ["const d = await import('dot' + 'env');", ['computed']],
    ['const d = await import(`dot${"env"}`);', ['computed']],
    ["require('dotenv').config({ path: '.env' });", ['bareConfig', 'literal']],
    ["const n = 'dot' + 'env'; require(n).config();", ['computed']],
    ["import { createRequire } from 'node:module';\nconst req = createRequire(import.meta.url);\nconst n = ['dot', 'env'].join('');\nreq(n).config();", ['createRequireAlias']],
    ["const r = createRequire(import.meta.url);\nr.resolve(name);", ['createRequireAlias']],
    ["createRequire(import.meta.url)(name).config();", ['createRequireAlias']],
    ["export const x = require.resolve(spec);", []],
  ];
  for (const [src, want] of cases) {
    assert.deepEqual(rulesHit(src), want, `scanner missed or over-flagged: ${src}`);
  }
});

test('scanner self-test: plain literal loads of other modules are not flagged', () => {
  const clean = [
    "import fs from 'node:fs';",
    "const m = await import('./x.js');",
    "const req = createRequire(import.meta.url);\nconst pkg = req('../package.json');",
    "createRequire(import.meta.url)('../ecosystem.config.cjs');",
    "// mentions dotenv in a comment without quotes\nconst a = 1;",
    "import { loadDotenvFile } from './dotenv-load.js';",
  ];
  for (const src of clean) {
    assert.deepEqual(rulesHit(src), [], `scanner over-flagged: ${src}`);
  }
});

test('scan: no gateway source reaches dotenv outside src/dotenv-load.js (tripwire)', () => {
  const files = gatewaySources();
  assert.ok(files.length > 150, `walked only ${files.length} files`);
  assert.ok(files.some((f) => path.relative(gatewayDir, f) === 'ecosystem.config.cjs'), 'root config files not walked');
  const seen = new Set();
  for (const file of files) {
    const rel = path.relative(gatewayDir, file).split(path.sep).join('/');
    const src = fs.readFileSync(file, 'utf8');
    const hits = rulesHit(src);
    if (rel === HELPER_REL) {
      assert.ok(!RULES.bareConfig(src), `${rel} calls dotenv config()`);
      assert.ok(!RULES.computed(src) && !RULES.createRequireAlias(src), `${rel} has a computed load`);
      continue;
    }
    if (COMPUTED_ALLOWLIST.has(rel)) {
      seen.add(rel);
      let rest = src;
      for (const { expr, count } of COMPUTED_ALLOWLIST.get(rel)) {
        const n = occurrences(src, expr);
        assert.ok(n === count, `${rel}: allowlisted ${JSON.stringify(expr)} occurs ${n} times, expected ${count}`);
        rest = rest.split(expr).join('null');
      }
      const left = rulesHit(rest);
      assert.ok(left.length === 0, `${rel}: ${left.join(', ')} outside the allowlisted expressions`);
      continue;
    }
    assert.ok(hits.length === 0, `${rel}: ${hits.join(', ')}; load .env through src/dotenv-load.js`);
  }
  for (const rel of COMPUTED_ALLOWLIST.keys()) assert.ok(seen.has(rel), `allowlisted ${rel} no longer exists`);
});

test('scan: launch config does not preload dotenv or set NODE_OPTIONS (tripwire)', () => {
  const repoRoot = path.join(gatewayDir, '..', '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(gatewayDir, 'package.json'), 'utf8'));
  const launch = Object.entries(pkg.scripts ?? {}).map(([k, v]) => [`package.json scripts.${k}`, v]);
  const files = [
    ...fs.readdirSync(gatewayDir)
      .filter((n) => /^(?:Dockerfile.*|docker-compose.*\.ya?ml|ecosystem.*\.c?js|run-.*\.(?:sh|bat)|setup\.bat|quick-start.*\.bat)$/.test(n))
      .map((n) => path.join(gatewayDir, n)),
    path.join(repoRoot, 'deploy', 'lightsail', 'gateway.service.in'),
    path.join(repoRoot, 'deploy', 'lightsail', 'install-api.sh'),
    // The root ecosystem file launches services/gateway/src/server.js
    // (node_args / interpreter_args could preload dotenv).
    path.join(repoRoot, 'ecosystem.config.js'),
    // npm runs scripts with node-options from .npmrc.
    path.join(repoRoot, '.npmrc'),
    ...(fs.existsSync(path.join(gatewayDir, '.npmrc')) ? [path.join(gatewayDir, '.npmrc')] : []),
  ];
  for (const f of files) {
    assert.ok(fs.existsSync(f), `launch file missing: ${f}`);
    launch.push([path.relative(repoRoot, f), fs.readFileSync(f, 'utf8')]);
  }
  assert.ok(launch.some(([n]) => n.endsWith('gateway.service.in')), 'systemd unit not scanned');
  assert.ok(launch.some(([n]) => /Dockerfile$/.test(n)), 'Dockerfile not scanned');
  assert.ok(launch.some(([n]) => n === 'ecosystem.config.js'), 'root ecosystem.config.js not scanned');
  assert.ok(launch.some(([n]) => n === '.npmrc'), 'root .npmrc not scanned');
  for (const [name, text] of launch.filter(([n]) => n.endsWith('.npmrc'))) {
    assert.ok(!/^\s*node[-_]options\s*=/im.test(text), `${name} sets node-options`);
  }
  const preload = /(?:^|[\s'"=])(?:-r|--require|--import|--loader|--experimental-loader)[\s=]+['"]?dotenv/m;
  for (const [name, text] of launch) {
    assert.ok(!/NODE_OPTIONS/.test(text), `${name} sets NODE_OPTIONS`);
    assert.ok(!preload.test(text), `${name} preloads dotenv`);
    assert.ok(!/\bdotenv\b/i.test(text), `${name} mentions dotenv`);
  }
});

test('scan: src/dotenv-load.js passes the pinned options and uses configDotenv', () => {
  const src = fs.readFileSync(HELPER, 'utf8');
  assert.ok(/return dotenv\.configDotenv\(\{ \.\.\.DOTENV_LOAD_OPTIONS, path \}\);/.test(src), 'helper does not call configDotenv with the pinned options and an explicit path');
  assert.ok(/override: false,/.test(src), 'override: false missing');
  assert.ok(/quiet: true,/.test(src), 'quiet: true missing');
  assert.ok(/debug: false,/.test(src), 'debug: false missing');
  assert.ok(!/\bdotenv\.config\(/.test(src), 'helper calls dotenv.config()');
});

test('scan: each load site passes the file it loaded before', () => {
  const sites = [
    ['src/config.js', /^loadDotenvFile\(resolve\(process\.cwd\(\), '\.env'\)\);$/m],
    ['scripts/stamp-foreign-payout.mjs', /^ {2}loadDotenvFile\(join\(gatewayDir, '\.env'\)\);$/m],
    ['scripts/run-benchmark.mjs', /^loadDotenvFile\(resolve\(ROOT, '\.env\.benchmark'\)\);$/m],
  ];
  for (const [rel, re] of sites) {
    const src = fs.readFileSync(path.join(gatewayDir, rel), 'utf8');
    assert.ok(re.test(src), `${rel}: load site missing or changed`);
  }
});
