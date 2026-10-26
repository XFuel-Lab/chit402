/**
 * The commit the running gateway process was started from.
 * Deploy must export `GATEWAY_COMMIT=$(git rev-parse HEAD)` (the full
 * 40-hex sha) into the gateway environment before restart.
 */
export const GATEWAY_COMMIT_ENV = 'GATEWAY_COMMIT';

const FULL_SHA = /^[0-9a-f]{40}$/i;

/**
 * Commit for receipt-check feedback. Accepts an abbreviated sha. A missing
 * value is recorded as `GATEWAY_COMMIT unset`.
 */
export function gatewayCommit(env = process.env) {
  const value = String(env[GATEWAY_COMMIT_ENV] || '').trim();
  if (/^[0-9a-f]{7,64}$/i.test(value)) return value.toLowerCase();
  return `${GATEWAY_COMMIT_ENV} unset`;
}

/**
 * Commit for the public /health body: the full 40-hex sha in lower case,
 * or null when GATEWAY_COMMIT is missing, abbreviated or malformed.
 */
export function deployedCommit(env = process.env) {
  const value = String(env?.[GATEWAY_COMMIT_ENV] ?? '').trim();
  return FULL_SHA.test(value) ? value.toLowerCase() : null;
}
