/**
 * XFuel SDK — first hour: free /v1 chat + signed receipt. No wallet.
 *
 *   npx tsx examples/quickstart.ts
 *
 * After `npm install xfuel-sdk`:
 *   import { XFuelClient } from 'xfuel-sdk';
 *
 * The hosted hostname says testnet. Payments on that host are real Base USDC.
 * This script uses the unmetered path and does not move funds.
 */
import { XFuelClient } from '../src/index.js';

const {
  XFUEL_API_URL,
  XFUEL_API_KEY,
  XFUEL_MODEL = 'xfuel/auto',
} = process.env;

async function main() {
  const client = new XFuelClient({ baseUrl: XFUEL_API_URL, apiKey: XFUEL_API_KEY });

  const chat = await client.chatCompletions({
    model: XFUEL_MODEL,
    messages: [{ role: 'user', content: 'Say hello in five words.' }],
  });
  console.log('answer     :', chat.choices[0]?.message?.content);
  console.log('receipt    :', chat.xfuel?.verify_url ?? client.receiptUrl(String(chat.xfuel?.task_id ?? '')));
  console.log('rail       :', chat.xfuel?.payment?.rail ?? 'unmetered');
}

main().catch((err) => {
  console.error('quickstart failed:', err?.message ?? err);
  process.exit(1);
});
