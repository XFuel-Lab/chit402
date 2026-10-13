import { parentPort, workerData } from 'node:worker_threads';
import { settleIntent } from '../src/intent-record.js';
import { openIntentStore } from '../src/intent-store.js';

const store = openIntentStore(workerData.file);
const result = settleIntent(store, {
  intent_id: workerData.intentId,
  payer: workerData.payer,
  payee: workerData.payee,
  amount: workerData.amount,
});
parentPort.postMessage({
  ok: result.ok === true,
  error: result.error || null,
  receipt: result.ok ? result.body.receipt.task_id : null,
});
