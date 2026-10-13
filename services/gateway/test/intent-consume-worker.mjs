import { parentPort, workerData } from 'node:worker_threads';
import { settleIntent } from '../src/intent-record.js';
import { openIntentStore } from '../src/intent-store.js';

const store = openIntentStore(workerData.file);
const result = await settleIntent(store, {
  intent_id: workerData.intentId,
  amount: '1',
  payment_header: 'h',
  nonce: 'n',
}, process.env, {
  cfg: { network: 'base' },
  async settleBoundPayment() {
    return {
      kind: 'settled',
      confirmed: true,
      settledAmount: workerData.chainAmount,
      payerWallet: workerData.payer,
      payTo: workerData.payee,
      paymentRef: workerData.tx,
      bookSpent() {},
      releaseClaim() {},
    };
  },
});
parentPort.postMessage({
  ok: result.ok === true,
  error: result.error || null,
  receipt: result.ok ? result.body.receipt.task_id : null,
});
