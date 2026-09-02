import { type CSSProperties } from 'react';
import { getHostConfig } from '../hostConfig';

const BANKR_RECEIPT = 'https://api.xfuel.app/receipt/xfuel-1e57cdd7-4fde-4525-bea3-5ffd1d1d909e';
const API_ENDPOINT = 'https://api.xfuel.app/v1';

export default function ChitHome() {
  const config = getHostConfig();

  return (
    <div className="page">
      <section style={styles.hero}>
        <div className="container" style={{ textAlign: 'center' }}>
          <div style={styles.heroBadge}>
            <span className="badge badge-cyan">By {config.parent}</span>
          </div>
          <h1 style={styles.heroTitle}>Chit</h1>
          <p style={styles.heroSubtitle}>
            The chit x402 doesn't leave you.
          </p>
          <p style={styles.heroLead}>
            A receipt you still hold if the agent wallet moves.
          </p>
          <p style={styles.heroDescription}>
            Hub, model, amount — you hold the book.
            <code>POST /v1/chat/completions</code> returns a signed receipt.
            Cost-plus, quoted, receipted — USDC on Base and Solana.
            The wire is <code>api.xfuel.app/v1</code>.
          </p>
          <div style={styles.heroCta}>
            <a
              href={BANKR_RECEIPT}
              className="btn btn-primary"
              target="_blank"
              rel="noreferrer"
            >
              View a live receipt (Bankr)
            </a>
            <a
              href={API_ENDPOINT}
              className="btn btn-secondary"
              target="_blank"
              rel="noreferrer"
            >
              Point your bot at the wire
            </a>
            <a
              href={config.githubUrl}
              className="btn btn-secondary"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
          </div>
        </div>
      </section>

      <section style={{ padding: '3rem 0' }}>
        <div className="container" style={{ maxWidth: 720 }}>
          <h2 style={{ marginBottom: '1.5rem', textAlign: 'center' }}>The receipt stays with you</h2>
          <div className="grid grid-3" style={{ gap: '1.5rem' }}>
            <div className="card">
              <h3>Signed receipt</h3>
              <p>Every call returns a signed receipt with hub, model, amount, and verify_url. You hold the proof.</p>
            </div>
            <div className="card">
              <h3>Portable</h3>
              <p>The receipt doesn't live in the agent's wallet. It lives with you. Move wallets, keep receipts.</p>
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
            Chit is the product. <strong style={{ color: '#f0f0f5' }}>{config.parent}</strong> is the parent.
            <br />
            The wire is <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9em' }}>api.xfuel.app/v1</code> — unchanged.
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
  heroSubtitle: {
    fontSize: '1.5rem',
    color: '#c4c4d4',
    marginBottom: '0.5rem',
    maxWidth: 640,
    marginLeft: 'auto',
    marginRight: 'auto',
  },
  heroLead: {
    fontSize: '1.15rem',
    color: '#00d4ff',
    marginBottom: '1.5rem',
    fontWeight: 500,
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
