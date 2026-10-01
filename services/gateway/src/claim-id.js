/**
 * Seat id for a paid receipt. The book agent_id, as a decimal string.
 * Absent or unusable values are null so the signer can still emit the key.
 * @param {unknown} value
 * @returns {string|null}
 */
export function claimIdOf(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return String(n);
}

/** First usable seat on a receipt view or draft. */
export function claimIdFromView(view) {
  if (!view || typeof view !== 'object') return null;
  return claimIdOf(view.claim_id)
    || claimIdOf(view.caller_binding?.agent_id)
    || claimIdOf(view.agent_id)
    || claimIdOf(view.usage_settled?.agent_id);
}

/**
 * Book id to sign, resolved before the payment JWS is built.
 * An existing ledger row wins, then the settle record, the session, and the
 * task. A paid call with no book yet allocates one so the signature can name it.
 * @param {{
 *   settleAgentId?: number|string|null,
 *   sessionAgentId?: number|string|null,
 *   taskAgentId?: number|string|null,
 *   paymentRef?: string|null,
 *   taskId?: string|null,
 *   ledger?: { findByRef?: Function, findByTask?: Function }|null,
 *   registry?: { allocate?: Function }|null,
 * }} input
 * @returns {number|null}
 */
export function resolvePaidClaimAgent({
  settleAgentId = null,
  sessionAgentId = null,
  taskAgentId = null,
  paymentRef = null,
  taskId = null,
  ledger = null,
  registry = null,
} = {}) {
  const ref = paymentRef != null && String(paymentRef).trim() ? String(paymentRef).trim() : null;
  if (ref && ledger) {
    const byRef = typeof ledger.findByRef === 'function' ? ledger.findByRef(ref) : null;
    const fromRef = claimIdOf(byRef?.agent_id);
    if (fromRef) return Number(fromRef);
    if (taskId && typeof ledger.findByTask === 'function') {
      const fromTask = claimIdOf(ledger.findByTask(String(taskId))?.agent_id);
      if (fromTask) return Number(fromTask);
    }
  }
  const seated = claimIdOf(settleAgentId) || claimIdOf(sessionAgentId) || claimIdOf(taskAgentId);
  if (seated) return Number(seated);
  if (ref && registry && typeof registry.allocate === 'function') {
    const created = registry.allocate({ taskId, paymentRef: ref });
    const id = claimIdOf(created?.agent_id);
    return id ? Number(id) : null;
  }
  return null;
}
