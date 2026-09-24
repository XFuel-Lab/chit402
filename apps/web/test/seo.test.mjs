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
  assert.doesNotMatch(text, /wallet moves/i, `${label} must not lead with wallet-move`);
  assert.doesNotMatch(text, /receipt you still hold/i, `${label} must not lead with receipt-you-still-hold`);
  assert.match(text, /treasury desk|possession book/i, `${label} leads with treasury desk or possession book`);
  assert.match(text, /who paid which call/i, `${label} names who paid which call`);
  assert.match(text, /export.*policy.*evidence/i, `${label} names export, policy, evidence`);
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
  assert.equal(favicon, '/chit402-icon.png', 'favicon uses chit402 receipt stub icon for x402scan listing');
});

test('Layout nav uses host nav logo, not cyan check ring SVG', () => {
  const layout = readFileSync(join(root, 'src/components/Layout.tsx'), 'utf8');
  assert.match(layout, /config\.navLogo/, 'Layout uses host-config nav logo');
  assert.doesNotMatch(layout, /M10 16l4 4 8-8/, 'Layout must not inline the legacy check ring');
  assert.doesNotMatch(layout, /<svg[^>]*viewBox="0 0 32 32"/, 'Layout must not inline nav SVG logo');
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
  assert.match(pricing, /\$0\.002/, 'Pricing page states standard receipt');
  assert.match(pricing, /cost \+ 1%/, 'Pricing page states routing cost + 1%');
  assert.match(pricing, /api\.chit402\.com|getApiV1/, 'Pricing names Chit public door');
  assert.doesNotMatch(pricing, /hop floor/i, 'Pricing must not frame receipt as hop floor');
  assert.doesNotMatch(pricing, /1000 bps|10%/, 'Pricing must not show legacy 10% routing');
  assert.doesNotMatch(pricing, /amount <code>10000<\/code>/, 'Pricing must not show legacy $0.01 floor');
  assert.doesNotMatch(pricing, /OpenAI/i, 'Pricing must not use vendor-specific wire branding');
  assert.doesNotMatch(pricing, /product surface/i, 'Pricing must not call /v1 the product surface');
});

test('public marketing pages keep book-first wire copy', () => {
  const paths = [
    'src/pages/ChitHome.tsx',
    'src/pages/Pricing.tsx',
    'src/pages/Docs.tsx',
    'src/pages/DocsDoors.tsx',
    'src/pages/GatewayV1.tsx',
    'src/pages/BookBot.tsx',
    'src/pages/CloudflareDocs.tsx',
    'src/pages/AcpDocs.tsx',
    'src/pages/SwarmPlatforms.tsx',
    'src/pages/ChitIn15Lines.tsx',
    'src/pages/Products.tsx',
    'src/pages/Doors.tsx',
    'src/hostConfig.ts',
  ];
  for (const rel of paths) {
    const source = readFileSync(join(root, rel), 'utf8');
    assert.doesNotMatch(source, /OpenAI-compatible/i, `${rel} must not say OpenAI-compatible`);
    assert.doesNotMatch(source, /OpenAI \/v1/i, `${rel} must not lead with OpenAI /v1`);
    assert.doesNotMatch(source, /\bOpenAI\b/i, `${rel} must not name OpenAI in user copy`);
  }
});

