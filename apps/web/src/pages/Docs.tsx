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
    description: 'Submit, pay, prove, verify — npm xfuel-sdk.',
    href: `${GITHUB}/packages/sdk/README.md`,
    meta: '0.2.0',
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
    title: 'Hosted testnet',
    description: 'Public API at api-testnet.xfuel.app.',
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
    title: 'Bug bounty',
    description: 'Scope and rewards up to $50,000 critical.',
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
            Verifiable settlement for AI compute — USDC on Base, tiered receipts, pluggable
            providers. Sparse docs for agents; this hub is for humans.
          </p>
        </header>

        <nav className="docs-rail" aria-label="Quick links">
          <a href="https://api-testnet.xfuel.app/health" target="_blank" rel="noreferrer">
            API health
          </a>
          <a href="https://github.com/XFuel-Lab/xfuel-protocol" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href="https://www.npmjs.com/package/xfuel-sdk" target="_blank" rel="noreferrer">
            npm SDK
          </a>
          <a href={`${GITHUB}/docs/bug-bounty.md`} target="_blank" rel="noreferrer">
            Bug bounty
          </a>
          <Link to="/circuits">Circuits</Link>
          <Link to="/security">Security</Link>
        </nav>

        <DocSection title="Start here" items={startHere} />
        <DocSection title="Builders" items={builders} />
        <DocSection title="Operators" items={operators} />
        <DocSection title="Auditors" items={auditors} />

        <div className="docs-panel">
          <h2>Try the API</h2>
          <p>
            Hosted demo key <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85em' }}>xfuel-demo</code> —
            rate-limited. Default rail is USDC via x402 on Base Sepolia.
          </p>
          <pre className="docs-code">
            <code>{`curl -X POST https://api-testnet.xfuel.app/task-request \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: xfuel-demo" \\
  -d '{
    "message_type": "inference_request",
    "chain_id": "base",
    "amount": "1000000",
    "sender": "0xYourAddress",
    "model_id": "llama-3-70b",
    "input_hash": "0xabc...",
    "payment": { "rail": "usdc" }
  }'`}</code>
          </pre>
          <pre className="docs-code">
            <code>{`npm install xfuel-sdk
npx xfuel-mcp`}</code>
          </pre>
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
