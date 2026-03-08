import { useState } from 'react';

type Circuit = {
  name: string;
  category: string;
  status: 'live' | 'testnet' | 'audit' | 'development';
  verifications: string;
  gasAvg: string;
  network: string;
  description: string;
};

const circuits: Circuit[] = [
  { name: 'A2A Circuit', category: 'Agent', status: 'live', verifications: '12,450', gasAvg: '0.0034', network: 'Theta', description: 'Agent-to-Agent verification for autonomous AI interactions' },
  { name: 'ZKML Circuit', category: 'ML', status: 'live', verifications: '8,230', gasAvg: '0.0041', network: 'Theta', description: 'Zero-knowledge machine learning inference verification' },
  { name: 'Data Hubs', category: 'Data', status: 'live', verifications: '6,120', gasAvg: '0.0028', network: 'Theta', description: 'Verified data hub operations and integrity proofs' },
  { name: 'Bridge Verifier', category: 'Bridge', status: 'live', verifications: '4,821', gasAvg: '0.0052', network: 'Multi', description: 'Cross-chain bridge transaction verification with SP1' },
  { name: 'Compute Marketplace', category: 'Compute', status: 'live', verifications: '3,450', gasAvg: '0.0038', network: 'Theta', description: 'Decentralized compute marketplace order verification' },
  { name: 'Inference Router', category: 'ML', status: 'live', verifications: '2,890', gasAvg: '0.0045', network: 'Bittensor', description: 'AI inference routing with load balancing verification' },
  { name: 'Revenue Splitter', category: 'DeFi', status: 'live', verifications: '1,247', gasAvg: '0.0031', network: 'Multi', description: 'Verified revenue distribution across stakeholders' },
  { name: 'Governance Verifier', category: 'Governance', status: 'live', verifications: '980', gasAvg: '0.0025', network: 'Theta', description: 'On-chain governance vote tallying and execution verification' },
  { name: 'Staking Verifier', category: 'DeFi', status: 'live', verifications: '2,100', gasAvg: '0.0029', network: 'Multi', description: 'Cross-chain staking position and reward verification' },
  { name: 'Partner Hook Verifier', category: 'Integration', status: 'live', verifications: '1,560', gasAvg: '0.0033', network: 'Theta', description: 'Third-party integration hook verification' },
  { name: 'AI Listener Verifier', category: 'Agent', status: 'live', verifications: '3,200', gasAvg: '0.0036', network: 'Theta', description: 'AI event listener action verification' },
  { name: 'Oracle Circuit', category: 'Data', status: 'live', verifications: '4,100', gasAvg: '0.0042', network: 'Multi', description: 'Chainlink oracle data feed verification' },
  { name: 'Treasury Circuit', category: 'DeFi', status: 'live', verifications: '620', gasAvg: '0.0027', network: 'Theta', description: 'Treasury management and allocation verification' },
  { name: 'Identity Circuit', category: 'Identity', status: 'live', verifications: '890', gasAvg: '0.0039', network: 'Theta', description: 'Decentralized identity attestation verification' },
  { name: 'Subnet Verifier', category: 'Compute', status: 'live', verifications: '1,780', gasAvg: '0.0048', network: 'Bittensor', description: 'Bittensor subnet computation verification' },
  { name: 'CosmWasm Verifier', category: 'Bridge', status: 'live', verifications: '540', gasAvg: '0.0035', network: 'Osmosis', description: 'Cosmos-native WASM contract verification' },
  { name: 'Edge Compute Circuit', category: 'Compute', status: 'testnet', verifications: '230', gasAvg: '0.0055', network: 'Theta', description: 'Edge node compute task verification' },
  { name: 'Move Verifier', category: 'Bridge', status: 'testnet', verifications: '120', gasAvg: '0.0060', network: 'Aptos', description: 'Move VM proof verification for Aptos/Sui' },
  { name: 'DePIN Registry', category: 'DePIN', status: 'audit', verifications: '—', gasAvg: '—', network: 'Multi', description: 'Physical infrastructure node registration verification' },
  { name: 'Reputation Circuit', category: 'Identity', status: 'audit', verifications: '—', gasAvg: '—', network: 'Multi', description: 'Cross-chain reputation score aggregation' },
  { name: 'MEV Protection', category: 'DeFi', status: 'development', verifications: '—', gasAvg: '—', network: 'Multi', description: 'ZK-verified MEV protection for bridge transactions' },
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
    s === 'live' ? 'green' : s === 'testnet' ? 'cyan' : s === 'audit' ? 'orange' : 'purple';

  return (
    <div className="page">
      <div className="container">
        <div className="page-header">
          <h1>Circuit Explorer</h1>
          <p>Browse all {circuits.length} ZK circuits powering XFuel Protocol</p>
        </div>

        {/* Stats Row */}
        <div className="grid grid-4" style={{ marginBottom: '2rem' }}>
          <div className="card" style={{ textAlign: 'center' }}>
            <div className="stat-value" style={{ fontSize: '1.5rem' }}>{circuits.filter(c => c.status === 'live').length}</div>
            <div className="stat-label">Live</div>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <div className="stat-value" style={{ fontSize: '1.5rem' }}>{circuits.filter(c => c.status === 'testnet').length}</div>
            <div className="stat-label">Testnet</div>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <div className="stat-value" style={{ fontSize: '1.5rem' }}>{circuits.filter(c => c.status === 'audit').length}</div>
            <div className="stat-label">In Audit</div>
          </div>
          <div className="card" style={{ textAlign: 'center' }}>
            <div className="stat-value" style={{ fontSize: '1.5rem' }}>{circuits.filter(c => c.status === 'development').length}</div>
            <div className="stat-label">Development</div>
          </div>
        </div>

        {/* Filters */}
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

        {/* Circuit Grid */}
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
                  <div style={{ color: '#8a8a9a' }}>Avg Gas (ETH)</div>
                  <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{c.gasAvg}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#8a8a9a' }}>
            No circuits match your filters.
          </div>
        )}
      </div>
    </div>
  );
}
