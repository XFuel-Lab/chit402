import { useMemo, useState, useEffect, type CSSProperties } from 'react';
import { useAccount, useChainId, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { formatEther, parseEther } from 'viem';
import { ADDRESSES, BELIEVER_ROUND_ABI, isDeployed } from '../contracts';

const ADMIN_MULTISIG = '0x9D6fC5EEa264182783Da01Bcfc135E52bE7bF257';
const BONUS_BPS = [10_000, 10_800, 12_000, 13_500] as const;
const EXPLORER_TESTNET = 'https://testnet-explorer.thetatoken.org';
const EXPLORER_MAINNET = 'https://explorer.thetatoken.org';

function truncate(addr: string) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '';
}

export default function Believers() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const roundAddr = ADDRESSES.believerRound;
  const deployed = isDeployed(roundAddr);

  const [lockTier, setLockTier] = useState(0);
  const [amountTfuel, setAmountTfuel] = useState('');
  const [msg, setMsg] = useState<{ type: 'ok' | 'err' | 'info'; text: string } | null>(null);

  const { data: stats, refetch: refetchStats } = useReadContract({
    address: roundAddr,
    abi: BELIEVER_ROUND_ABI,
    functionName: 'getStats',
    query: { enabled: deployed, refetchInterval: 15_000 },
  });

  const { data: xfCap } = useReadContract({
    address: roundAddr,
    abi: BELIEVER_ROUND_ABI,
    functionName: 'xfAllocationCap',
    query: { enabled: deployed },
  });

  const { data: xfReserved } = useReadContract({
    address: roundAddr,
    abi: BELIEVER_ROUND_ABI,
    functionName: 'totalXFReserved',
    query: { enabled: deployed, refetchInterval: 15_000 },
  });

  const { data: priceNum } = useReadContract({
    address: roundAddr,
    abi: BELIEVER_ROUND_ABI,
    functionName: 'tokenPriceNumerator',
    query: { enabled: deployed },
  });

  const { data: priceDen } = useReadContract({
    address: roundAddr,
    abi: BELIEVER_ROUND_ABI,
    functionName: 'tokenPriceDenominator',
    query: { enabled: deployed },
  });

  const { writeContract, data: hash, isPending, error: writeError, reset } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });

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

  const onCommit = () => {
    setMsg(null);
    if (!deployed) {
      setMsg({ type: 'err', text: 'BelieverRound not configured (set VITE_BELIEVER_ROUND_ADDRESS).' });
      return;
    }
    if (!isConnected || !address) {
      setMsg({ type: 'err', text: 'Connect your wallet from the header first.' });
      return;
    }
    const v = parseFloat(amountTfuel);
    if (!v || v < 100) {
      setMsg({ type: 'err', text: 'Minimum commitment is 100 TFUEL.' });
      return;
    }
    let wei: bigint;
    try {
      wei = parseEther(amountTfuel.trim());
    } catch {
      setMsg({ type: 'err', text: 'Invalid TFUEL amount.' });
      return;
    }

    if (lockTier === 0) {
      writeContract({
        address: roundAddr,
        abi: BELIEVER_ROUND_ABI,
        functionName: 'commit',
        value: wei,
      });
    } else {
      writeContract({
        address: roundAddr,
        abi: BELIEVER_ROUND_ABI,
        functionName: 'commitWithLock',
        args: [lockTier],
        value: wei,
      });
    }
    setMsg({ type: 'info', text: 'Confirm in your wallet…' });
  };

  const explorerBase = chainId === 361 ? EXPLORER_MAINNET : EXPLORER_TESTNET;

  return (
    <div className="page" style={{ maxWidth: 900, margin: '0 auto', padding: '0 1rem 4rem' }}>
      <div style={{ textAlign: 'center', padding: '2.5rem 0 1.5rem' }}>
        <span className="badge badge-cyan" style={{ marginBottom: '1rem', display: 'inline-block' }}>
          {chainId === 361 ? 'Theta mainnet (361)' : 'Theta testnet (365)'} · Community contribution
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
            min={100}
            step={100}
            placeholder="100"
            value={amountTfuel}
            onChange={(e) => setAmountTfuel(e.target.value)}
            style={{ width: '100%', marginBottom: '0.35rem' }}
          />
          <p style={{ fontSize: '0.78rem', color: '#55556a', marginBottom: '1rem' }}>Minimum 100 TFUEL</p>

          <div style={styles.xfPreview}>
            <span style={{ color: '#8a8a9a' }}>You receive (at TGE)</span>
            <span style={{ fontWeight: 700, color: '#00d4ff' }}>{xfPreview}</span>
          </div>

          {msg && (
            <p style={{ fontSize: '0.85rem', color: msg.type === 'err' ? '#f87171' : msg.type === 'ok' ? '#4ade80' : '#7dd3fc', marginBottom: '0.75rem' }}>
              {msg.text}
            </p>
          )}

          <button type="button" className="btn btn-primary" style={{ width: '100%' }} disabled={!deployed || isPending || confirming} onClick={onCommit}>
            {isPending || confirming ? 'Waiting for wallet / chain…' : 'Commit TFUEL'}
          </button>

          {hash && (
            <a href={`${explorerBase}/tx/${hash}`} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: '0.75rem', fontSize: '0.82rem', color: '#00d4ff' }}>
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
          <div style={styles.row}><span style={{ color: '#8a8a9a' }}>Engagement rewards</span><span>15% — separate Merkle distributor (see docs)</span></div>
          <div style={styles.row}><span style={{ color: '#8a8a9a' }}>Network</span><span>{chainId === 361 ? 'Theta mainnet (361)' : 'Theta testnet (365)'}</span></div>
          <div style={styles.row}><span style={{ color: '#8a8a9a' }}>Admin</span><span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>{truncate(ADMIN_MULTISIG)} (Safe)</span></div>
        </div>
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
        Contribution to support XFuel development. Not investment advice. Refund if no TGE within 180 days of round open.
        <br />
        <strong style={{ color: '#a1a1b5' }}>Contact:</strong> believers@xfuel.app ·{' '}
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
