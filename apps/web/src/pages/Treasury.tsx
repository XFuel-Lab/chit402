const treasuryOverview = [
  { label: 'Fee currency', value: 'USDC' },
  { label: 'Settlement home', value: 'Base' },
  { label: 'Fee sink', value: 'Safe / Splits v2' },
  { label: 'Last Distribution', value: '(demo)' },
];

// Token-light: fees settle in USDC to one Base address; downstream fan-out is
// governance-set treasury policy, NOT a hardcoded per-fee split (ADR 0001 / 0002).
const feeFlow = [
  { name: 'Fee collected', color: '#00d4ff', description: 'USDC via x402 on Base, per task (0.1%–1%)' },
  { name: 'Fee sink', color: '#8b5cf6', description: 'Lands at X402_PAY_TO — protocol Safe / Splits v2 (off hot path)' },
  { name: 'Downstream policy', color: '#22c55e', description: 'Ecosystem, reserve, XF buyback (post-TGE) — set by veXF governance' },
];

// Illustrative treasury allocation — governance-adjustable, not a fixed per-fee split.
const treasuryAllocations = [
  { category: 'Development', amount: '(demo)', percent: 25 },
  { category: 'Security Audits', amount: '(demo)', percent: 20 },
  { category: 'Grants Program', amount: '(demo)', percent: 15 },
  { category: 'Partnerships', amount: '(demo)', percent: 10 },
  { category: 'Marketing', amount: '(demo)', percent: 7.5 },
  { category: 'Legal & Compliance', amount: '(demo)', percent: 5 },
  { category: 'Reserve', amount: '(demo)', percent: 17.5 },
];

const distributionHistory = [
  { date: '—', total: '(demo)', destination: '—', txHash: '—' },
];

export default function Treasury() {
  return (
    <div className="page">
      <div className="container">
        <div className="page-header">
          <h1>Treasury Dashboard</h1>
          <p>Token-light: fees settle in USDC on Base to the protocol Safe / Splits v2. Illustrative layout — wire to on-chain data for live views.</p>
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

        {/* Fee flow + allocations */}
        <div className="grid grid-2" style={{ marginBottom: '2rem' }}>
          <div className="card" style={{ padding: '2rem' }}>
            <h3 style={{ marginBottom: '1.5rem' }}>Fee flow — token-light (USDC on Base)</h3>
            {feeFlow.map((s, i) => (
              <div key={s.name} style={{ marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: s.color, display: 'inline-block' }} />
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{i + 1}. {s.name}</span>
                </div>
                <div style={{ paddingLeft: '1.1rem' }}>
                  <span style={{ color: '#8a8a9a', fontSize: '0.82rem' }}>{s.description}</span>
                </div>
              </div>
            ))}
            <p style={{ color: '#8a8a9a', fontSize: '0.78rem', marginTop: '0.5rem' }}>
              No hardcoded per-fee split and no fixed staker-yield entitlement (ADR 0001).
            </p>
          </div>

          <div className="card" style={{ padding: '2rem' }}>
            <h3 style={{ marginBottom: '1.5rem' }}>Treasury allocation (governance-set, demo)</h3>
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
                  {['Date', 'Total (USDC)', 'Destination', 'Tx'].map((h) => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {distributionHistory.map((d) => (
                  <tr key={d.date}>
                    <td style={tdStyle}>{d.date}</td>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>{d.total}</td>
                    <td style={{ ...tdStyle, color: '#8b5cf6' }}>{d.destination}</td>
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
