import { useState } from 'react';
import {
  claimBookInflow,
  correctBookInflow,
  formatUsdc,
  parseUsdcInput,
  type BookFetchError,
} from '../lib/agentBook';

interface BookInflowPanelProps {
  apiV1: string;
  agentId: number;
  session: string;
  onSuccess: () => void;
}

function inflowErrorCopy(error: BookFetchError | 'inflow', message?: string): string {
  if (message) return message;
  if (error === 'unauth') return 'Possession required — refresh session from register.';
  if (error === 'forbidden') return 'Session does not match this agent.';
  return 'Could not reach the gateway.';
}

export default function BookInflowPanel({ apiV1, agentId, session, onSuccess }: BookInflowPanelProps) {
  const [bucket, setBucket] = useState('patron');
  const [allocationDraft, setAllocationDraft] = useState('');
  const [taskIdDraft, setTaskIdDraft] = useState('');
  const [claimMessage, setClaimMessage] = useState<string | null>(null);
  const [claimSaving, setClaimSaving] = useState(false);

  const [correctTaskId, setCorrectTaskId] = useState('');
  const [correctAllocation, setCorrectAllocation] = useState('');
  const [correctReason, setCorrectReason] = useState('');
  const [correctMessage, setCorrectMessage] = useState<string | null>(null);
  const [correctSaving, setCorrectSaving] = useState(false);

  const handleClaim = async () => {
    const allocation = parseUsdcInput(allocationDraft);
    if (!allocation) {
      setClaimMessage('Enter a valid USDC amount (up to 6 decimals).');
      return;
    }

    setClaimSaving(true);
    setClaimMessage(null);
    const result = await claimBookInflow(apiV1, { agentId, session }, {
      bucket: bucket.trim() || 'patron',
      allocation,
      task_id: taskIdDraft.trim() || undefined,
    });
    setClaimSaving(false);

    if (!result.ok) {
      setClaimMessage(inflowErrorCopy(result.error, result.message));
      return;
    }

    setClaimMessage(`Inflow recorded — task ${result.data.task_id}, $${formatUsdc(result.data.allocation)} in ${result.data.bucket}.`);
    setAllocationDraft('');
    setTaskIdDraft('');
    onSuccess();
  };

  const handleCorrect = async () => {
    const taskId = correctTaskId.trim();
    const reason = correctReason.trim();
    if (!taskId) {
      setCorrectMessage('task_id of the inflow row is required.');
      return;
    }
    if (!reason) {
      setCorrectMessage('Reason is required — corrections are append-only.');
      return;
    }

    const allocation = correctAllocation.trim() ? parseUsdcInput(correctAllocation) : undefined;
    if (correctAllocation.trim() && allocation == null) {
      setCorrectMessage('Enter a valid USDC amount or leave allocation empty to keep current.');
      return;
    }

    setCorrectSaving(true);
    setCorrectMessage(null);
    const result = await correctBookInflow(apiV1, { agentId, session }, {
      task_id: taskId,
      allocation: allocation ?? undefined,
      reason,
    });
    setCorrectSaving(false);

    if (!result.ok) {
      setCorrectMessage(inflowErrorCopy(result.error, result.message));
      return;
    }

    setCorrectMessage(`Correction appended — ${taskId} now $${formatUsdc(result.data.allocation)}.`);
    setCorrectReason('');
    onSuccess();
  };

  return (
    <section className="card book-inflow-panel" style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ marginBottom: '0.75rem' }}>Unaffiliated inflow</h3>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: '1rem', maxWidth: '42rem' }}>
        Claim a signed bucket/allocation when funds arrive without <code>payment.ref</code> — patron-style
        inflow, not live wallet scrape. Corrections append-only; original claim stays on the ledger.
      </p>

      <div className="book-inflow-grid">
        <div>
          <h4 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>Claim inflow</h4>
          <div className="book-inflow-form">
            <label className="book-field">
              <span className="book-field-label">Bucket</span>
              <input
                className="input"
                type="text"
                placeholder="patron"
                value={bucket}
                onChange={(e) => setBucket(e.target.value)}
              />
            </label>
            <label className="book-field">
              <span className="book-field-label">Allocation (USDC)</span>
              <input
                className="input"
                type="text"
                inputMode="decimal"
                placeholder="e.g. 10.50"
                value={allocationDraft}
                onChange={(e) => setAllocationDraft(e.target.value)}
              />
            </label>
            <label className="book-field">
              <span className="book-field-label">task_id (optional)</span>
              <input
                className="input"
                type="text"
                placeholder="auto-generated if empty"
                value={taskIdDraft}
                onChange={(e) => setTaskIdDraft(e.target.value)}
                spellCheck={false}
              />
            </label>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={claimSaving}
              onClick={() => void handleClaim()}
            >
              {claimSaving ? 'Claiming…' : 'Claim inflow'}
            </button>
          </div>
          {claimMessage && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '0.75rem' }}>{claimMessage}</p>
          )}
        </div>

        <div>
          <h4 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>Correct inflow</h4>
          <div className="book-inflow-form">
            <label className="book-field">
              <span className="book-field-label">task_id</span>
              <input
                className="input"
                type="text"
                placeholder="inflow row task_id"
                value={correctTaskId}
                onChange={(e) => setCorrectTaskId(e.target.value)}
                spellCheck={false}
              />
            </label>
            <label className="book-field">
              <span className="book-field-label">New allocation (USDC, optional)</span>
              <input
                className="input"
                type="text"
                inputMode="decimal"
                placeholder="leave empty to keep"
                value={correctAllocation}
                onChange={(e) => setCorrectAllocation(e.target.value)}
              />
            </label>
            <label className="book-field">
              <span className="book-field-label">Reason</span>
              <input
                className="input"
                type="text"
                placeholder="why this correction"
                value={correctReason}
                onChange={(e) => setCorrectReason(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={correctSaving}
              onClick={() => void handleCorrect()}
            >
              {correctSaving ? 'Correcting…' : 'Append correction'}
            </button>
          </div>
          {correctMessage && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '0.75rem' }}>{correctMessage}</p>
          )}
        </div>
      </div>
    </section>
  );
}
