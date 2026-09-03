import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getApiV1 } from '../apiHost';
import { getHostConfig } from '../hostConfig';

function getSnippet(apiV1: string) {
  return `curl -sS ${apiV1}/chat/completions \\
  -H "X-API-Key: xfuel-demo" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"xfuel/auto","messages":[{"role":"user","content":"Say hello in 5 words."}],"max_tokens":32}'`;
}

function getFetch(apiV1: string) {
  return `const res = await fetch('${apiV1}/chat/completions', {
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
}

export default function GatewayV1() {
  const config = getHostConfig();
  const apiV1 = getApiV1();
  const apiDomain = config.apiDomain;
  const siteDomain = config.domain;
  const SNIPPET = getSnippet(apiV1);
  const FETCH = getFetch(apiV1);
  
  useEffect(() => {
    document.title = `Pay /v1/chat/completions | ${config.name}`;
  }, [config.name]);

  return (
    <div className="page docs-page">
      <div className="container" style={{ maxWidth: 720 }}>
        <header className="page-header">
          <span className="docs-kicker">/v1</span>
          <h1>Bot drop-in. Wallet pays. You hold the book.</h1>
          <p>
            Exact product: baseURL <a href={apiV1}>{apiV1}</a>.
            Steal engineers pointing at Agent402 / tx402 / qntx (llm.qntx.fun) by being the named host.
          </p>
        </header>

        <section className="docs-section">
          <h2>What is the exact baseURL for /v1/chat/completions?</h2>
          <p style={{ color: '#8a8a9a', lineHeight: 1.7 }}>
            <code>{apiV1}</code>. Point any chat-completions client at this baseURL. The endpoint is{' '}
            <code>{apiV1}/chat/completions</code>. This is{' '}
            <code>{apiDomain}</code>, not <code>{siteDomain}</code>. The site you are reading
            is the docs. The gateway is <code>{apiDomain}</code>.
          </p>
        </section>

        <section className="docs-section">
          <h2>How does HTTP 402 / x402 work on {apiDomain}?</h2>
          <p style={{ color: '#8a8a9a', lineHeight: 1.7 }}>
            POST <code>/v1/chat/completions</code> is cost-plus, quoted, receipted — USDC on Base and Solana. Without
            payment or a demo key, the gateway returns HTTP 402 Payment Required. Pay the 402
            with a wallet that holds USDC on Base or Solana. Demo key <code>xfuel-demo</code>{' '}
            skips payment (15/min, 150/day per IP). Paying this host moves real mainnet USDC.
          </p>
        </section>

        <section className="docs-section">
          <h2>How do I call /v1/chat/completions?</h2>
          <p style={{ color: '#8a8a9a', lineHeight: 1.7, marginBottom: '1rem' }}>
            POST to <code>{apiV1}/chat/completions</code> with your key or{' '}
            <code>xfuel-demo</code>. Any HTTP client or bot framework works.
          </p>
          <pre className="docs-code"><code>{FETCH}</code></pre>
        </section>

        <section className="docs-section">
          <h2>Which models can I pass today?</h2>
          <p style={{ color: '#8a8a9a', lineHeight: 1.7 }}>
            <code>GET /v1/models</code> shows the live catalog. <code>xfuel/auto</code> picks the
            best available route. We do not proxy to third-party SaaS providers on the public catalog.
          </p>
        </section>

        <section className="docs-section">
          <h2>What do I get back besides tokens?</h2>
          <p style={{ color: '#8a8a9a', lineHeight: 1.7 }}>
            An HMAC-signed receipt naming the hub, the model, and the amount. The receipt attests
            settlement and output hash. After paid calls, the book is available at{' '}
            <code>GET|POST /v1/agents/:agent_id/book</code>—possession-gated spend log of hub,
            model, and amount.
          </p>
        </section>

        <section className="docs-section">
          <h2>What is the difference between xfuel-demo and a paid call?</h2>
          <p style={{ color: '#8a8a9a', lineHeight: 1.7 }}>
            Demo key <code>xfuel-demo</code> skips payment and is rate-limited (15/min, 150/day).
            Demo never writes to the book. Paid calls collect USDC, return a signed receipt,
            and record the spend in the possession-gated book.
          </p>
        </section>

        <section className="docs-section" style={{ marginTop: '2rem' }}>
          <h2>Try the demo</h2>
          <p style={{ color: '#8a8a9a', lineHeight: 1.7, marginBottom: '1rem' }}>
            Demo key <code>xfuel-demo</code> — 15 requests/min, 150/day per IP. Windows: use{' '}
            <code>curl.exe</code>.
          </p>
          <pre className="docs-code"><code>{SNIPPET}</code></pre>
        </section>

        <nav style={{ marginTop: '2rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <Link to="/book" className="btn btn-primary btn-sm">The book →</Link>
          <Link to="/agent-shop" className="btn btn-secondary btn-sm">Agent shop</Link>
          <Link to="/" className="btn btn-secondary btn-sm">Home</Link>
        </nav>
      </div>
    </div>
  );
}
