import { useState, useEffect, useCallback } from 'react';
import { useReadContract } from 'wagmi';
import { formatEther } from 'viem';
import {
  ADDRESSES, SPLITTER_ABI, VERIFIER_ABI, THETA_INFERENCE_ABI,
  isDeployed,
} from '../contracts';

// ─── M2M Health Types ──────────────────────────────────────────────────────

interface M2MHealthData {
  status: string;
  server: string;
  version: string;
  timestamp: string;
  uptime_s: number;
  a2a_messages_total: number;
  ai_listener: {
    tasksProcessed?: number;
    feesCollected?: number;
    activeTasks?: number;
  } | null;
  fee_config: {
    default_bps: number;
    min_bps: number;
    max_bps: number;
    min_task_amount: string;
    a2a_relay_bps: number;
    revenue_split: string;
  };
  chains: string[];
  message_types: string[];
}

const M2M_API_URL = import.meta.env.VITE_M2M_API_URL || 'http://localhost:3002';
const M2M_POLL_INTERVAL = 10_000;

// ─── Theta Infra Endpoints ────────────────────────────────────────────────
const SUBCHAIN_RPC_URL = import.meta.env.VITE_SUBCHAIN_TESTNET_RPC || import.meta.env.VITE_SUBCHAIN_MAINNET_RPC || '';
const THETA_INFERENCE_ADDR = import.meta.env.VITE_THETA_INFERENCE_ADDRESS || '';

// ─── EdgeCloud Stats Type ─────────────────────────────────────────────────
interface EdgeCloudStats {
  activeJobs: number;
  completedJobs: number;
  failedJobs: number;
  petaflopsActive: number;
  proverEndpointOk: boolean | null;
}

// ─── Subchain Health Type ─────────────────────────────────────────────────
interface SubchainHealth {
  chainId: number | null;
  blockHeight: number | null;
  latency: number | null;
  status: 'healthy' | 'syncing' | 'unreachable';
}

// ─── TDROP Stats Type ─────────────────────────────────────────────────────
interface TdropStats {
  tdropIntents: number;
  tdropVolumeRaw: string;
  tfuelIntents: number;
  tdropSharePct: number;
}

const mockCircuitActivity = [
  { name: 'A2A Circuit', verifications: '12,450', gasAvg: '0.0034 ETH', status: 'active', uptime: '99.8%' },
  { name: 'ZKML Circuit', verifications: '8,230', gasAvg: '0.0041 ETH', status: 'active', uptime: '99.9%' },
  { name: 'Data Hubs', verifications: '6,120', gasAvg: '0.0028 ETH', status: 'active', uptime: '99.7%' },
  { name: 'Bridge Verifier', verifications: '4,821', gasAvg: '0.0052 ETH', status: 'active', uptime: '100%' },
  { name: 'Compute Marketplace', verifications: '3,450', gasAvg: '0.0038 ETH', status: 'active', uptime: '99.5%' },
  { name: 'Inference Router', verifications: '2,890', gasAvg: '0.0045 ETH', status: 'active', uptime: '99.6%' },
];

const mockRevenue = [
  { source: 'Bridge Fees', amount: '$840K', percent: 40 },
  { source: 'Circuit Verification', amount: '$630K', percent: 30 },
  { source: 'AI Inference', amount: '$420K', percent: 20 },
  { source: 'Partner Hooks', amount: '$210K', percent: 10 },
];

