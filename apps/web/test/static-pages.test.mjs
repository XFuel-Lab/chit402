/**
 * Static HTML for /, /check, /docs and /pricing. Offline: no network.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { transformHtml, ROUTE_CONTENT } from '../scripts/prerender-titles.mjs';
import { homeContent } from '../src/content/homeContent.mjs';
import {
  contentForRoute,
  indexHtmlForBuild,
  injectStatic,
  loadChitStaticEnv,
  renderRouteHtml,
} from '../scripts/static-html.mjs';
import { chitHomePage, injectHomeIfRoot } from '../scripts/edge-home.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const shell = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const pinnedHeads = JSON.parse(readFileSync(new URL('./static-page-heads.json', import.meta.url), 'utf8'));
const { env, verifyUrl } = loadChitStaticEnv();

function norm(src) {
  return src.replace(/\r\n/g, '\n');
}

function readNorm(url) {
  return norm(readFileSync(url, 'utf8'));
}

function codeWithoutLiterals(src) {
  return norm(src)
    .replace(/`(?:\\[\s\S]|[^`])*`/g, '``')
    .replace(/'(?:\\.|[^'\n\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\n\\])*"/g, '""');
}

function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function rootInner(html) {
  const match = html.match(/<div id="root">([\s\S]*?)<\/div>/);
  return match ? match[1] : '';
}

function loadEdgeMiddleware(fetchImpl) {
  const src = readNorm(new URL('../../../middleware.ts', import.meta.url));
  const js = src
    .replace(/^import .*\n/gm, '')
    .replace(/export const config = \{[\s\S]*?\n\};\n/, '')
    .replace(/interface SeoConfig \{[\s\S]*?\n\}\n/, '')
    .replace(/:\s*SeoConfig/g, '')
    .replace(/:\s*Promise<Response>/g, '')
    .replace(/:\s*Request/g, '')
    .replace(/:\s*string/g, '')
    .replace(/:\s*boolean/g, '')
    .replace('export default async function middleware', 'async function middleware')
    .replace(/export \{ transformHtml \};?\n?/, '');
  const factory = new Function(
    'chitHomePage',
    'injectHomeIfRoot',
    'getHostConfig',
    'LIVE_RECEIPT_VERIFY_URL',
    'fetch',
    `${js}\nreturn { middleware, CHIT_HOME_SEO, CHIT_V1_SEO_FULL };`,
  );
  return factory(
    chitHomePage,
    injectHomeIfRoot,
    () => ({ githubUrl: env.githubUrl }),
    verifyUrl,
    fetchImpl,
  );
}

const edge = loadEdgeMiddleware(async () => new Response(shell, {
  status: 200,
  headers: { 'content-type': 'text/html; charset=utf-8' },
}));

async function edgeHtml(pathname, host = 'www.chit402.com') {
  const request = new Request(`https://${host}${pathname}`, {
    headers: { host },
  });
  const response = await edge.middleware(request);
  return response.text();
}

async function edgeResult({
  pathname = '/',
  host = 'www.chit402.com',
  body = shell,
  status = 200,
  contentType = 'text/html; charset=utf-8',
} = {}) {
  const mod = loadEdgeMiddleware(async () => new Response(body, {
    status,
    headers: { 'content-type': contentType },
  }));
  const request = new Request(`https://${host}${pathname}`, { headers: { host } });
  const response = await mod.middleware(request);
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    html: await response.text(),
  };
}

const servedHome = await edgeHtml('/');

function pageHtml(route) {
  const page = contentForRoute(route, env, verifyUrl);
  if (route === '/') return { page, html: servedHome };
  const meta = ROUTE_CONTENT[route];
  return { page, html: renderRouteHtml(shell, route, page, meta, transformHtml) };
}

const pages = Object.fromEntries(['/', '/check', '/docs', '/pricing'].map((route) => [route, pageHtml(route)]));

test('each main route renders its h1, sections, and at least 1,200 characters', () => {
  for (const [route, { page, html }] of Object.entries(pages)) {
    const h1 = html.match(/<h1>([^<]*)<\/h1>/);
    assert.equal(h1 && h1[1], page.h1, `${route} h1`);
    assert.ok(/(?:<h[23][\s>][\s\S]*?){3}/.test(html), `${route} has at least 3 section headings`);
    assert.ok(visibleText(html).length >= 1200, `${route} visible text is at least 1,200 characters`);
    assert.ok(/<h1>/.test(rootInner(html)), `${route} puts the h1 inside #root`);
  }
});

test('locked home strings are in the static html', () => {
  const html = pages['/'].html;
  assert.ok(/Who paid which call — and you still hold it\./.test(html), 'home hero h1');
  assert.ok(/Treasury desk and spend ledger/.test(html), 'home lead');
  assert.ok(/Check it yourself/.test(html), 'home check-it-yourself line');
  assert.ok(/href="\/book"/.test(html), 'home links /book');
  assert.ok(/href="\/check"/.test(html), 'home links /check');
  assert.ok(new RegExp(`href="${verifyUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(html), 'home links the live receipt');
});

test('locked check strings are in the static html', () => {
  const html = pages['/check'].html;
  assert.ok(/Free/.test(html), 'check is free');
  assert.ok(/no account/.test(html), 'check needs no account');
  assert.ok(/Paste a receipt, a receipt id, or a receipt URL/.test(html), 'check says what to paste');
});

test('locked docs strings are in the static html', () => {
  const html = pages['/docs'].html;
  assert.ok(/What the book is, and isn&#39;t/.test(html), 'docs card title');
  assert.ok(/Collected vs client-attested, what a receipt proves/.test(html), 'docs card description');
  assert.ok(/href="\/products"/.test(html), 'docs products link');
  assert.ok(/href="\/docs\/chit-in-15-lines"/.test(html), 'docs chit-in-15-lines link');
  assert.ok(/href="\/doors"/.test(html), 'docs doors link');
  assert.ok(/(?:<a href="[^"]+"[\s\S]*?){10}/.test(html), 'docs has at least 10 anchors');
});

test('locked pricing strings are in the static html', () => {
  const html = pages['/pricing'].html;
  assert.ok(/\$0\.002/.test(html), 'pricing states $0.002 per receipt');
  assert.ok(/cost \+ 1%/.test(html), 'pricing states Private Desk cost + 1%');
  assert.ok(/^(?![\s\S]*monthly plan)[\s\S]*$/.test(html), 'pricing has no monthly plan');
  assert.ok(/^(?![\s\S]*per month)[\s\S]*$/.test(html), 'pricing has no per-month price');
  assert.ok(/Tier-2 settlement proofs are off while we upgrade the proving system; standard \$0\.002 receipts are unaffected\./.test(html), 'Tier-2 settlement proofs are off');
  assert.ok(/^(?![\s\S]*\$0\.10)[\s\S]*$/.test(html), 'pricing shows no Tier-2 price');
});

test('primary links are real anchors and not hash placeholders', () => {
  for (const html of Object.values(pages).map((entry) => entry.html)) {
    assert.ok(/^(?![\s\S]*href="#")[\s\S]*$/.test(html), 'no href="#" placeholder');
    assert.ok(/^(?![\s\S]*href='#')[\s\S]*$/.test(html), 'no href=\'#\' placeholder');
  }
  assert.ok(/href="\/book"/.test(pages['/'].html), '/book is an anchor on home');
  assert.ok(/href="\/check"/.test(pages['/'].html), '/check is an anchor on home');
});

test('fixture copy with script, ampersand and quotes is escaped, and $& stays literal', () => {
  const evil = {
    h1: 'Heading',
    sections: [
      { heading: 'One', paragraphs: ['<script>&"\''] },
      { heading: 'Two $&', paragraphs: ["keep $' literal"] },
      { heading: 'Three', paragraphs: ['body'] },
    ],
  };
  const rootHtml = rootInner(injectStatic(shell, evil));
  assert.ok(/&lt;script&gt;&amp;&quot;&#39;/.test(rootHtml), 'fixture copy containing <script>&"\' is escaped');
  assert.ok(/^(?![\s\S]*<script)[\s\S]*$/.test(rootHtml), 'injected block has no script tag');
  assert.ok(/Two \$&amp;/.test(rootHtml), '$& in copy is inserted literally');
  assert.ok(/keep \$&#39; literal/.test(rootHtml), "$' in copy is inserted literally");
  assert.ok(/^(?![\s\S]*Two <div id="root">)[\s\S]*$/.test(rootHtml), '$& was not expanded to the matched text');
});

test('page components and the generator read the shared content', () => {
  const pagesDir = new URL('../src/pages/', import.meta.url);
  const checks = [
    ['ChitHome.tsx', /from '\.\.\/content\/homeContent\.mjs'/],
    ['ReceiptCheck.tsx', /from '\.\.\/content\/checkContent\.mjs'/],
    ['Docs.tsx', /from '\.\.\/content\/docsContent\.mjs'/],
    ['Pricing.tsx', /from '\.\.\/content\/pricingContent\.mjs'/],
  ];
  for (const [file, re] of checks) {
    const src = readNorm(new URL(file, pagesDir));
    assert.ok(re.test(src), `${file} imports shared content`);
  }
  const generator = readNorm(new URL('../scripts/static-html.mjs', import.meta.url));
  assert.ok(/homeContent\.mjs/.test(generator), 'generator reads home content');
  assert.ok(/checkContent\.mjs/.test(generator), 'generator reads check content');
  assert.ok(/docsContent\.mjs/.test(generator), 'generator reads docs content');
  assert.ok(/pricingContent\.mjs/.test(generator), 'generator reads pricing content');
  const prerender = readNorm(new URL('../scripts/prerender-titles.mjs', import.meta.url));
  assert.ok(/contentForRoute\(/.test(prerender), 'prerender reads shared route content');
  assert.ok(/injectStatic\(/.test(prerender), 'prerender injects the static block');
  assert.ok(/STATIC_ROUTES = \['\/', '\/check', '\/docs', '\/pricing'\]/.test(generator), 'generator lists the four routes');
});

test('a string changed in the shared source changes the generated html', () => {
  for (const [route, { page }] of Object.entries(pages)) {
    const changed = structuredClone(page);
    changed.h1 = `${page.h1} PARITY_${route}`;
    const html = injectStatic(shell, changed);
    assert.ok(new RegExp(`PARITY_${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(html), `${route} in-memory copy changes the html`);
  }
  assert.equal(pages['/'].page.h1, homeContent.h1, 'home html h1 is the shared home h1');
});

test('static html does not freeze live receipt box values or a receipt count', () => {
  for (const [route, { html }] of Object.entries(pages)) {
    assert.ok(/^(?![\s\S]*<1k receipts)[\s\S]*$/.test(html), `${route} has no <1k receipts count`);
    assert.ok(/^(?![\s\S]*(?<![\d.])\d{2,}\s+receipts\b)[\s\S]*$/.test(html), `${route} has no receipt count`);
    assert.ok(/^(?![\s\S]*2026-10-19T02:23:00\.000Z)[\s\S]*$/.test(html), `${route} has no live receipt date`);
    assert.ok(/^(?![\s\S]*0x731e4fdc70a8dba370c579c23e8520d2edcde052f28abaf3ed26c95c8603116f)[\s\S]*$/.test(html), `${route} has no live receipt payment`);
    assert.ok(/^(?![\s\S]*Live collected row)[\s\S]*$/.test(html), `${route} has no live receipt box badge`);
  }
});

test('title, meta and canonical tags stay on today\'s bytes for /pricing and /docs', () => {
  for (const route of ['/pricing', '/docs']) {
    const html = transformHtml(shell, route, ROUTE_CONTENT[route]);
    const head = html.match(/<head>[\s\S]*<\/head>/)[0];
    assert.equal(norm(head), norm(pinnedHeads[route]), `${route} head is unchanged`);
    assert.ok(/<link rel="canonical" href="https:\/\/www\.chit402\.com[^"]*" \/>/.test(html), `${route} keeps its canonical link`);
  }
  for (const route of ['/check', '/pricing', '/docs']) {
    const html = transformHtml(shell, route, ROUTE_CONTENT[route]);
    assert.ok(new RegExp(`<title>${ROUTE_CONTENT[route].title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\\/title>`).test(html), `${route} title`);
    assert.ok(/rel="canonical"/.test(html), `${route} canonical link stays`);
  }
});

test('the shared index shell has no home copy, and only / receives it', () => {
  const built = indexHtmlForBuild(shell);
  assert.equal(rootInner(built), '', 'dist/index.html keeps an empty #root');
  assert.ok(/^(?![\s\S]*Who paid which call — and you still hold it)[\s\S]*$/.test(built), 'index.html has no home copy');
  const page = chitHomePage(verifyUrl, env.githubUrl);
  for (const path of ['/security', '/docs/doors', '/board/abc', '/v1/sub', '/no-such-page']) {
    const html = injectHomeIfRoot(built, path, page);
    assert.equal(rootInner(html), '', `${path} stays an empty shell`);
    assert.ok(/^(?![\s\S]*Who paid which call — and you still hold it)[\s\S]*$/.test(html), `${path} has no home copy`);
  }
  const home = injectHomeIfRoot(built, '/', page);
  assert.ok(/Who paid which call — and you still hold it\./.test(rootInner(home)), '/ receives the home block inside #root');
});

test('the middleware entry serves /, /v1/sub, and /security', async () => {
  const home = await edgeHtml('/');
  const sub = await edgeHtml('/v1/sub');
  const security = await edgeHtml('/security');
  const homeSeo = edge.CHIT_HOME_SEO;
  const v1Seo = edge.CHIT_V1_SEO_FULL;
  assert.ok(new RegExp(`<title>${homeSeo.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\\/title>`).test(home), '/ uses the middleware home title');
  assert.ok(home.includes(`<h1>${homeSeo.h1}</h1>`), '/ keeps the middleware noscript h1');
  assert.ok(home.includes(homeSeo.lede), '/ keeps the middleware noscript lede');
  assert.ok(/Who paid which call — and you still hold it\./.test(rootInner(home)), '/ injects the home block');
  assert.ok(/<div id="root">[\s\S]*?<\/div>\s*<noscript>/.test(home), 'noscript is inserted after #root');
  assert.ok(new RegExp(`<title>${v1Seo.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\\/title>`).test(sub), '/v1/sub uses the middleware v1 title');
  assert.ok(/<link rel="canonical" href="https:\/\/www\.chit402\.com\/v1\/sub" \/>/.test(sub), '/v1/sub canonical uses the real path');
  assert.ok(sub.includes(`<h1>${v1Seo.h1}</h1>`), '/v1/sub keeps the v1 noscript h1');
  assert.ok(/^(?![\s\S]*Who paid which call — and you still hold it)[\s\S]*$/.test(sub), '/v1/sub has no home copy');
  assert.equal(rootInner(security), '', '/security keeps an empty #root');
  assert.ok(/^(?![\s\S]*Who paid which call — and you still hold it)[\s\S]*$/.test(security), '/security has no home copy');
  for (const host of ['example.vercel.app', 'evilchit402.com']) {
    const html = await edgeHtml('/', host);
    assert.equal(html, shell, `${host} / is unchanged`);
    assert.ok(/^(?![\s\S]*Who paid which call — and you still hold it)[\s\S]*$/.test(html), `${host} / has no home block`);
  }
});

test('the edge matcher is /, /v1, and /v1/*', () => {
  const src = readNorm(new URL('../../../middleware.ts', import.meta.url));
  assert.ok(/matcher:\s*\[\s*'\/',\s*'\/v1',\s*'\/v1\/:path\*',\s*\]/.test(src), 'matcher is /, /v1, and /v1/*');
});

test('home and the book say third-party-verifiable', () => {
  const home = readNorm(new URL('../src/content/homeContent.mjs', import.meta.url));
  const book = readNorm(new URL('../src/pages/Book.tsx', import.meta.url));
  assert.ok(/third-party-verifiable/.test(home), 'home card says third-party-verifiable');
  assert.ok(/third-party-verifiable receipt page/.test(book), 'book says third-party-verifiable receipt page');
});

test('non-HTML and 404 responses pass through the middleware unchanged', async () => {
  const json = await edgeResult({
    body: '{"ok":true}',
    contentType: 'application/json',
  });
  assert.equal(json.html, '{"ok":true}', 'non-HTML body is unchanged');
  assert.equal(json.contentType, 'application/json', 'non-HTML content-type is unchanged');
  assert.ok(/^(?![\s\S]*Who paid which call — and you still hold it)[\s\S]*$/.test(json.html), 'non-HTML has no home block');
  const missing = await edgeResult({ status: 404 });
  assert.equal(missing.status, 404, '404 status is unchanged');
});

test('the prerender script leaves index.html as the plain shell', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chit-prerender-'));
  try {
    cpSync(join(root, 'index.html'), join(dir, 'index.html'));
    const before = readNorm(join(dir, 'index.html'));
    const result = spawnSync(process.execPath, ['scripts/prerender-titles.mjs'], {
      cwd: root,
      env: { ...process.env, CHIT_PRERENDER_DIST: dir },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const after = readNorm(join(dir, 'index.html'));
    assert.equal(after, before, 'index.html is still the plain shell');
    assert.equal(rootInner(after), '', 'built index.html has an empty #root');
    assert.ok(/^(?![\s\S]*Who paid which call — and you still hold it)[\s\S]*$/.test(after), 'built index.html has no home copy');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hrefs use only http, https, mailto, or a relative path', () => {
  const allowed = /^(?:https?:\/\/|mailto:|\/(?!\/)|\.\.?\/)/;
  for (const [route, { html }] of Object.entries(pages)) {
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
    assert.ok(hrefs.length > 0, `${route} has anchors`);
    for (const href of hrefs) {
      assert.ok(allowed.test(href), `${route} href ${href} is http, https, mailto, or relative`);
    }
  }
});

test('the generator and the modules it imports do not fetch', () => {
  const entry = resolve(root, 'scripts/prerender-titles.mjs');
  const edge = resolve(root, 'scripts/edge-home.mjs');
  const seen = new Set();
  const queue = [entry, edge];
  while (queue.length) {
    const abs = queue.pop();
    if (seen.has(abs)) continue;
    seen.add(abs);
    const src = readNorm(abs);
    const dir = dirname(abs);
    for (const match of src.matchAll(/from '(\.[^']+)'/g)) {
      let next = resolve(dir, match[1]);
      if (!next.endsWith('.mjs') && !next.endsWith('.js')) next += '.mjs';
      queue.push(next);
    }
  }
  for (const file of seen) {
    const src = codeWithoutLiterals(readFileSync(file, 'utf8'));
    const label = file.slice(root.length + 1);
    assert.ok(/^(?![\s\S]*\bfetch\s*\()[\s\S]*$/.test(src), `${label} does not call fetch`);
    assert.ok(/^(?![\s\S]*https:\/\/api\.chit402\.com)[\s\S]*$/.test(src), `${label} does not call https://api.chit402.com`);
  }
  assert.ok(seen.size >= 5, 'generator import scan covers the content modules');
  const planted = codeWithoutLiterals('export function pull() {\n  return fetch("https://api.chit402.com/health");\n}\n');
  assert.ok(/\bfetch\s*\(/.test(planted), 'a real fetch( call stays visible and fails the no-fetch guard');
  assert.ok(/^(?![\s\S]*\bfetch\s*\()[\s\S]*$/.test('const ok = 1;\n'), 'the no-fetch guard passes a file with no call');
});
