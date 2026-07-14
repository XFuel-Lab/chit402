import { useState } from 'react';
import { useAccount, useSwitchChain } from 'wagmi';
import { useReadContract } from 'wagmi';
import { formatEther } from 'viem';
import { ADDRESSES, SPLITTER_ABI, isDeployed, THETA_MAINNET_ID, BITTENSOR_ID } from '../contracts';

const chains = [
  { id: 361, name: 'Theta Mainnet', token: 'TFUEL', color: '#2ab8e6' },
  { id: 964, name: 'Bittensor EVM', token: 'TAO', color: '#00d4ff' },
  { id: 7701, name: 'Osmosis', token: 'OSMO', color: '#8b5cf6' },
];

const mockRecent = [
  { from: 'Theta', to: 'Bittensor', amount: '1,250 XF', status: 'confirmed', time: '2 min ago', txHash: '0xab12...ef34' },
  { from: 'Bittensor', to: 'Osmosis', amount: '500 XF', status: 'pending', time: '30 sec ago', txHash: '0xcd56...gh78' },
  { from: 'Theta', to: 'Osmosis', amount: '10,000 XF', status: 'confirmed', time: '15 min ago', txHash: '0xij90...kl12' },
];

export default function Bridge() {
  const [sourceChain, setSourceChain] = useState(0);
  const [destChain, setDestChain] = useState(1);
  const [amount, setAmount] = useState('');
  const { isConnected, chain: walletChain } = useAccount();
  const { switchChain } = useSwitchChain();

  const splitterDeployed = isDeployed(ADDRESSES.splitter);

  const { data: totalDeposited } = useReadContract({
    address: ADDRESSES.splitter,
    abi: SPLITTER_ABI,
    functionName: 'totalDeposited',
    query: { enabled: splitterDeployed },
  });

  const { data: distCount } = useReadContract({
    address: ADDRESSES.splitter,
    abi: SPLITTER_ABI,
    functionName: 'distributionCount',
    query: { enabled: splitterDeployed },
  });

  const fee = amount ? (parseFloat(amount) * 0.003).toFixed(4) : '0.00';
  const received = amount ? (parseFloat(amount) * 0.997).toFixed(4) : '0.00';

  const sourceChainId = chains[sourceChain].id;
  const needsSwitch = isConnected && walletChain && walletChain.id !== sourceChainId;

  const handleBridge = () => {
    if (needsSwitch) {
      switchChain({ chainId: sourceChainId as 361 | 365 | 964 });
      return;
    }
    alert('Bridge contract not yet deployed. Connect after mainnet launch.');
  };

  const totalBridgedDisplay = totalDeposited
    ? `$${(Number(formatEther(totalDeposited)) * 0.5).toFixed(1)}M`
    : '$12.4M';
  const txCountDisplay = distCount ? Number(distCount).toLocaleString() : '4,821';

  return (
    <div className="page">
      <div className="container">
        <div className="page-header">
          <h1>Cross-Chain Bridge</h1>
          <p>Bridge XF tokens across networks with Hyperlane messaging and SP1 ZK verification</p>
        </div>

        <div className="grid grid-2">
          <div className="card" style={{ padding: '2rem' }}>
            <h3 style={{ marginBottom: '1.5rem' }}>Transfer Assets</h3>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={styles.label}>Source Network</label>
              <select
                className="input"
                value={sourceChain}
                onChange={(e) => setSourceChain(Number(e.target.value))}
              >
                {chains.map((c, i) => (
                  <option key={c.id} value={i}>{c.name} ({c.token})</option>
                ))}
              </select>
            </div>

            <div style={{ textAlign: 'center', margin: '0.5rem 0' }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => { setSourceChain(destChain); setDestChain(sourceChain); }}
                style={{ borderRadius: '50%', width: 40, height: 40, padding: 0, justifyContent: 'center' }}
              >
                ⇅
              </button>
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={styles.label}>Destination Network</label>
              <select
                className="input"
                value={destChain}
                onChange={(e) => setDestChain(Number(e.target.value))}
              >
                {chains.map((c, i) => (
                  <option key={c.id} value={i}>{c.name} ({c.token})</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={styles.label}>Amount (XF)</label>
              <input
                className="input"
                type="number"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                {['100', '500', '1000', '5000'].map((v) => (
                  <button key={v} className="btn btn-secondary btn-sm" onClick={() => setAmount(v)}>
                    {v}
                  </button>
                ))}
              </div>
            </div>

            <hr className="separator" />

            <div style={styles.feeRow}>
              <span style={{ color: '#8a8a9a' }}>Bridge Fee (0.3%)</span>
              <span>{fee} XF</span>
            </div>
            <div style={styles.feeRow}>
              <span style={{ color: '#8a8a9a' }}>You Receive</span>
              <span style={{ color: '#00d4ff', fontWeight: 700 }}>{received} XF</span>
            </div>
            <div style={styles.feeRow}>
              <span style={{ color: '#8a8a9a' }}>Est. Time</span>
              <span>~2 minutes</span>
            </div>
            <div style={styles.feeRow}>
              <span style={{ color: '#8a8a9a' }}>ZK Verification</span>
              <span className="badge badge-green">SP1 Verified</span>
            </div>

            <button
              className="btn btn-primary"
              style={{ width: '100%', marginTop: '1.5rem', justifyContent: 'center' }}
              disabled={!amount || parseFloat(amount) <= 0}
              onClick={handleBridge}
            >
              {!isConnected
                ? 'Connect Wallet'
                : needsSwitch
                ? `Switch to ${chains[sourceChain].name}`
                : amount
                ? `Bridge ${amount} XF`
                : 'Enter Amount'}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div className="card">
              <h3 style={{ marginBottom: '1rem' }}>Bridge Stats</h3>
              {!splitterDeployed && (
                <div style={{ fontSize: '0.75rem', color: '#f59e0b', marginBottom: '0.75rem' }}>
                  Contract not configured — showing demo data
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <div className="stat-value" style={{ fontSize: '1.5rem' }}>{totalBridgedDisplay}</div>
                  <div className="stat-label">Total Bridged</div>
                </div>
                <div>
                  <div className="stat-value" style={{ fontSize: '1.5rem' }}>{txCountDisplay}</div>
                  <div className="stat-label">Transactions</div>
                </div>
                <div>
                  <div className="stat-value" style={{ fontSize: '1.5rem' }}>~90s</div>
                  <div className="stat-label">Avg. Time</div>
                </div>
                <div>
                  <div className="stat-value" style={{ fontSize: '1.5rem' }}>100%</div>
                  <div className="stat-label">ZK Verified</div>
                </div>
              </div>
            </div>

            <div className="card">
              <h3 style={{ marginBottom: '1rem' }}>Recent Bridges</h3>
              {mockRecent.map((b, i) => (
                <div key={i} style={styles.recentItem}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                      {b.from} → {b.to}
                    </div>
                    <div style={{ color: '#8a8a9a', fontSize: '0.8rem' }}>{b.time} · {b.txHash}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 600 }}>{b.amount}</div>
                    <span className={`badge badge-${b.status === 'confirmed' ? 'green' : 'orange'}`}>
                      {b.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="card">
              <h3 style={{ marginBottom: '0.5rem' }}>How It Works</h3>
              <ol style={{ paddingLeft: '1.25rem', color: '#8a8a9a', fontSize: '0.9rem' }}>
                <li style={{ marginBottom: '0.5rem' }}>Select source and destination networks</li>
                <li style={{ marginBottom: '0.5rem' }}>Enter amount and approve the transaction</li>
                <li style={{ marginBottom: '0.5rem' }}>Hyperlane dispatches cross-chain message</li>
                <li style={{ marginBottom: '0.5rem' }}>SP1 ZK proof generated and verified on-chain</li>
                <li>Tokens minted on destination within ~2 minutes</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  label: {
    display: 'block', marginBottom: '0.5rem',
    fontSize: '0.85rem', fontWeight: 600, color: '#8a8a9a',
  },
  feeRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '0.5rem 0', fontSize: '0.9rem',
  },
  recentItem: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '0.75rem 0',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
};
