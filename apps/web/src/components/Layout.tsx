import { useState } from 'react';
import { Link, Outlet, NavLink } from 'react-router-dom';
import WalletButton from './WalletButton';

const navLinks = [
  { to: '/', label: 'Home' },
  { to: '/bridge', label: 'Bridge' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/governance', label: 'Governance' },
  { to: '/circuits', label: 'Circuits' },
  { to: '/theta-ai', label: 'Theta AI' },
  { to: '/monitoring', label: 'Monitoring' },
  { to: '/staking', label: 'Staking' },
  { to: '/treasury', label: 'Treasury' },
  { to: '/docs', label: 'Docs' },
  { to: '/security', label: 'Security' },
  { to: '/community', label: 'Community' },
  { to: '/grants', label: 'Grants' },
];

export default function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <header style={styles.header}>
        <div className="container" style={styles.headerInner}>
          <NavLink to="/" style={styles.logo}>
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="14" stroke="url(#g)" strokeWidth="2.5" />
              <path d="M10 16l4 4 8-8" stroke="#00d4ff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              <defs><linearGradient id="g" x1="0" y1="0" x2="32" y2="32"><stop stopColor="#00d4ff"/><stop offset="1" stopColor="#8b5cf6"/></linearGradient></defs>
            </svg>
            <span>XFuel</span>
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

          <div style={styles.headerRight}>
            <WalletButton />
            <button
              style={styles.hamburger}
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="Toggle menu"
            >
              <span style={{ ...styles.hamburgerLine, ...(menuOpen ? { transform: 'rotate(45deg) translate(4px, 4px)' } : {}) }} />
              <span style={{ ...styles.hamburgerLine, ...(menuOpen ? { opacity: 0 } : {}) }} />
              <span style={{ ...styles.hamburgerLine, ...(menuOpen ? { transform: 'rotate(-45deg) translate(4px, -4px)' } : {}) }} />
            </button>
          </div>
        </div>
      </header>

      <div
        style={{
          textAlign: 'center',
          fontSize: '0.78rem',
          color: '#a78bfa',
          padding: '0.45rem 1rem',
          background: 'rgba(139,92,246,0.08)',
          borderBottom: '1px solid rgba(139,92,246,0.15)',
        }}
      >
        <strong style={{ color: '#a5f3fc' }}>Beta protocol</strong> — integration and metrics pages may use testnet or staging backends. Funding rounds are not currently open.
      </div>

      <main style={{ flex: 1 }}>
        <Outlet />
      </main>

      <footer style={styles.footer}>
        <div className="container" style={styles.footerInner}>
          <div style={styles.footerBrand}>
            <strong style={{ color: '#f0f0f5' }}>XFuel Protocol</strong>
            <span style={{ color: '#55556a', fontSize: '0.85rem' }}>AI + ZK settlement (beta)</span>
          </div>
          <div style={styles.footerLinks}>
            <a href="https://github.com/XFuel-Lab/xfuel-protocol" target="_blank" rel="noreferrer">GitHub</a>
            <a href="https://twitter.com/XFuelLab" target="_blank" rel="noreferrer">Twitter</a>
            <a href="https://discord.com/invite/He5j6NeQ6R" target="_blank" rel="noreferrer">Discord</a>
            <Link to="/docs">Docs</Link>
            <Link to="/security">Security</Link>
          </div>
          <div style={{ color: '#55556a', fontSize: '0.8rem' }}>
            &copy; {new Date().getFullYear()} XFuel Protocol. All rights reserved.
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
  headerRight: {
    display: 'flex', alignItems: 'center', gap: '0.75rem',
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
    display: 'flex', gap: '1.5rem', fontSize: '0.9rem',
  },
};
