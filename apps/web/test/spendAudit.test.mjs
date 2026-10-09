import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const {
  SAMPLE_BASE_ADDRESS,
  BASE_USDC,
  AUDIT_CHUNK_BLOCKS,
  parseAuditQuery,
  planLogRanges,
  shrinkLogRange,
  isLogRangeLimitError,
  statedLogRangeLimit,
  decodeUsdcTransferLog,
  classifySpend,
  buildSpendAuditReport,
  reportToCsv,
  reportToJson,
  EIP3009_TRANSFER_WITH_AUTHORIZATION,
  ERC20_TRANSFER_SELECTOR,
  CHIT_FEE_SINK,
} = await import('../src/lib/spendAuditCore.mjs');

const { parseSolanaAddress } = await import('../src/lib/solanaAddress.mjs');

const { runPublicSpendAudit } = await import('../src/lib/spendAuditFetch.mjs');

const root = dirname(fileURLToPath(import.meta.url));
const PAYER = SAMPLE_BASE_ADDRESS;
const PAYEE = '0xd78060679aeb403bb5223dfe1ac609323ef1fbf6';
const TX = '0x909d738d79ff4c9885cd9ed0755636565ee3ddf0406ef6f454e7fbf797990ce9';

function transferLog({
  from = PAYER,
  to = PAYEE,
  amount = 1_000_000n,
  block = 3000,
  tx = TX,
  logIndex = 1,
  time = 1_780_000_000,
} = {}) {
  return {
    address: BASE_USDC,
    blockNumber: `0x${block.toString(16)}`,
    blockTimestamp: `0x${time.toString(16)}`,
    logIndex: `0x${logIndex.toString(16)}`,
    transactionHash: tx,
    topics: [
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
      `0x${from.slice(2).padStart(64, '0')}`,
      `0x${to.slice(2).padStart(64, '0')}`,
    ],
    data: `0x${amount.toString(16).padStart(64, '0')}`,
  };
}

test('parseAuditQuery accepts a Base address, agent id, and Solana address', () => {
  assert.deepEqual(parseAuditQuery(`  base:${PAYER.toUpperCase()}  `), { kind: 'base', address: PAYER });
  assert.equal(parseAuditQuery(`eip155:8453:${PAYER}`).kind, 'base');
  assert.deepEqual(parseAuditQuery('0042'), { kind: 'agent', agentId: '42' });
  assert.equal(parseAuditQuery('1'.repeat(44)).kind, 'invalid');
  const solana44 = '21cesz3zArQM2QLY5QV2sBRhVj1tR1tY3rSj1fRcgZk2';
  assert.equal(parseSolanaAddress(solana44).ok, true);
  assert.equal(parseAuditQuery(solana44).kind, 'solana');
  assert.equal(parseAuditQuery('').kind, 'empty');
  assert.equal(parseAuditQuery('not a wallet').kind, 'invalid');
  assert.equal(parseAuditQuery('0x1234').kind, 'invalid');
});

test('decodeUsdcTransferLog reads amount, payee, and timestamp', () => {
  const row = decodeUsdcTransferLog(transferLog());
  assert.equal(row.from, PAYER);
  assert.equal(row.pay_to, PAYEE);
  assert.equal(row.amount_atomic, '1000000');
  assert.equal(row.tx_hash, TX);
  assert.equal(row.block_time, new Date(1_780_000_000 * 1000).toISOString());
  assert.equal(decodeUsdcTransferLog({ topics: [] }), null);
});

test('classifySpend labels x402 only from a matched shell or EIP-3009', () => {
  assert.equal(classifySpend({
    receipt: { matched: true, rail: 'usdc' },
    txInput: null,
  }), 'x402');
  assert.equal(classifySpend({
    receipt: { matched: true, rail: 'reported' },
    txInput: null,
  }), 'other');
  assert.equal(classifySpend({
    receipt: null,
    txInput: `${EIP3009_TRANSFER_WITH_AUTHORIZATION}${'ab'.repeat(20)}`,
  }), 'x402');
  assert.equal(classifySpend({
    receipt: null,
    txInput: `${ERC20_TRANSFER_SELECTOR}${'00'.repeat(20)}`,
  }), 'other');
  assert.equal(classifySpend({ receipt: null, txInput: null }), 'undetected');
});

