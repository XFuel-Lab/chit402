/**
 * A durable write that was requested failed. Callers roll the in-memory
 * mutation back and let the request fail. Logging and continuing would
 * report success for a row that a restart cannot see.
 * @param {unknown} err
 * @param {string} label
 */
export function persistFailed(err, label) {
  const wrapped = new Error(label);
  wrapped.code = 'persist_failed';
  wrapped.cause = err;
  return wrapped;
}
