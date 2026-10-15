import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import SeoHead from '../components/SeoHead';
import { getApiHost } from '../apiHost';
import {
  receiptCheckBody,
  receiptCheckView,
  receiptFeedbackBody,
  type ReceiptCheckView,
} from '../lib/receiptCheckCore.mjs';

function feedbackUrl() {
  return import.meta.env.DEV ? '/v1/receipts/feedback' : `${getApiHost()}/v1/receipts/feedback`;
}

function CheckFeedback({ view, receipt }: { view: ReceiptCheckView; receipt: string }) {
  const [open, setOpen] = useState(false);
  const [expected, setExpected] = useState('');
  const [intent, setIntent] = useState('');
  const [note, setNote] = useState('');
  const [attach, setAttach] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  if (!view.feedbackEnabled) return null;

  async function onSend(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage('');
    try {
      const res = await fetch(feedbackUrl(), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(receiptFeedbackBody({
          view,
          expected,
          intent,
          note,
          attach,
          receipt,
        })),
      });
      let payload: { message?: string } | null = null;
      try {
        payload = await res.json();
      } catch {
        payload = null;
      }
      if (res.status === 202) {
        setMessage('Sent.');
        setOpen(false);
        return;
      }
      setMessage(payload && typeof payload.message === 'string' ? payload.message : 'Feedback was not filed.');
    } catch {
      setMessage('Feedback was not filed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="receipt-check-feedback">
      {!open && (
        <button type="button" className="receipt-check-feedback-link" onClick={() => setOpen(true)}>
          Something wrong? Tell us
        </button>
      )}
      {open && (
        <form className="receipt-check-feedback-form" onSubmit={onSend}>
          <label>
            What did you expect?
            <select value={expected} required onChange={(event) => setExpected(event.target.value)}>
              <option value="">Choose</option>
              <option value="verified">verified</option>
              <option value="invalid">invalid</option>
              <option value="other">other</option>
            </select>
          </label>
          <label>
            What were you trying to do?
            <input
              value={intent}
              required
              maxLength={200}
              onChange={(event) => setIntent(event.target.value)}
            />
          </label>
          <label>
            Note
            <textarea
              value={note}
              maxLength={1000}
              rows={4}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <label className="receipt-check-attach">
            <input
              type="checkbox"
              checked={attach}
              onChange={(event) => setAttach(event.target.checked)}
            />
            Attach the receipt I pasted so the team can reproduce it
          </label>
          <button className="receipt-check-button" type="submit" disabled={pending}>
            {pending ? 'Sending' : 'Send'}
          </button>
        </form>
      )}
      {message && <p className="receipt-check-feedback-status">{message}</p>}
    </div>
  );
}

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
        kind: 'verdict',
        overall: 'COULD_NOT_CHECK',
        lines: ['COULD_NOT_CHECK', 'The check could not be completed.'],
        error: 'The check could not be completed.',
        hint: 'Try this check again.',
        accepted: null,
        example: null,
        feedbackEnabled: false,
        requestId: null,
        report: null,
      });
    } finally {
      setPending(false);
    }
  }

  const detailLines = view
    ? view.kind === 'input-error'
      ? view.lines.slice(1)
      : view.lines.slice(view.lines[0] === view.overall ? 1 : 0)
    : [];

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
          <section
            className={view.kind === 'input-error'
              ? 'receipt-check-card receipt-check-card-input'
              : 'receipt-check-card'}
            aria-live="polite"
          >
            {view.kind === 'input-error' ? (
              <p className="receipt-check-input-title">{view.lines[0]}</p>
            ) : (
              <p className={`receipt-check-overall receipt-check-overall-${view.overall.toLowerCase()}`}>
                {view.overall}
              </p>
            )}
            {detailLines.map((line, index) => (
              <p key={`${index}:${line}`} className="receipt-check-line">{line}</p>
            ))}
            {view.hint && <p className="receipt-check-hint">{view.hint}</p>}
            {view.kind === 'input-error' && view.accepted && (
              <>
                <p className="receipt-check-accepted-label">Accepted input</p>
                <ul className="receipt-check-accepted">
                  {view.accepted.map((item) => <li key={item}>{item}</li>)}
                </ul>
                {view.example && (
                  <p className="receipt-check-example-row">
                    <span>Example</span>
                    <button
                      type="button"
                      className="receipt-check-example"
                      onClick={() => setInput(view.example || '')}
                    >
                      {view.example}
                    </button>
                  </p>
                )}
              </>
            )}
            <CheckFeedback key={view.requestId || 'local'} view={view} receipt={input} />
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
