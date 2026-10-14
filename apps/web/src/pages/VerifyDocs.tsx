import { Link } from 'react-router-dom';

/**
 * One id per reason `chit402-verify` prints after
 * `https://chit402.com/docs/verify#`. Keep in step with VERDICT_DOC_ANCHORS.
 */
const REASONS: { id: string; text: string }[] = [
  { id: 'not_in_log', text: 'This receipt is not a leaf of the public log. The payment row in the book is unchanged. Exit 1.' },
  { id: 'signed_receipt_unavailable', text: 'The document is the public shell. The signed receipt is on the owner view. Exit 2. This is not a missing issuer-history file.' },
  { id: 'unsupported_version', text: 'This verifier does not accept the receipt version. Exit 2. Upgrade the verifier.' },
  { id: 'kid_not_in_history', text: 'No loaded issuer history covers this key. Exit 2. Pass --issuer-history with a snapshot that includes the kid and prefix-extends the bundled snapshot.' },
  { id: 'log_unreachable', text: 'The receipt, the log, or the anchor was not fetched. Exit 2. The receipt was not found invalid.' },
  { id: 'anchor_unreachable', text: 'The anchor was not fetched. Exit 2. The receipt was not found invalid.' },
  { id: 'pending_anchor', text: 'The leaf is past the anchored tree. Exit 2. Re-run when the anchor for this leaf is published.' },
  { id: 'pending', text: 'The anchor is not in yet. Exit 2.' },
  { id: 'kid_status_regression', text: 'Issuer history changes not_before or restores a revoked or retired key. Exit 1.' },
  { id: 'kid_revoked_before_issuance', text: 'The issuer key was revoked before this receipt was issued. Exit 1.' },
  { id: 'issued_before_not_before', text: 'The receipt is before the key window. Exit 1.' },
  { id: 'issued_after_not_after', text: 'The receipt is after the key window. Exit 1.' },
  { id: 'issued_at_missing', text: 'The receipt has no issuance time, so the key window cannot be checked. Exit 1.' },
  { id: 'not_before_missing', text: 'The history entry has no not_before. Exit 1.' },
  { id: 'not_after_invalid', text: 'The history entry has a not_after that does not parse. Exit 1.' },
  { id: 'revoked_at_missing', text: 'A revoked key has no revoked_at. Exit 1.' },
  { id: 'issuer_history_invalid', text: 'The issuer history document did not verify. Exit 1.' },
  { id: 'issuer_history_pin_mismatch', text: 'The receipt pins a different history document than the one that was loaded. Exit 1.' },
  { id: 'issuer_history_pin_missing', text: 'This receipt version requires an issuer-history pin and none is present. Exit 1.' },
  { id: 'issuer_history_version_mismatch', text: 'The history version does not match the pin. Exit 1.' },
  { id: 'issuer_history_seq_mismatch', text: 'The history seq does not match the pin. Exit 1.' },
  { id: 'issuer_history_not_extension', text: 'The --issuer-history file does not prefix-extend the bundled snapshot. Exit 1.' },
  { id: 'signature_invalid', text: 'The issuer signature does not verify. Exit 1.' },
  { id: 'key untrusted', text: 'The signing key is not a pinned issuer key. Exit 1.' },
  { id: 'key_window', text: 'The key window check failed. Exit 1.' },
  { id: 'version_mismatch', text: 'The receipt version does not match the signature. Exit 1.' },
  { id: 'id_mismatch', text: 'The receipt id does not match the signature. Exit 1.' },
  { id: 'id_prefix_version_mismatch', text: 'The id prefix is not valid for this receipt version. Exit 1.' },
  { id: 'intent_on_legacy_version', text: 'A signed intent is not a payment on this receipt version. Exit 1.' },
  { id: 'payment_mismatch', text: 'The payment on the receipt does not match the signature. Exit 1.' },
  { id: 'log_inclusion', text: 'The inclusion proof did not verify. Exit 1.' },
  { id: 'anchor', text: 'The anchor did not verify. Exit 1.' },
  { id: 'invalid', text: 'The receipt is invalid. Exit 1.' },
  { id: 'signature_unchecked', text: 'The signature was not checked. Exit 2. The receipt was not found invalid.' },
  { id: 'could_not_check', text: 'A check could not be completed. Exit 2. The receipt was not found invalid.' },
  { id: 'prev_hash_mismatch', text: 'An issuer-history entry does not chain to the previous entry. Exit 1.' },
  { id: 'entry_hash_mismatch', text: 'An issuer-history entry hash does not match its body. Exit 1.' },
  { id: 'head_hash_mismatch', text: 'The issuer-history head hash does not match the last entry. Exit 1.' },
  { id: 'introduced_key_signature', text: 'The history is signed only by the key it introduces. Exit 1.' },
  { id: 'inherited_key_window', text: 'A new key copies an older not_before. Exit 1.' },
  { id: 'head_signature_missing', text: 'The tree head has no issuer signature. Exit 1 when a proof or head was fetched.' },
  { id: 'head_signature_invalid', text: 'The tree head signature does not verify. Exit 1.' },
  { id: 'head_claims_mismatch', text: 'The signed tree head does not match the head that was served. Exit 1.' },
  { id: 'head_key_untrusted', text: 'The tree head is signed by a key this verifier does not pin. Exit 1.' },
  { id: 'inclusion_failed', text: 'The inclusion proof does not reach the signed root. Exit 1.' },
  { id: 'root_mismatch', text: 'The inclusion root does not match the signed head. Exit 1.' },
];

