/**
 * Post-build script to generate route-specific HTML files with unique titles,
 * meta descriptions, and crawler-visible H1 + lede content.
 * Per WHITEPAPER Section 3.5: crawlers that fetch without JS must see unique titles
 * and content (H1 + first ~150 words).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'dist');

const ROUTE_CONTENT = {
  '/agent-shop': {
    title: 'The till for an agent shop | Chit',
    h1: 'Your SEO bot spent it. You hold the book.',
    lede: 'Chit is the till for an agent shop. Paste https://api.chit402.com/v1 as the OpenAI baseURL, pay the HTTP 402 in USDC on Base or Solana (cost-plus, quoted, receipted), and you hold the book. We are the till, not the Chief of SEO. Show the client the book, not a screenshot.',
  },
  '/docs': {
    title: 'Chit — A receipt you still hold if the agent wallet moves.',
    h1: 'Build on Chit',
    lede: 'Chit: the x402 receipt that doesn\'t leave you. Hub, model, amount — you hold the book. No account. No API key. A wallet that can pay the 402 is enough. Public beta at api.chit402.com. USDC on Base and Solana.',
  },
  '/book': {
    title: 'The book: this agent spent Y on this job | Chit',
    h1: 'This agent spent Y on this job.',
    lede: 'Chit is the book. Differentiator vs Hive / ComputeSeal / Paid.ai: a held book of hub + model + amount after collected USDC, not a FinOps CSV. Demo never writes the book.',
  },
  '/book-bot': {
    title: 'Paste this. The shop gets a till | Chit',
    h1: 'Paste this. The shop gets a till.',
    lede: 'Paste this prompt into Grok, ChatGPT, or any agent. It interviews your stack once, then every job you run records agent / job / $Y / settled y/n by pointing your OpenAI baseURL at https://api.chit402.com/v1.',
  },
  '/v1': {
    title: 'Pay /v1/chat/completions | Chit',
    h1: 'Bot drop-in. Wallet pays. You hold the book.',
    lede: 'Exact product: baseURL https://api.chit402.com/v1. POST /v1/chat/completions is cost-plus, quoted, receipted — USDC on Base and Solana. Without payment or a demo key, the gateway returns HTTP 402.',
  },
};

function truncateDescription(text, maxLen = 155) {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3).replace(/\s+\S*$/, '') + '...';
}

function transformHtml(html, route, { title, h1, lede }) {
  const description = truncateDescription(lede);
  const canonicalUrl = `https://www.chit402.com${route}`;
  const ogImage = 'https://www.chit402.com/og-image.png';
  
  let result = html
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(
      /<meta name="description" content="[^"]*" \/>/,
      `<meta name="description" content="${description}" />`
    )
    .replace(
      /<meta property="og:title" content="[^"]*" \/>/,
      `<meta property="og:title" content="${title}" />`
    )
    .replace(
      /<meta property="og:description" content="[^"]*" \/>/,
      `<meta property="og:description" content="${description}" />`
    )
    .replace(
      /<meta property="og:url" content="[^"]*" \/>/,
      `<meta property="og:url" content="${canonicalUrl}" />`
    )
    .replace(
      /<meta property="og:image" content="[^"]*" \/>/,
      `<meta property="og:image" content="${ogImage}" />`
    )
    .replace(
      /<meta name="twitter:title" content="[^"]*" \/>/,
      `<meta name="twitter:title" content="${title}" />`
    )
    .replace(
      /<meta name="twitter:description" content="[^"]*" \/>/,
      `<meta name="twitter:description" content="${description}" />`
    );

  const canonicalLink = `<link rel="canonical" href="${canonicalUrl}" />`;
  result = result.replace(/<\/head>/, `  ${canonicalLink}\n</head>`);

  const crawlerBlock = `
  <noscript>
    <article style="max-width:640px;margin:2rem auto;padding:1rem;font-family:system-ui,sans-serif;">
      <h1>${h1}</h1>
      <p>${lede}</p>
    </article>
  </noscript>`;

  result = result.replace(
    /<div id="root"><\/div>/,
    `<div id="root"></div>${crawlerBlock}`
  );

  return result;
}

const indexHtml = readFileSync(join(distDir, 'index.html'), 'utf8');

for (const [route, content] of Object.entries(ROUTE_CONTENT)) {
  const routeDir = join(distDir, route.slice(1));
  const routeHtml = join(routeDir, 'index.html');
  
  if (!existsSync(routeDir)) {
    mkdirSync(routeDir, { recursive: true });
  }
  
  const newHtml = transformHtml(indexHtml, route, content);
  writeFileSync(routeHtml, newHtml);
  console.log(`✓ Generated ${route}/index.html`);
  console.log(`  Title: "${content.title}"`);
  console.log(`  H1: "${content.h1}"`);
}

console.log('\n✅ Prerender complete: 5 route-specific HTML files with crawler content.');
