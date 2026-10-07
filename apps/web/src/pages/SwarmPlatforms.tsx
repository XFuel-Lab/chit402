import { Link } from 'react-router-dom';
import { getApiV1 } from '../apiHost';
import PaidDoorOptions from '../components/PaidDoorOptions';

const partnerBearer = `// Partner key, Authorization header. Same call as the block above.
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

const receipt = res.headers.get('x-xfuel-verify-url');`;

const olasNote = `Olas operators: point your service's LLM client at api.chit402.com/v1.
Multi-hop A2A lineage can use POST /v1/agents/:id/book/ingest for foreign x402 rows
once the principal registered via POST /v1/agents/register.`;

const theoriqNote = `Theoriq swarm runners: same swap. Keep your orchestration;
Chit402 is the receipt book for inference spend — not cheaper compute.`;

export default function SwarmPlatforms() {
  const apiV1 = getApiV1();
  return (
    <div className="page docs-page">
      <div className="container" style={{ maxWidth: 720 }}>
        <header className="page-header">
          <span className="docs-kicker">Platform</span>
          <h1>Olas + Theoriq</h1>
          <p>
            Same two options as every other door. Keyless x402 first. A partner key still works.
            Hold <code>verify_url</code>. No deep protocol integration required. /docs/olas and
            /docs/theoriq are this page.
          </p>
        </header>

        <div className="docs-panel">
          <h2>Beachhead snippet</h2>
          <PaidDoorOptions apiV1={apiV1} />
          <h3 style={{ fontSize: '1rem', margin: '1.25rem 0 0.5rem' }}>Partner key, Authorization header</h3>
          <pre className="docs-code">
            <code>{partnerBearer}</code>
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
