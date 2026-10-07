/**
 * Base Sepolia, test USDC only.
 *
 *   node examples/base-sepolia.mjs
 *   node examples/base-sepolia.mjs --pay
 *
 * --pay reads env names listed below. It does not embed secrets.
 * It refuses any 402 whose accepts are not eip155:84532.
 */
import { BASE_SEPOLIA_NETWORK, BASE_SEPOLIA_USDC, assertSandboxGateway } from '../src/index.js';

const NETWORK = BASE_SEPOLIA_NETWORK;
const USDC = BASE_SEPOLIA_USDC;

if (NETWORK !== 'eip155:84532') {
  console.error('refusing to run: this example is Base Sepolia only');
  process.exit(1);
}
if (USDC.toLowerCase() === '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913') {
  console.error('refusing to run: asset is mainnet USDC');
  process.exit(1);
}

const ENV = [
  'CHIT402_GATEWAY_URL',
  'CHIT402_SPEND_HOLD_TOKEN',
  'CHIT402_FUNDER',
  'CHIT402_CAP_ATOMIC',
  'CDP_API_KEY_ID',
  'CDP_API_KEY_SECRET',
  'CDP_WALLET_SECRET',
  'X402_RESOURCE_URL',
];

console.log(`network ${NETWORK}`);
console.log(`asset   ${USDC} (Base Sepolia USDC)`);

if (!process.argv.includes('--pay')) {
  console.log('Dry run. Pass --pay to send a Base Sepolia test-USDC payment.');
  console.log('Env names (no values are stored in this repo):');
  for (const name of ENV) console.log(`  ${name}`);
  console.log('Optional: CHIT402_AGENT_ID, CHIT402_SPEND_HOLD_SANDBOX=true for a non-local sandbox.');
  process.exit(0);
}

const missing = ENV.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`missing env: ${missing.join(', ')}`);
  process.exit(2);
}

assertSandboxGateway(process.env.CHIT402_GATEWAY_URL);
const resource = new URL(process.env.X402_RESOURCE_URL);
const localResource = resource.hostname === 'localhost' || resource.hostname === '127.0.0.1';
if (resource.protocol !== 'https:' && !localResource) {
  console.error('X402_RESOURCE_URL must be https, or http on localhost');
  process.exit(1);
}

const { x402Client } = await import('@x402/core/client');
const { applySpendControls, fromCdpEvmAccount } = await import('@coinbase/cdp-sdk/x402');
const { CdpClient } = await import('@coinbase/cdp-sdk');
const { registerExactEvmScheme } = await import('@x402/evm/exact/client');
const { wrapFetchWithPayment } = await import('@x402/fetch');
const { createChitSpendStore, attachChitReceipt } = await import('../src/index.js');

const client = new x402Client();
if (typeof client.setSpendControls === 'function') client.setSpendControls(false);

const cdp = new CdpClient();
const account = await cdp.evm.getOrCreateAccount({ name: 'chit402-sepolia-spend' });
registerExactEvmScheme(client, { signer: fromCdpEvmAccount(account) });

const store = createChitSpendStore({
  gatewayUrl: process.env.CHIT402_GATEWAY_URL,
  token: process.env.CHIT402_SPEND_HOLD_TOKEN,
  funder: process.env.CHIT402_FUNDER,
  agentId: process.env.CHIT402_AGENT_ID || null,
});
applySpendControls(client, {
  maxCumulativeSpend: { atomic: process.env.CHIT402_CAP_ATOMIC, asset: USDC },
  allowedNetworks: [NETWORK],
  allowedAssets: [USDC],
  store,
});
attachChitReceipt(client, store);

const first = await fetch(resource);
if (first.status !== 402) {
  console.log(`resource returned ${first.status}; nothing to pay`);
  process.exit(0);
}
const body = await first.json().catch(() => ({}));
const accepts = body.accepts || body.paymentRequired?.accepts || [];
const offNetwork = accepts.filter((row) => String(row.network || '').toLowerCase() !== NETWORK);
if (accepts.length === 0 || offNetwork.length === accepts.length) {
  console.error('refusing to pay: the 402 is not Base Sepolia');
  process.exit(1);
}

const fetchWithPayment = wrapFetchWithPayment(fetch, client);
const paid = await fetchWithPayment(resource);
console.log(`paid status ${paid.status}`);
console.log(store.book.lastReceipt?.verify_url || 'no receipt (settlement was ambiguous or failed)');
