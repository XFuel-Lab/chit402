import { useState } from 'react';
import { useAccount } from 'wagmi';
import { useReadContract } from 'wagmi';
import { formatEther } from 'viem';
import { ADDRESSES, SPLITTER_ABI, GOVERNANCE_ABI, isDeployed } from '../contracts';

const stakingRoutes = [
  {
    network: 'Bittensor',
    token: 'TAO',
    apy: '(demo)',
    tvl: '(demo)',
    minStake: '1 TAO',
    mechanism: 'Subnet Delegation',
    status: 'live' as const,
    description: 'Delegate TAO to Bittensor subnets via EVM staking precompile. Rewards auto-compound.',
  },
  {
    network: 'Theta',
    token: 'TFUEL',
    apy: '(demo)',
    tvl: '(demo)',
    minStake: '10,000 TFUEL',
    mechanism: 'Guardian Node',
    status: 'live' as const,
    description: 'Stake TFUEL as a Guardian Node operator. Edge compute rewards distributed weekly.',
  },
  {
    network: 'Osmosis',
    token: 'OSMO',
    apy: '(demo)',
    tvl: '(demo)',
    minStake: '10 OSMO',
    mechanism: 'LP Staking',
    status: 'testnet' as const,
    description: 'Provide liquidity to XF/OSMO pools. Superfluid staking for dual rewards.',
  },
  {
    network: 'Aptos',
    token: 'APT',
    apy: '(demo)',
    tvl: '—',
    minStake: '10 APT',
    mechanism: 'Validator Delegation',
    status: 'planned' as const,
    description: 'Delegate APT to XFuel validators on Aptos network. Move-native staking.',
  },
];

export default function Staking() {
  const [selectedRoute, setSelectedRoute] = useState(0);
  const [stakeAmount, setStakeAmount] = useState('');
  const { isConnected } = useAccount();

  const splitterDeployed = isDeployed(ADDRESSES.splitter);
  const govDeployed = isDeployed(ADDRESSES.governance);

  const { data: totalDeposited } = useReadContract({
    address: ADDRESSES.splitter,
    abi: SPLITTER_ABI,
    functionName: 'totalDeposited',
    query: { enabled: splitterDeployed },
  });

  const { data: totalLocked } = useReadContract({
    address: ADDRESSES.governance,
    abi: GOVERNANCE_ABI,
    functionName: 'totalLocked',
    query: { enabled: govDeployed },
  });

  const route = stakingRoutes[selectedRoute];
  const estimatedReward = stakeAmount
    ? (parseFloat(stakeAmount) * parseFloat(route.apy) / 100).toFixed(4)
    : '0.00';

  const tvlDisplay = totalDeposited
    ? `$${(Number(formatEther(totalDeposited)) * 0.5).toFixed(1)}M`
    : '—';
  const veXFDisplay = totalLocked
    ? `${(Number(formatEther(totalLocked)) / 1e6).toFixed(1)}M XF`
    : '—';

  const stakingStats = [
    { label: 'Total Staked Value', value: tvlDisplay },
    { label: 'Avg. APY', value: '(demo)' },
    { label: 'Active Stakers', value: '(demo)' },
    { label: 'veXF Locked', value: veXFDisplay },
  ];

  return (
    <div className="page">
      <div className="container">
        <div className="page-header">
          <h1>Fee-to-Stake</h1>
          <p>Fee-to-stake routing (roadmap). Figures below are demo unless your contracts are wired.</p>
        </div>

        {!splitterDeployed && (
          <div style={{ fontSize: '0.8rem', color: '#f59e0b', textAlign: 'center', marginBottom: '1rem' }}>
            Contracts not configured — showing demo data. Deploy and set VITE_SPLITTER_ADDRESS to connect.
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
