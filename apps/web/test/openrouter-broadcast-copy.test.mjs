/**
 * OpenRouter Broadcast copy on www llms.txt, /docs, and /doors.
 * Source scans use assert.ok(re.test(src), msg). Files are read as text
 * and CR is stripped so a CRLF checkout matches an LF checkout.
 * The handler call is local esbuild. It does not touch the network.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(webRoot, '..', '..');

function readNorm(abs) {
  return readFileSync(abs, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

const MARKER = "haven't yet run the full flow end to end on a fresh account";

function assertNoOverclaim(src, label) {
  assert.ok(!/5 min/i.test(src), `${label} has no time claim`);
  assert.ok(!/csv/i.test(src), `${label} has no csv claim`);
  assert.ok(
    !/backfill/i.test(src.replace(/no backfill of past calls/gi, '')),
    `${label} has no backfill claim`,
  );
  assert.ok(
    !/verified/i.test(src.replace(/unverified/gi, '')),
    `${label} does not say verified outside unverified`,
  );
}

function markerWindow(src, limit) {
  const at = src.search(/haven't yet run the full flow end to end on a fresh account/);
  return at < 0 ? '' : src.slice(at, at + limit);
}

function insertionOf(oldText, newText) {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  let index = 0;
  let gaps = 0;
  let inGap = false;
  const extra = [];
  for (const line of newLines) {
    if (index < oldLines.length && line === oldLines[index]) {
      if (inGap) {
        gaps += 1;
        inGap = false;
      }
      index += 1;
    } else {
      inGap = true;
      extra.push(line);
    }
  }
  if (inGap) gaps += 1;
  return { consumed: index === oldLines.length, gaps, extra: extra.join('\n') };
}

async function servedChitBody() {
  const require = createRequire(new URL('../package.json', import.meta.url));
  const esbuild = require('esbuild');
  const result = await esbuild.build({
    entryPoints: [join(repoRoot, 'api/llms.txt.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    loader: { '.ts': 'ts' },
    write: false,
    logLevel: 'silent',
  });
  assert.ok(result.errors.length === 0, 'llms.txt.ts parses');
  const dir = mkdtempSync(join(tmpdir(), 'llms-broadcast-'));
  const outfile = join(dir, 'handler.mjs');
  try {
    writeFileSync(outfile, result.outputFiles[0].text);
    const { default: handler } = await import(pathToFileURL(outfile).href);
    let statusCode = 0;
    let body = '';
    const res = {
      setHeader() { return this; },
      status(code) { statusCode = code; return this; },
      send(content) { body = String(content); return this; },
    };
    handler({ headers: { host: 'www.chit402.com' } }, res);
    assert.ok(statusCode === 200, 'www llms.txt returns 200');
    return String(body).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const servedPromise = servedChitBody();

test('pre-change llms.txt lines stay byte-identical around one inserted block', async () => {
  const prior = readNorm(join(webRoot, 'test/fixtures/llms-expected-668.txt'));
  const body = await servedPromise;
  const inserted = insertionOf(prior, body);
  assert.ok(inserted.consumed, 'every pre-change llms.txt line appears in order and byte-identical');
  assert.ok(inserted.gaps === 1, 'the only change is one inserted block');
  assert.ok(
    /## Already pay OpenRouter\? Keep your route/.test(inserted.extra),
    'the inserted block is the OpenRouter Broadcast section',
  );
});

test('llms.txt Broadcast block states the webhook, new calls, unverified reports, and the guide', async () => {
  const body = await servedPromise;
  const block = body.match(/## Already pay OpenRouter\? Keep your route\n([\s\S]*?)\n## /)?.[1] ?? '';
  assert.ok(block.length > 0, 'Broadcast block is its own section');
  assert.ok(
    /https:\/\/api\.chit402\.com\/v1\/openrouter\/broadcast/.test(block),
    'block contains the webhook URL',
  );
  assert.ok(/new calls only/.test(block), 'block says new calls only');
  assert.ok(
    /Without an attached OpenRouter key[\s\S]{0,120}unverified/.test(block),
    'unverified marks reports with no OpenRouter key',
  );
  assert.ok(
    /https:\/\/github\.com\/XFuel-Lab\/chit402\/blob\/main\/docs\/product\/openrouter-broadcast\.md/.test(block),
    'block links the GitHub Broadcast guide',
  );
  assert.ok(/Chit's Broadcast receiver is on\./.test(block), 'block says Chit receiver is on');
  assert.ok(
    !/OpenRouter Broadcast is on by default/.test(block),
    'block does not call the receiver an OpenRouter setting',
  );
  assert.ok(
    /enable Broadcast under Settings > Observability/.test(block),
    'block says to enable Broadcast under Settings > Observability',
  );
  assert.ok(
    /GET \/v1\/openrouter\/books\/:book_id\/receipts/.test(block),
    'block names the receipts read route',
  );
  assert.ok(new RegExp(MARKER).test(block), 'block has the end-to-end marker');
  const near = markerWindow(block, 520);
  assert.ok(/POST \/v1\/openrouter\/books/.test(near), 'marker sits next to mint');
  assert.ok(/Settings > Observability/.test(near), 'marker sits next to the webhook step');
  assert.ok(
    /https:\/\/api\.chit402\.com\/v1\/openrouter\/broadcast/.test(near),
    'marker sits next to the webhook URL',
  );
  assert.ok(/optional key lets Chit check/.test(near), 'marker sits next to attach-key');
  assertNoOverclaim(block, 'llms.txt block');
  assert.ok(!/\bstranger\b/i.test(block), 'block does not say stranger');
});

test('/docs source contains the Broadcast heading and webhook URL', () => {
  const docsPage = readNorm(join(webRoot, 'src/pages/Docs.tsx'));
  const docsCopy = readNorm(join(webRoot, 'src/content/docsContent.mjs'));
  const docs = `${docsPage}\n${docsCopy}`;
  assert.ok(
    /<h2>\{openrouterKeepRouteTitle\}<\/h2>/.test(docsPage),
    '/docs renders the Broadcast block heading',
  );
  assert.ok(
    /openrouterKeepRouteParagraphs\(\)/.test(docsPage),
    '/docs renders the Broadcast block',
  );
  assert.ok(
    /Already pay OpenRouter\? Keep your route/.test(docs),
    '/docs source contains the Broadcast block heading',
  );
  assert.ok(
    /https:\/\/api\.chit402\.com\/v1\/openrouter\/broadcast/.test(docs),
    '/docs source contains the webhook URL',
  );
  const docsBlock = docsCopy.match(/export function openrouterKeepRouteParagraphs\(\) \{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.ok(docsBlock.length > 0, '/docs Broadcast block is present');
  assert.ok(/Chit's Broadcast receiver is on\./.test(docsBlock), '/docs says Chit receiver is on');
  assert.ok(
    !/OpenRouter Broadcast is on by default/.test(docsBlock),
    '/docs does not call the receiver an OpenRouter setting',
  );
  assert.ok(
    /enable Broadcast under Settings > Observability/.test(docsBlock),
    '/docs says to enable Broadcast under Settings > Observability',
  );
  assert.ok(
    /GET \/v1\/openrouter\/books\/:book_id\/receipts/.test(docsBlock),
    '/docs names the receipts read route',
  );
  assert.ok(new RegExp(MARKER).test(docsBlock), '/docs has the end-to-end marker');
  const docsNear = markerWindow(docsBlock, 700);
  assert.ok(/POST \/v1\/openrouter\/books/.test(docsNear), '/docs marker sits next to mint');
  assert.ok(/Settings > Observability/.test(docsNear), '/docs marker sits next to the webhook step');
  assert.ok(/BROADCAST_WEBHOOK/.test(docsNear), '/docs marker sits next to the webhook URL');
  assert.ok(/optional key lets Chit check/.test(docsNear), '/docs marker sits next to attach-key');
  assertNoOverclaim(docsBlock, '/docs block');
});

test('/doors sidecar card points OpenRouter at Broadcast and does not install the broken package', () => {
  const doors = readNorm(join(webRoot, 'src/pages/Doors.tsx'));
  const sidecar = doors.match(/<h2>3\. Sidecar<\/h2>[\s\S]*?<h2>4\. Chat-completions client<\/h2>/)?.[0] ?? '';
  assert.ok(sidecar.length > 0, 'Sidecar card is present');
  assert.ok(!/npm install chit402-sidecar/.test(doors), 'no npm install chit402-sidecar on /doors');
  assert.ok(
    /<code>chit402-sidecar<\/code> is local, client-recorded receipts only\. The npm package\s+is currently not importable\./.test(sidecar),
    'the package name stays next to the not-importable flag',
  );
  assert.ok(/OpenRouter Broadcast/.test(sidecar), 'Sidecar card names OpenRouter Broadcast');
  assert.ok(
    /https:\/\/api\.chit402\.com\/v1\/openrouter\/broadcast/.test(sidecar),
    'Sidecar card names the Broadcast webhook',
  );
  assert.ok(
    /Direct Groq calls have no server-side path today/.test(sidecar),
    'direct Groq calls have no server-side path',
  );
  assert.ok(!/Broadcast[^\n]{0,80}Groq/.test(sidecar), 'Groq is not on a Broadcast line');
  assert.ok(!/Groq[^\n]{0,80}Broadcast/.test(sidecar), 'Broadcast is not on the Groq line');
  const stepPara = sidecar.match(/<p>[\s\S]*?v1\/openrouter\/broadcast[\s\S]*?<\/p>/)?.[0] ?? '';
  assert.ok(stepPara.length > 0, 'Sidecar card has the OpenRouter step paragraph');
  assert.ok(
    /full flow end to end on a fresh account/.test(stepPara),
    'doors marker sits in the step paragraph',
  );
  assertNoOverclaim(sidecar, '/doors sidecar card');
});
