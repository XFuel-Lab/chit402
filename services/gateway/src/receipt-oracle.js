/**
 * Receipt oracle — read GET /receipt/:id?format=json and verify HMAC.
 *
 * Verify only. The verify function is injected so this module never
 * holds or names a signing secret.
 */

/**
 * @param {object} receipt
 * @param {(receipt: object) => { checked: boolean, valid: boolean|null, reason?: string }} verify
 */
export function oracleVerify(receipt, verify) {
  if (typeof verify !== 'function') {
    return { ok: false, reason: 'verify function required', hmac: null };
  }
  const hmac = verify(receipt);
  if (!hmac || hmac.checked !== true) {
    return { ok: false, reason: hmac?.reason || 'hmac not checked', hmac };
  }
  if (hmac.valid !== true) {
    return { ok: false, reason: 'hmac invalid', hmac };
  }
  return { ok: true, hmac };
}

/**
 * Load a receipt (same JSON as GET /receipt/:id?format=json) and verify it.
 *
 * @param {string} taskId
 * @param {{
 *   loadReceipt: (id: string) => Promise<object|null>|object|null,
 *   verify: (receipt: object) => { checked: boolean, valid: boolean|null, reason?: string },
 * }} deps
 */
export async function readAndVerifyReceipt(taskId, { loadReceipt, verify }) {
  if (!taskId) {
    return { ok: false, reason: 'task_id required', receipt: null, hmac: null };
  }
  if (typeof loadReceipt !== 'function') {
    return { ok: false, reason: 'loadReceipt required', receipt: null, hmac: null };
  }
  let receipt;
  try {
    receipt = await loadReceipt(String(taskId));
  } catch (err) {
    return { ok: false, reason: err.message || 'receipt load failed', receipt: null, hmac: null };
  }
  if (!receipt) {
    return { ok: false, reason: 'receipt not found', receipt: null, hmac: null };
  }
  const checked = oracleVerify(receipt, verify);
  if (!checked.ok) {
    return { ok: false, reason: checked.reason, receipt, hmac: checked.hmac };
  }
  return { ok: true, receipt, hmac: checked.hmac };
}
