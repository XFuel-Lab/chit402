import { Link } from 'react-router-dom';
import type { CSSProperties } from 'react';
import { LIVE_RECEIPT_TASK_ID, LIVE_RECEIPT_VERIFY_URL } from '../lib/liveReceiptSpecimen';

const GITHUB_SPEC = 'https://github.com/XFuel-Lab/chit402/blob/main/docs/integrations/1f916-link-v0.md';
const POST = 'https://1f916.ai/post/7404';
const POST_JSON = 'https://1f916.ai/api/post/7404';
const DRAFT = 'https://datatracker.ietf.org/doc/draft-maintainer-1f916-agent-record/';
const JWKS = 'https://api.chit402.com/.well-known/jwks.json';
const JWKS_ALIAS = 'https://api.xfuel.app/.well-known/jwks.json';
const KID = 'IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q';

const receiptJson = `${LIVE_RECEIPT_VERIFY_URL}?format=json`;
const SPECIMEN_PATH = '/specimens/1f916-link-1.json';
const FALSIFIER_PATH = '/specimens/1f916-link-1-tampered.json';
const SPECIMEN_URL = `https://www.chit402.com${SPECIMEN_PATH}`;
const FALSIFIER_URL = `https://www.chit402.com${FALSIFIER_PATH}`;
const ENTRY_EVENT_ID = 20498;
const ENTRY_FINGERPRINT = 'a09e1e0b0aed6a7826b55281ef1e8af19fb164034a662d122adaa503b54f7dc2';
const ENTRY_RECORD_URL = 'https://1f916.ai/api/record/chit402';
const TX_HASH = '0xf63ed6a83106d84a04b18a53ebbd73ff4c1fce280ec1a6035c5bdc2bed283f6f';
const VERIFIER_SCRIPT = 'scripts/verify-1f916-link.mjs';

const verifyCli = `curl -sS "${receiptJson}" -o receipt.json
npx xfuel-verify receipt.json --fetch-jwks --check-payer

# A facilitator (or any other issuer) publishes its own key.
# --fetch-jwks allowlists api.chit402.com; pass that issuer's JWKS explicitly:
# npx xfuel-verify receipt.json --jwks-url "https://<issuer-origin>/.well-known/jwks.json" --check-payer

# Specimen 1, including the entry fingerprint. The falsifier must fail that step.
node ${VERIFIER_SCRIPT} ${SPECIMEN_URL}
node ${VERIFIER_SCRIPT} ${FALSIFIER_URL}`;

const specimenEntry = `{
  "chit_receipt_id": "${LIVE_RECEIPT_TASK_ID}",
  "chit_verify_url": "${receiptJson}",
  "agent_record_entry": {
    "schema": "chit402.agent_record_entry.v0",
    "signed": false,
    "registry": "1f916",
    "fingerprint": "${ENTRY_FINGERPRINT}",
    "fingerprint_alg": "1f916-entry-hash"
  }
}`;

const receiptPlaceholder = `"agent_record_entry": {
  "schema": "chit402.agent_record_entry.v0",
  "signed": false,
  "registry": "1f916",
  "fingerprint": "${ENTRY_FINGERPRINT}",
  "fingerprint_alg": "1f916-entry-hash"
}`;

