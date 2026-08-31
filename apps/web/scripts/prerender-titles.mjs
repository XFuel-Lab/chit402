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
    title: 'The till for an agent shop | XFuel',
    h1: 'Your SEO bot spent it. You hold the book.',
    lede: 'XFuel is the till for an agent shop. Paste https://api.xfuel.app/v1 as the OpenAI baseURL, pay the HTTP 402 in $0.01 USDC on Base or Solana, and you hold the book. We are the till, not the Chief of SEO. Show the client the book, not a screenshot.',
  },
  '/book': {
    title: 'The book: this agent spent Y on this job | XFuel',
    h1: 'This agent spent Y on this job.',
    lede: 'XFuel is the book. Differentiator vs Hive / ComputeSeal / Paid.ai: a held book of hub + model + amount after collected USDC, not a FinOps CSV. Demo never writes the book.',
  },
  '/book-bot': {
    title: 'Paste this. The shop gets a till | XFuel',
    h1: 'Paste this. The shop gets a till.',
    lede: 'Paste this prompt into Grok, ChatGPT, or any agent. It interviews your stack once, then every job you run records agent / job / $Y / settled y/n by pointing your OpenAI baseURL at https://api.xfuel.app/v1.',
  },
  '/v1': {
    title: 'Pay /v1/chat/completions in $0.01 USDC | XFuel',
    h1: 'OpenAI drop-in. Wallet pays. You hold the book.',
    lede: 'Exact product: baseURL https://api.xfuel.app/v1. POST /v1/chat/completions is $0.01 USDC on Base and Solana. Without payment or a demo key, the gateway returns HTTP 402.',
  },
};

function truncateDescription(text, maxLen = 155) {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3).replace(/\s+\S*$/, '') + '...';
}

function transformHtml(html, { title, h1, lede }) {
  const description = truncateDescription(lede);
  
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
      /<meta name="twitter:title" content="[^"]*" \/>/,
      `<meta name="twitter:title" content="${title}" />`
    )
    .replace(
      /<meta name="twitter:description" content="[^"]*" \/>/,
      `<meta name="twitter:description" content="${description}" />`
    );

  const crawlerBlock = `
  <noscript>
    <article style="max-width:640px;margin:2rem auto;padding:1rem;font-family:system-ui,sans-serif;">
      <h1>${h1}</h1>
      <p>${lede}</p>
    </article>
  </noscript>
  <div id="crawler-content" style="position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;" aria-hidden="true">
    <h1>${h1}</h1>
    <p>${lede}</p>
  </div>`;

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
  
  const newHtml = transformHtml(indexHtml, content);
  writeFileSync(routeHtml, newHtml);
  console.log(`✓ Generated ${route}/index.html`);
  console.log(`  Title: "${content.title}"`);
  console.log(`  H1: "${content.h1}"`);
}

console.log('\n✅ Prerender complete: 4 route-specific HTML files with crawler content.');
