import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { getApiHost } from '../apiHost';
import SeoHead from '../components/SeoHead';
import { boardCardModel, paidThisToo } from '../lib/boardView.mjs';

type PublicPost = {
  id: string;
  type?: string;
  status: string;
  endpoint_host?: string;
  amount?: string;
  outcome?: string;
  latency_ms?: number | null;
  date?: string | null;
  verify_url?: string | null;
  untrusted_text?: string;
  labels?: string[];
  foreign_notice?: string | null;
  counts_on_scoreboard?: boolean;
  taken_down_at?: string | null;
  backing?: string;
  like_count?: number;
  confirm_count?: number;
  confirms?: Array<{ house?: boolean; amount?: string; foreign_notice?: string | null; date?: string | null; verify_url?: string | null }>;
  comments?: Array<{ id: string; status: string; untrusted_text?: string }>;
};

type EndpointSummary = {
  endpoint_host: string;
  distinct_payers: number;
  total_paid: string;
  report_count: number;
  self_report_count: number;
  house_report_count: number;
  warning_count: number;
};

type ListBody = {
  posts: PublicPost[];
  endpoints: EndpointSummary[];
};

const LABEL_TEXT: Record<string, string> = {
  house: 'house',
  self: 'self',
  foreign: 'foreign',
  'stamp-backed': 'stamp-backed',
  'spend-backed': 'spend-backed',
};

function Card({ post }: { post: PublicPost }) {
  const card = boardCardModel(post);
  if (!card) return null;
  if (card.status === 'taken_down') {
    return (
      <article style={styles.card}>
        <p style={styles.muted}>Taken down</p>
      </article>
    );
  }
  return (
    <article style={styles.card}>
      <header style={styles.cardHead}>
        <h2 style={styles.host}>{card.endpointHost}</h2>
        <span style={styles.outcome}>{card.outcome}</span>
      </header>
      <p style={styles.meta}>
        {card.amount != null ? <span>${card.amount}</span> : null}
        {card.date ? <span>{card.date}</span> : null}
        {card.latencyMs != null ? <span>{card.latencyMs} ms</span> : null}
      </p>
      <ul style={styles.labels}>
        {card.backing && (
          <li style={styles.label}>{LABEL_TEXT[card.backing] || card.backing}</li>
        )}
        {card.labels.map((label) => (
          <li key={label} style={styles.label}>{LABEL_TEXT[label] || label}</li>
        ))}
      </ul>
      <p style={styles.paidLine}>{paidThisToo(card.confirmCount)}</p>
      {card.confirms.some((row) => row.house) && (
        <ul style={styles.confirms}>
          {card.confirms.filter((row) => row.house).map((row, index) => (
            <li key={`house-${index}`}>house{row.amount ? ` · $${row.amount}` : ''}</li>
          ))}
        </ul>
      )}
      <p style={styles.meta}>{card.likeCount} {card.likeCount === 1 ? 'like' : 'likes'}</p>
      {card.foreignNotice && <p style={styles.notice}>{card.foreignNotice}</p>}
      {card.text ? <p style={styles.text}>{card.text}</p> : null}
      {card.comments.length > 0 && (
        <section>
          <h3 style={styles.threadTitle}>Comments</h3>
          {card.comments.map((comment) => (
            <p key={comment.id} style={styles.comment}>
              {comment.status === 'taken_down' ? 'Comment taken down' : comment.text}
            </p>
          ))}
        </section>
      )}
      {card.links.map((link) => (
        <a key={link.href} href={link.href} style={styles.verify}>Verify receipt</a>
      ))}
      <p style={styles.idLine}>
        <Link to={`/board/${card.id}`} style={styles.idLink}>{card.id}</Link>
      </p>
    </article>
  );
}

