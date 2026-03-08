/**
 * Patches solidity-coverage@0.8.x to support .cjs/.mjs test file extensions.
 *
 * The upstream regex in getTestFilePaths() only matches .js and .ts,
 * silently dropping .cjs files from --testfiles globs.
 * See: node_modules/solidity-coverage/plugins/resources/nomiclabs.utils.js
 */
const fs = require('fs');
const path = require('path');

const target = path.join(
  __dirname, '..', 'node_modules', 'solidity-coverage',
  'plugins', 'resources', 'nomiclabs.utils.js'
);

if (!fs.existsSync(target)) {
  console.log('[patch-solcover] solidity-coverage not installed, skipping.');
  process.exit(0);
}

let src = fs.readFileSync(target, 'utf8');
const oldRegex = String.raw`/.*\.(js|ts)$/`;
const newRegex = String.raw`/.*\.(js|cjs|mjs|ts|cts|mts)$/`;

if (src.includes(newRegex)) {
  console.log('[patch-solcover] already patched.');
  process.exit(0);
}

if (!src.includes(oldRegex)) {
  console.warn('[patch-solcover] regex not found — plugin version may have changed.');
  process.exit(0);
}

src = src.replace(oldRegex, newRegex);
fs.writeFileSync(target, src, 'utf8');
console.log('[patch-solcover] patched getTestFilePaths to support .cjs/.mjs extensions.');
