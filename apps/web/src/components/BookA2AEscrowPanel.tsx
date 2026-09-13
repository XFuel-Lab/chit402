import { useCallback, useState } from 'react';
import { bookA2aEscrowAction, type BookA2aJobRecord } from '../lib/agentBook';

type Props = {
  apiV1: string;
  agentId: number;
  session: string;
  defaultTaskId?: string;
};

const DISCLAIMER =
  'A2A escrow v1: ledger hold on a paid task_id — not on-chain escrow. Machine dispute challenges are metered. '
  + 'Chit402 verifies settlement metadata, not closed-weight model execution.';

export default function BookA2AEscrowPanel({ apiV1, agentId, session, defaultTaskId = '' }: Props) {
  const [jobSpecHash, setJobSpecHash] = useState('');
  const [counterpartyId, setCounterpartyId] = useState('');
  const [amount, setAmount] = useState('');
  const [taskId, setTaskId] = useState(defaultTaskId);
  const [jobId, setJobId] = useState('');
  const [outputCommitment, setOutputCommitment] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lastJob, setLastJob] = useState<BookA2aJobRecord | null>(null);

  const run = useCallback(async (action: 'open' | 'fund' | 'submit' | 'release' | 'clawback') => {
    setBusy(true);
    setMessage(null);

    if (action === 'open') {
      if (!jobSpecHash.trim() || !amount.trim() || !counterpartyId.trim()) {
        setMessage('job_spec_hash, amount, and counterparty agent id required.');
        setBusy(false);
        return;
      }
      const cp = Number(counterpartyId);
      if (!Number.isInteger(cp) || cp < 1) {
        setMessage('Invalid counterparty agent id.');
        setBusy(false);
        return;
      }
      const result = await bookA2aEscrowAction(apiV1, { agentId, session }, {
        action: 'open',
        job_spec_hash: jobSpecHash.trim(),
        amount: amount.trim(),
        parties: { principal_agent_id: agentId, counterparty_agent_id: cp },
      });
      setBusy(false);
      if (!result.ok) {
        setMessage(result.message || result.error);
        return;
      }
      if (result.job) {
        setLastJob(result.job);
        setJobId(result.job.job_id);
        setMessage(`Opened ${result.job.job_id}`);
      }
      return;
    }

    if (!jobId.trim()) {
      setMessage('job_id required — open a job first.');
      setBusy(false);
      return;
    }

    const params: Parameters<typeof bookA2aEscrowAction>[2] = {
      action,
      job_id: jobId.trim(),
    };
    if (action === 'fund') {
      if (!taskId.trim()) {
        setMessage('task_id required to fund.');
        setBusy(false);
        return;
      }
      params.task_id = taskId.trim();
    }
    if (action === 'submit') {
      if (outputCommitment.trim()) params.output_commitment = outputCommitment.trim();
      if (taskId.trim()) params.fulfillment_receipt_id = taskId.trim();
      if (!params.output_commitment && !params.fulfillment_receipt_id) {
        setMessage('output_commitment or fulfillment task id required.');
        setBusy(false);
        return;
      }
    }

    const result = await bookA2aEscrowAction(apiV1, { agentId, session }, params);
    setBusy(false);
    if (!result.ok) {
      setMessage(result.message || result.error);
      if (result.job) setLastJob(result.job);
      return;
    }
    if (result.job) {
      setLastJob(result.job);
      setMessage(`Job ${result.job.status} · ${result.job.verify_url || result.job.job_id}`);
    }
  }, [agentId, amount, apiV1, counterpartyId, jobId, jobSpecHash, outputCommitment, session, taskId]);

  return (
    <section className="card" style={{ marginBottom: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h3 style={{ margin: 0 }}>A2A escrow / machine dispute</h3>
        <span className="badge badge-orange">v1</span>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', lineHeight: 1.6, marginBottom: '1rem' }}>
        {DISCLAIMER}
      </p>
      <div className="book-access-form" style={{ gap: '0.75rem' }}>
        <label className="book-field">
          <span className="book-field-label">job_id</span>
          <input className="input" value={jobId} onChange={(e) => setJobId(e.target.value)} placeholder="from open" />
        </label>
        <label className="book-field">
          <span className="book-field-label">job_spec_hash</span>
          <input className="input" value={jobSpecHash} onChange={(e) => setJobSpecHash(e.target.value)} placeholder="0x…" />
        </label>
        <label className="book-field">
          <span className="book-field-label">amount (USDC atomic)</span>
          <input className="input" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="book-field">
          <span className="book-field-label">counterparty agent_id</span>
          <input className="input" value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)} />
        </label>
        <label className="book-field">
          <span className="book-field-label">task_id / fulfillment id</span>
          <input className="input" value={taskId} onChange={(e) => setTaskId(e.target.value)} />
        </label>
        <label className="book-field">
          <span className="book-field-label">output_commitment</span>
          <input className="input" value={outputCommitment} onChange={(e) => setOutputCommitment(e.target.value)} />
        </label>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '1rem' }}>
        {(['open', 'fund', 'submit', 'release', 'clawback'] as const).map((a) => (
          <button key={a} type="button" className="btn btn-secondary" disabled={busy} onClick={() => void run(a)}>
            {a}
          </button>
        ))}
      </div>
      {message && <p style={{ marginTop: '0.75rem', fontSize: '0.85rem' }}>{message}</p>}
      {lastJob?.verify_url && (
        <p style={{ marginTop: '0.5rem', fontSize: '0.82rem', wordBreak: 'break-all' }}>
          verify: <a href={lastJob.verify_url} target="_blank" rel="noreferrer">{lastJob.verify_url}</a>
        </p>
      )}
    </section>
  );
}
