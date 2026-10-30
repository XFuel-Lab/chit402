/**
 * Bundled RPC list for the v13 path. No new CLI flag. A chain with no entry
 * and no BASE_RPC_URL exits 2 with a clear message.
 */
export const V13_RPC_DEFAULTS: Readonly<Record<number, readonly string[]>> = Object.freeze({
  8453: Object.freeze([
    'https://mainnet.base.org',
    'https://base-rpc.publicnode.com',
  ]),
  84532: Object.freeze([
    'https://sepolia.base.org',
  ]),
});
