/** Docs hub copy. Docs.tsx and the static HTML generator both read this. */

export const GITHUB = 'https://github.com/XFuel-Lab/chit402/blob/main';

export const sectionTitles = {
  start: 'Start here',
  news: "What's new",
  builders: 'Builders',
  operators: 'Operators',
  auditors: 'Auditors',
  probe: 'Probe the paid door',
};

export const openrouterKeepRouteTitle = 'Already pay OpenRouter? Keep your route';

const BROADCAST_WEBHOOK = 'https://api.chit402.com/v1/openrouter/broadcast';
const BROADCAST_GUIDE = 'https://github.com/XFuel-Lab/chit402/blob/main/docs/product/openrouter-broadcast.md';

export function openrouterKeepRouteParagraphs() {
  return [
    ["Chit's Broadcast receiver is on."],
    ["Steps from the Broadcast guide; we haven't yet run the full flow end to end on a fresh account."],
    [
      'Mint a book with ',
      { code: 'POST /v1/openrouter/books' },
      '. No wallet and no payment. The response returns book_id plus an ingest_key that is shown once.',
    ],
    [
      'In OpenRouter, enable Broadcast under Settings > Observability. Set the webhook URL to ',
      { code: BROADCAST_WEBHOOK },
      ' with header ',
      { code: 'Authorization: Bearer <ingest_key>' },
      '.',
    ],
    [
      'An optional key lets Chit check each generation against OpenRouter. Without an attached OpenRouter key they are marked "Reported via OpenRouter Broadcast (unverified)".',
    ],
    ['It covers new calls only, with no backfill of past calls.'],
    ['Receipts are on the reported rail.'],
    [
      'Reads are ',
      { code: 'GET /v1/openrouter/books/:book_id/receipts' },
      ', a JSON list of receipts. The cap is 200. Rows are not added to an agent\'s USDC spent total.',
    ],
    [
      'Guide: ',
      { link: { href: BROADCAST_GUIDE, label: 'docs/product/openrouter-broadcast.md', blank: true } },
      '.',
    ],
  ];
}

export const docsKicker = 'Documentation';

export function h1For(productName) {
  return `${productName} possession book`;
}

export const startHere = [
  {
    title: 'What the book is, and isn\'t',
    description: 'Collected vs client-attested, what a receipt proves, settled vs unsettled, daily anchors.',
    href: '/book#what-the-book-is',
    meta: 'book',
    internal: true,
  },
  {
    title: 'Products',
    description: 'Stamp, Private Desk, and Private + Attest — book-first seats and what you hold after settle.',
    href: '/products',
    meta: 'seats',
    internal: true,
  },
  {
    title: 'Chit in 15 lines',
    description: 'Fastest receipt path — pay USDC, collect verify_url, start the book.',
    href: '/docs/chit-in-15-lines',
    meta: 'start',
    internal: true,
  },
  {
    title: 'Spend audit',
    description: 'Paste a Base or Solana wallet. USDC out by counterparty, public receipt match, no signup. Incomplete scans show no total.',
    href: '/audit',
    meta: 'public',
    internal: true,
  },
  {
    title: '1F916 link (draft)',
    description: 'Draft v0. Specimen 1 and Specimen 2 are stamped listing payouts, with verify links.',
    href: '/docs/1f916-link',
    meta: 'draft',
    internal: true,
  },
  {
    title: 'Deployment',
    description: 'How to deploy the gateway, contracts, and prover.',
    href: `${GITHUB}/docs/DEPLOYMENT.md`,
    meta: 'ops',
    external: true,
  },
  {
    title: 'Positioning',
    description: 'Possession book story — who paid which call, evidence, and policy.',
    href: `${GITHUB}/docs/POSITIONING.md`,
    meta: 'story',
    external: true,
  },
  {
    title: 'Whitepaper',
    description: 'Protocol design: settlement, proofs, circuits, governance.',
    href: `${GITHUB}/WHITEPAPER.md`,
    meta: 'v2.6',
    external: true,
  },
];

