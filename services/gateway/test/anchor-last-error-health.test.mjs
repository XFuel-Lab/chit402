/**
 * A stored Base rejection stays in the journal forever. Health last_error
 * counts it only when it is newer than the last successful Base anchor.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { ReceiptMerkleTree } = await import('../src/receipt-merkle.js');
const { healthIsDegraded, publicHealthBody } = await import('../src/public-metrics.js');

function baseRow(fields) {
  return { chain: 'base', day: '2026-10-16', nonce: 4, ...fields };
}

function healthOf(tree) {
  const log = tree.bundleStatus();
  const body = publicHealthBody({
    degraded: healthIsDegraded(log),
    lastAnchoredRoot: log.last_anchored_root,
    lastAnchoredTx: log.last_anchored_tx,
    anchorLagS: log.anchor_lag_s,
    unanchoredLeaves: log.unanchored_leaves,
    receiptFailures: log.consecutive_failures,
  });
  return { log, status: body.status };
}

test('a rejected anchor_clock_drift followed by a successful Base anchor clears last_error', () => {
  const driftedRoot = 'aa'.repeat(32);
  const driftedTx = `0x${'48'.repeat(32)}`;
  const okRoot = 'bb'.repeat(32);
  const okTx = `0x${'51'.repeat(32)}`;
  const recovered = new ReceiptMerkleTree();
  recovered.bundleFailures = 0;
  recovered.anchorIntents.push(
    baseRow({
      root: driftedRoot,
      tx: driftedTx,
      status: 'replaced',
      reason: 'anchor_clock_drift',
      at: '2026-10-15T17:50:00.000Z',
    }),
    baseRow({
      day: '2026-10-16',
      nonce: 5,
      root: okRoot,
      tx: okTx,
      status: 'anchored',
      at: '2026-10-16T12:00:00.000Z',
    }),
  );
  const ok = healthOf(recovered);
  assert.equal(ok.log.consecutive_failures, 0);
  assert.equal(ok.log.last_error, null);
  assert.equal(ok.log.last_anchored_root, okRoot);
  assert.equal(ok.log.last_anchored_tx, okTx);
  assert.equal(ok.status, 'ok');

  const stillBad = new ReceiptMerkleTree();
  stillBad.bundleFailures = 0;
  stillBad.anchorIntents.push(
    baseRow({
      nonce: 5,
      root: okRoot,
      tx: okTx,
      status: 'anchored',
      at: '2026-10-16T12:00:00.000Z',
    }),
    baseRow({
      nonce: 6,
      root: 'cc'.repeat(32),
      tx: `0x${'49'.repeat(32)}`,
      status: 'replaced',
      reason: 'anchor_clock_drift',
      at: '2026-10-16T18:00:00.000Z',
    }),
  );
  const degraded = healthOf(stillBad);
  assert.equal(degraded.log.last_error, 'anchor_clock_drift');
  assert.equal(degraded.log.last_anchored_root, okRoot);
  assert.equal(degraded.log.last_anchored_tx, okTx);
  assert.equal(degraded.status, 'degraded');
});
