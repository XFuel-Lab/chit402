import { useMemo, useState, useEffect, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useAccount, useChainId, useReadContract, useWriteContract, useWaitForTransactionReceipt, useSwitchChain, useBlock } from 'wagmi';
import { formatEther, parseEther } from 'viem';
import { ADDRESSES, BELIEVER_ROUND_ABI, THETA_MAINNET_ID, isDeployed } from '../contracts';

const ADMIN_MULTISIG = '0x9D6fC5EEa264182783Da01Bcfc135E52bE7bF257';
const BONUS_BPS = [10_000, 10_800, 12_000, 13_500] as const;
const EXPLORER_TESTNET = 'https://testnet-explorer.thetatoken.org';
const EXPLORER_MAINNET = 'https://explorer.thetatoken.org';

/** Must match `BelieverRound.REFUND_DEADLINE` (180 days). */
const REFUND_DEADLINE_SEC = 15552000n;

function truncate(addr: string) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '';
}

export default function Believers() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const roundAddr = ADDRESSES.believerRound;
  const deployed = isDeployed(roundAddr);
  const wrongChain = isConnected && chainId !== THETA_MAINNET_ID;

  const [lockTier, setLockTier] = useState(0);
  const [amountTfuel, setAmountTfuel] = useState('');
  const [commitMsg, setCommitMsg] = useState<{ type: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const [refundMsg, setRefundMsg] = useState<{ type: 'ok' | 'err' | 'info'; text: string } | null>(null);

  const { data: stats, refetch: refetchStats } = useReadContract({
    address: roundAddr,
    abi: BELIEVER_ROUND_ABI,
    functionName: 'getStats',
    chainId: THETA_MAINNET_ID,
    query: { enabled: deployed, refetchInterval: 15_000 },
  });

  const { data: xfCap } = useReadContract({
    address: roundAddr,
    abi: BELIEVER_ROUND_ABI,
    functionName: 'xfAllocationCap',
    chainId: THETA_MAINNET_ID,
    query: { enabled: deployed },
  });

  const { data: xfReserved } = useReadContract({
    address: roundAddr,
    abi: BELIEVER_ROUND_ABI,
    functionName: 'totalXFReserved',
    chainId: THETA_MAINNET_ID,
    query: { enabled: deployed, refetchInterval: 15_000 },
  });

  const {
    data: minCommitment,
    isSuccess: minReadOk,
    isPending: minReadPending,
    isError: minReadError,
  } = useReadContract({
    address: roundAddr,
    abi: BELIEVER_ROUND_ABI,
    functionName: 'minCommitment',
    chainId: THETA_MAINNET_ID,
    query: { enabled: deployed },
  });

  const { data: priceNum } = useReadContract({
    address: roundAddr,
    abi: BELIEVER_ROUND_ABI,
    functionName: 'tokenPriceNumerator',
    chainId: THETA_MAINNET_ID,
    query: { enabled: deployed },
  });

  const { data: priceDen } = useReadContract({
    address: roundAddr,
    abi: BELIEVER_ROUND_ABI,
    functionName: 'tokenPriceDenominator',
    chainId: THETA_MAINNET_ID,
    query: { enabled: deployed },
  });

  const { data: roundOpenedAt } = useReadContract({
    address: roundAddr,
    abi: BELIEVER_ROUND_ABI,
    functionName: 'roundOpenedAt',
    chainId: THETA_MAINNET_ID,
    query: { enabled: deployed },
  });

  const { data: commitment, refetch: refetchCommitment } = useReadContract({
    address: roundAddr,
    abi: BELIEVER_ROUND_ABI,
    functionName: 'commitments',
    args: address ? [address] : undefined,
    chainId: THETA_MAINNET_ID,
    query: { enabled: deployed && !!address },
  });

  const { data: latestBlock } = useBlock({
    chainId: THETA_MAINNET_ID,
    blockTag: 'latest',
    query: { enabled: deployed, refetchInterval: 15_000 },
  });

  const {
    writeContract: writeCommit,
    data: commitHash,
    isPending: commitPending,
    error: commitError,
    reset: resetCommit,
  } = useWriteContract();
  const {
    writeContract: writeRefund,
    data: refundHash,
    isPending: refundPending,
    error: refundError,
    reset: resetRefund,
  } = useWriteContract();
  const { isLoading: commitConfirming, isSuccess: commitSuccess } = useWaitForTransactionReceipt({
    hash: commitHash,
    chainId: THETA_MAINNET_ID,
  });
  const { isLoading: refundConfirming, isSuccess: refundSuccess } = useWaitForTransactionReceipt({
    hash: refundHash,
    chainId: THETA_MAINNET_ID,
  });

  useEffect(() => {
    if (commitError) {
      setCommitMsg({ type: 'err', text: commitError.message.split('\n')[0] || 'Transaction failed' });
      resetCommit();
    }
  }, [commitError, resetCommit]);

  useEffect(() => {
    if (refundError) {
      setRefundMsg({ type: 'err', text: refundError.message.split('\n')[0] || 'Refund failed' });
      resetRefund();
    }
  }, [refundError, resetRefund]);

  useEffect(() => {
    if (commitSuccess && commitHash) {
      setCommitMsg({ type: 'ok', text: 'Commit confirmed.' });
      refetchStats();
      refetchCommitment();
    }
  }, [commitSuccess, commitHash, refetchStats, refetchCommitment]);

  useEffect(() => {
    if (refundSuccess && refundHash) {
      setRefundMsg({ type: 'ok', text: 'Refund confirmed. TFUEL returned to your wallet.' });
      refetchStats();
      refetchCommitment();
    }
  }, [refundSuccess, refundHash, refetchStats, refetchCommitment]);

  const baseXfPerTfuel = useMemo(() => {
    const n = priceNum ?? 5n;
    const d = priceDen && priceDen > 0n ? priceDen : 1n;
    return Number(n) / Number(d);
  }, [priceNum, priceDen]);

  const xfPreview = useMemo(() => {
    const v = parseFloat(amountTfuel) || 0;
    if (v <= 0) return '0 XF';
    const bps = BONUS_BPS[lockTier] ?? 10_000;
    const xf = (v * baseXfPerTfuel * bps) / 10_000;
    return `${xf.toLocaleString(undefined, { maximumFractionDigits: 0 })} XF`;
  }, [amountTfuel, lockTier, baseXfPerTfuel]);

  const hardCapTfuel = stats ? Number(formatEther(stats[4])) : 0;

  const progress = useMemo(() => {
    if (!stats || !hardCapTfuel) return { pct: 0, committedLabel: '0 TFUEL committed' };
    const committed = Number(formatEther(stats[0]));
    const pct = Math.min(100, (committed / hardCapTfuel) * 100);
    return {
      pct,
      committedLabel: `${committed.toLocaleString(undefined, { maximumFractionDigits: 0 })} TFUEL committed`,
    };
  }, [stats, hardCapTfuel]);

  const xfProgress = useMemo(() => {
    if (!xfCap || xfCap === 0n || !xfReserved) return { pct: 0, label: 'XF allocation (on-chain cap)' };
    const pct = Math.min(100, Number((xfReserved * 10000n) / xfCap) / 100);
    const reservedHuman = Number(formatEther(xfReserved));
    const capHuman = Number(formatEther(xfCap));
    return {
      pct,
      label: `${reservedHuman.toLocaleString(undefined, { maximumFractionDigits: 0 })} / ${capHuman.toLocaleString(undefined, { maximumFractionDigits: 0 })} XF reserved`,
    };
  }, [xfCap, xfReserved]);

  const effXfPerTier = useMemo(() => {
    const b = baseXfPerTfuel;
    return [
      b,
      (b * 10_800) / 10_000,
      (b * 12_000) / 10_000,
      (b * 13_500) / 10_000,
    ].map((x) => x.toLocaleString(undefined, { maximumFractionDigits: 4 }));
  }, [baseXfPerTfuel]);

  const statusLabel = useMemo(() => {
    if (!stats) return '—';
    const labels = ['Open', 'Closed', 'TGE Live', 'Refunding'];
    return labels[Number(stats[5])] ?? 'Unknown';
  }, [stats]);

  const chainNow = latestBlock?.timestamp ?? 0n;
  const chainTimeReady = chainNow > 0n;
  const roundStatusU8 = stats?.[5];
  const tgeTriggered = roundStatusU8 !== undefined && Number(roundStatusU8) === 2;
  const refundDeadlineTs =
    roundOpenedAt !== undefined && roundOpenedAt > 0n ? roundOpenedAt + REFUND_DEADLINE_SEC : 0n;
  const commitmentWei = commitment?.[0] ?? 0n;
  const commitmentRefunded = commitment?.[5] === true;
  const hasCommitment = commitmentWei > 0n;
  const deadlinePassed = refundDeadlineTs > 0n && chainTimeReady && chainNow >= refundDeadlineTs;
  const secondsUntilRefund =
    refundDeadlineTs > 0n && chainTimeReady && chainNow < refundDeadlineTs ? refundDeadlineTs - chainNow : 0n;
  const refundEligible =
    deployed &&
    isConnected &&
    chainId === THETA_MAINNET_ID &&
    chainTimeReady &&
    hasCommitment &&
    !commitmentRefunded &&
    !tgeTriggered &&
    deadlinePassed;

  const refundDeadlineDateLabel =
    refundDeadlineTs > 0n
      ? new Date(Number(refundDeadlineTs) * 1000).toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : null;

  const countdownLabel = useMemo(() => {
    if (secondsUntilRefund <= 0n) return null;
    const s = secondsUntilRefund;
    const days = Number(s / 86400n);
    const hrs = Number((s % 86400n) / 3600n);
    if (days >= 1) return `${days}d ${hrs}h remaining until refund window opens`;
    const mins = Number((s % 3600n) / 60n);
    return `${hrs}h ${mins}m remaining until refund window opens`;
  }, [secondsUntilRefund]);

  const onRequestRefund = () => {
    setRefundMsg(null);
    if (!deployed) {
      setRefundMsg({ type: 'err', text: 'BelieverRound not configured.' });
      return;
    }
    if (!isConnected || !address) {
      setRefundMsg({ type: 'err', text: 'Connect your wallet first.' });
      return;
    }
    if (chainId !== THETA_MAINNET_ID) {
      switchChain({ chainId: THETA_MAINNET_ID });
      setRefundMsg({ type: 'err', text: 'Switch to Theta Mainnet (361) to request a refund.' });
      return;
    }
    if (!refundEligible) {
      setRefundMsg({ type: 'err', text: 'Refund is not available for this wallet right now.' });
      return;
    }
    writeRefund({
      address: roundAddr,
      abi: BELIEVER_ROUND_ABI,
      functionName: 'requestRefund',
      chainId: THETA_MAINNET_ID,
    });
    setRefundMsg({ type: 'info', text: 'Confirm refund in your wallet…' });
  };

  const uiMinTfuel = import.meta.env.VITE_BELIEVER_MIN_TFUEL || '100';
  const uiMinWei = parseEther(uiMinTfuel);
  const onChainMinWei = minReadOk && typeof minCommitment === 'bigint' ? minCommitment : null;
  const effectiveMinWei = onChainMinWei !== null && onChainMinWei > uiMinWei ? onChainMinWei : uiMinWei;
  const effectiveMinLabel = formatEther(effectiveMinWei);

  const onCommit = () => {
    setCommitMsg(null);
    if (!deployed) {
      setCommitMsg({ type: 'err', text: 'BelieverRound not configured (set VITE_BELIEVER_ROUND_ADDRESS).' });
      return;
    }
    if (!isConnected || !address) {
      setCommitMsg({ type: 'err', text: 'Connect your wallet from the header first.' });
      return;
    }
    if (chainId !== THETA_MAINNET_ID) {
      setCommitMsg({ type: 'err', text: `Switch your wallet to Theta Mainnet (chain ${THETA_MAINNET_ID}). You are on chain ${chainId}.` });
      switchChain({ chainId: THETA_MAINNET_ID });
      return;
    }
    const v = parseFloat(amountTfuel);
    if (!v || v <= 0) {
      setCommitMsg({ type: 'err', text: 'Enter a positive TFUEL amount.' });
      return;
    }
    let wei: bigint;
    try {
      wei = parseEther(amountTfuel.trim());
    } catch {
      setCommitMsg({ type: 'err', text: 'Invalid TFUEL amount.' });
      return;
    }
    if (wei < effectiveMinWei) {
      setCommitMsg({
        type: 'err',
        text: `Minimum commitment is ${effectiveMinLabel} TFUEL.`,
      });
      return;
    }

    if (lockTier === 0) {
      writeCommit({
        address: roundAddr,
        abi: BELIEVER_ROUND_ABI,
        functionName: 'commit',
        value: wei,
        chainId: THETA_MAINNET_ID,
      });
    } else {
      writeCommit({
        address: roundAddr,
        abi: BELIEVER_ROUND_ABI,
        functionName: 'commitWithLock',
        args: [lockTier],
        value: wei,
        chainId: THETA_MAINNET_ID,
      });
    }
    setCommitMsg({ type: 'info', text: 'Confirm in your wallet…' });
  };

  const explorerBase = chainId === 361 ? EXPLORER_MAINNET : EXPLORER_TESTNET;

  return (
    <div className="page" style={{ maxWidth: 900, margin: '0 auto', padding: '0 1rem 4rem' }}>
      {wrongChain && (
        <div style={{ background: '#7f1d1d', border: '1px solid #dc2626', borderRadius: 8, padding: '0.75rem 1rem', margin: '1rem 0', textAlign: 'center', color: '#fca5a5', fontWeight: 600 }}>
          Your wallet is on chain {chainId} (testnet). Switch to <strong>Theta Mainnet (361)</strong> to commit.
          <button onClick={() => switchChain({ chainId: THETA_MAINNET_ID })} style={{ marginLeft: 12, padding: '4px 12px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>Switch Now</button>
        </div>
      )}
      <div style={{ textAlign: 'center', padding: '2.5rem 0 1.5rem' }}>
        <span className="badge badge-cyan" style={{ marginBottom: '1rem', display: 'inline-block' }}>
          {chainId === THETA_MAINNET_ID ? 'Theta mainnet (361)' : `Wrong network (chain ${chainId})`} · Community contribution
        </span>
        <h1 style={styles.h1}>XFuel Community Round</h1>
        <p style={styles.sub}>
          Up to <strong style={{ color: '#a5f3fc' }}>15%</strong> of XF supply sold here (on-chain <code style={{ fontSize: '0.88em' }}>xfAllocationCap</code>
          ). Commit TFUEL; 3-month cliff + 9-month linear vest. Optional lock tiers earn bonus XF. Multisig may update XF/TFUEL price while the round is open (
          <a href="https://github.com/XFuel-Lab/xfuel-protocol/blob/main/docs/PRICING_TFUEL_XF.md" style={{ color: '#00d4ff' }} rel="noreferrer">
            pricing policy
          </a>
          ).
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
          <div className="stat-label">Believers</div>
        </div>
        <div className="card" style={{ padding: '1rem' }}>
          <div className="stat-value" style={{ fontSize: '1.35rem' }}>
            {!deployed || !stats ? '…' : hardCapTfuel.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
          <div className="stat-label">TFUEL hard cap (chain)</div>
        </div>
        <div className="card" style={{ padding: '1rem' }}>
          <div className="stat-value" style={{ fontSize: '1.35rem' }}>
            {!deployed ? '…' : `${baseXfPerTfuel.toLocaleString(undefined, { maximumFractionDigits: 2 })} XF`}
          </div>
          <div className="stat-label">Base / 1 TFUEL (chain)</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem', fontSize: '0.85rem' }}>
          <span style={{ color: '#8a8a9a' }}>{progress.committedLabel}</span>
          <span style={{ color: '#8a8a9a' }}>{progress.pct.toFixed(1)}% filled · {statusLabel}</span>
        </div>
        <div className="progress-bar">
          <div className="progress-bar-fill" style={{ width: `${progress.pct}%` }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.75rem', marginBottom: '0.35rem', fontSize: '0.82rem' }}>
          <span style={{ color: '#8a8a9a' }}>{xfProgress.label}</span>
          <span style={{ color: '#8a8a9a' }}>{xfProgress.pct.toFixed(1)}% of XF cap</span>
        </div>
        <div className="progress-bar">
          <div
            className="progress-bar-fill"
            style={{ width: `${xfProgress.pct}%`, background: 'linear-gradient(90deg, #8b5cf6, #06b6d4)' }}
          />
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem', padding: '1rem 1.25rem', borderColor: 'rgba(168,85,247,0.25)' }}>
        <p style={{ fontSize: '0.85rem', color: '#c4b5fd', margin: 0, lineHeight: 1.55 }}>
          <strong>Grant path:</strong> Applications may be submitted to ecosystem programs (e.g. YZi Labs EASY, Theta).
          Outcomes are not guaranteed. Proceeds are budgeted toward audit and infrastructure.
        </p>
      </div>

      <div className="grid grid-2" style={{ gap: '1.5rem', marginBottom: '1.5rem' }}>
        <div className="card" style={{ padding: '1.5rem' }}>
          <div style={styles.cardTitle}>Commit TFUEL</div>
          <p style={{ fontSize: '0.82rem', color: '#8a8a9a', marginBottom: '0.75rem' }}>
            {isConnected
              ? `Wallet: ${truncate(address!)} · chain ${chainId}`
              : 'Use the header to connect (Theta mainnet 361 for production funding).'}
          </p>

          <label style={styles.label}>Lock tier (first commit only; top-ups must match)</label>
          <select
            value={lockTier}
            onChange={(e) => setLockTier(Number(e.target.value))}
            className="input"
            style={{ width: '100%', marginBottom: '0.75rem' }}
          >
            <option value={0}>Base — chain XF/TFUEL · claims after cliff</option>
            <option value={1}>+8% XF · earliest claim 365d after TGE</option>
            <option value={2}>+20% XF · earliest claim 730d after TGE</option>
            <option value={3}>+35% XF · earliest claim 1095d after TGE</option>
          </select>

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
            <span style={{ color: '#8a8a9a' }}>You receive (at TGE)</span>
            <span style={{ fontWeight: 700, color: '#00d4ff' }}>{xfPreview}</span>
          </div>

          {commitMsg && (
            <p style={{ fontSize: '0.85rem', color: commitMsg.type === 'err' ? '#f87171' : commitMsg.type === 'ok' ? '#4ade80' : '#7dd3fc', marginBottom: '0.75rem' }}>
              {commitMsg.text}
            </p>
          )}

          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%' }}
            disabled={commitPending || commitConfirming}
            onClick={onCommit}
          >
            {commitPending || commitConfirming ? 'Waiting for wallet / chain…' : !isConnected ? 'Connect Wallet First' : wrongChain ? 'Switch to Theta Mainnet' : 'Commit TFUEL'}
          </button>

          {commitHash && (
            <a href={`${explorerBase}/tx/${commitHash}`} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: '0.75rem', fontSize: '0.82rem', color: '#00d4ff' }}>
              View transaction →
            </a>
          )}
        </div>

        <div className="card" style={{ padding: '1.5rem' }}>
          <div style={styles.cardTitle}>Round parameters</div>
          <div style={styles.row}><span style={{ color: '#8a8a9a' }}>Round type</span><span>Single open sale (no phased tranches)</span></div>
          <div style={styles.row}>
            <span style={{ color: '#8a8a9a' }}>TFUEL hard cap</span>
            <span>{!stats ? '—' : `${hardCapTfuel.toLocaleString()} TFUEL`}</span>
          </div>
          <div style={styles.row}>
            <span style={{ color: '#8a8a9a' }}>XF cap (this contract)</span>
            <span>{!xfCap ? '—' : `${Number(formatEther(xfCap)).toLocaleString()} XF (15% policy)`}</span>
          </div>
          <div style={styles.row}>
            <span style={{ color: '#8a8a9a' }}>Base XF / TFUEL</span>
            <span style={{ color: '#00d4ff' }}>{baseXfPerTfuel.toLocaleString(undefined, { maximumFractionDigits: 4 })} (on-chain)</span>
          </div>
          <div style={styles.row}>
            <span style={{ color: '#8a8a9a' }}>Min commit</span>
            <span>{effectiveMinLabel} TFUEL</span>
          </div>
          <div style={styles.row}><span style={{ color: '#8a8a9a' }}>Engagement rewards</span><span>15% — separate Merkle distributor (see docs)</span></div>
          <div style={styles.row}><span style={{ color: '#8a8a9a' }}>Network</span><span>{chainId === THETA_MAINNET_ID ? 'Theta mainnet (361)' : <span style={{ color: '#f87171' }}>Wrong network (chain {chainId})</span>}</span></div>
          <div style={styles.row}><span style={{ color: '#8a8a9a' }}>Admin</span><span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>{truncate(ADMIN_MULTISIG)} (Safe)</span></div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem', padding: '1.5rem', borderColor: 'rgba(6,182,212,0.25)' }}>
        <div style={styles.cardTitle}>TFUEL refund (on-chain)</div>
        <p style={{ fontSize: '0.82rem', color: '#8a8a9a', marginBottom: '1rem', lineHeight: 1.55 }}>
          If <strong>TGE is not triggered</strong> within <strong>180 days</strong> of the round opening, you may call <code style={{ fontSize: '0.85em' }}>requestRefund</code> on BelieverRound to recover your committed TFUEL (and release your XF reservation). This does not apply after TGE.{' '}
          <Link to="/security" style={{ color: '#00d4ff' }}>
            Security &amp; transparency
          </Link>
        </p>
        {!deployed ? (
          <p style={{ fontSize: '0.85rem', color: '#8a8a9a', margin: 0 }}>Configure <code style={{ fontSize: '0.85em' }}>VITE_BELIEVER_ROUND_ADDRESS</code> to load refund status.</p>
        ) : !isConnected ? (
          <p style={{ fontSize: '0.85rem', color: '#8a8a9a', margin: 0 }}>Connect your wallet on Theta mainnet (361) to see eligibility for your address.</p>
        ) : wrongChain ? (
          <p style={{ fontSize: '0.85rem', color: '#fca5a5', margin: 0 }}>
            Switch to Theta Mainnet to interact with refunds.{' '}
            <button type="button" onClick={() => switchChain({ chainId: THETA_MAINNET_ID })} style={{ marginLeft: 8, padding: '4px 10px', borderRadius: 4, border: 'none', background: '#0891b2', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
              Switch
            </button>
          </p>
        ) : tgeTriggered ? (
          <p style={{ fontSize: '0.85rem', color: '#86efac', margin: 0 }}>TGE has been triggered — on-chain refunds via this path are closed. Claims follow vesting.</p>
        ) : commitmentRefunded ? (
          <p style={{ fontSize: '0.85rem', color: '#86efac', margin: 0 }}>This wallet has already received a full TFUEL refund.</p>
        ) : !hasCommitment ? (
          <p style={{ fontSize: '0.85rem', color: '#8a8a9a', margin: 0 }}>No Believer commitment for this wallet.</p>
        ) : roundOpenedAt === undefined || roundOpenedAt === 0n ? (
          <p style={{ fontSize: '0.85rem', color: '#8a8a9a', margin: 0 }}>Refund timing will appear once <code style={{ fontSize: '0.85em' }}>roundOpenedAt</code> is set on-chain.</p>
        ) : (
          <>
            <div style={{ ...styles.xfPreview, marginBottom: '0.75rem', background: 'rgba(6,182,212,0.06)', borderColor: 'rgba(6,182,212,0.2)' }}>
              <span style={{ color: '#8a8a9a' }}>Your commitment</span>
              <span style={{ fontWeight: 700, color: '#22d3ee' }}>{formatEther(commitmentWei)} TFUEL</span>
            </div>
            <p style={{ fontSize: '0.8rem', color: '#a5f3fc', marginBottom: '0.5rem' }}>
              Refund window opens: <strong>{refundDeadlineDateLabel}</strong>
            </p>
            {!chainTimeReady ? (
              <p style={{ fontSize: '0.82rem', color: '#8a8a9a', marginBottom: '0.75rem' }}>Loading chain time…</p>
            ) : !deadlinePassed && countdownLabel ? (
              <p style={{ fontSize: '0.82rem', color: '#fcd34d', marginBottom: '0.75rem' }}>{countdownLabel}</p>
            ) : null}
            {deadlinePassed && refundEligible ? (
              <p style={{ fontSize: '0.82rem', color: '#86efac', marginBottom: '0.75rem' }}>You are eligible to request a full TFUEL refund now.</p>
            ) : null}
            {deadlinePassed && hasCommitment && !commitmentRefunded && !tgeTriggered && !refundEligible ? (
              <p style={{ fontSize: '0.82rem', color: '#fbbf24', marginBottom: '0.75rem' }}>Unable to confirm eligibility — wait for block time to sync or retry.</p>
            ) : null}
            {refundMsg && (
              <p style={{ fontSize: '0.85rem', color: refundMsg.type === 'err' ? '#f87171' : refundMsg.type === 'ok' ? '#4ade80' : '#7dd3fc', marginBottom: '0.75rem' }}>
                {refundMsg.text}
              </p>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              style={{ width: '100%', borderColor: 'rgba(34,211,238,0.45)', color: '#a5f3fc' }}
              disabled={refundPending || refundConfirming || !refundEligible}
              onClick={onRequestRefund}
            >
              {refundPending || refundConfirming ? 'Waiting for wallet…' : refundEligible ? 'Request full TFUEL refund' : deadlinePassed ? 'Refund unavailable' : 'Refund not open yet'}
            </button>
            {refundHash && (
              <a href={`${explorerBase}/tx/${refundHash}`} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: '0.75rem', fontSize: '0.82rem', color: '#00d4ff' }}>
                View refund transaction →
              </a>
            )}
          </>
        )}
      </div>

      <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <div style={styles.cardTitle}>Voluntary lock bonuses (on-chain)</div>
        <p style={{ fontSize: '0.82rem', color: '#8a8a9a', marginBottom: '0.75rem' }}>
          Same vesting curve: 3-month cliff + 9-month linear. Tiers with longer minimum-claim delays receive extra XF, enforced in contract.
        </p>
        <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse' }}>
          <tbody>
            <tr style={{ color: '#8a8a9a', textAlign: 'left' }}>
              <th style={styles.th}>Tier</th>
              <th style={styles.th}>Bonus</th>
              <th style={styles.th}>Eff. XF / TFUEL</th>
              <th style={styles.th}>Earliest claim*</th>
            </tr>
            <tr><td style={styles.td}>0</td><td style={styles.td}>0%</td><td style={styles.td}>{effXfPerTier[0]}</td><td style={styles.td}>After cliff (per vesting)</td></tr>
            <tr><td style={styles.td}>1</td><td style={styles.td}>+8%</td><td style={styles.td}>{effXfPerTier[1]}</td><td style={styles.td}>365d after TGE</td></tr>
            <tr><td style={styles.td}>2</td><td style={styles.td}>+20%</td><td style={styles.td}>{effXfPerTier[2]}</td><td style={styles.td}>730d after TGE</td></tr>
            <tr><td style={styles.td}>3</td><td style={styles.td}>+35%</td><td style={styles.td}>{effXfPerTier[3]}</td><td style={styles.td}>1095d after TGE</td></tr>
          </tbody>
        </table>
        <p style={{ fontSize: '0.72rem', color: '#55556a', marginTop: '0.5rem' }}>
          * Claims still respect linear vesting until the full allocation has vested (~12 months from TGE).
        </p>
      </div>

      <div className="card" style={{ padding: '1.25rem', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '0.72rem', color: '#8a8a9a', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.25rem' }}>BelieverRound</div>
          <code style={{ fontSize: '0.85rem' }}>{deployed ? roundAddr : 'Set VITE_BELIEVER_ROUND_ADDRESS'}</code>
        </div>
        {deployed && (
          <a href={`${explorerBase}/address/${roundAddr}`} target="_blank" rel="noreferrer" style={{ color: '#00d4ff', fontSize: '0.85rem' }}>
            Explorer →
          </a>
        )}
      </div>

      <p style={{ fontSize: '0.72rem', color: '#55556a', textAlign: 'center', marginTop: '2rem', lineHeight: 1.6 }}>
        Contribution to support XFuel development. Not investment advice. On-chain refund via <code style={{ fontSize: '0.85em' }}>requestRefund</code> if no TGE within 180 days of round open.
        <br />
        <strong style={{ color: '#a1a1b5' }}>Contact:</strong> believers@xfuel.app ·{' '}
        <Link to="/security" style={{ color: '#00d4ff' }}>Security</Link>
        {' · '}
        <a href="https://github.com/XFuel-Lab/xfuel-protocol" style={{ color: '#00d4ff' }}>GitHub</a>
      </p>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  h1: {
    fontSize: 'clamp(2rem, 5vw, 2.75rem)',
    fontWeight: 800,
    background: 'linear-gradient(135deg, #00d4ff 0%, #8b5cf6 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
    marginBottom: '0.75rem',
  },
  sub: { color: '#8a8a9a', fontSize: '1.05rem', maxWidth: 560, margin: '0 auto', lineHeight: 1.6 },
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
    background: 'rgba(0,212,255,0.06)',
    border: '1px solid rgba(0,212,255,0.2)',
    borderRadius: 8,
    marginBottom: '1rem',
  },
  row: { display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: '0.88rem' },
  th: { padding: '0.4rem', borderBottom: '1px solid rgba(255,255,255,0.08)' },
  td: { padding: '0.45rem 0.4rem', borderBottom: '1px solid rgba(255,255,255,0.06)' },
};
