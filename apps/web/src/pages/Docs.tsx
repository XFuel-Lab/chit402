import { Link } from 'react-router-dom';
import { getApiHost, getApiV1 } from '../apiHost';
import { getHostConfig } from '../hostConfig';

const GITHUB = 'https://github.com/XFuel-Lab/chit402/blob/main';

type DocLink = {
  title: string;
  description: string;
  href: string;
  meta: string;
  external?: boolean;
  internal?: boolean;
};

const startHere: DocLink[] = [
  {
    title: 'Drop-in door',
    description: 'OpenAI-compatible baseURL at api.chit402.com/v1. Paid x402 — SDK / Eliza for verify_url.',
    href: '/docs/chit-in-15-lines',
    meta: 'install',
    internal: true,
  },
  {
    title: 'Runtime state',
    description: 'As-deployed endpoints, real vs mock, current blockers.',
    href: `${GITHUB}/docs/RUNTIME_STATE.md`,
    meta: 'ops',
    external: true,
  },
  {
    title: 'Positioning',
    description: 'Locked product story for site, deck, and agents.',
    href: `${GITHUB}/docs/POSITIONING.md`,
    meta: 'story',
    external: true,
  },
  {
    title: 'Whitepaper',
    description: 'Protocol design: settlement, proofs, circuits, governance.',
    href: `${GITHUB}/WHITEPAPER.md`,
    meta: 'v2.6',
    external: true,
  },
];

const builders: DocLink[] = [
  {
    title: 'Private Spend',
    description: 'vendor_blind for possession sessions — topology privacy, not prompt encryption.',
    href: '/docs/private-spend',
    meta: 'product',
    internal: true,
  },
  {
    title: 'Escrow helper',
    description: 'Ledger escrow beside the book — settlement proofs for high-value jobs.',
    href: `${GITHUB}/docs/product/escrow-helper.md`,
    meta: 'book',
    external: true,
  },
  {
    title: 'A2A escrow + machine dispute',
    description: 'Agent↔agent job_spec_hash flow on the book — open, fund, submit, release or challenge.',
    href: `${GITHUB}/docs/product/a2a-escrow-dispute-v1.md`,
    meta: 'book',
    external: true,
  },
  {
    title: 'M2M API',
    description: 'REST task submit, status, webhooks, quotes.',
    href: `${GITHUB}/docs/M2M_API.md`,
    meta: 'REST',
    external: true,
  },
  {
    title: 'Chat completions gateway',
    description: 'Drop-in /v1 — pay, then hold the receipt.',
    href: `${GITHUB}/docs/CHAT_COMPLETIONS_GATEWAY.md`,
    meta: '/v1',
    external: true,
  },
  {
    title: 'USDC / x402',
    description: 'Agent-side payments on Base — no server hot wallets.',
    href: `${GITHUB}/docs/X402_ADAPTER.md`,
    meta: 'Base',
    external: true,
  },
  {
    title: 'TypeScript SDK',
    description: 'chatCompletions is POST /v1/chat/completions. npm xfuel-sdk.',
    href: `${GITHUB}/packages/sdk/README.md`,
    meta: '0.5.5',
    external: true,
  },
  {
    title: 'Framework adapters',
    description: 'LangChain + Vercel AI SDK — swap baseURL, pay USDC, hold verify_url.',
    href: '/docs/framework-adapters',
    meta: 'npm',
    internal: true,
  },
  {
    title: 'Eliza plugin',
    description: '@xfuel/plugin-elizaos — USDC budget + verify_url for Eliza agents.',
    href: '/docs/eliza',
    meta: 'framework',
    internal: true,
  },
  {
    title: 'Cloudflare Agents',
    description: 'Chit baseURL or chit402-sidecar stamp for Workers and Agents.',
    href: '/docs/cloudflare',
    meta: 'worker',
    internal: true,
  },
  {
    title: 'Virtuals ACP',
    description: 'Keep ACP settle; send inference spend through Chit for the receipt book.',
    href: '/docs/acp',
    meta: 'ACP',
    internal: true,
  },
  {
    title: 'OpenClaw skill',
    description: 'Pasteable SKILL.md — baseURL swap + USDC caps + verify_url.',
    href: '/docs/openclaw',
    meta: 'skill',
    internal: true,
  },
  {
    title: 'Olas + Theoriq',
    description: 'Swarm runners — same beachhead, no deep protocol fork.',
    href: '/docs/swarm-platforms',
    meta: 'swarm',
    internal: true,
  },
  {
    title: 'MCP server',
    description: 'npx xfuel-mcp — tools for agents in Cursor and Claude.',
    href: `${GITHUB}/packages/mcp/README.md`,
    meta: 'MCP',
    external: true,
  },
  {
    title: 'Agent playbook',
    description: 'End-to-end flows: infer, pay, verify, A2A, swarms.',
    href: `${GITHUB}/packages/agent-skills/AGENT_PLAYBOOK.md`,
    meta: 'skills',
    external: true,
  },
];

