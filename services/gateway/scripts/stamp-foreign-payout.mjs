#!/usr/bin/env node
/**
 * Stamp a Chit receipt for an already-settled Base payout into the house book.
 *
 * Run on the gateway box, from services/gateway, after the process can read
 * the same .env the server uses:
 *
 *   node scripts/stamp-foreign-payout.mjs --chain base --tx 0x909d… --tx 0x233a…
 *
 * For each tx the script reads the single USDC transfer, checks it with the
 * foreign-ingest on-chain verifier, and appends a book row only when
 * STAMP_WAIVER_KEYS still has a free stamp. It does not sign or broadcast a
 * transaction. A tx the house book or the task store already has is printed
 * and skipped.
 *
 * Restart the gateway after a stamp so the public receipt route reloads the book.
 */
import dotenv from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/**
 * The one USDC Transfer pair in a Base transaction receipt.
 * Two different from/to pairs are refused. Same pair is summed.
 * @param {object|null} txReceipt
 */
export function soleBaseUsdcTransfer(txReceipt) {
  if (!txReceipt) return { ok: false, reason: 'transaction not found on-chain' };
  if (txReceipt.status === 0 || txReceipt.status === '0x0') {
    return { ok: false, reason: 'transaction reverted' };
  }
  /** @type {Map<string, bigint>} */
  const groups = new Map();
  for (const log of txReceipt.logs || []) {
    if (String(log.address || '').toLowerCase() !== USDC) continue;
    const topics = log.topics || [];
    if (String(topics[0] || '').toLowerCase() !== TRANSFER_TOPIC) continue;
    if (topics.length < 3) continue;
    const from = `0x${String(topics[1]).slice(-40).toLowerCase()}`;
    const to = `0x${String(topics[2]).slice(-40).toLowerCase()}`;
    const value = BigInt(log.data || '0x0');
    const key = `${from}>${to}`;
    groups.set(key, (groups.get(key) || 0n) + value);
  }
  if (groups.size === 0) return { ok: false, reason: 'no_usdc_transfer' };
  if (groups.size > 1) return { ok: false, reason: 'ambiguous_transfers' };
  const [key, amount] = [...groups.entries()][0];
  const [payer, payTo] = key.split('>');
  return { ok: true, payer, payTo, amount: amount.toString() };
}

/**
 * @param {string[]} txs
 * @param {{
 *   findExisting: (tx: string) => Promise<{receipt_id: string, verify_url: string}|null>,
 *   readTransfer: (tx: string) => Promise<{ok: boolean, payer?: string, payTo?: string, amount?: string, reason?: string}>,
 *   verify: (input: object) => Promise<{valid?: boolean, reason?: string}>,
 *   waiver: () => { eligible: boolean, reason?: string },
 *   ingest: (input: {tx: string, payer: string, payTo: string, amount: string, fingerprint?: string|null}) => Promise<{ok: boolean, code?: string, error?: string, receipt_id?: string, verify_url?: string}>,
 *   commitWaiver?: () => void,
 * }} deps
 */
export async function stampForeignPayouts(txs, deps) {
  const results = [];
  for (const item of txs) {
    const tx = typeof item === 'string' ? item : item.tx;
    const fingerprint = typeof item === 'string' ? null : (item.fingerprint || null);
    const existing = await deps.findExisting(tx);
    if (existing?.receipt_id && existing?.verify_url) {
      results.push({ tx, status: 'existing', receipt_id: existing.receipt_id, verify_url: existing.verify_url });
      continue;
    }
    const transfer = await deps.readTransfer(tx);
    if (!transfer?.ok) {
      results.push({ tx, status: 'error', error: transfer?.reason || 'transfer_unreadable' });
      continue;
    }
    const verified = await deps.verify({
      paymentRef: `base:${tx}`,
      payer: transfer.payer,
      payTo: transfer.payTo,
      amount: transfer.amount,
      network: 'base',
    });
    if (!verified?.valid) {
      results.push({ tx, status: 'error', error: verified?.reason || 'verify_failed' });
      continue;
    }
    const waiver = deps.waiver();
    if (!waiver?.eligible) {
      results.push({ tx, status: 'error', error: waiver?.reason || 'stamp_waiver_required' });
      continue;
    }
    const ingested = await deps.ingest({
      tx,
      payer: transfer.payer,
      payTo: transfer.payTo,
      amount: transfer.amount,
      fingerprint,
    });
    if (!ingested?.ok && ingested?.code === 'duplicate_ref') {
      const again = await deps.findExisting(tx);
      if (again?.receipt_id) {
        results.push({ tx, status: 'existing', receipt_id: again.receipt_id, verify_url: again.verify_url });
        continue;
      }
    }
    if (!ingested?.ok) {
      results.push({ tx, status: 'error', error: ingested?.error || 'ingest_failed' });
      continue;
    }
    if (typeof deps.commitWaiver === 'function') deps.commitWaiver();
    results.push({
      tx,
      status: 'stamped',
      receipt_id: ingested.receipt_id,
      verify_url: ingested.verify_url,
    });
  }
  return results;
}

