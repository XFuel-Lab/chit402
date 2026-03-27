import { useState } from 'react';
import { useAccount } from 'wagmi';
import { useReadContract, useWriteContract } from 'wagmi';
import { formatEther, parseEther } from 'viem';
import { ADDRESSES, GOVERNANCE_ABI, isDeployed } from '../contracts';

const mockProposals = [
  {
    id: 'XIP-7',
    title: '[Example] Deploy Inference Router Circuit to Bittensor EVM',
    status: 'active',
    votesFor: 842_500,
    votesAgainst: 124_300,
    quorum: 1_000_000,
    endTime: '2d 14h remaining',
    author: '0xab12...ef34',
    description: 'Deploy the Inference Router circuit on Bittensor EVM subnet to enable verified AI inference routing with SP1 proofs.',
  },
  {
    id: 'XIP-6',
    title: '[Example] Adjust revenue split parameters',
    status: 'passed',
    votesFor: 1_250_000,
    votesAgainst: 180_000,
    quorum: 1_000_000,
    endTime: 'Ended 3d ago',
    author: '0xcd56...gh78',
    description: 'Illustrative proposal — parameters must match deployed CoreRevenueSplitter.',
  },
  {
    id: 'XIP-5',
    title: '[Example] Add Sui network support',
    status: 'passed',
    votesFor: 980_000,
    votesAgainst: 45_000,
    quorum: 1_000_000,
    endTime: 'Ended 1w ago',
    author: '0xij90...kl12',
    description: 'Integrate Sui network into the XFuel bridge and deploy ZK verifier contracts on Sui Move.',
  },
  {
    id: 'XIP-4',
    title: '[Example] Partner hook: third-party agent integration',
    status: 'rejected',
    votesFor: 320_000,
    votesAgainst: 780_000,
    quorum: 1_000_000,
    endTime: 'Ended 2w ago',
    author: '0xmn34...op56',
    description: 'Fictional example — no implied live partnership.',
  },
];

