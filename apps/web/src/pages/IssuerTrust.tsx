import { Link } from 'react-router-dom';
import type { CSSProperties } from 'react';

/** Live production issuer (verify: GET JWKS URLs before changing). */
const JWKS_PRIMARY = 'https://api.chit402.com/.well-known/jwks.json';
const JWKS_ALIAS = 'https://api.xfuel.app/.well-known/jwks.json';
const CURRENT_KID = 'IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q';
const JWK_X = '_H7J9niXF2tez_MnF25pnrDN7iJ_VC9gBzYYW9gzSPk';
const JWK_Y = 'jiorfRc9wtNaRmaFHsQaXNzcWteUA0RnpvD4SWdVl34';

const verifyCli = `# Pin JWKS once (out-of-band), then verify a receipt JSON file
curl -sS -o chit402-issuer.jwks.json ${JWKS_PRIMARY}
npx xfuel-verify receipt.json --jwks-file chit402-issuer.jwks.json

# Or fetch JWKS in your agent and match issuer_signature.kid to a pinned kid first`;

export default function IssuerTrust() {
  return (
    <div className="page docs-page">
      <div className="container" style={{ maxWidth: 720 }}>
        <header className="page-header">
          <span className="docs-kicker">Public trust root</span>
          <h1>Issuer trust</h1>
          <p>
            Chit402 signs collected receipts with ES256 (EC P-256). Partners pin this page and the JWKS
            out-of-band — then verify every receipt against that pin. Possession book after settle; this page
            does not gate <code>/book</code>.
          </p>
        </header>

        <div className="docs-panel">
          <h2>JWKS (authoritative + alias)</h2>
          <p>Same issuer key material on both hosts. Prefer the Chit402 hostname; the XFuel API alias tracks legacy integrators.</p>
          <ul style={styles.list}>
            <li>
              <a href={JWKS_PRIMARY} target="_blank" rel="noreferrer">
                {JWKS_PRIMARY}
              </a>
            </li>
            <li>
              <a href={JWKS_ALIAS} target="_blank" rel="noreferrer">
                {JWKS_ALIAS}
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
          <h2>Rotation policy</h2>
          <ol style={styles.list}>
            <li>
              <strong>New keys get a new <code>kid</code>.</strong> A retired thumbprint is never reused.
            </li>
            <li>
              <strong>Overlap:</strong> during rotation, JWKS may publish multiple keys; verify against the{' '}
              <code>issuer_signature.kid</code> on each receipt.
            </li>
            <li>
              <strong>Announce before drop:</strong> we keep the outgoing key in JWKS until partners had time to
              refresh their pin; then remove it from JWKS.
            </li>
            <li>
              <strong>In-receipt <code>issuer_jwk</code> is not an independent trust root.</strong> It only
              documents consistency with the signed envelope. Pin JWKS + <code>kid</code> out-of-band first
              (this page), then confirm the receipt’s embedded JWK matches that pin.
            </li>
          </ol>
        </div>

        <div className="docs-panel">
          <h2>Verify a receipt against your pin</h2>
          <ol style={styles.list}>
            <li>
              Out-of-band: bookmark this page and download JWKS from the authoritative URL above. Record the pinned{' '}
              <code>kid</code> ({CURRENT_KID} today).
            </li>
            <li>
              Fetch the receipt: <code>GET /receipt/:taskId?format=json</code> (or the public{' '}
              <code>verify_url</code> with JSON).
            </li>
            <li>
              Read <code>issuer_signature.kid</code> (or the JWS header <code>kid</code>). It must match your pinned{' '}
              key in JWKS.
            </li>
            <li>
              Verify ES256: compact <code>issuer_signature.jws</code> against the pinned public key, or use{' '}
              <code>xfuel-verify</code> / <code>@xfuel/verify</code> with your JWKS file.
            </li>
            <li>
              Treat HMAC host fields and on-chain <code>payment.ref</code> as separate checks — issuer signature
              proves Chit402 signed the receipt payload, not that USDC moved (confirm settlement separately).
            </li>
          </ol>
          <pre className="docs-code">
            <code>{verifyCli}</code>
          </pre>
        </div>

        <div className="docs-panel">
          <h2>What we never publish</h2>
          <p>
            The issuer <strong>private key</strong> stays in gateway operations only — never in git, never on this
            page, never in customer payloads. Only public JWKS and test fixtures appear here.
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
