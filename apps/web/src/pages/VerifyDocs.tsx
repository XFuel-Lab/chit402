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
  { id: 'receipt_unavailable', text: 'The receipt itself was not fetched. Exit 2. Every check is could_not_check. The receipt was not found invalid.' },
  { id: 'issuer_history_unavailable', text: 'Issuer history could not be read. Exit 1, matching the CLI. This is not a tampered receipt.' },
  { id: 'log_unreachable', text: 'A loaded receipt\'s log or anchor was not fetched. Exit 2. The receipt was not found invalid.' },
  { id: 'anchor_unreachable', text: 'The anchor was not fetched. Exit 2. The receipt was not found invalid.' },
  { id: 'pending_anchor', text: 'The leaf is past the anchored tree. Exit 2. Re-run when the anchor for this leaf is published.' },
  { id: 'pending', text: 'The anchor is not in yet. Exit 2.' },
  { id: 'kid_status_regression', text: 'Issuer history changes not_before or restores a revoked or retired key. Exit 1.' },
  { id: 'kid_revoked_before_issuance', text: 'The issuer key was revoked before this receipt was issued. Exit 1.' },
  { id: 'issued_before_not_before', text: 'The receipt is before the key window. Exit 1.' },
  { id: 'issued_after_not_after', text: 'The receipt is after the key window. Exit 1.' },
  { id: 'version_window_closed', text: 'The receipt was signed after its receipt version closed. Exit 1.' },
  { id: 'version_window_not_open', text: 'The receipt was signed before its receipt version opened (v11 and later). Exit 1.' },
  { id: 'version_window_missing', text: 'The verifier has no validity window for this receipt version. Exit 1.' },
  { id: 'log_time_after_window', text: 'The receipt entered the public log after its receipt version closed. Exit 1.' },
  { id: 'log_time_unavailable', text: 'The receipt version has closed and the chain time of its log entry could not be read. Exit 2.' },
  { id: 'legacy_form_not_allowlisted', text: 'A receipt whose version is not signed, or with a detached signature, is accepted only by exact fingerprint on the bundled list. The list is empty. Exit 1.' },
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
  { id: 'key_untrusted', text: "Signed by a key that is not the issuer's. The check reason is \"key untrusted\". Exit 1." },
  { id: 'key_window', text: 'The key window check failed. Exit 1.' },
  { id: 'version_mismatch', text: 'The receipt version does not match the signature. Exit 1.' },
  { id: 'id_mismatch', text: 'The receipt id does not match the signature. Exit 1.' },
  { id: 'id_prefix_version_mismatch', text: 'The id prefix is not valid for this receipt version. Exit 1.' },
  { id: 'intent_on_legacy_version', text: 'A signed intent is not a payment on this receipt version. Exit 1.' },
  { id: 'payment_mismatch', text: 'The payment on the receipt does not match the signature or the on-chain transfer. Exit 1.' },
  { id: 'claim_mismatch', text: 'A field on the receipt does not match the signed copy. Exit 1. This is not a payer mismatch.' },
  { id: 'payer_unchecked', text: 'The on-chain payer check did not finish. The RPC timed out, returned null or an error, a payer field is missing, or the rail is not one this verifier can read. Exit 2. The receipt was not found invalid.' },
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
  { id: 'verified_public', text: 'VERIFIED_PUBLIC (0.4.6, exit 0). The public attestation on the shell verified: its signature and key window, the amount, payee, and tx against one on-chain Base USDC transfer of the signed settled amount, and the signed log leaf and index against a fresh proof and anchor. It does not claim the payer or fulfillment. The link from the receipt id to the log leaf rests on the issuer signature.' },
  { id: 'public_attestation_pending', text: 'The shell says the public attestation is pending. It is signed after the log leaf exists. Exit 2.' },
  { id: 'invalid_jws', text: 'The public attestation is malformed: wrong typ, no tag line, a claim outside the allowlist, or non-canonical claims. Exit 1. It never falls back to signed_receipt_unavailable.' },
  { id: 'leaf_not_bound', text: 'The log served a leaf that is not the leaf the issuer signed. Exit 1.' },
  { id: 'leaf_index_mismatch', text: 'The log served a leaf index that is not the index the issuer signed. Exit 1.' },
  { id: 'log_epoch_mismatch', text: 'The log answered for a different epoch than the one the issuer signed. Exit 2.' },
  { id: 'transfer_mismatch', text: 'The Base transaction does not hold exactly one USDC transfer of the signed settled amount to the signed payee, or it reverted or is on another chain. Exit 1.' },
  { id: 'public_rail_unsupported', text: 'Public attestations are checked on Base only. Exit 2.' },
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
            below.             Exit 0 is <code>VERIFIED</code> only when the on-chain payer check ran and passed, with the
            signature, the key window, the log, and the anchor. Exit 1 is <code>INVALID</code>, including
            a payer mismatch and <code>NOT_IN_LOG</code>. Exit 2 is <code>COULD_NOT_CHECK</code> when the
            log, the anchor, or the payer could not be checked. That line does not say the receipt was invalid.
          </p>
        </header>

        <div className="docs-panel">
          <h2>What the command checks</h2>
          <p>
            A receipt URL is read as JSON (<code>?format=json</code>, <code>Accept: application/json</code>).
            HTML, a timeout, or a host that does not answer is exit 2. A fetched inclusion proof or tree head
            that does not verify is exit 1. <code>NOT_IN_LOG</code> needs the current signed tree head, and
            that signature has to verify, beside an unsigned <code>not_in_tree</code> response. It does not
            check that the head covers the leaf. An unsigned head, or an unsigned 404 alone, is not that result.
          </p>
          <p>
            The public page is an unsigned shell. That is <code>signed_receipt_unavailable</code> (exit 2) unless
            the shell has no inclusion and a fresh <code>not_in_tree</code> sits beside a verified head. Then it
            is <code>NOT_IN_LOG</code>. The signed receipt stays on the owner view.
          </p>
          <p>
            From 0.4.6 a shell may carry <code>public_attestation</code>: a separate issuer signature over the
            public fields of a collected Base USDC receipt. When it verifies, with a fresh log proof and one
            matching on-chain transfer, the result is <code>VERIFIED_PUBLIC</code> (exit 0). It does not claim
            the payer or fulfillment. A malformed or invalid attestation is exit 1. A pending one is exit 2.
            Older verifiers reject it.
          </p>
          <p>
            History is always on. <code>--issuer-history &lt;file&gt;</code> must prefix-extend the snapshot
            shipped in the package (as of 2026-10-14). <code>--json</code> prints the verdict. The payer
            check is on; there is no flag to skip it. Other flags, including <code>--issuer-history-file</code>
            and any argument after <code>--</code>, are removed.
          </p>
        </div>

        <div className="docs-panel" id="merkle-hashing">
          <h2>Merkle hashing</h2>
          <p>
            The log follows RFC 6962. <code>leaf_hash</code> is already the leaf hash:
            SHA-256(<code>0x00</code> ‖ <code>task_id|row_hash</code>). Do not add the <code>0x00</code> prefix
            again. An interior node is SHA-256(<code>0x01</code> ‖ left ‖ right). An odd last node is promoted
            unchanged. Fold the inclusion proof from <code>leaf_hash</code>, taking each sibling's side from the
            proof, and the result is the signed root.
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
