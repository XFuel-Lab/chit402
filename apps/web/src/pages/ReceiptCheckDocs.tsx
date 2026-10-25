import { Link } from 'react-router-dom';
import type { CSSProperties } from 'react';

const HISTORY = 'https://api.chit402.com/.well-known/issuer-history.json';
const RECEIPT_ID = 'xfuel-3155b7d8-4315-44bc-bfdc-bf6b78ff2d15';
const RECEIPT = `https://api.chit402.com/receipt/${RECEIPT_ID}?format=json`;
const KID = 'IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q';

const example = `# Receipt JSON and /preimage for this id both return 200.
curl -sS "${RECEIPT}" -o receipt.json
curl -sS -D - "https://api.chit402.com/receipt/${RECEIPT_ID}/preimage" -o preimage.json
# /preimage is the unsigned public shell (JCS), not the signed payload.
# This receipt carries a public attestation, so anyone with the URL can check it.
# Issuer history is checked inside the command.
npx chit402-verify "https://api.chit402.com/receipt/${RECEIPT_ID}"
# VERIFIED_PUBLIC: settled amount, payee, tx, and log position. Payer is not claimed.
# Exit 0. Exit 1 is INVALID. Exit 2 is COULD_NOT_CHECK.

# Optional: the same check with the current issuer-history snapshot (version 2).
# The file must prefix-extend the snapshot shipped in the package.
curl -sS "${HISTORY}" -o issuer-history.json
npx chit402-verify receipt.json --issuer-history issuer-history.json`;

export default function ReceiptCheckDocs() {
  return (
    <div className="page docs-page">
      <div className="container" style={{ maxWidth: 720 }}>
        <header className="page-header">
          <span className="docs-kicker">Verify without trusting us</span>
          <h1>Receipt check</h1>
          <p>
            A receipt stores one canonical object. Hash those bytes and you have <code>payload_hash</code>.{' '}
            <code>chit402-verify</code> checks the issuer signature, the key window, the log, and the anchor.
            Issuer history is part of that check.
          </p>
          <p>
            <Link to="/check">Check a receipt</Link> in the browser. Paste the receipt JSON, or a receipt id or
            URL. Free. No account.
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
            <code>2026-09-04T08:52:05Z</code>, the first deployment of this ES256 path. Since 2026-10-20 the
            production signing key is held in a cloud KMS, and that KMS is the only production signer. The key
            is not in the gateway environment. The kid is unchanged. The private key is not on this page.
          </p>
          <p>
            A new key gets a new <code>kid</code> and a new snapshot. A revoked key fails verification for a
            receipt issued at or after <code>revoked_at</code> on that entry. <code>chit402-verify</code> always
            checks issuer history. A <code>--issuer-history</code> file is accepted only when it prefix-extends
            the snapshot shipped in the package. The current live snapshot is version 2.
          </p>
        </div>

        <div className="docs-panel">
          <h2>Check a house receipt</h2>
          <pre className="docs-code">
            <code>{example}</code>
          </pre>
          <p style={styles.note}>
            <code>GET /receipt/{RECEIPT_ID}</code> returns 200. <code>GET /receipt/{RECEIPT_ID}/preimage</code>{' '}
            returns 200 with the unsigned public shell (JCS). It is not the signed payload. The receipt carries a
            public attestation, so <code>npx chit402-verify</code> reports VERIFIED_PUBLIC for its public fields.
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
