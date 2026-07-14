import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';

// ─── Types ───────────────────────────────────────────────────────────────────

type IntentEntry = {
  intentId: string;
  serviceType: number;
  gpuTier: string;
  status: string;
  latencyMs: number | null;
  source: string | null;
  createdAt: number;
  model: string;
  txHash?: string;
};

type RpcHealth = {
  chain: string;
  name: string;
  connected: boolean;
  lastBlock: number;
  errorCount: number;
  lastError: string | null;
};

type WebhookStats = {
  delivered: number;
  failed: number;
  pending: number;
  deliveryRate: string;
};

type FailurePrediction = {
  level: 'low' | 'medium' | 'high';
  message: string;
  factors: string[];
};

type StatsPayload = {
  intents: IntentEntry[];
  rpcHealth: RpcHealth[];
  webhooks: WebhookStats;
  failurePrediction: FailurePrediction;
  summary: {
    totalIntents: number;
    completedIntents: number;
    failedIntents: number;
    avgLatencyMs: number;
    uptime: number;
    apiMode: string;
  };
};

const SERVICE_TYPE_LABELS: Record<number, string> = {
  0: 'LLM Inference',
  1: 'Image Gen',
  2: 'Speech-to-Text',
  3: 'Voice Clone',
  4: 'RAG Query',
  5: 'Video Processing',
  6: 'Object Detection',
};

const STATUS_COLORS: Record<string, string> = {
  completed: '#22c55e',
  completed_onchain: '#22c55e',
  settled: '#00d4ff',
  proof_ready: '#8b5cf6',
  processing: '#f59e0b',
  failed: '#ef4444',
};

const STATS_ENDPOINT = (import.meta.env.VITE_API_URL || 'http://localhost:3002') + '/theta-ai/stats';

// ─── Mock data for demo / when backend is offline ────────────────────────────

function generateMockStats(): StatsPayload {
  const now = Date.now();
  const mockIntents: IntentEntry[] = [
    { intentId: 'preset-QUICK_LLAMA-' + (now - 45000), serviceType: 0, gpuTier: 'RTX-4090', status: 'settled', latencyMs: 823, source: 'edgecloud', createdAt: now - 45000, model: 'llama-3.1-8b', txHash: '0x4a3f...d1e2' },
    { intentId: 'preset-HD_IMAGE_PRO-' + (now - 32000), serviceType: 1, gpuTier: 'H100', status: 'completed', latencyMs: 3240, source: 'edgecloud', createdAt: now - 32000, model: 'flux-dev' },
    { intentId: 'preset-ENTERPRISE_RAG-' + (now - 21000), serviceType: 4, gpuTier: 'A100', status: 'processing', latencyMs: null, source: null, createdAt: now - 21000, model: 'llama-3.1-70b' },
    { intentId: 'preset-MEDICAL_STT-' + (now - 15000), serviceType: 2, gpuTier: 'A100', status: 'completed', latencyMs: 1580, source: 'rapidapi', createdAt: now - 15000, model: 'whisper-large-v3' },
    { intentId: 'preset-OBJECT_DETECTOR-' + (now - 8000), serviceType: 6, gpuTier: 'RTX-4090', status: 'proof_ready', latencyMs: 420, source: 'mock', createdAt: now - 8000, model: 'yolov8' },
  ];

  const rpcHealth: RpcHealth[] = [
    { chain: 'theta_mainnet', name: 'Theta Mainnet (361)', connected: false, lastBlock: 0, errorCount: 0, lastError: 'demo' },
    { chain: 'theta_testnet', name: 'Theta Testnet (365)', connected: true, lastBlock: 0, errorCount: 0, lastError: null },
    { chain: 'bittensor', name: 'Bittensor EVM (964)', connected: false, lastBlock: 0, errorCount: 0, lastError: 'demo' },
    { chain: 'solana_devnet', name: 'Solana Devnet', connected: false, lastBlock: 0, errorCount: 0, lastError: 'demo' },
  ];

  return {
    intents: mockIntents,
    rpcHealth,
    webhooks: { delivered: 42, failed: 3, pending: 1, deliveryRate: '93.3%' },
    failurePrediction: { level: 'low', message: 'All systems nominal', factors: [] },
    summary: {
      totalIntents: 847,
      completedIntents: 812,
      failedIntents: 9,
      avgLatencyMs: 1840,
      uptime: 86400,
      apiMode: 'MOCK',
    },
  };
}

// ─── Main Page Component ────────────────────────────────────────────────────

