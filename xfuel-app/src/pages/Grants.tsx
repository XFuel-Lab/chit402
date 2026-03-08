type Grant = {
  program: string;
  network: string;
  amount: string;
  status: 'active' | 'completed' | 'pending';
  startDate: string;
  color: string;
  milestones: { name: string; status: 'done' | 'in-progress' | 'pending'; deliverable: string }[];
};

const grants: Grant[] = [
  {
    program: 'Solana Foundation Grant',
    network: 'Solana',
    amount: '$75,000',
    status: 'active',
    startDate: 'Dec 2025',
    color: '#9945FF',
    milestones: [
      { name: 'M1: Solana Prover MVP', status: 'done', deliverable: 'SP1 proof generation on Solana runtime' },
      { name: 'M2: On-Chain Verifier', status: 'done', deliverable: 'Solana program for ZK proof verification' },
      { name: 'M3: Bridge Integration', status: 'in-progress', deliverable: 'Wormhole bridge with ZK attestations' },
      { name: 'M4: Mainnet Deployment', status: 'pending', deliverable: 'Production deployment with audit' },
    ],
  },
  {
    program: 'Bittensor TAO Grant',
    network: 'Bittensor',
    amount: '500 TAO',
    status: 'active',
    startDate: 'Jan 2026',
    color: '#00d4ff',
    milestones: [
      { name: 'M1: EVM Subnet Research', status: 'done', deliverable: 'Bittensor EVM compatibility layer research' },
      { name: 'M2: Staking Precompile', status: 'done', deliverable: 'IBittensorStaking interface implementation' },
      { name: 'M3: Subnet Verification', status: 'in-progress', deliverable: 'ZK verification for subnet computations' },
      { name: 'M4: Full Integration', status: 'pending', deliverable: 'Complete Bittensor EVM deployment' },
    ],
  },
  {
    program: 'Theta Network Grant',
    network: 'Theta',
    amount: '$50,000',
    status: 'completed',
    startDate: 'Oct 2025',
    color: '#2ab8e6',
    milestones: [
      { name: 'M1: Core Contracts', status: 'done', deliverable: 'CoreRevenueSplitter, ZKVerifierSP1 deployed' },
      { name: 'M2: AI Listener', status: 'done', deliverable: 'On-chain AI event listener with proof hooks' },
      { name: 'M3: Edge Compute', status: 'done', deliverable: 'Theta edge compute node integration' },
      { name: 'M4: Mainnet Launch', status: 'done', deliverable: 'Full mainnet deployment with 16 circuits' },
    ],
  },
  {
    program: 'Osmosis Grant',
    network: 'Osmosis',
    amount: '$30,000',
    status: 'pending',
    startDate: 'Mar 2026',
    color: '#8b5cf6',
    milestones: [
      { name: 'M1: CosmWasm Verifier', status: 'done', deliverable: 'Rust WASM ZK verifier contract' },
      { name: 'M2: IBC Integration', status: 'pending', deliverable: 'IBC message handling for cross-chain proofs' },
      { name: 'M3: LP Integration', status: 'pending', deliverable: 'XF/OSMO liquidity pool with superfluid staking' },
      { name: 'M4: Testnet Launch', status: 'pending', deliverable: 'Full Osmosis testnet deployment' },
    ],
  },
];

const grantStats = [
  { label: 'Total Grant Value', value: '$205K+' },
  { label: 'Active Grants', value: '2' },
  { label: 'Milestones Completed', value: '10/16' },
  { label: 'Networks Covered', value: '4' },
];

export default function Grants() {
  return (
    <div className="page">
      <div className="container">
        <div className="page-header">
          <h1>Grant Tracker</h1>
          <p>Ecosystem grants, milestone progress, and deliverables across all network partners</p>
        </div>

        {/* Stats */}
        <div className="grid grid-4" style={{ marginBottom: '2rem' }}>
          {grantStats.map((s) => (
            <div key={s.label} className="card" style={{ textAlign: 'center' }}>
              <div className="stat-value" style={{ fontSize: '1.5rem' }}>{s.value}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Grant Cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {grants.map((g) => {
            const completed = g.milestones.filter((m) => m.status === 'done').length;
            const progress = (completed / g.milestones.length) * 100;

            return (
              <div key={g.program} className="card" style={{ padding: '2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div>
                    <h3 style={{ color: g.color, marginBottom: '0.25rem' }}>{g.program}</h3>
                    <div style={{ color: '#8a8a9a', fontSize: '0.85rem' }}>
                      {g.network} · Started {g.startDate} · {g.amount}
                    </div>
                  </div>
                  <span className={`badge badge-${g.status === 'active' ? 'cyan' : g.status === 'completed' ? 'green' : 'orange'}`}>
                    {g.status}
                  </span>
                </div>

                {/* Progress */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem', fontSize: '0.85rem' }}>
                  <span style={{ color: '#8a8a9a' }}>Progress</span>
                  <span style={{ fontWeight: 600 }}>{completed}/{g.milestones.length} milestones</span>
                </div>
                <div className="progress-bar" style={{ marginBottom: '1.25rem' }}>
                  <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
                </div>

                {/* Milestones */}
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                  {g.milestones.map((m) => (
                    <div
                      key={m.name}
                      style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '0.75rem 1rem',
                        background: m.status === 'done' ? 'rgba(34,197,94,0.05)' : m.status === 'in-progress' ? 'rgba(0,212,255,0.05)' : 'rgba(255,255,255,0.02)',
                        borderRadius: '8px',
                        border: `1px solid ${m.status === 'done' ? 'rgba(34,197,94,0.15)' : m.status === 'in-progress' ? 'rgba(0,212,255,0.15)' : 'rgba(255,255,255,0.06)'}`,
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.15rem' }}>
                          {m.status === 'done' ? '✓ ' : m.status === 'in-progress' ? '◐ ' : '○ '}
                          {m.name}
                        </div>
                        <div style={{ color: '#8a8a9a', fontSize: '0.8rem' }}>{m.deliverable}</div>
                      </div>
                      <span className={`badge badge-${m.status === 'done' ? 'green' : m.status === 'in-progress' ? 'cyan' : 'purple'}`}>
                        {m.status === 'done' ? 'Complete' : m.status === 'in-progress' ? 'In Progress' : 'Pending'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Apply for Grant */}
        <div className="card" style={{ padding: '2rem', marginTop: '2rem', textAlign: 'center' }}>
          <h3 style={{ marginBottom: '0.5rem' }}>Building on XFuel?</h3>
          <p style={{ color: '#8a8a9a', marginBottom: '1.5rem', maxWidth: '500px', margin: '0 auto 1.5rem' }}>
            Apply for a grant to integrate XFuel ZK verification into your project.
            We support circuit development, bridge integrations, and DePIN nodes.
          </p>
          <a href="https://github.com/XFuelAI/xfuel-protocol/issues" target="_blank" rel="noreferrer" className="btn btn-primary">
            Apply for Grant ↗
          </a>
        </div>
      </div>
    </div>
  );
}
