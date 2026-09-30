/**
 * Source digest for the offline verifier.
 *
 * This is not a bit-reproducible compiler output. It is the SHA-256 of a
 * canonical listing of packages/verify/src. Two checkouts of the same files
 * produce the same digest. A tsc binary is not hashed: timestamps and
 * toolchains are not part of the commitment.
 *
 * Recipe:
 *   1. Take every file under src/ ending in .ts, sorted by relative path.
 *   2. Normalize newlines to \n.
 *   3. For each file, SHA-256 the UTF-8 bytes.
 *   4. SHA-256 the lines `relative/path <file-sha256>\n`.
 *
 *   node scripts/build-digest.mjs
 *   writes BUILD_DIGEST.txt in this package.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');

function walk(dir, acc = []) {
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, acc);
    else if (name.endsWith('.ts')) acc.push(full);
  }
  return acc;
}

export function computeVerifierSourceDigest(dir = srcDir) {
  const files = walk(dir);
  const lines = files.map((full) => {
    const rel = path.relative(path.dirname(dir), full).split(path.sep).join('/');
    const text = fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n');
    const fileHash = crypto.createHash('sha256').update(text).digest('hex');
    return `${rel} ${fileHash}`;
  });
  return crypto.createHash('sha256').update(`${lines.join('\n')}\n`).digest('hex');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const digest = computeVerifierSourceDigest();
  const out = path.join(root, 'BUILD_DIGEST.txt');
  fs.writeFileSync(out, `${digest}\n`);
  console.log(digest);
}
