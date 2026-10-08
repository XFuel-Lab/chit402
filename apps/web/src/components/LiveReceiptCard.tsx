import type { CSSProperties } from 'react';
import {
  LIVE_RECEIPT_AMOUNT_DISPLAY,
  LIVE_RECEIPT_TASK_ID,
  LIVE_RECEIPT_VERIFY_URL,
} from '../lib/liveReceiptSpecimen';

type LiveReceiptCardProps = {
  compact?: boolean;
};

export default function LiveReceiptCard({ compact = false }: LiveReceiptCardProps) {
  const shortId = `${LIVE_RECEIPT_TASK_ID.slice(0, 18)}…`;

  return (
    <article className="card live-receipt-card" style={compact ? styles.compact : undefined}>
      <div className="live-receipt-card-head">
        <span className="badge badge-cyan">Live collected row</span>
        <span className="badge badge-secondary">USDC · Base</span>
      </div>
      <p className="live-receipt-card-lede">
        A real door receipt. The public page is an unsigned shell. Hub and model stay on the owner view.
      </p>
      <dl className="live-receipt-rows">
        <div className="live-receipt-row">
          <dt>Amount</dt>
          <dd className="live-receipt-mono">{LIVE_RECEIPT_AMOUNT_DISPLAY}</dd>
        </div>
        <div className="live-receipt-row">
          <dt>Receipt</dt>
          <dd className="live-receipt-mono" title={LIVE_RECEIPT_TASK_ID}>{shortId}</dd>
        </div>
      </dl>
      <div className="live-receipt-card-actions">
        <a href={LIVE_RECEIPT_VERIFY_URL} className="btn btn-primary btn-sm" target="_blank" rel="noreferrer">
          Verify receipt
        </a>
        <a
          href={`${LIVE_RECEIPT_VERIFY_URL}?format=json`}
          className="btn btn-secondary btn-sm"
          target="_blank"
          rel="noreferrer"
        >
          JSON
        </a>
      </div>
    </article>
  );
}

const styles: Record<string, CSSProperties> = {
  compact: {
    padding: '1rem 1.15rem',
  },
};
