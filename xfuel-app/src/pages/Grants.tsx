type ActiveGrant = {
  program: string;
  org: string;
  pool: string;
  type: string;
  color: string;
  applyUrl: string;
  deadline: string;
  backers: string[];
  why: string;
  requirements: { label: string; met: boolean }[];
};

type PipelineGrant = {
  program: string;
  org: string;
  color: string;
  focus: string;
  target: string;
  blocker: string;
};

const activeGrants: ActiveGrant[] = [
  {
    program: 'EASY Residency — Season 3',
    org: 'YZi Labs',
    pool: 'Up to $500K',
    type: 'Incubator / Equity',
    color: '#F0B90B',
    applyUrl: 'https://wkf.ms/3IA5iBk',
    deadline: 'Rolling — Demo Day April 2026',
    backers: ['YZi Labs', 'CertiK ($1M audit pool)'],
    why: 'XFuel maps directly to YZi\'s S3 focus: decentralized compute, DePIN, AI data networks, and privacy-preserving infrastructure. The CertiK audit grant pool is a direct match for our Phase 1 audit scope.',
    requirements: [
      { label: 'ZK-verified AI compute', met: true },
      { label: 'DePIN infrastructure (Theta EdgeCloud, Akash, Bittensor)', met: true },
      { label: 'Privacy-preserving infra (model weights hidden in proofs)', met: true },
      { label: 'On-chain markets (task marketplace + escrow)', met: true },
      { label: 'Open source (MIT licensed)', met: true },
      { label: 'Testnet deployed (17/17 smoke tests)', met: true },
      { label: 'Audit-ready (59/59 checklist items)', met: true },
    ],
  },
  {
    program: 'The Pitch — Global Startup Competition',
    org: 'Deel',
    pool: 'Up to $1M (global champion) · $50K (regional winner)',
    type: 'Seed Competition',
    color: '#FF6B4A',
    applyUrl: 'https://www.deel.com/the-pitch-by-deel/',
    deadline: 'Regional finals → Global finale May 2026',
    backers: ['J.P. Morgan', 'a16z', 'Google', 'Ribbit Ventures', 'Stripe', 'Orrick'],
    why: 'Seed-stage, global, founder-first competition with top-tier backers. XFuel is a strong candidate as a solo-founder AI/DePIN infrastructure project with mainnet contracts and a live product.',
    requirements: [
      { label: 'Seed-stage startup', met: true },
      { label: 'Live product (xfuel.app)', met: true },
      { label: 'Global / borderless team', met: true },
      { label: 'AI infrastructure angle', met: true },
      { label: 'On-chain funding transparency (AngelEscrow)', met: true },
    ],
  },
];

const pipelineGrants: PipelineGrant[] = [
  {
    program: 'Subnet / Ecosystem Grants',
    org: 'Bittensor / TAO',
    color: '#00d4ff',
    focus: 'TAOCircuit — ZK-verified dTAO subnet staking + cross-chain settlement',
    target: 'Q3 2026',
    blocker: 'Awaiting Phase 1 audit completion for credibility with TAO ecosystem reviewers',
  },
  {
    program: 'Ecosystem Grants',
    org: 'Osmosis / Cosmos',
    color: '#8b5cf6',
    focus: 'CosmWasm ZK verifier + IBC relay + XF/OSMO liquidity pool',
    target: 'Q3–Q4 2026',
    blocker: 'IBC reverse bridge pending governance; CosmWasm verifier production-ready',
  },
  {
    program: 'Foundation Grants',
    org: 'Solana Foundation',
    color: '#9945FF',
    focus: 'SolanaAIBridge circuit — Wormhole VAA + ZK attestations for Solana AI tasks',
    target: 'Q4 2026',
    blocker: 'Solana program deployment pending Phase 2 audit scope',
  },
];

const stats = [
  { label: 'Active applications', value: '2' },
  { label: 'Total pool (active)', value: '$15M+' },
  { label: 'Pipeline programs', value: '3' },
  { label: 'Audit readiness', value: '59/59' },
];

