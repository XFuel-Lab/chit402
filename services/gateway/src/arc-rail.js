/**
 * Arc rail (USDC on Arc), behind ARC_RAIL_ENABLED. Off by default.
 *
 * Flag on: Arc testnet (eip155:5042002) is accepted. Arc mainnet
 * (eip155:5042) is listed here but stays disabled in code until a later
 * change turns it on. Flag off: every Arc id is refused, and Base and Solana
 * take exactly the paths they took before this module existed.
 *
 * This module has no imports from the x402 modules, so they can all import it.
 */

export const ARC_SYSTEM_TRANSFER_EMITTER = '0xfffffffffffffffffffffffffffffffffffffffe';

/**
 * Per-chain facts. `blockTimeMs` sizes the late-issue search window.
 * `enabled` is the code-level switch on top of the env flag.
 */
export const ARC_CHAINS = Object.freeze({
  'arc-testnet': Object.freeze({
    short: 'arc-testnet',
    caip: 'eip155:5042002',
    chainId: 5042002,
    usdc: '0x3600000000000000000000000000000000000000',
    usdcDomain: Object.freeze({ name: 'USDC', version: '2' }),
    blockTimeMs: 500,
    enabled: true,
  }),
  arc: Object.freeze({
    short: 'arc',
    caip: 'eip155:5042',
    chainId: 5042,
    // Not filled in until mainnet is turned on. A null asset refuses everything.
    usdc: null,
    usdcDomain: Object.freeze({ name: 'USDC', version: '2' }),
    blockTimeMs: 500,
    enabled: false,
  }),
});

const BY_ID = new Map();
for (const c of Object.values(ARC_CHAINS)) {
  BY_ID.set(c.short, c);
  BY_ID.set(c.caip, c);
}

export function arcRailEnabled(env = process.env) {
  return String(env?.ARC_RAIL_ENABLED || '').trim().toLowerCase() === 'true';
}

/** The Arc chain entry for any Arc id, flag or not. Null for non-Arc ids. */
export function arcChainOf(network) {
  if (network == null) return null;
  const n = String(network).trim().toLowerCase();
  return BY_ID.get(n) || null;
}

/** True for any Arc id (testnet or mainnet), flag or not. */
export function isArcId(network) {
  return arcChainOf(network) != null;
}

/** Short name when this Arc chain is live (flag on and enabled in code). Else null. */
export function arcNetwork(network, env = process.env) {
  const c = arcChainOf(network);
  if (!c || !c.enabled || !arcRailEnabled(env)) return null;
  return c.short;
}

/** CAIP-2 id when live, else null. */
export function arcCaip(network, env = process.env) {
  const short = arcNetwork(network, env);
  return short ? ARC_CHAINS[short].caip : null;
}

/** True when the id is Arc but the rail is not live for it. Callers refuse. */
export function arcRefused(network, env = process.env) {
  return isArcId(network) && arcNetwork(network, env) == null;
}

/** Only the chain's native USDC contract is accepted on Arc. */
export function arcAssetAllowed(network, asset, env = process.env) {
  const short = arcNetwork(network, env);
  if (!short) return false;
  const want = ARC_CHAINS[short].usdc;
  if (!want || !asset) return false;
  return String(asset).trim().toLowerCase() === want.toLowerCase();
}

/**
 * The 0xff..fe emitter mirrors each USDC move as a Transfer in 18-decimal
 * native units. It is never a payment log and is never counted.
 */
export function isArcSystemLog(log) {
  return String(log?.address || '').trim().toLowerCase() === ARC_SYSTEM_TRANSFER_EMITTER;
}

/**
 * Server-side EVM RPC for a network. Base (and anything not Arc) returns the
 * same expression the callers used before: cfg.baseRpcUrl || cfg.rpcUrl.
 * Arc returns cfg.arcRpcUrl, never the Base URL. A refused Arc id returns null.
 */
export function evmRpcUrlFor(network, cfg = {}, env = process.env) {
  if (isArcId(network)) {
    return arcNetwork(network, env) ? (cfg.arcRpcUrl || null) : null;
  }
  return cfg.baseRpcUrl || cfg.rpcUrl || null;
}

/** Settlement RPC row for an EVM network. */
export function evmSettlementSide(network, env = process.env) {
  if (isArcId(network)) return arcNetwork(network, env) ? 'arc' : null;
  return 'base';
}

// Base window, unchanged: 64-block margin, 2 x 2,000-block chunks.
const BASE_WINDOW = Object.freeze({ marginBlocks: 64n, chunkBlocks: 2000n, chunkCap: 2n, blockMs: 2000n });
// Arc window by time: the same reach back and forward Base gets at 2 s blocks.
const LOOKBACK_SECONDS = 128; // 64 Base blocks
const HORIZON_SECONDS = 8000; // 4,000 Base blocks
const ARC_MAX_CHUNK = 9000n; // under the 10,000-block eth_getLogs cap

/** Late-issue search window for a network. Base gets the old constants exactly. */
export function lateIssueWindow(network, env = process.env) {
  const short = arcNetwork(network, env);
  if (!short) return BASE_WINDOW;
  const ms = ARC_CHAINS[short].blockTimeMs;
  const margin = BigInt(Math.ceil((LOOKBACK_SECONDS * 1000) / ms));
  const total = BigInt(Math.ceil((HORIZON_SECONDS * 1000) / ms));
  const cap = (total + ARC_MAX_CHUNK - 1n) / ARC_MAX_CHUNK;
  const chunk = (total + cap - 1n) / cap;
  return Object.freeze({ marginBlocks: margin, chunkBlocks: chunk, chunkCap: cap, blockMs: BigInt(ms) });
}
