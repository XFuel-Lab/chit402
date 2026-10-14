import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import SeoHead from '../components/SeoHead';
import { getApiHost } from '../apiHost';
import { receiptCheckBody, receiptCheckView, type ReceiptCheckView } from '../lib/receiptCheckCore.mjs';

export default function ReceiptCheck() {
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [view, setView] = useState<ReceiptCheckView | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const pasted = input.trim();
    if (!pasted || pending) return;
    setPending(true);
    setView(null);
    try {
      const checkUrl = import.meta.env.DEV ? '/v1/receipts/check' : `${getApiHost()}/v1/receipts/check`;
      const res = await fetch(checkUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(receiptCheckBody(pasted)),
      });
      let payload: unknown = null;
      try {
        payload = await res.json();
      } catch {
        payload = null;
      }
      setView(receiptCheckView(res.status, payload));
    } catch {
      setView({
        overall: 'COULD_NOT_CHECK',
        lines: ['COULD_NOT_CHECK', 'The check could not be completed.'],
        error: 'The check could not be completed.',
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="page receipt-check">
      <SeoHead
        title="Receipt check | Chit402"
        description="Paste a receipt, a receipt id, or a receipt URL. Free. The verdict matches chit402-verify."
      />
      <div className="container receipt-check-wrap">
        <header className="page-header">
          <span className="docs-kicker">Free · no account</span>
          <h1>Receipt check</h1>
          <p>
            Paste a receipt, a receipt id, or a receipt URL. The verdict is the same text{' '}
            <code>chit402-verify</code> prints.
          </p>
        </header>

        <form className="receipt-check-form" onSubmit={onSubmit}>
          <label className="receipt-check-label" htmlFor="receipt-check-input">
            Receipt
          </label>
          <textarea
            id="receipt-check-input"
            className="receipt-check-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Paste the receipt JSON, or a receipt id or URL"
            spellCheck={false}
            rows={8}
          />
          <button className="receipt-check-button" type="submit" disabled={pending || input.trim().length === 0}>
            {pending ? 'Checking' : 'Check'}
          </button>
        </form>

        {view && (
          <section className="receipt-check-card" aria-live="polite">
            <p className={`receipt-check-overall receipt-check-overall-${view.overall.toLowerCase()}`}>
              {view.overall}
            </p>
            {view.lines.slice(view.lines[0] === view.overall ? 1 : 0).map((line, index) => (
              <p key={`${index}:${line}`} className="receipt-check-line">{line}</p>
            ))}
          </section>
        )}

        <p className="receipt-check-foot">
          <Link to="/docs/verify">What the verdict means</Link>
          {' · '}
          <Link to="/docs/receipt-check">Hash and key history</Link>
        </p>
      </div>
    </div>
  );
}
