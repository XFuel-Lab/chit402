const treasuryOverview = [
  { label: 'Total Treasury', value: '(demo)' },
  { label: 'Monthly Inflow', value: '(demo)' },
  { label: 'Distributions', value: '(demo)' },
  { label: 'Last Distribution', value: '(demo)' },
];

const revenueSplits = [
  { name: 'Buyback-Burn (BBB)', percent: 30, amount: '(demo)', color: '#00d4ff', description: 'Open-market buy + burn bucket' },
  { name: 'Growth & expansion (GET)', percent: 30, amount: '(demo)', color: '#8b5cf6', description: 'Machine incentives, LP boost, grants (per docs)' },
  { name: 'Stakers (veXF)', percent: 25, amount: '(demo)', color: '#22c55e', description: 'Yield to lockers / stakers' },
  { name: 'Treasury', percent: 15, amount: '(demo)', color: '#f59e0b', description: 'Ops + fee-to-stake routing' },
];

const distributionHistory = [
  { date: '—', total: '(demo)', bbb: '—', get: '—', stakers: '—', treasury: '—', txHash: '—' },
];

const treasuryAllocations = [
  { category: 'Development', amount: '(demo)', percent: 25 },
  { category: 'Security Audits', amount: '(demo)', percent: 20 },
  { category: 'Grants Program', amount: '(demo)', percent: 15 },
  { category: 'Partnerships', amount: '(demo)', percent: 10 },
  { category: 'Marketing', amount: '(demo)', percent: 7.5 },
  { category: 'Legal & Compliance', amount: '(demo)', percent: 5 },
  { category: 'Reserve', amount: '(demo)', percent: 17.5 },
];

export default function Treasury() {
  return (
    <div className="page">
      <div className="container">
        <div className="page-header">
          <h1>Treasury Dashboard</h1>
          <p>Illustrative layout — wire to on-chain data for live treasury views.</p>
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
            <h3 style={{ marginBottom: '1.5rem' }}>Revenue split (target 30/30/25/15 — demo)</h3>
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
              <span style={{ color: '#00d4ff' }}>(demo)</span>
            </div>
          </div>
        </div>

        {/* Distribution History */}
        <div className="card" style={{ padding: '2rem' }}>
          <h3 style={{ marginBottom: '1.5rem' }}>Distribution history (demo)</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr>
                  {['Date', 'Total', 'BBB (30%)', 'GET (30%)', 'Stakers (25%)', 'Treasury (15%)', 'Tx'].map((h) => (
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
                    <td style={{ ...tdStyle, color: '#8b5cf6' }}>{d.get}</td>
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