test('a complete empty window is zero, and a failed window withholds the total', () => {
  const empty = buildSpendAuditReport({
    query: { kind: 'base', address: PAYER },
    chain: {
      logs: [],
      failedRanges: [],
      fromBlock: 1,
      toBlock: 2,
      fromTime: '2026-09-27T00:00:00.000Z',
      toTime: '2026-10-04T00:00:00.000Z',
      scanComplete: true,
    },
    generatedAt: '2026-10-04T00:00:00.000Z',
  });
  assert.equal(empty.headline.status, 'empty');
  assert.equal(empty.headline.usdc_out_atomic, '0');
  assert.equal(empty.totals.usdc_out_atomic, '0');

  const failed = buildSpendAuditReport({
    query: { kind: 'base', address: PAYER },
    chain: {
      logs: [],
      failedRanges: [{ from_block: 1, to_block: 2, error: 'rpc_http_413' }],
      fromBlock: 1,
      toBlock: 2,
      scanComplete: false,
    },
  });
  assert.equal(failed.headline.status, 'incomplete');
  assert.equal(failed.headline.usdc_out_atomic, null);
  assert.equal(failed.totals.usdc_out_atomic, null);
  assert.match(failed.headline.label, /No spend total/);
});

test('counterparties, receipt match, spike, and near-duplicate stay on chain amounts', () => {
  const sink = CHIT_FEE_SINK;
  const logs = [
    transferLog({ amount: 2000n, to: sink, block: 100, tx: `0x${'11'.repeat(32)}`, time: 1_700_000_000, logIndex: 1 }),
    transferLog({ amount: 2000n, to: sink, block: 101, tx: `0x${'22'.repeat(32)}`, time: 1_700_000_020, logIndex: 2 }),
    transferLog({ amount: 2000n, to: sink, block: 140, tx: `0x${'33'.repeat(32)}`, time: 1_700_000_400, logIndex: 3 }),
    transferLog({ amount: 1_000_000n, to: PAYEE, block: 200, tx: TX, time: 1_700_001_000, logIndex: 4 }),
    transferLog({ amount: 0n, to: PAYEE, block: 201, tx: `0x${'44'.repeat(32)}`, time: 1_700_001_100, logIndex: 5 }),
  ];
  const receipts = new Map([
    [TX, {
      status: 'found',
      receipt_id: 'foreign-x402-muq262x0-1467b076fc62',
      task_id: 'foreign-x402-muq262x0-1467b076fc62',
      chain: 'base',
      payment_tx: TX,
      pay_to: PAYEE,
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      amount_gross: '1000000',
    }],
    [`0x${'11'.repeat(32)}`, { status: 'missing' }],
  ]);
  const txInputs = new Map([
    [`0x${'11'.repeat(32)}`, `${ERC20_TRANSFER_SELECTOR}${'00'.repeat(16)}`],
    [`0x${'22'.repeat(32)}`, `${ERC20_TRANSFER_SELECTOR}${'00'.repeat(16)}`],
    [`0x${'33'.repeat(32)}`, `${ERC20_TRANSFER_SELECTOR}${'00'.repeat(16)}`],
    [TX, `${ERC20_TRANSFER_SELECTOR}${'00'.repeat(16)}`],
  ]);
  const report = buildSpendAuditReport({
    query: { kind: 'base', address: PAYER },
    chain: { logs, failedRanges: [], fromBlock: 1, toBlock: 9, scanComplete: true },
    receipts,
    txInputs,
    generatedAt: '2026-10-04T00:00:00.000Z',
  });

  assert.equal(report.headline.usdc_out_atomic, '1006000');
  assert.equal(report.totals.zero_value_count, 1);
  assert.equal(report.totals.by_counterparty[0].pay_to, PAYEE);
  assert.equal(report.totals.by_counterparty[0].usdc_out_atomic, '1000000');
  assert.equal(report.totals.by_counterparty[1].label, 'Chit402 fee sink');
  assert.equal(report.totals.by_counterparty[1].count, 3);
  assert.equal(report.totals.by_class.x402, '1000000');
  assert.equal(report.totals.by_class.other, '6000');
  assert.equal(report.receipt_match.receipted_atomic, '1000000');
  assert.equal(report.receipt_match.unreceipted_atomic, '2000');
  assert.ok(report.anomalies.some((item) => item.kind === 'spike' && item.tx_hashes.includes(TX)));
  assert.ok(report.anomalies.some((item) => item.kind === 'near_duplicate'));
  assert.equal(report.caps.status, 'not_read');

  const csv = reportToCsv(report);
  assert.match(csv, /^# schema=chit402\.public_spend_audit\.v1/m);
  assert.match(csv, /# usdc_out_atomic=1006000/);
  assert.match(csv, /foreign-x402-muq262x0-1467b076fc62/);
  const json = JSON.parse(reportToJson(report));
  assert.equal(json.schema, 'chit402.public_spend_audit.v1');
  assert.equal(json.headline.usdc_out_atomic, '1006000');
});

test('a receipt whose amount does not match this row is not counted as receipted', () => {
  const report = buildSpendAuditReport({
    query: { kind: 'base', address: PAYER },
    chain: {
      logs: [transferLog()],
      failedRanges: [],
      scanComplete: true,
      fromBlock: 1,
      toBlock: 2,
    },
    receipts: new Map([[TX, {
      status: 'found',
      receipt_id: 'xfuel-39af100b-23dd-4d86-a16b-4556ca6796af',
      chain: 'base',
      payment_tx: TX,
      pay_to: PAYEE,
      asset: BASE_USDC,
      amount_gross: '1',
    }]]),
  });
  assert.equal(report.transfers[0].receipt_status, 'receipt_mismatch');
  assert.equal(report.receipt_match.receipted_atomic, '0');
  assert.equal(report.receipt_match.unreceipted_atomic, '0');
  assert.equal(report.receipt_match.mismatch_count, 1);
  assert.equal(report.transfers[0].verify_url, null);
});

test('Solana and a possession-gated agent id do not invent a total', () => {
  const solana = buildSpendAuditReport({
    query: { kind: 'solana', address: '21cesz3zArQM2QLY5QV2sBRhVj1tR1tY3rSj1fRcgZk2' },
  });
  assert.equal(solana.headline.status, 'incomplete');
  assert.equal(solana.headline.usdc_out_atomic, null);
  assert.equal(solana.transfers.length, 0);

  const book = buildSpendAuditReport({
    query: { kind: 'agent', agentId: '42' },
    book: { status: 'possession_required', httpStatus: 401 },
  });
  assert.equal(book.headline.status, 'possession_required');
  assert.equal(book.headline.usdc_out_atomic, null);
  assert.equal(book.totals, null);
  assert.match(book.headline.label, /Paste the Base wallet/);
});

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function mockRpc({ logs = [], logStatus = 200, head = 0x2000 } = {}) {
  return async (url, init = {}) => {
    const target = String(url);
    if (target.includes('/receipt/by-tx')) {
      return jsonResponse({ error: 'not_found' }, 404);
    }
    if (target.includes('/v1/agents/')) {
      return jsonResponse(null, 401);
    }
    const body = JSON.parse(init.body || '{}');
    if (body.method === 'eth_blockNumber') return jsonResponse({ result: `0x${head.toString(16)}` });
    if (body.method === 'eth_getBlockByNumber') {
      return jsonResponse({ result: { timestamp: '0x66ff0000' } });
    }
    if (body.method === 'eth_getLogs') {
      if (logStatus !== 200) return jsonResponse({ error: { message: 'range' } }, logStatus);
      return jsonResponse({ result: logs });
    }
    if (body.method === 'eth_getTransactionByHash') {
      return jsonResponse({ result: { input: `${ERC20_TRANSFER_SELECTOR}${'00'.repeat(32)}` } });
    }
    throw new Error(`unexpected ${target} ${body.method || ''}`);
  };
}

test('runPublicSpendAudit reads logs and a 404 receipt without treating the 404 as a crash', async () => {
  const result = await runPublicSpendAudit(PAYER, {
    fetchImpl: mockRpc({ logs: [transferLog({ block: 0x1f00 })] }),
    windowBlocks: 2000,
    chunkBlocks: 2000,
    apiHost: 'https://api.chit402.com',
    rpcUrl: 'https://mainnet.base.org',
  });
  assert.equal(result.ok, true);
  assert.equal(result.report.headline.status, 'complete');
  assert.equal(result.report.headline.usdc_out_atomic, '1000000');
  assert.equal(result.report.transfers[0].spend_class, 'other');
  assert.equal(result.report.transfers[0].receipt_status, 'unreceipted');
  assert.equal(result.report.totals.by_class.x402, '0');
  assert.equal(result.report.totals.by_class.other, '1000000');
});

test('a 429 on the first log read is retried and the total can still complete', async () => {
  let logCalls = 0;
  const result = await runPublicSpendAudit(PAYER, {
    fetchImpl: async (url, init = {}) => {
      const target = String(url);
      if (target.includes('/receipt/by-tx')) return jsonResponse({ error: 'not_found' }, 404);
      const body = JSON.parse(init.body || '{}');
      if (body.method === 'eth_blockNumber') return jsonResponse({ result: '0x2000' });
      if (body.method === 'eth_getBlockByNumber') return jsonResponse({ result: { timestamp: '0x66ff0000' } });
      if (body.method === 'eth_getLogs') {
        logCalls += 1;
        if (logCalls === 1) return jsonResponse({}, 429);
        return jsonResponse({ result: [transferLog({ block: 0x1f00 })] });
      }
      if (body.method === 'eth_getTransactionByHash') {
        return jsonResponse({ result: { input: `${ERC20_TRANSFER_SELECTOR}${'00'.repeat(32)}` } });
      }
      throw new Error(`unexpected ${target}`);
    },
    windowBlocks: 2000,
    chunkBlocks: 2000,
  });
  assert.equal(result.ok, true);
  assert.ok(logCalls > 1);
  assert.equal(result.report.headline.status, 'complete');
  assert.equal(result.report.headline.usdc_out_atomic, '1000000');
});

test('a dead Base RPC fails closed with no report total', async () => {
  const result = await runPublicSpendAudit(PAYER, {
    fetchImpl: async () => {
      throw new Error('offline');
    },
    windowBlocks: 100,
    chunkBlocks: 100,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'source_unavailable');
  assert.equal(result.report, undefined);
});

test('a failed log range withholds the total even when no rows came back', async () => {
  const spans = [];
  const result = await runPublicSpendAudit(PAYER, {
    fetchImpl: async (url, init = {}) => {
      const target = String(url);
      if (target.includes('/receipt/by-tx')) return jsonResponse({ error: 'not_found' }, 404);
      const body = JSON.parse(init.body || '{}');
      if (body.method === 'eth_blockNumber') return jsonResponse({ result: '0x3e7' });
      if (body.method === 'eth_getBlockByNumber') return jsonResponse({ result: { timestamp: '0x66ff0000' } });
      if (body.method === 'eth_getLogs') {
        const from = Number.parseInt(body.params[0].fromBlock, 16);
        const to = Number.parseInt(body.params[0].toBlock, 16);
        spans.push(to - from + 1);
        return jsonResponse({ error: { message: 'range' } }, 413);
      }
      throw new Error(`unexpected ${target}`);
    },
    windowBlocks: 999,
    chunkBlocks: 1000,
    chunkFloor: 250,
    minGapMs: 0,
    sleep: async () => {},
  });
  assert.equal(result.ok, true);
  assert.equal(result.report.headline.usdc_out_atomic, null);
  assert.equal(result.report.coverage.scan_complete, false);
  assert.ok(result.report.coverage.failed_ranges.length > 0);
  assert.ok(spans.includes(1000));
  assert.ok(spans.every((span) => span >= 250));
  assert.ok(result.report.coverage.failed_ranges.every((range) => (
    range.to_block - range.from_block + 1 >= 250
  )));
});

test('an agent id probes the book and does not scan the chain', async () => {
  let sawRpc = false;
  const result = await runPublicSpendAudit('42', {
    fetchImpl: async (url) => {
      if (String(url).includes('/v1/agents/42/book')) return jsonResponse({ error: 'unauthorized' }, 401);
      sawRpc = true;
      throw new Error(`unexpected ${url}`);
    },
  });
  assert.equal(sawRpc, false);
  assert.equal(result.ok, true);
  assert.equal(result.report.headline.status, 'possession_required');
  assert.equal(result.report.totals, null);
});

test('invalid input does not call the network', async () => {
  let called = false;
  const result = await runPublicSpendAudit('nope', {
    fetchImpl: async () => {
      called = true;
      throw new Error('should not fetch');
    },
  });
  assert.equal(called, false);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'invalid');
});

test('/audit is wired into the public site', () => {
  const app = readFileSync(join(root, '../src/App.tsx'), 'utf8');
  const layout = readFileSync(join(root, '../src/components/Layout.tsx'), 'utf8');
  const prerender = readFileSync(join(root, '../scripts/prerender-titles.mjs'), 'utf8');
  const sitemap = readFileSync(join(root, '../../../api/sitemap.xml.ts'), 'utf8');
  const llms = readFileSync(join(root, '../../../api/llms.txt.ts'), 'utf8');
  const vercel = readFileSync(join(root, '../../../vercel.json'), 'utf8');
  const pkg = readFileSync(join(root, '../package.json'), 'utf8');
  assert.match(app, /path="\/audit"/);
  assert.match(layout, /to: '\/audit'/);
  assert.match(prerender, /\/audit/);
  assert.match(sitemap, /https:\/\/www\.chit402\.com\/audit/);
  assert.match(llms, /\/audit/);
  assert.match(vercel, /\/audit/);
  assert.match(pkg, /spendAudit\.test\.mjs/);
});

test('planLogRanges covers the window in spans of at most 500 blocks', () => {
  assert.equal(AUDIT_CHUNK_BLOCKS, 500);
  const ranges = planLogRanges(10, 1610, AUDIT_CHUNK_BLOCKS);
  assert.deepEqual(ranges[0], [10, 509]);
  assert.equal(ranges.at(-1)[1], 1610);
  let cursor = 10;
  for (const [start, end] of ranges) {
    assert.equal(start, cursor);
    assert.ok(end >= start);
    assert.ok(end - start + 1 <= 500);
    cursor = end + 1;
  }
  assert.equal(cursor, 1611);
  assert.deepEqual(planLogRanges(5, 4, 500), []);
});

test('shrinkLogRange follows a stated cap, otherwise halves, and stops at the floor', () => {
  const stated = shrinkLogRange(0, 1999, { statedLimit: 500, floor: 1 });
  assert.ok(stated.every(([start, end]) => end - start + 1 <= 500));
  assert.equal(stated[0][0], 0);
  assert.equal(stated.at(-1)[1], 1999);

  assert.deepEqual(shrinkLogRange(0, 1999, { floor: 1 }), [[0, 999], [1000, 1999]]);
  assert.equal(shrinkLogRange(5, 5, { floor: 1 }), null);
  assert.equal(shrinkLogRange(0, 399, { floor: 400 }), null);

  const limited = new Error('rpc_http_413: eth_getLogs is limited to a 500 range');
  assert.equal(isLogRangeLimitError(limited), true);
  assert.equal(statedLogRangeLimit(limited), 500);
  assert.equal(isLogRangeLimitError(new Error('block range too large')), true);
  assert.equal(isLogRangeLimitError(new Error('rpc_http_429')), false);
  assert.equal(statedLogRangeLimit(new Error('rpc_http_413')), null);
});

test('Base reports say they cover Base only', () => {
  const solana = buildSpendAuditReport({
    query: { kind: 'solana', address: '21cesz3zArQM2QLY5QV2sBRhVj1tR1tY3rSj1fRcgZk2' },
  });
  assert.equal(solana.headline.usdc_out_atomic, null);
  assert.doesNotMatch(solana.headline.label, /Solana USDC is not scanned/);
  assert.ok(!solana.coverage.notes.some((note) => note.includes('Solana USDC is not scanned')));

  const base = buildSpendAuditReport({
    query: { kind: 'base', address: PAYER },
    chain: { logs: [], failedRanges: [], scanComplete: true, fromBlock: 1, toBlock: 2 },
  });
  assert.ok(base.coverage.notes.some((note) => note.includes('This report covers Base only. Paste a Solana address for Solana USDC.')));
  assert.match(base.coverage.solana, /This report covers Base only/);
  assert.doesNotMatch(base.coverage.solana, /Solana USDC is not scanned/);
});

test('the default chunk is 500 blocks and a wider filter is reduced after HTTP 413', async () => {
  const spans = [];
  const head = 5000;
  const result = await runPublicSpendAudit(PAYER, {
    fetchImpl: async (url, init = {}) => {
      const target = String(url);
      if (target.includes('/receipt/by-tx')) return jsonResponse({ error: 'not_found' }, 404);
      if (target.includes('/v1/agents/')) return jsonResponse(null, 401);
      const body = JSON.parse(init.body || '{}');
      if (body.method === 'eth_blockNumber') return jsonResponse({ result: `0x${head.toString(16)}` });
      if (body.method === 'eth_getBlockByNumber') return jsonResponse({ result: { timestamp: '0x66ff0000' } });
      if (body.method === 'eth_getLogs') {
        const from = Number.parseInt(body.params[0].fromBlock, 16);
        const to = Number.parseInt(body.params[0].toBlock, 16);
        const span = to - from + 1;
        spans.push(span);
        if (span > 500) {
          return {
            ok: false,
            status: 413,
            json: async () => ({
              error: { code: -32614, message: 'eth_getLogs is limited to a 500 range' },
            }),
          };
        }
        const row = transferLog({ block: 3200 });
        return jsonResponse({ result: from <= 3200 && to >= 3200 ? [row] : [] });
      }
      if (body.method === 'eth_getTransactionByHash') {
        return jsonResponse({ result: { input: `${ERC20_TRANSFER_SELECTOR}${'00'.repeat(32)}` } });
      }
      throw new Error(`unexpected ${body.method}`);
    },
    windowBlocks: 2000,
    chunkBlocks: 2000,
    minGapMs: 0,
    sleep: async () => {},
  });
  assert.ok(spans.some((span) => span > 500));
  assert.ok(spans.filter((span) => span <= 500).length > 0);
  assert.equal(result.ok, true);
  assert.equal(result.report.coverage.scan_complete, true);
  assert.equal(result.report.headline.usdc_out_atomic, '1000000');
  assert.equal(result.report.coverage.failed_ranges.length, 0);
});

test('a 413 without a stated cap is halved until the RPC accepts the span', async () => {
  const spans = [];
  const result = await runPublicSpendAudit(PAYER, {
    fetchImpl: async (url, init = {}) => {
      if (String(url).includes('/receipt/by-tx')) return jsonResponse({ error: 'not_found' }, 404);
      const body = JSON.parse(init.body || '{}');
      if (body.method === 'eth_blockNumber') return jsonResponse({ result: '0x31f' });
      if (body.method === 'eth_getBlockByNumber') return jsonResponse({ result: { timestamp: '0x66ff0000' } });
      if (body.method === 'eth_getLogs') {
        const from = Number.parseInt(body.params[0].fromBlock, 16);
        const to = Number.parseInt(body.params[0].toBlock, 16);
        const span = to - from + 1;
        spans.push(span);
        if (span > 400) {
          return {
            ok: false,
            status: 413,
            json: async () => ({ message: 'payload too large' }),
          };
        }
        return jsonResponse({ result: [] });
      }
      throw new Error(`unexpected ${body.method}`);
    },
    windowBlocks: 799,
    chunkBlocks: 800,
    minGapMs: 0,
    sleep: async () => {},
  });
  assert.ok(spans.includes(800));
  assert.ok(spans.includes(400));
  assert.equal(result.report.headline.status, 'empty');
  assert.equal(result.report.headline.usdc_out_atomic, '0');
});

test('log reads stay inside the concurrency bound', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const result = await runPublicSpendAudit(PAYER, {
    fetchImpl: async (url, init = {}) => {
      if (String(url).includes('/receipt/by-tx')) return jsonResponse({ error: 'not_found' }, 404);
      const body = JSON.parse(init.body || '{}');
      if (body.method === 'eth_blockNumber') return jsonResponse({ result: '0x1388' });
      if (body.method === 'eth_getBlockByNumber') return jsonResponse({ result: { timestamp: '0x66ff0000' } });
      if (body.method === 'eth_getLogs') {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => { setTimeout(resolve, 20); });
        inFlight -= 1;
        return jsonResponse({ result: [] });
      }
      if (body.method === 'eth_getTransactionByHash') return jsonResponse({ result: { input: '0x' } });
      throw new Error(`unexpected ${body.method}`);
    },
    windowBlocks: 2000,
    chunkBlocks: 500,
    concurrency: 2,
    minGapMs: 0,
    sleep: async () => {},
  });
  assert.equal(result.report.headline.status, 'empty');
  assert.ok(maxInFlight >= 2);
  assert.ok(maxInFlight <= 2);
});

