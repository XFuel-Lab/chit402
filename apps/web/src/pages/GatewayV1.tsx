import { Link } from 'react-router-dom';
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

export default function GatewayV1() {
  return (
    <div className="page docs-page">
      <div className="container" style={{ maxWidth: 720 }}>
        <header className="page-header">
          <span className="docs-kicker">Not the API</span>
          <h1>This is xfuel.app, not the gateway</h1>
          <p>
            The OpenAI-compatible API lives at{' '}
            <a href={API_V1}>{API_V1}</a>.
            Point your client there. This site is the docs table.{' '}
            <code>api-testnet.xfuel.app</code> is the same box.
          </p>
        </header>

        <pre className="docs-code"><code>{SNIPPET}</code></pre>
        <p style={{ color: '#8a8a9a', margin: '1.25rem 0 0.5rem' }}>Or any OpenAI client:</p>
        <pre className="docs-code"><code>{OPENAI}</code></pre>

        <p style={{ marginTop: '1.5rem' }}>
          <Link to="/docs">Full start →</Link>
          {' · '}
          <Link to="/#try">Homepage try-it</Link>
        </p>
      </div>
    </div>
  );
}
