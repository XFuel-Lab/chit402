/**
 * Public receipt card. T1–T17 from the receipt-page design review.
 * JSON shells, preimages, and inclusion bodies keep the stored xfuel- id.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.TASK_STORE_DIR = join(mkdtempSync(join(tmpdir(), 'chit-receipt-shell-')), 'tasks');
delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;
delete process.env.SOLANA_ANCHOR_SECRET_KEY;
delete process.env.SOLANA_RPC_URL;

const { createApp } = await import('../src/server.js');
const { initAIListener, getAIListener } = await import('../src/ai-listener.js');
const { getReceiptMerkleTree, resetReceiptMerkleTree } = await import('../src/receipt-merkle.js');
const { normalizeTaskIdForLookup } = await import('../src/receipt.js');
const {
  toPublicShell,
  shellPreimageBytes,
  renderReceiptShellHtml,
  RECEIPT_HTML_CSP,
} = await import('../src/receipt-shell.js');
const {
  displayTaskIdForShare,
  shortReceiptIdForShare,
} = await import('../src/receipt-og-meta.js');
const { buildReceiptOgSvg, renderReceiptOgPng } = await import('../src/receipt-og.js');

const here = fileURLToPath(new URL('.', import.meta.url));
const UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const STORED = `xfuel-${UUID}`;
const DISPLAY = `chit-${UUID}`;
const SHORT = `chit-aaaaaaaa…`;
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const SOLANA_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TX = `0x${'ab'.repeat(32)}`;
const PAYEE = '0x23f713411c30BBd9A989c9cbC22EB0b55F7f7334';
const SOL_SIG = '5'.repeat(87);

const PAYER = '0xPRIVPAYER111111111111111111111111111111';
const MODEL = 'sentinel-model-qqqq';
const PROVIDER = 'sentinel-provider-qqqq';
const PROMPT = 'sentinel-prompt-qqqq';
const OUTPUT = 'sentinel-output-qqqq';
const MEMO = '"><script>alert(1)</script>';
const AGENT = 'sentinel-agent-998877';
const BOOK = 'orb_sentinel_book_qqqq';
const TOKENS = '42424242';

const NO_LOG = 'xfuel-bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const OR_ID = `openrouter-${'cd'.repeat(16)}`;
const OR_GEN = '"><img src=x onerror=alert(1)>';

let server;
let base;
let httpApp;
const planted = [];

function paidTask(taskId, extra = {}) {
  return {
    taskId,
    status: 'completed',
    createdAt: 1_790_962_201_000,
    updatedAt: 1_790_962_202_000,
    intent: {
      type: 'inference_request',
      paymentRail: 'usdc',
      paymentRef: `base:${TX}`,
      amount: '2000',
      modelId: MODEL,
      prompt: PROMPT,
      ...(extra.intent || {}),
    },
    meta: {
      payerWallet: PAYER,
      payTo: PAYEE,
      paymentAsset: BASE_USDC,
      provider: PROVIDER,
      chain: 'base',
      agentId: AGENT,
      memo: MEMO,
      book_id: BOOK,
      ...(extra.meta || {}),
    },
    result: {
      provider: PROVIDER,
      model: MODEL,
      output: OUTPUT,
      text: OUTPUT,
    },
    usage: { prompt_tokens: Number(TOKENS), completion_tokens: 7, total_tokens: Number(TOKENS) + 7 },
    book_id: BOOK,
    ...extra.top,
  };
}

before(async () => {
  resetReceiptMerkleTree();
  await initAIListener();
  const store = getAIListener().activeTasks;
  httpApp = createApp();
  const tree = getReceiptMerkleTree();
  const put = (task) => {
    store.set(task.taskId, task);
    planted.push(task.taskId);
  };
  const main = paidTask(STORED);
  put(main);
  tree.appendReceipt(STORED, 'row-shell-card', { publish: false });
  put(paidTask(NO_LOG, {
    intent: { paymentRef: `base:0x${'ef'.repeat(32)}` },
  }));
  put({
    taskId: OR_ID,
    status: 'completed',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_001_000,
    kind: 'openrouter_broadcast',
    intent: {
      type: 'openrouter_broadcast',
      paymentRail: 'reported',
      paymentRef: `openrouter:${BOOK}:${OR_GEN}`,
      amount: '460',
      model: MODEL,
    },
    meta: {
      paymentAsset: 'USD',
      provider: PROVIDER,
      payerWallet: PAYER,
      memo: MEMO,
      book_id: BOOK,
      agentId: AGENT,
    },
    result: { provider: PROVIDER, model: MODEL, output: OUTPUT },
    book_id: BOOK,
  });
  await new Promise((resolve) => {
    server = httpApp.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  try {
    const store = getAIListener().activeTasks;
    for (const id of planted) store.delete(id);
  } catch { /* listener already down */ }
  resetReceiptMerkleTree();
});

