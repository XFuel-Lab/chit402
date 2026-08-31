/**
 * Post-build script to generate route-specific HTML files with unique titles.
 * Per WHITEPAPER Section 3.5: crawlers that fetch without JS must see unique titles.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'dist');

const ROUTE_TITLES = {
  '/agent-shop': 'The till for an agent shop | XFuel',
  '/book': 'The book: this agent spent Y on this job | XFuel',
  '/book-bot': 'Paste this. The shop gets a till | XFuel',
  '/v1': 'Pay /v1/chat/completions in $0.01 USDC | XFuel',
};

function replaceTitle(html, newTitle) {
  return html.replace(
    /<title>[^<]*<\/title>/,
    `<title>${newTitle}</title>`
  );
}

const indexHtml = readFileSync(join(distDir, 'index.html'), 'utf8');

for (const [route, title] of Object.entries(ROUTE_TITLES)) {
  const routeDir = join(distDir, route.slice(1));
  const routeHtml = join(routeDir, 'index.html');
  
  if (!existsSync(routeDir)) {
    mkdirSync(routeDir, { recursive: true });
  }
  
  const newHtml = replaceTitle(indexHtml, title);
  writeFileSync(routeHtml, newHtml);
  console.log(`✓ Generated ${route}/index.html with title: "${title}"`);
}

console.log('\n✅ Prerender complete: 4 route-specific HTML files generated.');
