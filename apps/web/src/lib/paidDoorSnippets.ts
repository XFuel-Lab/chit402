/** Same keyless call as the homepage drop-in. Partner key stays a second snippet. */

export function keylessChatSnippet(apiV1: string): string {
  return `import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';

const client = new x402Client();
registerExactEvmScheme(client, { signer: privateKeyToAccount(process.env.EVM_PRIVATE_KEY) });
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

const res = await fetchWithPayment('${apiV1}/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'xfuel/auto', messages: [{ role: 'user', content: 'Say hello in five words.' }] }),
});
const paid = await res.json();
console.log(paid.xfuel.verify_url); // signed receipt`;
}

export function partnerKeySnippet(apiV1: string): string {
  return `const res = await fetch('${apiV1}/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': process.env.CHIT402_API_KEY,
  },
  body: JSON.stringify({
    model: 'xfuel/auto',
    messages: [{ role: 'user', content: 'Say hello in five words.' }],
  }),
});
const paid = await res.json();
console.log(paid.xfuel.verify_url); // signed receipt`;
}

export const PAID_DOOR_GET =
  'Signed receipt, verify_url, and a book row after you register.';
