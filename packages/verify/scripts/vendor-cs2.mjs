/**
 * Copy the cs2-core helpers the v13 path runs into packages/verify/vendor.
 * The Merkle and line copies hash with the pure SHA-256. The originals
 * stay on node:crypto.
 */
import { mkdirSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const VERIFY = dirname(HERE);
const CORE = join(VERIFY, '..', 'cs2-core');
const OUT = join(VERIFY, 'vendor', 'cs2-core');

mkdirSync(join(OUT, 'merkle'), { recursive: true });
mkdirSync(join(OUT, 'line'), { recursive: true });
mkdirSync(join(OUT, 'ecdsa'), { recursive: true });

function lf(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function mustReplace(text, find, replace, label) {
  const hits = text.split(find).length - 1;
  if (hits !== 1) throw new Error(`${label}: found ${hits}`);
  return text.replace(find, replace);
}

writeFileSync(join(OUT, 'sha256.js'), lf(readFileSync(join(CORE, 'sha256.js'), 'utf8')));

let merkle = lf(readFileSync(join(CORE, 'merkle', 'index.js'), 'utf8'));
merkle = mustReplace(
  merkle,
  "import { createHash } from 'node:crypto';\n",
  "import { sha256 as digest } from '../sha256.js';\n",
  'merkle import',
);
merkle = mustReplace(
  merkle,
  `function sha256(bytes) {
  return new Uint8Array(createHash('sha256').update(bytes).digest());
}`,
  `function sha256(bytes) {
  return digest(bytes);
}`,
  'merkle sha256',
);
merkle = mustReplace(
  merkle,
  '  const raw = Buffer.from(value, \'hex\');',
  `  const raw = new Uint8Array(value.length / 2);
  for (let i = 0; i < raw.length; i += 1) raw[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);`,
  'merkle hex',
);
writeFileSync(join(OUT, 'merkle', 'index.js'), merkle);

let line = lf(readFileSync(join(CORE, 'line', 'index.mjs'), 'utf8'));
line = mustReplace(
  line,
  "import { createHash } from 'node:crypto';\n",
  "import { sha256 as digest } from '../sha256.js';\n",
  'line import',
);
line = mustReplace(
  line,
  `function sha256(...parts) {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return new Uint8Array(hash.digest());
}`,
  `function sha256(...parts) {
  let len = 0;
  for (const part of parts) len += part.length;
  const all = new Uint8Array(len);
  let off = 0;
  for (const part of parts) {
    all.set(part, off);
    off += part.length;
  }
  return digest(all);
}`,
  'line sha256',
);
writeFileSync(join(OUT, 'line', 'index.mjs'), line);

for (const name of ['curves.js', 'recover.js', 'bytes.js', 'keccak.js', 'sign.js']) {
  cpSync(join(CORE, 'ecdsa', name), join(OUT, 'ecdsa', name));
}

function codeOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
for (const file of [join(OUT, 'merkle', 'index.js'), join(OUT, 'line', 'index.mjs')]) {
  const bare = codeOnly(lf(readFileSync(file, 'utf8')));
  if (/from ['"]node:crypto['"]|createHash\(|\bBuffer\b/.test(bare)) {
    throw new Error(`vendor still has node crypto or Buffer: ${file}`);
  }
}
