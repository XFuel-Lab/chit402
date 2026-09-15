import { Link } from 'react-router-dom';
import type { CSSProperties } from 'react';
import { getApiV1 } from '../apiHost';

const preferredPath = `// Preferred: keep ACP settle for agent commerce;
// send inference spend through Chit for the signed receipt book.

const client = new OpenAI({
  baseURL: '${getApiV1()}',
  apiKey: process.env.CHIT_API_KEY,
});

const chat = await client.chat.completions.create({
  model: 'xfuel/auto',
  messages: [{ role: 'user', content: taskPrompt }],
});

// Return verify_url to the principal — hub, model, amount on the receipt page
console.log(chat.xfuel?.verify_url);`;

const ingestExample = `// Optional: foreign x402 already settled elsewhere
// POST /v1/agents/:agent_id/book/ingest (possession-gated)

import { ingestForeignX402ToBook } from 'chit402-adapters/ingest';

await ingestForeignX402ToBook(
  {
    payment_required: { resource, amount, payTo, network: 'base' },
    payment_response: { tx, payer },
  },
  { apiKey, agentId, session },
);`;

const partnerBlock = `Design partner paste (Virtuals ACP team):

We use Chit402 as the inference receipt book — not a cheaper model router.
Point chat-completions at api.chit402.com/v1, pay USDC on Base, hold verify_url.
ACP can keep its own settle path; Chit stamps hub/model/amount for finance.
Register once (POST /v1/agents/register) to hold the possession-gated book.`;

export default function AcpDocs() {
  return (
    <div className="page docs-page">
      <div className="container" style={{ maxWidth: 720 }}>
        <header className="page-header">
          <span className="docs-kicker">Platform</span>
          <h1>Virtuals ACP</h1>
          <p>
            Agents keep ACP for agent commerce. Send inference spend through Chit for the signed
            receipt — hub, model, amount, <code>verify_url</code>. No fork of ACP required.
          </p>
        </header>

        <div className="docs-panel">
          <h2>Preferred path</h2>
          <p>
            Swap the OpenAI-compatible completions client to Chit. ACP handles agent-to-agent
            settlement; Chit handles the inference receipt the principal can audit.
          </p>
          <pre className="docs-code">
            <code>{preferredPath}</code>
          </pre>
        </div>

        <div className="docs-panel">
          <h2>Optional — foreign x402 ingest</h2>
          <p>
            If inference already paid another x402 shop, a registered principal can ingest the
            foreign payment to their book via{' '}
            <code>POST /v1/agents/:agent_id/book/ingest</code>.
          </p>
          <pre className="docs-code">
            <code>{ingestExample}</code>
          </pre>
        </div>

        <div className="docs-panel">
          <h2>Design-partner block</h2>
          <pre className="docs-code">
            <code>{partnerBlock}</code>
          </pre>
        </div>

        <div className="docs-actions">
          <Link to="/docs/framework-adapters" className="btn btn-primary btn-sm">
            Framework adapters
          </Link>
          <Link to="/register" className="btn btn-secondary btn-sm">
            Register agent
          </Link>
          <a
            href="https://github.com/XFuel-Lab/chit402/blob/main/docs/doors/acp-stamp-path.md"
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary btn-sm"
          >
            ACP stamp path (repo)
          </a>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {};
