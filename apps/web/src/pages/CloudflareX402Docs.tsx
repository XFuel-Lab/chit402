import { Link } from 'react-router-dom';

const ingestExample = `POST /v1/agents/<agent_id>/book/ingest
X-Xfuel-Session: <session>

{
  "session": "<session>",
  "payment_required": {
    "resource": "https://seller.example/v1/resource",
    "amount": "10000",
    "payTo": "0x…",
    "network": "eip155:8453"
  },
  "payment_response": {
    "success": true,
    "transaction": "0x…",
    "network": "eip155:8453",
    "payer": "0x…"
  }
}`;

export default function CloudflareX402Docs() {
  return (
    <div className="page docs-page">
      <div className="container" style={{ maxWidth: 720 }}>
        <header className="page-header">
          <span className="docs-kicker">x402</span>
          <h1>Cloudflare Monetization Gateway</h1>
          <p>
            Pay an API behind Cloudflare&apos;s Monetization Gateway with any x402 client.
            Keep the <code>PAYMENT-RESPONSE</code> header and POST it to Chit. You get a{' '}
            <code>verify_url</code>. Cloudflare&apos;s settlement stays where it is.
          </p>
        </header>

        <div className="docs-panel">
          <h2>What you are holding</h2>
          <p>
            Monetization Gateway is x402 v2, closed beta. It verifies the payment and
            settles it through Coinbase&apos;s x402 facilitator in USDC on Base
            (<code>eip155:8453</code>). Buyers and sellers must be US-based.
          </p>
          <p>
            The Chit row is evidence <code>foreign_ingest</code>. Chit checked the Base
            USDC transfer and recorded hub, path, amount, and tx. Chit did not route
            the payment and did not settle it.
          </p>
        </div>

        <div className="docs-panel">
          <h2>Buyer recipe</h2>
          <p>
            Pay the gated URL. Read <code>PAYMENT-RESPONSE</code> (base64 JSON:{' '}
            <code>success</code>, <code>transaction</code>, <code>network</code>,{' '}
            <code>payer</code>). POST it with the resource, atomic amount, and{' '}
            <code>payTo</code> from the 402 challenge. The ingest door then asks for
            its own $0.002 stamp. Keep <code>verify_url</code> from the 201.
          </p>
          <pre className="docs-code">
            <code>{ingestExample}</code>
          </pre>
          <p>
            <code>transaction</code> is stored as the tx hash. <code>eip155:8453</code>{' '}
            is stored as <code>base</code>, so the book ref is <code>base:0x…</code>.
            For an <code>exact</code> price, post the challenge amount. For{' '}
            <code>upto</code>, post the amount that moved on-chain. A figure above the
            Transfer is rejected.
          </p>
        </div>

        <div className="docs-panel">
          <h2>Where to copy it from</h2>
          <p>
            Agent skill, section &quot;Paying Cloudflare-gated APIs&quot;:{' '}
            <code>skills/chit402-receipt/SKILL.md</code>. The OpenClaw skill carries
            the same recipe. Worker template that pays, then sets{' '}
            <code>X-Chit-Receipt</code> to the verify URL:{' '}
            <code>examples/cloudflare-x402-chit-receipt/</code>.
          </p>
        </div>

        <div className="docs-actions">
          <a
            href="https://github.com/XFuel-Lab/chit402/blob/main/skills/chit402-receipt/SKILL.md"
            target="_blank"
            rel="noreferrer"
            className="btn btn-primary btn-sm"
          >
            Receipt skill
          </a>
          <a
            href="https://github.com/XFuel-Lab/chit402/tree/main/examples/cloudflare-x402-chit-receipt"
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary btn-sm"
          >
            Worker template
          </a>
          <Link to="/docs/cloudflare" className="btn btn-secondary btn-sm">
            Cloudflare Agents
          </Link>
        </div>
      </div>
    </div>
  );
}
