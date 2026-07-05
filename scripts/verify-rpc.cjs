#!/usr/bin/env node
/**
 * verify-rpc.cjs — Chain-agnostic JSON-RPC endpoint verifier.
 *
 * Confirms that an RPC URL (e.g. a ZAN Node Service endpoint) responds, reports
 * its chainId + latest block + latency, and labels known XFuel-relevant chains.
 * Use this before wiring a ZAN endpoint into THETA_RPC_URLS to confirm it exposes
 * the expected ETH-RPC adaptor (Theta mainnet=361 / testnet=365).
 *
 * Usage:
 *   node scripts/verify-rpc.cjs <url> [<url> ...]
 *   node scripts/verify-rpc.cjs                 # reads THETA_RPC_URLS / ZAN_RPC_URLS env
 *   EXPECT_CHAIN_ID=361 node scripts/verify-rpc.cjs <url>   # assert chainId, non-zero exit on mismatch
 *
 * No dependencies (uses global fetch, Node 18+). Secrets in URLs are masked in output.
 */

const KNOWN_CHAINS = {
  1: 'Ethereum Mainnet',
  10: 'Optimism',
  56: 'BNB Smart Chain',
  137: 'Polygon',
  361: 'Theta Mainnet (ETH-RPC adaptor)',
  365: 'Theta Testnet (ETH-RPC adaptor)',
  945: 'Bittensor EVM Testnet',
  964: 'Bittensor EVM Mainnet',
  8453: 'Base',
  42161: 'Arbitrum One',
  360777: 'Theta Privatenet',
  361001: 'XFuel Subchain Mainnet',
  365001: 'XFuel Subchain Testnet',
};

/** Mask an API key embedded in a path (ZAN puts it as the last path segment). */
function maskUrl(url) {
  try {
    const u = new URL(url);
    u.pathname = u.pathname.replace(/\/[A-Za-z0-9_-]{16,}(\/?)$/, '/***$1');
    return u.toString();
  } catch {
    return url;
  }
}

async function rpcCall(url, method, params = []) {
  const started = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  const latencyMs = Date.now() - started;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message || JSON.stringify(json.error)}`);
  return { result: json.result, latencyMs };
}

async function verify(url, expectChainId) {
  const masked = maskUrl(url);
  try {
    const chain = await rpcCall(url, 'eth_chainId');
    const chainId = parseInt(chain.result, 16);
    let block = null;
    try {
      const b = await rpcCall(url, 'eth_blockNumber');
      block = parseInt(b.result, 16);
    } catch { /* some adaptors gate block number; chainId is the key signal */ }

    const label = KNOWN_CHAINS[chainId] || 'unknown chain';
    const ok = expectChainId == null || chainId === Number(expectChainId);
    const mark = ok ? 'OK ' : 'MISMATCH';
    console.log(`[${mark}] ${masked}`);
    console.log(`        chainId=${chainId} (${label})  block=${block ?? 'n/a'}  latency=${chain.latencyMs}ms`);
    if (!ok) console.log(`        expected chainId=${expectChainId}`);
    return ok;
  } catch (err) {
    console.log(`[FAIL] ${masked}`);
    console.log(`        ${err.message}`);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const urls = args.length
    ? args
    : [
        ...(process.env.THETA_RPC_URLS || '').split(','),
        ...(process.env.ZAN_RPC_URLS || '').split(','),
      ]
        .map(s => s.trim())
        .filter(Boolean);

  if (urls.length === 0) {
    console.error('Usage: node scripts/verify-rpc.cjs <url> [<url> ...]');
    console.error('   or set THETA_RPC_URLS / ZAN_RPC_URLS in the environment.');
    process.exit(2);
  }

  const expect = process.env.EXPECT_CHAIN_ID || null;
  console.log(`Verifying ${urls.length} RPC endpoint(s)${expect ? ` (expect chainId=${expect})` : ''}\n`);

  let allOk = true;
  for (const url of urls) {
    const ok = await verify(url, expect);
    allOk = allOk && ok;
    console.log('');
  }

  process.exit(allOk ? 0 : 1);
}

main();
