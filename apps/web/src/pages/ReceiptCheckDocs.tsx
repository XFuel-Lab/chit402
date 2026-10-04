import { Link } from 'react-router-dom';
import type { CSSProperties } from 'react';

const HISTORY = 'https://api.chit402.com/.well-known/issuer-history.json';
const RECEIPT = 'https://api.chit402.com/receipt/chit-39af100b-23dd-4d86-a16b-4556ca6796af?format=json';
const KID = 'IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q';

const example = `# Fetch a house receipt and the signed key history, then recompute.
curl -sS "${RECEIPT}" -o receipt.json
curl -sS "${HISTORY}" -o issuer-history.json
npx -p @xfuel/verify xfuel-verify receipt.json --issuer-history-file issuer-history.json

# One hash, raw bytes:
# curl -sS "https://api.chit402.com/receipt/chit-39af100b-23dd-4d86-a16b-4556ca6796af/preimage/book_chain.row_hash?raw=1"`;

export default function ReceiptCheckDocs() {
  return (
    <div className="page docs-page">
      <div className="container" style={{ maxWidth: 720 }}>
        <header className="page-header">
          <span className="docs-kicker">Verify without trusting us</span>
          <h1>Receipt check</h1>
          <p>
            A receipt publishes the bytes behind each public hash, and the issuer publishes a signed history of
            every signing key. <code>xfuel-verify</code> recomputes the hashes and checks that the receipt&apos;s{' '}
            <code>kid</code> was allowed to sign at <code>iat</code>.
          </p>
        </header>

        <div className="docs-panel">
          <h2>Hash preimages</h2>
          <p>
            <code>GET /receipt/:id?format=json</code> includes <code>preimages</code>.{' '}
            <code>GET /receipt/:id/preimage/:field</code> returns one field. SHA-256 lines are UTF-8 with empty
            fields for nulls. Binding commitments are <code>keccak256</code> of the <code>abi.encodePacked</code>{' '}
            bytes. Tree leaves follow RFC 6962.
          </p>
          <p>
            <code>output.hash</code> stays a commitment to private model output. Coverage hashes over book rows
            are not published. The HMAC tag needs the gateway secret, so a stranger does not recompute it.
          </p>
        </div>

        <div className="docs-panel">
          <h2>Key rotation</h2>
          <p>
            <a href={HISTORY}>{HISTORY}</a> is append-only. Each entry has <code>kid</code>, the public JWK,{' '}
            <code>not_before</code>, <code>not_after</code>, and <code>status</code> (<code>active</code>,{' '}
            <code>retired</code>, or <code>revoked</code>). Entries chain by <code>prev_hash</code>. The current
            key signs the head.
          </p>
          <p>
            The live kid is <code style={styles.mono}>{KID}</code>. <code>not_before</code> is{' '}
            <code>2026-09-04T08:52:05Z</code>, the first deployment of this ES256 path. The private key is the
            PEM in the gateway environment variable <code>ISSUER_PRIVATE_KEY</code>. It is not in a cloud KMS,
            and it is not on this page.
          </p>
          <p>
            A new key gets a new <code>kid</code>. A revoked key fails verification for receipts issued at or
            after <code>revoked_at</code>. If the history URL cannot be fetched, <code>xfuel-verify</code> warns.{' '}
            <code>--strict-issuer-history</code> fails closed.
          </p>
        </div>

        <div className="docs-panel">
          <h2>Check a house receipt</h2>
          <pre className="docs-code">
            <code>{example}</code>
          </pre>
          <p style={styles.note}>
            The history URL and the <code>preimages</code> block answer after the gateway deploy. Until then the
            verifier warns that the history is unreachable.
          </p>
        </div>

        <p style={{ textAlign: 'center', fontSize: '0.85rem', color: '#8a8a9a', marginTop: '2rem' }}>
          <Link to="/trust" style={{ color: '#00d4ff' }}>Issuer trust</Link>
          {' · '}
          <Link to="/docs" style={{ color: '#00d4ff' }}>Docs</Link>
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  mono: { fontSize: '0.78rem', wordBreak: 'break-all' },
  note: { color: '#8a8a9a', fontSize: '0.88rem', lineHeight: 1.6 },
};
