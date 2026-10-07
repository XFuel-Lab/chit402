/** Base Sepolia CAIP-2 id. This package refuses every other network. */
export const BASE_SEPOLIA_NETWORK = 'eip155:84532';

/** Circle USDC on Base Sepolia. Not mainnet USDC. */
export const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

const PRODUCTION_HOSTS = new Set([
  'api.chit402.com',
  'chit402.com',
  'www.chit402.com',
  'api.xfuel.app',
  'xfuel.app',
  'www.xfuel.app',
]);

/**
 * Localhost is the test sandbox. Any other host needs
 * CHIT402_SPEND_HOLD_SANDBOX=true. Production hosts are refused either way.
 * @param {string} gatewayUrl
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {URL}
 */
export function assertSandboxGateway(gatewayUrl, env = process.env) {
  let url;
  try {
    url = new URL(String(gatewayUrl || ''));
  } catch {
    const err = new Error('CHIT402_GATEWAY_URL must be an absolute http(s) URL');
    err.code = 'gateway_url';
    throw err;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    const err = new Error('CHIT402_GATEWAY_URL must be http or https');
    err.code = 'gateway_url';
    throw err;
  }
  const host = url.hostname.toLowerCase();
  if (PRODUCTION_HOSTS.has(host)) {
    const err = new Error(`refusing production gateway host ${host}`);
    err.code = 'production_gateway';
    throw err;
  }
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const sandbox = env?.CHIT402_SPEND_HOLD_SANDBOX === 'true' || env?.CHIT402_SPEND_HOLD_SANDBOX === '1';
  if (!local && !sandbox) {
    const err = new Error('non-local gateway requires CHIT402_SPEND_HOLD_SANDBOX=true');
    err.code = 'sandbox_required';
    throw err;
  }
  return url;
}