async function fetchText(path, headers) {
  const res = await fetch(`${base}${path}`, { headers, redirect: 'manual' });
  const text = await res.text();
  return { status: res.status, text, headers: res.headers, type: res.headers.get('content-type') || '' };
}

function rawGet(path, headers = {}) {
  const url = new URL(path, base);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        text: Buffer.concat(chunks).toString('utf8'),
        type: String(res.headers['content-type'] || ''),
        headers: {
          get(name) {
            const value = res.headers[name.toLowerCase()];
            return Array.isArray(value) ? value.join(', ') : (value || null);
          },
        },
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

function attributeValues(html) {
  const values = [];
  const tagRe = /<[^>]+>/g;
  let tag;
  while ((tag = tagRe.exec(html))) {
    const attrRe = /=\s*"([^"]*)"|=\s*'([^']*)'/g;
    let attr;
    const raw = tag[0];
    while ((attr = attrRe.exec(raw))) values.push(attr[1] ?? attr[2] ?? '');
    const stripped = raw.replace(/=\s*"[^"]*"/g, '=Q').replace(/=\s*'[^']*'/g, '=Q');
    if (stripped.includes('"') || stripped.includes("'")) {
      throw new Error(`broken attribute: ${raw}`);
    }
  }
  return values;
}

function svgTexts(svg) {
  return [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((match) => match[1]
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"'));
}

test('T5 display id round-trips and leaves other families alone', () => {
  const families = [
    'xfuel-39af100b-23dd-4d86-a16b-4556ca6796af',
    'xfuel-job-board-77',
    'xfuel-assign-9',
    'foreign-x402-muy1hh8y',
    'openrouter-abcdef0123456789abcdef0123456789',
    'ingest-stamp-44',
  ];
  for (const id of families) {
    const shown = displayTaskIdForShare(id);
    assert.equal(normalizeTaskIdForLookup(shown), id, id);
    if (!id.startsWith('xfuel-')) assert.equal(shown, id);
    else assert.equal(shown, `chit-${id.slice(6)}`);
  }
});

test('T2 quote escape: attributes have no raw quotes and no script handlers', () => {
  const nasty = `"'<>&`;
  const shell = {
    receipt_id: nasty,
    payload_version: nasty,
    asset: nasty,
    chain: nasty,
    pay_to: nasty,
    amount_gross: nasty,
    amount_settled: nasty,
    payment_tx: nasty,
    issued_at: nasty,
    payer_wallet: PAYER,
    inclusion: {
      leaf_hash: nasty,
      proof: [nasty],
      signed_head: { root: nasty, tree_size: nasty, signature: `eyJ${nasty}.jws` },
    },
  };
  const html = renderReceiptShellHtml(shell, { publicBaseUrl: 'https://api.chit402.com' });
  for (const value of attributeValues(html)) {
    assert.equal(value.includes('"'), false, value);
    assert.equal(value.includes("'"), false, value);
  }
  assert.equal(html.includes('<script'), false);
  assert.equal(html.includes('onerror='), false);
  assert.equal(html.includes('javascript:'), false);
  assert.equal(html.includes(PAYER), false);
  assert.equal(html.includes('eyJ'), false);
  assert.match(html, /&quot;&#39;&lt;&gt;&amp;/);
});

test('T11 tx links only for real base and solana refs', () => {
  const page = (chain, tx) => renderReceiptShellHtml({
    receipt_id: STORED,
    chain,
    payment_tx: tx,
    pay_to: PAYEE,
    asset: BASE_USDC,
    amount_gross: '2000',
    amount_settled: '2000',
  });
  const baseHtml = page('base', TX);
  assert.match(baseHtml, new RegExp(`href="https://basescan\\.org/tx/${TX}"`));
  assert.match(baseHtml, /rel="noopener noreferrer"/);
  const solHtml = page('solana', SOL_SIG);
  assert.match(solHtml, new RegExp(`href="https://solscan\\.io/tx/${SOL_SIG}"`));
  for (const [chain, tx] of [
    ['base', 'javascript:alert(1)'],
    ['base', '"><img'],
    ['base', 'not-a-hash'],
    ['solana', TX],
    ['openrouter', TX],
    ['reported', SOL_SIG],
  ]) {
    const html = page(chain, tx);
    assert.equal(html.includes('basescan.org'), false, `${chain} ${tx}`);
    assert.equal(html.includes('solscan.io'), false, `${chain} ${tx}`);
    assert.equal(html.includes('javascript:'), false, chain);
  }
});

test('T12 USDC label and matches tick follow the shell', () => {
  const page = (overrides) => renderReceiptShellHtml({
    receipt_id: STORED,
    chain: 'base',
    asset: BASE_USDC,
    amount_gross: '2000',
    amount_settled: '2000',
    payment_tx: TX,
    ...overrides,
  });
  const known = page();
  assert.match(known, /\$0\.002 <small>USDC<\/small>/);
  assert.match(known, /✓ matches/);
  const sepolia = page({ chain: 'base-sepolia', asset: BASE_SEPOLIA_USDC });
  assert.match(sepolia, /\$0\.002 <small>USDC<\/small>/);
  const solana = page({ chain: 'solana', asset: SOLANA_USDC, payment_tx: SOL_SIG });
  assert.match(solana, /\$0\.002 <small>USDC<\/small>/);
  const wrongChain = page({ chain: 'solana', asset: BASE_USDC, payment_tx: SOL_SIG });
  assert.equal(wrongChain.includes('$0.002'), false);
  assert.match(wrongChain, /2000 <small>0x8335…2913<\/small>/);
  const unknown = page({ asset: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' });
  assert.equal(unknown.includes('$0.002'), false);
  assert.equal(unknown.includes('>USDC<'), false);
  assert.match(unknown, /2000 <small>0xdead…beef<\/small>/);
  assert.match(unknown, /✓ matches/);
  const uneven = page({ amount_settled: '1990' });
  assert.equal(uneven.includes('✓'), false);
  assert.equal(uneven.includes('matches'), false);
  const open = page({
    chain: null,
    asset: 'USD',
    amount_gross: '460',
    amount_settled: null,
    payment_tx: OR_GEN,
    pay_to: PAYEE,
  });
  assert.match(open, /not settled by Chit402/);
  assert.equal(open.includes('✓'), false);
  assert.equal(open.includes('USDC'), false);
  assert.equal(open.includes('basescan'), false);
});

test('T1 route HTML hides private sentinels for every HTML accept', async () => {
  const probes = [
    fetchText(`/receipt/${DISPLAY}`, { accept: 'text/html' }),
    fetchText(`/receipt/${DISPLAY}`, { accept: '*/*' }),
    rawGet(`/receipt/${DISPLAY}`),
    fetchText(`/receipt/${DISPLAY}`, { accept: 'application/xml' }),
  ];
  for (const pending of probes) {
    const res = await pending;
    assert.equal(res.status, 200, res.text.slice(0, 180));
    assert.match(res.type, /html/);
    for (const secret of [PAYER, MODEL, PROVIDER, PROMPT, OUTPUT, MEMO, AGENT, BOOK, TOKENS, '<script', 'eyJ']) {
      assert.equal(res.text.includes(secret), false, `leaked ${secret}`);
    }
    assert.equal(res.text.includes('jws'), false);
    assert.doesNotMatch(res.text, /verified/i);
  }
});

test('T3 host header cannot set canonical, og:url, or og:image', () => {
  const gatewayDir = join(here, '..');
  const dir = mkdtempSync(join(tmpdir(), 'chit-host-'));
  const script = join(dir, 'host.mjs');
  writeFileSync(script, `
    import net from 'node:net';
    import { createApp } from ${JSON.stringify(join(gatewayDir, 'src/server.js'))};
    import { initAIListener, getAIListener } from ${JSON.stringify(join(gatewayDir, 'src/ai-listener.js'))};
    import { resetReceiptMerkleTree } from ${JSON.stringify(join(gatewayDir, 'src/receipt-merkle.js'))};
    const id = ${JSON.stringify(STORED)};
    resetReceiptMerkleTree();
    await initAIListener();
    const app = createApp();
    getAIListener().activeTasks.set(id, {
      taskId: id,
      status: 'completed',
      createdAt: 1790962201000,
      intent: { type: 'inference_request', paymentRail: 'usdc', paymentRef: 'base:${TX}', amount: '2000' },
      meta: { chain: 'base', paymentAsset: ${JSON.stringify(BASE_USDC)}, payTo: ${JSON.stringify(PAYEE)} },
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const port = server.address().port;
    function raw(host) {
      return new Promise((resolve, reject) => {
        const sock = net.connect(port, '127.0.0.1', () => {
          sock.write(
            'GET /receipt/${DISPLAY} HTTP/1.1\\r\\n' +
            'Host: ' + host + '\\r\\n' +
            'Accept: text/html\\r\\n' +
            'Connection: close\\r\\n\\r\\n'
          );
        });
        const chunks = [];
        sock.on('data', (chunk) => chunks.push(chunk));
        sock.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        sock.on('error', reject);
      });
    }
    const hosts = ['api.chit402.com:1" data-x="', 'api.chit402.com:443@evil.example'];
    const out = {};
    for (const host of hosts) out[host] = await raw(host);
    console.log('T3_JSON ' + JSON.stringify(out));
    server.close();
    process.exit(0);
  `);
  const run = spawnSync(process.execPath, [script], {
    cwd: gatewayDir,
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env,
      PUBLIC_BASE_URL: 'https://api.chit402.com',
      PUBLIC_HOSTS: 'api.chit402.com,api.xfuel.app',
      HUB_CATALOG_OFFLINE: 'true',
      NODE_ENV: 'test',
      RECEIPT_ANCHOR_PRIVATE_KEY: '',
      SOLANA_ANCHOR_SECRET_KEY: '',
      SOLANA_RPC_URL: '',
    },
  });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  const line = run.stdout.split('\n').find((row) => row.startsWith('T3_JSON '));
  assert.ok(line, run.stdout.slice(0, 500));
  const bodies = JSON.parse(line.slice('T3_JSON '.length));
  for (const raw of Object.values(bodies)) {
    assert.match(raw, /^HTTP\/1\.1 200/);
    const html = raw.slice(raw.indexOf('\r\n\r\n') + 4);
    const canonical = html.match(/rel="canonical" href="([^"]*)"/)[1];
    const ogUrl = html.match(/property="og:url" content\s*=\s*"([^"]*)"/)[1];
    const ogImage = html.match(/property="og:image" content\s*=\s*"([^"]*)"/)[1];
    for (const value of [canonical, ogUrl, ogImage]) {
      assert.ok(value.startsWith('https://api.chit402.com/'), value);
      assert.equal(value.includes('evil.example'), false, value);
      assert.equal(value.includes('data-x'), false, value);
    }
    assert.equal(ogUrl, canonical);
    assert.equal(ogImage, `${canonical}/og.png`);
  }
});

test('T4 one canonical body for xfuel, chit, trailing slash, and junk format', async () => {
  const paths = [
    `/receipt/${STORED}`,
    `/receipt/${DISPLAY}`,
    `/receipt/${DISPLAY}/`,
    `/receipt/${DISPLAY}?format=junk`,
  ];
  const bodies = [];
  for (const path of paths) {
    const res = await fetchText(path, { accept: 'text/html' });
    assert.equal(res.status, 200, `${path} ${res.text.slice(0, 160)}`);
    assert.match(res.type, /html/);
    bodies.push(res.text);
  }
  assert.equal(bodies[1], bodies[0]);
  assert.equal(bodies[2], bodies[0]);
  assert.equal(bodies[3], bodies[0]);
  assert.match(bodies[0], new RegExp(`rel="canonical" href="/receipt/${DISPLAY}"`));
  assert.match(bodies[0], new RegExp(`property="og:url" content\\s*=\\s*"/receipt/${DISPLAY}"`));
});

test('T6 full chit id is on the page and xfuel stays in the footer and inclusion link', async () => {
  const res = await fetchText(`/receipt/${DISPLAY}`);
  assert.equal(res.status, 200);
  assert.match(res.text, new RegExp(`<div class="id">${DISPLAY}</div>`));
  assert.match(res.text, new RegExp(`<title>Chit402 receipt · ${SHORT}</title>`));
  assert.match(res.text, new RegExp(`property="og:title" content\\s*=\\s*"Chit402 receipt · ${SHORT}"`));
  assert.match(res.text, new RegExp(`Signed id ${STORED} — use this exact string for JSON, log and verifier checks`));
  assert.match(res.text, new RegExp(`href="/v1/receipts/${STORED}/inclusion"`));
  const hidden = res.text
    .replaceAll(`Signed id ${STORED}`, '')
    .replaceAll(`/v1/receipts/${STORED}/inclusion`, '');
  assert.equal(hidden.includes(STORED), false);
  assert.equal(hidden.includes('xfuel-'), false);
  assert.equal(shortReceiptIdForShare(STORED), SHORT);
  const withoutTitles = hidden
    .replace(/<title>[^<]*<\/title>/, '')
    .replace(/property="og:title" content\s*=\s*"[^"]*"/, '');
  assert.equal(withoutTitles.includes(SHORT), false);
  assert.doesNotMatch(res.text, /verified/i);
});

test('T7 shell and preimage bytes match the golden captures', async () => {
  const dir = join(here, 'fixtures/receipt-shell');
  for (const name of ['chit-39af100b', 'chit-1ebc5616']) {
    const receipt = JSON.parse(readFileSync(join(fileURLToPath(new URL('../../../packages/verify/test/fixtures/public/', import.meta.url)), `${name}.json`), 'utf8'));
    const shell = toPublicShell(receipt);
    assert.equal(shell.receipt_id.startsWith('xfuel-'), true);
    assert.equal(Object.hasOwn(shell, 'display_id'), false);
    assert.equal(JSON.stringify(shell), readFileSync(join(dir, `${name}.shell.json`), 'utf8'));
    assert.equal(shellPreimageBytes(shell).toString('utf8'), readFileSync(join(dir, `${name}.preimage.json`), 'utf8'));
  }
  const xfuel = await fetchText(`/receipt/${STORED}/preimage`);
  const chit = await fetchText(`/receipt/${DISPLAY}/preimage`);
  assert.equal(xfuel.status, 200, xfuel.text.slice(0, 180));
  assert.equal(chit.text, xfuel.text);
  const doc = JSON.parse(xfuel.text);
  assert.equal(doc.receipt_id, STORED);
  assert.equal(doc.task_id, STORED);
  assert.equal(Object.hasOwn(doc, 'display_id'), false);
  assert.equal(xfuel.text.includes('display_id'), false);
  const json = await fetchText(`/receipt/${DISPLAY}?format=json`);
  const body = JSON.parse(json.text);
  assert.equal(body.receipt_id, STORED);
  assert.equal(body.task_id, STORED);
  assert.equal(Object.hasOwn(body, 'display_id'), false);
  const { verifier_min: _min, ...rest } = body;
  assert.equal(JSON.stringify(rest).includes('display_id'), false);
});

test('T8 chit inclusion matches xfuel bytes, and T8b does not guess', async () => {
  const xfuel = await fetchText(`/v1/receipts/${STORED}/inclusion`);
  const chit = await fetchText(`/v1/receipts/${DISPLAY}/inclusion`);
  assert.equal(xfuel.status, 200, xfuel.text.slice(0, 180));
  assert.equal(chit.status, 200, chit.text.slice(0, 180));
  const strip = (text) => text.replace(/"verified_at":"[^"]*"/g, '"verified_at":"*"');
  assert.equal(strip(chit.text), strip(xfuel.text));
  assert.equal(JSON.parse(chit.text).task_id, STORED);
  assert.equal(Object.hasOwn(JSON.parse(chit.text), 'display_id'), false);
  const upperUuid = UUID.toUpperCase();
  const misses = [
    `CHIT-${UUID}`,
    `Chit-${UUID}`,
    `chit-${upperUuid}`,
    'chit-aaaaaaaa',
    'chit-00000000-0000-4000-8000-000000000000',
  ];
  for (const id of misses) {
    const res = await fetchText(`/v1/receipts/${encodeURIComponent(id)}/inclusion`);
    assert.equal(res.status, 404, id);
    assert.equal(res.text, '{"error":"not_in_tree"}', `${id} ${res.text}`);
  }
});

test('T9 a receipt with no log entry does not print an empty leaf', async () => {
  const res = await fetchText(`/receipt/chit-${NO_LOG.slice(6)}`);
  assert.equal(res.status, 200, res.text.slice(0, 160));
  assert.match(res.text, /Not in the log yet/);
  assert.equal(res.text.includes('Log leaf'), false);
  assert.equal(res.text.includes('Tree root'), false);
  assert.equal(res.text.includes('/inclusion'), false);
  assert.equal(res.text.includes('>null<'), false);
  assert.equal(res.text.includes('undefined'), false);
});

test('T10 OpenRouter HTML drops the book ref, the generation text, and USDC', async () => {
  const html = await fetchText(`/receipt/${OR_ID}`);
  assert.equal(html.status, 200, html.text.slice(0, 180));
  assert.equal(html.text.includes('orb_'), false);
  assert.equal(html.text.includes('onerror'), false);
  assert.equal(html.text.includes('basescan'), false);
  assert.equal(html.text.includes('solscan'), false);
  assert.equal(html.text.includes('✓'), false);
  assert.equal(html.text.includes('USDC'), false);
  assert.match(html.text, /not settled by Chit402/);
  assert.equal(html.text.includes(PAYER), false);
  assert.equal(html.text.includes(MODEL), false);
  const json = JSON.parse((await fetchText(`/receipt/${OR_ID}?format=json`)).text);
  assert.equal(json.receipt_id, OR_ID);
  assert.ok(String(json.payment_tx).includes('onerror'));
  assert.equal(Object.hasOwn(json, 'display_id'), false);
});

test('T13 HTML has no script, CSP is HTML-only, and cache headers stay', async () => {
  const html = await fetchText(`/receipt/${DISPLAY}`, { accept: 'text/html' });
  const star = await fetchText(`/receipt/${DISPLAY}`, { accept: '*/*' });
  const json = await fetchText(`/receipt/${DISPLAY}?format=json`, { accept: 'text/html' });
  assert.match(html.type, /html/);
  assert.equal(html.text.includes('<script'), false);
  assert.equal(html.text.includes('onerror='), false);
  assert.doesNotMatch(html.text, /on\w+=/);
  assert.equal(html.headers.get('content-security-policy'), RECEIPT_HTML_CSP);
  assert.equal(star.headers.get('content-security-policy'), RECEIPT_HTML_CSP);
  assert.equal(json.headers.get('content-security-policy'), null);
  for (const res of [html, star, json]) {
    const cache = res.headers.get('cache-control') || '';
    assert.match(cache, /private/);
    assert.match(cache, /no-store/);
    assert.match(res.headers.get('vary') || '', /accept/i);
  }
  assert.equal(html.text.includes('fonts.googleapis'), false);
  assert.equal(html.text.includes('rel="stylesheet"'), false);
  assert.match(html.text, /name="referrer" content\s*=\s*"no-referrer"/);
});

test('T14 og card does not uppercase USDC and caps every line', async () => {
  const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('../../../packages/verify/test/fixtures/public/chit-39af100b.json', import.meta.url)), 'utf8'));
  const svg = buildReceiptOgSvg(fixture);
  assert.equal(svg.includes('0X833589'), false);
  assert.equal(svg.includes('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'), false);
  const huge = 'Z'.repeat(300);
  const hostile = {
    task_id: `xfuel-${huge}`,
    payment: {
      rail: huge,
      gross_amount: '9'.repeat(20),
      asset: `0x${'ab'.repeat(150)}`,
      ref: `base:0x${'cd'.repeat(32)}`,
      collected: true,
    },
    route: { model: `model-${huge}`, provider: `provider-${huge}` },
    caller_binding: { payer_wallet: `payer-${huge}` },
    book_id: `orb_${huge}`,
  };
  const capped = buildReceiptOgSvg(hostile);
  const lines = svgTexts(capped);
  assert.ok(lines.length >= 4);
  assert.ok(lines[1].length <= 28, lines[1]);
  assert.ok(lines[2].length <= 60, lines[2]);
  assert.ok(lines[3].length <= 56, lines[3]);
  for (const line of lines) assert.ok(line.length <= 60, line);
  await renderReceiptOgPng(fixture);
  const started = performance.now();
  const png = await renderReceiptOgPng(hostile);
  assert.ok(performance.now() - started < 500, 'og render');
  assert.ok(png.length > 100);
});

