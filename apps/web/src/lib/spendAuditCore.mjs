/**
 * Public spend audit — pure report math.
 *
 * Chain rows come from Base USDC Transfer logs (the same contract and RPC
 * the gateway already uses to verify a payer). Receipt match comes from
 * GET /receipt/by-tx. This module does not invent a payment rail and does
 * not treat a missing source as zero.
 */

import { formatUsdc } from './agentBookCore.mjs';

/** Public Base mainnet RPC. Same default as packages/verify base-payer. */
export const BASE_RPC_URL = 'https://mainnet.base.org';

/** Base mainnet USDC. Same contract foreign-x402 ingest verifies. */
export const BASE_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';

/** keccak256("Transfer(address,address,uint256)"). */
export const ERC20_TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/**
 * Documented X402_PAY_TO fee sink. A display label only.
 * A transfer to this address is not, by itself, proof of a protocol fee.
 */
export const CHIT_FEE_SINK = '0x23f713411c30bbd9a989c9cbc22eb0b55f7f7334';

/**
 * USDC transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32).
 * Observed on Base settlements the gateway records as x402.
 */
export const EIP3009_TRANSFER_WITH_AUTHORIZATION = '0xe3ee160e';

/** ERC-20 transfer(address,uint256). */
export const ERC20_TRANSFER_SELECTOR = '0xa9059cbb';

/** ERC-20 transferFrom(address,address,uint256). */
export const ERC20_TRANSFER_FROM_SELECTOR = '0x23b872dd';

/**
 * About seven days at Base's 2-second block target.
 * The report records the boundary block timestamps when the RPC returns them.
 */
export const AUDIT_WINDOW_BLOCKS = 302400;

/**
 * mainnet.base.org answers eth_getLogs over a wider span with HTTP 413
 * ("eth_getLogs is limited to a 500 range": toBlock - fromBlock > 500).
 * An inclusive span of 500 blocks stays inside that cap.
 */
export const AUDIT_CHUNK_BLOCKS = 500;

/**
 * Smallest inclusive span after a range-limit split. One block.
 * A range that still fails at this size is recorded, not treated as empty.
 */
export const AUDIT_CHUNK_FLOOR = 1;

/** Parallel eth_getLogs calls against the public Base RPC. */
export const AUDIT_RPC_CONCURRENCY = 2;

/**
 * Minimum pause between eth_getLogs starts. A faster fan-out draws
 * HTTP 429 from mainnet.base.org partway through a 7-day window.
 */
export const AUDIT_RPC_MIN_GAP_MS = 80;

/**
 * Cap on eth_getLogs calls for one scan, including splits and retries.
 * Past this, remaining ranges are failures and the total stays withheld.
 */
export const AUDIT_MAX_LOG_CALLS = 8000;

export const MAX_INCLUDED_TRANSFERS = 200;
export const MAX_RECEIPT_LOOKUPS = 40;
export const MAX_TX_READS = 40;

export const PUBLIC_AUDIT_SCHEMA = 'chit402.public_spend_audit.v1';

/** 1F916 specimen 1 funder. Public in docs/integrations/1f916-link-v0.md. */
export const SAMPLE_BASE_ADDRESS = '0x9f8951cb8b060f52fdf87297b3c5b00f7aa18f52';

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

const BOOK_NOTE =
  'The possession book is not read. GET /receipt/by-tx is the only public Chit match. HTTP 404 means no public receipt for that transaction. It does not mean the book is empty.';

const CAPS_NOTE =
  'Spend caps live on the possession book (GET /v1/agents/:agent_id/book/policy). This page does not read them.';

const SOLANA_NOTE =
  'Solana USDC is not scanned. Paste a Base address (0x and 40 hex digits).';

/**
 * Inclusive [start, end] ranges covering [fromBlock, toBlock].
 * Each span is at most `chunkBlocks` (and at least 1).
 * @param {number} fromBlock
 * @param {number} toBlock
 * @param {number} chunkBlocks
 * @returns {Array<[number, number]>}
 */
