import { Link } from 'react-router-dom';

const GITHUB_BASE = 'https://github.com/XFuelAI/xfuel-protocol/blob/main';

const docSections = [
  {
    title: 'Whitepaper',
    description: 'Core protocol design: ZK verification, revenue flow, veXF governance, and multi-chain architecture.',
    icon: '📄',
    links: [
      { label: 'Full Whitepaper', href: `${GITHUB_BASE}/WHITEPAPER.md`, external: true },
      { label: 'Protocol Overview', href: '#overview' },
      { label: 'Tokenomics', href: '#tokenomics' },
    ],
    badge: 'v1.0',
    badgeColor: 'green' as const,
  },
  {
    title: 'Circuits Guide',
    description: 'Technical documentation for all 21 ZK circuits: A2A, ZKML, Data Hubs, Bridge, Compute, and more.',
    icon: '⬡',
    links: [
      { label: 'Circuit Architecture', href: `${GITHUB_BASE}/docs/CIRCUITS.md`, external: true },
      { label: 'SP1 Prover Setup', href: '#sp1-setup' },
      { label: 'Circuit Registry', href: '/circuits' },
    ],
    badge: '21 circuits',
    badgeColor: 'cyan' as const,
  },
  {
    title: 'Smart Contracts',
    description: 'Contract ABIs, deployment addresses, and interaction guides for CoreRevenueSplitter, ZKVerifierSP1, and veXFGovernance.',
    icon: '📋',
    links: [
      { label: 'Contract Reference', href: '#contracts' },
      { label: 'ABI Downloads', href: '#abis' },
      { label: 'Deployment Addresses', href: `${GITHUB_BASE}/docs/DEPLOYMENT.md`, external: true },
    ],
    badge: 'Audited',
    badgeColor: 'green' as const,
  },
  {
    title: 'API Documentation',
    description: 'M2M API gateway for AI agents, partner hooks, and automated circuit interactions.',
    icon: '🔌',
    links: [
      { label: 'M2M API Reference', href: `${GITHUB_BASE}/docs/M2M_API.md`, external: true },
      { label: 'Authentication', href: '#auth' },
      { label: 'Rate Limits', href: '#rate-limits' },
    ],
    badge: 'REST + WS',
    badgeColor: 'purple' as const,
  },
  {
    title: 'Deployment Guide',
    description: 'Step-by-step deployment for Theta, Bittensor EVM, Osmosis CosmWasm, and testnet environments.',
    icon: '🚀',
    links: [
      { label: 'Deployment Steps', href: `${GITHUB_BASE}/docs/DEPLOYMENT.md`, external: true },
      { label: 'Testnet Faucets', href: '#faucets' },
      { label: 'Vercel Hosting', href: '#vercel' },
    ],
    badge: '5 networks',
    badgeColor: 'cyan' as const,
  },
  {
    title: 'Testing Guide',
    description: 'Test suites, CI/CD configuration, coverage reports, and testing best practices for 700+ tests.',
    icon: '✅',
    links: [
      { label: 'Testing Guide', href: `${GITHUB_BASE}/docs/TESTING.md`, external: true },
      { label: 'Coverage Reports', href: '#coverage' },
      { label: 'CI/CD Pipeline', href: '#ci' },
    ],
    badge: '700+ tests',
    badgeColor: 'green' as const,
  },
];

const quickLinks = [
  { label: 'GitHub Repository', url: 'https://github.com/XFuelAI/xfuel-protocol', external: true },
  { label: 'NPM Package', url: 'https://www.npmjs.com/package/xfuel-sdk', external: true },
  { label: 'CertiK Audit', url: '#certik', external: false },
  { label: 'Bug Bounty', url: '#bounty', external: false },
];

