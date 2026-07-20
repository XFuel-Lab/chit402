import { useState } from 'react';

type Circuit = {
  name: string;
  category: string;
  status: 'live' | 'testnet' | 'audit' | 'development' | 'roadmap';
  verifications: string;
  gasAvg: string;
  network: string;
  description: string;
};

const circuits: Circuit[] = [
  { name: 'A2A Circuit', category: 'Agent', status: 'testnet', verifications: '—', gasAvg: '—', network: 'Theta', description: 'Agent-to-agent flows (per deployment).' },
  { name: 'ZKML Circuit', category: 'ML', status: 'testnet', verifications: '—', gasAvg: '—', network: 'Theta', description: 'ML inference verification path.' },
  { name: 'Data Hubs', category: 'Data', status: 'development', verifications: '—', gasAvg: '—', network: 'Theta', description: 'Data hub proofs (roadmap).' },
  { name: 'Bridge Verifier', category: 'Bridge', status: 'testnet', verifications: '—', gasAvg: '—', network: 'Multi', description: 'Cross-chain attestations (env-specific).' },
  { name: 'Compute Marketplace', category: 'Compute', status: 'development', verifications: '—', gasAvg: '—', network: 'Theta', description: 'Compute order verification (roadmap).' },
  { name: 'Inference Router', category: 'ML', status: 'roadmap', verifications: '—', gasAvg: '—', network: 'Bittensor', description: 'Subnet routing (not production-claimed).' },
  { name: 'USDC Fee Sink', category: 'DeFi', status: 'live', verifications: '—', gasAvg: '—', network: 'Base', description: 'Token-light: fees settle in USDC to protocol Safe / Splits v2 (ADR 0001).' },
  { name: 'Governance Verifier', category: 'Governance', status: 'development', verifications: '—', gasAvg: '—', network: 'Theta', description: 'Governance proof hooks (roadmap).' },
  { name: 'Staking Verifier', category: 'DeFi', status: 'roadmap', verifications: '—', gasAvg: '—', network: 'Multi', description: 'Cross-chain staking proofs (roadmap).' },
  { name: 'Partner Hook Verifier', category: 'Integration', status: 'development', verifications: '—', gasAvg: '—', network: 'Theta', description: 'Third-party integration hooks.' },
  { name: 'AI Listener Verifier', category: 'Agent', status: 'testnet', verifications: '—', gasAvg: '—', network: 'Theta', description: 'Listener / task pipeline (M2M).' },
  { name: 'Oracle path', category: 'Data', status: 'roadmap', verifications: '—', gasAvg: '—', network: 'Multi', description: 'Oracle-fed verification (no live Chainlink claim).' },
  { name: 'Treasury Circuit', category: 'DeFi', status: 'development', verifications: '—', gasAvg: '—', network: 'Theta', description: 'Treasury allocation proofs (roadmap).' },
  { name: 'Identity Circuit', category: 'Identity', status: 'audit', verifications: '—', gasAvg: '—', network: 'Theta', description: 'Identity attestations (in audit / design).' },
  { name: 'Subnet Verifier', category: 'Compute', status: 'roadmap', verifications: '—', gasAvg: '—', network: 'Bittensor', description: 'Subnet compute verification (roadmap).' },
  { name: 'CosmWasm Verifier', category: 'Bridge', status: 'roadmap', verifications: '—', gasAvg: '—', network: 'Osmosis', description: 'Cosmos WASM verifier (governance-dependent).' },
  { name: 'Edge Compute Circuit', category: 'Compute', status: 'testnet', verifications: '—', gasAvg: '—', network: 'Theta', description: 'Edge node tasks (testnet).' },
  { name: 'Move Verifier', category: 'Bridge', status: 'roadmap', verifications: '—', gasAvg: '—', network: 'Aptos', description: 'Move VM path (planned).' },
  { name: 'DePIN Registry', category: 'DePIN', status: 'audit', verifications: '—', gasAvg: '—', network: 'Multi', description: 'Physical infra registry (design / audit).' },
  { name: 'Reputation Circuit', category: 'Identity', status: 'development', verifications: '—', gasAvg: '—', network: 'Multi', description: 'Cross-chain reputation (development).' },
  { name: 'MEV Protection', category: 'DeFi', status: 'development', verifications: '—', gasAvg: '—', network: 'Multi', description: 'Bridge MEV ideas (development).' },
];

const categories = ['All', 'Agent', 'ML', 'Data', 'Bridge', 'Compute', 'DeFi', 'Governance', 'Integration', 'Identity', 'DePIN'];

export default function Circuits() {
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');

  const filtered = circuits.filter((c) => {
    const matchCat = filter === 'All' || c.category === filter;
    const matchSearch = c.name.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  const statusColor = (s: Circuit['status']) =>
    s === 'live'
      ? 'green'
      : s === 'testnet'
        ? 'cyan'
        : s === 'audit'
          ? 'orange'
          : s === 'roadmap'
            ? 'purple'
            : 'purple';

  return (
    <div className="page">
      <div className="container">
        <div className="page-header">
          <h1>Circuit Explorer</h1>
          <p>
            {circuits.length} circuit modules in the repository. Status reflects engineering intent — not all are live on mainnet.
            Verifications and gas are <strong>not</strong> live metrics here (demo / TBD).
          </p>
        </div>

        <div className="grid grid-4" style={{ marginBottom: '2rem' }}>
          <div className="card" style={{ textAlign: 'center' }}>
            <div className="stat-value" style={{ fontSize: '1.5rem' }}>{circuits.filter((c) => c.status === 'testnet').length}</div>
            <div className="stat-label">Testnet / dev</div>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <div className="stat-value" style={{ fontSize: '1.5rem' }}>{circuits.filter((c) => c.status === 'roadmap').length}</div>
            <div className="stat-label">Roadmap</div>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <div className="stat-value" style={{ fontSize: '1.5rem' }}>{circuits.filter((c) => c.status === 'audit').length}</div>
            <div className="stat-label">Audit / design</div>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <div className="stat-value" style={{ fontSize: '1.5rem' }}>{circuits.filter((c) => c.status === 'development').length}</div>
            <div className="stat-label">In development</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="input"
            style={{ maxWidth: '300px' }}
            placeholder="Search circuits..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {categories.map((cat) => (
              <button
                key={cat}
                className={`btn btn-sm ${filter === cat ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setFilter(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-3">
          {filtered.map((c) => (
            <div key={c.name} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                <h3 style={{ fontSize: '1rem' }}>{c.name}</h3>
                <span className={`badge badge-${statusColor(c.status)}`}>{c.status}</span>
              </div>
              <p style={{ marginBottom: '0.75rem', fontSize: '0.85rem' }}>{c.description}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <span className="tag">{c.category}</span>
                <span className="tag">{c.network}</span>
              </div>
              <hr className="separator" style={{ margin: '0.75rem 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                <div>
                  <div style={{ color: '#8a8a9a' }}>Verifications</div>
                  <div style={{ fontWeight: 700 }}>{c.verifications}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: '#8a8a9a' }}>Avg gas</div>
                  <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{c.gasAvg}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#8a8a9a' }}>No circuits match your filters.</div>
        )}
      </div>
    </div>
  );
}