export function planLogRanges(fromBlock, toBlock, chunkBlocks) {
  const from = Math.floor(Number(fromBlock));
  const to = Math.floor(Number(toBlock));
  const size = Math.max(1, Math.floor(Number(chunkBlocks)) || 1);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return [];
  const ranges = [];
  for (let start = from; start <= to; start += size) {
    ranges.push([start, Math.min(to, start + size - 1)]);
  }
  return ranges;
}

/**
 * HTTP 413 from mainnet.base.org, or a JSON-RPC message that names a block-range cap.
 * @param {unknown} err
 */
export function isLogRangeLimitError(err) {
  const message = String(err && typeof err === 'object' && 'message' in err ? err.message : err || '');
  if (/rpc_http_413\b/.test(message)) return true;
  if (/limited to a \d+ range/i.test(message)) return true;
  if (/exceeds? max(?:imum)? block range/i.test(message)) return true;
  if (/block range/i.test(message) && /too (?:large|wide|big)|exceed|limit/i.test(message)) return true;
  return false;
}

/**
 * Span named by "limited to a N range", or null when the error does not name one.
 * The public Base RPC uses N as the maximum of (toBlock - fromBlock), so an
 * inclusive span of N is inside the cap.
 * @param {unknown} err
 * @returns {number | null}
 */
export function statedLogRangeLimit(err) {
  const message = String(err && typeof err === 'object' && 'message' in err ? err.message : err || '');
  const match = message.match(/limited to a (\d+) range/i);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Replace one refused inclusive range with smaller ranges.
 * Uses the span named in the error when it is smaller than the current span.
 * Otherwise halves. Never emits a span below `floor`.
 * Returns null when the range is already at the floor.
 * @param {number} start
 * @param {number} end
 * @param {{ floor?: number, statedLimit?: number | null }} [options]
 * @returns {Array<[number, number]> | null}
 */
export function shrinkLogRange(start, end, options = {}) {
  const floor = Math.max(1, Math.floor(options.floor ?? AUDIT_CHUNK_FLOOR));
  const span = end - start + 1;
  if (!Number.isFinite(span) || span <= floor) return null;
  const stated = options.statedLimit;
  let nextSize;
  if (Number.isInteger(stated) && stated > 0 && stated < span) {
    nextSize = Math.max(floor, stated);
  } else {
    nextSize = Math.max(floor, Math.floor(span / 2));
  }
  if (nextSize >= span) return null;
  return planLogRanges(start, end, nextSize);
}

export function addressTopic(address) {
  const hex = String(address || '').toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{40}$/.test(hex)) return null;
  return `0x${hex.padStart(64, '0')}`;
}

export function counterpartyLabel(address) {
  if (String(address || '').toLowerCase() === CHIT_FEE_SINK) return 'Chit402 fee sink';
  return null;
}

/**
 * @param {string} raw
 * @returns {{ kind: 'empty' } | { kind: 'invalid' } | { kind: 'base', address: string } | { kind: 'solana', address: string } | { kind: 'agent', agentId: string }}
 */
export function parseAuditQuery(raw) {
  const input = String(raw ?? '').trim();
  if (!input) return { kind: 'empty' };

  let body = input;
  if (/^base:/i.test(body)) body = body.slice('base:'.length).trim();
  else if (/^eip155:8453:/i.test(body)) body = body.slice('eip155:8453:'.length).trim();

  if (/^0x[0-9a-fA-F]{40}$/i.test(body)) {
    return { kind: 'base', address: body.toLowerCase() };
  }
  if (/^\d{1,12}$/.test(input)) {
    return { kind: 'agent', agentId: String(Number(input)) };
  }
  if (SOLANA_ADDRESS.test(input)) {
    return { kind: 'solana', address: input };
  }
  return { kind: 'invalid' };
}

