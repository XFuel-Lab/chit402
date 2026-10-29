import { Link } from 'react-router-dom';
import type { CSSProperties } from 'react';
import SeoHead from '../components/SeoHead';
import { getApiV1 } from '../apiHost';
import { RichText } from '../content/RichText';
import { pricingModel } from '../content/pricingContent.mjs';

const PRICING_SEO = {
  title: 'Pricing — standard receipt $0.002 USDC | Chit402',
  description:
    'POST /v1/chat/completions charges a quoted price and gives a receipt for every call, paid in USDC on Base and Solana. Standard signed receipt $0.002 USDC every hop; provider routing is cost + 1%.',
};

export default function Pricing() {
  const apiV1 = getApiV1();
  const copy = pricingModel(apiV1);

  return (
    <div className="page docs-page">
      <SeoHead title={PRICING_SEO.title} description={PRICING_SEO.description} />
      <div className="container" style={{ maxWidth: 720 }}>
        <header className="page-header">
          <span className="docs-kicker">{copy.kicker}</span>
          <h1>{copy.h1}</h1>
          <p>
            <RichText parts={copy.intro} />
          </p>
        </header>

        <section style={styles.clarityBar} aria-labelledby="standard-receipt-heading">
          <p style={styles.clarityLabel}>{copy.clarityLabel}</p>
          <h2 id="standard-receipt-heading" style={styles.clarityAmount}>
            {copy.clarityAmount}
          </h2>
          {copy.clarityParagraphs.map((parts: any, index: number) => (
            <p key={index} style={styles.clarityBody}>
              <RichText parts={parts} />
            </p>
          ))}
        </section>

        <div className="grid grid-3" style={{ gap: '1.25rem', marginBottom: '2rem' }}>
          {copy.columns.map((column: any) => (
            <div key={column.title} className="card">
              <h3 style={styles.cardTitle}>{column.title}</h3>
              <ul style={styles.list}>
                {column.items.map((item: any, index: number) => (
                  <li key={index}>{typeof item === 'string' ? item : <RichText parts={item} />}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <section className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.65rem' }}>{copy.valueTitle}</h2>
          <ul style={styles.list}>
            {copy.valueItems.map((item: any, index: number) => (
              <li key={index}>{typeof item === 'string' ? item : <RichText parts={item} />}</li>
            ))}
          </ul>
          <p style={{ ...styles.muted, marginTop: '0.85rem' }}>{copy.valueNote}</p>
        </section>

        <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.65rem' }}>{copy.enterTitle}</h2>
          <p style={styles.muted}>
            <RichText parts={copy.enterBody} />
          </p>
        </div>

        <div style={styles.ctaRow}>
          {copy.ctas.map((cta: any) => (
            <Link
              key={cta.href}
              to={cta.href}
              className={cta.variant === 'primary' ? 'btn btn-primary' : 'btn btn-secondary'}
            >
              {cta.label}
            </Link>
          ))}
        </div>

        <p style={styles.footnote}>
          <RichText parts={copy.footnote} />
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
