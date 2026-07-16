import { Link } from 'react-router-dom';
import type { CSSProperties } from 'react';
import { ADDRESSES, THETA_MAINNET_ID, isDeployed } from '../contracts';

const EXPLORER = 'https://explorer.thetatoken.org';
const BUG_BOUNTY =
  'https://github.com/XFuel-Lab/xfuel-protocol/blob/main/docs/bug-bounty.md';
const AUDIT_CHECKLIST =
  'https://github.com/XFuel-Lab/xfuel-protocol/blob/main/docs/AUDIT_READINESS_CHECKLIST.md';

function row(label: string, value: string, mono = false) {
  return (
    <div style={styles.row}>
      <span style={{ color: '#8a8a9a' }}>{label}</span>
      <span style={{ fontFamily: mono ? 'var(--font-mono, monospace)' : 'inherit', fontSize: mono ? '0.78rem' : '0.9rem', textAlign: 'right', wordBreak: 'break-all' }}>
        {value}
      </span>
    </div>
  );
}

export default function Security() {
  const b = ADDRESSES.believerRound;
  const a = ADDRESSES.angelRound;
  const e = ADDRESSES.angelEscrow;
  const splitter = ADDRESSES.splitter;
  const verifier = ADDRESSES.verifier;

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: 720, margin: '0 auto', padding: '0 1rem 3rem' }}>
        <div style={{ textAlign: 'center', padding: '2rem 0 1.5rem' }}>
          <span className="badge badge-cyan" style={{ marginBottom: '0.75rem', display: 'inline-block' }}>
            Trust &amp; operations
          </span>
          <h1 style={styles.h1}>Security &amp; transparency</h1>
          <p style={styles.lead}>
            How we handle audits, disclosure, and on-chain funding. Believer and Angel rounds commit on{' '}
            <strong>Theta mainnet (chain {THETA_MAINNET_ID})</strong>.
          </p>
        </div>

        <div className="card" style={{ padding: '1.5rem', marginBottom: '1.25rem' }}>
          <h2 style={styles.h2}>Audit status</h2>
          <p style={styles.p}>
            Phase 1 scope covers core settlement, verifier, and funding contracts (see whitepaper audit section). We track readiness in the repo checklist
            below; status updates will be posted on{' '}
            <a href="https://twitter.com/XFuelLab" target="_blank" rel="noreferrer" style={{ color: '#00d4ff' }}>
              @XFuelLab
            </a>{' '}
            and Discord when a firm is engaged and reports are published.
          </p>
          <a href={AUDIT_CHECKLIST} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm" style={{ marginTop: '0.5rem', display: 'inline-flex' }}>
            Audit readiness checklist (GitHub)
          </a>
        </div>

        <div className="card" style={{ padding: '1.5rem', marginBottom: '1.25rem' }}>
          <h2 style={styles.h2}>Bug bounty &amp; disclosure</h2>
          <p style={styles.p}>
            Responsible disclosure: <a href="mailto:security@xfuel.app" style={{ color: '#00d4ff' }}>security@xfuel.app</a> or a{' '}
            <a href="https://github.com/XFuel-Lab/xfuel-protocol/security" target="_blank" rel="noreferrer" style={{ color: '#00d4ff' }}>
              GitHub Security Advisory
            </a>
            .
          </p>
          <a href={BUG_BOUNTY} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm" style={{ marginTop: '0.5rem', display: 'inline-flex' }}>
            Bug bounty rules
          </a>
        </div>

        <div className="card" style={{ padding: '1.5rem', marginBottom: '1.25rem' }}>
          <h2 style={styles.h2}>AngelEscrow buckets</h2>
          <p style={styles.p}>
            <strong>AngelEscrow</strong> is an optional, immutable TFUEL contract that ring-fences deposits into three fixed buckets —{' '}
            <strong>AUDIT</strong>, <strong>SUBCHAIN</strong>, and <strong>DEVOPS</strong>. Multisig signers approve releases against caps;{' '}
            <code style={{ fontSize: '0.85em' }}>totalRaised</code> and per-bucket releases are on-chain. It is separate from{' '}
            <strong>AngelRound</strong> (strategic allocation); when both are used, angels should follow the path your terms describe.
          </p>
          <p style={{ ...styles.p, marginBottom: 0 }}>
            Per-bucket <code style={{ fontSize: '0.85em' }}>totalRaised</code> and releases are readable on-chain when{' '}
            <code style={{ fontSize: '0.85em' }}>VITE_ANGEL_ESCROW_ADDRESS</code> is set.
          </p>
        </div>

        <div className="card" style={{ padding: '1.5rem', marginBottom: '1.25rem' }}>
          <h2 style={styles.h2}>Contract map (env-configured)</h2>
          <p style={{ ...styles.p, marginBottom: '1rem' }}>
            Addresses are baked in at build time from Vercel / <code style={{ fontSize: '0.85em' }}>.env.local</code>. Verify the live address on Theta
            explorer before committing funds.
          </p>
          {row('BelieverRound', isDeployed(b) ? `${b.slice(0, 10)}…` : 'Not set (VITE_BELIEVER_ROUND_ADDRESS)', true)}
          {isDeployed(b) && (
            <a href={`${EXPLORER}/address/${b}`} target="_blank" rel="noreferrer" style={{ display: 'block', fontSize: '0.82rem', color: '#00d4ff', marginTop: '0.35rem', marginBottom: '0.5rem' }}>
              Explorer → BelieverRound
            </a>
          )}
          {row('AngelRound', isDeployed(a) ? `${a.slice(0, 10)}…` : 'Not set (VITE_ANGEL_ROUND_ADDRESS)', true)}
          {isDeployed(a) && (
            <a href={`${EXPLORER}/address/${a}`} target="_blank" rel="noreferrer" style={{ display: 'block', fontSize: '0.82rem', color: '#00d4ff', marginTop: '0.35rem', marginBottom: '0.5rem' }}>
              Explorer → AngelRound
            </a>
          )}
          {row('AngelEscrow', isDeployed(e) ? `${e.slice(0, 10)}…` : 'Not set (VITE_ANGEL_ESCROW_ADDRESS)', true)}
          {isDeployed(e) && (
            <a href={`${EXPLORER}/address/${e}`} target="_blank" rel="noreferrer" style={{ display: 'block', fontSize: '0.82rem', color: '#00d4ff', marginTop: '0.35rem', marginBottom: '0.5rem' }}>
              Explorer → AngelEscrow
            </a>
          )}
          {row('CoreRevenueSplitter', isDeployed(splitter) ? `${splitter.slice(0, 10)}…` : 'Not set (VITE_SPLITTER_ADDRESS)', true)}
          {row('ZKVerifierSP1', isDeployed(verifier) ? `${verifier.slice(0, 10)}…` : 'Not set (VITE_VERIFIER_ADDRESS)', true)}
        </div>

        <div style={{ textAlign: 'center', fontSize: '0.85rem', color: '#8a8a9a' }}>
          <Link to="/community" style={{ color: '#00d4ff' }}>Community</Link>
          {' · '}
          <Link to="/docs" style={{ color: '#00d4ff' }}>Docs</Link>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  h1: {
    fontSize: 'clamp(1.75rem, 4vw, 2.35rem)',
    fontWeight: 800,
    background: 'linear-gradient(135deg, #00d4ff 0%, #8b5cf6 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
    marginBottom: '0.75rem',
  },
  h2: { fontSize: '1rem', fontWeight: 700, color: '#e4e4ef', marginBottom: '0.65rem' },
  lead: { color: '#8a8a9a', fontSize: '1.02rem', lineHeight: 1.65, maxWidth: 560, margin: '0 auto' },
  p: { color: '#a1a1b5', fontSize: '0.9rem', lineHeight: 1.65, marginBottom: '0.75rem' },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '1rem',
    padding: '0.55rem 0',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    fontSize: '0.88rem',
  },
};
