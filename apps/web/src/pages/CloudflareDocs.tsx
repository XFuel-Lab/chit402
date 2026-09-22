import { Link } from 'react-router-dom';
import { getApiV1 } from '../apiHost';

export default function CloudflareDocs() {
  const apiV1 = getApiV1();

  const directExample = `// Cloudflare Agent / Worker — point chat client at Chit /v1 wire
const res = await fetch('${apiV1}/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': env.CHIT_API_KEY,
  },
  body: JSON.stringify({
    model: 'xfuel/auto',
    messages: [{ role: 'user', content: prompt }],
  }),
});
// Read x-xfuel-verify-url header or body xfuel.verify_url`;

  const sidecarExample = `npm install chit402-sidecar

import { createSidecarFetch } from 'chit402-sidecar';

const fetch = createSidecarFetch({
  signingSecret: env.XFUEL_SIGNING_SECRET,
  onReceipt: (receipt) => console.log(receipt.task_id),
});`;

  const workerExample = `// Deploy @xfuel/sidecar worker for edge stamp
// packages/sidecar/worker — see README for wrangler.toml snippet
npm install chit402-sidecar`;

  return (
    <div className="page docs-page">
      <div className="container" style={{ maxWidth: 720 }}>
        <header className="page-header">
          <span className="docs-kicker">Framework</span>
          <h1>Cloudflare Agents</h1>
          <p>
            Two paths: point your Worker or Agent completions at Chit (<code>{apiV1}</code>), or run
            the sidecar to stamp receipts from any upstream. Both return hub, model, amount,{' '}
            <code>verify_url</code>.
          </p>
        </header>

        <div className="docs-panel">
          <h2>Path A — Chit baseURL (recommended)</h2>
          <p>
            Swap your Worker&apos;s compatible <code>baseURL</code> to Chit. Pay USDC on Base via
            x402. Hold the receipt — same beachhead as every other install wire.
          </p>
          <pre className="docs-code">
            <code>{directExample}</code>
          </pre>
        </div>

        <div className="docs-panel">
          <h2>Path B — Sidecar stamp</h2>
          <p>
            Keep OpenRouter, Groq, or another upstream. Wrap fetch with{' '}
            <code>createSidecarFetch</code> so every call still produces a Chit-shaped receipt.
            Ingest to the book when the principal is registered.
          </p>
          <pre className="docs-code">
            <code>{sidecarExample}</code>
          </pre>
        </div>

        <div className="docs-panel">
          <h2>Edge worker</h2>
          <p>
            <code>@xfuel/sidecar</code> ships a Cloudflare Worker proxy under{' '}
            <code>packages/sidecar/worker</code>. Public alias: <code>chit402-sidecar</code>.
          </p>
          <pre className="docs-code">
            <code>{workerExample}</code>
          </pre>
        </div>

        <div className="docs-actions">
          <Link to="/docs/framework-adapters" className="btn btn-primary btn-sm">
            Framework adapters
          </Link>
          <a
            href="https://github.com/XFuel-Lab/chit402/tree/main/packages/sidecar"
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary btn-sm"
          >
            Sidecar README
          </a>
        </div>
      </div>
    </div>
  );
}