export const builders = [
  {
    title: 'Private Spend',
    description: 'vendor_blind for possession sessions — topology privacy, not prompt encryption.',
    href: '/docs/private-spend',
    meta: 'product',
    internal: true,
  },
  {
    title: 'Escrow helper',
    description: 'Ledger escrow beside the book for high-value jobs. Settlement-tier escrow is paused while settlement proofs are unavailable.',
    href: `${GITHUB}/docs/product/escrow-helper.md`,
    meta: 'book',
    external: true,
  },
  {
    title: 'A2A escrow + machine dispute',
    description: 'Agent↔agent job_spec_hash flow on the book — open, fund, submit, release or challenge.',
    href: `${GITHUB}/docs/product/a2a-escrow-dispute-v1.md`,
    meta: 'book',
    external: true,
  },
  {
    title: 'M2M API',
    description: 'REST task submit, status, webhooks, quotes.',
    href: `${GITHUB}/docs/M2M_API.md`,
    meta: 'REST',
    external: true,
  },
  {
    title: 'USDC / x402',
    description: 'Payment rail for the book — agent-side USDC on Base or Solana.',
    href: `${GITHUB}/docs/X402_ADAPTER.md`,
    meta: 'x402',
    external: true,
  },
  {
    title: 'Cloudflare Monetization Gateway',
    description: 'Receipt for an x402 v2 call settled by Coinbase on Base. Evidence is foreign_ingest.',
    href: '/docs/cloudflare-x402',
    meta: 'x402',
    internal: true,
  },
  {
    title: 'Issuer trust',
    description: 'Current ES256 key, issuer history, and chit402-verify.',
    href: '/trust',
    meta: 'trust',
    internal: true,
  },
  {
    title: 'Receipt check',
    description: 'Recompute public receipt hashes and check the signed issuer key history.',
    href: '/docs/receipt-check',
    meta: 'verify',
    internal: true,
  },
  {
    title: 'Verify',
    description: 'Exit codes and the reason anchors chit402-verify prints.',
    href: '/docs/verify',
    meta: 'verify',
    internal: true,
  },
  {
    title: 'Install doors',
    description: 'Chat /v1 wire, Eliza, ACP, MCP, frameworks, Cloudflare, swarms — peers into the same book.',
    href: '/doors',
    meta: 'doors',
    internal: true,
  },
];

export function operatorsFor(apiDomain) {
  return [
    {
      title: 'Deployment',
      description: 'Base verifier, gateway, manifests.',
      href: `${GITHUB}/docs/DEPLOYMENT.md`,
      meta: 'deploy',
      external: true,
    },
    {
      title: 'Testing',
      description: 'Contract matrix, gateway tests, zkLLM cargo tests.',
      href: `${GITHUB}/docs/TESTING.md`,
      meta: '755+',
      external: true,
    },
    {
      title: 'Hosted API',
      description: `Public API at ${apiDomain}.`,
      href: `${GITHUB}/docs/CHAT_COMPLETIONS_GATEWAY.md`,
      meta: 'api',
      external: true,
    },
  ];
}

export const auditors = [
  {
    title: 'Responsible disclosure',
    description: 'Scope, safe harbour, and how findings are credited.',
    href: `${GITHUB}/docs/bug-bounty.md`,
    meta: 'security',
    external: true,
  },
  {
    title: 'Security design',
    description: 'Trust ladder and settlement surfaces.',
    href: `${GITHUB}/docs/security-design.md`,
    meta: 'model',
    external: true,
  },
];

export function introParts(apiDomain) {
  return [
    'The product is the book — who paid which call; hold ',
    { code: 'verify_url' },
    '; export, policy, and evidence. Install paths are how agents reach the same stamped receipts: ',
    { link: { href: '/doors', label: 'Install wires', internal: true } },
    '. No account. No API key. A wallet that can pay the 402 is enough. Register is only to hold the book after a collected receipt. Apache-2.0. Public beta at ',
    { code: apiDomain },
    '. Paying it is mainnet USDC.',
  ];
}

export function navLinks(apiHost) {
  return [
    { href: '/book', label: 'Principal book', internal: true },
    { href: '/trust', label: 'Trust', internal: true },
    { href: '/doors', label: 'Install wires → /doors', internal: true },
    { href: `${apiHost}/health`, label: 'API health', blank: true },
    { href: 'https://github.com/XFuel-Lab/chit402', label: 'GitHub', blank: true },
    { href: 'https://www.npmjs.com/package/chit402-sdk', label: 'npm SDK', blank: true },
    { href: `${GITHUB}/docs/bug-bounty.md`, label: 'Disclosure', blank: true },
    { href: '/products', label: 'Products', internal: true },
    { href: '/pricing', label: 'Pricing', internal: true },
    { href: '/security', label: 'Security', internal: true },
  ];
}

