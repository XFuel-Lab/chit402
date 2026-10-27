/**
 * .env loading ignores the DOTENV_* environment (src/dotenv-load.js).
 *
 * dotenv 18 fills options a caller leaves out from DOTENV_PATH,
 * DOTENV_OVERRIDE, DOTENV_QUIET, DOTENV_DEBUG, DOTENV_ENCODING and DOTENV_FAST
 * (DOTENV_CONFIG_* as fallbacks). The prod service exports every .env line
 * from bash, so these tests run the real loaders in a child process with those
 * variables set and check that exported values stay, the named other file is
 * not read, and nothing is logged. They pass on dotenv 17 and 18.
 * Offline: temp files and child processes only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const gatewayDir = path.join(here, '..');
const HELPER = path.join(gatewayDir, 'src', 'dotenv-load.js');
const CONFIG = path.join(gatewayDir, 'src', 'config.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dotenv-pin-'));
}

/** A cwd with .env and a decoy other.env that DOTENV_PATH points at. */
function fixture({ withEnvFile = true } = {}) {
  const dir = tmpDir();
  if (withEnvFile) {
    fs.writeFileSync(
      path.join(dir, '.env'),
      'SHARED_KEY=from-env-file\nFILE_ONLY_KEY=from-env-file\nUTF8_KEY=caf\u00e9\n',
    );
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
    DOTENV_QUIET: 'false',
    DOTENV_DEBUG: 'true',
    // dotenv 17 config() switches to .env.vault when this is set.
    DOTENV_KEY: 'dotenv://:key_0000000000000000000000000000000000000000000000000000000000000000@dotenvx.com/vault/.env.vault?environment=production',
  };
}

/** Run `body` (an ES module source) in a child with only `env` set. */
function runChild(body, { cwd, env }) {
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', body], {
    cwd,
    env: { PATH: process.env.PATH, TMPDIR: os.tmpdir(), NODE_ENV: 'test', ...env },
    encoding: 'utf8',
    timeout: 60_000,
  });
  return res;
}

const PRINT = `console.log('RESULT=' + JSON.stringify({
  shared: process.env.SHARED_KEY ?? null,
  fileOnly: process.env.FILE_ONLY_KEY ?? null,
  otherOnly: process.env.OTHER_ONLY_KEY ?? null,
  utf8: process.env.UTF8_KEY ?? null,
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
    const res = runChild(body, { cwd: dir, env: { SHARED_KEY: 'from-bash', ...hostileEnv(other) } });
    const out = result(res);
    assert.equal(out.shared, 'from-bash', 'an exported value was overwritten from a .env file');
    assert.equal(out.fileOnly, 'from-env-file', 'the named .env file was not loaded');
    assert.equal(out.otherOnly, null, 'the DOTENV_PATH file was loaded');
    assert.equal(out.utf8, 'caf\u00e9', 'DOTENV_ENCODING changed how the file was decoded');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadDotenvFile: DOTENV_QUIET=false and DOTENV_DEBUG=true log nothing', () => {
  const { dir, other } = fixture();
  try {
    const body = `import { loadDotenvFile } from ${JSON.stringify(pathToFileURL(HELPER).href)};
      loadDotenvFile(${JSON.stringify(path.join(dir, '.env'))});
      loadDotenvFile(${JSON.stringify(path.join(dir, 'missing.env'))});`;
    const res = runChild(body, { cwd: dir, env: { SHARED_KEY: 'from-bash', ...hostileEnv(other) } });
    assert.equal(res.status, 0, `child failed: ${res.stderr}`);
    assert.equal(res.stdout, '', `dotenv wrote to stdout: ${res.stdout}`);
    assert.equal(res.stderr, '', `dotenv wrote to stderr: ${res.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('src/config.js: loads ./.env from cwd, keeps exported values, ignores DOTENV_PATH', () => {
  const { dir, other } = fixture();
  try {
    const body = `await import(${JSON.stringify(pathToFileURL(CONFIG).href)});
      ${PRINT}`;
    const res = runChild(body, { cwd: dir, env: { SHARED_KEY: 'from-bash', ...hostileEnv(other) } });
    const out = result(res);
    assert.equal(out.shared, 'from-bash', 'config.js let .env overwrite an exported value');
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

/** Gateway source files outside node_modules and test/. */
function gatewaySources() {
  const out = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.(?:c|m)?js$/.test(ent.name)) out.push(p);
    }
  };
  for (const ent of fs.readdirSync(gatewayDir, { withFileTypes: true })) {
    const p = path.join(gatewayDir, ent.name);
    if (ent.isFile() && /\.(?:c|m)?js$/.test(ent.name)) out.push(p);
  }
  for (const d of ['src', 'scripts', 'bin', 'lib']) {
    const p = path.join(gatewayDir, d);
    if (fs.existsSync(p)) walk(p);
  }
  return out;
}

test('scan: no gateway file calls dotenv config() or imports dotenv, except src/dotenv-load.js', () => {
  const files = gatewaySources();
  assert.ok(files.length > 50, `walked only ${files.length} files`);
  const bareConfig = /\bdotenv\s*\.\s*config\s*\(|require\(\s*['"]dotenv['"]\s*\)\s*\.\s*config\s*\(/;
  const imports = /from\s+['"]dotenv(?:\/[^'"]*)?['"]|import\s+['"]dotenv(?:\/[^'"]*)?['"]|require\(\s*['"]dotenv(?:\/[^'"]*)?['"]\s*\)|import\(\s*['"]dotenv(?:\/[^'"]*)?['"]\s*\)/;
  for (const file of files) {
    const rel = path.relative(gatewayDir, file);
    const src = fs.readFileSync(file, 'utf8');
    assert.ok(!bareConfig.test(src), `${rel} calls dotenv config(); use loadDotenvFile`);
    if (rel === path.join('src', 'dotenv-load.js')) continue;
    assert.ok(!imports.test(src), `${rel} imports dotenv; use src/dotenv-load.js`);
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
