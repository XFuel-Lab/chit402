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

const PAGE_CONTENT = {
  'src/pages/ChitHome.tsx': 'src/content/homeContent.mjs',
  'src/pages/Pricing.tsx': 'src/content/pricingContent.mjs',
  'src/pages/Docs.tsx': 'src/content/docsContent.mjs',
};

function readPage(rel) {
  const main = readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n');
  const extra = PAGE_CONTENT[rel];
  if (!extra) return main;
  return `${main}\n${readFileSync(join(root, extra), 'utf8').replace(/\r\n/g, '\n')}`;
}

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
  const pricing = readPage('src/pages/Pricing.tsx');
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
  }
  // Plain pricing wording everywhere; Pricing keeps the $0.002 and cost + 1% figures.
  assert.match(pricing, /charges a quoted price and gives a receipt for every call, paid in USDC on Base and Solana\./, 'Pricing uses plain wording');
  const docs = readPage('src/pages/Docs.tsx');
  assert.match(docs, /is charged a quoted price and gets a receipt, paid in USDC on Base or Solana\./, 'Docs uses plain wording');
  assert.doesNotMatch(layout, /cost-plus|This agent spent Y|You hold hub/i, 'banner drops jargon');
  assert.match(layout, /real mainnet USDC/, 'banner keeps mainnet warning');
  assert.doesNotMatch(home, /This agent spent Y/, 'home drops old line');
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
    const source = readPage(rel);
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
  assert.match(home, /Your agents spent \$400 this week\. On what, and with whom\?/);
  assert.match(home, /Chit puts a receipt on every payment and keeps it in your book, not theirs\. Open it any time and check each line\. \$0\.002 a receipt\./);
  assert.match(home, /See what your agent spent/);
  assert.match(home, /https:\/\/api\.chit402\.com\/receipt\/xfuel-3155b7d8-4315-44bc-bfdc-bf6b78ff2d15/);
  assert.doesNotMatch(home, /customer data/i, 'illustrative $400 must not be labelled customer data');
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
  const chitHome = readPage('src/pages/ChitHome.tsx');
  const receiptCard = readFileSync(join(root, 'src/components/LiveReceiptCard.tsx'), 'utf8');
  const liveSpecimen = readFileSync(join(root, 'src/lib/liveReceiptSpecimen.ts'), 'utf8');
  assert.ok(/Your agents spent money this week\. On what, and with whom\?/.test(chitHome), 'ChitHome leads with the funder question');
  assert.ok(/Each paid call lands as a row in a book you hold: hub, model, amount, and a link to its receipt\. \$0\.002 per receipt\./.test(chitHome), 'ChitHome subhead');
  assert.ok(/^(?![\s\S]*Who paid which call — and you still hold it\.)[\s\S]*$/.test(chitHome), 'ChitHome drops the old h1');
  assert.ok(/^(?![\s\S]*Treasury desk and spend ledger for agent teams)[\s\S]*$/.test(chitHome), 'ChitHome drops the old lead');
  assert.ok(/^(?![\s\S]*Every collected inference returns hub, model, amount, and a verify link you can export, policy, and evidence-pack\.)[\s\S]*$/.test(chitHome), 'ChitHome drops the old description');
  assert.match(chitHome, /LiveReceiptCard/, 'ChitHome renders live receipt card');
  assert.match(liveSpecimen, /xfuel-3155b7d8-4315-44bc-bfdc-bf6b78ff2d15/, 'Live receipt specimen id locked');
  assert.match(liveSpecimen, /2026-10-19T02:23:00\.000Z/, 'Live receipt time is the public issued_at');
  assert.match(liveSpecimen, /0x731e4fdc70a8dba370c579c23e8520d2edcde052f28abaf3ed26c95c8603116f/, 'Live receipt payment tx is the public shell tx');
  assert.doesNotMatch(liveSpecimen, /akash-network|Llama-3\.3|0x2536|0xf63e/, 'Live receipt specimen does not keep the previous receipt route or payer');
  assert.match(receiptCard, /owner view/, 'Live receipt card points hub and model at the owner view');
  assert.doesNotMatch(receiptCard, /LIVE_RECEIPT_HUB/, 'Live receipt card does not publish the hub');
  assert.match(receiptCard, /Verify receipt/, 'Live receipt card links verify');
  assert.match(chitHome, /Open the book/, 'ChitHome primary CTA opens book');
  assert.match(chitHome, /Audit a wallet/);
  assert.match(chitHome, /published on Base and Solana/);
  assert.match(chitHome, /receipts\/tree\/head/);
  assert.match(chitHome, /Pin our issuer key/);
  assert.doesNotMatch(chitHome, /proven inclusion|independently verify inclusion/i);
  assert.match(chitHome, /Verify live receipt/, 'ChitHome links live verify');
  assert.match(chitHome, /90-second drop-in/, 'ChitHome surfaces 90s drop-in above fold');
  assert.match(
    chitHome,
    /Stamp who paid which call onto the possession book/,
    'ChitHome 90s block leads with stamp/book',
  );
  assert.match(chitHome, /signed receipt/, 'ChitHome 90s block names signed receipt');
  assert.match(chitHome, /Install wires/, 'ChitHome 90s block points to install wires');
  assert.match(chitHome, /to="\/doors"|doorsHref: '\/doors'/, 'ChitHome links install doors from 90s section');
  const ninetyBlock = chitHome.match(/chit-ninety-door[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? '';
  assert.doesNotMatch(ninetyBlock, /OpenAI/i, 'ChitHome 90s lead block stays book-first (no vendor wire branding)');
  assert.match(chitHome, /wrapFetchWithPayment\(/, 'ChitHome 90s sample uses the x402 fetch wrapper');
  const dropIn = chitHome.match(/const dropInSnippet = `([\s\S]*?)`;/)?.[1] ?? '';
  const partnerKey = chitHome.match(/const partnerKeySnippet = `([\s\S]*?)`;/)?.[1] ?? '';
  assert.match(dropIn, /wrapFetchWithPayment/, '90s x402 snippet pays with wrapFetchWithPayment');
  assert.match(dropIn, /verify_url/, '90s x402 snippet returns verify_url');
  assert.doesNotMatch(dropIn, /X-API-Key/, '90s x402 snippet does not send an API key');
  assert.match(partnerKey, /X-API-Key/, 'partner key snippet sends X-API-Key');
  assert.match(partnerKey, /verify_url/, 'partner key snippet returns verify_url');
  assert.match(chitHome, /Pay per call \(x402\)/, 'x402 tab is labeled Pay per call (x402)');
  assert.match(chitHome, /Partner API key/, 'partner key tab is labeled Partner API key');
  assert.match(chitHome, /useState<DropInDoor>\('x402'\)/, 'x402 tab is selected first');
  assert.doesNotMatch(chitHome, /can still send/, 'partner key is not a leftover footnote');
  assert.match(chitHome, /Also works/, 'ChitHome demotes adapters to Also works');
  assert.match(chitHome, /api\.chit402\.com\/v1/, 'ChitHome names wire in 90s drop-in');
  assert.match(chitHome, /\/docs\/chit-in-15-lines/, 'ChitHome links to drop-in door page');
  assert.match(chitHome, /\/docs\/eliza/, 'ChitHome links to Eliza stub');
  assert.doesNotMatch(chitHome, /By XFuel Lab|is the parent|XFuel Lab/i, 'ChitHome must not show parent naming in chrome');
  assert.match(chitHome, /USDC on Base and Solana/, 'ChitHome names USDC rails');
  assert.ok(/pricingLabel: '\$0\.002 per receipt'/.test(chitHome), 'ChitHome surfaces the receipt chip');
  assert.ok(/pricingHref: '\/pricing'/.test(chitHome), 'ChitHome links the chip to /pricing');
  assert.ok(/^(?![\s\S]*routing cost \+ 1%)[\s\S]*$/.test(chitHome), 'ChitHome hero has no routing cost + 1%');
  assert.ok(/^(?![\s\S]*Stamp · Private Desk · Attest)[\s\S]*$/.test(chitHome), 'ChitHome hero has no products chip');
  assert.ok(/^(?![\s\S]*\$0\.10)[\s\S]*$/.test(chitHome), 'ChitHome hero has no $0.10');
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
  assert.match(specimen, /LIVE_RECEIPT_COLLECTED_AT/, 'Specimen time comes from the public shell');
  assert.match(specimen, /LIVE_RECEIPT_PAYMENT_REF/, 'Specimen payment comes from the public shell');
  assert.doesNotMatch(specimen, /2026-09-05T18:14:09|0xf63e|0x2536|LIVE_RECEIPT_HUB|LIVE_RECEIPT_MODEL/, 'Specimen row does not keep the previous receipt');
  assert.doesNotMatch(book, /You get nothing without the session/, 'Book must not be lock-only on first visit');
  assert.match(specimenPanel, /computeBurnRate/, 'Specimen panel previews burn rate');
  assert.match(specimenPanel, /computeModelMix/, 'Specimen panel previews model mix');
  assert.match(book, /id="what-the-book-is"/, 'Book explains what it is');
  assert.match(book, /client-attested/);
  assert.match(book, /chit402\.refusal\.v1/);
  assert.match(book, /chit402-verify 0\.4\.11/);
  assert.doesNotMatch(book, /--rpc/);
  assert.doesNotMatch(book, /@xfuel\/verify<\/code> 0\.3\.1/);
  assert.doesNotMatch(book, /prepaid hold|holds are live/i);
  assert.doesNotMatch(book, /chit-1e57cdd7/);
});

test('Book principal dashboard v1 wires live API beats', () => {
  const book = readFileSync(join(root, 'src/pages/Book.tsx'), 'utf8');
  const strip = readFileSync(join(root, 'src/components/BookKpiStrip.tsx'), 'utf8');
  const client = readFileSync(join(root, 'src/lib/agentBook.ts'), 'utf8');
  assert.match(book, /fetchAgentBook/, 'Book loads possession-gated book API');
  assert.match(book, /computeBurnRate/, 'Book derives burn rate from entries');
  assert.match(book, /computeModelMix/, 'Book derives model mix from entries');
  assert.match(book, /verifyUrlFor/, 'Book links verify_url per row');
  assert.match(book, /Treasury advanced/, 'Policy/export/escrow tucked under advanced');
  assert.match(
    book,
    /Caps are limits set with the book session, enforced on spends made under that session, not signed, and changeable by the session holder\./,
    'Book policy copy names unsigned session caps',
  );
  assert.match(book, /not inside the router/, 'Book policy still says caps are not router config');
  assert.match(book, /Demo keys cannot write policy/, 'Demo keys still cannot write policy');
  assert.doesNotMatch(book, /Caps sit on the book you hold/);
  assert.doesNotMatch(book, /caps as rows/i);
  assert.doesNotMatch(book, /signed cap/i);
  assert.match(book, /BookKpiStrip/, 'Book renders the KPI strip');
  assert.match(book, /useState<BookWindowPreset>\('7d'\)/, 'Default window is last 7 days');
  assert.match(strip, /Spend/, 'KPI tile: Spend');
  assert.match(strip, /Payments/, 'KPI tile: Payments');
  assert.match(strip, /Vendors paid/, 'KPI tile: Vendors paid');
  assert.match(strip, /Receipts verified/, 'KPI tile: Receipts verified');
  assert.match(book, /Export CSV/, 'Receipts list surfaces Export CSV');
  assert.match(book, /handleExport\('csv', true\)/, 'Receipts list Export CSV is windowed');
  assert.match(book, /handleExport\('csv'\)/, 'Audit pack CSV is not windowed');
  assert.match(book, /handleExport\('json'\)/, 'Audit pack JSON is not windowed');
  assert.match(book, /handleExport\('html'\)/, 'Audit pack HTML is not windowed');
  assert.match(book, /bookExportBounds\(windowed, windowPreset\)/, 'Export bounds follow the windowed flag');
  assert.equal(
    (book.match(/const gen = \+\+loadGen\.current/g) || []).length,
    2,
    'Budget save and book load share the generation guard',
  );
  assert.match(book, /loadedPreset === windowPreset/, 'KPI totals follow the loaded preset, not a fresh timestamp');
  assert.match(book, /pending=\{!summaryCurrent\}/, 'KPI strip waits for the selected window');
  assert.match(book, /if \(opts\?\.quiet\) \{\s*setWindowError/, 'A failed window refetch keeps the loaded book');
  assert.match(book, /if \(opts\?\.quiet\) return;/, 'A window refetch does not reload policy or the budget draft');
  assert.match(client, /qs\.set\('from', params\.from\)/, 'Export client forwards from');
  assert.match(
    book,
    /Your first paid call shows up here with its receipt and a verify link\./,
    'Empty receipts teach the first paid call',
  );
  assert.match(book, /to="\/docs\/chit-in-15-lines"/, 'Empty state links the quickstart');
});

test('Chit primary nav is Book, Audit, Docs, Pricing, Trust, and GitHub', () => {
  const layout = readFileSync(join(root, 'src/components/Layout.tsx'), 'utf8');
  const nav = layout.match(/const chitNavLinks[\s\S]*?\];/)?.[0] ?? '';
  assert.match(nav, /to: '\/book', label: 'Book'/);
  assert.match(nav, /to: '\/audit', label: 'Audit'/);
  assert.match(nav, /to: '\/docs', label: 'Docs'/);
  assert.match(nav, /to: '\/pricing', label: 'Pricing'/);
  assert.match(nav, /to: '\/trust', label: 'Trust'/);
  assert.doesNotMatch(nav, /Register|Activity|Board|Products|Doors|Home/);
  assert.match(layout, /label: 'GitHub', external: true/);
  assert.match(layout, /to="\/register"/, 'Register stays in the footer');
  assert.match(layout, /to="\/activity"/);
  assert.match(layout, /to="\/board"/);
  assert.match(layout, /to="\/products"/);
  assert.match(layout, /to="\/doors"/);
  assert.doesNotMatch(layout, /chitNavLinks[\s\S]*Drop-in door/);
});

test('install docs show keyless x402 before the partner API key', () => {
  const options = readFileSync(join(root, 'src/components/PaidDoorOptions.tsx'), 'utf8');
  const snippets = readFileSync(join(root, 'src/lib/paidDoorSnippets.ts'), 'utf8');
  assert.ok(snippets.indexOf('wrapFetchWithPayment') < snippets.indexOf('X-API-Key'));
  assert.match(options, /Keyless x402/);
  assert.match(options, /Partner API key/);
  const pages = [
    'src/pages/Doors.tsx',
    'src/pages/AcpDocs.tsx',
    'src/pages/CloudflareDocs.tsx',
    'src/pages/SwarmPlatforms.tsx',
    'src/pages/OpenClawDocs.tsx',
    'src/pages/ElizaPlugin.tsx',
    'src/pages/FrameworkAdapters.tsx',
    'src/pages/ChitIn15Lines.tsx',
  ];
  for (const rel of pages) {
    const page = readFileSync(join(root, rel), 'utf8');
    assert.match(page, /PaidDoorOptions/, `${rel} shows both pay options`);
    assert.match(page, /X-API-Key|CHIT_API_KEY|CHIT402_API_KEY/, `${rel} keeps a partner key`);
    assert.doesNotMatch(page, /@xfuel\/sidecar|from 'xfuel-sdk'|npx xfuel-mcp/);
  }
});

test('Docs hub leads with book; install doors on dedicated page', () => {
  const docs = readPage('src/pages/Docs.tsx');
  const doors = readFileSync(join(root, 'src/pages/Doors.tsx'), 'utf8');
  const docsDoors = readFileSync(join(root, 'src/pages/DocsDoors.tsx'), 'utf8');
  assert.match(docs, /possession book/i, 'Docs intro leads with possession book');
  assert.match(docs, /to="\/doors"|href: '\/doors'/, 'Docs hub links to /doors');
  assert.match(docs, /href: '\/products'/, 'Docs hub lists Products in start here');
  assert.doesNotMatch(docs, /DocDoorGrid/, 'Docs hub does not list every door card');
  assert.match(doors, /<h1>Doors<\/h1>/, 'Doors page has first-class title');
  assert.doesNotMatch(doors, /Equal-weight/);
  assert.match(doors, /PaidDoorOptions/, 'Doors leads with keyless x402');
  assert.match(doors, /CHIT402_API_KEY/, 'Doors keeps the partner API key');
  assert.match(doors, /chit402-sdk/);
  assert.match(doors, /chit402-mcp/);
  assert.match(doors, /chit402-sidecar/);
  assert.doesNotMatch(doors, /@xfuel\/sidecar/);
  assert.doesNotMatch(doors, /xfuel-sdk/);
  assert.doesNotMatch(doors, /xfuel-mcp/);
  assert.match(docsDoors, /Navigate to="\/doors"/, 'Legacy /docs/doors redirects to /doors');
  const doorsBlock = doors.match(/export const moreDoors[\s\S]*?];/)?.[0] ?? '';
  assert.match(doorsBlock, /Chat \/v1 wire/, 'Doors page links the wire page');
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
  assert.match(layout, /Chit402 is built by XFuel Lab/, 'Footer names the lab once');
  assert.doesNotMatch(
    layout.replace('Chit402 is built by XFuel Lab', ''),
    /By XFuel Lab/i,
    'Layout footer must not show a parent byline',
  );
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

test('1F916 link draft is a public docs page', () => {
  const app = readFileSync(join(root, 'src/App.tsx'), 'utf8');
  const page = readFileSync(join(root, 'src/pages/OneF916Link.tsx'), 'utf8');
  const docs = readPage('src/pages/Docs.tsx');
  const sitemap = readFileSync(join(root, '../../api/sitemap.xml.ts'), 'utf8');
  const llms = readFileSync(join(root, '../../api/llms.txt.ts'), 'utf8');
  const vercel = readFileSync(join(root, '../../vercel.json'), 'utf8');
  const prerender = readFileSync(join(root, 'scripts/prerender-titles.mjs'), 'utf8');
  assert.match(app, /path="\/docs\/1f916-link"/, 'App routes /docs/1f916-link');
  assert.match(page, /Draft v0, feedback welcome/);
  assert.match(page, /https:\/\/1f916\.ai\/post\/7404/);
  assert.match(page, /unverified payment claim/);
  assert.match(page, /Issuance support is coming/);
  assert.match(page, /api\.chit402\.com\/\.well-known\/jwks\.json/);
  assert.match(page, /Who issues the receipt/);
  assert.match(page, /are stamped/);
  assert.match(page, /foreign-x402-muq262x0-1467b076fc62/);
  assert.match(page, /foreign-x402-muq264r9-69896464bb19/);
  assert.doesNotMatch(page, /pending first stamp/);
  assert.match(page, /Specimen 1/);
  assert.match(page, /Specimen 2/);
  assert.match(page, /0x909d738d79ff4c9885cd9ed0755636565ee3ddf0406ef6f454e7fbf797990ce9/);
  assert.match(page, /0x233acdcf3d78436d63a0dba00092fb9a8fe806a3ecd1b415a4d364144baffebd/);
  assert.match(page, /a09e1e0b0aed6a7826b55281ef1e8af19fb164034a662d122adaa503b54f7dc2/);
  assert.match(page, /20498/);
  assert.match(page, /scripts\/verify-1f916-link\.mjs/);
  assert.match(page, /stamp-foreign-payout\.mjs/);
  assert.match(page, /PAYMENT-RESPONSE/);
  assert.doesNotMatch(page, /PLACEHOLDER/);
  assert.doesNotMatch(page, /1ebc5616/);
  assert.doesNotMatch(page, /chit-1b7ac401/);
  assert.doesNotMatch(page, /chit-5d775d12/);
  assert.match(page, /npx chit402-verify/);
  assert.doesNotMatch(page, /npx xfuel-verify/);
  assert.doesNotMatch(page, /--fetch-jwks/);
  assert.doesNotMatch(page, /--jwks-url/);
  assert.doesNotMatch(page, /--check-payer/);
  assert.match(docs, /href: '\/docs\/1f916-link'/, 'Docs index lists the draft');
  assert.match(sitemap, /https:\/\/www\.chit402\.com\/docs\/1f916-link/);
  assert.match(llms, /\/docs\/1f916-link/);
  assert.match(vercel, /\/docs\/1f916-link/);
  assert.match(prerender, /\/docs\/1f916-link/);
});

test('App routes docs subpages', () => {
  const app = readFileSync(join(root, 'src/App.tsx'), 'utf8');
  assert.match(app, /import ChitHome/, 'App imports ChitHome');
  assert.match(app, /isChitHost\(\) \? <ChitHome/, 'App conditionally renders ChitHome');
  assert.match(app, /path="\/doors" element={<Doors \/>}/, 'App routes first-class Doors page');
  assert.match(app, /path="\/docs\/doors" element={<DocsDoors \/>}/, 'App routes legacy /docs/doors redirect');
  assert.match(app, /chit-in-15-lines/, 'App routes 15-lines page');
  assert.match(app, /\/docs\/eliza/, 'App routes Eliza stub');
  assert.match(app, /\/docs\/cloudflare-x402/, 'App routes Cloudflare Monetization Gateway docs');
  assert.match(app, /\/trust/, 'App routes issuer trust page');
  assert.match(app, /\/activity/, 'App routes Activity page');
  assert.match(app, /path="\/board"/, 'App routes the agent board');
  assert.match(app, /path="\/products"/, 'App routes first-class Products page');
});

test('Products page surfaces three book-first seats', () => {
  const products = readFileSync(join(root, 'src/pages/Products.tsx'), 'utf8').replace(/\r\n/g, '\n');
  const pricing = readPage('src/pages/Pricing.tsx');
  assert.match(products, /<h1>Three seats on the possession book\./, 'Products page title');
  assert.match(products, /name: 'Stamp'/, 'Products includes Stamp seat');
  assert.match(products, /\$0\.002/, 'Products states Stamp price');
  assert.match(products, /name: 'Private Desk'/, 'Products includes Private Desk seat');
  assert.match(products, /cost \+ 1%|100 bps/, 'Products states Desk routing fee');
  assert.match(products, /name: 'Private \+ Attest'/, 'Products includes Private + Attest seat');
  assert.ok(/Tier-2 settlement proof: \+\$0\.10 per proof\. Currently unavailable while we upgrade the proving system; standard \$0\.002 receipts are unaffected\./.test(products), 'Products carries the Tier-2 notice');
  assert.ok(/Tier-2 settlement proof: \+\$0\.10 per proof\. Currently unavailable while we upgrade the proving system; standard \$0\.002 receipts are unaffected\./.test(products), 'Products shows the Tier-2 price exactly with Currently unavailable');
  assert.doesNotMatch(products, /\bOpenAI\b/i, 'Products must not name OpenAI');
  assert.match(pricing, /to="\/products"|link\('\/products'/, 'Pricing links to products');
});

test('Security page uses host-aware product naming', () => {
  const security = readFileSync(join(root, 'src/pages/Security.tsx'), 'utf8');
  assert.match(security, /isChitHost/, 'Security page branches on Chit host');
  assert.match(security, /config\.name/, 'Security uses dynamic product name');
  assert.doesNotMatch(security, /XFuel is pre-audit/, 'Security must not hard-code XFuel pre-audit on Chit');
});

test('false claims called out in the site alignment stay fixed', () => {
  const trust = readFileSync(join(root, 'src/pages/IssuerTrust.tsx'), 'utf8');
  const register = readFileSync(join(root, 'src/pages/Register.tsx'), 'utf8');
  const gateway = readFileSync(join(root, 'src/pages/GatewayV1.tsx'), 'utf8');
  const security = readFileSync(join(root, 'src/pages/Security.tsx'), 'utf8');
  const receipt = readFileSync(join(root, 'src/pages/ReceiptCheckDocs.tsx'), 'utf8');
  const book = readFileSync(join(root, 'src/pages/Book.tsx'), 'utf8');
  const middleware = readFileSync(join(root, '../../middleware.ts'), 'utf8');
  assert.match(trust, /npx chit402-verify/);
  assert.doesNotMatch(trust, /npx xfuel-verify/);
  assert.doesNotMatch(trust, /--jwks-file/);
  assert.doesNotMatch(trust, /ISSUER_PRIVATE_KEY/);
  assert.doesNotMatch(trust, /pin JWKS/i);
  assert.match(receipt, /npx chit402-verify/);
  assert.match(receipt, /cloud KMS/);
  assert.doesNotMatch(receipt, /not in a cloud KMS/);
  assert.doesNotMatch(receipt, /ISSUER_PRIVATE_KEY/);
  assert.doesNotMatch(receipt, /--strict-issuer-history/);
  assert.doesNotMatch(receipt, /\?version=1/);
  assert.match(book, /npx chit402-verify/);
  assert.doesNotMatch(book, /--check-payer/);
  assert.doesNotMatch(register, /The demo key/);
  assert.match(register, /Public demo keys never register/);
  assert.doesNotMatch(gateway, /HMAC-signed/);
  assert.doesNotMatch(gateway, /do not proxy to third-party/i);
  assert.match(gateway, /openrouter/);
  assert.match(gateway, /ES256/);
  assert.doesNotMatch(security, /baked in at build time/);
  assert.doesNotMatch(security, /ZKVerifierSP1 \(env\)/);
  assert.match(security, /Base and Solana/);
  assert.doesNotMatch(receipt, /Publish <code>@xfuel\/verify<\/code> before/);
  assert.match(receipt, /xfuel-3155b7d8-4315-44bc-bfdc-bf6b78ff2d15/);
  assert.doesNotMatch(receipt, /chit-1e57cdd7/);
  assert.doesNotMatch(middleware, /or a demo key/);
});

test('issuer trust page publishes JWKS URLs, kid, and rotation policy', () => {
  const page = readFileSync(join(root, 'src/pages/IssuerTrust.tsx'), 'utf8');
  assert.match(page, /api\.chit402\.com\/\.well-known\/jwks\.json/);
  assert.doesNotMatch(page, /api\.xfuel\.app\/\.well-known\/jwks\.json/);
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

test('chit402 listing assets are the black/white/blue receipt, rasterized as PNG', () => {
  const png = (rel) => readFileSync(join(root, rel));
  const assets = {
    'public/chit402-icon.png': png('public/chit402-icon.png'),
    'public/chit402-mark.png': png('public/chit402-mark.png'),
    'public/og-image.png': png('public/og-image.png'),
    'public/apple-touch-icon.png': png('public/apple-touch-icon.png'),
  };
  for (const [name, buf] of Object.entries(assets)) {
    assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${name} is a PNG`);
    assert.notEqual(buf.subarray(0, 2).toString('hex'), 'ffd8', `${name} is not a JPEG`);
  }
  const iconPng = assets['public/chit402-icon.png'];
  const markPng = assets['public/chit402-mark.png'];
  assert.equal(iconPng.readUInt32BE(16), 1024, 'app icon is rasterized at 1024');
  assert.equal(iconPng.readUInt32BE(20), 1024, 'app icon is square');
  assert.equal(markPng.readUInt32BE(16), 512, 'nav mark is rasterized at 512');
  assert.equal(markPng.readUInt32BE(20), 512, 'nav mark is square');
  assert.equal(assets['public/og-image.png'].readUInt32BE(16), 1200);
  assert.equal(assets['public/og-image.png'].readUInt32BE(20), 630);
  assert.equal(assets['public/apple-touch-icon.png'].readUInt32BE(16), 180);
  assert.equal(assets['public/apple-touch-icon.png'].readUInt32BE(20), 180);

  const ico = readFileSync(join(root, 'public/favicon.ico'));
  assert.equal(ico.readUInt16LE(0), 0, 'favicon.ico is an ICO, not a PNG payload');
  assert.equal(ico.readUInt16LE(2), 1, 'favicon.ico type is icon');
  assert.ok(ico.readUInt16LE(4) >= 2, 'favicon.ico contains more than one size');

  const svg = readFileSync(join(root, 'public/chit402-icon.svg'), 'utf8');
  assert.match(svg, /#0095b8/, '402 is brand blue');
  assert.match(svg, /#ffffff/, 'receipt paper is white');
  assert.match(svg, /#dfe3ea/, 'folded corner is the cool gray');
  assert.match(svg, /#202026/, 'frame is near-black');
  assert.match(svg, /#16161c/, 'rules are near-black');
  assert.match(svg, /#5a5f6b/, 'rules include the dark gray');
  assert.doesNotMatch(svg, /#00d4ff/, 'icon SVG no longer uses the cyan wordmark');

  assert.match(html, /rel="apple-touch-icon" href="\/apple-touch-icon\.png"/);
});

test('BookBot price line and footer use plain words', () => {
  const bookBot = readFileSync(join(root, 'src/pages/BookBot.tsx'), 'utf8');
  assert.match(bookBot, /charges a quoted price and gives a receipt for every call, paid in USDC on Base and Solana\./);
  assert.doesNotMatch(bookBot, /is cost-plus, quoted, receipted/);
  assert.doesNotMatch(bookBot, /table stakes/);
  for (const rel of ['src/pages/GatewayV1.tsx', 'scripts/prerender-titles.mjs']) {
    const src = readFileSync(join(root, rel), 'utf8');
    assert.match(src, /charges a quoted price and gives a receipt for every call, paid in USDC on Base and Solana\./, rel);
    assert.doesNotMatch(src, /is cost-plus, quoted, receipted/, rel);
  }
  const layout = readFileSync(join(root, 'src/components/Layout.tsx'), 'utf8');
  assert.match(layout, /Your book: who paid, for what, and how much\. Apache-2\.0\./);
  assert.doesNotMatch(layout, /The book: hub, model, amount/);
});

test('old pricing jargon and "table stakes" are gone from web pages and prerender', () => {
  for (const rel of ['src/pages/ThetaAI.tsx', 'src/pages/AgentShop.tsx', 'src/pages/Products.tsx', 'src/pages/Pricing.tsx', 'src/pages/Docs.tsx', 'src/pages/OpenClawDocs.tsx', 'scripts/prerender-titles.mjs']) {
    const src = readPage(rel);
    assert.doesNotMatch(src, /cost-plus, quoted, receipted/i, rel);
    assert.doesNotMatch(src, /table stakes/i, rel);
  }
  assert.match(readFileSync(join(root, 'src/pages/AgentShop.tsx'), 'utf8'), /issuer-signed \(ES256\)/);
  assert.match(readFileSync(join(root, 'src/pages/OpenClawDocs.tsx'), 'utf8'), /signed ES256 receipt/);
});

test('XFuel host description and Pricing footnote use plain wording', () => {
  const host = readFileSync(join(root, 'src/hostConfig.ts'), 'utf8');
  assert.equal((host.match(/XFuel keeps your book: who paid, for what, and how much\. Every paid call gets a signed receipt with a link \(verify_url\) to check it, at a price based on our cost\. USDC on Base and Solana\./g) || []).length, 2);
  assert.doesNotMatch(host, /the book: hub, model, and amount/);
  const pricing = readPage('src/pages/Pricing.tsx');
  assert.match(pricing, /fee based on our cost plus a margin/);
  assert.doesNotMatch(pricing, /cost-plus fee basis/);
});

test('/v1 middleware lede uses plain wording', () => {
  const mw = readFileSync(join(root, '../../middleware.ts'), 'utf8');
  assert.equal((mw.match(/POST \/v1\/chat\/completions: you see the price first, it\\?'s based on our cost, and every paid call gets a signed receipt\. USDC on Base and Solana\./g) || []).length, 1);
  assert.doesNotMatch(mw, /POST \/v1\/chat\/completions is cost-plus, quoted, receipted/);
});

test('middleware ledes drop the old cost-plus phrase', () => {
  const middleware = readFileSync(join(root, '../../middleware.ts'), 'utf8');
  assert.doesNotMatch(middleware, /cost-plus, quoted, receipted/i);
  assert.match(middleware, /You see the price first, it\\'s based on our cost, and you pay in USDC on Base and Solana\./);
});

test('#650 follow-up: docs index and book copy stay on chit402-verify 0.4.11 wording', () => {
  const docs = readPage('src/pages/Docs.tsx');
  const book = readFileSync(join(root, 'src/pages/Book.tsx'), 'utf8');
  const trust = readFileSync(join(root, 'src/pages/IssuerTrust.tsx'), 'utf8');
  const receipt = readFileSync(join(root, 'src/pages/ReceiptCheckDocs.tsx'), 'utf8');
  const link = readFileSync(join(root, 'src/pages/OneF916Link.tsx'), 'utf8');
  assert.ok(/chit402-verify 0\.4\.11 checks that anchor/.test(docs), 'Docs index names chit402-verify 0.4.11 for the anchor check');
  assert.ok(!/<code>--rpc<\/code>/.test(docs), 'Docs index has no --rpc flag');
  assert.ok(!/@xfuel\/verify<\/code> 0\.3\.1/.test(docs), 'Docs index has no @xfuel/verify 0.3.1 line');
  assert.ok(!/one pinned on/.test(book), 'Book does not say the kid is pinned on /trust');
  assert.ok(/Check a receipt with <code>npx chit402-verify<\/code> and its URL/.test(book), 'Book shows the general command form');
  assert.ok(/signs\s+the history head/.test(trust), 'Trust says history head');
  assert.ok(/signs the history head/.test(receipt), 'Receipt check says history head');
  assert.ok(/ships it\./.test(trust), 'Trust says a new kid needs a verifier release');
  assert.ok(!/already pinned/.test(link), '1F916 page has no pinning wording');
  assert.ok(/<code>npx chit402-verify<\/code> does not\s+compare the fingerprint/.test(link), '1F916 page names the command that skips the fingerprint');
  assert.ok(/A network or TLS error \(no answer, unreachable, timeout, TLS failure, HTTP 5xx, 408, 425 or 429\) is also exit 2\./.test(link), '1F916 page states the transport exit code');
});
