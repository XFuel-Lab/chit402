import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

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
  const { data: content, isError: contentError, isPending: contentPending } = useQuery({
    queryKey: ['community-content', CONTENT_URL],
    queryFn: async (): Promise<CommunityContent> => {
      const r = await fetch(CONTENT_URL, { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
    staleTime: 60_000,
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
