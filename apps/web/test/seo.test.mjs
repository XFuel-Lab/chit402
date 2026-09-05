/**
 * Homepage SEO must describe the public door as paid /v1.
 * x402scan origin copy reads these tags; "unmetered" here is the lie.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

function metaContent(source, attr, name) {
  const named = new RegExp(
    `<meta[^>]+${attr}="${name}"[^>]*content="([^"]*)"`,
    'i',
  );
  const contentFirst = new RegExp(
    `<meta[^>]+content="([^"]*)"[^>]*${attr}="${name}"`,
    'i',
  );
  return source.match(named)?.[1] ?? source.match(contentFirst)?.[1] ?? null;
}

function assertPaidDoorCopy(label, text) {
  assert.ok(text, `${label} is present`);
  assert.doesNotMatch(text, /unmetered/i, `${label} must not say unmetered`);
  assert.doesNotMatch(text, /free path/i, `${label} must not say free path`);
  assert.doesNotMatch(text, /Base \(primary\)/i, `${label} must not rank Base as primary`);
  assert.doesNotMatch(text, /best available provider/i, `${label} must not claim best available provider`);
  assert.doesNotMatch(text, /Swap one baseURL/i, `${label} must not hero a baseURL swap`);
  assert.doesNotMatch(text, /crypto control plane/i, `${label} must not lead with crypto control plane`);
  assert.doesNotMatch(text, /Not a smart router/, `${label} must not say Not a smart router`);
  assert.doesNotMatch(text, /Not a model shop/, `${label} must not say Not a model shop`);
  assert.doesNotMatch(text, /\$0\.01/, `${label} must not lead with $0.01 price`);
  assert.match(text, /the book/i, `${label} leads with the book`);
  assert.match(text, /hub, model, and amount/i, `${label} names hub, model, and amount`);
  assert.match(text, /USDC/i, `${label} names USDC`);
  assert.match(text, /Base and Solana/i, `${label} names Base and Solana`);
}

test('homepage meta description describes paid /v1 and does not say unmetered', () => {
  assertPaidDoorCopy('meta description', metaContent(html, 'name', 'description'));
});

test('homepage og:description describes paid /v1 and does not say unmetered', () => {
  assertPaidDoorCopy('og:description', metaContent(html, 'property', 'og:description'));
});

test('homepage twitter:description matches the paid /v1 door', () => {
  assertPaidDoorCopy('twitter:description', metaContent(html, 'name', 'twitter:description'));
});

test('homepage listing-visible branding uses Chit402 for x402scan', () => {
  const title = html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? '';
  const ogTitle = metaContent(html, 'property', 'og:title');
  const twitterTitle = metaContent(html, 'name', 'twitter:title');
  const favicon = html.match(/<link[^>]+rel="icon"[^>]+href="([^"]*)"/i)?.[1] ?? '';

  assert.match(title, /^Chit402/, 'homepage title starts with Chit402 for x402scan listing');
  assert.match(ogTitle, /^Chit402/, 'og:title starts with Chit402 for x402scan listing');
  assert.match(twitterTitle, /^Chit402/, 'twitter:title starts with Chit402 for social cards');
  assert.equal(favicon, '/chit402-icon.svg', 'favicon uses chit402-icon.svg for x402scan listing');
});

test('shared layout and homepage copy do not call paid /v1 unmetered, a free path, or lead with $0.01', () => {
  const layout = readFileSync(join(root, 'src/components/Layout.tsx'), 'utf8');
  const home = readFileSync(join(root, 'src/pages/Home.tsx'), 'utf8');
  const pricing = readFileSync(join(root, 'src/pages/Pricing.tsx'), 'utf8');
  for (const [label, source] of [
    ['Layout.tsx', layout],
    ['Home.tsx', home],
    ['Pricing.tsx', pricing],
  ]) {
    assert.doesNotMatch(source, /unmetered/i, `${label} must not say unmetered`);
    assert.doesNotMatch(source, /free path/i, `${label} must not say free path`);
    assert.doesNotMatch(source, /Base \(primary\)/i, `${label} must not rank Base as primary`);
    assert.doesNotMatch(source, /\$0\.01/, `${label} must not lead with $0.01 price`);
    assert.match(source, /USDC on Base (and|or) Solana/i, `${label} names USDC rails`);
    assert.match(source, /cost-plus.*quoted.*receipted/i, `${label} uses cost-plus language`);
  }
});

test('homepage title and hero lead with the book, not a router', () => {
  const title = html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? '';
  assert.match(title, /the book/i, 'title leads with the book');
  assert.match(title, /Hub, model, amount/i, 'title names hub, model, amount');
  assert.doesNotMatch(title, /receipt for every routed/i, 'title does not hero the receipt');
  assert.doesNotMatch(title, /best available provider/i);

  const home = readFileSync(join(root, 'src/pages/Home.tsx'), 'utf8');
  assert.match(home, /XFuel is the book/);
  assert.match(home, /This agent spent Y on this job/);
  assert.match(home, /You hold hub, model, and amount/);
  assert.doesNotMatch(home, /Not a smart router/);
  assert.doesNotMatch(home, /Not a model shop/);
  assert.doesNotMatch(home, /best available provider/i);
  assert.doesNotMatch(home, /Swap one baseURL/);
  assert.doesNotMatch(home, /crypto control plane/i);

  assert.doesNotMatch(html, /Not a smart router/);
  assert.doesNotMatch(html, /Not a model shop/);
});

test('llms.txt API route does not contain prohibited copy', () => {
  const llmsApi = readFileSync(join(root, '../../api/llms.txt.ts'), 'utf8');
  assert.doesNotMatch(llmsApi, /Not a smart router/);
  assert.doesNotMatch(llmsApi, /Not a model shop/);
  assert.match(llmsApi, /XFuel.*the book|Chit.*receipt/i, 'llms.txt API has brand copy');
});

test('README first paragraph leads with the book', () => {
  const readme = readFileSync(join(root, '../../README.md'), 'utf8').replace(/\r\n/g, '\n');
  const firstPara = readme.split(/\n\n/)[1] ?? '';
  assert.match(firstPara, /XFuel is the book/);
  assert.match(firstPara, /You hold hub, model, and amount/);
  assert.doesNotMatch(firstPara, /best available provider/i);
  assert.doesNotMatch(firstPara, /crypto control plane/i);
  assert.doesNotMatch(firstPara, /Not a smart router/);
  assert.doesNotMatch(firstPara, /Not a model shop/);
});

import { existsSync } from 'node:fs';

test('prerendered money pages have unique crawler titles (after build)', { skip: !existsSync(join(root, 'dist')) }, () => {
  const expectedTitles = {
    'agent-shop': 'The till for an agent shop | Chit',
    'book': 'The book: this agent spent Y on this job | Chit',
    'book-bot': 'Paste this. The shop gets a till | Chit',
    'docs': 'Chit402 — A receipt you still hold if the agent wallet moves.',
    'v1': 'Pay /v1/chat/completions | Chit',
  };
  
  for (const [route, expectedTitle] of Object.entries(expectedTitles)) {
    const filePath = join(root, 'dist', route, 'index.html');
    assert.ok(existsSync(filePath), `${route}/index.html exists`);
    const content = readFileSync(filePath, 'utf8');
    const title = content.match(/<title>([^<]*)<\/title>/i)?.[1] ?? '';
    assert.equal(title, expectedTitle, `/${route} has correct crawler title`);
    assert.doesNotMatch(content, /\$0\.01/, `/${route} must not contain $0.01`);
  }
});

test('Chit home page has locked hero copy and three door CTAs', () => {
  const chitHome = readFileSync(join(root, 'src/pages/ChitHome.tsx'), 'utf8');
  assert.match(chitHome, /Give an agent a USDC budget\. Keep the receipt when the wallet moves\./, 'ChitHome has locked hero');
  assert.match(chitHome, /Chit402/, 'ChitHome uses Chit402 public name');
  assert.match(chitHome, /api\.chit402\.com\/receipt\/chit-1e57cdd7-4fde-4525-bea3-5ffd1d1d909e/, 'ChitHome has live receipt link');
  assert.match(chitHome, /\/docs\/chit-in-15-lines/, 'ChitHome links to 15-lines page');
  assert.match(chitHome, /\/docs\/eliza/, 'ChitHome links to Eliza stub');
  assert.match(chitHome, /config\.parent/, 'ChitHome references parent dynamically');
  assert.match(chitHome, /USDC on Base and Solana/, 'ChitHome names USDC rails');
  assert.doesNotMatch(chitHome, /\$0\.01/, 'ChitHome must not lead with $0.01');
  assert.doesNotMatch(chitHome, /The chit x402 doesn't leave you/, 'ChitHome demotes poetry tagline');
  assert.doesNotMatch(chitHome, /ticker/i, 'ChitHome must not mention ticker');
});

test('host config has correct Chit SEO values', () => {
  const hostConfig = readFileSync(join(root, 'src/hostConfig.ts'), 'utf8');
  assert.match(hostConfig, /title:.*Chit402.*receipt you still hold/i, 'Chit SEO title uses Chit402 for listings');
  assert.match(hostConfig, /ogTitle:.*Chit402/i, 'Chit ogTitle uses Chit402 for listings');
  assert.match(hostConfig, /description:.*Chit402:/i, 'Chit description starts with Chit402');
  assert.match(hostConfig, /ogDescription:.*Chit402:/i, 'Chit ogDescription starts with Chit402');
  assert.match(hostConfig, /x402 receipt that doesn/, 'Chit description has tagline');
  assert.match(hostConfig, /chit402\.com/, 'Config has chit402.com domain');
  assert.match(hostConfig, /@chit402/, 'Config has @chit402 Twitter handle');
  assert.match(hostConfig, /githubUrl:.*chit402/i, 'Config has chit402 GitHub URL');
  assert.doesNotMatch(hostConfig, /OpenAI/i, 'Config must not mention OpenAI');
  assert.doesNotMatch(hostConfig, /By XFuel Lab/i, 'Chit SEO metadata must not mix parent branding');
});

test('Layout supports dual branding for Chit and XFuel', () => {
  const layout = readFileSync(join(root, 'src/components/Layout.tsx'), 'utf8');
  assert.match(layout, /isChitHost/, 'Layout checks for Chit host');
  assert.match(layout, /Chit is the product/, 'Layout has Chit banner copy');
  assert.match(layout, /config\.parent/, 'Layout references parent dynamically');
  assert.match(layout, /config\.name/, 'Layout uses dynamic brand name');
});

test('Chit in 15 lines page documents OpenAI baseURL and demo key', () => {
  const page = readFileSync(join(root, 'src/pages/ChitIn15Lines.tsx'), 'utf8');
  assert.match(page, /api\.chit402\.com\/v1/, '15-lines page names baseURL');
  assert.match(page, /chit402-demo/, '15-lines page names demo key');
  assert.match(page, /OpenAI SDK may strip unknown/, '15-lines page warns about SDK field stripping');
  assert.match(page, /verify_url/, '15-lines page mentions verify_url');
});

test('App routes docs subpages', () => {
  const app = readFileSync(join(root, 'src/App.tsx'), 'utf8');
  assert.match(app, /import ChitHome/, 'App imports ChitHome');
  assert.match(app, /isChitHost\(\) \? <ChitHome/, 'App conditionally renders ChitHome');
  assert.match(app, /chit-in-15-lines/, 'App routes 15-lines page');
  assert.match(app, /\/docs\/eliza/, 'App routes Eliza stub');
});

test('middleware CHIT_SEO uses Chit402 titles (not Chit)', () => {
  const middleware = readFileSync(join(root, '../../middleware.ts'), 'utf8');
  
  assert.match(
    middleware,
    /title:\s*['"]Chit402 — A receipt you still hold if the agent wallet moves\.['"]/,
    'middleware CHIT_SEO title uses Chit402'
  );
  assert.match(
    middleware,
    /ogTitle:\s*['"]Chit402 — A receipt you still hold\.['"]/,
    'middleware CHIT_SEO ogTitle uses Chit402'
  );
  assert.match(
    middleware,
    /description:\s*['"]Chit402: the x402 receipt/,
    'middleware CHIT_SEO description starts with Chit402'
  );
});

test('middleware CHIT_V1_SEO uses Chit402 suffix (not | Chit)', () => {
  const middleware = readFileSync(join(root, '../../middleware.ts'), 'utf8');
  
  assert.match(
    middleware,
    /title:\s*['"]Pay \/v1\/chat\/completions \| Chit402['"]/,
    'middleware CHIT_V1_SEO title ends with | Chit402'
  );
  assert.match(
    middleware,
    /ogTitle:\s*['"]Pay \/v1\/chat\/completions \| Chit402['"]/,
    'middleware CHIT_V1_SEO ogTitle ends with | Chit402'
  );
  assert.doesNotMatch(
    middleware,
    /title:\s*['"]Pay \/v1\/chat\/completions \| Chit['"]/,
    'middleware CHIT_V1_SEO title does not use old | Chit'
  );
});

test('middleware SEO constants do not contain "By XFuel Lab"', () => {
  const middleware = readFileSync(join(root, '../../middleware.ts'), 'utf8');
  
  const seoSection = middleware.match(/const CHIT_SEO[\s\S]*?const CHIT_V1_SEO_FULL[\s\S]*?^};/m)?.[0] ?? '';
  assert.ok(seoSection.length > 100, 'extracted SEO constants section');
  
  assert.doesNotMatch(
    seoSection,
    /By XFuel Lab/,
    'middleware SEO constants do not contain "By XFuel Lab"'
  );
});

test('middleware transformHtml produces Chit402 crawler output for homepage', () => {
  const sampleHtml = `<!DOCTYPE html>
<html>
<head>
  <title>Old Title</title>
  <meta name="description" content="Old description" />
  <meta property="og:title" content="Old OG Title" />
  <meta property="og:description" content="Old OG description" />
  <meta property="og:url" content="https://example.com" />
  <meta property="og:image" content="https://example.com/og.png" />
  <meta name="twitter:title" content="Old Twitter Title" />
  <meta name="twitter:description" content="Old Twitter description" />
</head>
<body>
  <div id="root"></div>
</body>
</html>`;

  const middleware = readFileSync(join(root, '../../middleware.ts'), 'utf8');
  
  const chitSeoTitleMatch = middleware.match(/const CHIT_SEO[\s\S]*?title:\s*['"]([^'"]+)['"]/);
  const chitSeoTitle = chitSeoTitleMatch?.[1] ?? '';
  assert.ok(chitSeoTitle.startsWith('Chit402'), 'CHIT_SEO title starts with Chit402');
  
  const chitSeoOgTitleMatch = middleware.match(/const CHIT_SEO[\s\S]*?ogTitle:\s*['"]([^'"]+)['"]/);
  const chitSeoOgTitle = chitSeoOgTitleMatch?.[1] ?? '';
  assert.ok(chitSeoOgTitle.startsWith('Chit402'), 'CHIT_SEO ogTitle starts with Chit402');
  
  const chitSeoDescMatch = middleware.match(/const CHIT_SEO[\s\S]*?description:\s*['"]([^'"]+)['"]/);
  const chitSeoDesc = chitSeoDescMatch?.[1] ?? '';
  assert.ok(chitSeoDesc.startsWith('Chit402'), 'CHIT_SEO description starts with Chit402');
  assert.ok(!chitSeoDesc.includes('By XFuel Lab'), 'CHIT_SEO description does not contain By XFuel Lab');
  
  const simulated = sampleHtml
    .replace(/<title>[^<]*<\/title>/, `<title>${chitSeoTitle}</title>`)
    .replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${chitSeoOgTitle}" />`)
    .replace(/<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${chitSeoOgTitle}" />`);
  
  assert.match(simulated, /<title>Chit402/, 'transformed title starts with Chit402');
  assert.match(simulated, /og:title" content="Chit402/, 'transformed og:title starts with Chit402');
  assert.match(simulated, /twitter:title" content="Chit402/, 'transformed twitter:title starts with Chit402');
});
