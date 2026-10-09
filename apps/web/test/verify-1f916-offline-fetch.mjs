/**
 * Offline stand-in for the 1F916 verifier fixture.
 * The public receipt is an unsigned shell. The signed document, JWKS, and
 * the published identity-log hash live in the repo, so the web suite can
 * run with the network cut off.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const receipt = JSON.parse(readFileSync(join(root, 'packages/verify/test/fixtures/public/chit-1ebc5616.json'), 'utf8'));
const jwks = JSON.parse(readFileSync(join(root, 'packages/verify/test/fixtures/chit402-jwks.json'), 'utf8'));

const FINGERPRINT = 'a09e1e0b0aed6a7826b55281ef1e8af19fb164034a662d122adaa503b54f7dc2';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const payer = '0x253695Ff2DAa549980D9181B962d042B73A5e499';
const payee = '0x23f713411c30BBd9A989c9cbC22EB0b55F7f7334';

function pad(addr) {
  return `0x${addr.slice(2).toLowerCase().padStart(64, '0')}`;
}

function json(body) {
  return { ok: true, json: async () => body };
}

export async function offlineVerifyFetch(url, init) {
  const target = String(url);
  if (target.includes('/.well-known/jwks.json')) return json(jwks);
  if (target.includes('/receipt/chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96')) return json(receipt);
  if (target.includes('1f916.ai')) {
    return json({
      events: [{ id: 20498, kind: 'listing', hash: FINGERPRINT }],
      events_has_more: false,
    });
  }
  if (init?.method === 'POST' || target.includes('mainnet.base.org')) {
    return json({
      result: {
        status: '0x1',
        logs: [{
          address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
          topics: [TRANSFER_TOPIC, pad(payer), pad(payee)],
          data: `0x${(2000n).toString(16).padStart(64, '0')}`,
        }],
      },
    });
  }
  throw new Error(`unexpected fetch ${target}`);
}
