import { Link } from 'react-router-dom';
import { getApiHost, getApiV1 } from '../apiHost';
import PaidDoorOptions from '../components/PaidDoorOptions';
import { PAID_DOOR_GET } from '../lib/paidDoorSnippets';
import { DocSection, type DocLink } from './docsShared';

const GITHUB = 'https://github.com/XFuel-Lab/chit402/blob/main';

const sdkPartner = `npm install chit402-sdk

import { Chit402Client } from 'chit402-sdk';

const client = new Chit402Client({
  baseUrl: 'https://api.chit402.com',
  apiKey: process.env.CHIT402_API_KEY,
});

const chat = await client.chatCompletions({
  model: 'xfuel/auto',
  messages: [{ role: 'user', content: 'Say hello in five words.' }],
});
console.log(chat.xfuel?.verify_url);`;

function mcpSnippet(apiHost: string, withKey: boolean): string {
  const env = withKey
    ? `        "CHIT402_API_URL": "${apiHost}",
        "CHIT402_API_KEY": "your-partner-key"`
    : `        "CHIT402_API_URL": "${apiHost}"`;
  return `{
  "mcpServers": {
    "chit402": {
      "command": "npx",
      "args": ["-y", "chit402-mcp"],
      "env": {
${env}
      }
    }
  }
}`;
}

const sidecarSnippet = `npm install chit402-sidecar

import { createSidecarFetch } from 'chit402-sidecar';

const fetchWithReceipt = createSidecarFetch({
  onReceipt: (receipt) => console.log(receipt.verify_url),
});
// Wrap the fetch you already use to pay OpenRouter, Groq, or another provider.`;

export const moreDoors: DocLink[] = [
  {
    title: 'Chat /v1 wire',
    description: 'The same two options, written out: keyless x402, then a partner key.',
    href: '/docs/chit-in-15-lines',
    meta: 'wire',
    internal: true,
  },
  {
    title: 'Framework adapters',
    description: 'LangChain and the Vercel AI SDK. Keyless x402, then a partner key.',
    href: '/docs/framework-adapters',
    meta: 'npm',
    internal: true,
  },
  {
    title: 'Eliza plugin',
    description: '@xfuel/plugin-elizaos. Keyless x402, then a partner key.',
    href: '/docs/eliza',
    meta: 'Eliza',
    internal: true,
  },
  {
    title: 'Cloudflare',
    description: 'Workers and Agents. Keyless x402, then a partner key. Sidecar is separate.',
    href: '/docs/cloudflare',
    meta: 'worker',
    internal: true,
  },
  {
    title: 'Virtuals ACP',
    description: 'Keep ACP settle. Keyless x402, then a partner key, for the receipt.',
    href: '/docs/acp',
    meta: 'ACP',
    internal: true,
  },
  {
    title: 'OpenClaw',
    description: 'Pasteable skill. Keyless x402, then a partner key.',
    href: '/docs/openclaw',
    meta: 'skill',
    internal: true,
  },
  {
    title: 'Olas + Theoriq',
    description: 'Same two options. Your orchestration stays yours.',
    href: '/docs/swarm-platforms',
    meta: 'swarm',
    internal: true,
  },
  {
    title: 'Register',
    description: 'Bind agent_id after a collected receipt, then open the book.',
    href: '/register',
    meta: 'book',
    internal: true,
  },
  {
    title: 'Agent playbook',
    description: 'End-to-end flows in the repo: infer, pay, verify.',
    href: `${GITHUB}/packages/agent-skills/AGENT_PLAYBOOK.md`,
    meta: 'skills',
    external: true,
  },
];

export default function Doors() {
  const apiV1 = getApiV1();
  const apiHost = getApiHost();

  return (
    <div className="page docs-page">
      <div className="container">
        <header className="page-header">
          <span className="docs-kicker">Install wires</span>
          <h1>Doors</h1>
          <p>
            The book is the product. These are ways in: who paid which call, a{' '}
            <code>verify_url</code>, and a row after you register. Pay per call with x402, or use a
            partner API key. The key is supported. It is not required.
          </p>
        </header>

        <nav className="docs-rail" aria-label="Quick links">
          <Link to="/docs">Docs hub</Link>
          <Link to="/book">Principal book</Link>
          <Link to="/docs/chit-in-15-lines">Chat /v1 wire</Link>
        </nav>

        <section className="docs-section">
          <h2 className="docs-section-title">Start here</h2>

          <div className="docs-panel">
            <h2>1. TypeScript</h2>
            <p>
              <strong>What you get:</strong> {PAID_DOOR_GET} <code>chit402-sdk</code> does not sign
              the 402 itself. Use the keyless fetch below, or pass a partner <code>apiKey</code>.
            </p>
            <PaidDoorOptions apiV1={apiV1} />
            <h3 style={{ fontSize: '1rem', margin: '1.25rem 0 0.5rem' }}>Typed client, partner key</h3>
            <pre className="docs-code">
              <code>{sdkPartner}</code>
            </pre>
          </div>

          <div className="docs-panel">
            <h2>2. MCP</h2>
            <p>
              <strong>What you get:</strong> <code>npx chit402-mcp</code> exposes{' '}
              <code>chat_completions</code>, <code>register_agent</code>, and <code>get_agent_book</code>.
              The server does not hold a wallet. Without a partner key the tool gets HTTP 402, and
              the wallet pays it.
            </p>
            <h3 style={{ fontSize: '1rem', margin: '1rem 0 0.5rem' }}>Keyless</h3>
            <pre className="docs-code">
              <code>{mcpSnippet(apiHost, false)}</code>
            </pre>
            <h3 style={{ fontSize: '1rem', margin: '1.25rem 0 0.5rem' }}>Partner API key</h3>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              Supported. Set <code>CHIT402_API_KEY</code> in the same env block.
            </p>
            <pre className="docs-code">
              <code>{mcpSnippet(apiHost, true)}</code>
            </pre>
          </div>

          <div className="docs-panel">
            <h2>3. Sidecar</h2>
            <p>
              <strong>What you get:</strong> a receipt on a call you already pay a provider for.
              Install <code>chit402-sidecar</code>. Without a collected USDC <code>payment.ref</code>,
              that receipt is client-attested. It does not write the book by itself.
            </p>
            <pre className="docs-code">
              <code>{sidecarSnippet}</code>
            </pre>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, marginTop: '0.75rem' }}>
              The Worker source is <code>packages/sidecar/worker</code> in the repo. To have Chit
              collect USDC instead, use the TypeScript door above (keyless x402, or a partner key).
            </p>
          </div>

          <div className="docs-panel">
            <h2>4. Chat-completions client</h2>
            <p>
              Set <code>baseURL</code> to <code>{apiV1}</code>. Keyless x402 or a partner key, same
              as door 1. Details:{' '}
              <Link to="/docs/chit-in-15-lines">Chat /v1 wire</Link>.
            </p>
            <pre className="docs-code">
              <code>{`baseURL: '${apiV1}'`}</code>
            </pre>
          </div>
        </section>

        <DocSection title="Other doors" items={moreDoors} />
      </div>
    </div>
  );
}
