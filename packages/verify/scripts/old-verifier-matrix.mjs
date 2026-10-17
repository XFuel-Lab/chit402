#!/usr/bin/env node
/**
 * Old-verifier matrix for the 0.4.6 public attestation.
 *
 * Every published verifier from 0.3.0 to 0.4.5 must reject the tagged
 * payload: as a receipt JWS, as a shell field, through verifyIssuerJws,
 * and through the CLI. A control row signs the same claims as plain JSON
 * with the receipt typ. The control must be accepted by verifyIssuerJws on
 * at least one version, or the harness could not tell a pass from a miss.
 *
 * Usage:
 *   node scripts/old-verifier-matrix.mjs --dir <root>
 *     <root>/x-<version>  has `npm i @xfuel/verify@<version>`
 *     <root>/c-<version>  has `npm i chit402-verify@<version>`
 *   node scripts/old-verifier-matrix.mjs --install <root>
 *     installs every version below into <root> first (npm registry).
 *
 * Throwaway P-256 key. No production host: the CLI runs with a file input and
 * loopback RPC URLs that refuse connections. Exit 1 if any version accepts.
 */
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const VERSIONS = {
  x: ['0.3.0', '0.3.1', '0.3.3', '0.3.4', '0.3.5', '0.4.0', '0.4.1', '0.4.2', '0.4.4', '0.4.5'],
  c: ['0.3.0', '0.3.4', '0.3.5', '0.4.0', '0.4.1', '0.4.2', '0.4.4', '0.4.5'],
};
const PKG = { x: '@xfuel/verify', c: 'chit402-verify' };

const args = process.argv.slice(2);
const installAt = args.includes('--install') ? args[args.indexOf('--install') + 1] : null;
const root = installAt || (args.includes('--dir') ? args[args.indexOf('--dir') + 1] : null);
if (!root) {
  console.error('usage: old-verifier-matrix.mjs --dir <root> | --install <root>');
  process.exit(2);
}

if (installAt) {
  for (const [kind, list] of Object.entries(VERSIONS)) {
    for (const version of list) {
      const dir = path.join(root, `${kind}-${version}`);
      if (existsSync(path.join(dir, 'node_modules', ...PKG[kind].split('/')))) continue;
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'package.json'), '{"private":true}');
      const r = spawnSync('npm', ['i', '--no-audit', '--no-fund', '--ignore-scripts', `${PKG[kind]}@${version}`], { cwd: dir, encoding: 'utf8', shell: process.platform === 'win32' });
      if (r.status !== 0) {
        console.error(`install failed: ${PKG[kind]}@${version}\n${r.stderr}`);
        process.exit(2);
      }
    }
  }
}

