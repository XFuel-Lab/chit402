/**
 * Fail if the built web app contains the Solana audit key, provider host, or env name.
 * Source maps are public (vite sourcemap: true), so dist maps are in scope.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = process.env.SOLANA_AUDIT_DIST || join(root, 'apps/web/dist');
const needles = [
  process.env.HELIUS_API_KEY || 'SECRETDUMMYHELIUSKEY01',
  'helius-rpc.com',
  'helius.xyz',
  'api-key',
  'HELIUS_API_KEY',
  'SOLANA_AUDIT_RPC_URL',
  'AUDIT_DEV_14D',
  'VITE_HELIUS',
  'NEXT_PUBLIC_HELIUS',
];

function files(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) files(path, out);
    else if (/\.(js|map|html)$/.test(name)) out.push(path);
  }
  return out;
}

const found = [];
for (const path of files(dist)) {
  const text = readFileSync(path, 'utf8');
  for (const needle of needles) {
    if (needle && text.includes(needle)) found.push(`${path} contains ${needle}`);
  }
}

if (found.length) {
  console.error(found.join('\n'));
  process.exit(1);
}
console.log(`solana audit bundle clean (${files(dist).length} files)`);
