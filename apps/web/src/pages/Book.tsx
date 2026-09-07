import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getApiHost, getApiV1 } from '../apiHost';
import { getHostConfig } from '../hostConfig';
import {
  type AgentBookResponse,
  type BookFetchError,
  type BookPolicy,
  computeBurnRate,
  computeModelMix,
  fetchAgentBook,
  fetchBookExport,
  fetchBookPolicy,
  formatCollectedAt,
  formatUsdc,
  parseUsdcInput,
  setBookPolicy,
  summarizePaymentRef,
  verifyUrlFor,
  type ModelMixItem,
  type PolicyType,
} from '../lib/agentBook';
import BookEscrowPanel from '../components/BookEscrowPanel';
import PrivateSpendCallout from '../components/PrivateSpendCallout';
import {
  clearBookCredentials,
  loadBookCredentials,
  resolveBookCredentials,
  saveBookCredentials,
} from '../lib/bookStorage';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

const MODEL_COLORS = ['#00d4ff', '#8b5cf6', '#22c55e', '#f59e0b', '#ec4899', '#14b8a6'];

function errorCopy(error: BookFetchError): { title: string; body: string } {
  if (error === 'unauth') {
    return {
      title: 'Possession required',
      body: 'Add your agent session from POST /v1/agents/register. API keys and demo keys are not possession.',
    };
  }
  if (error === 'forbidden') {
    return {
      title: 'Wrong possession or unknown agent',
      body: 'The session does not match this agent_id, or the agent does not exist. There is no public index — check both values from your register response.',
    };
  }
  return {
    title: 'Could not reach the gateway',
    body: 'Network or parse error talking to the book API. Retry when online.',
  };
}

function budgetPct(spent: string, cap: string | null): number {
  if (!cap) return 0;
  try {
    const s = BigInt(spent);
    const c = BigInt(cap);
    if (c <= 0n) return 0;
    const pct = Number((s * 10000n) / c) / 100;
    return Math.min(100, Math.max(0, pct));
  } catch {
    return 0;
  }
}

