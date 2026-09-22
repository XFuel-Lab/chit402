import { Link } from 'react-router-dom';
import type { CSSProperties } from 'react';
import { getApiV1 } from '../apiHost';
import { getHostConfig } from '../hostConfig';
import { LIVE_RECEIPT_VERIFY_URL } from '../lib/liveReceiptSpecimen';

const GITHUB = 'https://github.com/XFuel-Lab/chit402/blob/main';

const sdkPaidExample = `import { XFuelClient } from 'xfuel-sdk';

// Pay USDC on Base or Solana via x402; hold verify_url on the response.
const client = new XFuelClient({
  baseUrl: 'https://api.chit402.com',
  // apiKey: optional partner key — omit to pay per call with your wallet payer
});

const chat = await client.chatCompletions({
  model: 'xfuel/auto',
  messages: [{ role: 'user', content: 'Say hello in five words.' }],
});

console.log(chat.choices[0].message.content);
console.log(chat.xfuel?.verify_url); // signed receipt after settle`;

const wireCompatJsExample = `import OpenAI from 'openai';

// Wire-compat install: familiar /v1 paths — you must satisfy HTTP 402 (x402 USDC).
const client = new OpenAI({
  baseURL: 'https://api.chit402.com/v1',
  apiKey: 'unused', // SDK requires a string; payment is X-PAYMENT / wallet, not this field
});

// This npm client alone cannot pay 402 — use chit402-sdk, Eliza plugin, or x402-fetch.`;

const curlExample = (apiV1: string) => `curl -sS ${apiV1}/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model":"xfuel/auto","messages":[{"role":"user","content":"Say hello."}],"max_tokens":32}'
# → HTTP 402 + PAYMENT-REQUIRED. Retry with X-PAYMENT after USDC settle.`;

export default function ChitIn15Lines() {
  const config = getHostConfig();
  const apiV1 = getApiV1();
  const liveReceipt = LIVE_RECEIPT_VERIFY_URL;

  return (
    <div className="page docs-page">
      <div className="container" style={{ maxWidth: 720 }}>
        <header className="page-header">
          <span className="docs-kicker">Install path</span>
          <h1>Chat <code>/v1</code> wire</h1>
          <p>
            <strong>Chit is the possession book</strong> — after USDC settle you hold hub, model,
            amount, and <code>verify_url</code>; register to keep <code>/book</code>. This page is
            one install wire: point a chat-completions client at <code>{apiV1}</code> (peers:{' '}
            <Link to="/docs/doors" style={{ color: '#00d4ff' }}>Eliza, ACP, MCP, frameworks</Link>
            ). Trials are live paid — no public demo key.
          </p>
        </header>

        <div className="docs-panel">
          <h2>Paid path (product)</h2>
          <p>
            <code>POST /v1/chat/completions</code> without payment returns HTTP 402. Pay USDC on
            Base or Solana; the response includes a signed receipt with{' '}
            <code>verify_url</code>. Use the SDK x402 payer or the{' '}
            <Link to="/docs/eliza" style={{ color: '#00d4ff' }}>Eliza plugin</Link>.
          </p>
          <pre className="docs-code">
            <code>{sdkPaidExample}</code>
          </pre>
          <p style={styles.note}>
            Register (<code>POST /v1/agents/register</code>) binds a <em>collected</em> receipt to
            an agent wallet so you can hold the book. Unmetered receipts do not qualify.
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
          </div>
        </div>

        <div className="docs-panel">
          <h2>Wire-compat JS client (shape only)</h2>
          <p>
            Swap <code>baseURL</code> to <code>{apiV1}</code> if you already use a popular{' '}
            <code>openai</code> npm client — but you still need an x402-capable payer; the client
            alone will stop at 402.
          </p>
          <pre className="docs-code">
            <code>{wireCompatJsExample}</code>
          </pre>
          <p style={styles.note}>
            <strong>Honest caveat:</strong> some wire-compat clients may strip unknown response fields. The
            signed receipt (<code>verify_url</code>, hub, model, amount) lives in{' '}
            <code>x-xfuel-*</code> headers and the <code>xfuel</code> body field. Prefer{' '}
            <code>chit402-sdk</code> for a typed <code>verify_url</code>.
          </p>
        </div>

        <div className="docs-panel">
          <h2>curl (402 probe)</h2>
          <pre className="docs-code">
            <code>{curlExample(apiV1)}</code>
          </pre>
          <p style={styles.note}>
            Windows: use <code>curl.exe</code> for raw HTTP — PowerShell <code>curl</code> is not
            real curl.
          </p>
        </div>

        <p style={{ textAlign: 'center', color: '#8a8a9a', fontSize: '0.9rem', marginTop: '2rem' }}>
          <Link to="/docs" style={{ color: '#8a8a9a' }}>Docs index</Link>
          {' · '}
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
