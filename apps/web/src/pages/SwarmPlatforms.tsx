import { Link } from 'react-router-dom';
import { getApiV1 } from '../apiHost';

const beachhead = `// Olas / Theoriq / any swarm runner — same beachhead:
// Chat-completions baseURL → Chit /v1 wire, USDC budget, hold verify_url.

const res = await fetch('${getApiV1()}/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': \`Bearer \${process.env.CHIT_API_KEY}\`,
  },
  body: JSON.stringify({
    model: 'xfuel/auto',
    messages: [{ role: 'user', content: prompt }],
  }),
});

// x-xfuel-verify-url header or body xfuel.verify_url
const receipt = res.headers.get('x-xfuel-verify-url');`;

const olasNote = `Olas operators: point your service's LLM client at api.chit402.com/v1.
Multi-hop A2A lineage can use POST /v1/agents/:id/book/ingest for foreign x402 rows
once the principal registered via POST /v1/agents/register.`;

const theoriqNote = `Theoriq swarm runners: same swap. Keep your orchestration;
Chit402 is the receipt book for inference spend — not cheaper compute.`;

export default function SwarmPlatforms() {
  return (
    <div className="page docs-page">
      <div className="container" style={{ maxWidth: 720 }}>
        <header className="page-header">
          <span className="docs-kicker">Platform</span>
          <h1>Olas + Theoriq</h1>
          <p>
            Swarm platforms get the same beachhead: chat-completions baseURL swap, USDC budget on
            Base, hold <code>verify_url</code>. No deep protocol integration required.
          </p>
        </header>

        <div className="docs-panel">
          <h2>Beachhead snippet</h2>
          <pre className="docs-code">
            <code>{beachhead}</code>
          </pre>
        </div>

        <div className="docs-panel">
          <h2>Olas</h2>
          <p>{olasNote}</p>
        </div>

        <div className="docs-panel">
          <h2>Theoriq</h2>
          <p>{theoriqNote}</p>
        </div>

        <div className="docs-actions">
          <Link to="/docs/acp" className="btn btn-primary btn-sm">
            Virtuals ACP
          </Link>
          <Link to="/docs/chit-in-15-lines" className="btn btn-secondary btn-sm">
            Drop-in door
          </Link>
        </div>
      </div>
    </div>
  );
}
