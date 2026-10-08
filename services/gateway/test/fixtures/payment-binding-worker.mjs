/**
 * One settle attempt against a shared challenge file.
 * Parent passes the store path, nonce, and task id. Config and header are env.
 */
import { settleBoundPayment } from '../../src/x402-settle.js';
import { DurableChallengeStore } from '../../src/x402-durable-store.js';
import { echoChainReader } from '../../src/x402-chain.js';

const [file, nonce, taskId] = process.argv.slice(2);
const cfg = JSON.parse(process.env.PB_CFG || '{}');
cfg.chainReader = echoChainReader;
const store = new DurableChallengeStore(file);
const result = await settleBoundPayment({
  taskId,
  cfg,
  amount: cfg.quoteAmount || cfg.amount,
  paymentHeader: process.env.PB_HEADER,
  nonce,
  store,
  clientVersion: cfg.clientVersion,
});
process.stdout.write(JSON.stringify({
  kind: result?.kind || null,
  code: result?.code || result?.reason || null,
  confirmed: result?.confirmed === true,
  paymentRef: result?.paymentRef || null,
}));
