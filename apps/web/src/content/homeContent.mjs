/** Chit home copy. ChitHome.tsx and the static HTML generator both read this. */

export const HOME_SNIPPET_API = 'https://api.chit402.com/v1';

export const dropInSnippet = `import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';

const client = new x402Client();
registerExactEvmScheme(client, { signer: privateKeyToAccount(process.env.EVM_PRIVATE_KEY) });
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

const res = await fetchWithPayment('${HOME_SNIPPET_API}/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'xfuel/auto', messages: [{ role: 'user', content: 'Say hello in five words.' }] }),
});
const paid = await res.json();
console.log(paid.xfuel.verify_url); // signed receipt`;

export const partnerKeySnippet = `const res = await fetch('${HOME_SNIPPET_API}/chat/completions', {
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

export const homeContent = {
  h1: 'Who paid which call — and you still hold it.',
  lead: 'Treasury desk and spend ledger for agent teams — not a router dashboard.',
  description:
    'Every collected inference returns hub, model, amount, and a verify link you can export, policy, and evidence-pack. After you see the row, the possession book keeps last-N spend for the principal who funds the agent.',
  pricingHref: '/pricing',
  pricingLabel: 'Standard receipt $0.002 · routing cost + 1%',
  productsHref: '/products',
  productsLabel: 'Stamp · Private Desk · Attest',
  bookHref: '/book',
  bookLabel: 'Open the book',
  verifyLabel: 'Verify live receipt',
  dropInDocsHref: '/docs/chit-in-15-lines',
  dropInDocsLabel: 'Drop-in docs',
  checkYourself: 'Check it yourself:',
  checkLinks: [
    { href: '/check', label: 'Check a receipt', internal: true },
    { href: '/audit', label: 'Audit a wallet', internal: true },
    {
      href: 'https://api.chit402.com/v1/receipts/tree/head',
      label: "Today's receipt root, published on Base and Solana",
      internal: false,
    },
    { href: '/trust', label: 'Pin our issuer key', internal: true },
  ],
  ninetyTitle: '90-second drop-in',
  payPerCall: 'Pay per call (x402)',
  partnerKey: 'Partner API key',
  alsoWorksTitle: 'Also works',
  alsoWorksBody: 'Same possession book — secondary adapters and orchestration stacks.',
  adapters: [
    { href: '/docs/eliza', label: 'Eliza plugin' },
    { href: '/docs/cloudflare', label: 'Cloudflare' },
    { href: '/docs/acp', label: 'Virtuals ACP' },
    { href: '/docs/openclaw', label: 'OpenClaw' },
    { href: '/docs/swarm-platforms', label: 'Olas + Theoriq' },
    { href: '/docs/framework-adapters', label: 'Framework adapters' },
  ],
  rowTitle: 'The row stays with you',
  cards: [
    {
      heading: 'Spend ledger',
      body: 'Hub, model, and amount on every collected call — signed and third-party-verifiable.',
    },
    {
      heading: 'Portable',
      body: 'Move wallets, keep receipts. Register after USDC settle to hold the possession book.',
    },
    {
      heading: 'Quoted settle',
      body: 'HTTP 402 quotes before the call. USDC on Base and Solana. Receipt after settle.',
    },
  ],
  doorsHref: '/doors',
  doorsLabel: '/doors',
  publicVerifyLabel: 'public verify',
  footerLinks: [
    { href: '/trust', label: 'Trust', internal: true },
    { href: '/activity', label: 'Activity', internal: true },
    { href: '/audit', label: 'Audit', internal: true },
  ],
  githubLabel: 'GitHub',
};

export function ninetyLead(verifyUrl) {
  return [
    'Stamp who paid which call onto the possession book. Pay per call over x402 (HTTP 402, USDC on Base or Solana), or use a partner API key. Either path returns a signed receipt you can ',
    { link: { href: verifyUrl, label: homeContent.publicVerifyLabel, blank: true } },
    '. Install wires (chat clients, Eliza, ACP, MCP, peers): ',
    { link: { href: homeContent.doorsHref, label: homeContent.doorsLabel, internal: true } },
    '.',
  ];
}

export function homeStaticModel({ verifyUrl, githubUrl }) {
  return {
    h1: homeContent.h1,
    sections: [
      {
        paragraphs: [homeContent.lead, homeContent.description, homeContent.checkYourself],
        links: [
          { href: homeContent.pricingHref, label: homeContent.pricingLabel },
          { href: homeContent.productsHref, label: homeContent.productsLabel },
          { href: homeContent.bookHref, label: homeContent.bookLabel },
          { href: verifyUrl, label: homeContent.verifyLabel, blank: true },
          { href: homeContent.dropInDocsHref, label: homeContent.dropInDocsLabel },
          ...homeContent.checkLinks,
        ],
      },
      {
        heading: homeContent.ninetyTitle,
        paragraphs: [ninetyLead(verifyUrl)],
        cards: [
          { heading: homeContent.payPerCall, pre: [dropInSnippet] },
          { heading: homeContent.partnerKey, pre: [partnerKeySnippet] },
        ],
      },
      {
        heading: homeContent.alsoWorksTitle,
        paragraphs: [homeContent.alsoWorksBody],
        links: homeContent.adapters,
      },
      {
        heading: homeContent.rowTitle,
        cards: homeContent.cards,
      },
      {
        links: [
          { href: githubUrl, label: homeContent.githubLabel, blank: true },
          ...homeContent.footerLinks,
        ],
      },
    ],
  };
}
