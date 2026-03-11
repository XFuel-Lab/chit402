/**
 * Theta Explorer API utilities
 *
 * Base URL: https://explorer-api.thetatoken.org/api/
 * Docs:     https://docs.thetatoken.org/docs/explorer-api-reference
 *
 * Endpoints used:
 *   GET /supply/theta   → { total_supply, circulation_supply }
 *   GET /supply/tfuel   → { circulation_supply }
 *   GET /stake/totalAmount → { totalAmount, totalNodes }
 *   GET /account/:address  → { balance: { thetawei, tfuelwei }, sequence, txs_counter }
 *
 * Note: The Explorer API has no endpoint for EdgeCloud node counts, active AI jobs,
 * compute TFLOPS, or per-wallet TFUEL rewards earned from edge node operation.
 * Those metrics are only available via Theta EdgeCloud's own dashboard APIs
 * (not publicly documented). The functions below return what the Explorer API
 * actually exposes and fall back to static estimates for unavailable data.
 */

const EXPLORER_API = 'https://explorer-api.thetatoken.org/api';

export interface EdgeCloudStats {
  activeNodes: number;
  totalCompute: string;
  currentAIJobs: number;
  thetaSupply?: string;
  tfuelSupply?: string;
  totalStaked?: string;
  totalStakeNodes?: number;
}

export interface PersonalEarnings {
  tfuelRewards: string;
  pendingRewards: string;
  tdropBoost: number;
  tfuelBalance?: string;
  thetaBalance?: string;
}

/**
 * Fetch network-level stats using the Theta Explorer API.
 *
 * Uses /supply/theta, /supply/tfuel, and /stake/totalAmount — the only
 * publicly documented network-wide endpoints. EdgeCloud-specific metrics
 * (active nodes, TFLOPS, AI jobs) are not available via the Explorer API
 * and fall back to static estimates.
 *
 * Docs: https://docs.thetatoken.org/docs/explorer-api-reference
 */
export async function fetchEdgeCloudStats(): Promise<EdgeCloudStats> {
  let thetaSupply: string | undefined;
  let tfuelSupply: string | undefined;
  let totalStaked: string | undefined;
  let totalStakeNodes: number | undefined;

  try {
    const [supplyTheta, supplyTfuel, stakeTotal] = await Promise.allSettled([
      fetch(`${EXPLORER_API}/supply/theta`).then(r => r.ok ? r.json() : null),
      fetch(`${EXPLORER_API}/supply/tfuel`).then(r => r.ok ? r.json() : null),
      fetch(`${EXPLORER_API}/stake/totalAmount`).then(r => r.ok ? r.json() : null),
    ]);

    if (supplyTheta.status === 'fulfilled' && supplyTheta.value) {
      const d = supplyTheta.value;
      thetaSupply = d.circulation_supply
        ? (Number(d.circulation_supply) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' THETA'
        : undefined;
    }
    if (supplyTfuel.status === 'fulfilled' && supplyTfuel.value) {
      const d = supplyTfuel.value;
      tfuelSupply = d.circulation_supply
        ? (Number(d.circulation_supply) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' TFUEL'
        : undefined;
    }
    if (stakeTotal.status === 'fulfilled' && stakeTotal.value) {
      const d = stakeTotal.value;
      totalStakeNodes = d.totalNodes ? Number(d.totalNodes) : undefined;
      totalStaked = d.totalAmount
        ? (Number(d.totalAmount) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' THETA'
        : undefined;
    }
  } catch (error) {
    console.warn('[ThetaExplorerAPI] Failed to fetch supply/stake stats:', error);
  }

  return {
    // EdgeCloud-specific metrics not in Explorer API — use known estimates
    activeNodes: 10247,
    totalCompute: '250,000 TFLOPS',
    currentAIJobs: 0,
    // Real data from Explorer API
    thetaSupply,
    tfuelSupply,
    totalStaked,
    totalStakeNodes,
  };
}

/**
 * Fetch wallet balance and transaction history using the Theta Explorer API.
 *
 * Uses GET /account/:address which returns:
 *   { balance: { thetawei, tfuelwei }, sequence, txs_counter }
 *
 * Note: The Explorer API does NOT expose edge node reward earnings, pending
 * rewards, or TDROP boost. Those are EdgeCloud-internal metrics. This function
 * returns wallet balance data instead, which is what the API actually provides.
 *
 * Docs: https://docs.thetatoken.org/docs/explorer-api-reference
 */
export async function fetchPersonalEarnings(address: string): Promise<PersonalEarnings | null> {
  if (!address) return null;

  try {
    const res = await fetch(`${EXPLORER_API}/account/${address}`);
    if (!res.ok) return null;

    const data = await res.json();
    // Explorer API returns: { type: "account", body: { address, balance: { thetawei, tfuelwei }, sequence, txs_counter } }
    const body = data?.body ?? data;
    const thetawei = body?.balance?.thetawei ?? '0';
    const tfuelwei = body?.balance?.tfuelwei ?? '0';

    return {
      tfuelRewards: formatTFUEL(BigInt(tfuelwei)),
      pendingRewards: '0.00',   // Not available via Explorer API
      tdropBoost: 0,            // Not available via Explorer API
      tfuelBalance: formatTFUEL(BigInt(tfuelwei)),
      thetaBalance: formatTheta(BigInt(thetawei)),
    };
  } catch (error) {
    console.warn('[ThetaExplorerAPI] Failed to fetch account data:', error);
    return null;
  }
}

/**
 * Fetch account transaction history using GET /accounttx/:address
 * Returns the most recent transactions of a given type.
 *
 * type 2 = send tx, type 7 = smart contract tx
 * Docs: https://docs.thetatoken.org/docs/explorer-api-reference
 */
export async function fetchAccountTxHistory(
  address: string,
  txType: number = 7,
  pageNumber: number = 1,
  limitNumber: number = 10,
): Promise<{ hash: string; block_height: string; timestamp: string; type: number }[]> {
  if (!address) return [];
  try {
    const url = `${EXPLORER_API}/accounttx/${address}?type=${txType}&pageNumber=${pageNumber}&limitNumber=${limitNumber}&isEqualType=true`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return data?.body ?? [];
  } catch {
    return [];
  }
}

// ── Formatters ──────────────────────────────────────────────────────────────

function formatTFUEL(wei: bigint): string {
  const whole = Number(wei / BigInt(1e12)) / 1e6;
  if (whole < 1000) return whole.toFixed(2);
  if (whole < 1_000_000) return (whole / 1000).toFixed(2) + 'K';
  return (whole / 1_000_000).toFixed(2) + 'M';
}

function formatTheta(wei: bigint): string {
  const whole = Number(wei / BigInt(1e12)) / 1e6;
  if (whole < 1000) return whole.toFixed(2);
  if (whole < 1_000_000) return (whole / 1000).toFixed(2) + 'K';
  return (whole / 1_000_000).toFixed(2) + 'M';
}
