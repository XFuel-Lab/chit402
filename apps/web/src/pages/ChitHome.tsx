import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { getApiV1 } from '../apiHost';
import { getHostConfig } from '../hostConfig';
import LiveReceiptCard from '../components/LiveReceiptCard';
import { LIVE_RECEIPT_VERIFY_URL } from '../lib/liveReceiptSpecimen';

const apiV1 = 'https://api.chit402.com/v1';

type DropInDoor = 'x402' | 'key';

const dropInSnippet = `import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';

const client = new x402Client();
registerExactEvmScheme(client, { signer: privateKeyToAccount(process.env.EVM_PRIVATE_KEY) });
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

const res = await fetchWithPayment('${apiV1}/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'xfuel/auto', messages: [{ role: 'user', content: 'Say hello in five words.' }] }),
});
const paid = await res.json();
console.log(paid.xfuel.verify_url); // signed receipt`;

const partnerKeySnippet = `const res = await fetch('${apiV1}/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': process.env.CHIT402_API_KEY,
  },
  body: JSON.stringify({
    model: 'xfuel/auto',
    messages: [{ role: 'user', content: 'Say hello in five words.' }],
  }),
});
const paid = await res.json();
console.log(paid.xfuel.verify_url); // signed receipt`;

export default function ChitHome() {
  const config = getHostConfig();
  const resolvedApiV1 = getApiV1();

  return (
    <div className="page">
      <section style={styles.hero}>
        <div className="container chit-hero-wrap">
          <div className="chit-hero-grid">
            <div className="chit-hero-copy">
              <h1 style={styles.heroTitle}>Who paid which call — and you still hold it.</h1>
              <p style={styles.heroLead}>
                Treasury desk and spend ledger for agent teams — not a router dashboard.
              </p>
              <p style={styles.heroDescription}>
                Every collected inference returns hub, model, amount, and a verify link you can
                export, policy, and evidence-pack. After you see the row, the possession book keeps
                last-N spend for the principal who funds the agent.
              </p>
              <p style={styles.pricingChip}>
                <Link to="/pricing" style={styles.pricingChipLink}>
                  Standard receipt $0.002 · routing cost + 1%
                </Link>
                {' · '}
                <Link to="/products" style={styles.pricingChipLink}>
                  Stamp · Private Desk · Attest
                </Link>
              </p>
              <div style={styles.heroCta}>
                <Link to="/book" className="btn btn-primary">
                  Open the book
                </Link>
                <a
                  href={LIVE_RECEIPT_VERIFY_URL}
                  className="btn btn-secondary"
                  target="_blank"
                  rel="noreferrer"
                >
                  Verify live receipt
                </a>
                <Link to="/docs/chit-in-15-lines" className="btn btn-secondary">
                  Drop-in docs
                </Link>
              </div>
              <p style={styles.checkYourself}>
                Check it yourself:{' '}
                <Link to="/audit" style={styles.checkLink}>Audit a Base wallet</Link>
                {' · '}
                <a href="https://api.chit402.com/v1/receipts/tree/head" style={styles.checkLink}>
                  Today&apos;s receipt root, published on Base and Solana
                </a>
                {' · '}
                <Link to="/trust" style={styles.checkLink}>Pin our issuer key</Link>
              </p>
            </div>
            <LiveReceiptCard />
          </div>

          <div className="chit-ninety-door card">
            <h2 style={styles.ninetyTitle}>90-second drop-in</h2>
            <p style={styles.ninetyLead}>
              Stamp who paid which call onto the possession book. Pay per call over x402
              (HTTP 402, USDC on Base or Solana), or use a partner API key. Either path
              returns a signed receipt you can{' '}
              <a href={LIVE_RECEIPT_VERIFY_URL} target="_blank" rel="noreferrer">public verify</a>.
              Install wires (chat clients, Eliza, ACP, MCP, peers):{' '}
              <Link to="/doors">/doors</Link>.
            </p>
            <DropInSamples apiUrl={resolvedApiV1} />
          </div>
        </div>
      </section>

      <section style={{ padding: '2rem 0' }}>
        <div className="container" style={{ maxWidth: 720 }}>
          <h2 style={{ marginBottom: '0.5rem', textAlign: 'center', fontSize: '1.25rem' }}>
            Also works
          </h2>
          <p
            style={{
              textAlign: 'center',
              color: '#8a8a9a',
              fontSize: '0.95rem',
              marginBottom: '1.25rem',
              lineHeight: 1.6,
            }}
          >
            Same possession book — secondary adapters and orchestration stacks.
          </p>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.75rem',
              justifyContent: 'center',
            }}
          >
            <Link to="/docs/eliza" className="btn btn-secondary btn-sm">
              Eliza plugin
            </Link>
            <Link to="/docs/cloudflare" className="btn btn-secondary btn-sm">
              Cloudflare
            </Link>
            <Link to="/docs/acp" className="btn btn-secondary btn-sm">
              Virtuals ACP
            </Link>
            <Link to="/docs/openclaw" className="btn btn-secondary btn-sm">
              OpenClaw
            </Link>
            <Link to="/docs/swarm-platforms" className="btn btn-secondary btn-sm">
              Olas + Theoriq
            </Link>
            <Link to="/docs/framework-adapters" className="btn btn-secondary btn-sm">
              Framework adapters
            </Link>
          </div>
        </div>
      </section>

      <section style={{ padding: '1rem 0 3rem' }}>
        <div className="container" style={{ maxWidth: 720 }}>
          <h2 style={{ marginBottom: '1.5rem', textAlign: 'center' }}>The row stays with you</h2>
          <div className="grid grid-3" style={{ gap: '1.5rem' }}>
            <div className="card">
              <h3>Spend ledger</h3>
              <p>Hub, model, and amount on every collected call — signed and stranger-verifiable.</p>
            </div>
            <div className="card">
              <h3>Portable</h3>
              <p>Move wallets, keep receipts. Register after USDC settle to hold the possession book.</p>
            </div>
            <div className="card">
              <h3>Quoted settle</h3>
              <p>HTTP 402 quotes before the call. USDC on Base and Solana. Receipt after settle.</p>
            </div>
          </div>
        </div>
      </section>

      <section style={{ padding: '2rem 0 4rem' }}>
        <div className="container" style={{ maxWidth: 720, textAlign: 'center' }}>
          <p style={{ color: '#8a8a9a', fontSize: '0.95rem' }}>
            <a
              href={config.githubUrl}
              target="_blank"
              rel="noreferrer"
              style={{ color: '#00d4ff' }}
            >
              GitHub
            </a>
            {' · '}
            <Link to="/trust" style={{ color: '#00d4ff' }}>
              Trust
            </Link>
            {' · '}
            <Link to="/activity" style={{ color: '#00d4ff' }}>
              Activity
            </Link>
            {' · '}
            <Link to="/audit" style={{ color: '#00d4ff' }}>
              Audit
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  hero: {
    padding: '4rem 0 2.5rem',
    background: 'radial-gradient(ellipse at 50% 0%, rgba(0,212,255,0.08) 0%, transparent 60%)',
  },
  heroTitle: {
    fontSize: 'clamp(2rem, 4vw, 2.75rem)',
    fontWeight: 800,
    lineHeight: 1.15,
    marginBottom: '0.75rem',
  },
  heroLead: {
    fontSize: '1.2rem',
    color: '#f0f0f5',
    marginBottom: '1rem',
    fontWeight: 600,
    lineHeight: 1.4,
  },
  heroDescription: {
    fontSize: '1rem',
    color: '#8a8a9a',
    maxWidth: '36rem',
    marginBottom: '1rem',
    lineHeight: 1.7,
  },
  pricingChip: {
    marginBottom: '1.25rem',
    fontSize: '0.92rem',
  },
  pricingChipLink: {
    display: 'inline-block',
    padding: '0.35rem 0.75rem',
    borderRadius: '999px',
    border: '1px solid rgba(0,212,255,0.35)',
    background: 'rgba(0,212,255,0.06)',
    color: '#a5f3fc',
    textDecoration: 'none',
    fontWeight: 600,
  },
  heroCta: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    flexWrap: 'wrap' as const,
  },
  checkYourself: {
    marginTop: '0.9rem',
    marginBottom: 0,
    fontSize: '0.85rem',
    color: '#8a8a9a',
    lineHeight: 1.6,
  },
  checkLink: {
    color: '#00d4ff',
    textDecoration: 'none',
  },
  ninetyTitle: {
    fontSize: '1.1rem',
    marginBottom: '0.5rem',
  },
  ninetyLead: {
    color: '#8a8a9a',
    fontSize: '0.92rem',
    lineHeight: 1.65,
    marginBottom: '0.85rem',
  },
  ninetyTabs: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '0.5rem',
    marginBottom: '0.75rem',
  },
  ninetyTab: {
    fontFamily: 'inherit',
    fontSize: '0.85rem',
    fontWeight: 600,
    padding: '0.4rem 0.8rem',
    borderRadius: '999px',
    border: '1px solid rgba(255,255,255,0.16)',
    background: 'transparent',
    color: '#d0d0dc',
    cursor: 'pointer',
  },
  ninetyTabOn: {
    fontFamily: 'inherit',
    fontSize: '0.85rem',
    fontWeight: 600,
    padding: '0.4rem 0.8rem',
    borderRadius: '999px',
    border: '1px solid rgba(0,212,255,0.45)',
    background: 'rgba(0,212,255,0.1)',
    color: '#a5f3fc',
    cursor: 'pointer',
  },
};