export default function Monitoring() {
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [sortField, setSortField] = useState<'createdAt' | 'latencyMs' | 'status'>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(STATS_ENDPOINT, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        setStats(data);
        setIsLive(true);
      } else {
        setStats(generateMockStats());
        setIsLive(false);
      }
    } catch {
      setStats(generateMockStats());
      setIsLive(false);
    }
    setLastRefresh(new Date());
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(fetchStats, 10000);
    return () => clearInterval(timer);
  }, [autoRefresh, fetchStats]);

  const sortedIntents = useMemo(() => {
    if (!stats?.intents) return [];
    return [...stats.intents].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'createdAt') cmp = a.createdAt - b.createdAt;
      else if (sortField === 'latencyMs') cmp = (a.latencyMs ?? 99999) - (b.latencyMs ?? 99999);
      else if (sortField === 'status') cmp = a.status.localeCompare(b.status);
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }, [stats?.intents, sortField, sortDir]);

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const prediction = stats?.failurePrediction;
  const predictionColor = prediction?.level === 'high' ? '#ef4444'
    : prediction?.level === 'medium' ? '#f59e0b' : '#22c55e';

  if (!stats) {
    return (
      <div className="page">
        <div className="container" style={{ textAlign: 'center', padding: '4rem 0' }}>
          <div className="animate-pulse" style={{ color: '#8a8a9a', fontSize: '1.1rem' }}>
            Loading monitoring data...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="container">
        {/* Hero */}
        <div style={styles.hero}>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <span className="badge badge-cyan" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: isLive ? '#22c55e' : '#f59e0b', display: 'inline-block', animation: 'pulse 2s ease-in-out infinite' }} />
              {isLive ? 'Live' : 'Demo Mode'}
            </span>
            <span className="badge badge-green">Real-Time Dashboard</span>
            <span className="badge badge-purple">Failure Prediction</span>
          </div>
          <h1 style={styles.heroTitle}>Monitoring Dashboard</h1>
          <p style={styles.heroSubtitle}>
            Real-time visibility into intents, proofs, settlements, RPC health, and webhook delivery.
            Auto-refreshes every 10 seconds.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem', marginTop: '1rem' }}>
            <button className={`btn btn-sm ${autoRefresh ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setAutoRefresh(!autoRefresh)}
              style={{ fontSize: '0.75rem' }}
            >
              {autoRefresh ? 'Auto-Refresh ON' : 'Auto-Refresh OFF'}
            </button>
            <button className="btn btn-sm btn-secondary"
              onClick={fetchStats}
              style={{ fontSize: '0.75rem' }}
            >
              Refresh Now
            </button>
            <Link to="/theta-ai" className="btn btn-sm btn-secondary" style={{ fontSize: '0.75rem', textDecoration: 'none' }}>
              Back to Theta AI
            </Link>
          </div>
          <div style={{ textAlign: 'center', marginTop: '0.5rem', fontSize: '0.7rem', color: '#55556a' }}>
            Last refresh: {lastRefresh.toLocaleTimeString()}
          </div>
        </div>

        {/* Failure Prediction Banner */}
        {prediction && prediction.level !== 'low' && (
          <div style={{
            padding: '1rem 1.25rem', marginBottom: '1.5rem',
            background: `${predictionColor}11`, borderRadius: '12px',
            border: `1px solid ${predictionColor}33`,
            display: 'flex', alignItems: 'center', gap: '0.75rem',
          }}>
            <span style={{ fontSize: '1.5rem' }}>{prediction.level === 'high' ? '!!!' : '!!'}</span>
            <div>
              <div style={{ fontWeight: 700, color: predictionColor, fontSize: '0.9rem' }}>
                {prediction.level === 'high' ? 'High Risk' : 'Medium Risk'}: {prediction.message}
              </div>
              {prediction.factors.length > 0 && (
                <div style={{ fontSize: '0.8rem', color: '#8a8a9a', marginTop: '0.25rem' }}>
                  Factors: {prediction.factors.join(' | ')}
                </div>
              )}
            </div>
          </div>
        )}

        {prediction && prediction.level === 'low' && (
          <div style={{
            padding: '0.75rem 1.25rem', marginBottom: '1.5rem',
            background: 'rgba(34,197,94,0.06)', borderRadius: '12px',
            border: '1px solid rgba(34,197,94,0.15)',
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            fontSize: '0.85rem', color: '#22c55e',
          }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
            {prediction.message}
          </div>
        )}

        {/* Summary Stats Row */}
        <div className="grid grid-4" style={{ marginBottom: '2rem' }}>
          {[
            { value: stats.summary.totalIntents.toLocaleString(), label: 'Total Intents' },
            { value: stats.summary.completedIntents.toLocaleString(), label: 'Completed' },
            { value: `${(stats.summary.avgLatencyMs / 1000).toFixed(1)}s`, label: 'Avg Latency' },
            { value: `${Math.round(stats.summary.uptime / 3600)}h`, label: 'Uptime' },
          ].map((s) => (
            <div key={s.label} className="card" style={{ textAlign: 'center' }}>
              <div className="stat-value" style={{ fontSize: '1.5rem' }}>{s.value}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          ))}
        </div>

        {/* RPC Health Cards */}
        <h2 style={{ fontSize: '1.3rem', marginBottom: '1rem' }}>RPC Health</h2>
        <div className="grid grid-4" style={{ marginBottom: '2rem' }}>
          {stats.rpcHealth.map((rpc) => (
            <div key={rpc.chain} className="card" style={{ padding: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{rpc.name}</span>
                <span style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: rpc.connected ? '#22c55e' : '#ef4444',
                  display: 'inline-block',
                  boxShadow: rpc.connected ? '0 0 8px rgba(34,197,94,0.4)' : '0 0 8px rgba(239,68,68,0.4)',
                }} />
              </div>
              <div style={{ fontSize: '0.8rem', color: '#8a8a9a' }}>
                Block: <span style={{ fontFamily: 'var(--font-mono)', color: '#f0f0f5' }}>
                  {rpc.lastBlock > 0 ? rpc.lastBlock.toLocaleString() : 'N/A'}
                </span>
              </div>
              {rpc.errorCount > 0 && (
                <div style={{ fontSize: '0.75rem', color: '#ef4444', marginTop: '0.25rem' }}>
                  {rpc.errorCount} error{rpc.errorCount > 1 ? 's' : ''}
                  {rpc.lastError && <span style={{ color: '#8a8a9a' }}> — {rpc.lastError}</span>}
                </div>
              )}
              {rpc.errorCount === 0 && rpc.connected && (
                <div style={{ fontSize: '0.75rem', color: '#22c55e', marginTop: '0.25rem' }}>
                  Healthy
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Webhook Delivery Stats + API Mode */}
        <div className="grid grid-2" style={{ marginBottom: '2rem' }}>
          <div className="card" style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>Webhook Delivery</h3>
            <div style={{ display: 'flex', gap: '2rem' }}>
              <div>
                <div style={{ fontSize: '2rem', fontWeight: 800, color: '#22c55e' }}>
                  {stats.webhooks.delivered}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#8a8a9a' }}>Delivered</div>
              </div>
              <div>
                <div style={{ fontSize: '2rem', fontWeight: 800, color: '#ef4444' }}>
                  {stats.webhooks.failed}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#8a8a9a' }}>Failed</div>
              </div>
              <div>
                <div style={{ fontSize: '2rem', fontWeight: 800, color: '#f59e0b' }}>
                  {stats.webhooks.pending}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#8a8a9a' }}>Pending</div>
              </div>
              <div>
                <div style={{ fontSize: '2rem', fontWeight: 800, color: '#00d4ff' }}>
                  {stats.webhooks.deliveryRate}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#8a8a9a' }}>Success Rate</div>
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>API Backend</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <span className={`badge ${stats.summary.apiMode === 'LIVE' ? 'badge-green' : stats.summary.apiMode === 'RAPIDAPI' ? 'badge-purple' : 'badge-orange'}`}>
                {stats.summary.apiMode}
              </span>
              <span style={{ fontSize: '0.85rem', color: '#8a8a9a' }}>
                {stats.summary.apiMode === 'LIVE' ? 'Theta EdgeCloud connected'
                  : stats.summary.apiMode === 'RAPIDAPI' ? 'RapidAPI fallback active'
                  : 'Mock mode — set API keys for live data'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.85rem' }}>
              <div>
                <span style={{ color: '#55556a' }}>Failed: </span>
                <span style={{ color: stats.summary.failedIntents > 0 ? '#ef4444' : '#22c55e', fontWeight: 700 }}>
                  {stats.summary.failedIntents}
                </span>
              </div>
              <div>
                <span style={{ color: '#55556a' }}>Success Rate: </span>
                <span style={{ color: '#22c55e', fontWeight: 700 }}>
                  {stats.summary.totalIntents > 0
                    ? ((stats.summary.completedIntents / stats.summary.totalIntents) * 100).toFixed(1)
                    : '0'}%
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Recent Intents Table */}
        <h2 style={{ fontSize: '1.3rem', marginBottom: '1rem' }}>Recent Intents</h2>
        <div className="card" style={{ padding: '0', overflow: 'auto', marginBottom: '2rem' }}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Type</th>
                <th style={styles.th}>GPU</th>
                <th style={styles.th}>Model</th>
                <th style={{ ...styles.th, cursor: 'pointer' }} onClick={() => toggleSort('status')}>
                  Status {sortField === 'status' ? (sortDir === 'asc' ? '^' : 'v') : ''}
                </th>
                <th style={{ ...styles.th, cursor: 'pointer' }} onClick={() => toggleSort('latencyMs')}>
                  Latency {sortField === 'latencyMs' ? (sortDir === 'asc' ? '^' : 'v') : ''}
                </th>
                <th style={styles.th}>Source</th>
                <th style={{ ...styles.th, cursor: 'pointer' }} onClick={() => toggleSort('createdAt')}>
                  Time {sortField === 'createdAt' ? (sortDir === 'asc' ? '^' : 'v') : ''}
                </th>
                <th style={styles.th}>TX</th>
              </tr>
            </thead>
            <tbody>
              {sortedIntents.map((intent) => (
                <tr key={intent.intentId} style={styles.tr}>
                  <td style={styles.td}>
                    <span style={{ color: '#00d4ff' }}>
                      {SERVICE_TYPE_LABELS[intent.serviceType] || `Type ${intent.serviceType}`}
                    </span>
                  </td>
                  <td style={styles.td}>
                    <span className="tag" style={{ fontSize: '0.7rem' }}>{intent.gpuTier}</span>
                  </td>
                  <td style={{ ...styles.td, fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                    {intent.model}
                  </td>
                  <td style={styles.td}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                      padding: '0.15rem 0.5rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600,
                      background: `${STATUS_COLORS[intent.status] || '#55556a'}15`,
                      color: STATUS_COLORS[intent.status] || '#8a8a9a',
                    }}>
                      <span style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: STATUS_COLORS[intent.status] || '#55556a',
                        display: 'inline-block',
                      }} />
                      {intent.status}
                    </span>
                  </td>
                  <td style={{ ...styles.td, fontFamily: 'var(--font-mono)' }}>
                    {intent.latencyMs != null ? `${(intent.latencyMs / 1000).toFixed(1)}s` : '—'}
                  </td>
                  <td style={{ ...styles.td, fontSize: '0.8rem', color: '#8a8a9a' }}>
                    {intent.source || '—'}
                  </td>
                  <td style={{ ...styles.td, fontSize: '0.8rem', color: '#8a8a9a' }}>
                    {new Date(intent.createdAt).toLocaleTimeString()}
                  </td>
                  <td style={{ ...styles.td, fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: '#55556a' }}>
                    {intent.txHash || '—'}
                  </td>
                </tr>
              ))}
              {sortedIntents.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ ...styles.td, textAlign: 'center', color: '#55556a', padding: '2rem' }}>
                    No intents recorded yet. Submit an intent from the Theta AI page.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Agent JSON Endpoint Info */}
        <div className="card" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
          <h3 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>Agent / M2M Access</h3>
          <p style={{ fontSize: '0.85rem', color: '#8a8a9a', marginBottom: '0.75rem' }}>
            Agents and automated systems can consume monitoring data via the JSON endpoint
            or subscribe to webhook notifications.
          </p>
          <div style={{
            background: 'rgba(0,0,0,0.3)', padding: '0.75rem 1rem', borderRadius: '8px',
            fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: '#00d4ff',
          }}>
            <div>GET  {STATS_ENDPOINT}</div>
            <div style={{ color: '#8a8a9a', marginTop: '0.25rem' }}>
              Returns: intents[], rpcHealth[], webhooks, failurePrediction, summary
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  hero: {
    textAlign: 'center',
    marginBottom: '2rem',
    padding: '2rem 0',
    background: 'radial-gradient(ellipse at 50% 0%, rgba(0,212,255,0.06) 0%, transparent 50%)',
    borderRadius: '16px',
  },
  heroTitle: {
    fontSize: '2.5rem', fontWeight: 900,
    background: 'linear-gradient(135deg, #00d4ff 0%, #8b5cf6 50%, #22c55e 100%)',
    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
    marginBottom: '0.5rem',
  },
  heroSubtitle: {
    color: '#8a8a9a', fontSize: '1.05rem', maxWidth: '600px', margin: '0 auto',
  },
  table: {
    width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem',
  },
  th: {
    textAlign: 'left', padding: '0.75rem 1rem', fontSize: '0.75rem',
    color: '#55556a', fontWeight: 600, textTransform: 'uppercase',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    whiteSpace: 'nowrap',
  },
  tr: {
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    transition: 'background 0.15s',
  },
  td: {
    padding: '0.6rem 1rem', whiteSpace: 'nowrap',
  },
};