export default function OneF916Link() {
  return (
    <div className="page docs-page">
      <div className="container" style={{ maxWidth: 720 }}>
        <header className="page-header">
          <span className="docs-kicker">Draft v0, feedback welcome</span>
          <h1>1F916 Agent Record link</h1>
          <p>
            <strong>Draft v0, feedback welcome.</strong> An Agent Record entry that moves money
            can carry a Chit receipt id, and the receipt can carry that entry&apos;s fingerprint, so
            one offline check covers the instruction and the money. Proposed on 1F916 as{' '}
            <a href={POST} target="_blank" rel="noreferrer">post 7404</a>
            {' '}(<a href={POST_JSON} target="_blank" rel="noreferrer">JSON</a>).
          </p>
        </header>

        <div className="docs-panel">
          <h2>Issuance support is coming</h2>
          <p>
            This page is the field contract. Chit402 does not stamp{' '}
            <code>agent_record_entry</code> on receipts yet. A receipt fetched today will not
            contain the field. Payment signatures stay as they are.
          </p>
          <p style={styles.note}>
            Spec: <a href={GITHUB_SPEC} target="_blank" rel="noreferrer">docs/integrations/1f916-link-v0.md</a>.
            Agent Record draft:{' '}
            <a href={DRAFT} target="_blank" rel="noreferrer">draft-maintainer-1f916-agent-record</a>
            {' '}(text reviewed: draft-01, 12 August 2026).
          </p>
        </div>

        <div className="docs-panel">
          <h2>Entry side (1F916)</h2>
          <ul style={styles.list}>
            <li>
              <code>chit_receipt_id</code> (string). The id <code>GET /receipt/:id</code> accepts.
              On Chit402 that is the <code>chit-…</code> id in <code>verify_url</code>.
            </li>
            <li>
              <strong>Optional</strong> on an entry that does not move money.
            </li>
            <li>
              <strong>Required</strong> when the entry asserts that a payment happened (a
              money-moving entry).
            </li>
            <li>
              A money-moving entry without it is <strong>unverified payment claim</strong>, not
              invalid. The Agent Record entry stays valid. This draft does not ask the registry
              to reject the write.
            </li>
            <li>
              <code>chit_verify_url</code> (string, optional). Absolute URL of the receipt. When
              it is absent, a Chit402 id resolves at{' '}
              <code>GET https://api.chit402.com/receipt/&lt;chit_receipt_id&gt;?format=json</code>.
            </li>
          </ul>
          <p style={styles.note}>
            An entry asserts a payment when it claims value moved: a settled transfer, a paid
            call, or a payout. A quote, a discussion, or an unpaid intention leaves{' '}
            <code>chit_receipt_id</code> optional.
          </p>
        </div>

        <div className="docs-panel">
          <h2>Receipt side (Chit)</h2>
          <p>
            <code>agent_record_entry</code> sits beside <code>book_seq</code>. It is unsigned, the
            same posture as <code>receipt_lane</code> (<code>signed: false</code>). The payment
            JWS has a fixed claim set. <code>book_chain</code> (<code>chit402.book_seq.v1</code>)
            is its own signed object. This draft adds an unsigned sibling and leaves payment{' '}
            <code>payload_version</code> unchanged.
          </p>
          <pre className="docs-code">
            <code>{receiptPlaceholder}</code>
          </pre>
          <ul style={styles.list}>
            <li>
              <code>registry</code> is <code>1f916</code>.
            </li>
            <li>
              <code>fingerprint</code> is the entry&apos;s hash. draft-01 names that hash (each
              event carries the hash of its predecessor; the Merkle tree covers the sealed
              events&apos; hashes) and uses JCS (RFC 8785) for JSON. It does not publish the
              hash preimage and does not define a field named <code>fingerprint</code>.
            </li>
            <li>
              When the entry already carries the registry&apos;s published entry hash, use it and
              set <code>fingerprint_alg</code> to <code>1f916-entry-hash</code>.
            </li>
            <li>
              Otherwise the fingerprint is <strong>provisional</strong>: lowercase hex SHA-256
              of the JCS canonical form of the entry,{' '}
              <code>fingerprint_alg: provisional-sha256-jcs</code>. When the draft names the
              preimage, verifiers use that algorithm.
            </li>
          </ul>
        </div>

        <div className="docs-panel">
          <h2>Issuer</h2>
          <p>
            <code>issuer_signature</code> is who signed the receipt. <code>kid</code> is the
            RFC 7638 thumbprint. The JWS <code>iss</code> claim is the issuer&apos;s name.
          </p>
          <p>
            Today Chit402 issues. Live receipts use <code>iss</code> <code>chit402</code> and
            kid <code style={styles.mono}>{KID}</code>. The published key is:
          </p>
          <ul style={styles.list}>
            <li>
              <a href={JWKS} target="_blank" rel="noreferrer">{JWKS}</a>
            </li>
            <li>
              <a href={JWKS_ALIAS} target="_blank" rel="noreferrer">{JWKS_ALIAS}</a>
            </li>
          </ul>
          <p>
            The schema is issuer-agnostic. A facilitator, or any other party, is the issuer
            when it signs this same receipt format and publishes the verifying key at{' '}
            <code>https://&lt;issuer-origin&gt;/.well-known/jwks.json</code>. Verification
            matches <code>issuer_signature.kid</code> to that key, then checks the chain.
            The <code>iss</code> string is a label. Embedded <code>issuer_jwk</code> is not a
            trust root unless its thumbprint equals a key you already pinned. See{' '}
            <Link to="/trust" style={{ color: '#00d4ff' }}>Issuer trust</Link>.
          </p>
        </div>

        <div className="docs-panel">
          <h2>Who issues the receipt</h2>
          <p>
            Chit issues the receipt. <code>issuer_signature</code> is Chit&apos;s ES256 signature
            over the settlement the facilitator returned after it broadcast the transfer. The
            agent does not sign that object.
          </p>
          <p>
            The facilitator response supplies the transaction hash, the network, and the payer.
            Chit writes those into the signed claims: <code>payment.ref</code> is{' '}
            <code>&lt;network&gt;:&lt;tx hash&gt;</code>, and <code>caller_binding.payer_wallet</code>{' '}
            is that payer. <code>PAYMENT-RESPONSE</code> and <code>X-PAYMENT-RESPONSE</code> carry
            the same three facts.
          </p>
          <p>
            Facilitator bodies differ. Coinbase CDP returns <code>transaction</code>. Other settle
            bodies use <code>txHash</code> for the same field. PayAI settles Solana. A self-hosted
            facilitator returns <code>{'{ success, transaction, network, payer }'}</code>. Chit
            reads <code>transaction</code> or <code>txHash</code>, and <code>payer</code>, and
            writes one receipt plus one <code>PAYMENT-RESPONSE</code>:{' '}
            <code>success</code>, <code>transaction</code>, a CAIP-2 <code>network</code>, and{' '}
            <code>payer</code>.
          </p>
          <p style={styles.note}>
            A third party checks the signature against the JWKS, then checks that transaction
            on the chain named in the receipt.
          </p>
        </div>

        <div className="docs-panel">
          <h2>Verify path</h2>
          <ol style={styles.list}>
            <li>
              Fetch the receipt by id:{' '}
              <code>GET /receipt/:id?format=json</code>
              {', or '}
              <code>chit_verify_url</code> when the entry sets it.
            </li>
            <li>
              Verify <code>issuer_signature.jws</code> (ES256) against the JWKS entry whose{' '}
              <code>kid</code> matches. Chit402 publishes that key at{' '}
              <a href={JWKS} target="_blank" rel="noreferrer">{JWKS}</a>.
            </li>
            <li>
              Read payer (<code>caller_binding.payer_wallet</code>), payee (
              <code>payment.payee</code>), asset (<code>payment.asset</code>), and amount (
              <code>payment.gross_amount</code>) from the verified claims. On Base, the USDC{' '}
              <code>Transfer</code> in <code>payment.ref</code> from that payer to that payee
              must sum to at least the amount. The unsigned outer copy has to agree with the
              verified claims.
            </li>
            <li>
              For <code>1f916-entry-hash</code>, compare{' '}
              <code>agent_record_entry.fingerprint</code> to the hash the registry publishes on
              that log entry. For <code>provisional-sha256-jcs</code>, hash the JCS form of the
              entry and compare. <code>registry</code> is <code>1f916</code>.
            </li>
          </ol>
          <p>
            <code>xfuel-verify</code> runs the signature and the chain check on a receipt file.
            It does not compare the fingerprint. <code>{VERIFIER_SCRIPT}</code> prints PASS or
            FAIL for the receipt fetch, the signature, the book chain, the Base transfer, and
            the entry fingerprint. The receipt JSON still omits <code>agent_record_entry</code>;
            the specimen file carries it.
          </p>
          <pre className="docs-code">
            <code>{verifyCli}</code>
          </pre>
        </div>

        <div className="docs-panel">
          <h2>Specimen 1</h2>
          <p>
            Specimen 1 is a real identity-log entry and a real settled receipt. Download{' '}
            <a href={SPECIMEN_PATH}>{SPECIMEN_URL}</a>.
            The falsifier, same pair with the fingerprint one nibble off, is{' '}
            <a href={FALSIFIER_PATH}>{FALSIFIER_URL}</a>.
            Re-run both with <code>{VERIFIER_SCRIPT}</code>.
          </p>
          <ul style={styles.list}>
            <li>
              Entry: handle <code>chit402</code>, identity log event{' '}
              <code>{ENTRY_EVENT_ID}</code> (<code>listing</code>). Published hash{' '}
              <code style={styles.mono}>{ENTRY_FINGERPRINT}</code>.{' '}
              <a href={ENTRY_RECORD_URL} target="_blank" rel="noreferrer">{ENTRY_RECORD_URL}</a>.
            </li>
            <li>
              <code>GET /api/mandates?citizen=chit402</code> is empty, and so are memory seals.
              Event {ENTRY_EVENT_ID} is the sealed row. It carries no <code>chit_receipt_id</code>.
              This file is the published link.
            </li>
            <li>
              Receipt <a href={receiptJson} target="_blank" rel="noreferrer"><code style={styles.mono}>{LIVE_RECEIPT_TASK_ID}</code></a>
              {' '}(<code style={styles.mono}>xfuel-1ebc5616-d9ce-4da9-b56c-847062ff6b96</code>).
              Base tx <code style={styles.mono}>{TX_HASH}</code>, 2000 atomic USDC,
              payer <code style={styles.mono}>0x253695Ff2DAa549980D9181B962d042B73A5e499</code>,
              payee <code style={styles.mono}>0x23f713411c30BBd9A989c9cbC22EB0b55F7f7334</code>.
            </li>
            <li>
              The listing and the receipt are different acts. The specimen binds the published
              hash to the receipt so a third party can re-check both, including the falsifier.
              The listing text does not name this payment.
            </li>
            <li>
              JWS <code>iss</code> is <code>chit402</code>. <code>book_seq</code> is 1.{' '}
              <code>receipt_lane.signed</code> is false. The live receipt JSON omits{' '}
              <code>agent_record_entry</code>.
            </li>
          </ul>
          <pre className="docs-code">
            <code>{specimenEntry}</code>
          </pre>
        </div>

        <p style={{ textAlign: 'center', color: '#8a8a9a', fontSize: '0.9rem', marginTop: '2rem' }}>
          <Link to="/docs" style={{ color: '#8a8a9a' }}>Docs index</Link>
          {' · '}
          <Link to="/docs/chit-in-15-lines" style={{ color: '#8a8a9a' }}>Chat /v1 wire</Link>
          {' · '}
          <Link to="/trust" style={{ color: '#8a8a9a' }}>Issuer trust</Link>
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  list: { color: '#c8c8d4', lineHeight: 1.65, paddingLeft: '1.25rem' },
  mono: { fontSize: '0.78rem', wordBreak: 'break-all' },
  note: {
    marginTop: '0.75rem',
    fontSize: '0.9rem',
    color: '#8a8a9a',
    lineHeight: 1.6,
  },
};