function hexToInt(hex) {
  if (hex == null || hex === '') return null;
  if (typeof hex === 'number' && Number.isFinite(hex)) return hex;
  const s = String(hex).trim();
  const n = s.startsWith('0x') || s.startsWith('0X') ? Number.parseInt(s, 16) : Number(s);
  return Number.isFinite(n) ? n : null;
}

function topicAddress(topic) {
  const hex = String(topic || '').toLowerCase().replace(/^0x/, '');
  if (hex.length < 40) return null;
  const addr = `0x${hex.slice(-40)}`;
  return /^0x[0-9a-f]{40}$/.test(addr) ? addr : null;
}

/**
 * One USDC Transfer log. Returns null when the log is not that event.
 * @param {object} log
 */
export function decodeUsdcTransferLog(log) {
  if (!log || !Array.isArray(log.topics) || log.topics.length < 3) return null;
  if (String(log.topics[0]).toLowerCase() !== ERC20_TRANSFER_TOPIC) return null;
  const from = topicAddress(log.topics[1]);
  const payTo = topicAddress(log.topics[2]);
  if (!from || !payTo) return null;
  let amount;
  try {
    amount = BigInt(log.data || '0x0');
  } catch {
    return null;
  }
  if (amount < 0n) return null;
  const block = hexToInt(log.blockNumber);
  if (block == null || !log.transactionHash) return null;
  const logIndex = hexToInt(log.logIndex) ?? 0;
  const ts = hexToInt(log.blockTimestamp);
  return {
    tx_hash: String(log.transactionHash).toLowerCase(),
    block_number: block,
    log_index: logIndex,
    block_time: ts == null ? null : new Date(ts * 1000).toISOString(),
    from,
    pay_to: payTo,
    amount_atomic: amount.toString(),
  };
}

export function selectorOf(txInput) {
  if (typeof txInput !== 'string') return null;
  const trimmed = txInput.trim().toLowerCase();
  if (!/^0x[0-9a-f]{8}/.test(trimmed)) return null;
  return trimmed.slice(0, 10);
}

export function settlementMethodOf(txInput) {
  const sel = selectorOf(txInput);
  if (sel === EIP3009_TRANSFER_WITH_AUTHORIZATION) return 'eip3009';
  if (sel === ERC20_TRANSFER_SELECTOR) return 'erc20_transfer';
  if (sel === ERC20_TRANSFER_FROM_SELECTOR) return 'erc20_transfer_from';
  return null;
}

/**
 * x402 only when a public Chit receipt says so, or the tx is the EIP-3009
 * authorization the Base x402 exact scheme submits. A plain transfer with
 * no receipt is other. Anything we could not read is undetected.
 */
export function classifySpend({ receipt, txInput }) {
  if (receipt && (receipt.status === 'found' || receipt.status === 'mismatch')) {
    const task = String(receipt.task_id || '');
    const schema = String(receipt.schema || '');
    const rail = String(receipt.rail || '').toLowerCase();
    if (task.startsWith('foreign-x402') || schema.includes('foreign')) return 'x402';
    if (rail === 'reported' || rail === 'unmetered' || rail === 'nano') return 'other';
    if (rail === 'usdc' || rail === 'x402' || rail.startsWith('solana')) return 'x402';
    return 'undetected';
  }
  const method = settlementMethodOf(txInput);
  if (method === 'eip3009') return 'x402';
  if (method === 'erc20_transfer' || method === 'erc20_transfer_from') return 'other';
  return 'undetected';
}

function payerMatches(receipt, address) {
  const payer = receipt?.payer;
  if (payer == null || payer === '') return true;
  return String(payer).toLowerCase() === String(address).toLowerCase();
}

