/**
 * Design-partner cookbook: budget + Private Spend + buyer stats.
 *
 * Demonstrates the Sprint 3 partner path:
 *   1. Quote USDC price
 *   2. Pay via x402 and submit inference (agent budget, not provider API keys)
 *   3. Fetch public receipt JSON (privacy + verify without trusting HTML)
 *   4. Poll buyer-only /stats/me north-star (paid tasks / USDC fees)
 *
 * Run (packages/sdk):
 *   XFUEL_API_URL=https://api-testnet.xfuel.app \
 *   XFUEL_API_KEY=<your-partner-key> \
 *   npx tsx examples/private-spend-budget.ts
 *
 * Gateway should have PRIVATE_SPEND_ENABLED=true for privacy.mode=vendor_blind.
 * Docs: docs/PRIVATE_SPEND_THESIS.md · docs/FOUNDER_ACTIONS.md · AGENT_PLAYBOOK Flow 7
 */
import { XFuelClient, ChainId, createMockPayer, type X402Payer } from '../src/index.js';

const {
  XFUEL_API_URL = 'https://api-testnet.xfuel.app',
  XFUEL_API_KEY,
  XFUEL_SENDER = '0x000000000000000000000000000000000000dEaD',
  XFUEL_MODEL = 'llama-3-70b',
  XFUEL_AMOUNT = '1000000',
  XFUEL_PAYER_PK,
  XFUEL_PARENT_TASK_ID,
  XFUEL_CORRELATION_ID = `partner-demo-${Date.now()}`,
} = process.env;

async function buildPayer(): Promise<X402Payer> {
  if (!XFUEL_PAYER_PK) {
    console.log('· payer: mock (no real USDC moved)');
    return createMockPayer();
  }
  const { Wallet } = await import('ethers');
  const { createEip3009Payer } = await import('../src/onchain.js');
  const wallet = new Wallet(XFUEL_PAYER_PK);
  console.log(`· payer: EIP-3009 from ${wallet.address}`);
  return createEip3009Payer(wallet);
}

async function main() {
  if (!XFUEL_API_KEY) {
    console.warn('! Set XFUEL_API_KEY to your design-partner key for /stats/me');
  }

  const client = new XFuelClient({ baseUrl: XFUEL_API_URL, apiKey: XFUEL_API_KEY });

  console.log('\n① Quote');
  const quote = await client.quoteTask({ model_id: XFUEL_MODEL, amount: XFUEL_AMOUNT });
  console.log(`  USDC amount: ${quote.rails.usdc.amount} on ${quote.rails.usdc.network}`);

  console.log('\n② Submit + pay (budget, not provider keys)');
  const payer = await buildPayer();
  const task = await client.submitInference(XFUEL_MODEL, XFUEL_SENDER, XFUEL_AMOUNT, {
    chain_id: ChainId.BASE,
    payment: { rail: 'usdc', network: quote.rails.usdc.network, maxAmount: quote.rails.usdc.amount },
    ...(XFUEL_PARENT_TASK_ID ? { parent_task_id: XFUEL_PARENT_TASK_ID } : {}),
    correlation_id: XFUEL_CORRELATION_ID,
  });
  console.log(`  task_id: ${task.task_id}`);
  console.log(`  verify:  ${task.verify_url || client.receiptUrl(task.task_id)}`);

  console.log('\n③ Wait for settlement');
  const status = await client.waitForCompletion(task.task_id, { intervalMs: 3000, maxRetries: 40 });
  console.log(`  status: ${status.status}`);

  console.log('\n④ Public receipt JSON (third-party verify surface)');
  const receipt = await client.getReceipt(task.task_id);
  console.log(`  privacy: ${JSON.stringify((receipt as any).privacy)}`);
  console.log(`  lineage: ${JSON.stringify((receipt as any).lineage)}`);
  console.log(`  binding: ${JSON.stringify((receipt as any).binding?.matches)}`);

  if (XFUEL_API_KEY) {
    console.log('\n⑤ Buyer north-star (/stats/me)');
    try {
      const mine = await client.getMyStats();
      const ns = (mine as any).north_star;
      console.log(`  scope: ${ (mine as any).scope }`);
      console.log(`  paid_tasks_7d: ${ns?.paid_tasks_7d}`);
      console.log(`  usdc_fees_7d:  ${ns?.usdc_fees_7d}`);
      console.log(`  private_spend flag: ${JSON.stringify((mine as any).private_spend)}`);
    } catch (err: any) {
      console.warn(`  /stats/me failed: ${err.message}`);
    }
  }

  console.log('\nDone. Share verify_url with your team — do not share provider API keys.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