function DropInSamples({ apiUrl }: { apiUrl: string }) {
  const [door, setDoor] = useState<DropInDoor>('x402');
  const snippet = (door === 'x402' ? dropInSnippet : partnerKeySnippet).replace(apiV1, apiUrl);
  const tabId = door === 'x402' ? 'drop-in-x402' : 'drop-in-key';

  return (
    <>
      <div role="tablist" aria-label="How you pay the drop-in" style={styles.ninetyTabs}>
        <button
          type="button"
          role="tab"
          id="drop-in-x402"
          aria-selected={door === 'x402'}
          aria-controls="drop-in-panel"
          style={door === 'x402' ? styles.ninetyTabOn : styles.ninetyTab}
          onClick={() => setDoor('x402')}
        >
          Pay per call (x402)
        </button>
        <button
          type="button"
          role="tab"
          id="drop-in-key"
          aria-selected={door === 'key'}
          aria-controls="drop-in-panel"
          style={door === 'key' ? styles.ninetyTabOn : styles.ninetyTab}
          onClick={() => setDoor('key')}
        >
          Partner API key
        </button>
      </div>
      <pre
        className="docs-code chit-ninety-code"
        role="tabpanel"
        id="drop-in-panel"
        aria-labelledby={tabId}
      >
        <code>{snippet}</code>
      </pre>
    </>
  );
}
