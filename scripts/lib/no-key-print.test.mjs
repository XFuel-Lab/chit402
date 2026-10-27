/**
 * hardhat.config.cjs and scripts/verify-deployment.cjs never print any part
 * of a private key.
 *
 * The runtime tests load the real hardhat config (`hardhat help`, offline)
 * and run verify-deployment.cjs with a dummy key in DEPLOYER_PRIVATE_KEY /
 * PRIVATE_KEY, and assert that no 4-character run of the key's hex appears
 * on stdout or stderr. The dummy key is derived at runtime from a fixed label
 * so no key-shaped literal sits in the repo. They need the root deps (hardhat,
 * ethers); without them they skip locally and fail in CI.
 *
 * The scan is a tripwire, not a proof: it finds key variables assigned from
 * process.env (*KEY*, *SECRET*, *MNEMONIC*, *SEED*) and rejects slicing them,
 * interpolating them, or passing them (or process.env.*KEY*) to a print call.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const rootRequire = createRequire(path.join(repoRoot, 'package.json'));

const FILES = ['hardhat.config.cjs', 'scripts/verify-deployment.cjs'];

/** Dummy keys from fixed labels. Not real, never funded. */
function dummyKeyHex(label) {
  return crypto.createHash('sha256').update(`chit402-dummy-key:${label}`).digest('hex');
}

function hexWindows(hex, n = 4) {
  const out = new Set();
  for (let i = 0; i + n <= hex.length; i++) out.add(hex.slice(i, i + n).toLowerCase());
  return out;
}

/** The first 4-hex run of `hex` found in `text`, or null. Never returns the run itself in a message. */
function leakedWindow(text, hex) {
  const lower = text.toLowerCase();
  for (const w of hexWindows(hex)) if (lower.includes(w)) return w;
  return null;
}

function resolveOrNull(spec) {
  try {
    return rootRequire.resolve(spec);
  } catch {
    return null;
  }
}

const HARDHAT_CLI = resolveOrNull('hardhat/internal/cli/cli.js');
const HAVE_DEPS = Boolean(HARDHAT_CLI && resolveOrNull('ethers'));
if (!HAVE_DEPS && process.env.CI) {
  throw new Error('root deps (hardhat, ethers) are missing in CI; run npm ci first');
}

