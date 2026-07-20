import { Link } from 'react-router-dom';
import type { CSSProperties } from 'react';
import { ADDRESSES, isDeployed } from '../contracts';

const BASESCAN = 'https://basescan.org';
const BUG_BOUNTY =
  'https://github.com/XFuel-Lab/xfuel-protocol/blob/main/docs/bug-bounty.md';
const AUDIT_CHECKLIST =
  'https://github.com/XFuel-Lab/xfuel-protocol/blob/main/docs/AUDIT_READINESS_CHECKLIST.md';
const POSITIONING =
  'https://github.com/XFuel-Lab/xfuel-protocol/blob/main/docs/POSITIONING.md';

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
  const verifier = ADDRESSES.verifier;
  const baseVerifier = '0x9373499645292715a2275A78eD65B14215C41c06';

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: 720, margin: '0 auto', padding: '0 1rem 3rem' }}>
        <div style={{ textAlign: 'center', padding: '2rem 0 1.5rem' }}>
          <span className="badge badge-cyan" style={{ marginBottom: '0.75rem', display: 'inline-block' }}>
            Trust &amp; operations
          </span>
          <h1 style={styles.h1}>Security &amp; transparency</h1>
          <p style={styles.lead}>
            Money and proofs settle on <strong>Base</strong>. Trust is tiered: signed receipts by default, on-chain SP1
            settlement proofs on demand. See our{' '}
            <a href={POSITIONING} target="_blank" rel="noreferrer" style={{ color: '#00d4ff' }}>
              positioning
            </a>{' '}
            for honest proof-scope language.
          </p>
        </div>

        <div className="card" style={{ padding: '1.5rem', marginBottom: '1.25rem' }}>
          <h2 style={styles.h2}>Audit status</h2>
          <p style={styles.p}>
            Audit Phase 1 covers the Base production core — <code style={{ fontSize: '0.85em' }}>ZKVerifierSP1</code>,{' '}
            <code style={{ fontSize: '0.85em' }}>SP1ProofHooks</code>, the USDC fee sink, and the primary inference circuit.
            Status updates will be posted when a firm is engaged and reports are published.
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
            . Rewards up to <strong>$50,000</strong> for critical findings.
          </p>
          <a href={BUG_BOUNTY} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm" style={{ marginTop: '0.5rem', display: 'inline-flex' }}>
            Bug bounty rules
          </a>
        </div>

        <div className="card" style={{ padding: '1.5rem', marginBottom: '1.25rem' }}>
          <h2 style={styles.h2}>Live contracts (Base)</h2>
          <p style={{ ...styles.p, marginBottom: '1rem' }}>
            Verify addresses on Basescan before relying on them. Env-configured addresses are baked in at build time from{' '}
            <code style={{ fontSize: '0.85em' }}>Vercel / .env.local</code>.
          </p>
          {row('ZKVerifierSP1 (mainnet)', baseVerifier, true)}
          <a href={`${BASESCAN}/address/${baseVerifier}`} target="_blank" rel="noreferrer" style={{ display: 'block', fontSize: '0.82rem', color: '#00d4ff', marginTop: '0.35rem', marginBottom: '0.75rem' }}>
            Basescan → ZKVerifierSP1
          </a>
          {row('ZKVerifierSP1 (env)', isDeployed(verifier) ? `${verifier.slice(0, 10)}…` : 'Not set (VITE_VERIFIER_ADDRESS)', true)}
          {row('Fee sink', 'X402_PAY_TO / protocol Safe · Splits v2 (USDC on Base)', false)}
          {row('Fundraising', 'Equity-first (SAFE). Token sales not open.', false)}
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
  lead: { color: '#8a8a9a', lineHeight: 1.65, fontSize: '1rem' },
  h2: { fontSize: '1.1rem', marginBottom: '0.75rem', color: '#f0f0f5' },
  p: { color: '#8a8a9a', lineHeight: 1.65, fontSize: '0.92rem', marginBottom: '0.75rem' },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '1rem',
    padding: '0.55rem 0',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    fontSize: '0.9rem',
  },
};
