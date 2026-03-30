/**
 * Run core-layer (Hardhat *.cjs only) + phase3 + security with an explicit file list.
 * Core listener / multi-prover unit tests live in ai-listener.test.js — run via
 * `npm run test:contracts:core:listener` (node:test), not Hardhat.
 * Shell globs are unreliable on Windows; CI and local both use this script.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dirs = [
  path.join(root, 'core-layer', 'test'),
  path.join(root, 'test', 'phase3'),
  path.join(root, 'test', 'security'),
];

const files = [];
for (const dir of dirs) {
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir)) {
    if (/\.test\.cjs$/.test(name)) {
      files.push(path.relative(root, path.join(dir, name)).split(path.sep).join('/'));
    }
  }
}

if (!files.length) {
  console.error('hardhat-test-core: no *.test.cjs found under core-layer/test, test/phase3, test/security');
  process.exit(1);
}

const r = spawnSync('npx', ['hardhat', 'test', ...files], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});
process.exit(r.status === null ? 1 : r.status);
