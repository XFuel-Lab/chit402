import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { getHostConfig } from '../hostConfig';

const LIVE_RECEIPT =
  'https://api.chit402.com/receipt/chit-1e57cdd7-4fde-4525-bea3-5ffd1d1d909e';

export default function ChitHome() {
  const config = getHostConfig();

  return (
    <div className="page">
      <section style={styles.hero}>
        <div className="container" style={{ textAlign: 'center' }}>
          <div style={styles.heroBadge}>
            <span className="badge badge-cyan">By {config.parent}</span>
          </div>
          <h1 style={styles.heroTitle}>Chit402</h1>
          <p style={styles.heroLead}>
            Who paid which call — export, policy, evidence.
          </p>
          <p style={styles.heroDescription}>
            Treasury desk and possession book for agent spend — not a router dashboard.
            Every collected call returns hub, model, amount, and a public{' '}
            <code>verify_url</code> you can export, policy, and evidence-pack.
            Cost-plus, quoted, receipted — USDC on Base and Solana.
          </p>
          <div style={styles.heroCta}>
            <Link to="/book" className="btn btn-primary">
              Open the book
            </Link>
            <a
              href={LIVE_RECEIPT}
              className="btn btn-primary"
              target="_blank"
              rel="noreferrer"
            >
              View live receipt
            </a>
            <Link to="/docs" className="btn btn-primary">
              Docs
            </Link>
            <Link to="/register" className="btn btn-secondary">
              Register agent
            </Link>
          </div>
        </div>
      </section>

      <section style={{ padding: '2rem 0' }}>
        <div className="container" style={{ maxWidth: 720 }}>
          <h2 style={{ marginBottom: '0.5rem', textAlign: 'center', fontSize: '1.25rem' }}>
            Install paths
          </h2>
          <p
            style={{
              textAlign: 'center',
              color: '#8a8a9a',
              fontSize: '0.95rem',
              marginBottom: '1.25rem',
              lineHeight: 1.6,
            }}
          >
            Same possession book — pick a door. OpenAI-compatible wire:{' '}
            <code>api.chit402.com/v1</code>.
          </p>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.75rem',
              justifyContent: 'center',
            }}
          >
            <Link to="/docs/chit-in-15-lines" className="btn btn-secondary btn-sm">
              Drop-in door
            </Link>
            <Link to="/docs/eliza" className="btn btn-secondary btn-sm">
              Eliza plugin
            </Link>
            <Link to="/docs/framework-adapters" className="btn btn-secondary btn-sm">
              Framework adapters
            </Link>
            <Link to="/docs/cloudflare" className="btn btn-secondary btn-sm">
              Cloudflare
            </Link>
            <Link to="/docs/acp" className="btn btn-secondary btn-sm">
              Virtuals ACP
            </Link>
            <Link to="/docs/openclaw" className="btn btn-secondary btn-sm">
              OpenClaw
            </Link>
            <Link to="/docs/swarm-platforms" className="btn btn-secondary btn-sm">
              Olas + Theoriq
            </Link>
          </div>
        </div>
      </section>

      <section style={{ padding: '1rem 0 3rem' }}>
        <div className="container" style={{ maxWidth: 720 }}>
          <h2 style={{ marginBottom: '1.5rem', textAlign: 'center' }}>The receipt stays with you</h2>
          <div className="grid grid-3" style={{ gap: '1.5rem' }}>
            <div className="card">
              <h3>Signed receipt</h3>
              <p>Every call returns hub, model, amount, and verify_url. You hold the proof — not the agent wallet.</p>
            </div>
            <div className="card">
              <h3>Portable</h3>
              <p>Move wallets, keep receipts. The book is possession-gated after a collected USDC payment.</p>
            </div>
            <div className="card">
              <h3>Cost-plus</h3>
              <p>Quoted before the call. Receipted after. USDC on Base and Solana. No surprises.</p>
            </div>
          </div>
        </div>
      </section>

      <section style={{ padding: '2rem 0 4rem' }}>
        <div className="container" style={{ maxWidth: 720, textAlign: 'center' }}>
          <p style={{ color: '#8a8a9a', fontSize: '0.95rem' }}>
            Chit402 is the product. <strong style={{ color: '#f0f0f5' }}>{config.parent}</strong> is the parent.
            {' '}
            <a
              href={config.githubUrl}
              target="_blank"
              rel="noreferrer"
              style={{ color: '#00d4ff' }}
            >
              GitHub
            </a>
            {' · '}
            <Link to="/trust" style={{ color: '#00d4ff' }}>
              Trust
            </Link>
            {' · '}
            <Link to="/activity" style={{ color: '#00d4ff' }}>
              Activity
            </Link>
          </p>
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
    fontSize: '4rem',
    fontWeight: 800,
    lineHeight: 1.1,
    marginBottom: '0.5rem',
  },
  heroLead: {
    fontSize: '1.35rem',
    color: '#f0f0f5',
    marginBottom: '1.25rem',
    fontWeight: 600,
    maxWidth: 640,
    marginLeft: 'auto',
    marginRight: 'auto',
    lineHeight: 1.4,
  },
  heroDescription: {
    fontSize: '1rem',
    color: '#8a8a9a',
    maxWidth: 640,
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
};
