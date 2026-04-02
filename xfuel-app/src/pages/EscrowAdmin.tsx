import { useState, useEffect, type CSSProperties } from 'react';
import { useAccount, useChainId, useReadContract, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi';
import { formatEther, parseEther } from 'viem';
import { ADDRESSES, ANGEL_ESCROW_ABI, THETA_MAINNET_ID, isDeployed } from '../contracts';

const BUCKET_NAMES = ['AUDIT', 'SUBCHAIN', 'DEVOPS'] as const;
const ESCROW_ADDR = ADDRESSES.angelEscrow;

function truncate(addr: string) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '';
}

export default function EscrowAdmin() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const deployed = isDeployed(ESCROW_ADDR);
  const wrongChain = isConnected && chainId !== THETA_MAINNET_ID;

  const [msg, setMsg] = useState<{ type: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const [relBucket, setRelBucket] = useState(0);
  const [relRecipient, setRelRecipient] = useState('');
  const [relAmount, setRelAmount] = useState('');
  const [depAmount, setDepAmount] = useState('');

  const rc = (fn: string, args?: readonly unknown[]) => ({
    address: ESCROW_ADDR,
    abi: ANGEL_ESCROW_ABI,
    functionName: fn,
    args,
    chainId: THETA_MAINNET_ID,
    query: { enabled: deployed },
  } as const);

  const { data: balance } = useReadContract(rc('getBalance'));
  const { data: totalRaised } = useReadContract(rc('totalRaised'));
  const { data: threshold } = useReadContract(rc('threshold'));
  const { data: treasury } = useReadContract(rc('treasury'));
  const { data: signerCount } = useReadContract(rc('signerCount'));
  const { data: outstanding } = useReadContract(rc('outstandingObligations'));
  const { data: paused } = useReadContract(rc('paused'));
  const { data: version } = useReadContract(rc('VERSION'));

  const { data: cap0 } = useReadContract(rc('bucketCaps', [0n]));
  const { data: cap1 } = useReadContract(rc('bucketCaps', [1n]));
  const { data: cap2 } = useReadContract(rc('bucketCaps', [2n]));
  const { data: rel0 } = useReadContract(rc('releasedFromBucket', [0]));
  const { data: rel1 } = useReadContract(rc('releasedFromBucket', [1]));
  const { data: rel2 } = useReadContract(rc('releasedFromBucket', [2]));

  const { data: signer0 } = useReadContract(rc('signers', [0n]));
  const { data: signer1 } = useReadContract(rc('signers', [1n]));

  const { writeContract, data: hash, isPending, error: writeError, reset } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash, chainId: THETA_MAINNET_ID });

  useEffect(() => {
    if (writeError) {
      setMsg({ type: 'err', text: writeError.message.split('\n')[0] || 'Transaction failed' });
      reset();
    }
  }, [writeError, reset]);

  useEffect(() => {
    if (isSuccess && hash) {
      setMsg({ type: 'ok', text: `Confirmed: ${hash.slice(0, 14)}…` });
    }
  }, [isSuccess, hash]);

  const guardChain = () => {
    if (!isConnected) { setMsg({ type: 'err', text: 'Connect wallet first.' }); return false; }
    if (chainId !== THETA_MAINNET_ID) {
      setMsg({ type: 'err', text: `Switch to Theta Mainnet (361). You are on chain ${chainId}.` });
      switchChain({ chainId: THETA_MAINNET_ID });
      return false;
    }
    if (!deployed) { setMsg({ type: 'err', text: 'AngelEscrow not configured (set VITE_ANGEL_ESCROW_ADDRESS).' }); return false; }
    return true;
  };

  const onDeposit = () => {
    setMsg(null);
    if (!guardChain()) return;
    const v = parseFloat(depAmount);
    if (!v || v <= 0) { setMsg({ type: 'err', text: 'Enter a positive TFUEL amount.' }); return; }
    writeContract({ address: ESCROW_ADDR, abi: ANGEL_ESCROW_ABI, functionName: 'deposit', value: parseEther(depAmount.trim()), chainId: THETA_MAINNET_ID });
    setMsg({ type: 'info', text: 'Confirm deposit in wallet…' });
  };

  const onRelease = () => {
    setMsg(null);
    if (!guardChain()) return;
    if (!relRecipient || relRecipient.length !== 42) { setMsg({ type: 'err', text: 'Enter a valid recipient address.' }); return; }
    const v = parseFloat(relAmount);
    if (!v || v <= 0) { setMsg({ type: 'err', text: 'Enter a positive TFUEL amount.' }); return; }
    writeContract({
      address: ESCROW_ADDR, abi: ANGEL_ESCROW_ABI, functionName: 'releaseFromBucket',
      args: [relBucket, relRecipient as `0x${string}`, parseEther(relAmount.trim())],
      chainId: THETA_MAINNET_ID,
    });
    setMsg({ type: 'info', text: `Approve releaseFromBucket(${BUCKET_NAMES[relBucket]}) in wallet… (needs ${threshold?.toString() ?? '?'} signer(s))` });
  };

  const onRefundExcess = () => {
    setMsg(null);
    if (!guardChain()) return;
    writeContract({ address: ESCROW_ADDR, abi: ANGEL_ESCROW_ABI, functionName: 'refundExcessToTreasury', chainId: THETA_MAINNET_ID });
    setMsg({ type: 'info', text: 'Approve refundExcessToTreasury in wallet…' });
  };

  const onPause = () => {
    setMsg(null);
    if (!guardChain()) return;
    writeContract({ address: ESCROW_ADDR, abi: ANGEL_ESCROW_ABI, functionName: paused ? 'unpause' : 'pause', chainId: THETA_MAINNET_ID });
    setMsg({ type: 'info', text: `Approve ${paused ? 'unpause' : 'pause'} in wallet…` });
  };

  const caps = [cap0, cap1, cap2];
  const released = [rel0, rel1, rel2];
  const fmt = (v: bigint | undefined) => v !== undefined ? Number(formatEther(v)).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '…';
  const isSigner = isConnected && address && (
    signer0?.toLowerCase() === address.toLowerCase() ||
    signer1?.toLowerCase() === address.toLowerCase()
  );

  const s: Record<string, CSSProperties> = {
    page: { maxWidth: 900, margin: '0 auto', padding: '0 1rem 4rem' },
    h1: { fontSize: '1.6rem', fontWeight: 700, margin: '0 0 0.25rem' },
    sub: { fontSize: '0.85rem', color: '#8a8a9a', maxWidth: 600, margin: '0 auto' },
    card: { padding: '1.25rem', marginBottom: '1rem' },
    row: { display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid #1e293b', fontSize: '0.85rem' },
    input: { width: '100%', padding: '0.6rem', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: '0.9rem', boxSizing: 'border-box' as const },
    btn: { width: '100%', padding: '0.7rem', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: '0.9rem', marginTop: '0.5rem' },
    signerBadge: { display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600 },
  };

  return (
    <div className="page" style={s.page}>
      {wrongChain && (
        <div style={{ background: '#7f1d1d', border: '1px solid #dc2626', borderRadius: 8, padding: '0.75rem 1rem', margin: '1rem 0', textAlign: 'center', color: '#fca5a5', fontWeight: 600 }}>
          Wrong network (chain {chainId}). Switch to <strong>Theta Mainnet (361)</strong>.
          <button onClick={() => switchChain({ chainId: THETA_MAINNET_ID })} style={{ marginLeft: 12, padding: '4px 12px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>Switch Now</button>
        </div>
      )}

      <div style={{ textAlign: 'center', padding: '2.5rem 0 1.5rem' }}>
        <span className="badge badge-orange" style={{ marginBottom: '0.75rem', display: 'inline-block' }}>
          Escrow Admin · {threshold?.toString() ?? '?'}-of-{signerCount?.toString() ?? '?'} multisig
        </span>
        <h1 style={s.h1}>AngelEscrow</h1>
        <p style={s.sub}>
          Immutable TFUEL escrow with fixed buckets (Audit / Subchain / DevOps).
          Each action needs {threshold?.toString() ?? '?'} signer approvals. v{version?.toString() ?? '?'}
        </p>
        {isConnected && (
          <p style={{ fontSize: '0.8rem', color: isSigner ? '#4ade80' : '#f87171', marginTop: '0.5rem' }}>
            {truncate(address!)} · {isSigner ? 'You are a signer' : 'NOT a signer (read-only)'}
          </p>
        )}
      </div>

      {/* Status overview */}
      <div className="grid grid-4" style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
        <div className="card" style={{ padding: '1rem' }}>
          <div className="stat-value" style={{ fontSize: '1.35rem' }}>{fmt(balance as bigint | undefined)}</div>
          <div className="stat-label">Balance (TFUEL)</div>
        </div>
        <div className="card" style={{ padding: '1rem' }}>
          <div className="stat-value" style={{ fontSize: '1.35rem' }}>{fmt(totalRaised as bigint | undefined)}</div>
          <div className="stat-label">Total raised</div>
        </div>
        <div className="card" style={{ padding: '1rem' }}>
          <div className="stat-value" style={{ fontSize: '1.35rem' }}>{fmt(outstanding as bigint | undefined)}</div>
          <div className="stat-label">Outstanding</div>
        </div>
        <div className="card" style={{ padding: '1rem' }}>
          <div className="stat-value" style={{ fontSize: '1.35rem', color: paused ? '#f87171' : '#4ade80' }}>{paused ? 'PAUSED' : 'ACTIVE'}</div>
          <div className="stat-label">Status</div>
        </div>
      </div>

      {/* Bucket breakdown */}
      <div className="card" style={s.card}>
        <div style={{ fontWeight: 700, marginBottom: '0.75rem', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.08em', color: '#94a3b8' }}>Bucket Breakdown</div>
        {BUCKET_NAMES.map((name, i) => (
          <div key={i} style={s.row}>
            <span style={{ color: '#8a8a9a' }}>{name}</span>
            <span>{fmt(released[i] as bigint | undefined)} / {fmt(caps[i] as bigint | undefined)} TFUEL</span>
          </div>
        ))}
        <div style={{ ...s.row, borderBottom: 'none', fontWeight: 600 }}>
          <span>Signers</span>
          <span>{signer0 ? truncate(signer0 as string) : '…'}, {signer1 ? truncate(signer1 as string) : '…'}</span>
        </div>
        <div style={{ ...s.row, borderBottom: 'none' }}>
          <span style={{ color: '#8a8a9a' }}>Treasury</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>{treasury ? truncate(treasury as string) : '…'}</span>
        </div>
      </div>

      {/* Deposit */}
      <div className="card" style={s.card}>
        <div style={{ fontWeight: 700, marginBottom: '0.75rem', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.08em', color: '#94a3b8' }}>Deposit TFUEL</div>
        <input type="text" placeholder="Amount (TFUEL)" value={depAmount} onChange={e => setDepAmount(e.target.value)} style={s.input} />
        <button onClick={onDeposit} disabled={isPending || confirming} style={{ ...s.btn, background: 'linear-gradient(135deg, #06b6d4, #8b5cf6)', color: '#fff' }}>
          {isPending || confirming ? 'Waiting…' : 'Deposit'}
        </button>
      </div>

      {/* Release from bucket */}
      <div className="card" style={s.card}>
        <div style={{ fontWeight: 700, marginBottom: '0.75rem', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.08em', color: '#94a3b8' }}>Release from Bucket (multisig)</div>
        <select value={relBucket} onChange={e => setRelBucket(Number(e.target.value))} style={{ ...s.input, marginBottom: '0.5rem' }}>
          {BUCKET_NAMES.map((name, i) => <option key={i} value={i}>{name} — {fmt(caps[i] as bigint | undefined)} cap / {fmt(released[i] as bigint | undefined)} released</option>)}
        </select>
        <input type="text" placeholder="Recipient address (0x…)" value={relRecipient} onChange={e => setRelRecipient(e.target.value)} style={{ ...s.input, marginBottom: '0.5rem' }} />
        <input type="text" placeholder="Amount (TFUEL)" value={relAmount} onChange={e => setRelAmount(e.target.value)} style={s.input} />
        <button onClick={onRelease} disabled={isPending || confirming} style={{ ...s.btn, background: '#f59e0b', color: '#000' }}>
          {isPending || confirming ? 'Waiting…' : `Release (needs ${threshold?.toString() ?? '?'} approvals)`}
        </button>
      </div>

      {/* Admin actions */}
      <div className="card" style={s.card}>
        <div style={{ fontWeight: 700, marginBottom: '0.75rem', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.08em', color: '#94a3b8' }}>Admin Actions (multisig)</div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={onRefundExcess} disabled={isPending || confirming} style={{ ...s.btn, flex: 1, background: '#334155', color: '#e2e8f0' }}>
            Refund Excess to Treasury
          </button>
          <button onClick={onPause} disabled={isPending || confirming} style={{ ...s.btn, flex: 1, background: paused ? '#22c55e' : '#ef4444', color: '#fff' }}>
            {paused ? 'Unpause' : 'Pause'}
          </button>
        </div>
      </div>

      {/* Feedback */}
      {msg && (
        <div style={{ padding: '0.75rem 1rem', borderRadius: 8, marginTop: '0.5rem', fontWeight: 600, fontSize: '0.85rem',
          background: msg.type === 'ok' ? '#052e16' : msg.type === 'err' ? '#450a0a' : '#172554',
          border: `1px solid ${msg.type === 'ok' ? '#16a34a' : msg.type === 'err' ? '#dc2626' : '#2563eb'}`,
          color: msg.type === 'ok' ? '#4ade80' : msg.type === 'err' ? '#fca5a5' : '#93c5fd',
        }}>
          {msg.text}
        </div>
      )}

      {hash && (
        <a href={`https://explorer.thetatoken.org/tx/${hash}`} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: '0.75rem', fontSize: '0.82rem', color: '#00d4ff', textAlign: 'center' }}>
          View transaction →
        </a>
      )}
    </div>
  );
}
