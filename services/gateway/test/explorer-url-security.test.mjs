import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeBase58, encodeBase58 } from '../src/payment-ref.js';
import {
  explorerUrlForRef,
  safeExplorerUrl,
  mergeReceiptView,
  storedReceiptJson,
  renderReceiptHtml,
  buildAuditorExport,
} from '../src/receipt.js';
import { packBook } from '../src/agent-book.js';
import { renderBookAuditHtml } from '../src/agent-book.js';
import { buildPublicForeignIngestReceipt } from '../src/foreign-x402-ingest.js';

const SIG88 = encodeBase58(Buffer.concat([Buffer.from([0xff]), Buffer.alloc(63, 0x11)]));
const ADDR = encodeBase58(Buffer.alloc(32, 9));
const DEVNET = `https://solscan.io/tx/${SIG88}?cluster=devnet`;
const MAINNET = `https://solscan.io/tx/${SIG88}`;
const PAYER = 'E6TfVNynPrffpkssHAkLyBFcHebo4q3R631c1oT8H5mh';
const DEVNET_USDC = 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr';

function claimsReceipt(ref, stored) {
  const payload = Buffer.from(JSON.stringify({
    payment: {
      rail: 'usdc',
      ref,
      gross_amount: '1000000',
      asset: DEVNET_USDC,
    },
  })).toString('base64url');
  return {
    schema: 'xfuel.receipt.v4',
    task_id: 'task-explorer-security',
    status: 'completed',
    proof_outcome: 'signed',
    proof: { outcome: 'valid', tier: 'signed' },
    issuer_signature: { alg: 'ES256', kid: 'test', jws: `aaa.${payload}.bbb` },
    payment_meta: { explorer_url: stored, collected: true },
    route: { model: 'llama-3-70b', provider: 'theta' },
  };
}

function viewUrls(stored, ref) {
  const claims = claimsReceipt(ref, stored);
  const merged = mergeReceiptView(claims);
  const json = storedReceiptJson(claims);
  const html = renderReceiptHtml(claims);
  const auditor = buildAuditorExport(claims);
  const bearing = {
    schema: 'xfuel.receipt.v4',
    task_id: 'task-explorer-bearing',
    status: 'completed',
    proof: { outcome: 'valid' },
    foreign_x402: true,
    evidence: 'foreign_ingest',
    payment: {
      rail: 'usdc',
      ref,
      collected: true,
      gross_amount: '1000000',
      explorer_url: stored,
    },
    links: { explorer: stored },
    route: { model: 'llama-3-70b', provider: 'theta' },
  };
  const sealed = mergeReceiptView(bearing);
  const foreignHtml = renderReceiptHtml(bearing);
  const book = packBook([{
    task_id: 'book-1',
    payment_ref: ref,
    explorer_url: stored,
    evidence: 'collected',
    amount: '1',
  }], 1, 5);
  const ingest = buildPublicForeignIngestReceipt({
    task_id: 'foreign-1',
    payment: { ref, explorer_url: stored, rail: 'usdc' },
  }, { baseUrl: 'https://api.chit402.com' });
  const noClaims = mergeReceiptView({
    task_id: 'unsigned-view',
    payment_meta: { explorer_url: stored },
  });
  return {
    claims: merged.payment.explorer_url ?? null,
    json: json.payment.explorer_url ?? null,
    html,
    auditor: auditor.totals.explorer_url ?? null,
    sealed: sealed.payment.explorer_url ?? null,
    sealedLink: sealed.links?.explorer ?? null,
    foreignHtml,
    book: book.entries[0].payment.explorer_url ?? null,
    ingest: ingest.payment.explorer_url ?? null,
    ingestLink: ingest.links.explorer ?? null,
    noClaims: noClaims.payment.explorer_url ?? null,
  };
}

test('T1 devnet explorer URL keeps the full signature before the cluster query', () => {
  assert.equal(SIG88.length, 88);
  assert.equal(decodeBase58(SIG88).length, 64);
  assert.equal(encodeBase58(decodeBase58(SIG88)), SIG88);
  assert.equal(explorerUrlForRef(`solana-devnet:${SIG88}`), DEVNET);
  const url = new URL(DEVNET);
  assert.equal(url.pathname, `/tx/${SIG88}`);
  assert.equal(url.search, '?cluster=devnet');
  assert.equal(DEVNET.indexOf(SIG88) < DEVNET.indexOf('?'), true);
});

test('T2 mainnet explorer URL has no query', () => {
  assert.equal(explorerUrlForRef(`solana:${SIG88}`), MAINNET);
  assert.equal(new URL(MAINNET).search, '');
});