test('T15 og text does not include payer, model, provider, or book', () => {
  const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('../../../packages/verify/test/fixtures/public/chit-39af100b.json', import.meta.url)), 'utf8'));
  const svg = buildReceiptOgSvg(fixture);
  for (const secret of [
    fixture.caller_binding.payer_wallet,
    fixture.route.model,
    fixture.route.provider,
    'orb_',
  ]) {
    assert.equal(svg.includes(secret), false, secret);
  }
  const huge = 'Z'.repeat(40);
  const hostile = buildReceiptOgSvg({
    task_id: 'xfuel-og-privacy',
    payment: { rail: 'usdc', gross_amount: '2000', asset: BASE_USDC, ref: `base:${TX}`, collected: true },
    route: { model: `model-${huge}`, provider: `provider-${huge}` },
    caller_binding: { payer_wallet: `payer-${huge}` },
    book_id: `orb_${huge}`,
  });
  assert.equal(hostile.includes(`model-${huge}`), false);
  assert.equal(hostile.includes(`provider-${huge}`), false);
  assert.equal(hostile.includes(`payer-${huge}`), false);
  assert.equal(hostile.includes('orb_'), false);
});

test('T16 unknown ids return a generic not-found page', async () => {
  const longId = `ECHO_ME_SENTINEL${'x'.repeat(6000)}`;
  const probes = [
    '/receipt/%3Cscript%3E',
    `/receipt/${encodeURIComponent(longId)}`,
    '/receipt/chit-39af100b',
  ];
  for (const path of probes) {
    const res = await fetchText(path);
    assert.equal(res.status, 404, `${path} ${res.status}`);
    assert.match(res.text, /Not found/);
    assert.equal(res.text.includes('<script'), false, path);
    assert.equal(res.text.includes('ECHO_ME_SENTINEL'), false, path);
    assert.equal(res.text.includes('39af100b'), false, path);
  }
});

test('T17 verifier accepts the public shell as INCLUDED_SHELL', () => {
  const verifyDir = fileURLToPath(new URL('../../../packages/verify/', import.meta.url));
  const built = spawnSync('npm', ['run', 'build'], { cwd: verifyDir, encoding: 'utf8', timeout: 60000 });
  assert.equal(built.status, 0, built.stderr);
  const receipt = JSON.parse(readFileSync(fileURLToPath(new URL('../../../packages/verify/test/fixtures/public/chit-39af100b.json', import.meta.url)), 'utf8'));
  const shell = toPublicShell(receipt);
  shell.verifier_min = '0.3.5';
  const dir = mkdtempSync(join(tmpdir(), 'chit-shell-'));
  const file = join(dir, 'shell.json');
  writeFileSync(file, JSON.stringify(shell));
  const cli = join(verifyDir, 'dist/cli.js');
  const run = spawnSync(process.execPath, [cli, file, '--accept-shell'], { encoding: 'utf8', timeout: 15000 });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /INCLUDED_SHELL/);
  assert.doesNotMatch(run.stdout, /Overall:\s*VERIFIED/);
});
