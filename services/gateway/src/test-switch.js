/**
 * Test-only switches (in-memory stores, injected chain readers, http
 * webhooks, skipped workers) turn on only when NODE_ENV is exactly `test`
 * AND the shared production check says this is not production. A process
 * that loaded a production or unlisted issuer key, a KMS signer, or a set
 * ISSUER_KID never gets them, whatever NODE_ENV says.
 */
import { isProductionProcess } from './production-process.js';

/** @param {NodeJS.ProcessEnv} [env] */
export function testSwitchesOn(env = process.env) {
  return env?.NODE_ENV === 'test' && !isProductionProcess(env);
}
