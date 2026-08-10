#!/usr/bin/env node
/**
 * Reachability audit: which gateway sources does production actually load?
 *
 * Production runs `node src/server.js` (systemd xfuel-api) per docs/RUNTIME_STATE.md.
 * Anything not in that import closure cannot execute in production, no matter how
 * many tests reference it. Static import/require scan, including dynamic import().
 *
 * Usage: node scripts/dev/reachable-from-entrypoint.cjs [entrypoint]
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '../../services/gateway/src');
const entry = path.resolve(process.argv[2] || path.join(SRC, 'server.js'));

// require('./x'), import ... from './x', await import('./x')
const SPEC = /(?:require\(\s*|from\s+|import\(\s*)['"](\.[^'"]+)['"]/g;

function resolveSpec(spec, fromFile) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const cand of [base, base + '.js', base + '.cjs', base + '.mjs', path.join(base, 'index.js')]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

const reached = new Set();
const queue = [entry];
while (queue.length) {
  const file = queue.shift();
  if (reached.has(file)) continue;
  reached.add(file);
  let code;
  try { code = fs.readFileSync(file, 'utf8'); } catch { continue; }
  for (const m of code.matchAll(SPEC)) {
    const next = resolveSpec(m[1], file);
    if (next && !reached.has(next)) queue.push(next);
  }
}

const all = fs.readdirSync(SRC)
  .filter((f) => /\.(js|cjs|mjs)$/.test(f))
  .map((f) => path.join(SRC, f));

const live = all.filter((f) => reached.has(f)).sort();
const dead = all.filter((f) => !reached.has(f)).sort();

console.log(`entrypoint: ${path.relative(process.cwd(), entry)}`);
console.log(`\nREACHABLE in production (${live.length}):`);
for (const f of live) console.log('  ' + path.basename(f));
console.log(`\nNOT REACHABLE from the production entrypoint (${dead.length}):`);
for (const f of dead) console.log('  ' + path.basename(f));
