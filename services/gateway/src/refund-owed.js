/**
 * Mark a settled task whose upstream failed after the USDC moved.
 *
 * The receipt status is `failed` and `refund.status` is `refund_owed`.
 * Money already settled is not clawed back here — the receipt is the record
 * that a refund is owed. Another agent may share this helper for the same
 * post-settle failure path.
 *
 * @param {object|null} task
 * @param {{ reason?: string, provider?: string|null }} [opts]
 * @returns {object|null}
 */
export function markRefundOwed(task, { reason = 'upstream_failed', provider = null } = {}) {
  if (!task || typeof task !== 'object') return null;
  task.status = 'failed';
  task.updatedAt = Date.now();
  const who = provider || task.result?.provider || task.meta?.provider || null;
  task.meta = {
    ...(task.meta || {}),
    refund: {
      status: 'refund_owed',
      reason,
      provider: who,
    },
  };
  return task.meta.refund;
}
