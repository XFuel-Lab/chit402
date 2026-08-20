import { Link } from 'react-router-dom';

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
    title: 'OpenAI-compatible gateway',
    description: 'Drop-in /v1 models and chat completions with receipts.',
    href: `${GITHUB}/docs/OPENAI_COMPATIBLE_GATEWAY.md`,
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
    description: 'chatCompletions is the free path. npm xfuel-sdk.',
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

const operators: DocLink[] = [
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
    description: 'Public beta at api.xfuel.app (api-testnet is the same box).',
    href: `${GITHUB}/docs/HOSTED_TESTNET_ENDPOINT.md`,
    meta: 'demo',
    external: true,
  },
];

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

export default function Docs() {
  return (
    <div className="page docs-page">
      <div className="container">
        <header className="page-header">
          <span className="docs-kicker">Documentation</span>
          <h1>Build on XFuel</h1>
          <p>
            First hour is OpenAI <code>/v1</code> — no wallet. Paid USDC on Base is a second door.
            Apache-2.0. Public beta at <code>api.xfuel.app</code>. Paying it is mainnet USDC.
          </p>
        </header>

        <nav className="docs-rail" aria-label="Quick links">
          <a href="https://api.xfuel.app/health" target="_blank" rel="noreferrer">
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
            Unmetered <code>/v1</code> with the public demo key. Receipt comes back on the response.
            This does not spend USDC.
          </p>
          <pre className="docs-code">
            <code>{`curl -sS https://api.xfuel.app/v1/chat/completions \\
  -H "X-API-Key: xfuel-demo" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"xfuel/auto","messages":[{"role":"user","content":"Say hello in 5 words."}],"max_tokens":32}'`}</code>
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
