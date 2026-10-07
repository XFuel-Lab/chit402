import { Link } from 'react-router-dom';
import type { CSSProperties } from 'react';

const HISTORY = 'https://api.chit402.com/.well-known/issuer-history.json';
const RECEIPT_ID = 'chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96';
const RECEIPT = `https://api.chit402.com/receipt/${RECEIPT_ID}?format=json`;
const KID = 'IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q';

const example = `# Receipt JSON for this id returns 200. /preimage returns 404 today.
curl -sS "${RECEIPT}" -o receipt.json
curl -sS -D - "https://api.chit402.com/receipt/${RECEIPT_ID}/preimage" -o preimage.json
# HTTP 404 preimage_unavailable — the canonical object was not stored with this
# document, and the server does not rebuild it on read.
curl -sS "${HISTORY}?version=1" -o issuer-history.json
npx -p @xfuel/verify xfuel-verify receipt.json --issuer-history-file issuer-history.json
# After a receipt is issued with a stored object, /preimage returns 200.
# Then: npx -p @xfuel/verify xfuel-verify receipt.json --canonical-preimage preimage.json --issuer-history-file issuer-history.json
# sha256 of that body is payload_hash. X-Chit-Hash-Alg is sha256.`;

export default function ReceiptCheckDocs() {
  return (
    <div className="page docs-page">
      <div className="container" style={{ maxWidth: 720 }}>
        <header className="page-header">
          <span className="docs-kicker">Verify without trusting us</span>
          <h1>Receipt check</h1>
          <p>
            A receipt stores one canonical object. Hash those bytes and you have <code>payload_hash</code>. The
            issuer also pins the key-history snapshot that was current when it signed. <code>xfuel-verify</code>{' '}
            checks that pin, including <code>not_after</code> on the pinned entry.
          </p>
        </header>

        <div className="docs-panel">
          <h2>Hash preimages</h2>
          <p>
            <code>GET /receipt/:id/preimage</code> is the stored JCS object. <code>X-Chit-Hash-Alg</code> is{' '}
            <code>sha256</code>. SHA-256 of the body is the signed <code>payload_hash</code>. The server does not
            rebuild that object on read. <code>GET /receipt/:id/preimage/:field</code> is one field, kept as a
            convenience. SHA-256 lines are UTF-8 with empty fields for nulls. Binding commitments are{' '}
            <code>keccak256</code> of the <code>abi.encodePacked</code> bytes. Tree leaves follow RFC 6962.
          </p>
          <p>
            <code>output.hash</code> stays a commitment to private model output. Coverage hashes over book rows
            are not published. The HMAC tag needs the gateway secret, so a stranger does not recompute it.
          </p>
        </div>

        <div className="docs-panel">
          <h2>Key rotation</h2>
          <p>
            <a href={HISTORY}>{HISTORY}</a> is append-only. Each published snapshot stays at{' '}
            <code>?version=N</code> or <code>?hash=</code>. A new receipt signs the hash, version, and seq of the
            snapshot in effect at issuance. Each entry has <code>kid</code>, the public JWK, <code>not_before</code>,{' '}
            <code>not_after</code>, and <code>status</code> (<code>active</code>, <code>retired</code>, or{' '}
            <code>revoked</code>). Entries chain by <code>prev_hash</code>. The current key signs the head.
          </p>
          <p>
            The live kid is <code style={styles.mono}>{KID}</code>. <code>not_before</code> is{' '}
            <code>2026-09-04T08:52:05Z</code>, the first deployment of this ES256 path. The private key is the
            PEM in the gateway environment variable <code>ISSUER_PRIVATE_KEY</code>. It is not in a cloud KMS,
            and it is not on this page.
          </p>
          <p>
            A new key gets a new <code>kid</code> and a new snapshot. <code>not_after</code> is read from the
            snapshot the receipt pinned. A revoked key fails verification for receipts issued at or after{' '}
            <code>revoked_at</code> on that entry. A pinned receipt fails closed when its snapshot cannot be
            fetched. An older receipt with no pin warns unless <code>--strict-issuer-history</code> is set.
          </p>
        </div>

        <div className="docs-panel">
          <h2>Check a house receipt</h2>
          <pre className="docs-code">
            <code>{example}</code>
          </pre>
          <p style={styles.note}>
            <code>GET /receipt/{RECEIPT_ID}</code> returns 200. <code>GET /receipt/{RECEIPT_ID}/preimage</code>{' '}
            returns 404: the canonical object was not stored with that document. The same path returns the
            stored bytes once a receipt is issued with them. <code>@xfuel/verify</code> 0.3.1 is published;
            the command above checks the issuer-history pin on the receipt file without that preimage.
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