test('T3 a 32-byte address is not a /tx/ link', () => {
  assert.ok(ADDR.length >= 32 && ADDR.length <= 44);
  assert.equal(decodeBase58(ADDR).length, 32);
  assert.equal(explorerUrlForRef(`solana:${ADDR}`), null);
  assert.equal(explorerUrlForRef(`solana-devnet:${ADDR}`), null);
});

test('T4 rejects non-64-byte and non-canonical signature spellings', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/receipt.js'), 'utf8');
  assert.match(src, /encodeBase58\(raw\) === tx/);
  assert.equal(explorerUrlForRef(`solana:${'2'.repeat(65)}`), null);
  assert.equal(decodeBase58('2'.repeat(65)).length === 64, false);
  assert.equal(explorerUrlForRef(`solana:${'2'.repeat(128)}`), null);
  assert.equal(explorerUrlForRef(`solana:${'2'.repeat(63)}`), null);
  const nonCanonical = '7'.repeat(88);
  assert.equal(nonCanonical.length, 88);
  assert.equal(decodeBase58(nonCanonical).length, 65);
  assert.notEqual(encodeBase58(decodeBase58(nonCanonical)).length, 64);
  assert.equal(explorerUrlForRef(`solana:${nonCanonical}`), null);
  assert.equal(explorerUrlForRef(`solana-devnet:${nonCanonical}`), null);
  const sig65 = encodeBase58(Buffer.concat([Buffer.alloc(63, 0), Buffer.from([255])]));
  assert.equal(sig65.length, 65);
  assert.equal(decodeBase58(sig65).length, 64);
  assert.equal(encodeBase58(decodeBase58(sig65)), sig65);
  assert.equal(explorerUrlForRef(`solana:${sig65}`), `https://solscan.io/tx/${sig65}`);
});

test('T5 hostile and aliased refs do not produce a link', () => {
  const cases = [
    `solana:${SIG88}?cluster=mainnet`,
    `solana-devnet?cluster=x:${SIG88}`,
    `solana:${SIG88}#frag`,
    `solana:../${SIG88}`,
    'javascript:alert(1)',
    `solana:${SIG88}"`,
    `solana:<${SIG88}`,
    `solana:\u202e${SIG88}`,
    `solana:${SIG88.replace('1', '１')}`,
    `solana:\u00a0${SIG88}`,
    `solana:${SIG88}\n`,
    `__proto__:${SIG88}`,
    `constructor:${SIG88}`,
    `solana-mainnet:${SIG88}`,
    `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:${SIG88}`,
    `eip155:8453:0x${'ab'.repeat(32)}`,
  ];
  for (const ref of cases) {
    assert.equal(explorerUrlForRef(ref), null, ref);
  }
});

test('T6 base tx hashes are exactly 0x plus 64 hex characters', () => {
  assert.equal(explorerUrlForRef('base:0xabcdef'), null);
  assert.equal(explorerUrlForRef(`base:0x${'ab'.repeat(50000)}`), null);
  const tx = `0x${'cd'.repeat(32)}`;
  assert.equal(tx.length, 66);
  assert.equal(explorerUrlForRef(`base:${tx}`), `https://basescan.org/tx/${tx}`);
  assert.equal(explorerUrlForRef(`base-sepolia:${tx}`), `https://sepolia.basescan.org/tx/${tx}`);
});

