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
import { checkContent } from '../content/checkContent.mjs';

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
        setMessage(checkContent.sent);
        setOpen(false);
        return;
      }
      setMessage(payload && typeof payload.message === 'string' ? payload.message : checkContent.notFiled);
    } catch {
      setMessage(checkContent.notFiled);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="receipt-check-feedback">
      <p className="receipt-check-feedback-public">
        {checkContent.feedbackPublic}
      </p>
      {!open && (
        <button type="button" className="receipt-check-feedback-link" onClick={() => setOpen(true)}>
          {checkContent.feedbackOpen}
        </button>
      )}
      {open && (
        <form className="receipt-check-feedback-form" onSubmit={onSend}>
          <label>
            {checkContent.expectedLabel}
            <select value={expected} required onChange={(event) => setExpected(event.target.value)}>
              {checkContent.expectedOptions.map((option) => (
                <option key={option} value={option === 'Choose' ? '' : option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label>
            {checkContent.intentLabel}
            <input
              value={intent}
              required
              maxLength={200}
              onChange={(event) => setIntent(event.target.value)}
            />
          </label>
          <label>
            {checkContent.noteLabel}
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
            {checkContent.attachLabel}
          </label>
          <button className="receipt-check-button" type="submit" disabled={pending}>
            {pending ? checkContent.sending : checkContent.send}
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
        lines: ['COULD_NOT_CHECK', checkContent.couldNot],
        error: checkContent.couldNot,
        hint: checkContent.tryAgain,
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
        description={checkContent.description}
      />
      <div className="container receipt-check-wrap">
        <header className="page-header">
          <span className="docs-kicker">{checkContent.kicker}</span>
          <h1>{checkContent.h1}</h1>
          <p>{checkContent.intro}</p>
        </header>

        <form className="receipt-check-form" onSubmit={onSubmit}>
          <label className="receipt-check-label" htmlFor="receipt-check-input">
            {checkContent.fieldLabel}
          </label>
          <textarea
            id="receipt-check-input"
            className="receipt-check-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={checkContent.placeholder}
            spellCheck={false}
            rows={8}
          />
          <button className="receipt-check-button" type="submit" disabled={pending || input.trim().length === 0}>
            {pending ? checkContent.pending : checkContent.submit}
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
                <p className="receipt-check-accepted-label">{checkContent.acceptedHeading}</p>
                <ul className="receipt-check-accepted">
                  {view.accepted.map((item) => <li key={item}>{item}</li>)}
                </ul>
                {view.example && (
                  <p className="receipt-check-example-row">
                    <span>{checkContent.exampleLabel}</span>
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
          <Link to={checkContent.verifyHref}>{checkContent.verifyLabel}</Link>
          {' · '}
          <Link to={checkContent.historyHref}>{checkContent.historyLabel}</Link>
        </p>
      </div>
    </div>
  );
}
