import { Link } from 'react-router-dom';
import { DocDoorGrid, DocSection, type DocLink } from './docsShared';

const GITHUB = 'https://github.com/XFuel-Lab/chit402/blob/main';

export const installDoors: DocLink[] = [
  {
    title: 'Chit in 15 lines',
    description: 'Shortest path to a signed receipt — swap baseURL, pay USDC, hold verify_url.',
    href: '/docs/chit-in-15-lines',
    meta: 'start',
    internal: true,
  },
  {
    title: 'Chat completions gateway',
    description: 'Drop-in /v1 wire — wire-compat chat completions shape, same possession book.',
    href: `${GITHUB}/docs/CHAT_COMPLETIONS_GATEWAY.md`,
    meta: '/v1',
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
    meta: 'Eliza',
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
    description: 'npx xfuel-mcp — chat_completions, register_agent, get_agent_book.',
    href: `${GITHUB}/packages/mcp/README.md`,
    meta: 'MCP',
    external: true,
  },
  {
    title: 'TypeScript SDK',
    description: 'chatCompletions is POST /v1/chat/completions. npm chit402-sdk.',
    href: `${GITHUB}/packages/sdk/README.md`,
    meta: 'SDK',
    external: true,
  },
  {
    title: 'Agent playbook',
    description: 'End-to-end flows: infer, pay, verify, A2A, swarms.',
    href: `${GITHUB}/packages/agent-skills/AGENT_PLAYBOOK.md`,
    meta: 'skills',
    external: true,
  },
  {
    title: 'Register + book ingest',
    description: 'Bind agent_id after a collected receipt; stamp or ingest foreign x402 rows.',
    href: '/register',
    meta: 'book',
    internal: true,
  },
];

export default function Doors() {
  return (
    <div className="page docs-page">
      <div className="container">
        <header className="page-header">
          <span className="docs-kicker">Install wires</span>
          <h1>Doors</h1>
          <p>
            Equal-weight paths into the same possession book — who paid which call; hold{' '}
            <code>verify_url</code>; export, policy, and evidence. Pick a door that matches your
            runtime; every paid call still lands in the book.
          </p>
        </header>

        <nav className="docs-rail" aria-label="Quick links">
          <Link to="/docs">Docs hub</Link>
          <Link to="/book">Principal book</Link>
          <Link to="/docs/chit-in-15-lines">Chit in 15 lines</Link>
        </nav>

        <section className="docs-section">
          <h2 className="docs-section-title">Install paths</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1.25rem', lineHeight: 1.6 }}>
            Chat-completions <code>/v1</code> is one install wire among Eliza, ACP, MCP,
            frameworks, Cloudflare, swarms, foreign ingest, and register/book — not the product
            identity.
          </p>
          <DocDoorGrid items={installDoors} />
        </section>

        <DocSection
          title="Also on the hub"
          items={[
            {
              title: 'Documentation hub',
              description: 'Book-first overview — product seats, operators, auditors.',
              href: '/docs',
              meta: 'hub',
              internal: true,
            },
          ]}
        />
      </div>
    </div>
  );
}
