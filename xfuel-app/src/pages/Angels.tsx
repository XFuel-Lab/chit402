import { useMemo, useState, useEffect, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useAccount, useChainId, useReadContract, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi';
import { formatEther, parseEther } from 'viem';
import { ADDRESSES, ANGEL_ROUND_ABI, THETA_MAINNET_ID, isDeployed } from '../contracts';

const ADMIN_MULTISIG = '0x9D6fC5EEa264182783Da01Bcfc135E52bE7bF257';
const EXPLORER_TESTNET = 'https://testnet-explorer.thetatoken.org';
const EXPLORER_MAINNET = 'https://explorer.thetatoken.org';

function truncate(addr: string) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '';
}

export default function Angels() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const roundAddr = ADDRESSES.angelRound;
  const deployed = isDeployed(roundAddr);
  const wrongChain = isConnected && chainId !== THETA_MAINNET_ID;

  const [amountTfuel, setAmountTfuel] = useState('');
  const [msg, setMsg] = useState<{ type: 'ok' | 'err' | 'info'; text: string } | null>(null);

  const { data: stats, refetch: refetchStats } = useReadContract({
    address: roundAddr,
    abi: ANGEL_ROUND_ABI,
    functionName: 'getStats',
    chainId: THETA_MAINNET_ID,
    query: { enabled: deployed, refetchInterval: 15_000 },
  });

  const { data: minCommitment } = useReadContract({
    address: roundAddr,
    abi: ANGEL_ROUND_ABI,
    functionName: 'minCommitment',
    chainId: THETA_MAINNET_ID,
    query: { enabled: deployed },
  });

  const { data: priceNum } = useReadContract({
    address: roundAddr,
    abi: ANGEL_ROUND_ABI,
    functionName: 'tokenPriceNumerator',
    chainId: THETA_MAINNET_ID,
    query: { enabled: deployed },
  });

  const { data: priceDen } = useReadContract({
    address: roundAddr,
    abi: ANGEL_ROUND_ABI,
    functionName: 'tokenPriceDenominator',
    chainId: THETA_MAINNET_ID,
    query: { enabled: deployed },
  });

  const { data: xfCap } = useReadContract({
    address: roundAddr,
    abi: ANGEL_ROUND_ABI,
    functionName: 'xfAllocationCap',
    chainId: THETA_MAINNET_ID,
    query: { enabled: deployed },
  });

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
      setMsg({ type: 'ok', text: 'Transaction confirmed.' });
      refetchStats();
    }
  }, [isSuccess, hash, refetchStats]);

  const uiMinTfuel = import.meta.env.VITE_ANGEL_MIN_TFUEL || '10000';
  const uiMinWei = parseEther(uiMinTfuel);
  const onChainMinWei = typeof minCommitment === 'bigint' ? minCommitment : null;
  const effectiveMinWei = onChainMinWei !== null && onChainMinWei > uiMinWei ? onChainMinWei : uiMinWei;
  const effectiveMinLabel = formatEther(effectiveMinWei);
  const hardCapTfuel = stats ? Number(formatEther(stats[4])) : 0;
  const num = priceNum ?? 8n;
  const den = priceDen && priceDen > 0n ? priceDen : 1n;

  const xfPreview = useMemo(() => {
    const v = parseFloat(amountTfuel) || 0;
    if (v <= 0) return '0 XF';
    const xf = (v * Number(num)) / Number(den);
    return `${xf.toLocaleString(undefined, { maximumFractionDigits: 0 })} XF`;
  }, [amountTfuel, num, den]);

  const progress = useMemo(() => {
    if (!stats || !hardCapTfuel) return { pct: 0, committedLabel: '0 TFUEL committed' };
    const committed = Number(formatEther(stats[0]));
    const pct = Math.min(100, (committed / hardCapTfuel) * 100);
    return {
      pct,
      committedLabel: `${committed.toLocaleString(undefined, { maximumFractionDigits: 0 })} TFUEL committed`,
    };
  }, [stats, hardCapTfuel]);

  const xfReserved = stats?.[8];
  const xfProgress = useMemo(() => {
    if (!xfCap || xfCap === 0n || xfReserved === undefined) return { pct: 0, label: 'XF allocation (on-chain cap)' };
    const pct = Math.min(100, Number((xfReserved * 10000n) / xfCap) / 100);
    const reservedHuman = Number(formatEther(xfReserved));
    const capHuman = Number(formatEther(xfCap));
    return {
      pct,
      label: `${reservedHuman.toLocaleString(undefined, { maximumFractionDigits: 0 })} / ${capHuman.toLocaleString(undefined, { maximumFractionDigits: 0 })} XF reserved`,
    };
  }, [xfCap, xfReserved]);

  const statusLabel = useMemo(() => {
    if (!stats) return '—';
    const labels = ['Open', 'Closed', 'TGE live'];
    return labels[Number(stats[5])] ?? 'Unknown';
  }, [stats]);

  const onCommit = () => {
    setMsg(null);
    if (!deployed) {
      setMsg({ type: 'err', text: 'AngelRound not configured (set VITE_ANGEL_ROUND_ADDRESS).' });
      return;
    }
    if (!isConnected || !address) {
      setMsg({ type: 'err', text: 'Connect your wallet from the header first.' });
      return;
    }
    if (chainId !== THETA_MAINNET_ID) {
      setMsg({ type: 'err', text: `Switch your wallet to Theta Mainnet (chain ${THETA_MAINNET_ID}). You are on chain ${chainId}.` });
      switchChain({ chainId: THETA_MAINNET_ID });
      return;
    }
    const v = parseFloat(amountTfuel);
    if (!v || v <= 0) {
      setMsg({ type: 'err', text: 'Enter a positive TFUEL amount.' });
      return;
    }
    let wei: bigint;
    try {
      wei = parseEther(amountTfuel.trim());
    } catch {
      setMsg({ type: 'err', text: 'Invalid TFUEL amount.' });
      return;
    }
    if (wei < effectiveMinWei) {
      setMsg({
        type: 'err',
        text: `Minimum commitment is ${effectiveMinLabel} TFUEL.`,
      });
      return;
    }

    writeContract({
      address: roundAddr,
      abi: ANGEL_ROUND_ABI,
      functionName: 'commit',
      value: wei,
      chainId: THETA_MAINNET_ID,
    });
    setMsg({ type: 'info', text: 'Confirm in your wallet…' });
  };

  const explorerBase = chainId === 361 ? EXPLORER_MAINNET : EXPLORER_TESTNET;
  const treasuryWithdrawnLabel =
    deployed && stats ? `${Number(formatEther(stats[7])).toLocaleString(undefined, { maximumFractionDigits: 2 })} TFUEL` : '—';

  return (
    <div className="page" style={{ maxWidth: 900, margin: '0 auto', padding: '0 1rem 4rem' }}>
      {wrongChain && (
        <div style={{ background: '#7f1d1d', border: '1px solid #dc2626', borderRadius: 8, padding: '0.75rem 1rem', margin: '1rem 0', textAlign: 'center', color: '#fca5a5', fontWeight: 600 }}>
          Your wallet is on chain {chainId} (testnet). Switch to <strong>Theta Mainnet (361)</strong> to commit.
          <button onClick={() => switchChain({ chainId: THETA_MAINNET_ID })} style={{ marginLeft: 12, padding: '4px 12px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>Switch Now</button>
        </div>
      )}
      <div style={{ textAlign: 'center', padding: '2.5rem 0 1.5rem' }}>
        <span className="badge badge-orange" style={{ marginBottom: '1rem', display: 'inline-block' }}>
          {chainId === THETA_MAINNET_ID ? 'Theta mainnet (361)' : `Wrong network (chain ${chainId})`} · Strategic — high risk
        </span>
        <h1 style={styles.h1}>Angel / Strategic Round</h1>
        <p style={styles.sub}>
          Separate from the{' '}
          <Link to="/believers" style={{ color: '#00d4ff' }}>
            Community Round
          </Link>
          . Up to <strong style={{ color: '#e9d5ff' }}>10%</strong> of XF supply (on-chain cap). No on-chain TFUEL refund. The protocol may move committed TFUEL
          to treasury before TGE (audits, ops) via <code style={{ fontSize: '0.85em' }}>withdrawToTreasury</code> with an on-chain memo. XF vests after TGE (same
          cliff + linear schedule). <strong style={{ color: '#e9d5ff' }}>TGE is triggered separately</strong> from BelieverRound.
        </p>
      </div>

      <div className="grid grid-4" style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
        <div className="card" style={{ padding: '1rem' }}>
          <div className="stat-value" style={{ fontSize: '1.35rem' }}>
            {!deployed ? '—' : stats ? Number(formatEther(stats[0])).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '…'}
          </div>
          <div className="stat-label">TFUEL committed</div>
        </div>
        <div className="card" style={{ padding: '1rem' }}>
          <div className="stat-value" style={{ fontSize: '1.35rem' }}>
            {!deployed ? '—' : stats ? stats[1].toString() : '…'}
          </div>
          <div className="stat-label">Angels</div>
        </div>
        <div className="card" style={{ padding: '1rem' }}>
          <div className="stat-value" style={{ fontSize: '1.35rem' }}>
            {!deployed ? '—' : hardCapTfuel ? hardCapTfuel.toLocaleString() : '…'}
          </div>
          <div className="stat-label">TFUEL hard cap</div>
        </div>
        <div className="card" style={{ padding: '1rem' }}>
          <div className="stat-value" style={{ fontSize: '1.35rem' }}>
            {!deployed ? '—' : `${num.toString()} / ${den.toString()} XF`}
          </div>
          <div className="stat-label">XF per 1 TFUEL</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem', fontSize: '0.85rem' }}>
          <span style={{ color: '#8a8a9a' }}>{progress.committedLabel}</span>
          <span style={{ color: '#8a8a9a' }}>
            {progress.pct.toFixed(1)}% filled · {statusLabel}
          </span>
        </div>
        <div className="progress-bar">
          <div className="progress-bar-fill" style={{ width: `${progress.pct}%`, background: 'linear-gradient(90deg, #a855f7, #f97316)' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.75rem', marginBottom: '0.35rem', fontSize: '0.82rem' }}>
          <span style={{ color: '#8a8a9a' }}>{xfProgress.label}</span>
          <span style={{ color: '#8a8a9a' }}>{xfProgress.pct.toFixed(1)}% of XF cap</span>
        </div>
        <div className="progress-bar">
          <div
            className="progress-bar-fill"
            style={{ width: `${xfProgress.pct}%`, background: 'linear-gradient(90deg, #7c3aed, #ea580c)' }}
          />
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem', padding: '1rem 1.25rem', borderColor: 'rgba(249,115,22,0.35)' }}>
        <p style={{ fontSize: '0.85rem', color: '#fed7aa', margin: 0, lineHeight: 1.55 }}>
          <strong>Legal / risk:</strong> This path is for parties who accept pre-TGE treasury use and no refund. Marketing must stay within applicable law
          (no unregistered securities offers where prohibited). This UI is informational; read the contract and obtain your own advice.
        </p>
      </div>

      <div className="grid grid-2" style={{ gap: '1.5rem', marginBottom: '1.5rem' }}>
        <div className="card" style={{ padding: '1.5rem' }}>
          <div style={styles.cardTitle}>Commit TFUEL</div>
          <p style={{ fontSize: '0.82rem', color: '#8a8a9a', marginBottom: '0.75rem' }}>
            {isConnected
              ? `Wallet: ${truncate(address!)} · chain ${chainId}`
              : 'Use the header to connect (Theta mainnet 361 for production).'}
          </p>

          <label style={styles.label}>Amount (TFUEL)</label>
          <input
            className="input"
            type="number"
            min={0}
            step="any"
            placeholder={effectiveMinLabel}
            value={amountTfuel}
            onChange={(e) => setAmountTfuel(e.target.value)}
            style={{ width: '100%', marginBottom: '0.35rem' }}
          />
          <p style={{ fontSize: '0.78rem', color: '#55556a', marginBottom: '1rem' }}>
            Minimum {effectiveMinLabel} TFUEL
          </p>

          <div style={styles.xfPreview}>
            <span style={{ color: '#8a8a9a' }}>XF allocation (at TGE)</span>
            <span style={{ fontWeight: 700, color: '#c084fc' }}>{xfPreview}</span>
          </div>

          {msg && (
            <p
              style={{
                fontSize: '0.85rem',
                color: msg.type === 'err' ? '#f87171' : msg.type === 'ok' ? '#4ade80' : '#7dd3fc',
                marginBottom: '0.75rem',
              }}
            >
              {msg.text}
            </p>
          )}

          <button type="button" className="btn btn-primary" style={{ width: '100%' }} disabled={isPending || confirming} onClick={onCommit}>
            {isPending || confirming ? 'Waiting for wallet / chain…' : !isConnected ? 'Connect Wallet First' : wrongChain ? 'Switch to Theta Mainnet' : 'Commit TFUEL (Angel)'}
          </button>

          {hash && (
            <a
              href={`${explorerBase}/tx/${hash}`}
              target="_blank"
              rel="noreferrer"
              style={{ display: 'block', marginTop: '0.75rem', fontSize: '0.82rem', color: '#c084fc' }}
            >
              View transaction →
            </a>
          )}
        </div>

        <div className="card" style={{ padding: '1.5rem' }}>
          <div style={styles.cardTitle}>On-chain transparency</div>
          <div style={styles.row}>
            <span style={{ color: '#8a8a9a' }}>XF reserved / cap</span>
            <span>
              {!deployed || !stats || !xfCap
                ? '—'
                : `${Number(formatEther(stats[8])).toLocaleString(undefined, { maximumFractionDigits: 0 })} / ${Number(formatEther(xfCap)).toLocaleString()} XF`}
            </span>
          </div>
          <div style={styles.row}>
            <span style={{ color: '#8a8a9a' }}>Pre-TGE treasury withdrawals</span>
            <span style={{ color: '#fdba74' }}>{treasuryWithdrawnLabel}</span>
          </div>
          <div style={styles.row}>
            <span style={{ color: '#8a8a9a' }}>Vesting</span>
            <span>90d cliff + 270d linear (same schedule family as Believers)</span>
          </div>
          <div style={styles.row}>
            <span style={{ color: '#8a8a9a' }}>veXF</span>
            <span>Not issued here — lock XF in governance after you hold XF</span>
          </div>
          <div style={styles.row}>
            <span style={{ color: '#8a8a9a' }}>Admin</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>{truncate(ADMIN_MULTISIG)} (Safe)</span>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: '1.25rem', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '0.72rem', color: '#8a8a9a', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.25rem' }}>AngelRound</div>
          <code style={{ fontSize: '0.85rem' }}>{deployed ? roundAddr : 'Set VITE_ANGEL_ROUND_ADDRESS'}</code>
        </div>
        {deployed && (
          <a href={`${explorerBase}/address/${roundAddr}`} target="_blank" rel="noreferrer" style={{ color: '#c084fc', fontSize: '0.85rem' }}>
            Explorer →
          </a>
        )}
      </div>

      <p style={{ fontSize: '0.72rem', color: '#55556a', textAlign: 'center', marginTop: '2rem', lineHeight: 1.6 }}>
        Not investment advice. No Believer-style refund. Pre-TGE TFUEL may be used for protocol needs as disclosed on-chain.
      </p>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  h1: {
    fontSize: 'clamp(2rem, 5vw, 2.75rem)',
    fontWeight: 800,
    background: 'linear-gradient(135deg, #c084fc 0%, #f97316 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
    marginBottom: '0.75rem',
  },
  sub: { color: '#8a8a9a', fontSize: '1.05rem', maxWidth: 620, margin: '0 auto', lineHeight: 1.6 },
  cardTitle: {
    fontSize: '0.75rem',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    color: '#8a8a9a',
    marginBottom: '1rem',
  },
  label: { display: 'block', fontSize: '0.85rem', color: '#8a8a9a', marginBottom: '0.35rem' },
  xfPreview: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.75rem 1rem',
    background: 'rgba(168,85,247,0.08)',
    border: '1px solid rgba(168,85,247,0.25)',
    borderRadius: 8,
    marginBottom: '1rem',
  },
  row: { display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: '0.88rem', gap: '0.75rem' },
};
