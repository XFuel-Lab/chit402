import { useState } from 'react';
import { useAccount } from 'wagmi';
import { useReadContract } from 'wagmi';
import { formatEther } from 'viem';
import { ADDRESSES, GOVERNANCE_ABI, isDeployed } from '../contracts';

type RouteStatus = 'live' | 'testnet' | 'planned';

const stakingRoutes: {
  network: string;
  token: string;
  apy: string;
  tvl: string;
  minStake: string;
  mechanism: string;
  status: RouteStatus;
  description: string;
}[] = [
  {
    network: 'Base (veXF)',
    token: 'XF',
    apy: '(gov)',
    tvl: '(demo)',
    minStake: '—',
    mechanism: 'Vote-escrow lock',
    status: 'planned',
    description: 'Lock XF for veXF voting power (post-TGE on Base). Governance — not a fixed fee-yield entitlement.',
  },
  {
    network: 'Bittensor',
    token: 'TAO',
    apy: '(demo)',
    tvl: '(demo)',
    minStake: '1 TAO',
    mechanism: 'Subnet Delegation',
    status: 'testnet',
    description: 'Optional provider-side stake path via Bittensor EVM precompile (cross-chain, not settlement home).',
  },
  {
    network: 'EdgeCloud (Theta)',
    token: 'TFUEL',
    apy: '(demo)',
    tvl: '(demo)',
    minStake: '—',
    mechanism: 'Provider ops',
    status: 'testnet',
    description: 'Optional GPU provider-side staking for EdgeCloud operators — not XFuel fee settlement.',
  },
];

export default function Staking() {
  const [selectedRoute, setSelectedRoute] = useState(0);
  const [stakeAmount, setStakeAmount] = useState('');
  const { isConnected } = useAccount();

  const govDeployed = isDeployed(ADDRESSES.governance);

  const { data: totalLocked } = useReadContract({
    address: ADDRESSES.governance,
    abi: GOVERNANCE_ABI,
    functionName: 'totalLocked',
    query: { enabled: govDeployed },
  });

  const route = stakingRoutes[selectedRoute];
  const estimatedReward = stakeAmount && !Number.isNaN(parseFloat(route.apy))
    ? (parseFloat(stakeAmount) * parseFloat(route.apy) / 100).toFixed(4)
    : '—';

  const veXFDisplay = totalLocked
    ? `${(Number(formatEther(totalLocked)) / 1e6).toFixed(1)}M XF`
    : '—';

  const stakingStats = [
    { label: 'Settlement home', value: 'Base' },
    { label: 'Fee model', value: 'Token-light' },
    { label: 'Governance', value: 'veXF (post-TGE)' },
    { label: 'veXF Locked', value: veXFDisplay },
  ];

  return (
    <div className="page">
      <div className="container">
        <div className="page-header">
          <h1>Governance staking</h1>
          <p>
            Protocol fees settle in USDC on Base (token-light). Lock XF → veXF for governance when the token launches.
            Figures below are demo unless contracts are wired.
          </p>
        </div>

        {!govDeployed && (
          <div style={{ fontSize: '0.8rem', color: '#f59e0b', textAlign: 'center', marginBottom: '1rem' }}>
            veXF governance not configured — showing demo data. Set VITE_GOVERNANCE_ADDRESS when live on Base.
          </div>
        )}

        <div className="grid grid-4" style={{ marginBottom: '2rem' }}>
          {stakingStats.map((s) => (
            <div key={s.label} className="card" style={{ textAlign: 'center' }}>
              <div className="stat-value" style={{ fontSize: '1.5rem' }}>{s.value}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-2">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <h3>Staking Routes</h3>
            {stakingRoutes.map((r, i) => (
              <div
                key={r.network}
                className="card"
                onClick={() => setSelectedRoute(i)}
                style={{
                  cursor: 'pointer',
                  borderColor: selectedRoute === i ? 'rgba(0,212,255,0.4)' : undefined,
                  boxShadow: selectedRoute === i ? '0 0 20px rgba(0,212,255,0.15)' : undefined,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <h3 style={{ fontSize: '1rem' }}>{r.network}</h3>
                  <span className={`badge badge-${r.status === 'live' ? 'green' : r.status === 'testnet' ? 'orange' : 'purple'}`}>
                    {r.status}
                  </span>
                </div>
                <p style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>{r.description}</p>
                <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.85rem' }}>
                  <div>
                    <span style={{ color: '#8a8a9a' }}>APY: </span>
                    <span style={{ color: '#22c55e', fontWeight: 700 }}>{r.apy}</span>
                  </div>
                  <div>
                    <span style={{ color: '#8a8a9a' }}>TVL: </span>
                    <span style={{ fontWeight: 600 }}>{r.tvl}</span>
                  </div>
                  <div>
                    <span style={{ color: '#8a8a9a' }}>Min: </span>
                    <span>{r.minStake}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="card" style={{ padding: '2rem' }}>
            <h3 style={{ marginBottom: '1.5rem' }}>
              Stake on {route.network}
            </h3>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={labelStyle}>Amount ({route.token})</label>
              <input
                className="input"
                type="number"
                placeholder={`Min: ${route.minStake}`}
                value={stakeAmount}
                onChange={(e) => setStakeAmount(e.target.value)}
              />
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={labelStyle}>Mechanism</label>
              <div className="input" style={{ background: 'var(--bg-card)' }}>{route.mechanism}</div>
            </div>

            <hr className="separator" />

            <div style={feeRow}>
              <span style={{ color: '#8a8a9a' }}>Network</span>
              <span>{route.network}</span>
            </div>
            <div style={feeRow}>
              <span style={{ color: '#8a8a9a' }}>APY</span>
              <span style={{ color: '#22c55e', fontWeight: 700 }}>{route.apy}</span>
            </div>
            <div style={feeRow}>
              <span style={{ color: '#8a8a9a' }}>Est. Annual Reward</span>
              <span style={{ fontWeight: 700 }}>{estimatedReward} {route.token}</span>
            </div>
            <div style={feeRow}>
              <span style={{ color: '#8a8a9a' }}>ZK Verified</span>
              <span className="badge badge-green">SP1 Proof</span>
            </div>

            <button
              className="btn btn-primary"
              style={{ width: '100%', marginTop: '1.5rem', justifyContent: 'center' }}
              disabled={route.status !== 'live' || !isConnected}
            >
              {!isConnected
                ? 'Connect Wallet'
                : route.status === 'live'
                ? `Stake ${route.token}`
                : 'Coming Soon'}
            </button>

            <hr className="separator" />

            <h3 style={{ marginBottom: '1rem', fontSize: '1rem' }}>veXF Locking</h3>
            <p style={{ color: '#8a8a9a', fontSize: '0.85rem', marginBottom: '1rem' }}>
              Lock staking rewards as veXF for governance power and boosted APY.
              Longer locks yield higher multipliers (up to 4x at 48 months).
            </p>
            <button
              className="btn btn-secondary"
              style={{ width: '100%', justifyContent: 'center' }}
              disabled={!isConnected}
            >
              Lock Rewards as veXF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block', marginBottom: '0.5rem',
  fontSize: '0.85rem', fontWeight: 600, color: '#8a8a9a',
};

const feeRow: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '0.5rem 0', fontSize: '0.9rem',
};
