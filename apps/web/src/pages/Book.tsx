import { Link } from 'react-router-dom';
import { API_V1 } from '../apiHost';

const SNIPPET = `curl -sS ${API_V1}/chat/completions \\
  -H "X-API-Key: xfuel-demo" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"xfuel/auto","messages":[{"role":"user","content":"Say hello in 5 words."}],"max_tokens":32}'`;

export default function Book() {
  return (
    <div className="page docs-page">
      <div className="container" style={{ maxWidth: 720 }}>
        <header className="page-header">
          <span className="docs-kicker">The Book</span>
          <h1>This agent spent Y on this job.</h1>
          <p>
            XFuel is the book. Differentiator vs Hive / ComputeSeal / Paid.ai: a held book of
            hub + model + amount after collected USDC, not a FinOps CSV. Demo never writes the
            book. SP1 on demand, not every call. Receipt attests settlement and output hash,
            not black-box correctness.
          </p>
        </header>

        <section className="docs-section">
          <h2>What is the XFuel book?</h2>
          <p style={{ color: '#8a8a9a', lineHeight: 1.7 }}>
            The book is the last-N collected spend for an agent session. Each entry records the
            hub, the model, and the amount in USDC. The payer holds the book—no dashboard export,
            no vendor report. Possession-gated means only the session that paid can read it.
          </p>
        </section>

        <section className="docs-section">
          <h2>How do I hold GET|POST /v1/agents/:agent_id/book?</h2>
          <p style={{ color: '#8a8a9a', lineHeight: 1.7 }}>
            After a paid call, retrieve the book with <code>GET /v1/agents/:agent_id/book</code>{' '}
            using the same session credentials that paid the 402. The response is the spend log:
            hub, model, amount for each collected receipt. <code>POST</code> allows filtered
            queries on the same data.
          </p>
        </section>

        <section className="docs-section">
          <h2>How is the book different from Hive, ComputeSeal, or Paid.ai?</h2>
          <p style={{ color: '#8a8a9a', lineHeight: 1.7 }}>
            Hive, ComputeSeal, and Paid.ai export a FinOps CSV or billing dashboard. XFuel
            returns a possession-gated API endpoint where you hold the book—hub, model, amount—
            after USDC is collected. The book is held, not mailed. The receipt is HMAC-signed.
          </p>
        </section>

        <section className="docs-section">
          <h2>What does an HMAC-signed receipt prove?</h2>
          <p style={{ color: '#8a8a9a', lineHeight: 1.7 }}>
            The receipt attests settlement and output hash. It proves the gateway collected USDC
            and the output you received matches the hash in the receipt. It does not attest
            black-box correctness of the model. SP1 proofs are on demand, not every call.
          </p>
        </section>

        <section className="docs-section">
          <h2>What never appears in the book?</h2>
          <p style={{ color: '#8a8a9a', lineHeight: 1.7 }}>
            Demo calls. The demo key <code>xfuel-demo</code> skips payment and never writes to
            the book. Only paid calls—USDC collected via HTTP 402—appear in the book.
          </p>
        </section>

        <section className="docs-section">
          <h2>What if I call the book without possession?</h2>
          <p style={{ color: '#8a8a9a', lineHeight: 1.7 }}>
            You get nothing. The book is possession-gated. If you did not pay, you do not hold
            the book. There is no public index of agent spend. No admin endpoint. No vendor
            export.
          </p>
        </section>

        <section className="docs-section" style={{ marginTop: '2rem' }}>
          <h2>Try the demo</h2>
          <p style={{ color: '#8a8a9a', lineHeight: 1.7, marginBottom: '1rem' }}>
            Demo key <code>xfuel-demo</code> skips payment (15/min, 150/day). Demo never writes
            the book. Windows: use <code>curl.exe</code>.
          </p>
          <pre className="docs-code"><code>{SNIPPET}</code></pre>
        </section>

        <nav style={{ marginTop: '2rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <Link to="/v1" className="btn btn-primary btn-sm">/v1 gateway →</Link>
          <Link to="/agent-shop" className="btn btn-secondary btn-sm">Agent shop</Link>
          <Link to="/" className="btn btn-secondary btn-sm">Home</Link>
        </nav>
      </div>
    </div>
  );
}
