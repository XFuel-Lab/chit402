import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useReadContract } from 'wagmi';
import { formatEther } from 'viem';
import { ADDRESSES, ANGEL_ROUND_ABI, BELIEVER_ROUND_ABI, THETA_MAINNET_ID, isDeployed } from '../contracts';

type SocialLink = {
  platform: string;
  url: string;
  statLabel: string;
  description: string;
  color: string;
  kind?: string;
};

type CommunityContent = {
  version: number;
  socialLinks: SocialLink[];
  upcomingEvents: Array<{
    title: string;
    date: string;
    time: string;
    platform: string;
    description: string;
  }>;
  pastAMAs: Array<{
    title: string;
    date: string;
    views: string;
    recordingUrl: string;
  }>;
};

const CONTENT_URL = (import.meta.env.VITE_COMMUNITY_CONTENT_URL || '/community-content.json') as string;

export default function Community() {
  const believerAddr = ADDRESSES.believerRound;
  const angelAddr = ADDRESSES.angelRound;
  const believerOn = isDeployed(believerAddr);
  const angelOn = isDeployed(angelAddr);

  const { data: content, isError: contentError, isPending: contentPending } = useQuery({
    queryKey: ['community-content', CONTENT_URL],
    queryFn: async (): Promise<CommunityContent> => {
      const r = await fetch(CONTENT_URL, { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
    staleTime: 60_000,
  });

  const { data: bStats } = useReadContract({
    address: believerAddr,
    abi: BELIEVER_ROUND_ABI,
    functionName: 'getStats',
    chainId: THETA_MAINNET_ID,
    query: { enabled: believerOn, refetchInterval: 30_000 },
  });

  const { data: aStats } = useReadContract({
    address: angelAddr,
    abi: ANGEL_ROUND_ABI,
    functionName: 'getStats',
    chainId: THETA_MAINNET_ID,
    query: { enabled: angelOn, refetchInterval: 30_000 },
  });

  const { data: ghRepo } = useQuery({
    queryKey: ['github-repo-stars', 'XFuel-Lab', 'xfuel-protocol'],
    queryFn: async (): Promise<{ stargazers_count: number } | null> => {
      const r = await fetch('https://api.github.com/repos/XFuel-Lab/xfuel-protocol');
      if (!r.ok) return null;
      return r.json();
    },
    staleTime: 5 * 60_000,
  });

  const social = content?.socialLinks ?? [];
  const events = content?.upcomingEvents ?? [];
  const amas = content?.pastAMAs ?? [];

  const believerLabels = ['Open', 'Closed', 'TGE live', 'Refunding'];
  const angelLabels = ['Open', 'Closed', 'TGE live'];

  const believerPct =
    believerOn && bStats && bStats[4] > 0n
      ? Math.min(100, Number((bStats[0] * 10000n) / bStats[4]) / 100)
      : 0;

  const angelPct =
    angelOn && aStats && aStats[4] > 0n ? Math.min(100, Number((aStats[0] * 10000n) / aStats[4]) / 100) : 0;

  return (
    <div className="page">
      <div className="container">
        <div className="page-header">
          <h1>Community</h1>
          <p>Join the XFuel ecosystem — builders, governors, and believers shaping decentralized AI</p>
        </div>

        {contentError && (
          <p style={{ fontSize: '0.85rem', color: '#fbbf24', marginBottom: '1rem' }}>
            Could not load community-content.json ({CONTENT_URL}). Social cards and events may be empty — check the file in{' '}
            <code style={{ fontFamily: 'var(--font-mono)' }}>public/</code> or set <code style={{ fontFamily: 'var(--font-mono)' }}>VITE_COMMUNITY_CONTENT_URL</code>.
          </p>
        )}

        {contentPending && (
          <p style={{ fontSize: '0.85rem', color: '#8a8a9a', marginBottom: '1rem' }}>Loading community links &amp; events…</p>
        )}

        <div className="grid grid-4" style={{ marginBottom: '2rem' }}>
          {social.map((s) => {
            const ghLabel =
              s.kind !== 'github'
                ? s.statLabel || '—'
                : ghRepo === undefined
                  ? '…'
                  : ghRepo === null
                    ? 'Open source'
                    : `${ghRepo.stargazers_count.toLocaleString()} stars`;
            return (
              <a key={s.platform} href={s.url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="card" style={{ textAlign: 'center', height: '100%' }}>
                  <h3 style={{ color: s.color, marginBottom: '0.25rem' }}>{s.platform}</h3>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>{ghLabel}</div>
                  <p style={{ fontSize: '0.85rem' }}>{s.description}</p>
                </div>
              </a>
            );
          })}
        </div>

        <p style={{ fontSize: '0.78rem', color: '#55556a', marginBottom: '1.5rem' }}>
          Discord / GitHub counts: run <code style={{ fontFamily: 'var(--font-mono)' }}>npm run sync:community</code> in{' '}
          <code style={{ fontFamily: 'var(--font-mono)' }}>xfuel-app</code> before build. Twitter / Telegram stay manual in{' '}
          <code style={{ fontFamily: 'var(--font-mono)' }}>public/community-content.json</code>.
        </p>

        <div className="grid grid-2" style={{ marginBottom: '2rem' }}>
          <div className="card" style={{ padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3>Community round</h3>
              {!believerOn ? (
                <span className="badge badge-orange">Not configured</span>
              ) : (
                <span className="badge badge-green">{believerLabels[Number(bStats?.[5] ?? 0)] ?? '—'}</span>
              )}
            </div>

            {believerOn && bStats ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span style={{ color: '#8a8a9a' }}>TFUEL committed</span>
                  <span style={{ fontWeight: 700 }}>
                    {Number(formatEther(bStats[0])).toLocaleString(undefined, { maximumFractionDigits: 2 })} /{' '}
                    {Number(formatEther(bStats[4])).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                </div>
                <div className="progress-bar" style={{ marginBottom: '1rem' }}>
                  <div className="progress-bar-fill" style={{ width: `${believerPct}%` }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1.25rem' }}>
                  <div>
                    <div style={{ color: '#8a8a9a', fontSize: '0.8rem' }}>Participants</div>
                    <div style={{ fontWeight: 700 }}>{bStats[1].toString()}</div>
                  </div>
                  <div>
                    <div style={{ color: '#8a8a9a', fontSize: '0.8rem' }}>Min commitment</div>
                    <div style={{ fontWeight: 700 }}>100 TFUEL</div>
                  </div>
                </div>
              </>
            ) : (
              <p style={{ color: '#8a8a9a', fontSize: '0.9rem' }}>Set VITE_BELIEVER_ROUND_ADDRESS to show live progress from the contract.</p>
            )}

            <h3 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>Highlights</h3>
            <ul style={{ paddingLeft: '1.25rem', color: '#8a8a9a', fontSize: '0.85rem' }}>
              <li style={{ marginBottom: '0.3rem' }}>On-chain commitment; refund path if TGE not triggered (see contract)</li>
              <li style={{ marginBottom: '0.3rem' }}>Optional lock tiers for bonus XF</li>
              <li style={{ marginBottom: '0.3rem' }}>Governance participation via veXF after you hold XF</li>
            </ul>

            <Link to="/believers" className="btn btn-primary" style={{ width: '100%', marginTop: '1.25rem', justifyContent: 'center', display: 'flex' }}>
              Open community round
            </Link>
          </div>

          <div className="card" style={{ padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3>Angel round</h3>
              {!angelOn ? (
                <span className="badge badge-orange">Not configured</span>
              ) : (
                <span className="badge badge-green">{angelLabels[Number(aStats?.[5] ?? 0)] ?? '—'}</span>
              )}
            </div>

            {angelOn && aStats ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span style={{ color: '#8a8a9a' }}>TFUEL committed</span>
                  <span style={{ fontWeight: 700 }}>
                    {Number(formatEther(aStats[0])).toLocaleString(undefined, { maximumFractionDigits: 2 })} /{' '}
                    {Number(formatEther(aStats[4])).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                </div>
                <div className="progress-bar" style={{ marginBottom: '1rem' }}>
                  <div className="progress-bar-fill" style={{ width: `${angelPct}%`, background: 'linear-gradient(90deg, #a855f7, #f97316)' }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
                  <div>
                    <div style={{ color: '#8a8a9a', fontSize: '0.8rem' }}>Angels</div>
                    <div style={{ fontWeight: 700 }}>{aStats[1].toString()}</div>
                  </div>
                  <div>
                    <div style={{ color: '#8a8a9a', fontSize: '0.8rem' }}>Pre-TGE treasury pulled</div>
                    <div style={{ fontWeight: 700, color: '#fdba74' }}>
                      {Number(formatEther(aStats[7])).toLocaleString(undefined, { maximumFractionDigits: 2 })} TFUEL
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <p style={{ color: '#8a8a9a', fontSize: '0.9rem' }}>Set VITE_ANGEL_ROUND_ADDRESS for live Angel round stats (separate from Believers).</p>
            )}

            <Link to="/angels" className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center', display: 'flex' }}>
              Open Angel round
            </Link>
          </div>
        </div>

        <div style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <h3>Upcoming events</h3>
            {events.map((e) => (
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

        <div className="card" style={{ padding: '2rem' }}>
          <h3 style={{ marginBottom: '1.25rem' }}>Past AMAs & recordings</h3>
          {amas.map((a) => (
            <div
              key={a.title}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.75rem 0',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{a.title}</div>
                <div style={{ color: '#8a8a9a', fontSize: '0.8rem' }}>
                  {a.date} · {a.views} views
                </div>
              </div>
              <a href={a.recordingUrl} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
                Open ↗
              </a>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
