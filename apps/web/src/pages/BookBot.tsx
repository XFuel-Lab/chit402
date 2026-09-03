import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getApiHost, getApiV1 } from '../apiHost';
import { getHostConfig } from '../hostConfig';

function getPrompt(productName: string, apiHost: string) {
  return `You are an install assistant for ${productName}.

${productName} is the book. This agent spent Y on this job. You hold hub, model, and amount.
POST /v1/chat/completions at ${apiHost}/v1 is cost-plus, quoted, receipted — USDC on Base and Solana.
GET|POST /v1/agents/:agent_id/book is possession-gated last-N collected spend.
Signed receipt is table stakes.

Interview me once about my stack:
1. What language/framework does your agent use? (Python, TypeScript, Rust, etc.)
2. Do you use OpenAI SDK, LangChain, or raw HTTP?
3. Where does your agent run? (local, cloud, CI, etc.)

Then give me the one-liner to point my OpenAI client's baseURL at ${apiHost}/v1.

After that, every job I run should record:
- agent_id (from POST /v1/agents/register)
- task_id (from the response)
- $Y (from the receipt)
- settled y/n (from proof_outcome)

Catalog: Theta + Akash + xfuel/auto only.
Demo key xfuel-demo never writes the book.
Do not claim we route to OpenAI, Groq, or Fireworks.
Do not ask me to send USDC manually.
The API handles payment via HTTP 402 (x402) automatically.

Start with: "What's your agent stack?"`;
}

export default function BookBot() {
  const config = getHostConfig();
  const productName = config.name;
  const apiHost = getApiHost();
  const apiV1 = getApiV1();
  const PROMPT = getPrompt(productName, apiHost);

  useEffect(() => {
    document.title = `Paste this. The shop gets a till | ${productName}`;
  }, [productName]);

  return (
    <div className="page docs-page">
      <div className="container" style={{ maxWidth: 720 }}>
        <header className="page-header">
          <span className="docs-kicker">Book bot</span>
          <h1>Paste this. The shop gets a till.</h1>
          <p>
            Paste this prompt into Grok, ChatGPT, or any agent.
            It interviews your stack once, then every job you run records
            agent / job / $Y / settled y/n by pointing your OpenAI baseURL at{' '}
            <code>{apiV1}</code>.
          </p>
        </header>

        <div className="card" style={{ padding: '1.5rem', marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>Paste-into-bot prompt</h2>
          <pre className="docs-code" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            <code>{PROMPT}</code>
          </pre>
          <p style={{ color: '#8a8a9a', marginTop: '0.75rem', fontSize: '0.9rem' }}>
            Copy this prompt into Grok Bot, ChatGPT, Claude, or any assistant.
            Demo key <code>xfuel-demo</code> skips payment but never writes the book.
          </p>
        </div>

        <div className="card" style={{ padding: '1.5rem', marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>What the book records</h2>
          <ul style={{ color: '#8a8a9a', paddingLeft: '1.2rem', lineHeight: 1.7 }}>
            <li><strong>agent</strong> — your registered agent_id</li>
            <li><strong>job</strong> — task_id from each inference call</li>
            <li><strong>$Y</strong> — amount in USDC (6 decimals)</li>
            <li><strong>settled y/n</strong> — proof_outcome from the receipt</li>
          </ul>
        </div>

        <div className="card" style={{ padding: '1.5rem', marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>Catalog</h2>
          <p style={{ color: '#8a8a9a' }}>
            Theta EdgeCloud + Akash Network + <code>xfuel/auto</code>.
            We do not route to OpenAI, Groq, Together, or Fireworks on the public catalog.
            <code>{apiV1}/models</code> shows what's live.
          </p>
        </div>

        <p style={{ marginTop: '1.5rem' }}>
          <Link to="/agent-shop">Catalog →</Link>
          {' · '}
          <Link to="/book">Your book</Link>
          {' · '}
          <Link to="/v1">Where is /v1?</Link>
        </p>
      </div>
    </div>
  );
}
