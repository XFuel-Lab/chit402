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
    title: 'Chit402 — treasury desk for agent spend',
    h1: 'Build on Chit',
    lede: 'Treasury desk for agent spend — who paid which call; export, policy, evidence. Possession book for principals. No account. No API key. A wallet that can pay the 402 is enough. Public beta at api.chit402.com. USDC on Base and Solana.',
  },
  '/docs/chit-in-15-lines': {
    title: 'Chit in 15 lines | Chit402',
    h1: 'Chit in 15 lines',
    lede: 'Point any chat-completions client at https://api.chit402.com/v1. Demo key chit402-demo skips payment — no wallet, no USDC. Paid calls return a collected receipt with verify_url.',
  },
  '/docs/eliza': {
    title: 'Eliza plugin | Chit402',
    h1: 'Eliza plugin',
    lede: '@xfuel/plugin-elizaos routes Eliza TEXT_SMALL/LARGE through Chit402 with USDC budget caps and collected verify_url receipts.',
  },
  '/docs/framework-adapters': {
    title: 'LangChain + AI SDK | Chit402',
    h1: 'Framework adapters',
    lede: 'Swap baseURL to api.chit402.com/v1, pay USDC on Base, hold verify_url. Thin helpers for LangChain ChatOpenAI and Vercel AI SDK createOpenAI.',
  },
  '/docs/langchain': {
    title: 'LangChain adapter | Chit402',
    h1: 'LangChain adapter',
    lede: 'createChitChatOpenAI pointed at api.chit402.com/v1 with demo or paid key. Extract verify_url from xfuel extension or headers.',
  },
  '/docs/ai-sdk': {
    title: 'Vercel AI SDK adapter | Chit402',
    h1: 'AI SDK adapter',
    lede: 'createChit wrapper for Vercel AI SDK — same Chit baseURL, USDC budget, verify_url receipt.',
  },
  '/docs/cloudflare': {
    title: 'Cloudflare Agents | Chit402',
    h1: 'Cloudflare Agents',
    lede: 'Point Workers at api.chit402.com/v1 or run chit402-sidecar to stamp receipts from any upstream.',
  },
  '/docs/openclaw': {
    title: 'OpenClaw skill | Chit402',
    h1: 'OpenClaw',
    lede: 'Pasteable OpenClaw SKILL.md — baseURL swap, USDC caps, return verify_url to the principal.',
  },
  '/docs/acp': {
    title: 'Virtuals ACP | Chit402',
    h1: 'Virtuals ACP',
    lede: 'Keep ACP settle for agent commerce; route inference through Chit for hub, model, amount, verify_url.',
  },
  '/docs/swarm-platforms': {
    title: 'Olas + Theoriq | Chit402',
    h1: 'Swarm platforms',
    lede: 'Olas and Theoriq runners — same beachhead: chat-completions baseURL swap, USDC budget, hold verify_url.',
  },
  '/docs/olas': {
    title: 'Olas | Chit402',
    h1: 'Olas',
    lede: 'Point OpenAI-compatible clients at api.chit402.com/v1. Hold verify_url — no deep Olas fork.',
  },
  '/docs/theoriq': {
    title: 'Theoriq | Chit402',
    h1: 'Theoriq',
    lede: 'Swarm orchestration stays yours; Chit402 is the inference receipt book.',
  },
  '/docs/private-spend': {
    title: 'Private Spend | Chit402',
    h1: 'Private Spend',
    lede: 'vendor_blind mode for possession sessions. Providers see gateway traffic, not buyer topology. Gateway-trusted — not prompt encryption.',
  },
  '/book': {
    title: 'Principal book — spend dashboard | Chit',
    h1: 'This agent spent Y on this job.',
    lede: 'Possession-gated spend dashboard for the principal who funds agents. Budget cap, burn rate, model mix, and last-N collected rows from GET|POST /v1/agents/:agent_id/book. Not a public index.',
  },
  '/register': {
    title: 'Register agent — hold the book | Chit402',
    h1: 'Hold the book after a paid call',
    lede: 'Bind an agent wallet to a collected receipt via POST /v1/agents/register. Receive agent_id and possession session for GET|POST /v1/agents/:agent_id/book. Demo receipts do not qualify.',
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

console.log(`\n✅ Prerender complete: ${Object.keys(ROUTE_CONTENT).length} route-specific HTML files with crawler content.`);
