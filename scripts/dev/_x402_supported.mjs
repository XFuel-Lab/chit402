/**
 * Which (scheme, network) pairs will our facilitator actually settle?
 *
 * Deciding whether to move from `exact` to `upto` (metered settlement) turns on
 * one fact that cannot be assumed: whether CDP settles `upto` on Base **mainnet**.
 * The reference facilitator advertises it on Base Sepolia only. Throwaway probe.
 */
import 'dotenv/config';
import { generateCdpJwt } from '../../services/gateway/src/cdp-jwt.js';

const HOST = 'api.cdp.coinbase.com';
const PATH = '/platform/v2/x402/supported';

const jwt = generateCdpJwt({
  apiKeyId: process.env.CDP_API_KEY_ID,
  apiKeySecret: process.env.CDP_API_KEY_SECRET,
  requestMethod: 'GET',
  requestHost: HOST,
  requestPath: PATH,
});

const res = await fetch(`https://${HOST}${PATH}`, {
  headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/json' },
});
const body = await res.json().catch(() => null);

console.log(`CDP /supported → HTTP ${res.status}\n`);
if (!body?.kinds) {
  console.log(JSON.stringify(body, null, 2)?.slice(0, 1200));
  process.exit(0);
}

for (const k of body.kinds) {
  const extra = k.extra ? ` extra=${JSON.stringify(k.extra)}` : '';
  console.log(`  v${k.x402Version}  ${String(k.scheme).padEnd(18)} ${k.network}${extra}`);
}
console.log(`\nextensions: ${JSON.stringify(body.extensions || [])}`);

const base = body.kinds.filter((k) => /eip155:8453$|^base$/.test(k.network));
console.log(`\nBase mainnet schemes: ${base.map((k) => k.scheme).join(', ') || '(none)'}`);
console.log(`upto on Base mainnet: ${base.some((k) => k.scheme === 'upto') ? 'YES' : 'NO'}`);
