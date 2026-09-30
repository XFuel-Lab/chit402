import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { getApiHost } from '../apiHost';
import SeoHead from '../components/SeoHead';
import { boardCardModel, jobCardModel, paidThisToo } from '../lib/boardView.mjs';

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

type PublicJob = {
  id: string;
  status: string;
  outcome?: string | null;
  untrusted_text?: string;
  untrusted_acceptance?: string;
  budget?: string;
  deadline?: string;
  output_preview?: string | null;
  related?: boolean;
  bids?: Array<{ id: string; price?: string; eta?: string | null; untrusted_pitch?: string; status?: string; record?: { jobs_won_independent?: number; earned_range?: string } }>;
  payout?: {
    verify_url?: string | null;
    payer_wallet?: string | null;
    payment_ref?: string | null;
    amount?: string;
    winner_wallet?: string | null;
    output_commitment?: { hash?: string | null } | null;
    task_id?: string;
  } | null;
};

const LABEL_TEXT: Record<string, string> = {
  house: 'house',
  self: 'self',
  foreign: 'foreign',
  'stamp-backed': 'stamp-backed',
  'spend-backed': 'spend-backed',
};

function JobCard({ job }: { job: PublicJob }) {
  const card = jobCardModel(job);
  if (!card) return null;
  if (card.status === 'taken_down') {
    return (
      <article style={styles.card}>
        <p style={styles.muted}>Job taken down</p>
      </article>
    );
  }
  return (
    <article style={styles.card}>
      {card.payout && (
        <section style={styles.payout}>
          <p style={styles.payoutKicker}>Payout receipt</p>
          <h2 style={styles.payoutTitle}>
            {card.payout.amount != null ? `$${card.payout.amount}` : 'Paid'}
            {card.outcome ? ` · ${card.outcome}` : ''}
          </h2>
          <dl style={styles.payoutList}>
            {card.payout.payer && <div><dt>Payer</dt><dd>{card.payout.payer}</dd></div>}
            {card.payout.winner && <div><dt>Winner</dt><dd>{card.payout.winner}</dd></div>}
            {card.payout.paymentRef && <div><dt>Payment</dt><dd>{card.payout.paymentRef}</dd></div>}
            {card.payout.outputHash && <div><dt>Output hash</dt><dd>{card.payout.outputHash}</dd></div>}
          </dl>
          {card.payout.verify && (
            <a href={card.payout.verify} style={styles.payoutLink}>Verify payout receipt</a>
          )}
        </section>
      )}
      <header style={styles.cardHead}>
        <h2 style={styles.host}>Job</h2>
        <span style={styles.outcome}>{card.status}</span>
      </header>
      <p style={styles.meta}>
        {card.budget != null ? <span>budget ${card.budget}</span> : null}
        {card.deadline ? <span>{card.deadline}</span> : null}
        {card.related ? <span>related</span> : null}
      </p>
      {card.text ? <p style={styles.text}>{card.text}</p> : null}
      {card.acceptance ? <p style={styles.meta}>{card.acceptance}</p> : null}
      {card.preview ? <p style={styles.meta}>{card.preview}</p> : null}
      {card.bids.length > 0 && (
        <section>
          <h3 style={styles.threadTitle}>Bids</h3>
          {card.bids.map((bid) => (
            <p key={bid.id} style={styles.comment}>
              {bid.price != null ? `$${bid.price}` : ''}
              {bid.status ? ` · ${bid.status}` : ''}
              {bid.earned ? ` · earned ${bid.earned}` : ''}
              {` · ${bid.won} independent`}
              {bid.pitch ? ` — ${bid.pitch}` : ''}
            </p>
          ))}
        </section>
      )}
      <p style={styles.idLine}>
        <Link to={`/board/${card.id}`} style={styles.idLink}>{card.id}</Link>
      </p>
    </article>
  );
}

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
  const [jobs, setJobs] = useState<PublicJob[]>([]);
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
      setJobs([]);
      setEndpoints([]);
      try {
        const jobId = id && id.startsWith('job_');
        const url = new URL(jobId
          ? `${getApiHost()}/v1/board/jobs/${encodeURIComponent(id)}`
          : id
            ? `${getApiHost()}/v1/board/posts/${encodeURIComponent(id)}`
            : `${getApiHost()}/v1/board/posts`);
        if (!id && endpoint) url.searchParams.set('endpoint', endpoint);
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) {
          if (!cancelled) {
            setPosts([]);
            setJobs([]);
            setEndpoints([]);
            setError(res.status === 404 ? 'That post is not on the board.' : 'The board is not available.');
          }
          return;
        }
        const body = await res.json();
        if (cancelled) return;
        if (jobId) {
          setJobs(body.job ? [body.job] : []);
          setPosts([]);
          setEndpoints([]);
        } else if (id) {
          setPosts(body.post ? [body.post] : []);
          setJobs([]);
          setEndpoints([]);
        } else {
          const list = body as ListBody;
          setPosts(Array.isArray(list.posts) ? list.posts : []);
          setEndpoints(Array.isArray(list.endpoints) ? list.endpoints : []);
          const jobsRes = await fetch(`${getApiHost()}/v1/board/jobs`, { cache: 'no-store' });
          if (!cancelled && jobsRes.ok) {
            const jobsBody = await jobsRes.json();
            setJobs(Array.isArray(jobsBody.jobs) ? jobsBody.jobs : []);
          }
        }
      } catch {
        if (!cancelled) {
          setPosts([]);
          setJobs([]);
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
        title="Board — reports and jobs | Chit402"
        description="Endpoint reports and paid jobs. A closed job shows its payout receipt: payer, payment, amount, winner, and the hash of the work."
      />
      <div className="container" style={{ maxWidth: 800 }}>
        <header className="page-header" style={{ maxWidth: '38rem' }}>
          <span className="docs-kicker">Board</span>
          <h1>Board</h1>
          <p>
            A report is a payment someone already made, plus a $0.002 stamp.
            Text on this page is untrusted and shown as plain text.
          </p>
          <p>
            A job is a bid. When it is paid, the payout receipt is the proof.
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

        {!loading && !error && jobs.length > 0 && (
          <section style={styles.summary}>
            <h2 style={styles.summaryTitle}>Jobs</h2>
            <div style={styles.list}>
              {jobs.map((job) => <JobCard key={job.id} job={job} />)}
            </div>
          </section>
        )}

        {!loading && !error && posts.length === 0 && !id?.startsWith('job_') && (
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
  payout: {
    border: '1px solid #00d4ff',
    borderRadius: 12,
    padding: '1rem 1.1rem',
    marginBottom: '1rem',
    background: '#07141a',
  },
  payoutKicker: { color: '#00d4ff', fontSize: '0.8rem', letterSpacing: '0.04em', margin: 0 },
  payoutTitle: { fontSize: '1.6rem', margin: '0.25rem 0 0.6rem' },
  payoutList: { margin: 0 },
  payoutLink: { color: '#00d4ff', fontWeight: 650, fontSize: '1.05rem' },
  comment: { whiteSpace: 'pre-wrap', margin: '0.35rem 0', color: '#f4f4f5' },
};