export default function Governance() {
  const [lockAmount, setLockAmount] = useState('');
  const [lockDuration, setLockDuration] = useState('12');
  const { address, isConnected } = useAccount();
  const { writeContract } = useWriteContract();

  const govDeployed = isDeployed(ADDRESSES.governance);

  const { data: totalLocked } = useReadContract({
    address: ADDRESSES.governance,
    abi: GOVERNANCE_ABI,
    functionName: 'totalLocked',
    query: { enabled: govDeployed },
  });

  const { data: proposalCount } = useReadContract({
    address: ADDRESSES.governance,
    abi: GOVERNANCE_ABI,
    functionName: 'proposalCount',
    query: { enabled: govDeployed },
  });

  const { data: userLock } = useReadContract({
    address: ADDRESSES.governance,
    abi: GOVERNANCE_ABI,
    functionName: 'locks',
    args: [address!],
    query: { enabled: govDeployed && !!address },
  });

  const veXFPower = lockAmount
    ? (parseFloat(lockAmount) * (parseInt(lockDuration) / 48)).toFixed(2)
    : '0.00';

  const totalLockedDisplay = totalLocked
    ? `${(Number(formatEther(totalLocked)) / 1e6).toFixed(1)}M XF`
    : '—';

  const userLockedAmount = userLock ? formatEther(userLock[0]) : '0.00';
  const userVeXFBalance = userLock ? formatEther(userLock[2]) : '0.00';
  const userUnlockDate = userLock && userLock[1] > 0n
    ? new Date(Number(userLock[1]) * 1000).toLocaleDateString()
    : '—';

  const handleLock = () => {
    if (!govDeployed || !lockAmount) return;
    const durationSeconds = parseInt(lockDuration) * 30 * 24 * 3600;
    writeContract({
      address: ADDRESSES.governance,
      abi: GOVERNANCE_ABI,
      functionName: 'lock',
      args: [parseEther(lockAmount), BigInt(durationSeconds)],
    });
  };

  const governanceStats = [
    { label: 'Total veXF Locked', value: totalLockedDisplay },
    { label: 'Unique Voters', value: '(demo)' },
    { label: 'Active Proposals', value: proposalCount ? String(Number(proposalCount)) : '—' },
    { label: 'Avg Lock Duration', value: '(demo)' },
  ];

  return (
    <div className="page">
      <div className="container">
        <div className="page-header">
          <h1>veXF Governance</h1>
          <p>Lock XF tokens for veXF voting power. Shape the future of XFuel Protocol.</p>
        </div>

        {!govDeployed && (
          <div style={{ fontSize: '0.8rem', color: '#f59e0b', textAlign: 'center', marginBottom: '1rem' }}>
            Governance contract not configured — showing demo data. Set VITE_GOVERNANCE_ADDRESS to connect.
          </div>
        )}

        <div className="grid grid-4" style={{ marginBottom: '2rem' }}>
          {governanceStats.map((s) => (
            <div key={s.label} className="card" style={{ textAlign: 'center' }}>
              <div className="stat-value" style={{ fontSize: '1.5rem' }}>{s.value}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-2" style={{ marginBottom: '2rem' }}>
          <div className="card" style={{ padding: '2rem' }}>
            <h3 style={{ marginBottom: '1.5rem' }}>Lock XF for veXF</h3>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={labelStyle}>Amount to Lock</label>
              <input
                className="input"
                type="number"
                placeholder="0.00 XF"
                value={lockAmount}
                onChange={(e) => setLockAmount(e.target.value)}
              />
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={labelStyle}>Lock Duration (months)</label>
              <select className="input" value={lockDuration} onChange={(e) => setLockDuration(e.target.value)}>
                <option value="1">1 month</option>
                <option value="3">3 months</option>
                <option value="6">6 months</option>
                <option value="12">12 months (1x multiplier)</option>
                <option value="24">24 months (2x multiplier)</option>
                <option value="48">48 months (4x max)</option>
              </select>
            </div>

            <hr className="separator" />

            <div style={feeRowStyle}>
              <span style={{ color: '#8a8a9a' }}>veXF Power</span>
              <span style={{ color: '#8b5cf6', fontWeight: 700 }}>{veXFPower} veXF</span>
            </div>
            <div style={feeRowStyle}>
              <span style={{ color: '#8a8a9a' }}>Multiplier</span>
              <span>{(parseInt(lockDuration) / 12).toFixed(1)}x</span>
            </div>
            <div style={feeRowStyle}>
              <span style={{ color: '#8a8a9a' }}>Voting Weight</span>
              <span className="badge badge-purple">Quadratic</span>
            </div>

            <button
              className="btn btn-primary"
              style={{ width: '100%', marginTop: '1.5rem', justifyContent: 'center' }}
              onClick={handleLock}
              disabled={!isConnected || !govDeployed}
            >
              {!isConnected ? 'Connect Wallet' : 'Lock XF Tokens'}
            </button>
          </div>

          <div className="card" style={{ padding: '2rem' }}>
            <h3 style={{ marginBottom: '1.5rem' }}>Your Position</h3>
            <div style={{ textAlign: 'center', padding: '2rem 0' }}>
              <div className="stat-value" style={{ fontSize: '2.5rem' }}>
                {isConnected && govDeployed ? parseFloat(userVeXFBalance).toFixed(2) : '0.00'}
              </div>
              <div className="stat-label" style={{ marginBottom: '1.5rem' }}>veXF Balance</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="card">
                  <div style={{ fontWeight: 700, color: '#00d4ff' }}>
                    {isConnected && govDeployed ? `${parseFloat(userLockedAmount).toFixed(2)} XF` : '0.00 XF'}
                  </div>
                  <div className="stat-label">Locked</div>
                </div>
                <div className="card">
                  <div style={{ fontWeight: 700, color: '#8b5cf6' }}>{userUnlockDate}</div>
                  <div className="stat-label">Unlock Date</div>
                </div>
                <div className="card">
                  <div style={{ fontWeight: 700, color: '#22c55e' }}>0</div>
                  <div className="stat-label">Votes Cast</div>
                </div>
                <div className="card">
                  <div style={{ fontWeight: 700, color: '#f59e0b' }}>0</div>
                  <div className="stat-label">Proposals Made</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h3>Proposals (illustrative examples)</h3>
            <button className="btn btn-secondary btn-sm" disabled={!isConnected || !govDeployed}>
              Create Proposal
            </button>
          </div>

          {mockProposals.map((p) => {
            const totalVotes = p.votesFor + p.votesAgainst;
            const forPercent = totalVotes > 0 ? (p.votesFor / totalVotes) * 100 : 0;

            return (
              <div key={p.id} style={proposalStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                  <span className="tag">{p.id}</span>
                  <h3 style={{ fontSize: '1rem', flex: 1 }}>{p.title}</h3>
                  <span className={`badge badge-${p.status === 'active' ? 'cyan' : p.status === 'passed' ? 'green' : 'orange'}`}>
                    {p.status}
                  </span>
                </div>
                <p style={{ color: '#8a8a9a', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                  {p.description}
                </p>
                <div className="progress-bar" style={{ marginBottom: '0.5rem' }}>
                  <div className="progress-bar-fill" style={{ width: `${forPercent}%` }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#8a8a9a' }}>
                  <span>For: {(p.votesFor / 1000).toFixed(0)}K · Against: {(p.votesAgainst / 1000).toFixed(0)}K</span>
                  <span>{p.endTime}</span>
                </div>
                {p.status === 'active' && (
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                    <button className="btn btn-primary btn-sm" disabled={!isConnected || !govDeployed}>
                      Vote For
                    </button>
                    <button className="btn btn-secondary btn-sm" disabled={!isConnected || !govDeployed}>
                      Vote Against
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block', marginBottom: '0.5rem',
  fontSize: '0.85rem', fontWeight: 600, color: '#8a8a9a',
};

const feeRowStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '0.5rem 0', fontSize: '0.9rem',
};

const proposalStyle: React.CSSProperties = {
  padding: '1.25rem',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
};