test('HTTP 429 backs off using Retry-After and then completes', async () => {
  const sleeps = [];
  let logCalls = 0;
  const result = await runPublicSpendAudit(PAYER, {
    fetchImpl: async (url, init = {}) => {
      if (String(url).includes('/receipt/by-tx')) return jsonResponse({ error: 'not_found' }, 404);
      const body = JSON.parse(init.body || '{}');
      if (body.method === 'eth_blockNumber') return jsonResponse({ result: '0x64' });
      if (body.method === 'eth_getBlockByNumber') return jsonResponse({ result: { timestamp: '0x66ff0000' } });
      if (body.method === 'eth_getLogs') {
        logCalls += 1;
        if (logCalls === 1) {
          return {
            ok: false,
            status: 429,
            headers: { get: (name) => (String(name).toLowerCase() === 'retry-after' ? '2' : null) },
            json: async () => ({ error: { message: 'too many requests' } }),
          };
        }
        return jsonResponse({ result: [] });
      }
      throw new Error(`unexpected ${body.method}`);
    },
    windowBlocks: 100,
    chunkBlocks: 500,
    minGapMs: 0,
    sleep: async (ms) => { sleeps.push(ms); },
  });
  assert.ok(sleeps.includes(2000));
  assert.equal(result.report.headline.status, 'empty');
  assert.equal(result.report.headline.usdc_out_atomic, '0');
});