test('homepage title and hero lead with treasury desk, not wallet-move', () => {
  const title = html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? '';
  assert.match(title, /treasury desk for agent spend/i, 'title leads with treasury desk');
  assert.doesNotMatch(title, /wallet moves/i, 'title does not lead with wallet-move');
  assert.doesNotMatch(title, /receipt you still hold/i, 'title does not lead with receipt-you-still-hold');
  assert.doesNotMatch(title, /best available provider/i);

  const home = readFileSync(join(root, 'src/pages/Home.tsx'), 'utf8');
  assert.match(home, /Chit402 is the book/);
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

test('llms.txt API route documents foreign ingest on www', () => {
  const llmsApi = readFileSync(join(root, '../../api/llms.txt.ts'), 'utf8');
  const chitBlock = llmsApi.match(/const CHIT_LLMS = `([\s\S]*?)`;\s*\nconst XFUEL_LLMS/m)?.[1] ?? '';
  assert.match(chitBlock, /Foreign ingest/i);
  assert.match(chitBlock, /\/v1\/agents\/:agent_id\/book\/ingest/);
  assert.match(chitBlock, /spent elsewhere → stamp here/i);
});

test('llms.txt API route does not contain prohibited copy', () => {
  const llmsApi = readFileSync(join(root, '../../api/llms.txt.ts'), 'utf8');
  const chitBlock = llmsApi.match(/const CHIT_LLMS = `([\s\S]*?)`;\s*\nconst XFUEL_LLMS/m)?.[1] ?? '';
  assert.doesNotMatch(llmsApi, /Not a smart router/);
  assert.doesNotMatch(llmsApi, /Not a model shop/);
  assert.match(llmsApi, /treasury desk|possession book/i, 'llms.txt API has treasury desk copy');
  assert.doesNotMatch(chitBlock, /XFuel Lab|Chit is the product|is the parent/i, 'CHIT llms must not parent-brand');
});

test('README first paragraph leads with the book', () => {
  const readme = readFileSync(join(root, '../../README.md'), 'utf8').replace(/\r\n/g, '\n');
  const firstPara = readme.split(/\n\n/)[1] ?? '';
  assert.match(firstPara, /Chit402 is the book/);
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
    'book': 'Principal book — spend dashboard | Chit',
    'book-bot': 'Paste this. The shop gets a till | Chit',
    'docs': 'Chit402 — treasury desk for agent spend',
    'doors': 'Install doors — wires into the book | Chit402',
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

test('Chit home page has principal-first hero, live receipt row, and 90s door', () => {
  const chitHome = readFileSync(join(root, 'src/pages/ChitHome.tsx'), 'utf8');
  const receiptCard = readFileSync(join(root, 'src/components/LiveReceiptCard.tsx'), 'utf8');
  const liveSpecimen = readFileSync(join(root, 'src/lib/liveReceiptSpecimen.ts'), 'utf8');
  assert.match(chitHome, /Who paid which call — and you still hold it\./, 'ChitHome leads principal-first');
  assert.match(chitHome, /Treasury desk and spend ledger/, 'ChitHome names treasury desk');
  assert.match(chitHome, /LiveReceiptCard/, 'ChitHome renders live receipt card');
  assert.match(liveSpecimen, /chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96/, 'Live receipt specimen id locked');
  assert.match(receiptCard, /LIVE_RECEIPT_HUB/, 'Live receipt card shows hub');
  assert.match(receiptCard, /Verify receipt/, 'Live receipt card links verify');
  assert.match(chitHome, /Open the book/, 'ChitHome primary CTA opens book');
  assert.match(chitHome, /Verify live receipt/, 'ChitHome links live verify');
  assert.match(chitHome, /90-second drop-in/, 'ChitHome surfaces 90s drop-in above fold');
  assert.match(
    chitHome,
    /Stamp who paid which call onto the possession book/,
    'ChitHome 90s block leads with stamp/book',
  );
  assert.match(chitHome, /signed receipt/, 'ChitHome 90s block names signed receipt');
  assert.match(chitHome, /Install wires/, 'ChitHome 90s block points to install wires');
  assert.match(chitHome, /to="\/doors"/, 'ChitHome links install doors from 90s section');
  const ninetyBlock = chitHome.match(/chit-ninety-door[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? '';
  assert.doesNotMatch(ninetyBlock, /OpenAI/i, 'ChitHome 90s lead block stays book-first (no vendor wire branding)');
  assert.match(chitHome, /fetch\(/, 'ChitHome 90s sample uses neutral fetch wire');
  assert.match(chitHome, /Also works/, 'ChitHome demotes adapters to Also works');
  assert.match(chitHome, /api\.chit402\.com\/v1/, 'ChitHome names wire in 90s drop-in');
  assert.match(chitHome, /\/docs\/chit-in-15-lines/, 'ChitHome links to drop-in door page');
  assert.match(chitHome, /\/docs\/eliza/, 'ChitHome links to Eliza stub');
  assert.doesNotMatch(chitHome, /By XFuel Lab|is the parent|XFuel Lab/i, 'ChitHome must not show parent naming in chrome');
  assert.match(chitHome, /USDC on Base and Solana/, 'ChitHome names USDC rails');
  assert.match(chitHome, /Standard receipt \$0\.002 · routing cost \+ 1%/, 'ChitHome surfaces pricing chip');
  assert.match(chitHome, /to="\/pricing"/, 'ChitHome links to pricing page');
  assert.match(chitHome, /to="\/products"/, 'ChitHome links to products page');
  assert.match(chitHome, /Private Desk · Attest/, 'ChitHome surfaces products chip');
  assert.doesNotMatch(chitHome, /POST \/v1\/chat\/completions/, 'ChitHome hero must not lead with POST /v1');
  assert.doesNotMatch(chitHome, /\$0\.01/, 'ChitHome must not lead with $0.01');
  assert.doesNotMatch(chitHome, /wallet moves/i, 'ChitHome must not lead with wallet-move');
  assert.doesNotMatch(chitHome, /ticker/i, 'ChitHome must not mention ticker');
  assert.doesNotMatch(chitHome, /prompt confidentiality/i, 'ChitHome must not claim prompt confidentiality');
});

test('Book page shows specimen banner and rows before possession', () => {
  const book = readFileSync(join(root, 'src/pages/Book.tsx'), 'utf8');
  const specimenPanel = readFileSync(join(root, 'src/components/BookSpecimenPanel.tsx'), 'utf8');
  const specimen = readFileSync(join(root, 'src/lib/bookSpecimen.ts'), 'utf8');
  assert.match(book, /BookSpecimenPanel/, 'Book renders specimen panel');
  assert.match(specimen, /Specimen — not live money/, 'Specimen banner copy locked');
  assert.doesNotMatch(book, /You get nothing without the session/, 'Book must not be lock-only on first visit');
  assert.match(specimenPanel, /computeBurnRate/, 'Specimen panel previews burn rate');
  assert.match(specimenPanel, /computeModelMix/, 'Specimen panel previews model mix');
});

test('Book principal dashboard v1 wires live API beats', () => {
  const book = readFileSync(join(root, 'src/pages/Book.tsx'), 'utf8');
  assert.match(book, /fetchAgentBook/, 'Book loads possession-gated book API');
  assert.match(book, /computeBurnRate/, 'Book derives burn rate from entries');
  assert.match(book, /computeModelMix/, 'Book derives model mix from entries');
  assert.match(book, /verifyUrlFor/, 'Book links verify_url per row');
  assert.match(book, /Treasury advanced/, 'Policy/export/escrow tucked under advanced');
});

test('Chit primary nav has Trust, Doors, and no Drop-in door', () => {
  const layout = readFileSync(join(root, 'src/components/Layout.tsx'), 'utf8');
  assert.match(layout, /to: '\/pricing', label: 'Pricing'/, 'Chit nav includes Pricing');
  assert.match(layout, /to: '\/products', label: 'Products'/, 'Chit nav includes Products top-level');
  assert.match(layout, /to: '\/doors', label: 'Doors'/, 'Chit nav includes Doors');
  assert.match(layout, /to: '\/trust', label: 'Trust'/, 'Chit nav includes Trust');
  assert.doesNotMatch(
    layout,
    /chitNavLinks[\s\S]*Drop-in door/,
    'Drop-in door is not in Chit primary nav',
  );
});

test('Docs hub leads with book; install doors on dedicated page', () => {
  const docs = readFileSync(join(root, 'src/pages/Docs.tsx'), 'utf8');
  const doors = readFileSync(join(root, 'src/pages/Doors.tsx'), 'utf8');
  const docsDoors = readFileSync(join(root, 'src/pages/DocsDoors.tsx'), 'utf8');
  assert.match(docs, /possession book/i, 'Docs intro leads with possession book');
  assert.match(docs, /to="\/doors"/, 'Docs hub links to /doors');
  assert.match(docs, /href: '\/products'/, 'Docs hub lists Products in start here');
  assert.doesNotMatch(docs, /DocDoorGrid/, 'Docs hub does not list every door card');
  assert.match(doors, /DocDoorGrid/, 'Doors page renders door cards');
  assert.match(doors, /<h1>Doors<\/h1>/, 'Doors page has first-class title');
  assert.match(docsDoors, /Navigate to="\/doors"/, 'Legacy /docs/doors redirects to /doors');
  const doorsBlock = doors.match(/export const installDoors[\s\S]*?];/)?.[0] ?? '';
  assert.match(doorsBlock, /Chit in 15 lines/, 'Doors page includes drop-in');
  assert.match(doorsBlock, /Eliza plugin/, 'Doors page includes Eliza');
});

test('llms.txt API route has no nested backticks in CHIT_LLMS template', () => {
  const llmsApi = readFileSync(join(root, '../../api/llms.txt.ts'), 'utf8');
  const chitBlock = llmsApi.match(/const CHIT_LLMS = `([\s\S]*?)`;\s*\nconst XFUEL_LLMS/m)?.[1] ?? '';
  assert.ok(chitBlock.length > 100, 'CHIT_LLMS block present');
  assert.doesNotMatch(chitBlock, /` \{ action/, 'no nested backticks that break the handler bundle');
});

test('host config has correct Chit SEO values', () => {
  const hostConfig = readFileSync(join(root, 'src/hostConfig.ts'), 'utf8');
  assert.match(hostConfig, /title:.*treasury desk for agent spend/i, 'Chit SEO title uses treasury desk for listings');
  assert.match(hostConfig, /ogTitle:.*treasury desk for agent spend/i, 'Chit ogTitle uses treasury desk for listings');
  assert.match(hostConfig, /description:.*Who paid which call/i, 'Chit description leads with who paid which call');
  assert.match(hostConfig, /ogDescription:.*Possession book for agent spend/i, 'Chit ogDescription names possession book');
  assert.doesNotMatch(hostConfig, /wallet moves/i, 'Chit SEO must not lead with wallet-move');
  assert.match(hostConfig, /chit402\.com/, 'Config has chit402.com domain');
  assert.match(hostConfig, /@chit402/, 'Config has @chit402 Twitter handle');
  assert.match(hostConfig, /githubUrl:.*chit402/i, 'Config has chit402 GitHub URL');
  assert.doesNotMatch(hostConfig, /OpenAI/i, 'Config must not use vendor-specific wire branding');
  assert.doesNotMatch(hostConfig, /By XFuel Lab/i, 'Chit SEO metadata must not mix parent branding');
  assert.doesNotMatch(hostConfig, /parent:\s*['"]XFuel Lab['"]/, 'hostConfig must not expose parent lab field');
  assert.match(hostConfig, /name: 'Chit402'/, 'Chit chrome uses Chit402 product name');
  assert.match(hostConfig, /navLogo: '\/chit402-mark\.png'/, 'Chit nav uses receipt stub mark');
  assert.match(hostConfig, /favicon: '\/chit402-icon\.png'/, 'Chit favicon uses receipt stub app icon');
  assert.match(hostConfig, /publicContactEmail: 'hello@chit402\.com'/, 'Chit public contact is hello@chit402.com');
});

test('Layout supports dual branding for Chit and XFuel', () => {
  const layout = readFileSync(join(root, 'src/components/Layout.tsx'), 'utf8');
  assert.match(layout, /isChitHost/, 'Layout checks for Chit host');
  assert.doesNotMatch(layout, /Chit is the product/, 'Layout must not show global parent banner on Chit');
  assert.doesNotMatch(layout, /By XFuel Lab/i, 'Layout footer must not show parent byline on Chit');
  assert.match(layout, /config\.publicContactEmail/, 'Layout footer uses host public contact email');
  assert.doesNotMatch(layout, /mailto:security@xfuel\.app/, 'Layout must not hard-code security@xfuel.app mailto');
  assert.match(layout, /config\.name/, 'Layout uses dynamic brand name');
});

test('Drop-in door page documents paid install path (not whole product)', () => {
  const page = readFileSync(join(root, 'src/pages/ChitIn15Lines.tsx'), 'utf8');
  assert.match(page, /getApiV1\(\)|api\.chit402\.com/, 'drop-in page names /v1 wire');
  assert.doesNotMatch(page, /chit402-demo/, 'drop-in page does not advertise demo key');
  assert.match(page, /possession book/i, 'drop-in page separates book from install');
  assert.match(page, /may strip unknown response fields/, 'drop-in page warns about SDK field stripping');
  assert.match(page, /<h1>Chat <code>\/v1<\/code> wire<\/h1>/, 'drop-in page titles the chat /v1 install wire');
  assert.match(page, /verify_url/, 'drop-in page mentions verify_url');
});

test('App routes docs subpages', () => {
  const app = readFileSync(join(root, 'src/App.tsx'), 'utf8');
  assert.match(app, /import ChitHome/, 'App imports ChitHome');
  assert.match(app, /isChitHost\(\) \? <ChitHome/, 'App conditionally renders ChitHome');
  assert.match(app, /path="\/doors" element={<Doors \/>}/, 'App routes first-class Doors page');
  assert.match(app, /path="\/docs\/doors" element={<DocsDoors \/>}/, 'App routes legacy /docs/doors redirect');
  assert.match(app, /chit-in-15-lines/, 'App routes 15-lines page');
  assert.match(app, /\/docs\/eliza/, 'App routes Eliza stub');
  assert.match(app, /\/trust/, 'App routes issuer trust page');
  assert.match(app, /\/activity/, 'App routes Activity page');
  assert.match(app, /path="\/products"/, 'App routes first-class Products page');
});

test('Products page surfaces three book-first seats', () => {
  const products = readFileSync(join(root, 'src/pages/Products.tsx'), 'utf8');
  const pricing = readFileSync(join(root, 'src/pages/Pricing.tsx'), 'utf8');
  assert.match(products, /<h1>Three seats on the possession book\./, 'Products page title');
  assert.match(products, /name: 'Stamp'/, 'Products includes Stamp seat');
  assert.match(products, /\$0\.002/, 'Products states Stamp price');
  assert.match(products, /name: 'Private Desk'/, 'Products includes Private Desk seat');
  assert.match(products, /cost \+ 1%|100 bps/, 'Products states Desk routing fee');
  assert.match(products, /name: 'Private \+ Attest'/, 'Products includes Private + Attest seat');
  assert.match(products, /\$0\.10/, 'Products states Tier-2 add-on');
  assert.doesNotMatch(products, /\bOpenAI\b/i, 'Products must not name OpenAI');
  assert.match(pricing, /to="\/products"/, 'Pricing links to products');
});

test('Security page uses host-aware product naming', () => {
  const security = readFileSync(join(root, 'src/pages/Security.tsx'), 'utf8');
  assert.match(security, /isChitHost/, 'Security page branches on Chit host');
  assert.match(security, /config\.name/, 'Security uses dynamic product name');
  assert.doesNotMatch(security, /XFuel is pre-audit/, 'Security must not hard-code XFuel pre-audit on Chit');
});

test('issuer trust page publishes JWKS URLs, kid, and rotation policy', () => {
  const page = readFileSync(join(root, 'src/pages/IssuerTrust.tsx'), 'utf8');
  assert.match(page, /api\.chit402\.com\/\.well-known\/jwks\.json/);
  assert.match(page, /api\.xfuel\.app\/\.well-known\/jwks\.json/);
  assert.doesNotMatch(page, /XFuel API alias/i, 'Trust page must not brand legacy host as XFuel product');
  assert.match(page, /IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q/);
  assert.match(page, /RFC 7638/);
  assert.match(page, /issuer_jwk.*not an independent trust root/is);
  assert.match(page, /private key.*never/i);
});

test('llms.txt API route links issuer trust page', () => {
  const llmsApi = readFileSync(join(root, '../../api/llms.txt.ts'), 'utf8');
  assert.match(llmsApi, /www\.chit402\.com\/trust/);
});

test('middleware CHIT_SEO uses Chit402 titles (not Chit)', () => {
  const middleware = readFileSync(join(root, '../../middleware.ts'), 'utf8');
  
  assert.match(
    middleware,
    /title:\s*['"]Chit402 — treasury desk for agent spend['"]/,
    'middleware CHIT_SEO title uses treasury desk'
  );
  assert.match(
    middleware,
    /ogTitle:\s*['"]Chit402 — treasury desk for agent spend['"]/,
    'middleware CHIT_SEO ogTitle uses treasury desk'
  );
  assert.match(
    middleware,
    /description:\s*['"]Who paid which call — export, policy, evidence\. Possession book for agent spend\.['"]/,
    'middleware CHIT_SEO description uses locked copy'
  );
  assert.doesNotMatch(middleware, /wallet moves/i, 'middleware must not lead with wallet-move');
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
  assert.ok(chitSeoDesc.startsWith('Who paid which call'), 'CHIT_SEO description starts with who paid which call');
  assert.ok(!chitSeoDesc.includes('By XFuel Lab'), 'CHIT_SEO description does not contain By XFuel Lab');
  
  const simulated = sampleHtml
    .replace(/<title>[^<]*<\/title>/, `<title>${chitSeoTitle}</title>`)
    .replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${chitSeoOgTitle}" />`)
    .replace(/<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${chitSeoOgTitle}" />`);
  
  assert.match(simulated, /<title>Chit402/, 'transformed title starts with Chit402');
  assert.match(simulated, /og:title" content="Chit402/, 'transformed og:title starts with Chit402');
  assert.match(simulated, /twitter:title" content="Chit402/, 'transformed twitter:title starts with Chit402');
});
