import { Link } from 'react-router-dom';
import type { CSSProperties } from 'react';

/** Live production issuer (verify: GET JWKS URLs before changing). */
const JWKS_PRIMARY = 'https://api.chit402.com/.well-known/jwks.json';
const CURRENT_KID = 'IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q';
const JWK_X = '_H7J9niXF2tez_MnF25pnrDN7iJ_VC9gBzYYW9gzSPk';
const JWK_Y = 'jiorfRc9wtNaRmaFHsQaXNzcWteUA0RnpvD4SWdVl34';

const HOUSE_RECEIPT = 'https://api.chit402.com/receipt/xfuel-3155b7d8-4315-44bc-bfdc-bf6b78ff2d15';

const verifyCli = `# Issuer history is checked inside the command.
npx chit402-verify "${HOUSE_RECEIPT}"
# This receipt prints VERIFIED_PUBLIC and exits 0.
# Exit 1 is INVALID. Exit 2 is COULD_NOT_CHECK.`;

export default function IssuerTrust() {
  return (
    <div className="page docs-page">
      <div className="container" style={{ maxWidth: 720 }}>
        <header className="page-header">
          <span className="docs-kicker">Public trust root</span>
          <h1>Issuer trust</h1>
          <p>
            Chit402 signs collected receipts with ES256 (EC P-256). Check a receipt with{' '}
            <code>npx chit402-verify</code> and its URL. The command checks issuer history. Possession book
            after settle; this page does not gate <code>/book</code>.
          </p>
        </header>

        <div className="docs-panel">
          <h2>JWKS</h2>
          <p>This URL publishes the current issuer public key for collected receipts.</p>
          <ul style={styles.list}>
            <li>
              <a href={JWKS_PRIMARY} target="_blank" rel="noreferrer">
                {JWKS_PRIMARY}
              </a>
            </li>
          </ul>
        </div>

        <div className="docs-panel">
          <h2>Current signing key</h2>
          <p>
            <code>kty</code> EC · <code>crv</code> P-256 · <code>alg</code> ES256 · <code>use</code> sig
          </p>
          <dl style={styles.dl}>
            <dt>kid (RFC 7638 thumbprint)</dt>
            <dd>
              <code style={styles.mono}>{CURRENT_KID}</code>
            </dd>
            <dt>Public coordinates (fixtures only)</dt>
            <dd>
              <code style={styles.mono}>x={JWK_X}</code>
              <br />
              <code style={styles.mono}>y={JWK_Y}</code>
            </dd>
          </dl>
          <p style={styles.note}>
            The <code>kid</code> is the SHA-256 JWK thumbprint (RFC 7638). It equals the <code>kid</code> field
            on receipts and in JWKS.
          </p>
        </div>

        <div className="docs-panel">
          <h2>Key history</h2>
          <p>
            <a href="https://api.chit402.com/.well-known/issuer-history.json">
              https://api.chit402.com/.well-known/issuer-history.json
            </a>{' '}
            is the signed, append-only record: <code>kid</code>, public JWK, <code>not_before</code>,{' '}
            <code>not_after</code>, and <code>status</code>. Entries chain by hash. The current kid&apos;s{' '}
            <code>not_before</code> is <code>2026-09-04T08:52:05Z</code>. Since 2026-10-20 the production
            signing key is held in a cloud KMS, and that KMS is the only production signer. The key is not
            in the gateway environment. The kid is unchanged. How to check:{' '}
            <Link to="/docs/receipt-check">Receipt check</Link>.
          </p>
        </div>

        <div className="docs-panel">
          <h2>Rotation policy</h2>
          <ol style={styles.list}>
            <li>
              <strong>New keys get a new <code>kid</code>.</strong> A retired thumbprint is never reused. A new kid
              verifies once a <code>chit402-verify</code> release ships it.
            </li>
            <li>
              <strong>Issuer history is append-only.</strong> Each entry records the public JWK,{' '}
              <code>not_before</code>, <code>not_after</code>, and <code>status</code>. The current key signs
              the history head.
            </li>
            <li>
              <strong>In-receipt <code>issuer_jwk</code> is not an independent trust root.</strong> It documents
              the key in the signed envelope. <code>chit402-verify</code> does not read a JWKS file.
            </li>
          </ol>
        </div>

        <div className="docs-panel">
          <h2>Verify a receipt</h2>
          <ol style={styles.list}>
            <li>
              Copy the receipt URL: the public <code>verify_url</code>, or <code>GET /receipt/:taskId</code>.
            </li>
            <li>
              Run <code>npx chit402-verify</code> with that URL. Issuer history is checked inside the command.
            </li>
            <li>
              Exit 0 prints <code>VERIFIED</code> when every check passed, including the payer. A public
              attestation prints <code>VERIFIED_PUBLIC</code> and still exits 0. Exit 1 is <code>INVALID</code>.
              Exit 2 is <code>COULD_NOT_CHECK</code>.
            </li>
          </ol>
          <pre className="docs-code">
            <code>{verifyCli}</code>
          </pre>
        </div>

        <div className="docs-panel">
          <h2>What we never publish</h2>
          <p>
            The issuer <strong>private key</strong> is never in git, never on this page, and never in customer
            payloads. Only the public JWKS and these coordinates appear here.
          </p>
        </div>

        <p style={{ textAlign: 'center', fontSize: '0.85rem', color: '#8a8a9a', marginTop: '2rem' }}>
          <Link to="/docs/chit-in-15-lines" style={{ color: '#00d4ff' }}>
            Drop-in door
          </Link>
          {' · '}
          <a
            href="https://github.com/XFuel-Lab/chit402/blob/main/docs/VERIFY_ALGORITHM.md"
            target="_blank"
            rel="noreferrer"
            style={{ color: '#00d4ff' }}
          >
            Verify algorithm (GitHub)
          </a>
          <span style={{ display: 'block', marginTop: '0.5rem' }}>
            © Chit402
          </span>
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  list: { color: '#8a8a9a', lineHeight: 1.65, paddingLeft: '1.25rem' },
  dl: { margin: 0 },
  mono: { fontSize: '0.78rem', wordBreak: 'break-all' },
  note: { color: '#8a8a9a', fontSize: '0.88rem', lineHeight: 1.6 },
};