const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const j = publicKey.export({ format: 'jwk' });
const kid = createHash('sha256').update(JSON.stringify({ crv: j.crv, kty: j.kty, x: j.x, y: j.y })).digest('base64url');
const jwk = { kty: 'EC', crv: 'P-256', x: j.x, y: j.y, kid, alg: 'ES256', use: 'sig' };
const signJws = (header, payload) => {
  const input = `${b64(header)}.${b64(payload)}`;
  return `${input}.${sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
};

const TASK = 'xfuel-0b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const claims = {
  attested_at: '2026-10-17T18:30:00.000Z',
  iss: 'chit402',
  issued_at: '2026-10-17T18:29:00.000Z',
  log: { epoch: 1, leaf_hash: 'a'.repeat(64), leaf_index: 1 },
  payment: {
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', gross_amount: '2000',
    payee: '0x23f713411c30BBd9A989c9cbC22EB0b55F7f7334', rail: 'usdc',
    ref: `base:0x${'cd'.repeat(32)}`, settled_amount: '2000',
  },
  task_id: TASK,
};
const canon = (v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
  : JSON.stringify(v));
const tagged = signJws({ alg: 'ES256', typ: 'chit402-public-receipt+jwt', kid }, `chit402.public_receipt.v1\n${canon(claims)}`);
const control = signJws({ alg: 'ES256', typ: 'chit402-receipt+jwt', kid }, canon(claims));

const work = mkdtempSync(path.join(tmpdir(), 'chit-old-matrix-'));
const docs = {};
for (const [name, jws] of Object.entries({ tagged, control })) {
  const receipt = { ...claims, issuer_signature: { alg: 'ES256', jws, kid, issuer_jwk: jwk } };
  const shell = {
    schema: 'chit402.receipt_shell.v1', unsigned: true, receipt_id: TASK, task_id: TASK,
    amount_gross: '2000', amount_settled: '2000', public_attestation: { jws },
  };
  docs[name] = {
    receipt: path.join(work, `${name}-receipt.json`),
    shell: path.join(work, `${name}-shell.json`),
  };
  writeFileSync(docs[name].receipt, JSON.stringify(receipt));
  writeFileSync(docs[name].shell, JSON.stringify(shell));
}
const jwksFile = path.join(work, 'jwks.json');
writeFileSync(jwksFile, JSON.stringify({ keys: [jwk] }));

const probe = `
const pkg = require(process.argv[1]);
const lib = pkg.default && !pkg.verifyReceipt ? pkg.default : pkg;
const fs = require('node:fs');
const jwk = JSON.parse(process.argv[2]);
const out = {};
(async () => {
  for (const name of ['tagged', 'control']) {
    const jws = JSON.parse(process.argv[3])[name];
    const files = JSON.parse(process.argv[4])[name];
    const row = {};
    if (typeof lib.verifyIssuerJws === 'function') {
      try { row.issuerJws = lib.verifyIssuerJws(jws, jwk).valid === true; } catch { row.issuerJws = false; }
    } else row.issuerJws = null;
    const opts = { trustedKids: [jwk.kid], jwks: { keys: [jwk] }, skipIssuerHistory: true, requirePreimages: false, checkPayer: false };
    for (const [label, file] of [['receipt', files.receipt], ['shell', files.shell]]) {
      try {
        const r = await lib.verifyReceipt(JSON.parse(fs.readFileSync(file, 'utf8')), opts);
        row[label] = r && (r.overall === 'verified' || r.overall === 'VERIFIED' || r.valid === true);
      } catch { row[label] = false; }
    }
    out[name] = row;
  }
  process.stdout.write(JSON.stringify(out));
})();
`;

function binOf(dir, kind) {
  const pkgDir = path.join(dir, 'node_modules', ...PKG[kind].split('/'));
  const meta = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  const bin = typeof meta.bin === 'string' ? meta.bin : Object.values(meta.bin || {})[0];
  return { bin: bin ? path.join(pkgDir, bin) : null, version: meta.version };
}

const env = { ...process.env, BASE_RPC_URL: 'http://127.0.0.1:9/', SOLANA_RPC_URL: 'http://127.0.0.1:9/', NO_COLOR: '1' };
const rows = [];
let failed = false;
let controlCaught = false;
for (const [kind, list] of Object.entries(VERSIONS)) {
  for (const version of list) {
    const dir = path.join(root, `${kind}-${version}`);
    if (!existsSync(dir)) {
      rows.push({ pkg: PKG[kind], version, error: 'not installed' });
      failed = true;
      continue;
    }
    const r = spawnSync(process.execPath, ['-e', probe, PKG[kind], JSON.stringify(jwk), JSON.stringify({ tagged, control }), JSON.stringify(docs)], { cwd: dir, encoding: 'utf8', env, timeout: 60000 });
    let lib = null;
    try { lib = JSON.parse(r.stdout); } catch { lib = null; }
    const { bin, version: installed } = binOf(dir, kind);
    const cli = {};
    for (const name of ['tagged', 'control']) {
      for (const label of ['receipt', 'shell']) {
        const base = [bin, docs[name][label]];
        const flags = version.startsWith('0.3.') ? ['--jwks-file', jwksFile, '--trusted-kid', kid, '--no-issuer-history'] : [];
        const c = spawnSync(process.execPath, [...base, ...flags], { cwd: dir, encoding: 'utf8', env, timeout: 60000 });
        cli[`${name}_${label}`] = c.status;
      }
    }
    const accepts = !lib
      || lib.tagged.issuerJws === true || lib.tagged.receipt === true || lib.tagged.shell === true
      || cli.tagged_receipt === 0 || cli.tagged_shell === 0;
    if (accepts) failed = true;
    if (lib?.control?.issuerJws === true || lib?.control?.receipt === true || cli.control_receipt === 0) controlCaught = true;
    rows.push({ pkg: PKG[kind], version: installed, lib, cli, rejects_tagged: !accepts });
  }
}

console.log('| package | version | tagged: verifyIssuerJws | tagged: verifyReceipt(receipt) | tagged: verifyReceipt(shell) | tagged CLI exit (receipt/shell) | control: verifyIssuerJws | control CLI exit (receipt) | rejects tagged |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const row of rows) {
  if (row.error) {
    console.log(`| ${row.pkg} | ${row.version} | ${row.error} | | | | | | NO |`);
    continue;
  }
  console.log(`| ${row.pkg} | ${row.version} | ${row.lib?.tagged.issuerJws} | ${row.lib?.tagged.receipt} | ${row.lib?.tagged.shell} | ${row.cli.tagged_receipt}/${row.cli.tagged_shell} | ${row.lib?.control.issuerJws} | ${row.cli.control_receipt} | ${row.rejects_tagged ? 'yes' : 'NO'} |`);
}
console.log(`\ncontrol accepted somewhere (harness can see an accept): ${controlCaught}`);
if (!controlCaught) {
  console.error('the control was never accepted: the harness cannot tell a pass from a miss');
  process.exit(1);
}
process.exit(failed ? 1 : 0);