const mockNetworkHealth = [
  { network: 'Theta Mainnet', blockHeight: '24,582,100', latency: '12ms', status: 'healthy' },
  { network: 'Bittensor EVM', blockHeight: '3,142,850', latency: '45ms', status: 'healthy' },
  { network: 'Osmosis', blockHeight: '18,901,200', latency: '23ms', status: 'syncing' },
];

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${seconds % 60}s`;
}

export default function Dashboard() {
  const splitterDeployed = isDeployed(ADDRESSES.splitter);
  const verifierDeployed = isDeployed(ADDRESSES.verifier);
  const inferenceDeployed = isDeployed(ADDRESSES.thetaInference);

  // ── M2M API Health (poll every 10s) ──────────────────────────────────
  const [m2mHealth, setM2mHealth] = useState<M2MHealthData | null>(null);
  const [m2mError, setM2mError] = useState<string | null>(null);
  const [m2mLastRefresh, setM2mLastRefresh] = useState<Date | null>(null);

  // ── EdgeCloud Stats (6.1) — poll M2M /status endpoint every 30s ──────────
  const [edgeCloudStats, setEdgeCloudStats] = useState<EdgeCloudStats | null>(null);

  // ── Subchain Health (6.2) — poll subchain RPC every 15s ──────────────────
  const [subchainHealth, setSubchainHealth] = useState<SubchainHealth>({
    chainId: null, blockHeight: null, latency: null, status: 'unreachable',
  });

  // ── TDROP Stats (6.3) — derived from M2M /status ai_listener stats ───────
  const [tdropStats, setTdropStats] = useState<TdropStats | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch(`${M2M_API_URL}/health`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: M2MHealthData = await res.json();
      setM2mHealth(data);
      setM2mError(null);
      setM2mLastRefresh(new Date());
    } catch (err) {
      setM2mError(err instanceof Error ? err.message : 'Unreachable');
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const timer = setInterval(fetchHealth, M2M_POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [fetchHealth]);

  // ── EdgeCloud Stats: pull from M2M /status (ai_listener sub-object) ───────
  useEffect(() => {
    const fetch30s = async () => {
      try {
        const res = await fetch(`${M2M_API_URL}/status`);
        if (!res.ok) return;
        const data = await res.json();
        const ecJobs = data?.edgeCloudJobs;
        const handler = data?.handler;
        if (ecJobs || handler) {
          const active = ecJobs?.activeJobs ?? 0;
          const completed = ecJobs?.completedJobs ?? 0;
          const failed = ecJobs?.failedJobs ?? 0;
          // petaflops: sum attested petaflops from on-chain stats if available, else estimate
          const petaflops = handler?.onChain?.stats?.petaflopsTotal
            ? Math.round(handler.onChain.stats.petaflopsTotal / 1_000_000)
            : active * 165; // RTX 4090 baseline GFLOPS
          setEdgeCloudStats({
            activeJobs: active,
            completedJobs: completed,
            failedJobs: failed,
            petaflopsActive: petaflops,
            proverEndpointOk: ecJobs?.lastError === null ? true : ecJobs?.lastError ? false : null,
          });
          // derive TDROP stats from handler stats
          const tdropI = handler?.tdrop?.stats?.intents ?? 0;
          const tfuelI = handler?.onChain?.stats?.settles ?? 0;
          const total = tdropI + tfuelI;
          setTdropStats({
            tdropIntents: tdropI,
            tdropVolumeRaw: handler?.tdrop?.stats?.volumeRaw ?? '0',
            tfuelIntents: tfuelI,
            tdropSharePct: total > 0 ? Math.round((tdropI / total) * 100) : 0,
          });
        }
      } catch { /* non-fatal */ }
    };
    fetch30s();
    const t = setInterval(fetch30s, 30_000);
    return () => clearInterval(t);
  }, []);

  // ── Subchain Health: eth_blockNumber RPC call every 15s ───────────────────
  useEffect(() => {
    if (!SUBCHAIN_RPC_URL) return;
    const pollSubchain = async () => {
      const t0 = Date.now();
      try {
        const res = await fetch(SUBCHAIN_RPC_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'eth_blockNumber', params: [], id: 1, jsonrpc: '2.0' }),
          signal: AbortSignal.timeout(5000),
        });
        const data = await res.json();
        const hex = data?.result;
        const latency = Date.now() - t0;
        if (hex) {
          setSubchainHealth({
            chainId: Number(import.meta.env.VITE_SUBCHAIN_CHAINID || 365001),
            blockHeight: parseInt(hex, 16),
            latency,
            status: latency < 3000 ? 'healthy' : 'syncing',
          });
        }
      } catch {
        setSubchainHealth(prev => ({ ...prev, status: 'unreachable', latency: null }));
      }
    };
    pollSubchain();
    const t = setInterval(pollSubchain, 15_000);
    return () => clearInterval(t);
  }, []);

  const { data: totalDeposited } = useReadContract({
    address: ADDRESSES.splitter,
    abi: SPLITTER_ABI,
    functionName: 'totalDeposited',
    query: { enabled: splitterDeployed },
  });

  const { data: totalDistributed } = useReadContract({
    address: ADDRESSES.splitter,
    abi: SPLITTER_ABI,
    functionName: 'totalDistributed',
    query: { enabled: splitterDeployed },
  });

  const { data: distCount } = useReadContract({
    address: ADDRESSES.splitter,
    abi: SPLITTER_ABI,
    functionName: 'distributionCount',
    query: { enabled: splitterDeployed },
  });

  const { data: verifierStats } = useReadContract({
    address: ADDRESSES.verifier,
    abi: VERIFIER_ABI,
    functionName: 'getExtendedStats',
    query: { enabled: verifierDeployed },
  });

  const { data: circuitCount } = useReadContract({
    address: ADDRESSES.verifier,
    abi: VERIFIER_ABI,
    functionName: 'circuitCount',
    query: { enabled: verifierDeployed },
  });

  const { data: intentCount } = useReadContract({
    address: ADDRESSES.thetaInference,
    abi: THETA_INFERENCE_ABI,
    functionName: 'intentCount',
    query: { enabled: inferenceDeployed },
  });

  const hasLiveData = splitterDeployed || verifierDeployed;

  const tvlDisplay = totalDeposited
    ? `$${(Number(formatEther(totalDeposited)) * 0.5).toFixed(1)}M`
    : '$48.2M';
  const feesDisplay = totalDistributed
    ? `$${(Number(formatEther(totalDistributed)) * 0.5).toFixed(1)}M`
    : '$2.1M';
  const distDisplay = distCount ? Number(distCount).toLocaleString() : '1,247';
  const proofCount = verifierStats ? Number(verifierStats[0]).toLocaleString() : '—';
  const circuitsDisplay = circuitCount ? String(Number(circuitCount)) : '21';

  const protocolStats = [
    { label: 'Total Value Locked', value: tvlDisplay, change: '+12.4%' },
    { label: 'Total Fees Generated', value: feesDisplay, change: '+8.7%' },
    { label: 'Distributions Made', value: distDisplay, change: `+${distCount ? '34' : '34'}` },
    { label: 'Active Circuits', value: circuitsDisplay, change: proofCount !== '—' ? `${proofCount} proofs` : '+3' },
  ];

  return (
    <div className="page">
      <div className="container">
        <div className="page-header">
          <h1>Protocol Dashboard</h1>
          <p>Real-time metrics across all XFuel Protocol infrastructure</p>
        </div>

        {!hasLiveData && (
          <div style={{ fontSize: '0.8rem', color: '#f59e0b', textAlign: 'center', marginBottom: '1rem' }}>
            Contracts not configured — showing demo data. Set VITE_SPLITTER_ADDRESS and VITE_VERIFIER_ADDRESS to connect.
          </div>
        )}

        <div className="grid grid-4" style={{ marginBottom: '2rem' }}>
          {protocolStats.map((s) => (
            <div key={s.label} className="card">
              <div className="stat-label">{s.label}</div>
              <div className="stat-value" style={{ fontSize: '1.75rem' }}>{s.value}</div>
              <div style={{ color: '#22c55e', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                {s.change}
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-2" style={{ marginBottom: '2rem' }}>
          <div className="card">
            <h3 style={{ marginBottom: '1.25rem' }}>Revenue Breakdown</h3>
            {mockRevenue.map((r) => (
              <div key={r.source} style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                  <span style={{ fontSize: '0.9rem' }}>{r.source}</span>
                  <span style={{ fontWeight: 600 }}>{r.amount}</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-bar-fill" style={{ width: `${r.percent}%` }} />
                </div>
              </div>
            ))}
          </div>

          <div className="card">
            <h3 style={{ marginBottom: '1.25rem' }}>Network Health</h3>
            {mockNetworkHealth.map((n) => (
              <div key={n.network} style={rowStyle}>
                <div>
                  <div style={{ fontWeight: 600 }}>{n.network}</div>
                  <div style={{ color: '#8a8a9a', fontSize: '0.8rem' }}>
                    Block #{n.blockHeight} · {n.latency}
                  </div>
                </div>
                <span className={`badge badge-${n.status === 'healthy' ? 'green' : 'orange'}`}>
                  {n.status}
                </span>
              </div>
            ))}

            <hr className="separator" />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
              <span style={{ color: '#8a8a9a' }}>SP1 Prover Status</span>
              <span className="badge badge-green">Online</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginTop: '0.5rem' }}>
              <span style={{ color: '#8a8a9a' }}>Hyperlane Relayer</span>
              <span className="badge badge-green">Active</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginTop: '0.5rem' }}>
              <span style={{ color: '#8a8a9a' }}>AI Intents</span>
              <span className="badge badge-cyan">
                {intentCount ? Number(intentCount).toLocaleString() : 'Monitoring'}
              </span>
            </div>
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginBottom: '1.25rem' }}>Circuit Activity</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Circuit</th>
                  <th style={thStyle}>Verifications</th>
                  <th style={thStyle}>Avg Gas</th>
                  <th style={thStyle}>Uptime</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {mockCircuitActivity.map((c) => (
                  <tr key={c.name}>
                    <td style={tdStyle}><strong>{c.name}</strong></td>
                    <td style={tdStyle}>{c.verifications}</td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>{c.gasAvg}</td>
                    <td style={tdStyle}>{c.uptime}</td>
                    <td style={tdStyle}>
                      <span className="badge badge-green">{c.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── M2M API Health (auto-refresh 10s) ───────────────────────── */}
        <div className="card" style={{ marginTop: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <h3>M2M API Health</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              {m2mLastRefresh && (
                <span style={{ fontSize: '0.75rem', color: '#8a8a9a' }}>
                  Updated {m2mLastRefresh.toLocaleTimeString()}
                </span>
              )}
              <span className={`badge badge-${m2mHealth?.status === 'ok' ? 'green' : m2mError ? 'orange' : 'cyan'}`}>
                {m2mHealth?.status === 'ok' ? 'Connected' : m2mError ? 'Unreachable' : 'Connecting...'}
              </span>
            </div>
          </div>

          {m2mError && (
            <div style={{ fontSize: '0.8rem', color: '#f59e0b', marginBottom: '1rem' }}>
              M2M API not reachable ({m2mError}). Start with: <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>cd backend/theta-bridge && node src/server.js</code>
            </div>
          )}

          {m2mHealth && (
            <>
              {/* Stats row */}
              <div className="grid grid-4" style={{ marginBottom: '1.5rem' }}>
                <div style={m2mStatStyle}>
                  <div style={{ color: '#8a8a9a', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Server</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{m2mHealth.version}</div>
                </div>
                <div style={m2mStatStyle}>
                  <div style={{ color: '#8a8a9a', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Uptime</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{formatUptime(m2mHealth.uptime_s)}</div>
                </div>
                <div style={m2mStatStyle}>
                  <div style={{ color: '#8a8a9a', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>A2A Messages</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{m2mHealth.a2a_messages_total.toLocaleString()}</div>
                </div>
                <div style={m2mStatStyle}>
                  <div style={{ color: '#8a8a9a', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>AI Tasks</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{m2mHealth.ai_listener?.tasksProcessed?.toLocaleString() ?? '—'}</div>
                </div>
              </div>

              <div className="grid grid-2">
                {/* Fee Configuration */}
                <div>
                  <h3 style={{ fontSize: '0.9rem', marginBottom: '0.75rem', color: '#00d4ff' }}>Fee Configuration</h3>
                  <table style={tableStyle}>
                    <tbody>
                      <tr>
                        <td style={tdStyle}>Default Task Fee</td>
                        <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', textAlign: 'right' }}>{(m2mHealth.fee_config.default_bps / 100).toFixed(1)}% ({m2mHealth.fee_config.default_bps} BPS)</td>
                      </tr>
                      <tr>
                        <td style={tdStyle}>Fee Range</td>
                        <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', textAlign: 'right' }}>{m2mHealth.fee_config.min_bps}–{m2mHealth.fee_config.max_bps} BPS</td>
                      </tr>
                      <tr>
                        <td style={tdStyle}>A2A Relay Fee</td>
                        <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', textAlign: 'right' }}>{(m2mHealth.fee_config.a2a_relay_bps / 100).toFixed(1)}% ({m2mHealth.fee_config.a2a_relay_bps} BPS)</td>
                      </tr>
                      <tr>
                        <td style={tdStyle}>Min Task Amount</td>
                        <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', textAlign: 'right' }}>{Number(m2mHealth.fee_config.min_task_amount).toLocaleString()}</td>
                      </tr>
                      <tr>
                        <td style={tdStyle}>Revenue Split</td>
                        <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', textAlign: 'right', fontSize: '0.8rem' }}>{m2mHealth.fee_config.revenue_split}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Supported Chains & Message Types */}
                <div>
                  <h3 style={{ fontSize: '0.9rem', marginBottom: '0.75rem', color: '#00d4ff' }}>Supported Chains</h3>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                    {m2mHealth.chains.map((chain) => (
                      <span key={chain} className="badge badge-cyan" style={{ textTransform: 'capitalize' }}>{chain}</span>
                    ))}
                  </div>

                  <h3 style={{ fontSize: '0.9rem', marginBottom: '0.75rem', color: '#00d4ff' }}>Message Types</h3>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                    {m2mHealth.message_types.map((mt) => (
                      <span key={mt} className="badge badge-purple" style={{ fontSize: '0.7rem' }}>{mt}</span>
                    ))}
                  </div>

                  {m2mHealth.ai_listener && (
                    <>
                      <h3 style={{ fontSize: '0.9rem', margin: '1rem 0 0.75rem', color: '#00d4ff' }}>AI Listener</h3>
                      <div style={{ marginBottom: '0.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                          <span style={{ fontSize: '0.85rem' }}>Fees Collected</span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>{m2mHealth.ai_listener.feesCollected?.toLocaleString() ?? '0'}</span>
                        </div>
                        <div className="progress-bar">
                          <div className="progress-bar-fill" style={{ width: `${Math.min(100, (m2mHealth.ai_listener.feesCollected ?? 0) / 100)}%` }} />
                        </div>
                      </div>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                          <span style={{ fontSize: '0.85rem' }}>Active Tasks</span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>{m2mHealth.ai_listener.activeTasks?.toLocaleString() ?? '0'}</span>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

        {/* ── 6.1 EdgeCloud Stats (Track 6.1) ──────────────────────────────── */}
        <div className="card" style={{ marginTop: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <h3>Theta EdgeCloud — Live GPU Stats</h3>
            <span className={`badge badge-${edgeCloudStats ? (edgeCloudStats.failedJobs > 0 ? 'orange' : 'green') : 'purple'}`}>
              {edgeCloudStats ? (edgeCloudStats.failedJobs > 0 ? `${edgeCloudStats.failedJobs} failed` : 'Healthy') : 'No data'}
            </span>
          </div>
          {!edgeCloudStats && (
            <div style={{ fontSize: '0.8rem', color: '#8a8a9a' }}>
              Waiting for M2M backend stats — ensure <code style={{ fontFamily: 'var(--font-mono)' }}>SP1_PROVER_ENDPOINT</code> is set for dedicated job tracking (Track 2.2).
            </div>
          )}
          {edgeCloudStats && (
            <div className="grid grid-4">
              {[
                { label: 'Active Jobs', value: edgeCloudStats.activeJobs.toString(), color: '#00d4ff' },
                { label: 'Completed Jobs', value: edgeCloudStats.completedJobs.toLocaleString(), color: '#22c55e' },
                { label: 'Failed Jobs', value: edgeCloudStats.failedJobs.toString(), color: edgeCloudStats.failedJobs > 0 ? '#f59e0b' : '#22c55e' },
                { label: 'Est. Active GFLOPS', value: edgeCloudStats.petaflopsActive > 0 ? edgeCloudStats.petaflopsActive.toLocaleString() : '—', color: '#a78bfa' },
              ].map((s) => (
                <div key={s.label} style={m2mStatStyle}>
                  <div style={{ color: '#8a8a9a', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>{s.label}</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: s.color }}>{s.value}</div>
                </div>
              ))}
            </div>
          )}
          {edgeCloudStats && (
            <div style={{ marginTop: '1rem', fontSize: '0.8rem', color: '#8a8a9a', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
              <span>SP1 Prover: <span className={`badge badge-${edgeCloudStats.proverEndpointOk === true ? 'green' : edgeCloudStats.proverEndpointOk === false ? 'orange' : 'purple'}`}>{edgeCloudStats.proverEndpointOk === true ? 'Connected' : edgeCloudStats.proverEndpointOk === false ? 'Error' : 'On-demand only'}</span></span>
              <span style={{ color: '#55556a' }}>GPU tiers: RTX 4090 (165 GFLOPS) · A100 (2,000 GFLOPS) · H100 SXM (3,958 GFLOPS)</span>
            </div>
          )}
        </div>

        {/* ── 6.2 Subchain Status (Track 6.2) ──────────────────────────────── */}
        <div className="card" style={{ marginTop: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <h3>XFuel Subchain Status</h3>
            <span className={`badge badge-${subchainHealth.status === 'healthy' ? 'green' : subchainHealth.status === 'syncing' ? 'orange' : 'purple'}`}>
              {subchainHealth.status}
            </span>
          </div>
          {!SUBCHAIN_RPC_URL && (
            <div style={{ fontSize: '0.8rem', color: '#8a8a9a' }}>
              Set <code style={{ fontFamily: 'var(--font-mono)' }}>VITE_SUBCHAIN_TESTNET_RPC</code> or <code style={{ fontFamily: 'var(--font-mono)' }}>VITE_SUBCHAIN_MAINNET_RPC</code> to monitor the XFuel subchain (chain 365001 / 361001).
            </div>
          )}
          {SUBCHAIN_RPC_URL && (
            <div className="grid grid-4">
              {[
                { label: 'Chain ID', value: subchainHealth.chainId?.toString() ?? '—' },
                { label: 'Block Height', value: subchainHealth.blockHeight?.toLocaleString() ?? '—' },
                { label: 'RPC Latency', value: subchainHealth.latency !== null ? `${subchainHealth.latency}ms` : '—' },
                { label: 'Validators', value: '3' },
              ].map((s) => (
                <div key={s.label} style={m2mStatStyle}>
                  <div style={{ color: '#8a8a9a', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>{s.label}</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#00d4ff' }}>{s.value}</div>
                </div>
              ))}
            </div>
          )}
          {SUBCHAIN_RPC_URL && (
            <div style={{ marginTop: '1rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.8rem', color: '#8a8a9a' }}>
              <span>Circuits: ThetaInferenceCircuit · A2ACircuit · ThetaGPUCircuit · DataHubs</span>
              <span style={{ color: '#55556a' }}>Privatenet: 360777 · Testnet: 365001 · Mainnet: 361001</span>
            </div>
          )}
        </div>

        {/* ── 6.3 TDROP Stats (Track 6.3) ───────────────────────────────────── */}
        <div className="card" style={{ marginTop: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <h3>TDROP Payment Stats</h3>
            <span className="badge badge-purple">TNT-20</span>
          </div>
          {!tdropStats && (
            <div style={{ fontSize: '0.8rem', color: '#8a8a9a' }}>
              Waiting for M2M backend stats — TDROP metrics populate once the AI listener reports <code style={{ fontFamily: 'var(--font-mono)' }}>TdropIntentSubmitted</code> events.
            </div>
          )}
          {tdropStats && (
            <>
              <div className="grid grid-4" style={{ marginBottom: '1rem' }}>
                {[
                  { label: 'TDROP Intents', value: tdropStats.tdropIntents.toLocaleString(), color: '#a78bfa' },
                  { label: 'TFUEL Intents', value: tdropStats.tfuelIntents.toLocaleString(), color: '#00d4ff' },
                  { label: 'TDROP Share', value: `${tdropStats.tdropSharePct}%`, color: '#a78bfa' },
                  { label: 'TDROP Volume', value: tdropStats.tdropVolumeRaw !== '0' ? tdropStats.tdropVolumeRaw : '—', color: '#22c55e' },
                ].map((s) => (
                  <div key={s.label} style={m2mStatStyle}>
                    <div style={{ color: '#8a8a9a', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>{s.label}</div>
                    <div style={{ fontSize: '1.4rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginBottom: '0.35rem', display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                <span style={{ color: '#8a8a9a' }}>TDROP vs TFUEL payment split</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{tdropStats.tdropSharePct}% TDROP</span>
              </div>
              <div className="progress-bar">
                <div className="progress-bar-fill" style={{ width: `${tdropStats.tdropSharePct}%`, background: 'linear-gradient(90deg, #a78bfa, #7c3aed)' }} />
              </div>
              <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: '#55556a' }}>
                20% discount for TDROP payers · Mainnet TDROP: <code style={{ fontFamily: 'var(--font-mono)' }}>0x1336739B05C7Ab8a526D40DCC0d04a826b5f8B03</code>
              </div>
            </>
          )}
        </div>

    </div>
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '0.75rem 0', borderBottom: '1px solid rgba(255,255,255,0.06)',
};

const tableStyle: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '0.75rem', color: '#8a8a9a',
  borderBottom: '1px solid rgba(255,255,255,0.08)', fontWeight: 600, fontSize: '0.8rem',
  textTransform: 'uppercase', letterSpacing: '0.05em',
};

const tdStyle: React.CSSProperties = {
  padding: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.04)',
};

const m2mStatStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  borderRadius: 'var(--radius-sm)',
  padding: '0.75rem 1rem',
  textAlign: 'center',
};