test('T7 and T8 every view takes the signed ref, and hostile stored URLs become null', () => {
  const valid = `solana-devnet:${SIG88}`;
  const invalid = 'solana-devnet:not-a-signature';
  const legacy = `https://solscan.io/tx/?cluster=devnet${SIG88}`;
  const hostile = [
    'javascript:alert(1)',
    'data:text/html,hi',
    'https://evil.example/phish',
    `https://solscan.io/tx/${SIG88}"onclick="alert(1)`,
    `HTTPS://SOLSCAN.IO/tx/?cluster=devnet${SIG88}`,
    { href: 'https://evil.example/' },
  ];

  const legacyViews = viewUrls(legacy, valid);
  for (const [name, value] of Object.entries(legacyViews)) {
    if (name === 'html' || name === 'foreignHtml') {
      assert.equal(value.includes(`href="${DEVNET}"`), true, name);
      assert.equal(value.includes('/tx/?cluster'), false, name);
    } else if (name === 'noClaims') {
      assert.equal(value, null, name);
    } else {
      assert.equal(value, DEVNET, name);
    }
  }

  for (const stored of hostile) {
    const good = viewUrls(stored, valid);
    for (const [name, value] of Object.entries(good)) {
      if (name === 'html' || name === 'foreignHtml') {
        assert.equal(value.includes(`href="${DEVNET}"`), true, `${name} ${stored}`);
        assert.equal(value.includes('javascript:'), false, name);
        assert.equal(value.includes('evil.example'), false, name);
      } else if (name === 'noClaims') {
        assert.equal(value, null, name);
      } else {
        assert.equal(value, DEVNET, `${name} valid ref`);
      }
    }
    const bad = viewUrls(stored, invalid);
    for (const [name, value] of Object.entries(bad)) {
      if (name === 'html' || name === 'foreignHtml') {
        assert.equal(value.includes('solscan.io'), false, name);
        assert.equal(value.includes('javascript:'), false, name);
        assert.equal(value.includes('evil.example'), false, name);
      } else {
        assert.equal(value, null, `${name} invalid ref`);
      }
    }
  }

  const mainnetStored = viewUrls(MAINNET, valid);
  assert.equal(mainnetStored.claims, DEVNET);
  assert.equal(mainnetStored.json, DEVNET);
  assert.equal(mainnetStored.auditor, DEVNET);
  assert.equal(mainnetStored.sealed, DEVNET);
  assert.equal(mainnetStored.book, DEVNET);
  assert.equal(mainnetStored.ingest, DEVNET);
  assert.equal(mainnetStored.ingestLink, DEVNET);
  assert.equal(mainnetStored.html.includes(`href="${DEVNET}"`), true);
  assert.equal(safeExplorerUrl(MAINNET, valid), DEVNET);
  // M3 fallback: a well-formed allowlisted stored URL stays when the ref cannot build a link.
  // Hostile stored values above stay null. T8 is the signed-ref-wins case, not this one.
  assert.equal(safeExplorerUrl(MAINNET, invalid), MAINNET);
  const mainnetFallback = viewUrls(MAINNET, invalid);
  assert.equal(mainnetFallback.claims, MAINNET);
  assert.equal(mainnetFallback.json, MAINNET);
  assert.equal(mainnetFallback.auditor, MAINNET);
  assert.equal(mainnetFallback.sealed, MAINNET);
  assert.equal(mainnetFallback.book, MAINNET);
  assert.equal(mainnetFallback.ingest, MAINNET);
  assert.equal(mainnetFallback.noClaims, MAINNET);
  assert.equal(mainnetFallback.html.includes(`href="${MAINNET}"`), true);
  assert.equal(mainnetFallback.html.includes('?cluster=devnet'), false);

  const safeStored = `https://basescan.org/tx/0x${'ab'.repeat(32)}`;
  assert.equal(mergeReceiptView({
    task_id: 'unsigned-safe',
    payment_meta: { explorer_url: safeStored },
  }).payment.explorer_url, safeStored);
});

test('T11 devnet receipt HTML links the signature and names Solana Devnet on the page and the card', () => {
  const html = renderReceiptHtml({
    schema: 'xfuel.receipt.v4',
    task_id: 'task-devnet-link',
    status: 'completed',
    proof: { outcome: 'valid', tier: 'signed' },
    payment: {
      rail: 'usdc',
      ref: `solana-devnet:${SIG88}`,
      collected: true,
      gross_amount: '1000000',
      asset: DEVNET_USDC,
    },
    caller_binding: { payer_wallet: PAYER },
    route: { model: 'llama-3-70b', provider: 'theta' },
  });
  assert.equal(html.includes(`href="${DEVNET}"`), true);
  assert.match(html, /USDC on Solana Devnet/);
  assert.match(html, /property="og:description" content="Solana Devnet USDC · collected"/);
});

test('T13 audit HTML escapes a quote in explorer_url', () => {
  const html = renderBookAuditHtml({
    agent_id: 7,
    exported_at: '2026-10-09T00:00:00.000Z',
    row_count: 1,
    schema: 'chit402.book_audit.v1',
    attestation_note: 'note',
    rows: [{
      evidence: 'collected',
      collected_at: '2026-10-09T00:00:00.000Z',
      hub: 'hub',
      model: 'model',
      amount: '1',
      payment_ref: `solana:${SIG88}`,
      explorer_url: `https://solscan.io/tx/${SIG88}"onclick="alert(1)`,
      verify_url: 'https://api.chit402.com/receipt/task-1',
      auditor_url: 'https://api.chit402.com/receipt/task-1?format=auditor',
    }],
  });
  assert.match(html, /&quot;/);
  assert.equal(html.includes('onclick="alert'), false);
  assert.equal(html.includes(`tx/${SIG88}"`), false);
});