test('a range that keeps returning 429 fails closed without spinning', async () => {
  let logCalls = 0;
  const result = await runPublicSpendAudit(PAYER, {
    fetchImpl: async (url, init = {}) => {
      if (String(url).includes('/receipt/by-tx')) return jsonResponse({ error: 'not_found' }, 404);
      const body = JSON.parse(init.body || '{}');
      if (body.method === 'eth_blockNumber') return jsonResponse({ result: '0x64' });
      if (body.method === 'eth_getBlockByNumber') return jsonResponse({ result: { timestamp: '0x66ff0000' } });
      if (body.method === 'eth_getLogs') {
        logCalls += 1;
        return jsonResponse({}, 429);
      }
      throw new Error(`unexpected ${body.method}`);
    },
    windowBlocks: 50,
    chunkBlocks: 500,
    minGapMs: 0,
    sleep: async () => {},
  });
  assert.ok(logCalls >= 2);
  assert.ok(logCalls <= 16);
  assert.equal(result.report.headline.usdc_out_atomic, null);
  assert.equal(result.report.coverage.scan_complete, false);
});

test('rows from a successful range do not become a total when another range failed', async () => {
  const result = await runPublicSpendAudit(PAYER, {
    fetchImpl: async (url, init = {}) => {
      if (String(url).includes('/receipt/by-tx')) return jsonResponse({ error: 'not_found' }, 404);
      const body = JSON.parse(init.body || '{}');
      if (body.method === 'eth_blockNumber') return jsonResponse({ result: '0x3e8' });
      if (body.method === 'eth_getBlockByNumber') return jsonResponse({ result: { timestamp: '0x66ff0000' } });
      if (body.method === 'eth_getLogs') {
        const from = Number.parseInt(body.params[0].fromBlock, 16);
        if (from === 500) return jsonResponse({}, 500);
        return jsonResponse({ result: [transferLog({ block: 100 })] });
      }
      if (body.method === 'eth_getTransactionByHash') {
        return jsonResponse({ result: { input: `${ERC20_TRANSFER_SELECTOR}${'00'.repeat(32)}` } });
      }
      throw new Error(`unexpected ${body.method}`);
    },
    windowBlocks: 1000,
    chunkBlocks: 500,
    minGapMs: 0,
    sleep: async () => {},
  });
  assert.equal(result.ok, true);
  assert.ok(result.report.transfers.length > 0);
  assert.equal(result.report.headline.usdc_out_atomic, null);
  assert.equal(result.report.totals.usdc_out_atomic, null);
  assert.equal(result.report.coverage.scan_complete, false);
  assert.match(result.report.headline.label, /No wallet total is shown/);
});
