import { Link } from 'react-router-dom';
import { getApiV1 } from '../apiHost';
import PaidDoorOptions from '../components/PaidDoorOptions';

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

  const workerExample = `// Worker source: packages/sidecar/worker in the Chit402 repo
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
          <h2>Path A — Chit baseURL</h2>
          <p>
            Point the Worker at <code>{apiV1}</code>. Keyless x402 first. A partner key still works.
          </p>
          <PaidDoorOptions apiV1={apiV1} />
          <h3 style={{ fontSize: '1rem', margin: '1.25rem 0 0.5rem' }}>Partner key from Worker env</h3>
          <pre className="docs-code">
            <code>{directExample}</code>
          </pre>
        </div>

        <div className="docs-panel">
          <h2>Path B — Sidecar stamp</h2>
          <p>
            Keep the provider you already pay. Wrap fetch with <code>createSidecarFetch</code> from{' '}
            <code>chit402-sidecar</code>. Without a collected USDC <code>payment.ref</code>, that
            receipt is client-attested. Ingest to the book when the principal is registered.
          </p>
          <pre className="docs-code">
            <code>{sidecarExample}</code>
          </pre>
        </div>

        <div className="docs-panel">
          <h2>Edge worker</h2>
          <p>
            The Worker proxy lives at <code>packages/sidecar/worker</code> in the repo. Install{' '}
            <code>chit402-sidecar</code>.
          </p>
          <pre className="docs-code">
            <code>{workerExample}</code>
          </pre>
        </div>

        <div className="docs-panel">
          <h2>Monetization Gateway</h2>
          <p>
            Paying someone else&apos;s Cloudflare-gated API is a different door. Read{' '}
            <code>PAYMENT-RESPONSE</code> and stamp a <code>foreign_ingest</code> receipt.
            Chit does not settle that call.
          </p>
        </div>

        <div className="docs-actions">
          <Link to="/docs/cloudflare-x402" className="btn btn-primary btn-sm">
            Monetization Gateway receipts
          </Link>
          <Link to="/docs/framework-adapters" className="btn btn-secondary btn-sm">
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
