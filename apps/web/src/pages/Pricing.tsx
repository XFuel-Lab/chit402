export default function Pricing() {
  return (
    <div className="page docs-page">
      <div className="container" style={{ maxWidth: 720 }}>
        <header className="page-header">
          <span className="docs-kicker">Pricing</span>
          <h1>What a call costs</h1>
          <p>
            Two doors. <code>POST /v1/chat/completions</code> is $0.01 USDC on Base and Solana, signed receipt.
            <code>/task-request</code> is measured provider cost plus 10%, USDC on Base.
          </p>
        </header>

        <div className="card" style={{ padding: '1.5rem', marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>/v1 — public door</h2>
          <p style={{ color: '#8a8a9a' }}>
            <code>POST /v1/chat/completions</code> is $0.01 USDC on Base and Solana. HTTP 402
            without payment. Signed receipt names the model, the hub, and the cost.
            Demo key <code>xfuel-demo</code> skips payment: 15/min, 150/day per IP.
            The API is <code>https://api.xfuel.app/v1</code>, not <code>xfuel.app/v1</code>.
          </p>
        </div>

        <div className="card" style={{ padding: '1.5rem', marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>/task-request — USDC on Base</h2>
          <ul style={{ color: '#8a8a9a', paddingLeft: '1.2rem', lineHeight: 1.7 }}>
            <li>Cost-plus: measured provider COGS + 10% (<code>fee_bps=1000</code>)</li>
            <li>Floor $0.01 (USDC 6 decimals: amount <code>10000</code>)</li>
            <li>Tier-2 SP1 proof: opt-in +$0.08, or automatic above ~$2 provider COGS</li>
            <li>HTTP 402 without an x402 payment. Real USDC on Base mainnet. Public beta, not play money.</li>
          </ul>
        </div>

        <p style={{ color: '#8a8a9a', fontSize: '0.95rem' }}>
          Live quotes: <code>POST /task-quote</code> or{' '}
          <a href="https://api.xfuel.app/.well-known/x402">/.well-known/x402</a>.
          We are not the cheapest aggregator. Cheapness is not the pitch.
        </p>
      </div>
    </div>
  );
}
