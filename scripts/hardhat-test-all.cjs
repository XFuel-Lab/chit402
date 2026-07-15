/**
 * Full Hardhat test matrix with an explicit file list (no shell globs).
 * Windows does not expand glob patterns in npm scripts; Mocha would treat a literal path and fail.
 *
 * Collects:
 *   - every .test.cjs under test/ (recursive)
 *   - core-layer/test (Hardhat .cjs only)
 *   - packages/circuit-runtime/<name>/test (flat .cjs files)
 *
 * Does not include `believer/test` (use `npm run test:believer`) or `ai-listener.test.js`
 * (use `npm run test:contracts:core:listener`).
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function walkTestCjs(dir, acc) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, name.name);
    if (name.isDirectory()) {
      walkTestCjs(full, acc);
    } else if (name.isFile() && /\.test\.cjs$/.test(name.name)) {
      acc.push(path.relative(root, full).split(path.sep).join('/'));
    }
  }
}

const files = [];
walkTestCjs(path.join(root, 'test'), files);

const clDir = path.join(root, 'core-layer', 'test');
if (fs.existsSync(clDir)) {
  for (const name of fs.readdirSync(clDir)) {
    if (/\.test\.cjs$/.test(name)) {
      files.push(`core-layer/test/${name}`);
    }
  }
}

const circuitsRoot = path.join(root, 'packages', 'circuit-runtime');
if (fs.existsSync(circuitsRoot)) {
  for (const ent of fs.readdirSync(circuitsRoot, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const tdir = path.join(circuitsRoot, ent.name, 'test');
    if (!fs.existsSync(tdir)) continue;
    for (const name of fs.readdirSync(tdir)) {
      if (/\.test\.cjs$/.test(name)) {
        files.push(`packages/circuit-runtime/${ent.name}/test/${name}`);
      }
    }
  }
}

const unique = [...new Set(files)].sort();

if (!unique.length) {
  console.error('hardhat-test-all: no *.test.cjs files collected');
  process.exit(1);
}

const r = spawnSync('npx', ['hardhat', 'test', ...unique], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});
process.exit(r.status === null ? 1 : r.status);
