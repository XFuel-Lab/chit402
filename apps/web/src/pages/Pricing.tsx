import { Link } from 'react-router-dom';
import type { CSSProperties } from 'react';
import SeoHead from '../components/SeoHead';
import { getApiV1 } from '../apiHost';

const PRICING_SEO = {
  title: 'Pricing — standard receipt $0.002 USDC | Chit402',
  description:
    'Cost-plus, quoted, receipted on POST /v1/chat/completions. Standard signed receipt $0.002 USDC every hop; provider routing is cost + 1%. USDC on Base and Solana.',
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
            Chit is the book — not a router shop. The standard receipt and provider routing are priced
            separately from hub COGS — quoted, receipted — USDC on Base and Solana.
          </p>
        </header>

        <section style={styles.clarityBar} aria-labelledby="standard-receipt-heading">
          <p style={styles.clarityLabel}>Standard receipt (every hop)</p>
          <h2 id="standard-receipt-heading" style={styles.clarityAmount}>
            $0.002 USDC
          </h2>
          <p style={styles.clarityBody}>
            One flat stamp for the treasury desk: HTTP 402 quote, USDC settle on Base or Solana, and a
            signed receipt with <code>verify_url</code> you can verify offline. Bigger jobs do not
            make the receipt harder or more expensive — the standard receipt stays $0.002 unless our
            unit cost changes.
          </p>
          <p style={styles.clarityBody}>
            Provider inference is billed at{' '}
            <strong style={{ color: '#f0f0f5', fontWeight: 600 }}>cost + 1%</strong>
            {' '}(platform fee 100 bps on provider COGS). Hub, model, and upstream USDC are
            pass-through plus that routing fee. Network fees on your chain are yours. Without
            payment or a partner key, <code>POST {apiV1}/chat/completions</code> returns HTTP 402.
          </p>
          <p style={styles.clarityBody}>
            Possession-gated book ingest uses a volume stamp of about{' '}
            <strong style={{ color: '#f0f0f5', fontWeight: 600 }}>$0.0001–0.0002</strong> debited
            from prepaid budget (not an on-chain exact settle).
          </p>
          <p style={styles.clarityBody}>
            <strong style={{ color: '#f0f0f5', fontWeight: 600 }}>Private Desk</strong> — vendor-blind
            routing at the same <strong style={{ color: '#f0f0f5', fontWeight: 600 }}>cost + 1%</strong>{' '}
            door; Tier-1 signed receipt with <code>privacy.mode=vendor_blind</code>. Gateway-trusted spend
            privacy — not prompt-private, not trustless ZK. Request with{' '}
            <code>xfuel.privacy_product: private_desk</code> (or enable Private Spend on your gateway
            allowlist).
          </p>
          <p style={styles.clarityBody}>
            <strong style={{ color: '#f0f0f5', fontWeight: 600 }}>Private + Attest</strong> — Desk plus
            mandatory Tier-2 SP1 at <strong style={{ color: '#f0f0f5', fontWeight: 600 }}>+$0.10</strong>{' '}
            (<code>tier2_proof</code> itemized on the receipt). Request with{' '}
            <code>xfuel.privacy_product: private_attest</code>. Proving may be allowlist-gated in
            production — the API fails closed if Tier-2 is unavailable.
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
              <li>Provider / hub inference price (pass-through COGS + 1% routing)</li>
              <li>Your wallet and chain network costs</li>
              <li>Partner key billing (if you use one instead of x402)</li>
            </ul>
          </div>
          <div className="card">
            <h3 style={styles.cardTitle}>How quoting works</h3>
            <ul style={styles.list}>
              <li>
                First request without payment → HTTP 402 with atomic USDC amount (standard receipt{' '}
                <code>2000</code> = $0.002, plus provider COGS + 1% when applicable)
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

        <section className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.65rem' }}>Value-add (optional)</h2>
          <ul style={styles.list}>
            <li>
              <strong style={{ color: '#d0d0dc' }}>Tier-2 SP1 proof</strong> — $0.10 per proof (on
              demand; required for Private + Attest)
            </li>
            <li>
              <strong style={{ color: '#d0d0dc' }}>Private Desk</strong> — cost + 1% vendor-blind routing
              (allowlist / explicit product; not the default public door)
            </li>
            <li>
              <strong style={{ color: '#d0d0dc' }}>Private + Attest</strong> — Desk + $0.10 Tier-2
              (fail closed if proving unavailable)
            </li>
            <li>
              <strong style={{ color: '#d0d0dc' }}>Spend guarantee</strong> — parked; not available
              to buy yet
            </li>
          </ul>
          <p style={{ ...styles.muted, marginTop: '0.85rem' }}>
            Volume and premier stamp houses win because the receipt is flat and boring — high
            throughput does not inflate the per-hop stamp.
          </p>
        </section>

        <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.65rem' }}>How you enter</h2>
          <p style={styles.muted}>
            The product is the possession book — who paid which call, holdable after settle. Pay the
            quoted USDC (HTTP 402 on Base or Solana, or a partner <code>X-API-Key</code>), hold the
            signed receipt with <code>verify_url</code>. After you register,{' '}
            <Link to="/book" style={styles.link}>
              /book
            </Link>{' '}
            keeps last-N spend. Install wires (chat clients, Eliza, ACP, MCP, peers):{' '}
            <Link to="/docs/doors" style={styles.link}>
              /docs/doors
            </Link>
            .
          </p>
        </div>

        <div style={styles.ctaRow}>
          <Link to="/docs/doors" className="btn btn-primary">
            Install doors
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
