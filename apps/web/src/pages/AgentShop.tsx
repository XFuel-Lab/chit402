import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { API_V1 } from '../apiHost';
import { getHostConfig } from '../hostConfig';

const SNIPPET = `curl -sS ${API_V1}/chat/completions \\
  -H "X-API-Key: xfuel-demo" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"xfuel/auto","messages":[{"role":"user","content":"Say hello in 5 words."}],"max_tokens":32}'`;

const FETCH = `const res = await fetch('${API_V1}/chat/completions', {
  method: 'POST',
  headers: {
    'X-API-Key': 'xfuel-demo',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'xfuel/auto',
    messages: [{ role: 'user', content: 'Say hello in 5 words.' }],
  }),
});
const data = await res.json();`;

export default function AgentShop() {
  useEffect(() => {
    const config = getHostConfig();
    document.title = `The till for an agent shop | ${config.name}`;
  }, []);

  return (
    <div className="page docs-page">
      <div className="container" style={{ maxWidth: 720 }}>
        <header className="page-header">
          <span className="docs-kicker">Agent Shop</span>
          <h1>Your SEO bot spent it. You hold the book.</h1>
          <p>
            XFuel is the till for an agent shop. POST to{' '}
            <a href={API_V1}>{API_V1}/chat/completions</a>, pay the HTTP 402 in USDC
            on Base or Solana (cost-plus, quoted, receipted), and you hold the book. We are the till, not the Chief of SEO.
            Show the client the book, not a screenshot. Demo key <code>xfuel-demo</code> is free
            (15/min, 150/day). HMAC-signed receipts are table stakes.
            Book is possession-gated <code>GET|POST /v1/agents/:agent_id/book</code>.
          </p>
        </header>

        <section className="docs-section">
          <h2>How do I set up an agent shop till in four minutes?</h2>
          <ol style={{ color: '#8a8a9a', paddingLeft: '1.2rem', lineHeight: 1.8 }}>
            <li>POST to <code>{API_V1}/chat/completions</code>.</li>
            <li>Use the demo key <code>xfuel-demo</code> to verify the connection (free, rate-limited).</li>
            <li>Switch to a wallet-backed key to pay the 402 in USDC on Base or Solana.</li>
            <li>Call <code>GET /v1/agents/:agent_id/book</code> to retrieve the spend log for your client.</li>
          </ol>
        </section>

        <section className="docs-section">
          <h2>What do I show the client instead of a screenshot?</h2>
          <p style={{ color: '#8a8a9a', lineHeight: 1.7 }}>
            The book. <code>GET|POST /v1/agents/:agent_id/book</code> returns hub, model, and amount
            for every collected receipt. The client sees exactly what the agent spent, not a
            dashboard screenshot you redacted. Possession-gated means only the session that paid
            can read the book.
          </p>
        </section>

        <section className="docs-section">
          <h2>Does XFuel replace my Grok Bot or Cursor loop?</h2>
          <p style={{ color: '#8a8a9a', lineHeight: 1.7 }}>
            No. XFuel is the till, not the agent. Keep your orchestration. Point it at
            <code> {API_V1}</code> instead of the provider directly. The receipt and the book
            are what you get—verifiable spend, not a replacement for your workflow.
          </p>
        </section>

        <section className="docs-section">
          <h2>Which models does the shop actually buy?</h2>
          <p style={{ color: '#8a8a9a', lineHeight: 1.7 }}>
            <code>GET /v1/models</code> shows the live catalog. <code>xfuel/auto</code> picks the
            best available route. We do not proxy to third-party SaaS providers on the public catalog.
          </p>
        </section>

        <section className="docs-section">
          <h2>How is the book different from a billing CSV?</h2>
          <p style={{ color: '#8a8a9a', lineHeight: 1.7 }}>
            A billing CSV is a report you export from your provider dashboard. The book is a
            possession-gated API endpoint that returns hub, model, and amount for every call your
            agent made. The receipt is HMAC-signed. The book is held by the payer, not emailed by
            the vendor.
          </p>
        </section>

        <section className="docs-section">
          <h2>How do I try the till with the demo key?</h2>
          <p style={{ color: '#8a8a9a', lineHeight: 1.7, marginBottom: '1rem' }}>
            Demo key <code>xfuel-demo</code> skips payment. 15 requests/min, 150/day per IP.
            Windows: use <code>curl.exe</code>.
          </p>
          <pre className="docs-code"><code>{SNIPPET}</code></pre>
          <p style={{ color: '#8a8a9a', margin: '1.25rem 0 0.5rem' }}>Or any chat-completions client:</p>
          <pre className="docs-code"><code>{FETCH}</code></pre>
        </section>

        <nav style={{ marginTop: '2rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <Link to="/book" className="btn btn-primary btn-sm">The book →</Link>
          <Link to="/book-bot" className="btn btn-secondary btn-sm">Book bot</Link>
          <Link to="/v1" className="btn btn-secondary btn-sm">/v1 gateway</Link>
          <Link to="/" className="btn btn-secondary btn-sm">Home</Link>
        </nav>
      </div>
    </div>
  );
}
