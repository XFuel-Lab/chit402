import { Link } from 'react-router-dom';
import type { CSSProperties } from 'react';
import SeoHead from '../components/SeoHead';

const SEO_TITLE = 'Paired walkthrough — Chit402 × 402Signal | Chit402';
const SEO_DESCRIPTION =
  'Two separate builder examples side by side: 402Signal before-sign route guard on synthetic payTo change, and Chit402 after-settle issuer-signed receipt evidence. Not one purchase.';

const LIVE_RECEIPT =
  'https://api.chit402.com/receipt/chit-b8dc8457-c2a1-4926-8803-9ed50d601093';
const LIVE_RECEIPT_JSON = `${LIVE_RECEIPT}?format=json`;
const BASESCAN_TX =
  'https://basescan.org/tx/0x77bb65bf944793b7dbeacc7f19d803a31bdf7afa6e273afb6210e4078c36eaf7';

const ROUTE_GUARD_VERSION = '0.7.6';
const ROUTE_GUARD_README =
  'https://github.com/402signalhq/402signal/blob/main/sdk/route-guard/README.md';
const TEST_BUYER = 'https://402signal.com/developers/test-buyer';
const ROUTE_BINDING = 'https://402signal.com/developers#route-binding';

export default function PairedWalkthrough402Signal() {
  return (
    <div className="page docs-page">
      <SeoHead title={SEO_TITLE} description={SEO_DESCRIPTION} />
      <div className="container" style={{ maxWidth: 960 }}>
        <header className="page-header">
          <span className="docs-kicker">Builder reference</span>
          <h1>Paired walkthrough</h1>
          <p>
            Chit402 and 402Signal solve different moments in agent spend. This page shows{' '}
            <strong>two separate examples</strong> side by side — not one end-to-end purchase, not a
            joint product, and not a wallet hire path.
          </p>
        </header>

        <div className="docs-panel">
          <h2>Preamble — two checkpoints</h2>
          <div style={styles.preambleGrid}>
            <div style={styles.preambleCard}>
              <p style={styles.preambleLabel}>Before you sign (402Signal)</p>
              <p style={styles.preambleBody}>
                Compare the seller&apos;s live x402 challenge to what your buyer selected. Fail closed
                before any USDC authorization callback runs.
              </p>
            </div>
            <div style={styles.preambleCard}>
              <p style={styles.preambleLabel}>After settle (Chit402)</p>
              <p style={styles.preambleBody}>
                Hold a collected row: hub, model, amount, and a signed receipt you can verify offline
                against a pinned issuer key.
              </p>
            </div>
          </div>
        </div>

        <div style={styles.examplesGrid}>
          <section className="docs-panel" style={styles.exampleColumn} aria-labelledby="example-a-title">
            <div style={styles.exampleHeader}>
              <h2 id="example-a-title" style={{ margin: 0 }}>
                Example A — Chit402
              </h2>
              <span className="badge badge-green" title="Live production receipt">
                production_evidence: true
              </span>
            </div>
            <p style={styles.honestLabel}>
              <strong>Issuer-signed settlement evidence.</strong> Pin{' '}
              <Link to="/trust">issuer trust</Link> first, verify ES256 on the receipt JSON, then
              optionally confirm USDC on Base via Basescan. This is not 402Signal route binding, not an
              SP1 inference proof, and not facilitator attestation.
            </p>
            <ol style={styles.list}>
              <li>
                Out-of-band pin:{' '}
                <Link to="/trust">https://www.chit402.com/trust</Link> — JWKS + <code>kid</code> before
                you trust any receipt.
              </li>
              <li>
                Fetch production receipt JSON:{' '}
                <a href={LIVE_RECEIPT_JSON} target="_blank" rel="noreferrer">
                  {LIVE_RECEIPT_JSON}
                </a>
              </li>
              <li>
                Human-readable view:{' '}
                <a href={LIVE_RECEIPT} target="_blank" rel="noreferrer">
                  {LIVE_RECEIPT}
                </a>
              </li>
              <li>
                Verify <code>issuer_signature.jws</code> against your pinned JWKS (see{' '}
                <Link to="/trust">issuer trust</Link> steps).
              </li>
              <li>
                Optional settlement check (separate from signature):{' '}
                <a href={BASESCAN_TX} target="_blank" rel="noreferrer">
                  Basescan transaction
                </a>
                .
              </li>
            </ol>
          </section>

          <section className="docs-panel" style={styles.exampleColumn} aria-labelledby="example-b-title">
            <div style={styles.exampleHeader}>
              <h2 id="example-b-title" style={{ margin: 0 }}>
                Example B — 402Signal
              </h2>
              <span className="badge badge-secondary" title="Synthetic lab fixture">
                production_evidence: false
              </span>
            </div>
            <p style={styles.honestLabel}>
              <strong>Synthetic payTo-change refusal.</strong> No wallet, no real USDC, and not tied to
              Example A&apos;s receipt id. Exercise{' '}
              <code>@402signal/route-guard@{ROUTE_GUARD_VERSION}</code> with the{' '}
              <a href={TEST_BUYER} target="_blank" rel="noreferrer">
                test-buyer
              </a>{' '}
              flow.
            </p>
            <ol style={styles.list}>
              <li>
                Read the guard contract:{' '}
                <a href={ROUTE_GUARD_README} target="_blank" rel="noreferrer">
                  route-guard README
                </a>{' '}
                and{' '}
                <a href={ROUTE_BINDING} target="_blank" rel="noreferrer">
                  route binding guide
                </a>
                .
              </li>
              <li>
                Run{' '}
                <a href={TEST_BUYER} target="_blank" rel="noreferrer">
                  Try without funds
                </a>{' '}
                — synthetic inputs and a fake payment callback only.
              </li>
              <li>
                Allow once on a matching synthetic offer (terms bind cleanly).
              </li>
              <li>
                Mutate <strong>only</strong> <code>payTo</code> in the seller challenge; leave price,
                network, and resource unchanged.
              </li>
              <li>
                Expect fail-closed refusal: <code>quote_changed</code> / binding mismatch —{' '}
                <strong>zero</strong> payment authorization callbacks.
              </li>
            </ol>
            <p style={styles.note}>
              Default <code>accept_payTo_change</code> stays false. Selection may exclude{' '}
              <code>payTo_pending</code> rows; the local guard still refuses when the live challenge
              hash no longer matches the bound offer.
            </p>
          </section>
        </div>

        <div className="docs-panel">
          <h2>What this page is not</h2>
          <ul style={styles.list}>
            <li>Not a single stitched demo from 402Signal check → Chit402 receipt.</li>
            <li>Not a partnership claim, escrow, or delivery guarantee between the two products.</li>
            <li>Not a USDC-signer hire path or third-party wallet attribution.</li>
          </ul>
        </div>

        <p style={{ textAlign: 'center', fontSize: '0.85rem', color: '#8a8a9a', marginTop: '2rem' }}>
          <Link to="/trust" style={{ color: '#00d4ff' }}>
            Issuer trust
          </Link>
          {' · '}
          <Link to="/docs/chit-in-15-lines" style={{ color: '#00d4ff' }}>
            Chit in 15 lines
          </Link>
          <span style={{ display: 'block', marginTop: '0.5rem' }}>Chit402 — builder seat reference</span>
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  preambleGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: '1rem',
    marginTop: '0.75rem',
  },
  preambleCard: {
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8,
    padding: '1rem 1.1rem',
    background: 'rgba(0,0,0,0.2)',
  },
  preambleLabel: {
    margin: '0 0 0.35rem',
    fontSize: '0.78rem',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: '#00d4ff',
  },
  preambleBody: { margin: 0, color: '#8a8a9a', lineHeight: 1.6, fontSize: '0.92rem' },
  examplesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '1.25rem',
    alignItems: 'start',
  },
  exampleColumn: { margin: 0, height: '100%' },
  exampleHeader: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '0.65rem',
    marginBottom: '0.75rem',
  },
  honestLabel: { color: '#c8c8d4', lineHeight: 1.65, fontSize: '0.92rem' },
  list: { color: '#8a8a9a', lineHeight: 1.65, paddingLeft: '1.25rem', margin: '0.75rem 0 0' },
  note: { color: '#8a8a9a', fontSize: '0.88rem', lineHeight: 1.6, marginTop: '1rem' },
};
