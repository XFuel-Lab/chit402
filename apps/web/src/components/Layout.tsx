import { useState } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { getHostConfig, isChitHost } from '../hostConfig';
import SeoHead from './SeoHead';

const xfuelNavLinks = [
  { to: '/', label: 'Home' },
  { to: '/docs', label: 'Docs' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/security', label: 'Security' },
];

const chitNavLinks = [
  { to: '/', label: 'Home' },
  { to: '/docs/chit-in-15-lines', label: '15 lines' },
];

export default function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const config = getHostConfig();
  const isChit = isChitHost();
  const navLinks = isChit ? chitNavLinks : xfuelNavLinks;

  return (
    <>
      <SeoHead />
      <header style={styles.header}>
        <div className="container" style={styles.headerInner}>
          <NavLink to="/" style={styles.logo}>
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="14" stroke="url(#g)" strokeWidth="2.5" />
              <path d="M10 16l4 4 8-8" stroke="#00d4ff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              <defs><linearGradient id="g" x1="0" y1="0" x2="32" y2="32"><stop stopColor="#00d4ff"/><stop offset="1" stopColor="#8b5cf6"/></linearGradient></defs>
            </svg>
            <span>{config.name}</span>
          </NavLink>

          <nav style={{ ...styles.nav, ...(menuOpen ? styles.navOpen : {}) }}>
            {navLinks.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                onClick={() => setMenuOpen(false)}
                style={({ isActive }) => ({
                  ...styles.navLink,
                  color: isActive ? '#00d4ff' : '#8a8a9a',
                })}
              >
                {label}
              </NavLink>
            ))}
          </nav>

          <button
            className="header-burger"
            style={styles.hamburger}
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Toggle menu"
          >
            <span style={{ ...styles.hamburgerLine, ...(menuOpen ? { transform: 'rotate(45deg) translate(4px, 4px)' } : {}) }} />
            <span style={{ ...styles.hamburgerLine, ...(menuOpen ? { opacity: 0 } : {}) }} />
            <span style={{ ...styles.hamburgerLine, ...(menuOpen ? { transform: 'rotate(-45deg) translate(4px, -4px)' } : {}) }} />
          </button>
        </div>
      </header>

      {isChit ? (
        <div
          style={{
            textAlign: 'center',
            fontSize: '0.8rem',
            color: '#a5d6f7',
            padding: '0.5rem 1rem',
            background: 'rgba(0,150,200,0.08)',
            borderBottom: '1px solid rgba(0,200,255,0.15)',
          }}
        >
          Chit is the product. {config.parent} is the parent.
          {' '}The wire is <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78em' }}>api.chit402.com/v1</code>.
        </div>
      ) : (
        <div
          style={{
            textAlign: 'center',
            fontSize: '0.8rem',
            color: '#fde68a',
            padding: '0.5rem 1rem',
            background: 'rgba(245,158,11,0.1)',
            borderBottom: '1px solid rgba(245,158,11,0.25)',
          }}
        >
          XFuel is the book. This agent spent Y on this job. You hold hub, model, and amount.
          {' '}The API is <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78em' }}>api.xfuel.app</code>.
          {' '}<code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78em' }}>POST /v1/chat/completions</code>
          {' '}is <strong>cost-plus, quoted, receipted</strong> — USDC on Base and Solana.
          {' '}Paying this host moves real mainnet USDC. Demo key{' '}
          <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78em' }}>xfuel-demo</code> skips payment.
          {' '}Do not send funds unless you mean to.
        </div>
      )}

      <main style={{ flex: 1 }}>
        <Outlet />
      </main>

      <footer style={styles.footer}>
        <div className="container" style={styles.footerInner}>
          <div style={styles.footerBrand}>
            <strong style={{ color: '#f0f0f5' }}>{config.name}</strong>
            <span style={{ color: '#55556a', fontSize: '0.85rem' }}>
              {isChit ? 'A receipt you still hold. By XFuel Lab.' : 'The book: hub, model, amount. Apache-2.0.'}
            </span>
          </div>
          <div style={styles.footerLinks}>
            <a href={config.githubUrl} target="_blank" rel="noreferrer">GitHub</a>
            <a href={`https://twitter.com/${config.twitterHandle.replace('@', '')}`} target="_blank" rel="noreferrer">Twitter</a>
            {!isChit && (
              <>
                <NavLink to="/docs">Docs</NavLink>
                <NavLink to="/security">Security</NavLink>
              </>
            )}
            <a href="mailto:security@xfuel.app">security@xfuel.app</a>
          </div>
        </div>
      </footer>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: {
    position: 'sticky', top: 0, zIndex: 100,
    background: 'rgba(10, 10, 15, 0.85)',
    backdropFilter: 'blur(16px)',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  headerInner: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    height: '64px',
  },
  logo: {
    display: 'flex', alignItems: 'center', gap: '0.5rem',
    fontSize: '1.25rem', fontWeight: 800, color: '#f0f0f5',
    textDecoration: 'none',
  },
  nav: {
    display: 'flex', alignItems: 'center', gap: '0.25rem',
  },
  navOpen: {
    display: 'flex',
    position: 'fixed' as const, top: '64px', left: 0, right: 0, bottom: 0,
    flexDirection: 'column' as const,
    background: 'rgba(10, 10, 15, 0.98)',
    padding: '1.5rem',
    gap: '0.5rem',
    zIndex: 99,
  },
  navLink: {
    padding: '0.5rem 0.75rem',
    fontSize: '0.85rem', fontWeight: 500,
    borderRadius: '6px',
    transition: 'all 0.2s',
    textDecoration: 'none',
  },
  hamburger: {
    display: 'none',
    flexDirection: 'column' as const, gap: '4px',
    background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
  },
  hamburgerLine: {
    display: 'block', width: '20px', height: '2px',
    background: '#8a8a9a', borderRadius: '2px',
    transition: 'all 0.2s',
  },
  footer: {
    borderTop: '1px solid rgba(255,255,255,0.06)',
    padding: '2rem 0',
    marginTop: '4rem',
  },
  footerInner: {
    display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: '1rem',
    textAlign: 'center' as const,
  },
  footerBrand: {
    display: 'flex', flexDirection: 'column' as const, gap: '0.25rem',
  },
  footerLinks: {
    display: 'flex', gap: '1.5rem', fontSize: '0.9rem', flexWrap: 'wrap' as const, justifyContent: 'center',
  },
};
