import test from 'node:test';
import assert from 'node:assert/strict';
import { transformHtml } from '../scripts/prerender-titles.mjs';

const BASE = `<html><head><title>x</title>
<meta name="description" content="d" />
<meta property="og:title" content="t" />
<meta property="og:description" content="d" />
<meta property="og:url" content="u" />
<meta property="og:image" content="i" />
<meta name="twitter:title" content="t" />
<meta name="twitter:description" content="d" />
</head><body><div id="root"></div></body></html>`;

test('prerender inserts $ patterns in title, h1 and lede literally', () => {
  const pat = "Pay $& now $' and $` and $1 $$";
  const out = transformHtml(BASE, '/r', { title: pat, h1: pat, lede: pat });
  assert.ok(out.includes(`<title>${pat}</title>`));
  assert.ok(out.includes(`<meta property="og:title" content="${pat}" />`));
  assert.ok(out.includes(`<meta name="twitter:title" content="${pat}" />`));
  assert.ok(out.includes(`<h1>${pat}</h1>`));
  assert.ok(out.includes(`<p>${pat}</p>`));
  assert.ok(out.includes(`<meta name="description" content="${pat}" />`));
});
