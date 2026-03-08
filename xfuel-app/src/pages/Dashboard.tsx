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