function getOperators(apiDomain: string): DocLink[] {
  return [
    {
      title: 'Deployment',
      description: 'Base verifier, gateway, manifests.',
      href: `${GITHUB}/docs/DEPLOYMENT.md`,
      meta: 'deploy',
      external: true,
    },
    {
      title: 'Testing',
      description: 'Contract matrix, gateway tests, zkLLM cargo tests.',
      href: `${GITHUB}/docs/TESTING.md`,
      meta: '755+',
      external: true,
    },
    {
      title: 'Hosted API',
      description: `Public beta at ${apiDomain}.`,
      href: `${GITHUB}/docs/HOSTED_TESTNET_ENDPOINT.md`,
      meta: 'demo',
      external: true,
    },
  ];
}

const auditors: DocLink[] = [
  {
    title: 'Audit readiness',
    description: 'Phase 1 scope freeze and handover checklist.',
    href: `${GITHUB}/docs/AUDIT_READINESS_CHECKLIST.md`,
    meta: 'audit',
    external: true,
  },
  {
    title: 'Responsible disclosure',
    description: 'Scope, safe harbour, and how findings are credited.',
    href: `${GITHUB}/docs/bug-bounty.md`,
    meta: 'security',
    external: true,
  },
  {
    title: 'Security design',
    description: 'Trust ladder and settlement surfaces.',
    href: `${GITHUB}/docs/security-design.md`,
    meta: 'model',
    external: true,
  },
];

function DocSection({ title, items }: { title: string; items: DocLink[] }) {
  return (
    <section className="docs-section">
      <h2 className="docs-section-title">{title}</h2>
      <div className="docs-list">
        {items.map((item) =>
          item.internal ? (
            <Link key={item.title} to={item.href} className="docs-row">
              <div>
                <div className="docs-row-title">{item.title}</div>
                <p className="docs-row-desc">{item.description}</p>
              </div>
              <span className="docs-row-meta">{item.meta}</span>
            </Link>
          ) : (
            <a
              key={item.title}
              href={item.href}
              className="docs-row"
              target={item.external ? '_blank' : undefined}
              rel={item.external ? 'noreferrer' : undefined}
            >
              <div>
                <div className="docs-row-title">{item.title}</div>
                <p className="docs-row-desc">{item.description}</p>
              </div>
              <span className="docs-row-meta">{item.meta}</span>
            </a>
          ),
        )}
      </div>
    </section>
  );
}

function getSnippet(apiV1: string) {
  return `curl -sS -D - ${apiV1}/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{}'
# → HTTP 402 + PAYMENT-REQUIRED (USDC on Base or Solana)`;
}

export default function Docs() {
  const config = getHostConfig();
  const productName = config.name;
  const apiHost = getApiHost();
  const apiV1 = getApiV1();
  const apiDomain = config.apiDomain;
  const operators = getOperators(apiDomain);
  const SNIPPET = getSnippet(apiV1);

  return (
    <div className="page docs-page">
      <div className="container">
        <header className="page-header">
          <span className="docs-kicker">Documentation</span>
          <h1>Build on {productName}</h1>
          <p>
            No account. No API key. A wallet that can pay the 402 is enough.
            Register is only to hold the book after a collected receipt.
            Apache-2.0. Public beta at <code>{apiDomain}</code>. Paying it is mainnet USDC.
          </p>
        </header>

        <nav className="docs-rail" aria-label="Quick links">
          <a href={`${apiHost}/health`} target="_blank" rel="noreferrer">
            API health
          </a>
          <a href="https://github.com/XFuel-Lab/chit402" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href="https://www.npmjs.com/package/chit402-sdk" target="_blank" rel="noreferrer">
            npm SDK
          </a>
          <a href={`${GITHUB}/docs/bug-bounty.md`} target="_blank" rel="noreferrer">
            Disclosure
          </a>
          <Link to="/pricing">Pricing</Link>
          <Link to="/security">Security</Link>
        </nav>

        <DocSection title="Start here" items={startHere} />
        <DocSection title="Builders" items={builders} />
        <DocSection title="Operators" items={operators} />
        <DocSection title="Auditors" items={auditors} />

        <div className="docs-panel">
          <h2>Probe the paid door</h2>
          <p>
            Unauthenticated <code>POST /v1/chat/completions</code> returns HTTP 402. Settle USDC,
            then retry with <code>X-PAYMENT</code> for a signed receipt with <code>verify_url</code>.
          </p>
          <pre className="docs-code">
            <code>{SNIPPET}</code>
          </pre>
          <p style={{ marginTop: '0.75rem' }}>SDK (x402 payer):</p>
          <pre className="docs-code">
            <code>{`npm install chit402-sdk
# client.chatCompletions({ model: 'xfuel/auto', messages: [...] })`}</code>
          </pre>
          <p style={{ marginTop: '0.75rem', fontSize: '0.9rem', opacity: 0.85 }}>
            Lower-level M2M path: <code>POST /task-request</code>. Do not use{' '}
            <code>createMockPayer</code> against this host. Windows: <code>curl.exe</code>.
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
              href={`${GITHUB}/docs/DEMO_COMMANDS.md`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary btn-sm"
            >
              Demo commands
            </a>
            <a
              href={`${GITHUB}/docs/README.md`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary btn-sm"
            >
              Full docs hub
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