function receiptStatusOf(lookup, address) {
  if (!lookup || lookup.status === 'not_checked') return 'not_checked';
  if (lookup.status === 'missing') return 'unreceipted';
  if (lookup.status === 'unavailable') return 'unavailable';
  if (lookup.status === 'found' || lookup.status === 'mismatch') {
    if (!payerMatches(lookup, address)) return 'payer_mismatch';
    return 'receipted';
  }
  return 'unavailable';
}

function isNear(a, b) {
  if (a.tx_hash === b.tx_hash && a.log_index === b.log_index) return false;
  if (a.block_time && b.block_time) {
    const dt = Math.abs(Date.parse(a.block_time) - Date.parse(b.block_time));
    return Number.isFinite(dt) && dt <= 90_000;
  }
  return Math.abs(a.block_number - b.block_number) <= 25;
}

function medianPositive(amounts) {
  const vals = amounts.filter((a) => a > 0n).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (vals.length < 4) return null;
  const mid = Math.floor(vals.length / 2);
  if (vals.length % 2 === 1) return vals[mid];
  return (vals[mid - 1] + vals[mid]) / 2n;
}

export function findAnomalies(rows) {
  const anomalies = [];
  const positive = rows.filter((row) => BigInt(row.amount_atomic) > 0n);
  const median = medianPositive(positive.map((row) => BigInt(row.amount_atomic)));
  if (median != null && median > 0n) {
    const threshold = median * 5n;
    for (const row of positive) {
      const amount = BigInt(row.amount_atomic);
      if (amount >= threshold && amount > median) {
        anomalies.push({
          kind: 'spike',
          summary: `${formatUsdc(row.amount_atomic)} USDC to ${row.pay_to} is at least 5× the median transfer in this window.`,
          amount_atomic: row.amount_atomic,
          pay_to: row.pay_to,
          tx_hashes: [row.tx_hash],
        });
      }
    }
  }

  const seen = new Set();
  for (let i = 0; i < positive.length; i += 1) {
    for (let j = i + 1; j < positive.length; j += 1) {
      const a = positive[i];
      const b = positive[j];
      if (a.pay_to !== b.pay_to || a.amount_atomic !== b.amount_atomic) continue;
      if (a.tx_hash === b.tx_hash) continue;
      if (!isNear(a, b)) continue;
      const key = [a.tx_hash, b.tx_hash].sort().join('|') + `|${a.amount_atomic}`;
      if (seen.has(key)) continue;
      seen.add(key);
      anomalies.push({
        kind: 'near_duplicate',
        summary: `Two ${formatUsdc(a.amount_atomic)} USDC transfers to ${a.pay_to} within 90 seconds (or 25 blocks when timestamps are missing).`,
        amount_atomic: a.amount_atomic,
        pay_to: a.pay_to,
        tx_hashes: [a.tx_hash, b.tx_hash],
      });
    }
  }
  return anomalies.slice(0, 20);
}

function sumAtomic(rows, pred = () => true) {
  return rows.reduce((acc, row) => (pred(row) ? acc + BigInt(row.amount_atomic) : acc), 0n);
}

