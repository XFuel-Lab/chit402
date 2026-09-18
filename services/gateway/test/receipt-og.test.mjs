import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReceipt, renderReceiptHtml, mergeReceiptView } from '../src/receipt.js';
import {
  buildReceiptOgMeta,
  buildReceiptOgImageUrl,
  formatUsdcShareAmount,
  shortReceiptIdForShare,
} from '../src/receipt-og-meta.js';
import { buildReceiptOgSvg, renderReceiptOgPng } from '../src/receipt-og.js';

const BANKR_FIXTURE_ID = 'xfuel-1ebc5616-d9ce-4da9-b56c-847062ff6b96';

function bankrStyleReceipt() {
  const taskId = BANKR_FIXTURE_ID;
  const paymentRef = 'base:0x' + 'cd'.repeat(32);
  return buildReceipt({
    taskId,
    status: 'completed',
    createdAt: '2026-09-18T12:00:00.000Z',
    updatedAt: '2026-09-18T12:00:01.000Z',
    intent: {
      type: 'inference_request',
      model: 'openai/gpt-4o-mini',
      amount: '2000',
      paymentRail: 'usdc',
      paymentRef,
    },
    result: { model: 'openai/gpt-4o-mini', provider: 'openrouter' },
    sp1Proof: null,
  }, {
    baseUrl: 'https://api.chit402.com',
    reqHost: 'api.chit402.com',
  });
}

test('buildReceiptOgMeta: Bankr-style receipt has amount, rail, collected, per-receipt image', () => {
  const receipt = bankrStyleReceipt();
  const meta = buildReceiptOgMeta(receipt, mergeReceiptView(receipt));
  assert.equal(meta.title, '0.002 USDC · chit-1ebc5616…');
  assert.equal(meta.description, 'Base USDC · collected');
  assert.equal(
    meta.imageUrl,
    `https://api.chit402.com/receipt/chit-1ebc5616-d9ce-4da9-b56c-847062ff6b96/og.png`,
  );
});

test('buildReceiptOgMeta: foreign ingest includes third-party in description', () => {
  const receipt = {
    task_id: 'xfuel-foreign-1',
    verify_url: 'https://api.chit402.com/receipt/chit-foreign-1',
    links: { self: 'https://api.chit402.com/receipt/chit-foreign-1' },
    payment: { rail: 'usdc', gross_amount: '5000', collected: true, ref: 'base:0xab', asset: 'USDC' },
    foreign_x402: true,
    evidence: 'foreign_ingest',
  };
  const meta = buildReceiptOgMeta(receipt);
  assert.match(meta.description, /third-party/);
  assert.match(meta.description, /collected/);
});

test('renderReceiptHtml: fixture receipt OG tags are not generic site card', () => {
  const receipt = bankrStyleReceipt();
  const html = renderReceiptHtml(receipt);
  assert.match(html, /property="og:title" content="0\.002 USDC · chit-1ebc5616…"/);
  assert.match(html, /property="og:description" content="Base USDC · collected"/);
  assert.ok(!html.includes('www.chit402.com/og-image.png'));
  assert.match(html, /property="og:image" content="https:\/\/api\.chit402\.com\/receipt\/chit-1ebc5616[^"]+\/og\.png"/);
});

test('formatUsdcShareAmount and shortReceiptIdForShare', () => {
  assert.equal(formatUsdcShareAmount('2000', 'usdc'), '0.002 USDC');
  assert.equal(shortReceiptIdForShare('xfuel-1ebc5616-d9ce-4da9-b56c-847062ff6b96'), 'chit-1ebc5616…');
});

test('buildReceiptOgImageUrl appends /og.png to verify_url', () => {
  const url = buildReceiptOgImageUrl({
    verify_url: 'https://api.chit402.com/receipt/chit-abc',
  });
  assert.equal(url, 'https://api.chit402.com/receipt/chit-abc/og.png');
});

test('renderReceiptOgPng returns distinct PNG bytes per receipt id', async () => {
  const a = bankrStyleReceipt();
  const b = buildReceipt({
    taskId: 'xfuel-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    status: 'completed',
    intent: { paymentRail: 'usdc', amount: '1000000', paymentRef: 'base:0x' + '11'.repeat(32) },
    sp1Proof: null,
  }, { baseUrl: 'https://api.chit402.com', reqHost: 'api.chit402.com' });

  const pngA = await renderReceiptOgPng(a);
  const pngB = await renderReceiptOgPng(b);
  assert.ok(Buffer.isBuffer(pngA));
  assert.ok(pngA.length > 500);
  assert.notDeepEqual(pngA, pngB);
});

test('buildReceiptOgSvg embeds receipt title', () => {
  const svg = buildReceiptOgSvg(bankrStyleReceipt());
  assert.match(svg, /0\.002 USDC/);
  assert.match(svg, /chit-1ebc5616/);
});