export default function VerifyDocs() {
  return (
    <div className="page docs-page">
      <div className="container" style={{ maxWidth: 720 }}>
        <header className="page-header">
          <span className="docs-kicker">chit402-verify 0.4</span>
          <h1>Verify</h1>
          <p>
            <code>npx chit402-verify &lt;id|url|file&gt;</code> prints a verdict and a link to one of the reasons
            below. Exit 0 is <code>VERIFIED</code>. Exit 1 is <code>INVALID</code>, including <code>NOT_IN_LOG</code>.
            Exit 2 is <code>COULD_NOT_CHECK</code>. That line says the receipt was not found invalid.
          </p>
        </header>

        <div className="docs-panel">
          <h2>What the command checks</h2>
          <p>
            A receipt URL is read as JSON (<code>?format=json</code>, <code>Accept: application/json</code>).
            HTML, a timeout, or a host that does not answer is exit 2. A fetched inclusion proof or tree head
            that does not verify is exit 1. <code>NOT_IN_LOG</code> needs a signed head whose signature verifies
            and that does not cover the leaf. An unsigned 404 body alone is not that result.
          </p>
          <p>
            The public page is an unsigned shell. That is <code>signed_receipt_unavailable</code> (exit 2) unless
            the shell has no inclusion and a fresh <code>not_in_tree</code> sits beside a verified head. Then it
            is <code>NOT_IN_LOG</code>. The signed receipt stays on the owner view.
          </p>
          <p>
            History is always on. <code>--issuer-history &lt;file&gt;</code> must prefix-extend the snapshot
            shipped in the package (as of 2026-10-14). <code>--json</code> prints the verdict. Other flags,
            including <code>--issuer-history-file</code>, are removed.
          </p>
        </div>

        <div className="docs-panel">
          <h2>Reasons</h2>
          {REASONS.map((row) => (
            <section id={row.id} key={row.id} style={{ marginTop: '1.25rem' }}>
              <h3><code>{row.id}</code></h3>
              <p>{row.text}</p>
            </section>
          ))}
        </div>

        <p style={{ textAlign: 'center', fontSize: '0.85rem', color: '#8a8a9a', marginTop: '2rem' }}>
          <Link to="/docs/receipt-check" style={{ color: '#00d4ff' }}>Receipt check</Link>
          {' · '}
          <Link to="/trust" style={{ color: '#00d4ff' }}>Issuer trust</Link>
          {' · '}
          <Link to="/docs" style={{ color: '#00d4ff' }}>Docs</Link>
        </p>
      </div>
    </div>
  );
}