export function formatStampLine(row) {
  if (row.status === 'error') return `tx=${row.tx} status=error error=${row.error}`;
  return `tx=${row.tx} status=${row.status} receipt_id=${row.receipt_id} verify_url=${row.verify_url}`;
}

function parseArgs(argv) {
  let chain = null;
  /** @type {{tx: string, fingerprint: string|null}[]} */
  const txs = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--chain') {
      chain = argv[i + 1];
      i += 1;
    } else if (arg === '--tx') {
      txs.push({ tx: argv[i + 1], fingerprint: null });
      i += 1;
    } else if (arg === '--fingerprint') {
      if (txs.length === 0) throw new Error('--fingerprint follows a --tx');
      txs[txs.length - 1].fingerprint = String(argv[i + 1] || '').toLowerCase();
      i += 1;
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  if (chain !== 'base') throw new Error('--chain base is required');
  if (txs.length === 0) throw new Error('at least one --tx is required');
  for (const item of txs) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(item.tx || '')) throw new Error(`tx is not a 32-byte hash: ${item.tx}`);
    if (item.fingerprint && !/^[0-9a-f]{64}$/.test(item.fingerprint)) {
      throw new Error(`fingerprint is not 64 hex chars: ${item.fingerprint}`);
    }
  }
  return { txs };
}

function houseAgentId(env, houseIds) {
  if (env.HOUSE_AGENT_ID) {
    const id = Number(env.HOUSE_AGENT_ID);
    if (!Number.isInteger(id) || id < 1) throw new Error('HOUSE_AGENT_ID is not an agent id');
    return id;
  }
  if (houseIds.length === 1) return houseIds[0];
  throw new Error('Set HOUSE_AGENT_ID or a single BOARD_HOUSE_AGENT_IDS entry');
}

