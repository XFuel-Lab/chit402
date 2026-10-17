/**
 * Long-lived racer for reserveTx. The parent sends one key at a time.
 * spend marks the transfer spent, which is the receipt the winner keeps.
 */
import { DurableChallengeStore } from '../../src/x402-durable-store.js';

const file = process.argv[2];
const store = new DurableChallengeStore(file, { createIfMissing: false });

process.on('message', (msg) => {
  if (!msg || msg.cmd !== 'reserve') return;
  let ok = false;
  let error = null;
  try {
    ok = store.reserveTx(msg.key, msg.auth || null, msg.owner, msg.leaseMs || 60_000) === true;
    if (ok && msg.spend) store.markTxSpent(msg.key, { owner: msg.owner });
  } catch (err) {
    error = err.code || err.message;
  }
  process.send({ id: msg.id, ok, error, owner: msg.owner });
});
