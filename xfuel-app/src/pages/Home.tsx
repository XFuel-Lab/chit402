import { Link } from 'react-router-dom';
import { useEffect, useState, type CSSProperties } from 'react';

const BELIEVER_DISMISS_KEY = 'xfuel-believer-chip-dismissed';

const stats = [
  { value: 'Any', label: 'Model or provider, routed' },
  { value: 'SP1', label: 'On-chain proofs (live)' },
  { value: 'x402', label: 'USDC + TFUEL payment rails' },
  { value: '700+', label: 'Tests passing (repo)' },
];

const roadmap = [
  {
    tag: 'Now',
    title: 'Phase 1 audit',
    detail: 'Core settlement, verifier, and funding contracts — firm engagement announced when signed.',
  },
  {
    tag: 'Next',
    title: 'Subchain & operators',
    detail: 'XFuel subchain RPC, explorer, and operator-facing dashboards.',
  },
  {
    tag: 'Next',
    title: 'Public metrics',
    detail: 'Live counters for routed tasks, proofs verified, and settlement volume.',
  },
  {
    tag: 'Then',
    title: 'veXF rollout',
    detail: 'Governance parameters and fee votes as deployments go live.',
  },
  {
    tag: 'Roadmap',
    title: 'Cross-chain relay',
    detail: 'Bittensor EVM and additional relay paths beyond Theta.',
  },
];

const features = [
  {
    title: 'Provider-agnostic routing',
    description:
      'One OpenAI-compatible endpoint routes to the best available provider — centralized, neocloud (Groq/Together/Fireworks), or DePIN (Theta, Akash). Configured, not hardcoded.',
    icon: '◎',
    link: '/theta-ai',
    color: '#00d4ff',
  },
  {
    title: 'Verifiable receipts',
    description: 'Every task returns a signed receipt; upgrade to an on-chain SP1 settlement proof with a single-use nullifier (replay-proof) when it matters.',
    icon: '⬡',
    link: '/circuits',
    color: '#f59e0b',
  },
  {
    title: 'Agent-native payments',
    description: 'Pay per call over x402/USDC or TFUEL — give an agent a budget, not your API keys. Escrow caps the spend.',
    icon: '◈',
    link: '/docs',
    color: '#22c55e',
  },
  {
    title: 'On-chain settlement',
    description: 'CoreRevenueSplitter distributes fees transparently — 30% BBB · 30% GET · 25% veXF · 15% treasury — settled on Theta.',
    icon: '⬢',
    link: '/treasury',
    color: '#06b6d4',
  },
  {
    title: 'Proof, when it matters',
    description: 'Signed receipt (free) → ZK settlement proof (on demand) → proof-of-inference via zkGPT (roadmap). Cost tracks the level of trust you need.',
    icon: '◉',
    link: '/security',
    color: '#ef4444',
  },
  {
    title: 'Composable & open',
    description: 'M2M REST API, OpenAI-compatible gateway, MCP server, TypeScript SDK, and signed webhooks. MIT licensed.',
    icon: '⚙',
    link: '/docs',
    color: '#8b5cf6',
  },
];

const stackItems = [
  { name: 'Succinct', role: 'SP1 proving stack', tag: 'in use' },
  { name: 'Hyperlane', role: 'Interchain messaging', tag: 'in use' },
  { name: 'Theta Network', role: 'EdgeCloud + EVM (361)', tag: 'in use' },
  { name: 'Chainlink CCIP', role: 'Oracle / messaging (roadmap)', tag: 'roadmap' },
  { name: 'Almanak', role: 'Agent orchestration (exploring)', tag: 'roadmap' },
  { name: 'Bittensor', role: 'Decentralized AI (EVM subnet)', tag: 'ecosystem' },
];

const networks = [
  { name: 'Theta', status: 'live' },
  { name: 'Bittensor EVM', status: 'testnet' },
  { name: 'Osmosis', status: 'roadmap' },
  { name: 'Aptos', status: 'planned' },
  { name: 'Sui', status: 'planned' },
];

function networkDot(status: string) {
  if (status === 'live') return '#22c55e';
  if (status === 'testnet') return '#f59e0b';
  if (status === 'roadmap') return '#8b5cf6';
  return '#55556a';
}

function networkBadgeClass(status: string) {
  if (status === 'live') return 'badge badge-cyan';
  if (status === 'testnet') return 'badge badge-orange';
  return 'badge badge-purple';
}

