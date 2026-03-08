import { useState, useRef, useEffect } from 'react';
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';

const WALLET_ICONS: Record<string, string> = {
  MetaMask: '\u{1F98A}',
  'Coinbase Wallet': '\u{1F7E6}',
  WalletConnect: '\u{1F517}',
  Injected: '\u{1F50C}',
};

function getWalletIcon(name: string) {
  return WALLET_ICONS[name] || '\u{1F4B3}';
}

// Prefer MetaMask first, then by name alphabetically, push generic "Injected" to the end
function sortConnectors(connectors: readonly any[]) {
  return [...connectors].sort((a, b) => {
    if (a.name === 'MetaMask') return -1;
    if (b.name === 'MetaMask') return 1;
    if (a.name === 'Injected') return 1;
    if (b.name === 'Injected') return -1;
    return a.name.localeCompare(b.name);
  });
}

export default function WalletButton() {
  const { address, isConnected, chain } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, chains } = useSwitchChain();
  const [showPicker, setShowPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const isWrongNetwork = isConnected && chain && !chains.some(c => c.id === chain.id);

  // Close picker on outside click
  useEffect(() => {
    if (!showPicker) return;
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showPicker]);

  if (isConnected && isWrongNetwork) {
    return (
      <div className="wallet-connected" style={{ gap: '0.5rem' }}>
        <span style={{ color: '#f59e0b', fontSize: '0.8rem', fontWeight: 600 }}>Wrong Network</span>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => switchChain({ chainId: chains[0]?.id ?? 361 })}
          style={{ fontSize: '0.75rem' }}
        >
          Switch to {chains[0]?.name ?? 'Theta'}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => disconnect()} style={{ fontSize: '0.75rem' }}>
          Disconnect
        </button>
      </div>
    );
  }

  if (isConnected && address) {
    return (
      <div className="wallet-connected">
        <span className="wallet-address" title={`${chain?.name || 'Unknown'} — ${address}`}>
          {address.slice(0, 6)}...{address.slice(-4)}
        </span>
        <button className="btn btn-secondary btn-sm" onClick={() => disconnect()}>
          Disconnect
        </button>
      </div>
    );
  }

  const sorted = sortConnectors(connectors);

  // Only one wallet detected — connect directly
  if (sorted.length === 1) {
    return (
      <button
        className="btn btn-primary btn-sm"
        onClick={() => connect({ connector: sorted[0] })}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="2" y="6" width="20" height="14" rx="2" />
          <path d="M16 14h.01" />
          <path d="M2 10h20" />
        </svg>
        Connect {sorted[0].name}
      </button>
    );
  }

  return (
    <div ref={pickerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        className="btn btn-primary btn-sm"
        onClick={() => setShowPicker(prev => !prev)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="2" y="6" width="20" height="14" rx="2" />
          <path d="M16 14h.01" />
          <path d="M2 10h20" />
        </svg>
        Connect Wallet
      </button>

      {showPicker && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          right: 0,
          background: '#1a1a2e',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '10px',
          padding: '6px',
          minWidth: '200px',
          zIndex: 1000,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}>
          {sorted.map((connector) => (
            <button
              key={connector.uid}
              onClick={() => {
                connect({ connector });
                setShowPicker(false);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                width: '100%',
                padding: '10px 14px',
                background: 'transparent',
                border: 'none',
                borderRadius: '8px',
                color: '#e0e0f0',
                fontSize: '0.9rem',
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ fontSize: '1.2rem' }}>{getWalletIcon(connector.name)}</span>
              <span>{connector.name}</span>
              {connector.name === 'MetaMask' && (
                <span style={{
                  marginLeft: 'auto',
                  fontSize: '0.7rem',
                  color: '#00d4aa',
                  background: 'rgba(0,212,170,0.12)',
                  padding: '2px 7px',
                  borderRadius: '4px',
                }}>
                  recommended
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
