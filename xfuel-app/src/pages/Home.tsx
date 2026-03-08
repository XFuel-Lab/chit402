import { Link } from 'react-router-dom';

const stats = [
  { value: '21+', label: 'ZK Circuits' },
  { value: '700+', label: 'Tests Passing' },
  { value: '5', label: 'Networks' },
  { value: '$500M+', label: 'TVL Target' },
];

const features = [
  {
    title: 'Cross-Chain Bridge',
    description: 'Hyperlane-powered bridge with SP1 ZK verification across Theta, Bittensor, Osmosis, Aptos, and Sui.',
    icon: '⟷',
    link: '/bridge',
    color: '#00d4ff',
  },
  {
    title: 'veXF Governance',
    description: 'Vote-escrowed XF token governance with quadratic voting, time-weighted locks, and on-chain proposals.',
    icon: '⚖',
    link: '/governance',
    color: '#8b5cf6',
  },
  {
    title: 'Fee-to-Stake',
    description: 'Multi-chain staking routes: Bittensor TAO delegation, Theta TFUEL staking, and LP rewards.',
    icon: '◈',
    link: '/staking',
    color: '#22c55e',
  },
  {
    title: 'ZK Circuits',
    description: '21 production circuits: A2A, ZKML, Data Hubs, Bridge Verifier, Compute Marketplace, and more.',
    icon: '⬡',
    link: '/circuits',
    color: '#f59e0b',
  },
  {
    title: 'DePIN Infrastructure',
    description: 'Decentralized physical infrastructure with AI listeners, partner hooks, and M2M API gateway.',
    icon: '◉',
    link: '/dashboard',
    color: '#ef4444',
  },
  {
    title: 'Partner Integrations',
    description: 'Almanak AI agents, Succinct SP1 provers, Chainlink CCIP oracles, and Hyperlane messaging.',
    icon: '◎',
    link: '/docs',
    color: '#06b6d4',
  },
];

const partners = [
  { name: 'Almanak', role: 'AI Agent Orchestration' },
  { name: 'Succinct', role: 'SP1 ZK Proving' },
  { name: 'Chainlink', role: 'Cross-Chain Oracles' },
  { name: 'Hyperlane', role: 'Interchain Messaging' },
  { name: 'Theta Network', role: 'Edge Computing' },
  { name: 'Bittensor', role: 'Decentralized AI' },
];

const networks = [
  { name: 'Theta', status: 'live' },
  { name: 'Bittensor EVM', status: 'live' },
  { name: 'Osmosis', status: 'testnet' },
  { name: 'Aptos', status: 'planned' },
  { name: 'Sui', status: 'planned' },
];

