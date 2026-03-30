import { Link } from 'react-router-dom';
import { useEffect, useState, type CSSProperties } from 'react';

const BELIEVER_DISMISS_KEY = 'xfuel-believer-chip-dismissed';

const stats = [
  { value: '21+', label: 'Circuit modules (repo)' },
  { value: '700+', label: 'Tests passing (repo)' },
  { value: '5', label: 'Network targets' },
  { value: 'Goal', label: 'TVL at scale (roadmap)' },
];

const features = [
  {
    title: 'Cross-Chain Bridge',
    description:
      'Hyperlane-oriented bridge design with SP1 ZK verification; Theta testnet is the primary integration surface today.',
    icon: '⟷',
    link: '/bridge',
    color: '#00d4ff',
  },
  {
    title: 'veXF Governance',
    description: 'Vote-escrow style governance (deploy when live). Parameters and timelines are roadmap.',
    icon: '⚖',
    link: '/governance',
    color: '#8b5cf6',
  },
  {
    title: 'Fee-to-Stake',
    description: 'Fee routing toward staking / DePIN targets (Bittensor, Theta, Cosmos paths — roadmap).',
    icon: '◈',
    link: '/staking',
    color: '#22c55e',
  },
  {
    title: 'ZK Circuits',
    description: 'Many circuit modules in-repo; deployment mix is testnet / roadmap — see Circuit Explorer labels.',
    icon: '⬡',
    link: '/circuits',
    color: '#f59e0b',
  },
  {
    title: 'DePIN Infrastructure',
    description: 'AI listener, M2M API, and routing stack — run against your env for live metrics.',
    icon: '◉',
    link: '/dashboard',
    color: '#ef4444',
  },
  {
    title: 'Stack & tools',
    description: 'Succinct SP1, Hyperlane, Theta. Other integrations (e.g. oracles, agent platforms) are roadmap unless wired.',
    icon: '◎',
    link: '/docs',
    color: '#06b6d4',
  },
];

const stackItems = [
  { name: 'Succinct', role: 'SP1 proving stack', tag: 'in use' },
  { name: 'Hyperlane', role: 'Interchain messaging', tag: 'in use' },
  { name: 'Theta Network', role: 'Primary chain / EdgeCloud', tag: 'in use' },
  { name: 'Chainlink CCIP', role: 'Oracle / messaging (roadmap)', tag: 'roadmap' },
  { name: 'Almanak', role: 'Agent orchestration (exploring)', tag: 'roadmap' },
  { name: 'Bittensor', role: 'Decentralized AI (EVM subnet)', tag: 'ecosystem' },
];

const networks = [
  { name: 'Theta', status: 'testnet' },
  { name: 'Bittensor EVM', status: 'testnet' },
  { name: 'Osmosis', status: 'roadmap' },
  { name: 'Aptos', status: 'planned' },
  { name: 'Sui', status: 'planned' },
];

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
              background: 'rgba(0,212,255,0.08)',
              border: '1px solid rgba(0,212,255,0.22)',
              borderRadius: 10,
              fontSize: '0.88rem',
            }}
          >
            <span style={{ color: '#a5f3fc' }}>
              <strong>Early Believer Round</strong> — TFUEL → XF (Theta testnet). 5 XF/TFUEL base + optional lock bonuses.
            </span>
            <Link to="/believers" className="btn btn-primary btn-sm">
              View Believers
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
            <span className="badge badge-orange">Beta · testnet</span>
            <span style={{ color: '#8a8a9a', fontSize: '0.85rem' }}>AI + ZK settlement stack</span>
          </div>
          <h1 style={styles.heroTitle}>XFuel Protocol</h1>
          <p style={styles.heroSubtitle}>ZK-backed AI compute &amp; DePIN orchestration</p>
          <p style={styles.heroDescription}>
            Ecosystem-agnostic infrastructure: SP1 proofs, veXF-style governance, and cross-chain settlement — iterate on
            Theta testnet first; mainnet is roadmap.
          </p>
          <div style={styles.heroCta}>
            <Link to="/theta-ai" className="btn btn-primary">
              AI Hub
            </Link>
            <Link to="/believers" className="btn btn-secondary">
              Believer Round
            </Link>
            <Link to="/angels" className="btn btn-secondary">
              Angel Round
            </Link>
            <Link to="/dashboard" className="btn btn-secondary">
              Dashboard
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
                    background:
                      n.status === 'testnet' ? '#f59e0b' : n.status === 'roadmap' ? '#8b5cf6' : '#55556a',
                    display: 'inline-block',
                  }}
                />
                <span>{n.name}</span>
                <span
                  className={`badge badge-${n.status === 'testnet' ? 'orange' : n.status === 'roadmap' ? 'purple' : 'purple'}`}
                >
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
          <h2 style={{ textAlign: 'center', marginBottom: '0.5rem' }}>Core infrastructure</h2>
          <p style={{ textAlign: 'center', color: '#8a8a9a', marginBottom: '2rem' }}>
            Verification, routing, and governance — scope matches what you deploy and wire in your environment.
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
                  <p style={{ fontSize: '0.85rem', color: '#8a8a9a' }}>Inference, verification, and bridge fees (when live).</p>
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
                  <p style={{ fontSize: '0.85rem', color: '#8a8a9a' }}>Hyperlane and chain-specific routes (roadmap).</p>
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
          <p style={{ color: '#8a8a9a', marginBottom: '2rem', maxWidth: '500px', margin: '0 auto 2rem' }}>
            Explore the believer round, bridge (when deployed), and community channels.
          </p>
          <div style={styles.heroCta}>
            <Link to="/believers" className="btn btn-primary">
              Believer Round
            </Link>
            <Link to="/bridge" className="btn btn-secondary">
              Bridge
            </Link>
            <Link to="/community" className="btn btn-secondary">
              Community
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
