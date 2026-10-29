/** Pricing copy. Pricing.tsx and the static HTML generator both read this. */

const linkStyle = { color: '#00d4ff', textDecoration: 'none' };
const strongLight = { color: '#f0f0f5', fontWeight: 600 };
const strongMuted = { color: '#d0d0dc' };

function link(href, label, internal) {
  return { link: { href, label, internal, style: internal ? linkStyle : undefined } };
}

export function pricingModel(apiV1) {
  const origin = apiV1.replace(/\/v1$/, '');
  const tier2Off =
    'Tier-2 settlement proofs are off while we upgrade the proving system; standard $0.002 receipts are unaffected.';
  const tier2 =
    'Tier-2 settlement proof: +$0.10 per proof. Currently unavailable while we upgrade the proving system; standard $0.002 receipts are unaffected.';
  return {
    h1: 'Pay for a collected hop.',
    kicker: 'Pricing',
    intro: [
      'Chit is the book — not a router shop. The standard receipt and provider routing are priced separately from hub COGS — quoted, receipted — USDC on Base and Solana. ',
      link('/products', 'See products → /products', true),
      '.',
    ],
    clarityLabel: 'Standard receipt (every hop)',
    clarityAmount: '$0.002 USDC',
    clarityParagraphs: [
      [
        'One flat stamp for the treasury desk: HTTP 402 quote, USDC settle on Base or Solana, and a signed receipt with ',
        { code: 'verify_url' },
        '. Anyone can run ',
        { code: 'npx chit402-verify' },
        ' on that URL. Some receipts return COULD_NOT_CHECK (exit 2), which means not checked, not invalid. Bigger jobs do not make the receipt harder or more expensive — the standard receipt stays $0.002 unless our unit cost changes.',
      ],
      [
        'Provider inference is billed at ',
        { strong: 'cost + 1%', style: strongLight },
        ' (platform fee 100 bps on provider COGS). Hub, model, and upstream USDC are pass-through plus that routing fee. Network fees on your chain are yours. Without payment or a partner key, ',
        { code: `POST ${apiV1}/chat/completions` },
        ' returns HTTP 402. Bring your OpenRouter key, get a Chit receipt for every call. Send ',
        { code: 'X-OpenRouter-Key' },
        ' (or ',
        { code: 'Authorization' },
        ' on an ',
        { code: 'openrouter/' },
        ' route). Chit charges this $0.002 receipt. Inference is paid by you to OpenRouter, and the receipt labels that cost paid-by-caller-to-OpenRouter. Familiar names stay on the open-model book.',
      ],
      [
        'Possession-gated book ingest costs a ',
        { strong: '$0.002', style: strongLight },
        ' stamp (2000 atomic USDC, 6 decimals), paid by the submitter via x402 on Base or Solana. The stamp is not debited from prepaid budget. A pilot waiver is off unless an operator lists partner keys. Cemented Nano (XNO) sends can be stamped on the same door.',
      ],
      [
        { strong: 'Private Desk', style: strongLight },
        ' — vendor-blind routing at the same ',
        { strong: 'cost + 1%', style: strongLight },
        ' door; Tier-1 signed receipt with ',
        { code: 'privacy.mode=vendor_blind' },
        '. Gateway-trusted spend privacy — not prompt-private, not trustless ZK. Request with ',
        { code: 'xfuel.privacy_product: private_desk' },
        ' (or enable Private Spend on your gateway allowlist).',
      ],
      [
        { strong: 'Private + Attest', style: strongLight },
        ': ',
        tier2Off,
        ' ',
        tier2.replace('; standard $0.002 receipts are unaffected.', '.'),
      ],
    ],
    columns: [
      {
        title: 'Included on the hop',
        items: [
          'Signed receipt naming hub, model, and amount',
          [
            'Anyone can run ',
            { code: 'npx chit402-verify' },
            ' on the public ',
            { code: 'verify_url' },
            '. COULD_NOT_CHECK (exit 2) means not checked, not invalid.',
          ],
          'USDC on Base and Solana (chain-neutral x402)',
          'Quoted settle before the call completes',
        ],
      },
      {
        title: 'Separate from Chit',
        items: [
          'Provider / hub inference price (pass-through COGS + 1% routing)',
          'Your wallet and chain network costs',
          'Partner key billing (if you use one instead of x402)',
        ],
      },
      {
        title: 'How quoting works',
        items: [
          [
            'First request without payment → HTTP 402 with atomic USDC amount (standard receipt ',
            { code: '2000' },
            ' = $0.002, plus provider COGS + 1% when applicable)',
          ],
          ['Retry with ', { code: 'X-PAYMENT' }, ' after USDC settle, or send a partner API key'],
          ['Live discovery: ', link(`${origin}/.well-known/x402`, '/.well-known/x402', false)],
        ],
      },
    ],
    valueTitle: 'Value-add (optional)',
    valueItems: [
      [
        { strong: 'Private Desk', style: strongMuted },
        ' — cost + 1% vendor-blind routing (allowlist / explicit product; not the default public door)',
      ],
      [{ strong: 'Private + Attest', style: strongMuted }, ': ', tier2],
      [
        { strong: 'Spend guarantee', style: strongMuted },
        ' — parked; not available to buy yet',
      ],
    ],
    valueNote:
      'Volume and premier stamp houses win because the receipt is flat and boring — high throughput does not inflate the per-hop stamp.',
    enterTitle: 'How you enter',
    enterBody: [
      'The product is the possession book — who paid which call, holdable after settle. Pay the quoted USDC (HTTP 402 on Base or Solana, or a partner ',
      { code: 'X-API-Key' },
      '), hold the signed receipt with ',
      { code: 'verify_url' },
      '. After you register, ',
      link('/book', '/book', true),
      ' keeps last-N spend. Install wires (chat clients, Eliza, ACP, MCP, peers): ',
      link('/doors', '/doors', true),
      '.',
    ],
    ctas: [
      { href: '/doors', label: 'Install doors', variant: 'primary' },
      { href: '/book', label: 'Open the book', variant: 'secondary' },
    ],
    footnote: [
      'Legacy measured-task wire (',
      { code: '/task-request' },
      ') works the same way, with the fee based on our cost plus a margin, on a different path — prefer ',
      { code: apiV1 },
      ' for new installs.',
    ],
  };
}

export function pricingStaticModel(env) {
  const copy = pricingModel(env.apiV1);
  return {
    h1: copy.h1,
    sections: [
      {
        paragraphs: [copy.kicker, copy.intro],
      },
      {
        heading: copy.clarityAmount,
        paragraphs: [copy.clarityLabel, ...copy.clarityParagraphs],
      },
      {
        cards: copy.columns.map((column) => ({
          heading: column.title,
          items: column.items,
        })),
      },
      {
        heading: copy.valueTitle,
        items: copy.valueItems,
        paragraphs: [copy.valueNote],
      },
      {
        heading: copy.enterTitle,
        paragraphs: [copy.enterBody],
        links: copy.ctas,
      },
      {
        paragraphs: [copy.footnote],
      },
    ],
  };
}
