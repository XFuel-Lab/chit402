const treasuryOverview = [
  { label: 'Total Treasury', value: '$4.8M' },
  { label: 'Monthly Inflow', value: '$210K' },
  { label: 'Distributions', value: '1,247' },
  { label: 'Last Distribution', value: '2h ago' },
];

const revenueSplits = [
  { name: 'Buy-Back & Burn (BBB)', percent: 40, amount: '$840K', color: '#00d4ff', description: 'XF tokens purchased from market and permanently burned' },
  { name: 'Liquidity Providers', percent: 30, amount: '$630K', color: '#8b5cf6', description: 'Distributed to XF LP stakers across all supported DEXs' },
  { name: 'Stakers', percent: 20, amount: '$420K', color: '#22c55e', description: 'Rewards for veXF holders and cross-chain stakers' },
  { name: 'Treasury Reserve', percent: 10, amount: '$210K', color: '#f59e0b', description: 'Protocol development, audits, grants, and partnerships' },
];

const distributionHistory = [
  { date: 'Feb 22, 2026', total: '$18,420', bbb: '$7,368', lp: '$5,526', stakers: '$3,684', treasury: '$1,842', txHash: '0xab12...ef34' },
  { date: 'Feb 21, 2026', total: '$16,890', bbb: '$6,756', lp: '$5,067', stakers: '$3,378', treasury: '$1,689', txHash: '0xcd56...gh78' },
  { date: 'Feb 20, 2026', total: '$21,340', bbb: '$8,536', lp: '$6,402', stakers: '$4,268', treasury: '$2,134', txHash: '0xij90...kl12' },
  { date: 'Feb 19, 2026', total: '$15,780', bbb: '$6,312', lp: '$4,734', stakers: '$3,156', treasury: '$1,578', txHash: '0xmn34...op56' },
  { date: 'Feb 18, 2026', total: '$19,650', bbb: '$7,860', lp: '$5,895', stakers: '$3,930', treasury: '$1,965', txHash: '0xqr78...st90' },
];

const treasuryAllocations = [
  { category: 'Development', amount: '$1.2M', percent: 25 },
  { category: 'Security Audits', amount: '$960K', percent: 20 },
  { category: 'Grants Program', amount: '$720K', percent: 15 },
  { category: 'Partnerships', amount: '$480K', percent: 10 },
  { category: 'Marketing', amount: '$360K', percent: 7.5 },
  { category: 'Legal & Compliance', amount: '$240K', percent: 5 },
  { category: 'Reserve', amount: '$840K', percent: 17.5 },
];

export default function Treasury() {
  return (
    <div className="page">
      <div className="container">
        <div className="page-header">
          <h1>Treasury Dashboard</h1>
          <p>CoreRevenueSplitter distributions, allocations, and burn history</p>
        </div>

        {/* Overview Stats */}
        <div className="grid grid-4" style={{ marginBottom: '2rem' }}>
          {treasuryOverview.map((s) => (
            <div key={s.label} className="card" style={{ textAlign: 'center' }}>
              <div className="stat-value" style={{ fontSize: '1.5rem' }}>{s.value}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Revenue Splits */}
        <div className="grid grid-2" style={{ marginBottom: '2rem' }}>
          <div className="card" style={{ padding: '2rem' }}>
            <h3 style={{ marginBottom: '1.5rem' }}>Revenue Split (40/30/20/10)</h3>
            {revenueSplits.map((s) => (
              <div key={s.name} style={{ marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: s.color, display: 'inline-block' }} />
                    <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{s.name}</span>
                  </div>
                  <span style={{ fontWeight: 700 }}>{s.percent}%</span>
                </div>
                <div className="progress-bar">
                  <div style={{ height: '100%', borderRadius: '999px', background: s.color, width: `${s.percent}%` }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.25rem' }}>
                  <span style={{ color: '#8a8a9a', fontSize: '0.8rem' }}>{s.description}</span>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{s.amount}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="card" style={{ padding: '2rem' }}>
            <h3 style={{ marginBottom: '1.5rem' }}>Treasury Allocations</h3>
            {treasuryAllocations.map((a) => (
              <div key={a.category} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ fontSize: '0.9rem' }}>{a.category}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <span style={{ fontSize: '0.85rem', color: '#8a8a9a' }}>{a.percent}%</span>
                  <span style={{ fontWeight: 700, minWidth: '80px', textAlign: 'right' }}>{a.amount}</span>
                </div>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 0', fontWeight: 700 }}>
              <span>Total</span>
              <span style={{ color: '#00d4ff' }}>$4.8M</span>
            </div>
          </div>
        </div>

        {/* Distribution History */}
        <div className="card" style={{ padding: '2rem' }}>
          <h3 style={{ marginBottom: '1.5rem' }}>Distribution History</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr>
                  {['Date', 'Total', 'BBB (40%)', 'LP (30%)', 'Stakers (20%)', 'Treasury (10%)', 'Tx'].map((h) => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {distributionHistory.map((d) => (
                  <tr key={d.date}>
                    <td style={tdStyle}>{d.date}</td>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>{d.total}</td>
                    <td style={{ ...tdStyle, color: '#00d4ff' }}>{d.bbb}</td>
                    <td style={{ ...tdStyle, color: '#8b5cf6' }}>{d.lp}</td>
                    <td style={{ ...tdStyle, color: '#22c55e' }}>{d.stakers}</td>
                    <td style={{ ...tdStyle, color: '#f59e0b' }}>{d.treasury}</td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{d.txHash}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '0.75rem', color: '#8a8a9a',
  borderBottom: '1px solid rgba(255,255,255,0.08)', fontWeight: 600,
  fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.04)',
  whiteSpace: 'nowrap',
};