const codeExamples = [
  {
    title: 'Verify a ZK Proof',
    language: 'solidity',
    code: `// Verify an SP1 proof on-chain
IZKVerifierSP1(verifier).verifyProof(
  circuitId,
  publicInputs,
  proofBytes
);`,
  },
  {
    title: 'Bridge via Hyperlane',
    language: 'typescript',
    code: `// Dispatch cross-chain bridge
const tx = await splitter.bridgeAndDistribute(
  destChainId,
  amount,
  { value: bridgeFee }
);`,
  },
  {
    title: 'Lock veXF',
    language: 'typescript',
    code: `// Lock XF for veXF voting power
const tx = await governance.lock(
  parseEther("1000"),
  TWELVE_MONTHS
);`,
  },
];

export default function Docs() {
  return (
    <div className="page">
      <div className="container">
        <div className="page-header">
          <h1>Developer Documentation</h1>
          <p>Everything you need to build on and integrate with XFuel Protocol</p>
        </div>

        {/* Quick Links */}
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
          {quickLinks.map((l) => (
            <a
              key={l.label}
              href={l.url}
              target={l.external ? '_blank' : undefined}
              rel={l.external ? 'noreferrer' : undefined}
              className="btn btn-secondary btn-sm"
            >
              {l.label} {l.external && '↗'}
            </a>
          ))}
        </div>

        {/* Doc Sections */}
        <div className="grid grid-2" style={{ marginBottom: '2rem' }}>
          {docSections.map((s) => (
            <div key={s.title} className="card" style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{ fontSize: '1.5rem' }}>{s.icon}</span>
                  <h3>{s.title}</h3>
                </div>
                <span className={`badge badge-${s.badgeColor}`}>{s.badge}</span>
              </div>
              <p style={{ marginBottom: '1rem' }}>{s.description}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {s.links.map((l) => (
                  <a
                    key={l.label}
                    href={l.href}
                    target={'external' in l && l.external ? '_blank' : undefined}
                    rel={'external' in l && l.external ? 'noreferrer' : undefined}
                    style={{ fontSize: '0.9rem' }}
                  >
                    → {l.label} {'external' in l && l.external ? '↗' : ''}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Code Examples */}
        <div className="card" style={{ padding: '2rem' }}>
          <h3 style={{ marginBottom: '1.5rem' }}>Quick Start Examples</h3>
          <div className="grid grid-3">
            {codeExamples.map((ex) => (
              <div key={ex.title}>
                <h3 style={{ fontSize: '0.95rem', marginBottom: '0.75rem', color: '#00d4ff' }}>{ex.title}</h3>
                <pre style={codeStyle}>
                  <code>{ex.code}</code>
                </pre>
              </div>
            ))}
          </div>
        </div>

        {/* SDK Section */}
        <div className="card" style={{ padding: '2rem', marginTop: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>XFuel M2M SDK</h3>
          <p style={{ color: '#8a8a9a', marginBottom: '1rem' }}>
            Submit AI tasks, retrieve ZK proofs, and send A2A messages via the M2M API.
          </p>
          <pre style={codeStyle}>
            <code>npm install xfuel-sdk@0.1.0</code>
          </pre>
          <pre style={{ ...codeStyle, marginTop: '0.75rem' }}>
            <code>{`import { XFuelClient } from 'xfuel-sdk';

const xfuel = new XFuelClient({ apiKey: 'your-key' });
const task  = await xfuel.submitInference('llama-3-70b', sender, '1000000');
const result = await xfuel.waitForCompletion(task.task_id);`}</code>
          </pre>
          <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.75rem' }}>
            <a
              href={`${GITHUB_BASE}/sdk/js/README.md`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-primary btn-sm"
            >
              SDK Documentation
            </a>
            <Link to="/circuits" className="btn btn-secondary btn-sm">Explore Circuits</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

const codeStyle: React.CSSProperties = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-sm)',
  padding: '1rem',
  fontSize: '0.8rem',
  fontFamily: 'var(--font-mono)',
  overflow: 'auto',
  lineHeight: 1.6,
  color: '#c0c0d0',
};
