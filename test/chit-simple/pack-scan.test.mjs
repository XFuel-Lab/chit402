import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const pack = join(dirname(fileURLToPath(import.meta.url)), '../../deploy/chit-simple/sepolia-pack');
const skip = new Set(['out', 'cache', 'broadcast']);
const flag = '--private-' + 'key';
const envName = 'PRIVATE_' + 'KEY';

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) out.push(...files(path));
    else if (st.isFile()) out.push(path);
  }
  return out;
}

test('the deploy pack does not put a key on the command line', () => {
  const hits = [];
  for (const path of files(pack)) {
    const text = readFileSync(path, 'utf8');
    if (text.includes(flag) || text.includes(envName)) hits.push(path);
  }
  assert.deepEqual(hits, []);
});