function csvCell(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function coverageShell(extra) {
  return {
    chain: null,
    asset: null,
    rpc: null,
    window_blocks: null,
    from_block: null,
    to_block: null,
    from_time: null,
    to_time: null,
    scan_complete: false,
    truncated: false,
    failed_ranges: [],
    receipt_api: 'GET /receipt/by-tx',
    receipts_checked: 0,
    receipts_not_checked: 0,
    book: BOOK_NOTE,
    caps: CAPS_NOTE,
    solana: SOLANA_NOTE,
    notes: [],
    ...extra,
  };
}

function baseNotes({ sawFeeSink, zeroCount, notChecked, truncated, failed }) {
  const notes = [
    'USDC out only, on Base. Incoming transfers are not spend and are not included.',
    `Window is ${AUDIT_WINDOW_BLOCKS} blocks ending at the chain head (about 7 days at a 2-second block). from_time and to_time are the boundary blocks when the RPC returned them.`,
    BOOK_NOTE,
    'x402 means a public Chit receipt for that transaction, or the transaction calls USDC transferWithAuthorization (0xe3ee160e), the Base x402 exact path. A plain ERC-20 transfer with no receipt is other. Undetected is neither.',
    CAPS_NOTE,
    SOLANA_NOTE,
  ];
  if (sawFeeSink) {
    notes.push(
      'Chit402 fee sink is the documented X402_PAY_TO address. A transfer there is labeled. The label is not proof the transfer was a protocol fee.',
    );
  }
  if (zeroCount > 0) {
    notes.push('Zero-value Transfer logs are listed and excluded from totals.');
  }
  if (notChecked > 0) {
    notes.push(
      `Receipt lookup stopped after ${MAX_RECEIPT_LOOKUPS} transactions. The rest are not_checked, not unreceipted.`,
    );
  }
  if (truncated) {
    notes.push(
      `Only the newest ${MAX_INCLUDED_TRANSFERS} transfers are included. The total is withheld because the window is truncated.`,
    );
  }
  if (failed > 0) {
    notes.push('One or more block ranges failed. The total is withheld. Missing ranges are not zero.');
  }
  return notes;
}

/**
 * @param {object} input
 */
export function buildSpendAuditReport(input) {
  const query = input.query;
  const generatedAt = input.generatedAt || new Date().toISOString();
  const caps = { status: 'not_read', note: CAPS_NOTE };

  if (query.kind === 'solana') {
    return {
      schema: PUBLIC_AUDIT_SCHEMA,
      generated_at: generatedAt,
      query: { kind: 'solana', address: query.address },
      headline: {
        status: 'deferred',
        usdc_out_atomic: null,
        label: SOLANA_NOTE,
      },
      coverage: coverageShell({
        scan_complete: false,
        notes: [SOLANA_NOTE],
      }),
      totals: null,
      receipt_match: null,
      anomalies: [],
      transfers: [],
      caps,
      book: null,
    };
  }

  if (query.kind === 'agent') {
    const book = input.book || { status: 'unavailable' };
    const status = book.status === 'possession_required'
      ? 'possession_required'
      : book.status === 'not_found'
        ? 'book_not_found'
        : book.status === 'unexpected_public'
          ? 'book_unavailable'
          : 'book_unavailable';
    const label = status === 'possession_required'
      ? 'The Chit book is possession-gated. Without a session this page has no spend figure for that agent id. Paste the Base wallet that paid.'
      : book.status === 'not_found'
        ? 'The gateway did not return a book for that id. No spend figure is shown.'
        : book.status === 'unexpected_public'
          ? 'The book route answered without a possession session. This page does not turn that body into a spend total.'
          : 'The book API did not answer. No spend figure is shown.';
    return {
      schema: PUBLIC_AUDIT_SCHEMA,
      generated_at: generatedAt,
      query: { kind: 'agent', agent_id: query.agentId },
      headline: { status, usdc_out_atomic: null, label },
      coverage: coverageShell({
        notes: [label, CAPS_NOTE],
      }),
      totals: null,
      receipt_match: null,
      anomalies: [],
      transfers: [],
      caps,
      book: {
        status: book.status || 'unavailable',
        http_status: book.httpStatus ?? null,
        note: label,
      },
    };
  }

  const chain = input.chain || {
    logs: [],
    failedRanges: [{ from_block: null, to_block: null, error: 'missing_chain' }],
    fromBlock: null,
    toBlock: null,
    fromTime: null,
    toTime: null,
    scanComplete: false,
  };
  const decoded = [];
  const seen = new Set();
  for (const log of chain.logs || []) {
    const row = log.tx_hash ? log : decodeUsdcTransferLog(log);
    if (!row) continue;
    if (row.from !== query.address) continue;
    const key = `${row.tx_hash}:${row.log_index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    decoded.push(row);
  }
  decoded.sort((a, b) => b.block_number - a.block_number || b.log_index - a.log_index);

  const truncated = decoded.length > MAX_INCLUDED_TRANSFERS;
  const included = truncated ? decoded.slice(0, MAX_INCLUDED_TRANSFERS) : decoded;
  const failedRanges = chain.failedRanges || [];
  const scanComplete = chain.scanComplete === true && failedRanges.length === 0;

  const receipts = input.receipts || new Map();
  const txInputs = input.txInputs || new Map();

  const transfers = included.map((row) => {
    const lookup = receipts.get(row.tx_hash) || { status: 'not_checked' };
    const txInput = txInputs.has(row.tx_hash) ? txInputs.get(row.tx_hash) : null;
    const receiptStatus = receiptStatusOf(lookup, query.address);
    const spendClass = classifySpend({
      receipt: lookup.status === 'found' || lookup.status === 'mismatch' ? lookup : null,
      txInput,
    });
    const amount = BigInt(row.amount_atomic);
    return {
      tx_hash: row.tx_hash,
      block_number: row.block_number,
      log_index: row.log_index,
      block_time: row.block_time,
      pay_to: row.pay_to,
      pay_to_label: counterpartyLabel(row.pay_to),
      amount_atomic: row.amount_atomic,
      amount_usdc: formatUsdc(row.amount_atomic),
      spend_class: spendClass,
      settlement_method: settlementMethodOf(txInput),
      receipt_status: receiptStatus,
      task_id: receiptStatus === 'receipted' ? (lookup.task_id || null) : (lookup.task_id || null),
      verify_url: receiptStatus === 'receipted' ? (lookup.verify_url || null) : null,
      hub: lookup.hub || null,
      model: lookup.model || null,
      explorer_url: `https://basescan.org/tx/${row.tx_hash}`,
      counts_toward_total: amount > 0n,
    };
  });

  const positive = transfers.filter((row) => row.counts_toward_total);
  const observed = sumAtomic(positive);
  const byCounterpartyMap = new Map();
  for (const row of positive) {
    const prev = byCounterpartyMap.get(row.pay_to) || { pay_to: row.pay_to, label: row.pay_to_label, amount: 0n, count: 0 };
    prev.amount += BigInt(row.amount_atomic);
    prev.count += 1;
    byCounterpartyMap.set(row.pay_to, prev);
  }
  const byCounterparty = [...byCounterpartyMap.values()]
    .map((row) => ({
      pay_to: row.pay_to,
      label: row.label,
      usdc_out_atomic: row.amount.toString(),
      count: row.count,
    }))
    .sort((a, b) => (BigInt(a.usdc_out_atomic) > BigInt(b.usdc_out_atomic) ? -1 : 1));

  const classSum = (name) => sumAtomic(positive, (row) => row.spend_class === name).toString();
  const receipted = sumAtomic(positive, (row) => row.receipt_status === 'receipted');
  const unreceipted = sumAtomic(positive, (row) => row.receipt_status === 'unreceipted');
  const unavailableCount = transfers.filter((row) => row.receipt_status === 'unavailable').length;
  const notCheckedCount = transfers.filter((row) => row.receipt_status === 'not_checked').length;
  const mismatchCount = transfers.filter((row) => row.receipt_status === 'payer_mismatch').length;
  const zeroCount = transfers.filter((row) => !row.counts_toward_total).length;
  const sawFeeSink = transfers.some((row) => row.pay_to === CHIT_FEE_SINK);

  const totalReady = scanComplete && !truncated;
  let headlineStatus = 'incomplete';
  let headlineLabel = 'The scan is incomplete. No wallet total is shown. Missing ranges are not zero.';
  if (totalReady && positive.length === 0) {
    headlineStatus = 'empty';
    headlineLabel = zeroCount > 0
      ? 'No positive USDC out in this window. The total is 0. Zero-value Transfer logs are listed and excluded. Older spend is outside this window.'
      : 'No Base USDC transfers from this address in the scanned window. The total for that window is 0. Older spend is outside this report.';
  } else if (totalReady) {
    headlineStatus = 'complete';
    headlineLabel = 'USDC sent from this address on Base, in the scanned window.';
  } else if (!scanComplete && transfers.length === 0) {
    headlineLabel = 'The Base RPC did not return this window. No spend total is shown.';
  } else if (truncated) {
    headlineLabel = `Only the newest ${MAX_INCLUDED_TRANSFERS} transfers are listed. The wallet total is withheld.`;
  }

  const notes = baseNotes({
    sawFeeSink,
    zeroCount,
    notChecked: notCheckedCount,
    truncated,
    failed: failedRanges.length,
  });

  return {
    schema: PUBLIC_AUDIT_SCHEMA,
    generated_at: generatedAt,
    query: { kind: 'base', address: query.address },
    headline: {
      status: headlineStatus,
      usdc_out_atomic: totalReady ? observed.toString() : null,
      label: headlineLabel,
    },
    coverage: coverageShell({
      chain: 'eip155:8453',
      asset: BASE_USDC,
      rpc: input.rpcUrl || BASE_RPC_URL,
      window_blocks: input.windowBlocks ?? AUDIT_WINDOW_BLOCKS,
      from_block: chain.fromBlock ?? null,
      to_block: chain.toBlock ?? null,
      from_time: chain.fromTime ?? null,
      to_time: chain.toTime ?? null,
      scan_complete: scanComplete,
      truncated,
      failed_ranges: failedRanges,
      receipts_checked: transfers.length - notCheckedCount,
      receipts_not_checked: notCheckedCount,
      notes,
    }),
    totals: {
      usdc_out_atomic: totalReady ? observed.toString() : null,
      observed_out_atomic: observed.toString(),
      observed_count: positive.length,
      zero_value_count: zeroCount,
      by_counterparty: byCounterparty,
      by_class: {
        x402: classSum('x402'),
        other: classSum('other'),
        undetected: classSum('undetected'),
      },
    },
    receipt_match: {
      receipted_atomic: receipted.toString(),
      unreceipted_atomic: unreceipted.toString(),
      unavailable_count: unavailableCount,
      not_checked_count: notCheckedCount,
      mismatch_count: mismatchCount,
      note: BOOK_NOTE,
    },
    anomalies: findAnomalies(transfers),
    transfers,
    caps,
    book: {
      status: 'not_read',
      http_status: null,
      note: BOOK_NOTE,
    },
  };
}

export function reportToJson(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function reportToCsv(report) {
  const lines = [
    `# schema=${report.schema}`,
    `# query=${report.query?.kind || ''}`,
    `# address=${report.query?.address || report.query?.agent_id || ''}`,
    `# headline=${report.headline?.status || ''}`,
    `# usdc_out_atomic=${report.headline?.usdc_out_atomic ?? ''}`,
    `# scan_complete=${report.coverage?.scan_complete === true}`,
    `# truncated=${report.coverage?.truncated === true}`,
    `# ${report.headline?.label || ''}`,
  ];
  for (const note of report.coverage?.notes || []) lines.push(`# ${note}`);
  lines.push('tx_hash,block_number,block_time,pay_to,pay_to_label,amount_atomic,amount_usdc,spend_class,settlement_method,receipt_status,task_id,verify_url,hub,model,explorer_url');
  for (const row of report.transfers || []) {
    lines.push([
      row.tx_hash,
      row.block_number,
      row.block_time,
      row.pay_to,
      row.pay_to_label,
      row.amount_atomic,
      row.amount_usdc,
      row.spend_class,
      row.settlement_method,
      row.receipt_status,
      row.task_id,
      row.verify_url,
      row.hub,
      row.model,
      row.explorer_url,
    ].map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}
