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
  assert.ok(!/5 min/i.test(block), 'block does not say 5 min');
  assert.ok(!/csv/i.test(block), 'block does not say csv');
  assert.ok(!/verified/i.test(block.replace(/unverified/gi, '')), 'block does not say verified outside unverified');
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
  assert.ok(/Groq has no server-side path today/.test(sidecar), 'Groq has no server-side path');
  assert.ok(!/Broadcast[^\n]{0,80}Groq/.test(sidecar), 'Groq is not on a Broadcast line');
  assert.ok(!/Groq[^\n]{0,80}Broadcast/.test(sidecar), 'Broadcast is not on the Groq line');
  assert.ok(!/5 min/i.test(sidecar), 'Sidecar card does not say 5 min');
  assert.ok(!/csv/i.test(sidecar), 'Sidecar card does not say csv');
  assert.ok(!/verified/i.test(sidecar.replace(/unverified/gi, '')), 'Sidecar card does not say verified outside unverified');
});
