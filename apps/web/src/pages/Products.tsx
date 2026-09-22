import { Link } from 'react-router-dom';
import type { CSSProperties } from 'react';
import SeoHead from '../components/SeoHead';
import { getApiV1 } from '../apiHost';

const PRODUCTS_SEO = {
  title: 'Products — Stamp, Private Desk, Attest | Chit402',
  description:
    'Book-first seats on the possession ledger: Stamp ($0.002 receipt), Private Desk (vendor-blind cost + 1%), Private + Attest (Desk + $0.10 Tier-2 SP1). Not a router — who paid which call.',
};

type ProductSeat = {
  name: string;
  price: string;
  forWho: string;
  youHold: string;
  detail: string;
  primaryTo: string;
  primaryLabel: string;
  secondaryTo?: string;
  secondaryLabel?: string;
};

const seats: ProductSeat[] = [
  {
    name: 'Stamp',
    price: '$0.002 USDC every hop',
    forWho: 'Any agent team that needs a flat treasury stamp on every collected call.',
    youHold: 'Signed receipt with hub, model, amount, and public verify_url — plus a book row after you register.',
    detail:
      'HTTP 402 quote, USDC settle on Base or Solana, one boring flat stamp. Bigger jobs do not inflate the receipt.',
    primaryTo: '/pricing',
    primaryLabel: 'Pricing',
    secondaryTo: '/doors',
    secondaryLabel: 'Install doors',
  },
  {
    name: 'Private Desk',
    price: 'Provider routing cost + 1% (100 bps)',
    forWho: 'Principals who need vendor-blind paid inference — topology privacy, not prompt encryption.',
    youHold:
      'Tier-1 signed receipt with privacy.mode=vendor_blind and the same verify_url / book possession path.',
    detail:
      'Request with xfuel.privacy_product: private_desk (or allowlisted Private Spend). Gateway-trusted spend privacy.',
    primaryTo: '/docs/private-spend',
    primaryLabel: 'Private Spend docs',
    secondaryTo: '/register',
    secondaryLabel: 'Register for book',
  },
  {
    name: 'Private + Attest',
    price: 'Desk routing + 1% + $0.10 Tier-2',
    forWho: 'Teams that need Desk plus mandatory SP1 settlement proof — fail closed if proving is unavailable.',
    youHold:
      'Desk receipt plus itemized tier2_proof on the receipt; verify offline or pin issuer JWKS.',
    detail:
      'Request with xfuel.privacy_product: private_attest. Tier-2 SP1 is required, not optional.',
    primaryTo: '/docs/private-spend',
    primaryLabel: 'Private Spend docs',
    secondaryTo: '/trust',
    secondaryLabel: 'Issuer trust',
  },
];

export default function Products() {
  const apiV1 = getApiV1();

  return (
    <div className="page docs-page">
      <SeoHead title={PRODUCTS_SEO.title} description={PRODUCTS_SEO.description} />
      <div className="container" style={{ maxWidth: 900 }}>
        <header className="page-header">
          <span className="docs-kicker">Products</span>
          <h1>Three seats on the possession book.</h1>
          <p>
            Chit is the stamp and ledger — who paid which call — not a smart router and not a model
            shop. Pick the seat that matches how much privacy and proof you need after USDC settle.
            Every path is cost-plus, quoted, receipted at{' '}
            <code>{apiV1}/chat/completions</code>.
          </p>
        </header>

        <div className="grid grid-3" style={{ gap: '1.25rem', marginBottom: '2rem' }}>
          {seats.map((seat) => (
            <article key={seat.name} className="card" style={styles.seatCard}>
              <h2 style={styles.seatName}>{seat.name}</h2>
              <p style={styles.seatPrice}>{seat.price}</p>
              <p style={styles.seatFor}>
                <strong style={styles.seatLabel}>For</strong> {seat.forWho}
              </p>
              <p style={styles.seatHold}>
                <strong style={styles.seatLabel}>You hold</strong> {seat.youHold}
              </p>
              <p style={styles.seatDetail}>{seat.detail}</p>
              <div style={styles.seatActions}>
                <Link to={seat.primaryTo} className="btn btn-primary btn-sm">
                  {seat.primaryLabel}
                </Link>
                {seat.secondaryTo && seat.secondaryLabel ? (
                  <Link to={seat.secondaryTo} className="btn btn-secondary btn-sm">
                    {seat.secondaryLabel}
                  </Link>
                ) : null}
              </div>
            </article>
          ))}
        </div>

        <section className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.65rem' }}>How seats relate</h2>
          <p style={styles.muted}>
            <strong style={{ color: '#d0d0dc' }}>Stamp</strong> is on every hop.{' '}
            <strong style={{ color: '#d0d0dc' }}>Private Desk</strong> swaps the routing posture to
            vendor-blind at the same cost + 1% door.{' '}
            <strong style={{ color: '#d0d0dc' }}>Private + Attest</strong> adds mandatory Tier-2 SP1
            (+$0.10) on top of Desk — the gateway fails closed if proof cannot be produced.
          </p>
          <p style={{ ...styles.muted, marginTop: '0.75rem' }}>
            Install wires (chat /v1, Eliza, ACP, MCP, frameworks) are not separate products — they
            are doors into the same book. See <Link to="/doors" style={styles.link}>/doors</Link>.
          </p>
        </section>

        <div style={styles.ctaRow}>
          <Link to="/pricing" className="btn btn-secondary">
            Full pricing breakdown
          </Link>
          <Link to="/book" className="btn btn-primary">
            Open the book
          </Link>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  seatCard: {
    padding: '1.35rem',
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
  },
  seatName: {
    fontSize: '1.2rem',
    marginBottom: '0.35rem',
  },
  seatPrice: {
    fontSize: '0.95rem',
    fontWeight: 600,
    color: '#00d4ff',
    marginBottom: '0.85rem',
  },
  seatLabel: {
    display: 'block',
    fontSize: '0.68rem',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: '#8a8a9a',
    marginBottom: '0.25rem',
  },
  seatFor: {
    fontSize: '0.9rem',
    color: '#c8c8d4',
    lineHeight: 1.55,
    marginBottom: '0.75rem',
  },
  seatHold: {
    fontSize: '0.9rem',
    color: '#a8a8b8',
    lineHeight: 1.55,
    marginBottom: '0.75rem',
    flex: 1,
  },
  seatDetail: {
    fontSize: '0.85rem',
    color: '#8a8a9a',
    lineHeight: 1.55,
    marginBottom: '1rem',
  },
  seatActions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.5rem',
  },
  muted: {
    color: '#8a8a9a',
    fontSize: '0.92rem',
    lineHeight: 1.65,
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
};
