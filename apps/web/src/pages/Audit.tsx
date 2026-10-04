import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SeoHead from '../components/SeoHead';
import { formatUsdc } from '../lib/agentBook';
import {
  SAMPLE_BASE_ADDRESS,
  reportToCsv,
  reportToJson,
  runPublicSpendAudit,
  type PublicSpendAuditReport,
} from '../lib/spendAudit';

type Phase = 'idle' | 'loading' | 'ready' | 'error';

function shortAddr(value: string): string {
  if (value.length < 14) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function download(filename: string, mime: string, text: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function fileStamp(report: PublicSpendAuditReport): string {
  const who = 'address' in report.query
    ? report.query.address
    : report.query.agent_id;
  const tail = who.slice(0, 8);
  const day = report.generated_at.slice(0, 10);
  return `chit402-audit-${tail}-${day}`;
}

export default function Audit() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryKey = (searchParams.get('address') || searchParams.get('agent') || '').trim();
  const [draft, setDraft] = useState(queryKey);
  const [tick, setTick] = useState(0);
  const [phase, setPhase] = useState<Phase>(queryKey ? 'loading' : 'idle');
  const [progress, setProgress] = useState('Reading Base…');
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<PublicSpendAuditReport | null>(null);

  useEffect(() => {
    const query = queryKey;
    if (!query) return undefined;
    const controller = new AbortController();
    let cancelled = false;
    setDraft(query);
    setPhase('loading');
    setError(null);
    setReport(null);
    setProgress('Reading Base…');
    runPublicSpendAudit(query, {
      signal: controller.signal,
      onProgress: (message) => {
        if (!cancelled) setProgress(message);
      },
    }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setPhase('error');
        setError(result.error === 'invalid' || result.error === 'empty'
          ? 'Paste a Base wallet (0x and 40 hex digits), a Solana address, or a numeric agent id.'
          : 'The Base RPC did not answer. No spend total is shown.');
        return;
      }
      setReport(result.report);
      setPhase('ready');
    }).catch((err: unknown) => {
      if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
      setPhase('error');
      setError('The Base RPC did not answer. No spend total is shown.');
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [queryKey, tick]);

  const headlineAmount = useMemo(() => {
    const atomic = report?.headline.usdc_out_atomic;
    if (atomic == null) return null;
    return formatUsdc(atomic);
  }, [report]);

  const submit = (value: string) => {
    const next = value.trim();
    if (!next) return;
    if (next === queryKey) {
      setTick((n) => n + 1);
      return;
    }
    const parsedAsAgent = /^\d{1,12}$/.test(next);
    setSearchParams(parsedAsAgent ? { agent: next } : { address: next });
  };

  return (
    <div className="page docs-page">
      <SeoHead
        title="Spend audit — Base USDC out | Chit402"
        description="Paste a Base wallet. See USDC sent, by counterparty, and which transfers have a public Chit receipt. No signup. Incomplete scans show no total."
      />
      <div className="container" style={{ maxWidth: 980 }}>
        <header className="page-header" style={{ maxWidth: '40rem' }}>
          <span className="docs-kicker">Audit</span>
          <h1>Spend audit</h1>
          <p>
            Paste a Base wallet. This page reads USDC sent from that address and checks each
            transfer against the public Chit receipt. No signup. The possession book stays private.
          </p>
        </header>

        <form
          className="card"
          style={{ padding: '1.25rem', marginBottom: '1.25rem' }}
          onSubmit={(event) => {
            event.preventDefault();
            submit(draft);
          }}
        >
          <label htmlFor="audit-query" style={{ display: 'block', fontWeight: 600, marginBottom: '0.5rem' }}>
            Base wallet, Solana address, or agent id
          </label>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <input
              id="audit-query"
              className="input"
              style={{ flex: '1 1 18rem' }}
              value={draft}
              autoComplete="off"
              spellCheck={false}
              placeholder="0x… or agent id"
              onChange={(event) => setDraft(event.target.value)}
            />
            <button className="btn btn-primary" type="submit" disabled={phase === 'loading'}>
              {phase === 'loading' ? 'Reading…' : 'Run audit'}
            </button>
          </div>
          <p style={{ color: '#8a8a9a', marginTop: '0.75rem', fontSize: '0.9rem' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => submit(SAMPLE_BASE_ADDRESS)}
            >
              Use the 1F916 specimen funder
            </button>
            {' '}
            Public sample from the 1F916 link doc. About seven days of Base USDC out.
          </p>
        </form>

        {phase === 'loading' && (
          <p aria-live="polite" style={{ color: '#8a8a9a', marginBottom: '1.25rem' }}>
            {progress}
          </p>
        )}

        {phase === 'error' && error && (
          <p role="alert" style={{ color: '#f59e0b', marginBottom: '1.25rem' }}>
            {error}
          </p>
        )}

        {phase === 'idle' && (
          <section className="card" style={{ padding: '1.25rem' }}>
            <h2 style={{ fontSize: '1.15rem', marginBottom: '0.5rem' }}>What you get</h2>
            <p style={{ color: '#8a8a9a' }}>
              USDC out per counterparty, x402 when a public receipt or a Base
              {' '}<code>transferWithAuthorization</code> call shows it, and which sends have no
              public Chit receipt. Caps stay on the <Link to="/book">possession book</Link>.
            </p>
          </section>
        )}

        {report && phase === 'ready' && (
          <ReportView
            report={report}
            headlineAmount={headlineAmount}
            onCsv={() => download(`${fileStamp(report)}.csv`, 'text/csv;charset=utf-8', reportToCsv(report))}
            onJson={() => download(`${fileStamp(report)}.json`, 'application/json', reportToJson(report))}
          />
        )}
      </div>
    </div>
  );
}

function ReportView({
  report,
  headlineAmount,
  onCsv,
  onJson,
}: {
  report: PublicSpendAuditReport;
  headlineAmount: string | null;
  onCsv: () => void;
  onJson: () => void;
}) {
  const incomplete = report.headline.usdc_out_atomic == null;
  const totals = report.totals;

  return (
    <div>
      <section className="card" style={{ padding: '1.35rem', marginBottom: '1.25rem' }}>
        <p style={{ color: '#8a8a9a', fontSize: '0.85rem', marginBottom: '0.35rem' }}>
          USDC out
          {report.coverage.from_time && report.coverage.to_time
            ? ` · ${report.coverage.from_time.slice(0, 10)} to ${report.coverage.to_time.slice(0, 10)}`
            : ''}
        </p>
        <p style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.02em' }} aria-live="polite">
          {headlineAmount == null ? '—' : headlineAmount}
        </p>
        <p style={{ color: incomplete ? '#f59e0b' : '#8a8a9a', marginTop: '0.35rem' }}>
          {report.headline.label}
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onCsv}>
            Download CSV
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onJson}>
            Download JSON
          </button>
        </div>
      </section>

      {totals && (
        <>
          {incomplete && totals.observed_count > 0 && (
            <p style={{ color: '#f59e0b', marginBottom: '0.75rem' }}>
              The amounts below are only the rows that came back. They are not the wallet total.
            </p>
          )}
          <div className="grid grid-3" style={{ gap: '1rem', marginBottom: '1.25rem' }}>
            <ClassCard title="x402" atomic={totals.by_class.x402} hint="Receipt or EIP-3009 authorization" />
            <ClassCard title="Other" atomic={totals.by_class.other} hint="Plain transfer, no public receipt" />
            <ClassCard title="Undetected" atomic={totals.by_class.undetected} hint="Not counted as x402 or other" />
          </div>

          {report.receipt_match && (
            <section className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
              <h2 style={{ fontSize: '1.15rem', marginBottom: '0.75rem' }}>Public receipt vs chain</h2>
              <div className="grid grid-2" style={{ gap: '1rem' }}>
                <div>
                  <p style={{ color: '#8a8a9a', fontSize: '0.85rem' }}>On a public Chit receipt</p>
                  <p style={{ fontSize: '1.4rem', fontWeight: 700 }}>{formatUsdc(report.receipt_match.receipted_atomic)}</p>
                </div>
                <div>
                  <p style={{ color: '#8a8a9a', fontSize: '0.85rem' }}>No public receipt (HTTP 404)</p>
                  <p style={{ fontSize: '1.4rem', fontWeight: 700 }}>{formatUsdc(report.receipt_match.unreceipted_atomic)}</p>
                </div>
              </div>
              <p style={{ color: '#8a8a9a', marginTop: '0.85rem', fontSize: '0.9rem' }}>
                {report.receipt_match.note}
                {report.receipt_match.unavailable_count > 0 && (
                  <> {report.receipt_match.unavailable_count} lookup{report.receipt_match.unavailable_count === 1 ? '' : 's'} failed and {report.receipt_match.unavailable_count === 1 ? 'is' : 'are'} not counted as unreceipted.</>
                )}
                {report.receipt_match.not_checked_count > 0 && (
                  <> {report.receipt_match.not_checked_count} not checked.</>
                )}
                {report.receipt_match.mismatch_count > 0 && (
                  <> {report.receipt_match.mismatch_count} receipt{report.receipt_match.mismatch_count === 1 ? '' : 's'} named a different payer.</>
                )}
              </p>
            </section>
          )}

          <section style={{ marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1.15rem', marginBottom: '0.75rem' }}>By counterparty</h2>
            {totals.by_counterparty.length === 0 ? (
              <p style={{ color: '#8a8a9a' }}>No positive USDC out in the included rows.</p>
            ) : (
              <div className="book-table-wrap card" style={{ padding: '0.25rem 0.75rem 0.75rem' }}>
                <table className="book-table">
                  <thead>
                    <tr>
                      <th>Pay to</th>
                      <th>Transfers</th>
                      <th>USDC out</th>
                    </tr>
                  </thead>
                  <tbody>
                    {totals.by_counterparty.map((row) => (
                      <tr key={row.pay_to}>
                        <td data-label="Pay to">
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{shortAddr(row.pay_to)}</div>
                          {row.label && <div style={{ color: '#8a8a9a', fontSize: '0.8rem' }}>{row.label}</div>}
                        </td>
                        <td data-label="Transfers">{row.count}</td>
                        <td data-label="USDC out">{formatUsdc(row.usdc_out_atomic)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section style={{ marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1.15rem', marginBottom: '0.75rem' }}>Anomalies</h2>
            {report.anomalies.length === 0 ? (
              <p style={{ color: '#8a8a9a' }}>
                No spike (5× the median, when at least four positive transfers exist) and no near-duplicate
                (same payee and amount within 90 seconds).
              </p>
            ) : (
              <ul style={{ paddingLeft: '1.1rem', color: '#f0f0f5' }}>
                {report.anomalies.map((item) => (
                  <li key={`${item.kind}-${item.tx_hashes.join('-')}`} style={{ marginBottom: '0.45rem' }}>
                    <strong>{item.kind === 'spike' ? 'Spike' : 'Near-duplicate'}. </strong>
                    {item.summary}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section style={{ marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1.15rem', marginBottom: '0.75rem' }}>Transfers</h2>
            {report.transfers.length === 0 ? (
              <p style={{ color: '#8a8a9a' }}>No USDC Transfer logs from this address in the scanned blocks.</p>
            ) : (
              <div className="book-table-wrap card" style={{ padding: '0.25rem 0.75rem 0.75rem' }}>
                <table className="book-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Pay to</th>
                      <th>USDC</th>
                      <th>Class</th>
                      <th>Receipt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.transfers.map((row) => (
                      <tr key={`${row.tx_hash}:${row.log_index}`}>
                        <td data-label="When">{row.block_time ? row.block_time.replace('T', ' ').slice(0, 16) : '—'}</td>
                        <td data-label="Pay to">
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{shortAddr(row.pay_to)}</div>
                          {row.pay_to_label && <div style={{ color: '#8a8a9a', fontSize: '0.8rem' }}>{row.pay_to_label}</div>}
                        </td>
                        <td data-label="USDC">{row.amount_usdc}</td>
                        <td data-label="Class">{row.spend_class}</td>
                        <td data-label="Receipt">
                          {row.verify_url ? (
                            <a href={row.verify_url} target="_blank" rel="noreferrer">Receipt</a>
                          ) : (
                            <span>{row.receipt_status}</span>
                          )}
                          {' · '}
                          <a href={row.explorer_url} target="_blank" rel="noreferrer">Base</a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      <section className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.05rem', marginBottom: '0.5rem' }}>Caps</h2>
        <p style={{ color: '#8a8a9a' }}>{report.caps.note}</p>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.05rem', marginBottom: '0.5rem' }}>What this report does not claim</h2>
        <ul style={{ paddingLeft: '1.1rem', color: '#8a8a9a' }}>
          {report.coverage.notes.map((note) => (
            <li key={note} style={{ marginBottom: '0.35rem' }}>{note}</li>
          ))}
        </ul>
        {report.coverage.failed_ranges.length > 0 && (
          <p style={{ color: '#f59e0b', marginTop: '0.75rem' }}>
            {report.coverage.failed_ranges.length} block range{report.coverage.failed_ranges.length === 1 ? '' : 's'} failed.
            Those ranges are omitted, not treated as zero.
          </p>
        )}
      </section>
    </div>
  );
}

function ClassCard({ title, atomic, hint }: { title: string; atomic: string; hint: string }) {
  return (
    <div className="card" style={{ padding: '1.1rem 1.2rem' }}>
      <h3 style={{ fontSize: '0.95rem', marginBottom: '0.35rem' }}>{title}</h3>
      <p style={{ fontSize: '1.45rem', fontWeight: 700 }}>{formatUsdc(atomic)}</p>
      <p style={{ color: '#8a8a9a', fontSize: '0.82rem', marginTop: '0.35rem' }}>{hint}</p>
    </div>
  );
}
