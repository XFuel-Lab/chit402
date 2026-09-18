import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getApiV1 } from '../apiHost';
import { getHostConfig } from '../hostConfig';
import { registerAgent, registerErrorCopy, type RegisterSuccess } from '../lib/agentRegister';
import { saveBookCredentials } from '../lib/bookStorage';

type FormState = 'idle' | 'submitting' | 'success' | 'error';

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleCopy()}>
      {copied ? 'Copied' : `Copy ${label}`}
    </button>
  );
}

export default function Register() {
  const config = getHostConfig();
  const productName = config.name;
  const apiV1 = getApiV1();

  const [agentWallet, setAgentWallet] = useState('');
  const [taskId, setTaskId] = useState('');
  const [formState, setFormState] = useState<FormState>('idle');
  const [errorTitle, setErrorTitle] = useState('');
  const [errorBody, setErrorBody] = useState('');
  const [result, setResult] = useState<RegisterSuccess | null>(null);

  useEffect(() => {
    document.title = `Register agent — hold the book | ${productName}`;
  }, [productName]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const wallet = agentWallet.trim();
    const task = taskId.trim();
    if (!wallet || !task) return;

    setFormState('submitting');
    setErrorTitle('');
    setErrorBody('');
    setResult(null);

    const response = await registerAgent(apiV1, { agentWallet: wallet, task_id: task });

    if (!response.ok) {
      const copy = registerErrorCopy(response.error, response.message);
      setErrorTitle(copy.title);
      setErrorBody(copy.body);
      setFormState('error');
      return;
    }

    setResult(response.data);
    saveBookCredentials({
      agentId: String(response.data.agent_id),
      session: response.data.session,
    });
    setFormState('success');
  };

  const bookHref = result ? `/book?agent_id=${result.agent_id}` : '/book';

  return (
    <div className="page docs-page book-dashboard">
      <div className="container" style={{ maxWidth: 720 }}>
        <header className="page-header">
          <span className="docs-kicker">Register</span>
          <h1>Hold the book after a paid call</h1>
          <p>
            Bind an agent wallet to a collected receipt. You receive <code>agent_id</code> and a
            possession <code>session</code> — the credential for{' '}
            <code>GET|POST /v1/agents/:agent_id/book</code>. Demo receipts do not qualify.
          </p>
        </header>

        <section className="card book-access-card">
          <h2 style={{ fontSize: '1.05rem', marginBottom: '0.75rem' }}>Register agent</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1rem' }}>
            Pay once via <code>POST /v1/chat/completions</code> (USDC collected) → copy{' '}
            <code>task_id</code> from <code>verify_url</code> or receipt headers → register here to
            hold the book.
          </p>
          <form onSubmit={(e) => void handleSubmit(e)} className="book-access-form">
            <label className="book-field">
              <span className="book-field-label">agent wallet (0x…)</span>
              <input
                className="input"
                type="text"
                placeholder="AAWP official or smart-account address"
                value={agentWallet}
                onChange={(e) => setAgentWallet(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label className="book-field">
              <span className="book-field-label">task_id (collected receipt)</span>
              <input
                className="input"
                type="text"
                placeholder="from verify_url or x-xfuel-task-id"
                value={taskId}
                onChange={(e) => setTaskId(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <div className="book-access-actions">
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={!agentWallet.trim() || !taskId.trim() || formState === 'submitting'}
              >
                {formState === 'submitting' ? 'Registering…' : 'Register'}
              </button>
            </div>
          </form>
        </section>

        {formState === 'error' && (
          <section className="card book-state-card">
            <span className="badge badge-orange">Failed</span>
            <h3 style={{ marginTop: '0.75rem' }}>{errorTitle}</h3>
            <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem', maxWidth: '36rem' }}>
              {errorBody}
            </p>
          </section>
        )}

        {formState === 'success' && result && (
          <section className="card book-state-card">
            <span className="badge badge-cyan">Registered</span>
            <h3 style={{ marginTop: '0.75rem' }}>You hold agent {result.agent_id}</h3>
            <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem', maxWidth: '36rem' }}>
              Save these — there is no public index. The session is possession for the book API.
            </p>

            <div style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <div className="book-field-label" style={{ marginBottom: '0.35rem' }}>agent_id</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                  <code style={{ fontFamily: 'var(--font-mono)', fontSize: '1.1rem' }}>{result.agent_id}</code>
                  <CopyButton value={String(result.agent_id)} label="agent_id" />
                </div>
              </div>

              <div>
                <div className="book-field-label" style={{ marginBottom: '0.35rem' }}>session (possession)</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                  <code
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.78rem',
                      wordBreak: 'break-all',
                      maxWidth: '100%',
                    }}
                  >
                    {result.session}
                  </code>
                  <CopyButton value={result.session} label="session" />
                </div>
              </div>

              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                Receipt <code>{result.task_id}</code> · {result.payment.rail} · collected
              </div>
            </div>

            <div className="docs-actions" style={{ marginTop: '1.5rem' }}>
              <Link to={bookHref} className="btn btn-primary btn-sm">
                Open book →
              </Link>
              <Link to="/v1" className="btn btn-secondary btn-sm">
                /v1 gateway
              </Link>
            </div>

            <div className="card" style={{ marginTop: '1.25rem', padding: '1rem 1.25rem' }}>
              <span className="badge badge-purple">Private Spend</span>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', lineHeight: 1.65, marginTop: '0.65rem' }}>
                Your possession session enables <strong>vendor_blind</strong> on inference by default.
                Pass <code>X-XFuel-Session</code> on chat completions — providers see pooled gateway
                traffic, not your buyer topology. <strong>Not prompt confidentiality.</strong>{' '}
                <Link to="/docs/private-spend">Learn more →</Link>
              </p>
            </div>
          </section>
        )}

        <section className="docs-section" style={{ marginTop: '2rem' }}>
          <h2>What qualifies?</h2>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            Only HMAC-valid receipts with <code>payment.collected: true</code> and a real{' '}
            <code>payment.ref</code> (USDC on Base or Solana). The demo key{' '}
            Public demo keys never register. Wrong possession after
            register returns 401/403 on the book — not a public scoreboard.
          </p>
        </section>

        <nav style={{ marginTop: '2rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <Link to="/book" className="btn btn-secondary btn-sm">Principal book</Link>
          <Link to="/docs/chit-in-15-lines" className="btn btn-secondary btn-sm">Drop-in door</Link>
          <Link to="/" className="btn btn-secondary btn-sm">Home</Link>
        </nav>
      </div>
    </div>
  );
}
