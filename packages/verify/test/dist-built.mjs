/**
 * N-F1 (646): tests read the build in dist/ and never rebuild it themselves.
 * `npm test` (and every CI job) runs `npm run build` once first, so two test
 * files, or two suites in one worktree, can no longer race an in-place tsc
 * rebuild. Running one file by hand needs `npm run build` first; a missing or
 * stale dist/ fails loudly here instead of testing old code.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const built = path.join(pkgDir, 'dist', 'index.js');
if (!existsSync(built)) {
  throw new Error('packages/verify: dist/ is not built; run `npm run build` (npm test does this) before the tests');
}
const builtAt = statSync(built).mtimeMs;
const srcDir = path.join(pkgDir, 'src');
const newer = readdirSync(srcDir, { recursive: true })
  .filter((f) => /\.ts$/.test(String(f)))
  .filter((f) => statSync(path.join(srcDir, String(f))).mtimeMs > builtAt + 1000);
if (newer.length) {
  throw new Error(`packages/verify: dist/ is older than src (${newer.slice(0, 3).join(', ')}); run \`npm run build\` before the tests`);
}
