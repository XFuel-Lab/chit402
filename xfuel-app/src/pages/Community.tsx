const socialLinks = [
  {
    platform: 'Discord',
    url: 'https://discord.gg/xfuel',
    members: '12,400+',
    description: 'Join the XFuel community for support, discussions, and governance.',
    color: '#5865F2',
  },
  {
    platform: 'Twitter / X',
    url: 'https://twitter.com/XFuelAI',
    members: '28,700+',
    description: 'Follow for protocol updates, partnerships, and ecosystem news.',
    color: '#1DA1F2',
  },
  {
    platform: 'Telegram',
    url: 'https://t.me/xfuelprotocol',
    members: '8,200+',
    description: 'Real-time alerts, price discussions, and community chat.',
    color: '#26A5E4',
  },
  {
    platform: 'GitHub',
    url: 'https://github.com/XFuelAI',
    members: '340+ stars',
    description: 'Open-source protocol code, circuits, and developer tools.',
    color: '#f0f0f5',
  },
];

const upcomingEvents = [
  {
    title: 'Community AMA #12 — Circuit Expansion',
    date: 'Feb 28, 2026',
    time: '6:00 PM UTC',
    platform: 'Discord',
    description: 'Core team discusses the 5 new circuits being developed for Phase 5.',
  },
  {
    title: 'Developer Workshop: SP1 Proving',
    date: 'Mar 5, 2026',
    time: '4:00 PM UTC',
    platform: 'YouTube Live',
    description: 'Hands-on workshop for building custom ZK circuits with SP1 prover.',
  },
  {
    title: 'Theta Network Integration Demo',
    date: 'Mar 12, 2026',
    time: '5:00 PM UTC',
    platform: 'Twitter Spaces',
    description: 'Live demo of edge compute integration with Theta Network nodes.',
  },
];

const believerRound = {
  title: 'Believer Round',
  status: 'Active',
  raised: '$1.2M',
  target: '$2.5M',
  participants: 847,
  minContribution: '$100',
  perks: [
    'Early access to mainnet features',
    'Bonus veXF allocation (2x multiplier)',
    'Exclusive Discord role & channels',
    'Priority partner hook access',
    'Governance proposal creation rights',
  ],
};

const pastAMAs = [
  { title: 'AMA #11 — Bittensor EVM Launch', date: 'Feb 14, 2026', views: '2,400', recording: '#' },
  { title: 'AMA #10 — CertiK Audit Results', date: 'Feb 7, 2026', views: '3,100', recording: '#' },
  { title: 'AMA #9 — Cross-Chain Bridge Architecture', date: 'Jan 31, 2026', views: '1,800', recording: '#' },
  { title: 'AMA #8 — veXF Governance Design', date: 'Jan 24, 2026', views: '2,200', recording: '#' },
];

export default function Community() {
  const believerPercent = (parseFloat(believerRound.raised.replace(/[$,M]/g, '')) / parseFloat(believerRound.target.replace(/[$,M]/g, ''))) * 100;

  return (
    <div className="page">
      <div className="container">
        <div className="page-header">
          <h1>Community</h1>
          <p>Join the XFuel ecosystem — builders, governors, and believers shaping decentralized AI</p>
        </div>

        {/* Social Links */}
        <div className="grid grid-4" style={{ marginBottom: '2rem' }}>
          {socialLinks.map((s) => (
            <a key={s.platform} href={s.url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="card" style={{ textAlign: 'center', height: '100%' }}>
                <h3 style={{ color: s.color, marginBottom: '0.25rem' }}>{s.platform}</h3>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>{s.members}</div>
                <p style={{ fontSize: '0.85rem' }}>{s.description}</p>
              </div>
            </a>
          ))}
        </div>

        <div className="grid grid-2" style={{ marginBottom: '2rem' }}>
          {/* Believer Round */}
          <div className="card" style={{ padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3>{believerRound.title}</h3>
              <span className="badge badge-green">{believerRound.status}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span style={{ color: '#8a8a9a' }}>Raised</span>
              <span style={{ fontWeight: 700 }}>{believerRound.raised} / {believerRound.target}</span>
            </div>
            <div className="progress-bar" style={{ marginBottom: '1rem' }}>
              <div className="progress-bar-fill" style={{ width: `${believerPercent}%` }} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <div>
                <div style={{ color: '#8a8a9a', fontSize: '0.8rem' }}>Participants</div>
                <div style={{ fontWeight: 700 }}>{believerRound.participants}</div>
              </div>
              <div>
                <div style={{ color: '#8a8a9a', fontSize: '0.8rem' }}>Min Contribution</div>
                <div style={{ fontWeight: 700 }}>{believerRound.minContribution}</div>
              </div>
            </div>

            <h3 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>Perks</h3>
            <ul style={{ paddingLeft: '1.25rem', color: '#8a8a9a', fontSize: '0.85rem' }}>
              {believerRound.perks.map((p) => (
                <li key={p} style={{ marginBottom: '0.3rem' }}>{p}</li>
              ))}
            </ul>

            <button className="btn btn-primary" style={{ width: '100%', marginTop: '1.25rem', justifyContent: 'center' }}>
              Join Believer Round
            </button>
          </div>

          {/* Events */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <h3>Upcoming Events</h3>
            {upcomingEvents.map((e) => (
              <div key={e.title} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.25rem' }}>
                  <h3 style={{ fontSize: '0.95rem' }}>{e.title}</h3>
                  <span className="tag">{e.platform}</span>
                </div>
                <div style={{ color: '#00d4ff', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                  {e.date} · {e.time}
                </div>
                <p style={{ fontSize: '0.85rem' }}>{e.description}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Past AMAs */}
        <div className="card" style={{ padding: '2rem' }}>
          <h3 style={{ marginBottom: '1.25rem' }}>Past AMAs & Recordings</h3>
          {pastAMAs.map((a) => (
            <div key={a.title} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{a.title}</div>
                <div style={{ color: '#8a8a9a', fontSize: '0.8rem' }}>{a.date} · {a.views} views</div>
              </div>
              <a href={a.recording} className="btn btn-secondary btn-sm">Watch ↗</a>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