export function whatsNew(apiHost) {
  return [
    [
      { strong: '2026-09-30' },
      ' — the receipt root is published daily on Base and on Solana. The current head is ',
      { link: { href: `${apiHost}/v1/receipts/tree/head`, label: 'GET /v1/receipts/tree/head' } },
      '. chit402-verify 0.4.11 checks that anchor inside ',
      { code: 'npx chit402-verify "https://api.chit402.com/receipt/xfuel-3155b7d8-4315-44bc-bfdc-bf6b78ff2d15"' },
      '.',
    ],
    [
      { strong: '2026-10-06' },
      ' — the public receipt log is durable and tied to an epoch.',
    ],
    [
      { strong: '2026-10-03' },
      ' — a blocked spend can return a signed refusal (',
      { code: 'chit402.refusal.v1' },
      '). chit402-verify 0.4.11 checks a signed refusal with ',
      { code: 'npx chit402-verify' },
      ' and the refusal URL.',
    ],
    [
      { strong: '2026-10-04' },
      ' — public spend audit at ',
      { link: { href: '/audit', label: '/audit', internal: true } },
      '.',
    ],
    [
      { strong: '2026-10-04' },
      ' — hash preimages and signed issuer key history. Check them on ',
      { link: { href: '/docs/receipt-check', label: 'Receipt check', internal: true } },
      '. Published receipts from before the object was stored still return 404 on ',
      { code: '/preimage' },
      '.',
    ],
  ];
}

export function snippetFor(apiV1) {
  return `curl -sS -D - ${apiV1}/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{}'
# → HTTP 402 + PAYMENT-REQUIRED (USDC on Base or Solana)`;
}

export const sdkSnippet = `npm install chit402-sdk
# client.chatCompletions({ model: 'xfuel/auto', messages: [...] })`;

export function probeLead() {
  return [
    'Unauthenticated ',
    { code: 'POST /v1/chat/completions' },
    ' returns HTTP 402. Settle USDC, then retry with ',
    { code: 'X-PAYMENT' },
    ' for a signed receipt with ',
    { code: 'verify_url' },
    '. Bring your OpenRouter key, get a Chit receipt for every call. Send it as ',
    { code: 'X-OpenRouter-Key' },
    '. Chit charges the $0.002 receipt and records the model that served plus the OpenRouter-reported cost, labelled paid-by-caller-to-OpenRouter.',
  ];
}

export function probeBody() {
  return [
    'Each signed receipt carries hub, model, amount, and ',
    { code: 'verify_url' },
    '. Each call is charged a quoted price and gets a receipt, paid in USDC on Base or Solana. ',
    { code: 'GET|POST /v1/agents/:agent_id/book' },
    ' is possession-gated last-N collected spend. Tier-2 settlement proofs are off while we upgrade the proving system; standard $0.002 receipts are unaffected.',
  ];
}

export const sdkLabel = 'SDK (x402 payer):';

export function probeFoot() {
  return [
    'Lower-level M2M path: ',
    { code: 'POST /task-request' },
    '. Do not use ',
    { code: 'createMockPayer' },
    ' against this host. Windows: ',
    { code: 'curl.exe' },
    '.',
  ];
}

export function probeLinks() {
  return [
    { href: `${GITHUB}/packages/sdk/README.md`, label: 'SDK docs', blank: true, className: 'btn btn-primary btn-sm' },
    { href: '/doors', label: 'Install doors', internal: true, className: 'btn btn-secondary btn-sm' },
    { href: `${GITHUB}/docs/README.md`, label: 'Full docs hub', blank: true, className: 'btn btn-secondary btn-sm' },
  ];
}

function cardsOf(items) {
  return items.map((item) => ({
    heading: item.title,
    href: item.href,
    body: item.description,
    meta: item.meta,
    blank: item.external === true,
  }));
}

export function docsStaticModel(env) {
  return {
    h1: h1For(env.productName),
    sections: [
      {
        paragraphs: [docsKicker, introParts(env.apiDomain)],
        links: navLinks(env.apiHost),
      },
      {
        heading: openrouterKeepRouteTitle,
        flow: openrouterKeepRouteParagraphs().map((p) => ({ p })),
      },
      { heading: sectionTitles.start, cards: cardsOf(startHere) },
      { heading: sectionTitles.news, items: whatsNew(env.apiHost) },
      { heading: sectionTitles.builders, cards: cardsOf(builders) },
      { heading: sectionTitles.operators, cards: cardsOf(operatorsFor(env.apiDomain)) },
      { heading: sectionTitles.auditors, cards: cardsOf(auditors) },
      {
        heading: sectionTitles.probe,
        flow: [
          { p: probeLead() },
          { p: probeBody() },
          { pre: snippetFor(env.apiV1) },
          { p: sdkLabel },
          { pre: sdkSnippet },
          { p: probeFoot() },
          { links: probeLinks() },
        ],
      },
    ],
  };
}
