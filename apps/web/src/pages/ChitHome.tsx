import { Fragment, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { getApiV1 } from '../apiHost';
import { getHostConfig } from '../hostConfig';
import LiveReceiptCard from '../components/LiveReceiptCard';
import { LIVE_RECEIPT_VERIFY_URL } from '../lib/liveReceiptSpecimen';
import { RichText } from '../content/RichText';
import {
  HOME_SNIPPET_API,
  dropInSnippet,
  homeContent,
  ninetyLead,
  partnerKeySnippet,
} from '../content/homeContent.mjs';

type DropInDoor = 'x402' | 'key';

export default function ChitHome() {
  const config = getHostConfig();
  const resolvedApiV1 = getApiV1();

  return (
    <div className="page">
      <section style={styles.hero}>
        <div className="container chit-hero-wrap">
          <div className="chit-hero-grid">
            <div className="chit-hero-copy">
              <h1 style={styles.heroTitle}>{homeContent.h1}</h1>
              <p style={styles.heroLead}>{homeContent.lead}</p>
              <p style={styles.heroDescription}>{homeContent.description}</p>
              <p style={styles.pricingChip}>
                <Link to={homeContent.pricingHref} style={styles.pricingChipLink}>
                  {homeContent.pricingLabel}
                </Link>
                {' · '}
                <Link to={homeContent.productsHref} style={styles.pricingChipLink}>
                  {homeContent.productsLabel}
                </Link>
              </p>
              <div style={styles.heroCta}>
                <Link to={homeContent.bookHref} className="btn btn-primary">
                  {homeContent.bookLabel}
                </Link>
                <a
                  href={LIVE_RECEIPT_VERIFY_URL}
                  className="btn btn-secondary"
                  target="_blank"
                  rel="noreferrer"
                >
                  {homeContent.verifyLabel}
                </a>
                <Link to={homeContent.dropInDocsHref} className="btn btn-secondary">
                  {homeContent.dropInDocsLabel}
                </Link>
              </div>
              <p style={styles.checkYourself}>
                {homeContent.checkYourself}{' '}
                {homeContent.checkLinks.map((link, index) => (
                  <Fragment key={link.href}>
                    {index > 0 ? ' · ' : null}
                    {link.internal ? (
                      <Link to={link.href} style={styles.checkLink}>{link.label}</Link>
                    ) : (
                      <a href={link.href} style={styles.checkLink}>{link.label}</a>
                    )}
                  </Fragment>
                ))}
              </p>
            </div>
            <LiveReceiptCard />
          </div>

          <div className="chit-ninety-door card">
            <h2 style={styles.ninetyTitle}>{homeContent.ninetyTitle}</h2>
            <p style={styles.ninetyLead}>
              <RichText parts={ninetyLead(LIVE_RECEIPT_VERIFY_URL)} />
            </p>
            <DropInSamples apiUrl={resolvedApiV1} />
          </div>
        </div>
      </section>

      <section style={{ padding: '2rem 0' }}>
        <div className="container" style={{ maxWidth: 720 }}>
          <h2 style={{ marginBottom: '0.5rem', textAlign: 'center', fontSize: '1.25rem' }}>
            {homeContent.alsoWorksTitle}
          </h2>
          <p
            style={{
              textAlign: 'center',
              color: '#8a8a9a',
              fontSize: '0.95rem',
              marginBottom: '1.25rem',
              lineHeight: 1.6,
            }}
          >
            {homeContent.alsoWorksBody}
          </p>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.75rem',
              justifyContent: 'center',
            }}
          >
            {homeContent.adapters.map((link) => (
              <Link key={link.href} to={link.href} className="btn btn-secondary btn-sm">
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section style={{ padding: '1rem 0 3rem' }}>
        <div className="container" style={{ maxWidth: 720 }}>
          <h2 style={{ marginBottom: '1.5rem', textAlign: 'center' }}>{homeContent.rowTitle}</h2>
          <div className="grid grid-3" style={{ gap: '1.5rem' }}>
            {homeContent.cards.map((card) => (
              <div key={card.heading} className="card">
                <h3>{card.heading}</h3>
                <p>{card.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ padding: '2rem 0 4rem' }}>
        <div className="container" style={{ maxWidth: 720, textAlign: 'center' }}>
          <p style={{ color: '#8a8a9a', fontSize: '0.95rem' }}>
            <a
              href={config.githubUrl}
              target="_blank"
              rel="noreferrer"
              style={{ color: '#00d4ff' }}
            >
              {homeContent.githubLabel}
            </a>
            {homeContent.footerLinks.map((link) => (
              <Fragment key={link.href}>
                {' · '}
                <Link to={link.href} style={{ color: '#00d4ff' }}>
                  {link.label}
                </Link>
              </Fragment>
            ))}
          </p>
        </div>
      </section>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  hero: {
    padding: '4rem 0 2.5rem',
    background: 'radial-gradient(ellipse at 50% 0%, rgba(0,212,255,0.08) 0%, transparent 60%)',
  },
  heroTitle: {
    fontSize: 'clamp(2rem, 4vw, 2.75rem)',
    fontWeight: 800,
    lineHeight: 1.15,
    marginBottom: '0.75rem',
  },
  heroLead: {
    fontSize: '1.2rem',
    color: '#f0f0f5',
    marginBottom: '1rem',
    fontWeight: 600,
    lineHeight: 1.4,
  },
  heroDescription: {
    fontSize: '1rem',
    color: '#8a8a9a',
    maxWidth: '36rem',
    marginBottom: '1rem',
    lineHeight: 1.7,
  },
  pricingChip: {
    marginBottom: '1.25rem',
    fontSize: '0.92rem',
  },
  pricingChipLink: {
    display: 'inline-block',
    padding: '0.35rem 0.75rem',
    borderRadius: '999px',
    border: '1px solid rgba(0,212,255,0.35)',
    background: 'rgba(0,212,255,0.06)',
    color: '#a5f3fc',
    textDecoration: 'none',
    fontWeight: 600,
  },
  heroCta: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    flexWrap: 'wrap' as const,
  },
  checkYourself: {
    marginTop: '0.9rem',
    marginBottom: 0,
    fontSize: '0.85rem',
    color: '#8a8a9a',
    lineHeight: 1.6,
  },
  checkLink: {
    color: '#00d4ff',
    textDecoration: 'none',
  },
  ninetyTitle: {
    fontSize: '1.1rem',
    marginBottom: '0.5rem',
  },
  ninetyLead: {
    color: '#8a8a9a',
    fontSize: '0.92rem',
    lineHeight: 1.65,
    marginBottom: '0.85rem',
  },
  ninetyTabs: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '0.5rem',
    marginBottom: '0.75rem',
  },
  ninetyTab: {
    fontFamily: 'inherit',
    fontSize: '0.85rem',
    fontWeight: 600,
    padding: '0.4rem 0.8rem',
    borderRadius: '999px',
    border: '1px solid rgba(255,255,255,0.16)',
    background: 'transparent',
    color: '#d0d0dc',
    cursor: 'pointer',
  },
  ninetyTabOn: {
    fontFamily: 'inherit',
    fontSize: '0.85rem',
    fontWeight: 600,
    padding: '0.4rem 0.8rem',
    borderRadius: '999px',
    border: '1px solid rgba(0,212,255,0.45)',
    background: 'rgba(0,212,255,0.1)',
    color: '#a5f3fc',
    cursor: 'pointer',
  },
};

function DropInSamples({ apiUrl }: { apiUrl: string }) {
  const [door, setDoor] = useState<DropInDoor>('x402');
  const snippet = (door === 'x402' ? dropInSnippet : partnerKeySnippet).replace(HOME_SNIPPET_API, apiUrl);
  const tabId = door === 'x402' ? 'drop-in-x402' : 'drop-in-key';

  return (
    <>
      <div role="tablist" aria-label="How you pay the drop-in" style={styles.ninetyTabs}>
        <button
          type="button"
          role="tab"
          id="drop-in-x402"
          aria-selected={door === 'x402'}
          aria-controls="drop-in-panel"
          style={door === 'x402' ? styles.ninetyTabOn : styles.ninetyTab}
          onClick={() => setDoor('x402')}
        >
          {homeContent.payPerCall}
        </button>
        <button
          type="button"
          role="tab"
          id="drop-in-key"
          aria-selected={door === 'key'}
          aria-controls="drop-in-panel"
          style={door === 'key' ? styles.ninetyTabOn : styles.ninetyTab}
          onClick={() => setDoor('key')}
        >
          {homeContent.partnerKey}
        </button>
      </div>
      <pre
        className="docs-code chit-ninety-code"
        role="tabpanel"
        id="drop-in-panel"
        aria-labelledby={tabId}
      >
        <code>{snippet}</code>
      </pre>
    </>
  );
}
