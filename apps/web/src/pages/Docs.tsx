import { Link } from 'react-router-dom';
import { getApiHost, getApiV1 } from '../apiHost';
import { getHostConfig } from '../hostConfig';
import { DocSection, type DocLink } from './docsShared';

const GITHUB = 'https://github.com/XFuel-Lab/chit402/blob/main';

const startHere: DocLink[] = [
  {
    title: 'What the book is, and isn\'t',
    description: 'Collected vs client-attested, what a receipt proves, settled vs unsettled, daily anchors.',
    href: '/book#what-the-book-is',
    meta: 'book',
    internal: true,
  },
  {
    title: 'Products',
    description: 'Stamp, Private Desk, and Private + Attest — book-first seats and what you hold after settle.',
    href: '/products',
    meta: 'seats',
    internal: true,
  },
  {
    title: 'Chit in 15 lines',
    description: 'Fastest receipt path — pay USDC, collect verify_url, start the book.',
    href: '/docs/chit-in-15-lines',
    meta: 'start',
    internal: true,
  },
  {
    title: 'Spend audit',
    description: 'Paste a Base wallet. USDC out by counterparty, public receipt match, no signup. Incomplete scans show no total.',
    href: '/audit',
    meta: 'public',
    internal: true,
  },
  {
    title: '1F916 link (draft)',
    description: 'Draft v0. Specimen 1 and Specimen 2 are stamped listing payouts, with verify links.',
    href: '/docs/1f916-link',
    meta: 'draft',
    internal: true,
  },
  {
    title: 'Runtime state',
    description: 'As-deployed endpoints, receipt surfaces, and current blockers.',
    href: `${GITHUB}/docs/RUNTIME_STATE.md`,
    meta: 'ops',
    external: true,
  },
  {
    title: 'Positioning',
    description: 'Possession book story — who paid which call, evidence, and policy.',
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
    title: 'USDC / x402',
    description: 'Payment rail for the book — agent-side USDC on Base or Solana.',
    href: `${GITHUB}/docs/X402_ADAPTER.md`,
    meta: 'x402',
    external: true,
  },
  {
    title: 'Cloudflare Monetization Gateway',
    description: 'Receipt for an x402 v2 call settled by Coinbase on Base. Evidence is foreign_ingest.',
    href: '/docs/cloudflare-x402',
    meta: 'x402',
    internal: true,
  },
  {
    title: 'Issuer trust',
    description: 'Pin JWKS + kid, rotation policy, receipt verify steps.',
    href: '/trust',
    meta: 'trust',
    internal: true,
  },
  {
    title: 'Receipt check',
    description: 'Recompute public receipt hashes and check the signed issuer key history.',
    href: '/docs/receipt-check',
    meta: 'verify',
    internal: true,
  },
  {
    title: 'Install doors',
    description: 'Chat /v1 wire, Eliza, ACP, MCP, frameworks, Cloudflare, swarms — peers into the same book.',
    href: '/doors',
    meta: 'doors',
    internal: true,
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
          <h1>{productName} possession book</h1>
          <p>
            The product is the book — who paid which call; hold <code>verify_url</code>; export,
            policy, and evidence. Install paths are how agents reach the same stamped receipts:{' '}
            <Link to="/doors">Install wires</Link>. No account. No API key. A wallet that can
            pay the 402 is enough. Register is only to hold the book after a collected receipt.
            Apache-2.0. Public beta at <code>{apiDomain}</code>. Paying it is mainnet USDC.
          </p>
        </header>

        <nav className="docs-rail" aria-label="Quick links">
          <Link to="/book">Principal book</Link>
          <Link to="/trust">Trust</Link>
          <Link to="/doors">Install wires → /doors</Link>
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
          <Link to="/products">Products</Link>
          <Link to="/pricing">Pricing</Link>
          <Link to="/security">Security</Link>
        </nav>

        <DocSection title="Start here" items={startHere} />

        <div className="docs-panel">
          <h2>What&apos;s new</h2>
          <ul style={{ color: 'var(--text-secondary)', lineHeight: 1.7, paddingLeft: '1.2rem' }}>
            <li>
              <strong>2026-09-30</strong> — the receipt root is published daily on Base and on Solana.
              The current head is{' '}
              <a href={`${apiHost}/v1/receipts/tree/head`}>GET /v1/receipts/tree/head</a>.{' '}
              <code>@xfuel/verify</code> 0.3.1 <code>--rpc</code> checks that the anchor transaction
              is present. It is not a full inclusion check.
            </li>
            <li>
              <strong>2026-10-06</strong> — the public receipt log is durable and tied to an epoch.
            </li>
            <li>
              <strong>2026-10-03</strong> — a blocked spend can return a signed refusal
              (<code>chit402.refusal.v1</code>). <code>@xfuel/verify</code> 0.3.1 verifies it.
            </li>
            <li>
              <strong>2026-10-04</strong> — public spend audit at <Link to="/audit">/audit</Link>.
            </li>
            <li>
              <strong>2026-10-04</strong> — hash preimages and signed issuer key history.
              Check them on <Link to="/docs/receipt-check">Receipt check</Link>. Published receipts
              from before the object was stored still return 404 on <code>/preimage</code>.
            </li>
          </ul>
        </div>
        <DocSection title="Builders" items={builders} />
        <DocSection title="Operators" items={operators} />
        <DocSection title="Auditors" items={auditors} />

        <div className="docs-panel">
          <h2>Probe the paid door</h2>
          <p>
            Unauthenticated <code>POST /v1/chat/completions</code> returns HTTP 402. Settle USDC,
            then retry with <code>X-PAYMENT</code> for a signed receipt with <code>verify_url</code>.
            Bring your OpenRouter key, get a Chit receipt for every call. Send it as{' '}
            <code>X-OpenRouter-Key</code>. Chit charges the $0.002 receipt and records the model
            that served plus the OpenRouter-reported cost, labelled paid-by-caller-to-OpenRouter.
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
            <Link to="/doors" className="btn btn-secondary btn-sm">
              Install doors
            </Link>
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