export default function Home() {
  return (
    <div className="page">
      {/* Hero */}
      <section style={styles.hero}>
        <div className="container" style={{ textAlign: 'center' }}>
          <div style={styles.heroBadge}>
            <span className="badge badge-cyan">Mainnet Live</span>
            <span style={{ color: '#8a8a9a', fontSize: '0.85rem' }}>v1.0 — 21 Circuits Deployed</span>
          </div>
          <h1 style={styles.heroTitle}>
            XFuel Protocol
          </h1>
          <p style={styles.heroSubtitle}>
            ZK-Verified AI Pumping Station
          </p>
          <p style={styles.heroDescription}>
            Ecosystem-agnostic AI infrastructure with SP1 zero-knowledge proofs,
            veXF governance, and cross-chain DePIN across Theta, Bittensor, Osmosis, Aptos, and Sui.
          </p>
          <div style={styles.heroCta}>
            <Link to="/dashboard" className="btn btn-primary">
              Launch App
            </Link>
            <a href="/docs" className="btn btn-secondary">
              Read Whitepaper
            </a>
          </div>
        </div>
      </section>

      {/* Stats Bar */}
      <section style={styles.statsSection}>
        <div className="container">
          <div className="grid grid-4" style={{ textAlign: 'center' }}>
            {stats.map((s) => (
              <div key={s.label} className="card" style={{ padding: '1.25rem' }}>
                <div className="stat-value">{s.value}</div>
                <div className="stat-label">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Networks */}
      <section style={{ padding: '2rem 0' }}>
        <div className="container">
          <h2 style={{ textAlign: 'center', marginBottom: '1.5rem' }}>Supported Networks</h2>
          <div style={styles.networkBar}>
            {networks.map((n) => (
              <div key={n.name} style={styles.networkChip}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: n.status === 'live' ? '#22c55e' : n.status === 'testnet' ? '#f59e0b' : '#55556a',
                  display: 'inline-block',
                }} />
                <span>{n.name}</span>
                <span className={`badge badge-${n.status === 'live' ? 'green' : n.status === 'testnet' ? 'orange' : 'purple'}`}>
                  {n.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section style={{ padding: '3rem 0' }}>
        <div className="container">
          <h2 style={{ textAlign: 'center', marginBottom: '0.5rem' }}>Core Infrastructure</h2>
          <p style={{ textAlign: 'center', color: '#8a8a9a', marginBottom: '2rem' }}>
            Everything needed for cross-chain AI verification and governance
          </p>
          <div className="grid grid-3">
            {features.map((f) => (
              <Link key={f.title} to={f.link} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="card" style={{ height: '100%' }}>
                  <div style={{ fontSize: '2rem', marginBottom: '0.75rem', filter: `drop-shadow(0 0 8px ${f.color})` }}>
                    {f.icon}
                  </div>
                  <h3 style={{ color: f.color }}>{f.title}</h3>
                  <p>{f.description}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Architecture */}
      <section style={{ padding: '3rem 0' }}>
        <div className="container">
          <h2 style={{ textAlign: 'center', marginBottom: '2rem' }}>Protocol Architecture</h2>
          <div className="grid grid-2">
            <div className="card">
              <h3 style={{ color: '#00d4ff', marginBottom: '1rem' }}>Revenue Flow</h3>
              <div style={styles.flowItem}>
                <span style={styles.flowDot} />
                <div>
                  <strong>Protocol Fees</strong>
                  <p style={{ fontSize: '0.85rem', color: '#8a8a9a' }}>Bridge tolls, circuit verification fees, AI inference charges</p>
                </div>
              </div>
              <div style={styles.flowItem}>
                <span style={{ ...styles.flowDot, background: '#8b5cf6' }} />
                <div>
                  <strong>CoreRevenueSplitter</strong>
                  <p style={{ fontSize: '0.85rem', color: '#8a8a9a' }}>40% BBB · 30% LP · 20% Stakers · 10% Treasury</p>
                </div>
              </div>
              <div style={styles.flowItem}>
                <span style={{ ...styles.flowDot, background: '#22c55e' }} />
                <div>
                  <strong>Cross-Chain Distribution</strong>
                  <p style={{ fontSize: '0.85rem', color: '#8a8a9a' }}>Hyperlane dispatch to all supported networks</p>
                </div>
              </div>
            </div>
            <div className="card">
              <h3 style={{ color: '#8b5cf6', marginBottom: '1rem' }}>ZK Verification Stack</h3>
              <div style={styles.flowItem}>
                <span style={styles.flowDot} />
                <div>
                  <strong>SP1 Prover</strong>
                  <p style={{ fontSize: '0.85rem', color: '#8a8a9a' }}>Succinct SP1 for Rust-based ZK proof generation</p>
                </div>
              </div>
              <div style={styles.flowItem}>
                <span style={{ ...styles.flowDot, background: '#f59e0b' }} />
                <div>
                  <strong>On-Chain Verifier</strong>
                  <p style={{ fontSize: '0.85rem', color: '#8a8a9a' }}>ZKVerifierSP1.sol with proof hooks and circuit registry</p>
                </div>
              </div>
              <div style={styles.flowItem}>
                <span style={{ ...styles.flowDot, background: '#ef4444' }} />
                <div>
                  <strong>CosmWasm Verifier</strong>
                  <p style={{ fontSize: '0.85rem', color: '#8a8a9a' }}>Rust WASM verifier for Osmosis and Cosmos chains</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Partners */}
      <section style={{ padding: '3rem 0' }}>
        <div className="container">
          <h2 style={{ textAlign: 'center', marginBottom: '0.5rem' }}>Ecosystem Partners</h2>
          <p style={{ textAlign: 'center', color: '#8a8a9a', marginBottom: '2rem' }}>
            Backed by the best in ZK, AI, and cross-chain infrastructure
          </p>
          <div className="grid grid-3">
            {partners.map((p) => (
              <div key={p.name} className="card" style={{ textAlign: 'center', padding: '2rem 1.5rem' }}>
                <h3>{p.name}</h3>
                <p>{p.role}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section style={{ padding: '4rem 0', textAlign: 'center' }}>
        <div className="container">
          <h2 style={{ marginBottom: '0.5rem' }}>Ready to fuel the future of AI?</h2>
          <p style={{ color: '#8a8a9a', marginBottom: '2rem', maxWidth: '500px', margin: '0 auto 2rem' }}>
            Join the XFuel ecosystem. Bridge assets, govern the protocol, and earn rewards across five networks.
          </p>
          <div style={styles.heroCta}>
            <Link to="/bridge" className="btn btn-primary">Start Bridging</Link>
            <Link to="/community" className="btn btn-secondary">Join Community</Link>
          </div>
        </div>
      </section>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  hero: {
    padding: '5rem 0 3rem',
    background: 'radial-gradient(ellipse at 50% 0%, rgba(0,212,255,0.08) 0%, transparent 60%)',
  },
  heroBadge: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem',
    marginBottom: '1.5rem',
  },
  heroTitle: {
    fontSize: '3.5rem', fontWeight: 900, lineHeight: 1.1,
    background: 'linear-gradient(135deg, #00d4ff 0%, #8b5cf6 50%, #00d4ff 100%)',
    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
    marginBottom: '0.75rem',
  },
  heroSubtitle: {
    fontSize: '1.35rem', color: '#8a8a9a', marginBottom: '1.5rem',
  },
  heroDescription: {
    fontSize: '1.05rem', color: '#8a8a9a', maxWidth: '640px', margin: '0 auto 2rem',
    lineHeight: 1.7,
  },
  heroCta: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem',
    flexWrap: 'wrap' as const,
  },
  statsSection: { padding: '2rem 0' },
  networkBar: {
    display: 'flex', flexWrap: 'wrap' as const, gap: '1rem', justifyContent: 'center',
  },
  networkChip: {
    display: 'flex', alignItems: 'center', gap: '0.5rem',
    padding: '0.5rem 1rem',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '999px', fontSize: '0.9rem',
  },
  flowItem: {
    display: 'flex', gap: '0.75rem', marginBottom: '1rem', alignItems: 'flex-start',
  },
  flowDot: {
    width: 10, height: 10, borderRadius: '50%', background: '#00d4ff',
    marginTop: '6px', flexShrink: 0,
  },
};