export default function Home() {
  const [showBelieverChip, setShowBelieverChip] = useState(true);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(BELIEVER_DISMISS_KEY)) setShowBelieverChip(false);
    } catch {
      /* ignore */
    }
  }, []);

  const dismissBeliever = () => {
    try {
      sessionStorage.setItem(BELIEVER_DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
    setShowBelieverChip(false);
  };

  return (
    <div className="page">
      {showBelieverChip && (
        <div className="container" style={{ paddingTop: '1rem' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.75rem',
              flexWrap: 'wrap',
              padding: '0.65rem 1rem',
              background: 'rgba(34,197,94,0.1)',
              border: '1px solid rgba(34,197,94,0.28)',
              borderRadius: 10,
              fontSize: '0.88rem',
            }}
          >
            <span style={{ color: '#bbf7d0' }}>
              <strong>Community &amp; Angel rounds</strong> — commit TFUEL on <strong>Theta mainnet (361)</strong>. Believer base pricing + optional lock
              bonuses; separate strategic Angel path.
            </span>
            <Link to="/believers" className="btn btn-primary btn-sm">
              Believers
            </Link>
            <Link to="/angels" className="btn btn-secondary btn-sm">
              Angels
            </Link>
            <button type="button" className="btn btn-secondary btn-sm" onClick={dismissBeliever} aria-label="Dismiss">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Hero */}
      <section style={styles.hero}>
        <div className="container" style={{ textAlign: 'center' }}>
          <div style={styles.heroBadge}>
            <span className="badge badge-orange">Beta protocol</span>
            <span style={{ color: '#8a8a9a', fontSize: '0.85rem' }}>Verifiable settlement for AI compute</span>
          </div>
          <h1 style={styles.heroTitle}>XFuel Protocol</h1>
          <p style={styles.heroSubtitle}>Route any model. Prove every dollar.</p>
          <p style={styles.heroDescription}>
            XFuel is the payments-and-proof layer for AI compute. Route inference to the best available provider — centralized, neocloud, or DePIN — settle over
            any rail (<strong>USDC via x402</strong> or <strong>TFUEL on Theta</strong>), and get a <strong>verifiable receipt</strong> for every task: a signed
            statement by default, or an <strong>on-chain SP1 proof</strong> on demand. The stack is in <strong>beta</strong>; Believer and Angel funding rounds
            are live on Theta mainnet.
          </p>
          <div style={styles.heroCta}>
            <Link to="/docs" className="btn btn-primary">
              Try the API
            </Link>
            <Link to="/theta-ai" className="btn btn-secondary">
              AI Hub
            </Link>
            <Link to="/believers" className="btn btn-secondary">
              Believer Round
            </Link>
            <Link to="/angels" className="btn btn-secondary">
              Angel Round
            </Link>
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

      {/* Roadmap strip */}
      <section style={{ padding: '2rem 0 1rem' }}>
        <div className="container">
          <h2 style={{ textAlign: 'center', marginBottom: '0.35rem' }}>Roadmap</h2>
          <p style={{ textAlign: 'center', color: '#8a8a9a', fontSize: '0.9rem', marginBottom: '1.5rem', maxWidth: 520, marginLeft: 'auto', marginRight: 'auto' }}>
            Near-term milestones toward full production on Theta and connected networks.
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: '1rem',
            }}
          >
            {roadmap.map((item) => (
              <div key={item.title} className="card" style={{ padding: '1.15rem', height: '100%' }}>
                <span className="badge badge-purple" style={{ fontSize: '0.65rem', marginBottom: '0.5rem', display: 'inline-block' }}>
                  {item.tag}
                </span>
                <h3 style={{ fontSize: '0.95rem', color: '#f0f0f5', marginBottom: '0.4rem' }}>{item.title}</h3>
                <p style={{ fontSize: '0.8rem', color: '#8a8a9a', lineHeight: 1.5, margin: 0 }}>{item.detail}</p>
              </div>
            ))}
          </div>
          <p style={{ textAlign: 'center', marginTop: '1rem' }}>
            <Link to="/security" style={{ color: '#00d4ff', fontSize: '0.88rem' }}>
              Security &amp; transparency →
            </Link>
          </p>
        </div>
      </section>

      {/* Networks */}
      <section style={{ padding: '2rem 0' }}>
        <div className="container">
          <h2 style={{ textAlign: 'center', marginBottom: '1.5rem' }}>Supported networks</h2>
          <div style={styles.networkBar}>
            {networks.map((n) => (
              <div key={n.name} style={styles.networkChip}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: networkDot(n.status),
                    display: 'inline-block',
                  }}
                />
                <span>{n.name}</span>
                <span className={networkBadgeClass(n.status)}>{n.status}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section style={{ padding: '3rem 0' }}>
        <div className="container">
          <h2 style={{ textAlign: 'center', marginBottom: '0.5rem' }}>Core infrastructure</h2>
          <p style={{ textAlign: 'center', color: '#8a8a9a', marginBottom: '2rem' }}>
            Provider-agnostic routing, verifiable receipts, and on-chain settlement — Theta-settled, with any provider underneath.
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
          <h2 style={{ textAlign: 'center', marginBottom: '2rem' }}>Protocol architecture</h2>
          <div className="grid grid-2">
            <div className="card">
              <h3 style={{ color: '#00d4ff', marginBottom: '1rem' }}>Revenue flow</h3>
              <div style={styles.flowItem}>
                <span style={styles.flowDot} />
                <div>
                  <strong>Protocol fees</strong>
                  <p style={{ fontSize: '0.85rem', color: '#8a8a9a' }}>Inference, verification, and bridge fees as deployments go live.</p>
                </div>
              </div>
              <div style={styles.flowItem}>
                <span style={{ ...styles.flowDot, background: '#8b5cf6' }} />
                <div>
                  <strong>CoreRevenueSplitter</strong>
                  <p style={{ fontSize: '0.85rem', color: '#8a8a9a' }}>30% BBB · 30% GET · 25% stakers · 15% treasury</p>
                </div>
              </div>
              <div style={styles.flowItem}>
                <span style={{ ...styles.flowDot, background: '#22c55e' }} />
                <div>
                  <strong>Cross-chain distribution</strong>
                  <p style={{ fontSize: '0.85rem', color: '#8a8a9a' }}>Hyperlane and chain-specific routes on the roadmap.</p>
                </div>
              </div>
            </div>
            <div className="card">
              <h3 style={{ color: '#8b5cf6', marginBottom: '1rem' }}>ZK verification stack</h3>
              <div style={styles.flowItem}>
                <span style={styles.flowDot} />
                <div>
                  <strong>SP1 Prover</strong>
                  <p style={{ fontSize: '0.85rem', color: '#8a8a9a' }}>Succinct SP1 for Rust-based proof generation.</p>
                </div>
              </div>
              <div style={styles.flowItem}>
                <span style={{ ...styles.flowDot, background: '#f59e0b' }} />
                <div>
                  <strong>On-chain verifier</strong>
                  <p style={{ fontSize: '0.85rem', color: '#8a8a9a' }}>ZKVerifierSP1.sol and circuit hooks (per deployment).</p>
                </div>
              </div>
              <div style={styles.flowItem}>
                <span style={{ ...styles.flowDot, background: '#ef4444' }} />
                <div>
                  <strong>CosmWasm verifier</strong>
                  <p style={{ fontSize: '0.85rem', color: '#8a8a9a' }}>Cosmos / Osmosis path (governance-dependent).</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stack */}
      <section style={{ padding: '3rem 0' }}>
        <div className="container">
          <h2 style={{ textAlign: 'center', marginBottom: '0.5rem' }}>Stack &amp; ecosystem</h2>
          <p style={{ textAlign: 'center', color: '#8a8a9a', marginBottom: '2rem' }}>
            Tools we build on today vs roadmap targets — no implied partnership unless separately announced.
          </p>
          <div className="grid grid-3">
            {stackItems.map((p) => (
              <div key={p.name} className="card" style={{ textAlign: 'center', padding: '2rem 1.5rem' }}>
                <h3>{p.name}</h3>
                <p style={{ marginBottom: '0.5rem' }}>{p.role}</p>
                <span className="badge badge-purple">{p.tag}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section style={{ padding: '4rem 0', textAlign: 'center' }}>
        <div className="container">
          <h2 style={{ marginBottom: '0.5rem' }}>Ready to fuel the future of AI?</h2>
          <p style={{ color: '#8a8a9a', marginBottom: '2rem', maxWidth: '520px', margin: '0 auto 2rem' }}>
            Join the community round on Theta mainnet, review the strategic Angel path, and follow security &amp; audit updates.
          </p>
          <div style={styles.heroCta}>
            <Link to="/believers" className="btn btn-primary">
              Believer Round
            </Link>
            <Link to="/angels" className="btn btn-secondary">
              Angel Round
            </Link>
            <Link to="/community" className="btn btn-secondary">
              Community
            </Link>
            <Link to="/security" className="btn btn-secondary">
              Security
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  hero: {
    padding: '5rem 0 3rem',
    background: 'radial-gradient(ellipse at 50% 0%, rgba(0,212,255,0.08) 0%, transparent 60%)',
  },
  heroBadge: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.75rem',
    marginBottom: '1.5rem',
  },
  heroTitle: {
    fontSize: '3.5rem',
    fontWeight: 900,
    lineHeight: 1.1,
    background: 'linear-gradient(135deg, #00d4ff 0%, #8b5cf6 50%, #00d4ff 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
    marginBottom: '0.75rem',
  },
  heroSubtitle: {
    fontSize: '1.35rem',
    color: '#8a8a9a',
    marginBottom: '1.5rem',
  },
  heroDescription: {
    fontSize: '1.05rem',
    color: '#8a8a9a',
    maxWidth: '640px',
    margin: '0 auto 2rem',
    lineHeight: 1.7,
  },
  heroCta: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '1rem',
    flexWrap: 'wrap' as const,
  },
  statsSection: { padding: '2rem 0' },
  networkBar: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '1rem',
    justifyContent: 'center',
  },
  networkChip: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.5rem 1rem',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '999px',
    fontSize: '0.9rem',
  },
  flowItem: {
    display: 'flex',
    gap: '0.75rem',
    marginBottom: '1rem',
    alignItems: 'flex-start',
  },
  flowDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: '#00d4ff',
    marginTop: '6px',
    flexShrink: 0,
  },
};
