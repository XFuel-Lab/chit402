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
  assert.match(text, /the book/i, `${label} leads with the book`);
  assert.match(text, /hub, model, and amount/i, `${label} names hub, model, and amount`);
  assert.match(text, /\$0\.01 USDC/, `${label} names $0.01 USDC`);
  assert.match(text, /Base and Solana/, `${label} names Base and Solana`);
  assert.match(text, /\/v1\/chat\/completions/, `${label} names POST /v1/chat/completions`);
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

test('shared layout and homepage copy do not call paid /v1 unmetered or a free path', () => {
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
    assert.match(source, /\$0\.01 USDC on Base and Solana/, `${label} names the public door`);
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
  assert.match(home, /Not a smart router/);
  assert.match(home, /Not a model shop/);
  assert.doesNotMatch(home, /best available provider/i);
  assert.doesNotMatch(home, /Swap one baseURL/);
  assert.doesNotMatch(home, /crypto control plane/i);
});

test('README first paragraph leads with the book', () => {
  const readme = readFileSync(join(root, '../../README.md'), 'utf8');
  const firstPara = readme.split(/\n\n/)[1] ?? '';
  assert.match(firstPara, /XFuel is the book/);
  assert.match(firstPara, /You hold hub, model, and amount/);
  assert.doesNotMatch(firstPara, /best available provider/i);
  assert.doesNotMatch(firstPara, /crypto control plane/i);
  assert.match(firstPara, /Not a smart router/);
  assert.match(firstPara, /Not a model shop/);
});
