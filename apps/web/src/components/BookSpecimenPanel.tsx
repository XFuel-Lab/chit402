import { Link } from 'react-router-dom';
import { getApiHost } from '../apiHost';
import {
  BOOK_SPECIMEN_BANNER,
  BOOK_SPECIMEN_ENTRIES,
  BOOK_SPECIMEN_STATS,
} from '../lib/bookSpecimen';
import { formatCollectedAt, formatUsdc, verifyUrlFor } from '../lib/agentBook';
import BookEvidenceChip from './BookEvidenceChip';

export default function BookSpecimenPanel() {
  const apiHost = getApiHost();

  const spentDisplay = formatUsdc(BOOK_SPECIMEN_STATS.spent);
  const capDisplay = formatUsdc(BOOK_SPECIMEN_STATS.cap);
  const remainingDisplay = formatUsdc(BOOK_SPECIMEN_STATS.remaining);

  return (
    <section className="card book-specimen-panel" aria-label="Specimen principal book">
      <div className="book-specimen-banner" role="status">
        <span className="badge badge-orange">{BOOK_SPECIMEN_BANNER}</span>
        <p>
          Example spend ledger for a treasury desk — same row shape as{' '}
          <code>GET|POST /v1/agents/:agent_id/book</code>. Paste your possession session below to
          load <em>your</em> gated book (fail-closed for live money).
        </p>
      </div>

      <div className="book-budget-strip" style={{ marginTop: '1.25rem' }}>
        <div className="card book-stat-card">
          <div className="stat-label">Budget Y (cap)</div>
          <div className="book-stat-value">${capDisplay}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.25rem' }}>
            {BOOK_SPECIMEN_STATS.window}
          </div>
        </div>
        <div className="card book-stat-card">
          <div className="stat-label">Spent</div>
          <div className="book-stat-value">${spentDisplay}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.25rem' }}>
            {BOOK_SPECIMEN_STATS.rowCount} specimen rows
          </div>
        </div>
        <div className="card book-stat-card">
          <div className="stat-label">Remaining</div>
          <div className="book-stat-value">${remainingDisplay}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.25rem' }}>
            {BOOK_SPECIMEN_STATS.agentLabel}
          </div>
        </div>
      </div>

      <div className="book-table-wrap" style={{ marginTop: '1.25rem' }}>
        <table className="book-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Evidence</th>
              <th>Hub</th>
              <th>Model</th>
              <th>Amount</th>
              <th>Receipt</th>
            </tr>
          </thead>
          <tbody>
            {BOOK_SPECIMEN_ENTRIES.map((row) => {
              const isLiveRow = row.task_id === BOOK_SPECIMEN_ENTRIES[0].task_id;
              const verifyUrl = isLiveRow ? verifyUrlFor(row.task_id, apiHost) : null;
              const amount = row.payment.amount;
              const hideAmount = row.evidence === 'policy_blocked';

              return (
                <tr key={row.task_id}>
                  <td data-label="Time">{formatCollectedAt(row.collected_at)}</td>
                  <td data-label="Evidence">
                    <BookEvidenceChip row={row} />
                  </td>
                  <td data-label="Hub">{row.route?.hub ?? '—'}</td>
                  <td data-label="Model" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>
                    {row.route?.model ?? '—'}
                  </td>
                  <td data-label="Amount" style={{ fontFamily: 'var(--font-mono)' }}>
                    {hideAmount ? '—' : amount ? `$${formatUsdc(amount)}` : '—'}
                  </td>
                  <td data-label="Receipt">
                    {verifyUrl ? (
                      <a href={verifyUrl} target="_blank" rel="noopener noreferrer">verify</a>
                    ) : (
                      <span className="muted-specimen">specimen row</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="book-specimen-foot">
        After a collected USDC call,{' '}
        <Link to="/register">register</Link> to receive <code>agent_id</code> + possession{' '}
        <code>session</code>, then load your book above.
      </p>
    </section>
  );
}
