import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const {
  SAMPLE_BASE_ADDRESS,
  BASE_USDC,
  parseAuditQuery,
  decodeUsdcTransferLog,
  classifySpend,
  buildSpendAuditReport,
  reportToCsv,
  reportToJson,
  EIP3009_TRANSFER_WITH_AUTHORIZATION,
  ERC20_TRANSFER_SELECTOR,
  CHIT_FEE_SINK,
} = await import('../src/lib/spendAuditCore.mjs');

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
  assert.equal(parseAuditQuery('1'.repeat(44)).kind, 'solana');
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

test('classifySpend labels x402 only from a receipt or EIP-3009', () => {
  assert.equal(classifySpend({
    receipt: { status: 'found', task_id: 'foreign-x402-abc', schema: 'chit402.foreign_payout.v1', rail: 'usdc' },
    txInput: null,
  }), 'x402');
  assert.equal(classifySpend({
    receipt: { status: 'found', task_id: 'xfuel-1', schema: 'xfuel.receipt.v4', rail: 'usdc' },
  }), 'x402');
  assert.equal(classifySpend({
    receipt: { status: 'found', task_id: 'openrouter-1', rail: 'reported' },
  }), 'other');
  assert.equal(classifySpend({
    receipt: null,
    txInput: `${EIP3009_TRANSFER_WITH_AUTHORIZATION}${'ab'.repeat(20)}`,
  }), 'x402');
  assert.equal(classifySpend({
    receipt: null,
    txInput: `${ERC20_TRANSFER_SELECTOR}${'00'.repeat(20)}`,
  }), 'other');
  assert.equal(classifySpend({ receipt: { status: 'missing' }, txInput: null }), 'undetected');
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
      task_id: 'foreign-x402-muq262x0-1467b076fc62',
      verify_url: 'https://api.chit402.com/receipt/foreign-x402-muq262x0-1467b076fc62',
      schema: 'chit402.foreign_payout.v1',
      rail: 'usdc',
      payer: PAYER,
      hub: null,
      model: null,
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

test('a receipt whose payer does not match is not counted as this wallet\'s receipt', () => {
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
      task_id: 'xfuel-other',
      rail: 'usdc',
      payer: `0x${'ab'.repeat(20)}`,
      verify_url: 'https://api.chit402.com/receipt/xfuel-other',
    }]]),
  });
  assert.equal(report.transfers[0].receipt_status, 'payer_mismatch');
  assert.equal(report.receipt_match.receipted_atomic, '0');
  assert.equal(report.receipt_match.unreceipted_atomic, '0');
  assert.equal(report.receipt_match.mismatch_count, 1);
  assert.equal(report.transfers[0].verify_url, null);
});

test('Solana and a possession-gated agent id do not invent a total', () => {
  const solana = buildSpendAuditReport({ query: { kind: 'solana', address: '1'.repeat(44) } });
  assert.equal(solana.headline.status, 'deferred');
  assert.equal(solana.headline.usdc_out_atomic, null);
  assert.equal(solana.totals, null);
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
  const result = await runPublicSpendAudit(PAYER, {
    fetchImpl: mockRpc({ logStatus: 413 }),
    windowBlocks: 1000,
    chunkBlocks: 1000,
  });
  assert.equal(result.ok, true);
  assert.equal(result.report.headline.usdc_out_atomic, null);
  assert.equal(result.report.coverage.scan_complete, false);
  assert.ok(result.report.coverage.failed_ranges.length > 0);
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