async function main() {
  const gatewayDir = join(dirname(fileURLToPath(import.meta.url)), '..');
  dotenv.config({ path: join(gatewayDir, '.env') });
  const { txs } = parseArgs(process.argv.slice(2));
  const fingerprintByTx = new Map(txs.map((item) => [item.tx, item.fingerprint]));
  const [
    { AgentRegistry },
    { UsageSettledLedger },
    { ingestForeignX402, buildOnChainVerify, getBaseProvider },
    { peekStampWaiver, commitStampWaiver, configureStampWaiverPersistence, stampWaiverKeys },
    { buildVerifyUrl },
    { createTaskStore },
    { houseAgentIdsFromEnv },
    configModule,
  ] = await Promise.all([
    import('../src/agent-registry.js'),
    import('../src/usage-settled.js'),
    import('../src/foreign-x402-ingest.js'),
    import('../src/stamp-waiver.js'),
    import('../src/receipt.js'),
    import('../src/task-store.js'),
    import('../src/board-posts.js'),
    import('../src/config.js'),
  ]);
  const config = configModule.default || configModule;
  const agentsDir = process.env.AGENTS_DIR
    || (config.taskStore?.dir ? join(config.taskStore.dir, '..', 'agents') : null);
  const persist = config.taskStore?.persist !== false && !!agentsDir;
  if (persist) {
    configureStampWaiverPersistence({ file: join(agentsDir, 'stamp-waiver.json') });
  }
  const registry = new AgentRegistry({ dir: agentsDir, persist });
  const ledger = new UsageSettledLedger({ dir: agentsDir, persist });
  const tasks = createTaskStore({
    dir: config.taskStore?.dir,
    persist: !!config.taskStore?.persist,
    autoFlushMs: 0,
  });
  try {
  const agentId = houseAgentId(process.env, houseAgentIdsFromEnv(process.env));
  const identity = registry.get(agentId);
  if (!identity?.session) {
    throw new Error(`house agent ${agentId} has no possession session on this box`);
  }
  const baseUrl = config.service?.publicBaseUrl || 'https://api.chit402.com';
  const provider = getBaseProvider();
  const verify = buildOnChainVerify(provider);
  if (!verify) throw new Error('BASE_RPC_URL is unset; on-chain verification is unavailable');

  let waiverKey = null;
  const results = await stampForeignPayouts(txs, {
    findExisting: async (tx) => {
      const ref = `base:${tx}`;
      const row = ledger.findByRef(ref) || ledger.findByRef(tx);
      const task = tasks.getByPaymentRef?.(ref) || tasks.getByPaymentRef?.(tx);
      const taskId = row?.task_id || task?.taskId || task?.task_id || null;
      if (!taskId) return null;
      return {
        receipt_id: taskId,
        verify_url: buildVerifyUrl(baseUrl, taskId, { reqHost: 'api.chit402.com' }),
      };
    },
    readTransfer: async (tx) => {
      const receipt = await provider.getTransactionReceipt(tx);
      return soleBaseUsdcTransfer(receipt);
    },
    verify,
    waiver: () => {
      for (const key of stampWaiverKeys(process.env)) {
        const peek = peekStampWaiver(key, process.env);
        if (peek.eligible) {
          waiverKey = key;
          return peek;
        }
      }
      waiverKey = null;
      return { eligible: false, reason: 'stamp_waiver_required' };
    },
    ingest: async ({ tx, payer, payTo, amount, fingerprint }) => {
      const key = waiverKey;
      const boundFingerprint = fingerprint || fingerprintByTx.get(tx) || null;
      const result = await ingestForeignX402({
        session: identity.session,
        ...(boundFingerprint ? {
          agent_record_entry: {
            registry: '1f916',
            fingerprint: boundFingerprint,
            fingerprint_alg: '1f916-entry-hash',
          },
        } : {}),
        foreign_invoice: {
          amount,
          payer,
          payTo,
          tx,
          network: 'base',
          resource: `https://basescan.org/tx/${tx}`,
          job_kind: 'other',
        },
      }, {
        ledger,
        registry,
        verify,
        agentId,
        session: identity.session,
        signingSecret: config.receipts?.signingSecret || null,
        baseUrl,
        reqHost: 'api.chit402.com',
        ensureStamp: async () => {
          if (!key) {
            return {
              ok: false,
              status: 402,
              error: 'stamp_waiver_required',
              message: 'This script does not pay the $0.002 stamp.',
            };
          }
          return { ok: true, waived: true };
        },
        commitStampWaiver: key ? () => commitStampWaiver(key) : null,
      });
      if (!result.ok) {
        return { ok: false, code: result.error, error: result.error || result.message };
      }
      const verifyUrl = result.body?.verify_url;
      const receiptId = String(verifyUrl || '').split('/').filter(Boolean).pop() || result.body?.task_id;
      return { ok: true, receipt_id: receiptId, verify_url: verifyUrl };
    },
    commitWaiver: () => {},
  });

  let failed = false;
  let stamped = false;
  for (const row of results) {
    console.log(formatStampLine(row));
    if (row.status === 'error') failed = true;
    if (row.status === 'stamped') stamped = true;
  }
  if (stamped) {
    console.error('restart the gateway so GET /receipt reloads the house book');
  }
  process.exit(failed ? 1 : 0);
  } finally {
    if (typeof tasks.destroy === 'function') tasks.destroy();
  }
}

const invoked = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invoked) {
  main().catch((err) => {
    console.error(err.message || 'stamp failed');
    process.exit(1);
  });
}
