import { keylessChatSnippet, partnerKeySnippet } from '../lib/paidDoorSnippets';

/** Keyless x402 first. Partner API key stays beside it. */
export default function PaidDoorOptions({ apiV1 }: { apiV1: string }) {
  return (
    <>
      <h3 style={{ fontSize: '1rem', margin: '1rem 0 0.5rem' }}>Keyless x402</h3>
      <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        Pay the HTTP 402 in USDC on Base or Solana. No API key.
      </p>
      <pre className="docs-code">
        <code>{keylessChatSnippet(apiV1)}</code>
      </pre>
      <h3 style={{ fontSize: '1rem', margin: '1.25rem 0 0.5rem' }}>Partner API key</h3>
      <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        Supported. A partner <code>X-API-Key</code> skips the 402 on this host.
      </p>
      <pre className="docs-code">
        <code>{partnerKeySnippet(apiV1)}</code>
      </pre>
    </>
  );
}
