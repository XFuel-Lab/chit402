import {
  bookWindowQuery,
  formatUsd,
  type BookSummary,
  type BookWindowPreset,
} from '../lib/agentBook';

const PRESETS: BookWindowPreset[] = ['24h', '7d', '30d', 'all'];

const EMPTY_SUMMARY: BookSummary = {
  spend_atomic: '0',
  payments: 0,
  vendors_paid: 0,
  receipts: 0,
  receipts_verified: 0,
  verified_percent: 0,
};

function formatPercent(pct: number): string {
  if (!Number.isFinite(pct)) return '0%';
  const rounded = Math.round(pct * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

export default function BookKpiStrip({
  summary,
  windowLabel,
  preset = null,
  onPreset,
}: {
  summary?: BookSummary | null;
  windowLabel: string;
  preset?: BookWindowPreset | null;
  onPreset?: (preset: BookWindowPreset) => void;
}) {
  const tiles = summary ?? EMPTY_SUMMARY;
  const spend = formatUsd(tiles.spend_atomic);
  const payments = Number.isFinite(tiles.payments) ? tiles.payments : 0;
  const vendors = Number.isFinite(tiles.vendors_paid) ? tiles.vendors_paid : 0;
  const verified = Number.isFinite(tiles.receipts_verified) ? tiles.receipts_verified : 0;
  const receipts = Number.isFinite(tiles.receipts) ? tiles.receipts : 0;
  const percent = formatPercent(tiles.verified_percent);

  return (
    <section className="book-kpi" aria-label="Spend summary">
      <div className="book-kpi-head">
        <h3>{windowLabel}</h3>
        {onPreset && preset && (
          <div className="book-window-pills" role="group" aria-label="Spend window">
            {PRESETS.map((id) => (
              <button
                key={id}
                type="button"
                className="book-window-pill"
                aria-pressed={preset === id}
                onClick={() => onPreset(id)}
              >
                {bookWindowQuery(id).label === 'All time' ? 'All' : id}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="book-kpi-strip">
        <div className="card book-stat-card book-kpi-card">
          <div className="stat-label">Spend</div>
          <div className="book-stat-value">{spend}</div>
          <div className="book-kpi-caption">Collected USDC</div>
        </div>
        <div className="card book-stat-card book-kpi-card">
          <div className="stat-label">Payments</div>
          <div className="book-stat-value">{payments}</div>
          <div className="book-kpi-caption">Collected rows</div>
        </div>
        <div className="card book-stat-card book-kpi-card">
          <div className="stat-label">Vendors paid</div>
          <div className="book-stat-value">{vendors}</div>
          <div className="book-kpi-caption">Distinct payees</div>
        </div>
        <div className="card book-stat-card book-kpi-card">
          <div className="stat-label">Receipts verified</div>
          <div className="book-stat-value">{verified}</div>
          <div className="book-kpi-caption">{percent} of {receipts}</div>
        </div>
      </div>
    </section>
  );
}
