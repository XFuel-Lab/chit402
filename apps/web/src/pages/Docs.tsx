import { Link } from 'react-router-dom';
import { getApiHost, getApiV1 } from '../apiHost';
import { getHostConfig } from '../hostConfig';

const GITHUB = 'https://github.com/XFuel-Lab/xfuel-protocol/blob/main';

type DocLink = {
  title: string;
  description: string;
  href: string;
  meta: string;
  external?: boolean;
};

const startHere: DocLink[] = [
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
    title: 'M2M API',
    description: 'REST task submit, status, webhooks, quotes.',
    href: `${GITHUB}/docs/M2M_API.md`,
    meta: 'REST',
    external: true,
  },
  {
    title: 'Chat completions gateway',
    description: 'Drop-in /v1 models and chat completions with receipts.',
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
        {items.map((item) => (
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
        ))}
      </div>
    </section>
  );
}

function getSnippet(apiV1: string) {
  return `curl -sS ${apiV1}/chat/completions \\
  -H "X-API-Key: xfuel-demo" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"xfuel/auto","messages":[{"role":"user","content":"Say hello in 5 words."}],"max_tokens":32}'`;
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
          <a href="https://github.com/XFuel-Lab/xfuel-protocol" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href="https://www.npmjs.com/package/xfuel-sdk" target="_blank" rel="noreferrer">
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
          <h2>Try the demo (no wallet)</h2>
          <p>
            Demo key <code>xfuel-demo</code> with <code>/v1</code>. Receipt comes back on the response.
            This does not spend USDC.
          </p>
          <pre className="docs-code">
            <code>{SNIPPET}</code>
          </pre>
          <p style={{ marginTop: '0.75rem' }}>SDK (same door):</p>
          <pre className="docs-code">
            <code>{`npm install xfuel-sdk
# client.chatCompletions({ model: 'xfuel/auto', messages: [...] })`}</code>
          </pre>
          <p style={{ marginTop: '0.75rem', fontSize: '0.9rem', opacity: 0.85 }}>
            Paid path is <code>POST /task-request</code> (402 without x402). Do not use{' '}
            <code>createMockPayer</code> against this host. Windows: <code>curl.exe</code>.
            Demo key is rate-limited (15/min, 150/day).
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
