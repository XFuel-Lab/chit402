import { Link } from 'react-router-dom';
import type { CSSProperties } from 'react';
import { getApiV1 } from '../apiHost';
import { getHostConfig } from '../hostConfig';

const GITHUB = 'https://github.com/XFuel-Lab/chit402/blob/main';

const curlExample = (apiV1: string) => `curl -sS ${apiV1}/chat/completions \\
  -H "X-API-Key: chit402-demo" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"xfuel/auto","messages":[{"role":"user","content":"Say hello in five words."}],"max_tokens":32}'`;

const openAiExample = `import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://api.chit402.com/v1',
  apiKey: 'chit402-demo', // shared demo — no USDC spent
});

const res = await client.chat.completions.create({
  model: 'xfuel/auto',
  messages: [{ role: 'user', content: 'Say hello in five words.' }],
  max_tokens: 32,
});

console.log(res.choices[0]?.message?.content);`;

const sdkExample = `import { XFuelClient } from 'xfuel-sdk';

const client = new XFuelClient(); // api.chit402.com + chit402-demo

const chat = await client.chatCompletions({
  model: 'xfuel/auto',
  messages: [{ role: 'user', content: 'Say hello in five words.' }],
});

console.log(chat.choices[0].message.content);
console.log(chat.xfuel?.verify_url); // signed receipt — demo, no USDC`;

export default function ChitIn15Lines() {
  const config = getHostConfig();
  const apiV1 = getApiV1();
  const liveReceipt =
    'https://api.chit402.com/receipt/chit-1e57cdd7-4fde-4525-bea3-5ffd1d1d909e';

  return (
    <div className="page docs-page">
      <div className="container" style={{ maxWidth: 720 }}>
        <header className="page-header">
          <span className="docs-kicker">Quickstart</span>
          <h1>Chit in 15 lines</h1>
          <p>
            Point any chat-completions client at <code>{apiV1}</code>. Demo key{' '}
            <code>chit402-demo</code> skips payment — no wallet, no USDC. Paid calls return a
            collected receipt with <code>verify_url</code>.
          </p>
        </header>

        <div className="docs-panel">
          <h2>OpenAI SDK</h2>
          <p>
            Swap <code>baseURL</code> and use the demo key. This path does not spend USDC.
          </p>
          <pre className="docs-code">
            <code>{openAiExample}</code>
          </pre>
          <p style={styles.note}>
            <strong>Honest caveat:</strong> the OpenAI SDK may strip unknown response fields. The
            signed receipt (<code>verify_url</code>, hub, model, amount) lives in{' '}
            <code>x-xfuel-*</code> headers and the <code>xfuel</code> body field. For a typed
            receipt in JS, use the SDK below or read headers from a raw <code>fetch</code>.
          </p>
        </div>

        <div className="docs-panel">
          <h2>Chit402 SDK (receipt in the response)</h2>
          <p>
            <code>npm install chit402-sdk</code> (alias of <code>xfuel-sdk</code>). Returns{' '}
            <code>xfuel.verify_url</code> on the response object.
          </p>
          <pre className="docs-code">
            <code>{sdkExample}</code>
          </pre>
        </div>

        <div className="docs-panel">
          <h2>curl (no SDK)</h2>
          <pre className="docs-code">
            <code>{curlExample(apiV1)}</code>
          </pre>
          <p style={styles.note}>
            Demo key is rate-limited (15/min, 150/day per IP). Windows: use <code>curl.exe</code>.
          </p>
        </div>

        <div className="docs-panel">
          <h2>Paid path (real USDC)</h2>
          <p>
            Unauthenticated <code>POST /v1/chat/completions</code> returns HTTP 402. Pay USDC on
            Base or Solana; the response includes a collected receipt with{' '}
            <code>verify_url</code>. Use the SDK x402 payer, or the{' '}
            <Link to="/docs/eliza" style={{ color: '#00d4ff' }}>Eliza plugin</Link> when it ships.
          </p>
          <p style={styles.note}>
            Register (<code>POST /v1/agents/register</code>) binds a collected receipt to an agent
            wallet so you can hold the book. Demo receipts do not qualify.
          </p>
          <div className="docs-actions">
            <a
              href={`${GITHUB}/packages/sdk/README.md`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-primary btn-sm"
            >
              SDK docs
            </a>
            <a
              href={liveReceipt}
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary btn-sm"
            >
              View live receipt
            </a>
            <Link to="/" className="btn btn-secondary btn-sm">
              Home
            </Link>
          </div>
        </div>

        <p style={{ textAlign: 'center', color: '#8a8a9a', fontSize: '0.9rem', marginTop: '2rem' }}>
          {config.name} · wire <code>{config.apiDomain}/v1</code>
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  note: {
    marginTop: '0.75rem',
    fontSize: '0.9rem',
    color: '#8a8a9a',
    lineHeight: 1.6,
  },
};