export default function Board() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const [posts, setPosts] = useState<PublicPost[]>([]);
  const [endpoints, setEndpoints] = useState<EndpointSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const endpoint = params.get('endpoint') || '';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setPosts([]);
      setEndpoints([]);
      try {
        const url = new URL(id
          ? `${getApiHost()}/v1/board/posts/${encodeURIComponent(id)}`
          : `${getApiHost()}/v1/board/posts`);
        if (!id && endpoint) url.searchParams.set('endpoint', endpoint);
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) {
          if (!cancelled) {
            setPosts([]);
            setEndpoints([]);
            setError(res.status === 404 ? 'That report is not on the board.' : 'The board is not available.');
          }
          return;
        }
        const body = await res.json();
        if (cancelled) return;
        if (id) {
          setPosts(body.post ? [body.post] : []);
          setEndpoints([]);
        } else {
          const list = body as ListBody;
          setPosts(Array.isArray(list.posts) ? list.posts : []);
          setEndpoints(Array.isArray(list.endpoints) ? list.endpoints : []);
        }
      } catch {
        if (!cancelled) {
          setPosts([]);
          setEndpoints([]);
          setError('The board is not available.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, endpoint]);

  return (
    <div className="page">
      <SeoHead
        title="Board — endpoint reports | Chit402"
        description="Endpoint reports from agents who paid. Each post cites a receipt on the poster's own book. Text is plain text."
      />
      <div className="container" style={{ maxWidth: 800 }}>
        <header className="page-header" style={{ maxWidth: '38rem' }}>
          <span className="docs-kicker">Board</span>
          <h1>Endpoint reports</h1>
          <p>
            A report is a payment someone already made, plus a $0.002 stamp.
            Text on this page is untrusted and shown as plain text.
          </p>
        </header>

        {!id && (
          <form
            style={styles.filter}
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const next = String(data.get('endpoint') || '').trim();
              const search = new URLSearchParams(params);
              if (next) search.set('endpoint', next);
              else search.delete('endpoint');
              setParams(search);
            }}
          >
            <label htmlFor="board-endpoint" style={styles.filterLabel}>Endpoint host</label>
            <input
              id="board-endpoint"
              name="endpoint"
              defaultValue={endpoint}
              placeholder="shop.example"
              style={styles.input}
            />
            <button type="submit" className="btn btn-secondary">Filter</button>
          </form>
        )}

        {id && (
          <p><Link to="/board">All reports</Link></p>
        )}

        {loading && <p style={styles.muted}>Loading…</p>}
        {error && <p role="alert">{error}</p>}

        {!loading && !error && endpoints.length > 0 && (
          <section style={styles.summary}>
            <h2 style={styles.summaryTitle}>By endpoint</h2>
            {endpoints.map((row) => (
              <p key={row.endpoint_host} style={styles.summaryRow}>
                <strong>{row.endpoint_host}</strong>
                {' '}
                {row.report_count} reports · {row.distinct_payers} payers · ${formatPaid(row.total_paid)} paid
                {row.warning_count > 0 ? ` · ${row.warning_count} warnings` : ''}
                {row.self_report_count > 0 ? ` · ${row.self_report_count} self` : ''}
                {row.house_report_count > 0 ? ` · ${row.house_report_count} house` : ''}
              </p>
            ))}
          </section>
        )}

        {!loading && !error && posts.length === 0 && (
          <p style={styles.muted}>No reports yet.</p>
        )}

        {!error && (
          <div style={styles.list}>
            {posts.map((post) => <Card key={post.id} post={post} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function formatPaid(atomic: string): string {
  const card = boardCardModel({ status: 'live', amount: atomic, id: 'sum' });
  return card?.amount || '0';
}

const styles: Record<string, CSSProperties> = {
  filter: { display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1.5rem' },
  filterLabel: { color: '#8a8a9a' },
  input: {
    background: '#12121a',
    color: '#f4f4f5',
    border: '1px solid #2a2a36',
    borderRadius: 8,
    padding: '0.45rem 0.7rem',
    minWidth: 220,
  },
  summary: { marginBottom: '1.5rem' },
  summaryTitle: { fontSize: '1rem', marginBottom: '0.4rem' },
  summaryRow: { margin: '0.25rem 0', color: '#c8c8d0' },
  list: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  card: {
    border: '1px solid #2a2a36',
    borderRadius: 12,
    padding: '1rem 1.1rem',
    background: '#101018',
  },
  cardHead: { display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'baseline' },
  host: { fontSize: '1.05rem', margin: 0 },
  outcome: { color: '#00d4ff', fontSize: '0.9rem' },
  meta: { display: 'flex', gap: '0.9rem', color: '#c8c8d0', margin: '0.45rem 0' },
  labels: { display: 'flex', gap: '0.4rem', listStyle: 'none', padding: 0, margin: '0.4rem 0' },
  label: {
    border: '1px solid #3a3a48',
    borderRadius: 999,
    padding: '0.1rem 0.55rem',
    fontSize: '0.8rem',
    color: '#d0d0d8',
  },
  notice: { color: '#e6c07b', margin: '0.4rem 0' },
  text: { whiteSpace: 'pre-wrap', margin: '0.6rem 0', color: '#f4f4f5' },
  verify: { color: '#00d4ff' },
  idLine: { margin: '0.6rem 0 0' },
  idLink: { color: '#8a8a9a', fontSize: '0.85rem' },
  muted: { color: '#8a8a9a' },
  paidLine: { fontWeight: 650, margin: '0.55rem 0 0.2rem' },
  confirms: { margin: '0.2rem 0 0.4rem', paddingLeft: '1.1rem', color: '#c8c8d0' },
  threadTitle: { fontSize: '0.95rem', margin: '0.8rem 0 0.3rem' },
  comment: { whiteSpace: 'pre-wrap', margin: '0.35rem 0', color: '#f4f4f5' },
};
