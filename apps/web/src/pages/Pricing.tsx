import { Link } from 'react-router-dom';
import type { CSSProperties } from 'react';
import SeoHead from '../components/SeoHead';
import { getApiV1 } from '../apiHost';

const PRICING_SEO = {
  title: 'Pricing — from $0.002 USDC per hop | Chit402',
  description:
    'Cost-plus 1% on provider COGS, quoted, receipted on POST /v1/chat/completions. Hop floor $0.002 USDC; volume stamp ~$0.0001. USDC on Base and Solana.',
};

export default function Pricing() {
  const apiV1 = getApiV1();

  return (
    <div className="page docs-page">
      <SeoHead title={PRICING_SEO.title} description={PRICING_SEO.description} />
      <div className="container" style={{ maxWidth: 720 }}>
        <header className="page-header">
          <span className="docs-kicker">Pricing</span>
          <h1>Pay for a collected hop.</h1>
          <p>
            Chit is the book — not a router shop. Every call is cost-plus on provider COGS, quoted,
            receipted — USDC on Base and Solana.
          </p>
        </header>

        <section style={styles.clarityBar} aria-labelledby="hop-floor-heading">
          <p style={styles.clarityLabel}>Per hop (Chit desk fee)</p>
          <h2 id="hop-floor-heading" style={styles.clarityAmount}>
            From $0.002 USDC per hop
          </h2>
          <p style={styles.clarityBody}>
            One hop covers the treasury desk: HTTP 402 quote, USDC settle on Base or Solana, and a
            signed receipt with <code>verify_url</code> you can verify offline. Provider COGS is
            billed at{' '}
            <strong style={{ color: '#f0f0f5', fontWeight: 600 }}>cost-plus 100 bps (1%)</strong>
            {' '}— approximately <code>max(provider × 1.01, hop floor)</code>. The floor covers
            facilitator settle; the 1% is the door on measured hub cost. Receipts are included.
          </p>
          <p style={styles.clarityBody}>
            Possession-gated book ingest uses a volume stamp of about{' '}
            <strong style={{ color: '#f0f0f5', fontWeight: 600 }}>$0.0001–0.0002</strong> debited
            from prepaid budget (not an on-chain exact settle). Optional Tier-2 SP1 settlement proof:{' '}
            <strong style={{ color: '#f0f0f5', fontWeight: 600 }}>+$0.10</strong> flat, opt-in.
          </p>
          <p style={styles.clarityBody}>
            Hub, model, and upstream inference USDC are separate from this floor. Network fees on
            your chain are yours. Without payment or a partner key,{' '}
            <code>POST {apiV1}/chat/completions</code> returns HTTP 402.
          </p>
        </section>

        <div className="grid grid-3" style={{ gap: '1.25rem', marginBottom: '2rem' }}>
          <div className="card">
            <h3 style={styles.cardTitle}>Included on the hop</h3>
            <ul style={styles.list}>
              <li>Signed receipt naming hub, model, and amount</li>
              <li>
                Public <code>verify_url</code> — stranger-verifiable without a second fee
              </li>
              <li>USDC on Base and Solana (chain-neutral x402)</li>
              <li>Quoted settle before the call completes</li>
            </ul>
          </div>
          <div className="card">
            <h3 style={styles.cardTitle}>Separate from Chit</h3>
            <ul style={styles.list}>
              <li>Provider / hub inference price (pass-through COGS)</li>
              <li>Your wallet and chain network costs</li>
              <li>Partner key billing (if you use one instead of x402)</li>
            </ul>
          </div>
          <div className="card">
            <h3 style={styles.cardTitle}>How quoting works</h3>
            <ul style={styles.list}>
              <li>
                First request without payment → HTTP 402 with atomic USDC amount (floor{' '}
                <code>2000</code> = $0.002)
              </li>
              <li>Retry with <code>X-PAYMENT</code> after USDC settle, or send a partner API key</li>
              <li>
                Live discovery:{' '}
                <a href={`${apiV1.replace(/\/v1$/, '')}/.well-known/x402`} style={styles.link}>
                  /.well-known/x402
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.65rem' }}>Public door</h2>
          <p style={styles.muted}>
            OpenAI-compatible{' '}
            <code>POST {apiV1}/chat/completions</code> is the product surface. Point your client at{' '}
            <code>{apiV1}</code>, pay the quoted USDC, hold the row. The possession book (
            <Link to="/book" style={styles.link}>
              /book
            </Link>
            ) keeps last-N spend after you register.
          </p>
        </div>

        <div style={styles.ctaRow}>
          <Link to="/docs/chit-in-15-lines" className="btn btn-primary">
            Drop-in docs
          </Link>
          <Link to="/book" className="btn btn-secondary">
            Open the book
          </Link>
        </div>

        <p style={styles.footnote}>
          Legacy measured-task wire (<code>/task-request</code>) uses the same cost-plus fee basis on
          a different path — prefer <code>{apiV1}</code> for new installs.
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  clarityBar: {
    borderTop: '1px solid rgba(255,255,255,0.08)',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    padding: '1.75rem 0',
    marginBottom: '2rem',
  },
  clarityLabel: {
    fontSize: '0.72rem',
    fontWeight: 600,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: '#8a8a9a',
    marginBottom: '0.65rem',
  },
  clarityAmount: {
    fontSize: 'clamp(1.75rem, 4vw, 2.35rem)',
    fontWeight: 800,
    lineHeight: 1.15,
    marginBottom: '1rem',
    color: '#f0f0f5',
  },
  clarityBody: {
    color: '#8a8a9a',
    fontSize: '0.98rem',
    lineHeight: 1.7,
    marginBottom: '0.85rem',
  },
  cardTitle: {
    fontSize: '1rem',
    marginBottom: '0.65rem',
  },
  list: {
    color: '#8a8a9a',
    paddingLeft: '1.15rem',
    lineHeight: 1.65,
    fontSize: '0.92rem',
    margin: 0,
  },
  muted: {
    color: '#8a8a9a',
    fontSize: '0.95rem',
    lineHeight: 1.65,
    margin: 0,
  },
  link: {
    color: '#00d4ff',
    textDecoration: 'none',
  },
  ctaRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.75rem',
    marginBottom: '2rem',
  },
  footnote: {
    color: '#55556a',
    fontSize: '0.82rem',
    lineHeight: 1.6,
    borderTop: '1px solid rgba(255,255,255,0.06)',
    paddingTop: '1.25rem',
  },
};