function run(args, env) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'no-key-print-'));
  try {
    const res = spawnSync(process.execPath, args, {
      cwd: repoRoot,
      env: { PATH: process.env.PATH, HOME: home, TMPDIR: home, HARDHAT_DISABLE_TELEMETRY_PROMPT: 'true', ...env },
      encoding: 'utf8',
      timeout: 120_000,
    });
    return { status: res.status, out: `${res.stdout ?? ''}\n${res.stderr ?? ''}` };
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

/** Every key shape the config and the verify script may see. */
function keyCases() {
  const a = dummyKeyHex('a');
  const b = dummyKeyHex('b');
  const c = dummyKeyHex('c');
  const d = dummyKeyHex('d');
  return [
    { name: 'DEPLOYER_PRIVATE_KEY 0x', env: { DEPLOYER_PRIVATE_KEY: `0x${a}` }, hex: a, valid: true },
    { name: 'PRIVATE_KEY 0x', env: { PRIVATE_KEY: `0x${b}` }, hex: b, valid: true },
    { name: 'DEPLOYER_PRIVATE_KEY no prefix', env: { DEPLOYER_PRIVATE_KEY: c }, hex: c, valid: true },
    { name: 'too-short key', env: { DEPLOYER_PRIVATE_KEY: `0x${d.slice(0, 40)}` }, hex: d.slice(0, 40), valid: false },
  ];
}

test('hardhat.config.cjs: loading the config with a dummy key prints no 4-hex run of it', { skip: !HAVE_DEPS && 'root deps not installed' }, () => {
  const { Wallet } = rootRequire('ethers');
  for (const k of keyCases()) {
    const res = run([HARDHAT_CLI, '--config', 'hardhat.config.cjs', 'help'], k.env);
    const leak = leakedWindow(res.out, k.hex);
    assert.equal(leak, null, `${k.name}: part of the private key appeared in hardhat output`);
    if (k.valid) {
      const address = new Wallet(`0x${k.hex}`).address;
      assert.ok(res.out.includes(`PRIVATE_KEY loaded for ${address}`), `${k.name}: derived address not printed`);
    } else {
      assert.ok(!/PRIVATE_KEY loaded/.test(res.out), `${k.name}: an unparseable key should print nothing`);
      assert.ok(/Invalid account/.test(res.out), `${k.name}: hardhat did not load the config with the bad key`);
    }
  }
});

test('hardhat.config.cjs: the derived address line does not collide with the dummy keys (test sanity)', { skip: !HAVE_DEPS && 'root deps not installed' }, () => {
  const { Wallet } = rootRequire('ethers');
  for (const k of keyCases().filter((x) => x.valid)) {
    assert.equal(leakedWindow(new Wallet(`0x${k.hex}`).address.slice(2), k.hex), null, `${k.name}: pick another label`);
  }
});

test('control: the old prefix print is caught by the leak check', () => {
  const hex = dummyKeyHex('a');
  const old = `PRIVATE_KEY loaded: ${`0x${hex}`.slice(0, 6)}...`;
  assert.notEqual(leakedWindow(old, hex), null, 'the leak check missed a 4-hex prefix');
});

test('scripts/verify-deployment.cjs: runs with a dummy key set and prints no 4-hex run of it', { skip: !HAVE_DEPS && 'root deps not installed' }, () => {
  for (const k of keyCases()) {
    for (const args of [[], ['--manifest', path.join(os.tmpdir(), 'no-such-manifest-660.json'), '--rpc', 'http://127.0.0.1:9']]) {
      const res = run([path.join(repoRoot, 'scripts', 'verify-deployment.cjs'), ...args], k.env);
      assert.notEqual(res.status, 0, `${k.name}: verify-deployment.cjs should exit non-zero without a manifest`);
      assert.equal(leakedWindow(res.out, k.hex), null, `${k.name} ${args.join(' ')}: part of the private key appeared`);
    }
  }
});

// ---------------------------------------------------------------------------
// Static tripwire.

const PRINT_CALL = /\b(?:console\s*\.\s*(?:log|info|warn|error|debug|trace|dir|table)|process\s*\.\s*(?:stdout|stderr)\s*\.\s*write)\s*\(/g;
const ENV_KEY_NAME = /(?:KEY|SECRET|MNEMONIC|SEED)/;

/** Names bound to a process.env value whose name looks like a key. */
function keyVars(src) {
  const names = new Set();
  for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^\n;]+)/g)) {
    const envNames = [...m[2].matchAll(/process\.env\.([A-Z0-9_]+)|process\.env\[\s*['"`]([A-Z0-9_]+)['"`]\s*\]/g)].map((x) => x[1] || x[2]);
    if (envNames.some((n) => ENV_KEY_NAME.test(n))) names.add(m[1]);
  }
  return names;
}

/** The argument text of every print call (balanced parentheses). */
function printArgs(src) {
  const out = [];
  for (const m of src.matchAll(PRINT_CALL)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
    }
    out.push(src.slice(start, i - 1));
  }
  return out;
}

function keyPrintProblems(src) {
  const problems = [];
  const vars = keyVars(src);
  for (const v of vars) {
    const esc = v.replace(/\$/g, '\\$');
    if (new RegExp(String.raw`(?<![\w$.])${esc}\s*(?:\?\.)?\s*\.\s*(?:slice|substring|substr|at|charAt|charCodeAt|split|padStart|padEnd|match|replace)\s*\(`).test(src)) problems.push(`${v} is sliced or transformed`);
    if (new RegExp(String.raw`(?<![\w$.])${esc}\s*\[`).test(src)) problems.push(`${v} is indexed`);
    if (new RegExp(String.raw`\$\{\s*${esc}\b`).test(src)) problems.push(`${v} is interpolated into a template`);
  }
  for (const args of printArgs(src)) {
    for (const v of vars) {
      if (new RegExp(String.raw`(?<![\w$.])${v.replace(/\$/g, '\\$')}(?![\w$])`).test(args)) problems.push(`${v} is passed to a print call`);
    }
    for (const m of args.matchAll(/process\.env\.([A-Z0-9_]+)|process\.env\[/g)) {
      if (!m[1] || ENV_KEY_NAME.test(m[1])) problems.push(`process.env.${m[1] ?? '[...]'} is passed to a print call`);
    }
  }
  return problems;
}

test('scan self-test: the old hardhat line and other key prints are flagged', () => {
  const bad = [
    "const pk = process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY\nif (pk) {\n  console.log(`PRIVATE_KEY loaded: ${pk.slice(0, 6)}...`)\n}",
    "const k = process.env.DEPLOYER_PRIVATE_KEY\nconsole.log('key', k)",
    "const k = process.env.DEPLOYER_PRIVATE_KEY\nconst head = k.substring(0, 4)",
    "const k = process.env.DEPLOYER_PRIVATE_KEY\nconst s = `${k}`",
    "const k = process.env.DEPLOYER_PRIVATE_KEY\nconst c = k[0]",
    "console.error('pk:', process.env.PRIVATE_KEY)",
    "process.stderr.write(process.env.MNEMONIC)",
  ];
  for (const src of bad) assert.ok(keyPrintProblems(src).length > 0, `scan missed: ${src}`);
  const ok = [
    "const pk = process.env.PRIVATE_KEY\nconst addr = deployerAddressOf(pk)\nif (addr) console.log(`loaded for ${addr}`)",
    "const rpc = process.env.BASE_RPC_URL\nconsole.log(`RPC: ${rpc}`)",
  ];
  for (const src of ok) assert.deepEqual(keyPrintProblems(src), [], `scan over-flagged: ${src}`);
});

test('scan (tripwire): no key variable is sliced, interpolated or printed in the two key-reading files', () => {
  for (const rel of FILES) {
    const src = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    const problems = keyPrintProblems(src);
    assert.ok(problems.length === 0, `${rel}: ${problems.join('; ')}`);
  }
  const hh = fs.readFileSync(path.join(repoRoot, 'hardhat.config.cjs'), 'utf8');
  assert.ok(keyVars(hh).has('pk'), 'hardhat.config.cjs key variable not found; the scan is not looking at it');
  assert.ok(/if \(deployerAddress\) console\.log\(`PRIVATE_KEY loaded for \$\{deployerAddress\}`\)/.test(hh), 'hardhat.config.cjs no longer prints only the derived address');
  assert.ok(!/\bpk\s*\.\s*(?:slice|substring|substr)\s*\(/.test(hh), 'hardhat.config.cjs logs part of the key');
});
