import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { allowVerifyLink, boardCardModel, formatAtomicUsdc } = await import('../src/lib/boardView.mjs');

const root = dirname(fileURLToPath(import.meta.url));

test('formatAtomicUsdc renders the stamp as 0.002', () => {
  assert.equal(formatAtomicUsdc('2000'), '0.002');
  assert.equal(formatAtomicUsdc('1000000'), '1');
  assert.equal(formatAtomicUsdc('9000'), '0.009');
});

test('board cards keep posted text literal and allow only a Chit verify link', () => {
  const html = '<script>alert(1)</script>\n[click](https://evil.example) <img src=x onerror=alert(1)>';
  const card = boardCardModel({
    id: 'rpt_1',
    status: 'live',
    endpoint_host: 'shop.example',
    amount: '5000',
    outcome: 'double_charge',
    latency_ms: 80,
    date: '2026-09-26',
    verify_url: 'https://api.chit402.com/receipt/foreign-task-1',
    untrusted_text: html,
    labels: ['foreign'],
    foreign_notice: 'recorded by XFuel, not attested by the merchant',
    counts_on_scoreboard: true,
  });
  assert.equal(card.text, html);
  assert.equal(card.links.length, 1);
  assert.equal(card.backing, null);
  assert.equal(card.likeCount, 0);
  assert.equal(card.confirmCount, 0);
  assert.deepEqual(card.comments, []);
  const engaged = boardCardModel({
    id: 'rpt_3',
    status: 'live',
    backing: 'stamp-backed',
    like_count: 2,
    confirm_count: 1,
    confirms: [
      { house: true, amount: '2000', foreign_notice: 'recorded by XFuel, not attested by the merchant' },
      { house: false, amount: '9000' },
    ],
    comments: [
      { id: 'cmt_1', status: 'live', untrusted_text: 'see https://evil.example <script>' },
      { id: 'cmt_2', status: 'taken_down', untrusted_text: 'gone' },
    ],
  });
  assert.equal(engaged.backing, 'stamp-backed');
  assert.equal(engaged.likeCount, 2);
  assert.equal(engaged.confirmCount, 1);
  assert.equal(engaged.comments[0].text, 'see https://evil.example <script>');
  assert.equal(engaged.comments[1].text, null);
  assert.equal(engaged.confirms[0].house, true);
  assert.equal(engaged.confirms[0].amount, '0.002');
  assert.equal(card.links[0].href, 'https://api.chit402.com/receipt/foreign-task-1');
  assert.equal(card.endpointHost, 'shop.example');
  assert.equal(card.outcome, 'double charge');
  assert.equal(JSON.stringify(card.links).includes('evil.example'), false);
  assert.equal(allowVerifyLink('https://evil.example/receipt/x'), null);
  assert.equal(allowVerifyLink('http://api.chit402.com/receipt/x'), null);
  assert.equal(allowVerifyLink('javascript:alert(1)'), null);

  const tomb = boardCardModel({ id: 'rpt_2', status: 'taken_down', untrusted_text: html });
  assert.equal(tomb.text, null);
  assert.deepEqual(tomb.links, []);
});

test('the board page does not inject HTML from posts', () => {
  const page = readFileSync(join(root, '../src/pages/Board.tsx'), 'utf8');
  assert.equal(page.includes('dangerouslySetInnerHTML'), false);
  assert.match(page, /boardCardModel/);
  assert.match(page, /\{card\.text\}/);
  assert.match(page, /comment\.text/);
  assert.match(page, /agents paid this too/);
  assert.match(page, /stamp-backed/);
  assert.match(page, /setPosts\(\[\]\)/);
  assert.match(page, /\{!error && \(/);
  assert.equal(page.includes('distinct_payer_wallets'), false);
  assert.match(page, /distinct_payers/);
});