export default function Book() {
  const config = getHostConfig();
  const productName = config.name;
  const apiHost = getApiHost();
  const apiV1 = getApiV1();
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionStrippedRef = useRef(false);
  const autoLoadKeyRef = useRef<string | null>(null);

  const [agentIdInput, setAgentIdInput] = useState('');
  const [sessionInput, setSessionInput] = useState('');
  const [showSession, setShowSession] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [credentialHint, setCredentialHint] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<BookFetchError | null>(null);
  const [book, setBook] = useState<AgentBookResponse | null>(null);
  const [budgetDraft, setBudgetDraft] = useState('');
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [budgetMessage, setBudgetMessage] = useState<string | null>(null);
  const [policy, setPolicy] = useState<BookPolicy | null>(null);
  const [policyMessage, setPolicyMessage] = useState<string | null>(null);
  const [policySaving, setPolicySaving] = useState(false);
  const [killSwitch, setKillSwitch] = useState(false);
  const [dailyCapDraft, setDailyCapDraft] = useState('');
  const [hourlyCapDraft, setHourlyCapDraft] = useState('');
  const [modelAllowlistDraft, setModelAllowlistDraft] = useState('');
  const [tier2AboveDraft, setTier2AboveDraft] = useState('');
  const [requirePaymentRef, setRequirePaymentRef] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  useEffect(() => {
    document.title = `Principal book — spend dashboard | ${productName}`;
  }, [productName]);

  const loadPolicy = useCallback(async (agentId: number, session: string) => {
    const result = await fetchBookPolicy(apiV1, { agentId, session });
    if (!result.ok) return;
    const p = result.data.policy;
    setPolicy(p);
    setKillSwitch(!!p?.kill_switch);
    setDailyCapDraft(p?.daily_cap?.limit ? formatUsdc(p.daily_cap.limit) : '');
    setHourlyCapDraft(p?.hourly_cap?.limit ? formatUsdc(p.hourly_cap.limit) : '');
    setModelAllowlistDraft(p?.model_allowlist?.join(', ') || '');
    setTier2AboveDraft(p?.tier2_above?.threshold ? formatUsdc(p.tier2_above.threshold) : '');
    setRequirePaymentRef(!!p?.require_payment_ref);
  }, [apiV1]);

  useEffect(() => {
    const saved = loadBookCredentials();
    const resolved = resolveBookCredentials(
      { agentId: searchParams.get('agent_id'), session: searchParams.get('session') },
      saved,
    );
    setAgentIdInput(resolved.agentId);
    setSessionInput(resolved.session);

    if (resolved.agentId.trim() && resolved.session.trim()) {
      saveBookCredentials({ agentId: resolved.agentId.trim(), session: resolved.session.trim() });
    }

    if (resolved.sessionFromUrl && !sessionStrippedRef.current) {
      sessionStrippedRef.current = true;
      const next = new URLSearchParams(searchParams);
      next.delete('session');
      setSearchParams(next, { replace: true });
    }

    const id = Number(resolved.agentId.trim());
    const session = resolved.session.trim();
    const loadKey = `${id}:${session}`;
    if (Number.isInteger(id) && id >= 1 && session && autoLoadKeyRef.current !== loadKey) {
      autoLoadKeyRef.current = loadKey;
      void (async () => {
        setLoadState('loading');
        setFetchError(null);
        setCredentialHint(null);
        const result = await fetchAgentBook(apiV1, { agentId: id, session, limit: 50 });
        if (!result.ok) {
          setBook(null);
          setFetchError(result.error);
          setLoadState('error');
          return;
        }
        setBook(result.data);
        setLoadState('ready');
        if (result.data.cap != null) {
          setBudgetDraft(formatUsdc(result.data.cap));
        }
        void loadPolicy(id, session);
      })();
    }
  }, [apiV1, loadPolicy, searchParams, setSearchParams]);

  const loadBook = useCallback(async (opts?: { budget?: string | null }) => {
    const agentId = Number(agentIdInput.trim());
    const session = sessionInput.trim();
    if (!Number.isInteger(agentId) || agentId < 1 || !session) {
      setLoadState('idle');
      setBook(null);
      setFetchError(null);
      if (!session.trim()) {
        setCredentialHint('Paste the possession session from POST /v1/agents/register.');
      } else if (!Number.isInteger(agentId) || agentId < 1) {
        setCredentialHint('Enter a valid agent_id (positive integer from register).');
      } else {
        setCredentialHint('Enter agent_id and session to load the book.');
      }
      return;
    }

    setCredentialHint(null);
    saveBookCredentials({ agentId: String(agentId), session });
    setLoadState('loading');
    setFetchError(null);
    setBudgetMessage(null);

    const result = await fetchAgentBook(apiV1, {
      agentId,
      session,
      limit: 50,
      ...(opts && Object.prototype.hasOwnProperty.call(opts, 'budget') ? { budget: opts.budget } : {}),
    });

    if (!result.ok) {
      setBook(null);
      setFetchError(result.error);
      setLoadState('error');
      return;
    }

    setBook(result.data);
    setLoadState('ready');
    if (result.data.cap != null) {
      setBudgetDraft(formatUsdc(result.data.cap));
    } else {
      setBudgetDraft('');
    }
    void loadPolicy(agentId, session);
  }, [agentIdInput, apiV1, loadPolicy, sessionInput]);

  const burnRate = useMemo(
    () => (book ? computeBurnRate(book.entries, 24) : null),
    [book],
  );
  const modelMix = useMemo(
    () => (book ? computeModelMix(book.entries) : []),
    [book],
  );
  const spentPct = book ? budgetPct(book.spent, book.cap) : 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void loadBook();
  };

  const handleSetBudget = async (clear: boolean) => {
    const agentId = Number(agentIdInput.trim());
    const session = sessionInput.trim();
    if (!Number.isInteger(agentId) || agentId < 1 || !session) return;

    let budget: string | null;
    if (clear) {
      budget = null;
    } else {
      const parsed = parseUsdcInput(budgetDraft);
      if (parsed == null) {
        setBudgetMessage('Enter a valid USDC amount (up to 6 decimals), or clear for unlimited.');
        return;
      }
      budget = parsed;
    }

    setBudgetSaving(true);
    setBudgetMessage(null);
    const result = await fetchAgentBook(apiV1, { agentId, session, limit: 50, budget });
    setBudgetSaving(false);

    if (!result.ok) {
      setBudgetMessage(errorCopy(result.error).body);
      return;
    }
    setBook(result.data);
    setBudgetMessage(clear ? 'Budget cleared — unlimited ceiling.' : 'Budget updated.');
    if (result.data.cap != null) {
      setBudgetDraft(formatUsdc(result.data.cap));
    } else {
      setBudgetDraft('');
    }
  };

  const handleSavePolicy = async () => {
    const agentId = Number(agentIdInput.trim());
    const session = sessionInput.trim();
    if (!Number.isInteger(agentId) || agentId < 1 || !session) return;

    setPolicySaving(true);
    setPolicyMessage(null);

    const updates: Array<{ type: PolicyType; value: unknown }> = [
      { type: 'kill_switch', value: killSwitch },
      { type: 'require_payment_ref', value: requirePaymentRef },
    ];

    const dailyParsed = dailyCapDraft.trim() ? parseUsdcInput(dailyCapDraft) : null;
    if (dailyCapDraft.trim() && dailyParsed == null) {
      setPolicySaving(false);
      setPolicyMessage('Daily cap: enter a valid USDC amount or leave empty to clear.');
      return;
    }
    updates.push({ type: 'daily_cap', value: dailyParsed });

    const hourlyParsed = hourlyCapDraft.trim() ? parseUsdcInput(hourlyCapDraft) : null;
    if (hourlyCapDraft.trim() && hourlyParsed == null) {
      setPolicySaving(false);
      setPolicyMessage('Hourly cap: enter a valid USDC amount or leave empty to clear.');
      return;
    }
    updates.push({ type: 'hourly_cap', value: hourlyParsed });

    const allowlist = modelAllowlistDraft.trim()
      ? modelAllowlistDraft.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean)
      : null;
    updates.push({ type: 'model_allowlist', value: allowlist });

    const tier2Parsed = tier2AboveDraft.trim() ? parseUsdcInput(tier2AboveDraft) : null;
    if (tier2AboveDraft.trim() && tier2Parsed == null) {
      setPolicySaving(false);
      setPolicyMessage('Tier-2 threshold: enter a valid USDC amount or leave empty to clear.');
      return;
    }
    updates.push({ type: 'tier2_above', value: tier2Parsed });

    for (const u of updates) {
      const result = await setBookPolicy(apiV1, { agentId, session, policyType: u.type, value: u.value });
      if (!result.ok) {
        setPolicySaving(false);
        setPolicyMessage(result.message || errorCopy(result.error).body);
        return;
      }
      setPolicy(result.data.policy);
    }

    setPolicySaving(false);
    setPolicyMessage('Policy saved.');
  };

  const handleExport = async (format: 'csv' | 'json' | 'html') => {
    const agentId = Number(agentIdInput.trim());
    const session = sessionInput.trim();
    if (!Number.isInteger(agentId) || agentId < 1 || !session) return;

    setExportMessage(null);
    const result = await fetchBookExport(apiV1, { agentId, session, format, limit: 200 });
    if (!result.ok) {
      setExportMessage(errorCopy(result.error).body);
      return;
    }

    if (format === 'html') {
      const text = await result.blob.text();
      const w = window.open('', '_blank');
      if (w) {
        w.document.write(text);
        w.document.close();
      }
      setExportMessage('Audit pack opened — use Print to PDF in your browser.');
      return;
    }

    const url = URL.createObjectURL(result.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.filename || `chit402-book-${agentId}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
    setExportMessage(format === 'csv' ? 'CSV downloaded.' : 'JSON audit pack downloaded.');
  };

  const hasCredentials = agentIdInput.trim() && sessionInput.trim();

  return (
    <div className="page docs-page book-dashboard">
      <div className="container">
        <header className="page-header">
          <span className="docs-kicker">Principal book</span>
          <h1>This agent spent Y on this job.</h1>
          <p>
            Possession-gated spend dashboard for the principal who funds agents. Last-N collected
            rows from <code>GET|POST /v1/agents/:agent_id/book</code> — not a public index. Demo
            never writes the book.
          </p>
        </header>

        <section className="card book-access-card">
          <h2 style={{ fontSize: '1.05rem', marginBottom: '0.75rem' }}>Hold the book</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1rem', maxWidth: '40rem' }}>
            Enter <code>agent_id</code> and the possession <code>session</code> from{' '}
            <code>POST /v1/agents/register</code> (issued after a collected receipt). Sent as{' '}
            <code>X-XFuel-Session</code> — same credential the API already expects.
          </p>
          <form onSubmit={handleSubmit} className="book-access-form">
            <label className="book-field">
              <span className="book-field-label">agent_id</span>
              <input
                className="input"
                type="number"
                min={1}
                step={1}
                placeholder="e.g. 7"
                value={agentIdInput}
                onChange={(e) => {
                  setAgentIdInput(e.target.value);
                  setCredentialHint(null);
                }}
                autoComplete="off"
              />
            </label>
            <label className="book-field">
              <span className="book-field-label">session (possession)</span>
              <div className="book-session-row">
                <input
                  className="input"
                  type={showSession ? 'text' : 'password'}
                  placeholder="from register response"
                  value={sessionInput}
                  onChange={(e) => {
                    setSessionInput(e.target.value);
                    setCredentialHint(null);
                  }}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowSession((v) => !v)}
                >
                  {showSession ? 'Hide' : 'Show'}
                </button>
              </div>
            </label>
            <div className="book-access-actions">
              <button type="submit" className="btn btn-primary btn-sm" disabled={!hasCredentials || loadState === 'loading'}>
                {loadState === 'loading' ? 'Loading…' : 'Load book'}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  clearBookCredentials();
                  setAgentIdInput('');
                  setSessionInput('');
                  setBook(null);
                  setLoadState('idle');
                  setFetchError(null);
                  setCredentialHint(null);
                }}
              >
                Clear
              </button>
            </div>
            {credentialHint && (
              <p className="book-credential-hint" role="alert">
                {credentialHint}
              </p>
            )}
          </form>
        </section>

        {!hasCredentials && loadState === 'idle' && !credentialHint && (
          <section className="card book-state-card">
            <span className="badge badge-purple">No possession</span>
            <h3 style={{ marginTop: '0.75rem' }}>You get nothing without the session</h3>
            <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem', maxWidth: '36rem' }}>
              The book is not a public scoreboard. Register after a paid call, then paste{' '}
              <code>agent_id</code> and <code>session</code> above. Wrong or missing possession
              returns 401/403 with an empty body.
            </p>
          </section>
        )}

        {loadState === 'error' && fetchError && (
          <section className="card book-state-card">
            <span className="badge badge-orange">{fetchError === 'forbidden' ? '403' : fetchError === 'unauth' ? '401' : 'Error'}</span>
            <h3 style={{ marginTop: '0.75rem' }}>{errorCopy(fetchError).title}</h3>
            <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem', maxWidth: '36rem' }}>
              {errorCopy(fetchError).body}
            </p>
          </section>
        )}

        {loadState === 'ready' && book && (
          <>
            <section className="book-budget-strip" style={{ alignItems: 'center' }}>
              {book.private_spend?.enabled && (
                <div style={{ gridColumn: '1 / -1', marginBottom: '0.25rem' }}>
                  <PrivateSpendCallout compact />
                </div>
              )}
              <div className="card book-stat-card">
                <div className="stat-label">Budget Y (cap)</div>
                <div className="book-stat-value">{book.cap != null ? `$${formatUsdc(book.cap)}` : 'Unlimited'}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.25rem' }}>{book.window}</div>
              </div>
              <div className="card book-stat-card">
                <div className="stat-label">Spent</div>
                <div className="book-stat-value">${formatUsdc(book.spent)}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                  {book.totals.count} rows in window
                </div>
              </div>
              <div className="card book-stat-card">
                <div className="stat-label">Remaining</div>
                <div className="book-stat-value">
                  {book.remaining != null ? `$${formatUsdc(book.remaining)}` : '—'}
                </div>
                {book.allowance?.signature && (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '0.35rem', fontFamily: 'var(--font-mono)' }}>
                    allowance signed
                  </div>
                )}
              </div>
            </section>

            <PrivateSpendCallout />

            <BookEscrowPanel
              apiV1={apiV1}
              agentId={book.agent_id}
              session={sessionInput.trim()}
            />

            {book.cap != null && (
              <div className="card" style={{ marginBottom: '1.5rem', padding: '1rem 1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Ceiling used</span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{spentPct.toFixed(1)}%</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-bar-fill" style={{ width: `${spentPct}%` }} />
                </div>
              </div>
            )}

            <section className="card" style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ marginBottom: '0.75rem' }}>Set budget Y</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: '0.75rem' }}>
                POST with <code>budget</code> in USDC (6 dp). Raising Y lifts the prepaid ceiling; spent does not reset.
              </p>
              <div className="book-budget-form">
                <input
                  className="input"
                  type="text"
                  inputMode="decimal"
                  placeholder="USDC amount (empty = unlimited)"
                  value={budgetDraft}
                  onChange={(e) => setBudgetDraft(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={budgetSaving}
                  onClick={() => void handleSetBudget(false)}
                >
                  {budgetSaving ? 'Saving…' : 'Set budget'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={budgetSaving}
                  onClick={() => void handleSetBudget(true)}
                >
                  Clear (unlimited)
                </button>
              </div>
              {budgetMessage && (
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '0.75rem' }}>{budgetMessage}</p>
              )}
            </section>

            <section className="card" style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ marginBottom: '0.75rem' }}>Book policy</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: '0.75rem' }}>
                Caps sit on the book you hold — not inside the router. Possession-gated via{' '}
                <code>POST /v1/agents/:agent_id/book/policy</code>. Demo keys cannot write policy.
              </p>
              <div className="book-policy-form" style={{ display: 'grid', gap: '0.75rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
                  <input
                    type="checkbox"
                    checked={killSwitch}
                    onChange={(e) => setKillSwitch(e.target.checked)}
                  />
                  Kill switch — block all metered spend
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
                  <input
                    type="checkbox"
                    checked={requirePaymentRef}
                    onChange={(e) => setRequirePaymentRef(e.target.checked)}
                  />
                  Require payment ref — pause spend when ledger rows lack <code>payment.ref</code>
                </label>
                <label className="book-field">
                  <span className="book-field-label">Daily cap (USDC, UTC midnight reset)</span>
                  <input
                    className="input"
                    type="text"
                    inputMode="decimal"
                    placeholder="empty = no daily cap"
                    value={dailyCapDraft}
                    onChange={(e) => setDailyCapDraft(e.target.value)}
                  />
                </label>
                <label className="book-field">
                  <span className="book-field-label">Hourly cap (USDC, clock hour UTC)</span>
                  <input
                    className="input"
                    type="text"
                    inputMode="decimal"
                    placeholder="empty = no hourly cap"
                    value={hourlyCapDraft}
                    onChange={(e) => setHourlyCapDraft(e.target.value)}
                  />
                </label>
                <label className="book-field">
                  <span className="book-field-label">Model allowlist (comma-separated)</span>
                  <input
                    className="input"
                    type="text"
                    placeholder="e.g. theta/qwen3, akash/llama"
                    value={modelAllowlistDraft}
                    onChange={(e) => setModelAllowlistDraft(e.target.value)}
                  />
                </label>
                <label className="book-field">
                  <span className="book-field-label">Tier-2 above (USDC) — require <code>proof_tier</code> at/above</span>
                  <input
                    className="input"
                    type="text"
                    inputMode="decimal"
                    placeholder="empty = no tier-2 floor"
                    value={tier2AboveDraft}
                    onChange={(e) => setTier2AboveDraft(e.target.value)}
                  />
                </label>
              </div>
              <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={policySaving}
                  onClick={() => void handleSavePolicy()}
                >
                  {policySaving ? 'Saving…' : 'Save policy'}
                </button>
                {policy?.updated_at && (
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', alignSelf: 'center' }}>
                    last updated {formatCollectedAt(policy.updated_at)}
                  </span>
                )}
              </div>
              {policyMessage && (
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '0.75rem' }}>{policyMessage}</p>
              )}
            </section>

            <section className="card" style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ marginBottom: '0.75rem' }}>Accounting export</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: '0.75rem' }}>
                Download collected rows for funds, DAOs, or design partners. Each row links to{' '}
                <code>verify_url</code> and per-receipt <code>?format=auditor</code> selective disclosure.
                On-chain attestation = <code>payment.ref</code> + issuer JWS — verify offline.
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => void handleExport('csv')}>
                  Download CSV
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleExport('json')}>
                  JSON audit pack
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleExport('html')}>
                  Print audit (HTML)
                </button>
              </div>
              {exportMessage && (
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '0.75rem' }}>{exportMessage}</p>
              )}
            </section>

            <div className="grid grid-2" style={{ marginBottom: '1.5rem' }}>
              <section className="card">
                <h3 style={{ marginBottom: '0.75rem' }}>Burn rate (24h)</h3>
                {burnRate && burnRate.rowCount > 0 ? (
                  <>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent-cyan)' }}>
                      ${burnRate.perDay}<span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}> / day</span>
                    </div>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '0.5rem' }}>
                      ${burnRate.perHour}/hr from {burnRate.rowCount} row{burnRate.rowCount === 1 ? '' : 's'} in the last {burnRate.windowHours}h
                      (${formatUsdc(burnRate.spentUnits)} total)
                    </p>
                  </>
                ) : (
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                    No collected rows with timestamps in the last 24 hours.
                  </p>
                )}
              </section>

              <section className="card">
                <h3 style={{ marginBottom: '0.75rem' }}>Model mix</h3>
                {modelMix.length > 0 ? (
                  <div className="book-model-mix">
                    {modelMix.map((item: ModelMixItem, i: number) => (
                      <div key={`${item.hub}-${item.model}`} className="book-mix-row">
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.3rem' }}>
                          <span>
                            <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{item.hub}</span>
                            {' · '}
                            {item.model}
                          </span>
                          <span style={{ fontFamily: 'var(--font-mono)' }}>{item.pct.toFixed(1)}%</span>
                        </div>
                        <div className="progress-bar" style={{ height: 6 }}>
                          <div
                            className="progress-bar-fill"
                            style={{
                              width: `${item.pct}%`,
                              background: MODEL_COLORS[i % MODEL_COLORS.length],
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No model data in this window.</p>
                )}
              </section>
            </div>

            <section className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
                <h3>Last {book.entries.length} book rows</h3>
                <span className="badge badge-cyan">agent {book.agent_id}</span>
              </div>

              {book.intents && Object.keys(book.intents).length > 0 && (
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                  {Object.keys(book.intents).length} intent group{Object.keys(book.intents).length === 1 ? '' : 's'} — retries share one bill when <code>intent_id</code> is set.
                </p>
              )}

              {book.entries.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)' }}>
                  Possession verified, but no spend rows yet. Paid calls (USDC via 402) and policy blocks appear here; demo never writes.
                </p>
              ) : (
                <div className="book-table-wrap">
                  <table className="book-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Intent</th>
                        <th>Hub</th>
                        <th>Model</th>
                        <th>Amount</th>
                        <th>Payment</th>
                        <th>Receipt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {book.entries.map((row) => {
                        const verifyUrl = verifyUrlFor(row.task_id, apiHost);
                        const amount = row.payment.amount;
                        const isBlocked = row.event === 'policy_blocked';
                        return (
                          <tr key={row.task_id} style={isBlocked ? { opacity: 0.85 } : undefined}>
                            <td data-label="Time">{formatCollectedAt(row.collected_at)}</td>
                            <td data-label="Intent">
                              {row.intent_id ? (
                                <span className="badge badge-secondary" title={row.intent_id}>
                                  {row.intent_id.slice(0, 8)}
                                  {row.attempt_index != null ? ` #${row.attempt_index}` : ''}
                                </span>
                              ) : '—'}
                              {isBlocked && (
                                <span className="badge" style={{ marginLeft: '0.35rem', background: 'var(--danger, #dc2626)', color: '#fff' }}>
                                  {row.policy_code || 'policy_blocked'}
                                </span>
                              )}
                            </td>
                            <td data-label="Hub">{row.route?.hub ?? '—'}</td>
                            <td data-label="Model" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>
                              {row.route?.model ?? '—'}
                            </td>
                            <td data-label="Amount" style={{ fontFamily: 'var(--font-mono)' }}>
                              {isBlocked ? '—' : `$${formatUsdc(amount)}`}
                            </td>
                            <td data-label="Payment" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>
                              {isBlocked ? row.reason ?? 'blocked' : summarizePaymentRef(row.payment.ref, row.payment.rail)}
                            </td>
                            <td data-label="Receipt">
                              {isBlocked ? '—' : (
                                <a href={verifyUrl} target="_blank" rel="noopener noreferrer">
                                  verify
                                </a>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        <details className="book-blurb" style={{ marginTop: '2rem' }}>
          <summary>What is the {productName} book?</summary>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, marginTop: '0.75rem', maxWidth: '40rem' }}>
            The book is the last-N collected spend for an agent session. Each entry records the hub,
            the model, and the amount in USDC. The payer holds the book. Policy caps and audit export
            sit beside the book — not inside the router. Signed receipts include a public{' '}
            <code>verify_url</code>; SP1 is on demand, not every call.
          </p>
        </details>

        <nav style={{ marginTop: '2rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <Link to="/v1" className="btn btn-primary btn-sm">/v1 gateway →</Link>
          <Link to="/book-bot" className="btn btn-secondary btn-sm">Book bot</Link>
          <Link to="/agent-shop" className="btn btn-secondary btn-sm">Agent shop</Link>
          <Link to="/" className="btn btn-secondary btn-sm">Home</Link>
        </nav>
      </div>
    </div>
  );
}
