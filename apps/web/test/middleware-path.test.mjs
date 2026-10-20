/**
 * The middleware writes the request path into the page head. A path must
 * never change the markup around it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, '../../middleware.ts'), 'utf8');
const start = src.indexOf('function escapeAttr');
const end = src.indexOf('export default async function middleware');
assert.ok(start > 0 && end > start, 'middleware helpers found');
const js = src.slice(start, end).replace(/\):\s*string\s*\{/g, ') {').replace(/(\w+):\s*(string|SeoConfig)/g, '$1');
const transformHtml = new Function(`${js}; return transformHtml;`)();

const page = readFileSync(join(root, 'index.html'), 'utf8');
const seo = { title: 'T', description: 'D', ogTitle: 'OT', ogDescription: 'OD', ogImage: 'https://x/i.png', domain: 'www.chit402.com', h1: 'H', lede: 'L' };
const pathOf = (raw) => new URL(`https://www.chit402.com${raw}`).pathname;

test('replacement patterns in the path are literal', () => {
  for (const raw of ["/v1/$'zq", '/v1/$&zq', '/v1/$$zq', '/v1/$1zq', "/v1/$'$&zq"]) {
    const p = pathOf(raw);
    const out = transformHtml(page, seo, p);
    const canon = out.match(/<link rel="canonical" href="([^"]*)" \/>/);
    assert.ok(canon, raw);
    assert.equal(canon[1], `https://www.chit402.com${p.replace(/&/g, '&amp;').replace(/'/g, '&#39;')}`, raw);
    assert.equal((out.match(/<head/g) || []).length, 1, `${raw}: head not duplicated`);
    assert.equal((out.match(/<\/html>/g) || []).length, 1, `${raw}: document not duplicated`);
  }
});

test('quotes and angle brackets in the path stay inside the attribute', () => {
  const out = transformHtml(page, seo, `/v1/"><svg onload=zz>'`);
  assert.doesNotMatch(out, /<svg onload=zz>/);
  assert.match(out, /href="https:\/\/www\.chit402\.com\/v1\/&quot;&gt;&lt;svg onload=zz&gt;&#39;"/);
});

test('a normal path renders unchanged', () => {
  const out = transformHtml(page, seo, '/v1/chat/completions');
  assert.match(out, /<link rel="canonical" href="https:\/\/www\.chit402\.com\/v1\/chat\/completions" \/>/);
  assert.match(out, /<title>T<\/title>/);
});