export default function Grants() {
  return (
    <div className="page">
      <div className="container">
        <div className="page-header">
          <h1>Grant Applications</h1>
          <p>
            Active applications and pipeline programs XFuel is pursuing for audit funding,
            infrastructure, and ecosystem expansion.
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-4" style={{ marginBottom: '2.5rem' }}>
          {stats.map((s) => (
            <div key={s.label} className="card" style={{ textAlign: 'center' }}>
              <div className="stat-value" style={{ fontSize: '1.5rem' }}>{s.value}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Active Applications */}
        <h2 style={{ marginBottom: '1rem', fontSize: '1.1rem', color: '#8a8a9a', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Active Applications
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginBottom: '3rem' }}>
          {activeGrants.map((g) => (
            <div key={g.program} className="card" style={{ padding: '2rem', borderLeft: `3px solid ${g.color}` }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  <h3 style={{ color: g.color, marginBottom: '0.2rem' }}>{g.program}</h3>
                  <div style={{ color: '#8a8a9a', fontSize: '0.85rem' }}>
                    {g.org} · {g.type} · {g.pool}
                  </div>
                </div>
                <span className="badge badge-cyan">Applying</span>
              </div>

              {/* Deadline + backers */}
              <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                <div style={{ fontSize: '0.85rem' }}>
                  <span style={{ color: '#8a8a9a' }}>Deadline: </span>
                  <span style={{ fontWeight: 600 }}>{g.deadline}</span>
                </div>
                <div style={{ fontSize: '0.85rem' }}>
                  <span style={{ color: '#8a8a9a' }}>Backed by: </span>
                  <span style={{ fontWeight: 600 }}>{g.backers.join(' · ')}</span>
                </div>
              </div>

              {/* Why we fit */}
              <div style={{
                padding: '0.85rem 1rem',
                background: 'rgba(255,255,255,0.03)',
                borderRadius: '8px',
                border: '1px solid rgba(255,255,255,0.06)',
                marginBottom: '1.25rem',
                fontSize: '0.875rem',
                color: '#c0c0d0',
                lineHeight: 1.6,
              }}>
                {g.why}
              </div>

              {/* Requirements checklist */}
              <div style={{ display: 'grid', gap: '0.5rem', marginBottom: '1.5rem' }}>
                {g.requirements.map((r) => (
                  <div key={r.label} style={{
                    display: 'flex', alignItems: 'center', gap: '0.6rem',
                    fontSize: '0.875rem',
                    color: r.met ? '#e0e0f0' : '#8a8a9a',
                  }}>
                    <span style={{
                      width: '18px', height: '18px', borderRadius: '50%', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '0.7rem', fontWeight: 700,
                      background: r.met ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.05)',
                      color: r.met ? '#22c55e' : '#8a8a9a',
                      border: `1px solid ${r.met ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.1)'}`,
                    }}>
                      {r.met ? '✓' : '○'}
                    </span>
                    {r.label}
                  </div>
                ))}
              </div>

              <a
                href={g.applyUrl}
                target="_blank"
                rel="noreferrer"
                className="btn btn-primary"
                style={{ display: 'inline-block' }}
              >
                View Program ↗
              </a>
            </div>
          ))}
        </div>

        {/* Pipeline */}
        <h2 style={{ marginBottom: '1rem', fontSize: '1.1rem', color: '#8a8a9a', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Pipeline — Post-Audit
        </h2>
        <div style={{ display: 'grid', gap: '1rem', marginBottom: '3rem' }}>
          {pipelineGrants.map((g) => (
            <div key={g.program} className="card" style={{
              padding: '1.25rem 1.5rem',
              borderLeft: `3px solid ${g.color}`,
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
              flexWrap: 'wrap', gap: '0.75rem',
            }}>
              <div style={{ flex: 1, minWidth: '200px' }}>
                <div style={{ fontWeight: 600, marginBottom: '0.2rem' }}>
                  <span style={{ color: g.color }}>{g.org}</span>
                  {' '}
                  <span style={{ color: '#c0c0d0', fontWeight: 400 }}>— {g.program}</span>
                </div>
                <div style={{ fontSize: '0.85rem', color: '#8a8a9a', marginBottom: '0.35rem' }}>
                  {g.focus}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#6a6a7a' }}>
                  Blocker: {g.blocker}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.35rem' }}>
                <span className="badge badge-purple">Pipeline</span>
                <span style={{ fontSize: '0.78rem', color: '#8a8a9a' }}>Target: {g.target}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Contact CTA */}
        <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
          <h3 style={{ marginBottom: '0.5rem' }}>Interested in partnering or co-applying?</h3>
          <p style={{ color: '#8a8a9a', maxWidth: '500px', margin: '0 auto 1.5rem' }}>
            Reach out directly — XFuel is open to ecosystem partnerships, co-grant applications,
            and integration conversations.
          </p>
          <a href="mailto:founderxfuel@gmail.com" className="btn btn-primary">
            Contact the Founder ↗
          </a>
        </div>
      </div>
    </div>
  );
}
