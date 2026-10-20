import { Link } from 'react-router-dom';
import { type CSSProperties } from 'react';
import { API_V1 } from '../apiHost';

const SNIPPET = `curl -sS -D - ${API_V1}/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{}'
# → HTTP 402 + PAYMENT-REQUIRED`;

const FETCH = `const res = await fetch('${API_V1}/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'xfuel/auto',
    messages: [{ role: 'user', content: 'Say hello in 5 words.' }],
  }),
});
// 402 until X-PAYMENT / x402 settle — use chit402-sdk or wallet payer`;

const HERO_RECEIPT_URL = 'https://api.chit402.com/receipt/xfuel-3155b7d8-4315-44bc-bfdc-bf6b78ff2d15'

export default function Home() {
  return (
    <div className="page">
      <section style={styles.hero}>
        <div className="container" style={{ textAlign: 'center' }}>
          <div style={styles.heroBadge}>
            <span className="badge badge-cyan">Live paid</span>
            <span style={{ color: '#8a8a9a', fontSize: '0.85rem' }}>USDC receipts on Base</span>
          </div>
          <h1 style={styles.heroTitle}>Your agents spent $400 this week. On what, and with whom?</h1>
          <p style={styles.heroSubtitle}>
            Chit puts a receipt on every payment and keeps it in your book, not theirs. Open it any time and check each line. $0.002 a receipt.
          </p>
          <p style={styles.heroDescription}>
            No account, no API key. A wallet that can pay is enough.
          </p>
          <div style={styles.heroCta}>
            <a href={HERO_RECEIPT_URL} className="btn btn-primary">See what your agent spent</a>
            <Link to="/v1" className="btn btn-secondary">Try /v1</Link>
            <Link to="/pricing" className="btn btn-secondary">Pricing</Link>
            <Link to="/book-bot" className="btn btn-secondary">Book bot</Link>
            <a href="https://github.com/XFuel-Lab/xfuel-protocol" className="btn btn-secondary" target="_blank" rel="noreferrer">
              GitHub
            </a>
          </div>
        </div>
      </section>

      <section id="try" style={{ padding: '1rem 0 3rem' }}>
        <div className="container" style={{ maxWidth: 720 }}>
          <h2 style={{ marginBottom: '0.75rem' }}>Try it</h2>
          <p style={{ color: '#8a8a9a', marginBottom: '1rem' }}>
            Unauthenticated calls return HTTP 402. Windows: use <code>curl.exe</code>.
          </p>
          <pre className="docs-code"><code>{SNIPPET}</code></pre>
          <p style={{ color: '#8a8a9a', margin: '1.25rem 0 0.5rem' }}>Or any chat-completions client:</p>
          <pre className="docs-code"><code>{FETCH}</code></pre>
        </div>
      </section>

      <section style={{ padding: '0 0 2rem' }}>
        <div className="container" style={{ maxWidth: 720 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <Link to="/agent-shop" style={styles.moneyLink}>
              <span style={styles.moneyLinkTitle}>Your SEO bot spent it. You hold the book.</span>
              <span style={styles.moneyLinkMeta}>/agent-shop</span>
            </Link>
            <Link to="/book" style={styles.moneyLink}>
              <span style={styles.moneyLinkTitle}>Which agent paid for this job, and how much?</span>
              <span style={styles.moneyLinkMeta}>/book</span>
            </Link>
            <Link to="/v1" style={styles.moneyLink}>
              <span style={styles.moneyLinkTitle}>Bot drop-in. Wallet pays. You hold the book.</span>
              <span style={styles.moneyLinkMeta}>/v1</span>
            </Link>
          </div>
        </div>
      </section>

      <section style={{ padding: '0 0 3rem' }}>
        <div className="container">
          <div className="grid grid-3">
            <div className="card">
              <h3>POST /v1/chat/completions</h3>
              <p>USDC on Base and Solana. Signed receipt with verify_url. HTTP 402 without payment.</p>
            </div>
            <div className="card">
              <h3>Paid /task-request</h3>
              <p>USDC via x402 on Base mainnet. HTTP 402 without payment. Do not use a mock payer on this host.</p>
            </div>
            <div className="card">
              <h3>GET|POST /v1/agents/:agent_id/book</h3>
              <p>Who paid, which model ran, and what did it cost? Every paid call lands in your book. Only you can open it (register session or HMAC). It is not a public index.</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  hero: {
    padding: '4.5rem 0 2rem',
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
    fontSize: '3.25rem',
    fontWeight: 800,
    lineHeight: 1.1,
    marginBottom: '0.75rem',
  },
  heroSubtitle: {
    fontSize: '1.25rem',
    color: '#c4c4d4',
    marginBottom: '1.25rem',
    maxWidth: 640,
    marginLeft: 'auto',
    marginRight: 'auto',
  },
  heroDescription: {
    fontSize: '1.02rem',
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
  moneyLink: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '1rem 1.25rem',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '8px',
    textDecoration: 'none',
    transition: 'all 0.2s',
  },
  moneyLinkTitle: {
    color: '#f0f0f5',
    fontWeight: 500,
    fontSize: '1rem',
  },
  moneyLinkMeta: {
    color: '#00d4ff',
    fontSize: '0.85rem',
    fontFamily: 'var(--font-mono)',
  },
};
