import { Link } from 'react-router-dom';
import { type CSSProperties } from 'react';
import { API_V1 } from '../apiHost';

const SNIPPET = `curl -sS ${API_V1}/chat/completions \\
  -H "X-API-Key: xfuel-demo" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"xfuel/auto","messages":[{"role":"user","content":"Say hello in 5 words."}],"max_tokens":32}'`;

const OPENAI = `import OpenAI from 'openai';
const client = new OpenAI({
  apiKey: 'xfuel-demo',
  baseURL: '${API_V1}',
});`;

export default function Home() {
  return (
    <div className="page">
      <section style={styles.hero}>
        <div className="container" style={{ textAlign: 'center' }}>
          <div style={styles.heroBadge}>
            <span className="badge badge-cyan">Public demo</span>
            <span style={{ color: '#8a8a9a', fontSize: '0.85rem' }}>Theta + Akash · Base receipts</span>
          </div>
          <h1 style={styles.heroTitle}>XFuel is the book.</h1>
          <p style={styles.heroSubtitle}>
            This agent spent Y on this job. You hold hub, model, and amount.
            Not a smart router. Not a model shop.
          </p>
          <p style={styles.heroDescription}>
            <code>POST /v1/chat/completions</code> is $0.01 USDC on Base and Solana.
            Signed receipt (HMAC) is table stakes — we have it too.
            <code>GET|POST /v1/agents/:agent_id/book</code> is possession-gated last-N collected spend.
            Demo key <code>xfuel-demo</code> skips payment (rate-limited). On-chain SP1 proof on demand — not on every call.
            Live routes today are <strong>Theta</strong> and <strong>Akash</strong>, plus the <code>xfuel/auto</code> alias.
            We do not route to OpenAI, Groq, Together, or Fireworks on the public catalog.
          </p>
          <div style={styles.heroCta}>
            <Link to="/v1" className="btn btn-primary">Try /v1</Link>
            <Link to="/pricing" className="btn btn-secondary">Pricing</Link>
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
            Demo key <code>xfuel-demo</code> — 15 requests/min, 150/day per IP. Windows: use <code>curl.exe</code>.
          </p>
          <pre className="docs-code"><code>{SNIPPET}</code></pre>
          <p style={{ color: '#8a8a9a', margin: '1.25rem 0 0.5rem' }}>Or any OpenAI client:</p>
          <pre className="docs-code"><code>{OPENAI}</code></pre>
        </div>
      </section>

      <section style={{ padding: '0 0 3rem' }}>
        <div className="container">
          <div className="grid grid-3">
            <div className="card">
              <h3>POST /v1/chat/completions</h3>
              <p>$0.01 USDC on Base and Solana. Signed receipt. HTTP 402 without payment. Demo key <code>xfuel-demo</code> skips the charge.</p>
            </div>
            <div className="card">
              <h3>Paid /task-request</h3>
              <p>USDC via x402 on Base mainnet. HTTP 402 without payment. Do not use a mock payer on this host.</p>
            </div>
            <div className="card">
              <h3>GET|POST /v1/agents/:agent_id/book</h3>
              <p>This agent spent Y on this job. You hold hub, model, and amount. Possession-gated (register session or HMAC). Not a public index. Signed receipt is table stakes.</p>
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
};
