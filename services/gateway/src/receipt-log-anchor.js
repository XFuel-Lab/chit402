/**
 * Pin, Base anchor read, and write-ahead anchor intents.
 *
 * An empty journal must not boot while a pin exists. A Base root that is on
 * chain and missing from the journal must not boot either. The fresh-genesis
 * flag is the only bypass. Anchor intents are fsynced before broadcast.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ReceiptLogRefused } from './receipt-log-store.js';

const PIN_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'receipt-log-pin.json',
);

export const FRESH_GENESIS_LOG = 'RECEIPT LOG FRESH GENESIS: RECEIPT_LOG_ACCEPT_FRESH_GENESIS=YES_I_ACCEPT_A_NEW_PUBLIC_RECEIPT_LOG. This process is opening a new public receipt log. It does not extend the pinned epoch.';

export function normalizeRoot(root) {
  const hex = String(root || '').replace(/^0x/, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  return hex;
}

export function readReceiptLogPin(env = process.env) {
  const epochEnv = env.RECEIPT_LOG_EXPECTED_EPOCH;
  const rootEnv = env.RECEIPT_LOG_EXPECTED_ROOT;
  if ((epochEnv != null && epochEnv !== '') || (rootEnv != null && rootEnv !== '')) {
    const root = normalizeRoot(rootEnv);
    const epoch = Number(epochEnv);
    if (!root || !Number.isInteger(epoch) || epoch < 1) {
      throw new ReceiptLogRefused(
        'bad_pin',
        'RECEIPT_LOG_EXPECTED_EPOCH and RECEIPT_LOG_EXPECTED_ROOT must both be set to an epoch number and a 32-byte root',
      );
    }
    return { epoch, root, source: 'env' };
  }
  const file = env.RECEIPT_LOG_PIN_FILE || PIN_FILE;
  if (!fs.existsSync(file)) return null;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new ReceiptLogRefused('bad_pin', `receipt log pin file does not parse: ${err.message}`);
  }
  const root = normalizeRoot(parsed.root);
  const epoch = Number(parsed.epoch);
  if (!root || !Number.isInteger(epoch) || epoch < 1) {
    throw new ReceiptLogRefused('bad_pin', 'receipt log pin file needs epoch and a 32-byte root');
  }
  return { epoch, root, source: 'file', file };
}

export function knownHeadRoots(tree) {
  const roots = new Set();
  const take = (heads) => {
    for (const head of heads || []) {
      const root = normalizeRoot(head?.root);
      if (root) roots.add(root);
    }
  };
  take(tree?.heads);
  for (const epoch of tree?.closedEpochs || []) take(epoch.heads);
  for (const root of Object.keys(tree?.anchorState?.base || {})) {
    const hex = normalizeRoot(root);
    if (hex) roots.add(hex);
  }
  return roots;
}

export function calldataRoot(input) {
  const data = String(input || '');
  if (!/^0x[0-9a-fA-F]{64}$/.test(data)) return null;
  return data.slice(2).toLowerCase();
}

async function rpc(rpcUrl, method, params, request) {
  const call = request || defaultRpc;
  return call(rpcUrl, method, params);
}

async function defaultRpc(rpcUrl, method, params) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`base_http_${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'base_rpc_error');
  return json.result;
}

/**
 * Latest zero-value root transaction from the anchor wallet.
 * Tries Otterscan's sender+nonce lookup, then a bounded block scan.
 */
export async function latestBaseAnchorRoot({
  rpcUrl,
  address,
  lookback = Number(process.env.RECEIPT_LOG_ANCHOR_LOOKBACK || 2048),
  request,
} = {}) {
  if (!rpcUrl || !address) return null;
  const countHex = await rpc(rpcUrl, 'eth_getTransactionCount', [address, 'latest'], request);
  const count = Number(countHex);
  if (Number.isInteger(count) && count > 0) {
    for (let nonce = count - 1; nonce >= Math.max(0, count - 32); nonce -= 1) {
      try {
        const tx = await rpc(rpcUrl, 'ots_getTransactionBySenderAndNonce', [address, nonce], request);
        const root = calldataRoot(tx?.input || tx?.data);
        if (root) return { root, tx: tx.hash, nonce, source: 'nonce' };
      } catch {
        break;
      }
    }
  }
  const tipHex = await rpc(rpcUrl, 'eth_blockNumber', [], request);
  const tip = Number(tipHex);
  if (!Number.isInteger(tip)) return null;
  const from = Math.max(0, tip - lookback);
  for (let n = tip; n >= from; n -= 1) {
    const block = await rpc(rpcUrl, 'eth_getBlockByNumber', [`0x${n.toString(16)}`, true], request);
    const txs = block?.transactions || [];
    for (let i = txs.length - 1; i >= 0; i -= 1) {
      const tx = txs[i];
      if (!tx || String(tx.from || '').toLowerCase() !== address.toLowerCase()) continue;
      const root = calldataRoot(tx.input);
      if (!root) continue;
      return { root, tx: tx.hash, nonce: Number(tx.nonce), block: n, source: 'scan' };
    }
  }
  return null;
}

export async function lookupBaseTxByNonceOrHash({
  rpcUrl,
  address,
  nonce,
  txHash,
  root,
  lookback = Number(process.env.RECEIPT_LOG_ANCHOR_LOOKBACK || 2048),
  request,
} = {}) {
  const want = normalizeRoot(root);
  if (txHash) {
    const tx = await rpc(rpcUrl, 'eth_getTransactionByHash', [txHash], request);
    if (!tx) return null;
    const got = calldataRoot(tx.input);
    if (want && got && got !== want) return { mismatch: true, tx: tx.hash, root: got };
    if (got) return { tx: tx.hash, nonce: Number(tx.nonce), root: got };
    return null;
  }
  if (nonce == null || !address) return null;
  try {
    const tx = await rpc(rpcUrl, 'ots_getTransactionBySenderAndNonce', [address, Number(nonce)], request);
    const got = calldataRoot(tx?.input || tx?.data);
    if (want && got && got !== want) return { mismatch: true, tx: tx.hash, root: got };
    if (got) return { tx: tx.hash, nonce: Number(nonce), root: got };
  } catch {
    /* fall through to a block scan */
  }
  const tipHex = await rpc(rpcUrl, 'eth_blockNumber', [], request);
  const tip = Number(tipHex);
  if (!Number.isInteger(tip)) return null;
  const from = Math.max(0, tip - lookback);
  for (let n = tip; n >= from; n -= 1) {
    const block = await rpc(rpcUrl, 'eth_getBlockByNumber', [`0x${n.toString(16)}`, true], request);
    for (const tx of block?.transactions || []) {
      if (!tx || String(tx.from || '').toLowerCase() !== address.toLowerCase()) continue;
      if (Number(tx.nonce) !== Number(nonce)) continue;
      const got = calldataRoot(tx.input);
      if (want && got && got !== want) return { mismatch: true, tx: tx.hash, root: got };
      if (got) return { tx: tx.hash, nonce: Number(nonce), root: got };
    }
  }
  return null;
}

export function anchorWalletAddress() {
  return process.env.RECEIPT_ANCHOR_FROM || null;
}

/**
 * Refuse when the latest Base root anchor is not in the journal head history.
 * No RPC and no injected reader means there is nothing to compare.
 */
export async function assertLatestBaseAnchor(tree, opts = {}) {
  const readLatest = opts.readLatest || (async () => {
    const rpcUrl = process.env.BASE_RPC_URL || process.env.SETTLEMENT_RPC_URL || '';
    const address = anchorWalletAddress();
    if (!rpcUrl || !address) return null;
    return latestBaseAnchorRoot({ rpcUrl, address, request: opts.request });
  });
  const found = await readLatest();
  if (!found?.root) return;
  const root = normalizeRoot(found.root);
  if (!root) return;
  if (knownHeadRoots(tree).has(root)) return;
  throw new ReceiptLogRefused(
    'anchor_not_in_journal',
    `Base anchor root ${root} from ${found.tx || 'the anchor wallet'} is not in the receipt log head history`,
  );
}

export function planReceiptBackfill(tree, rows) {
  const epoch1 = (tree.closedEpochs || []).find((epoch) => epoch.epoch === 1)
    || (tree.epoch === 1 ? tree : null);
  if (!epoch1) {
    const err = new Error('epoch1_missing');
    err.code = 'epoch1_missing';
    throw err;
  }
  const meta = epoch1.meta || [];
  const receiptLeaves = meta.filter((row) => row?.task_id && row.task_id !== 'genesis');
  const last = receiptLeaves[receiptLeaves.length - 1];
  if (!last) {
    const err = new Error('epoch1_has_no_receipt_leaf');
    err.code = 'epoch1_has_no_receipt_leaf';
    throw err;
  }
  const known = new Set();
  const collect = (list) => {
    for (const row of list || []) {
      if (row?.task_id) known.add(String(row.task_id));
    }
  };
  for (const epoch of tree.closedEpochs || []) collect(epoch.meta);
  collect(tree.meta);
  const list = Array.isArray(rows) ? rows : [];
  const start = list.findIndex((row) => String(row?.task_id || '') === String(last.task_id));
  if (start < 0) {
    const err = new Error(`epoch1_tail_missing: ${last.task_id}`);
    err.code = 'epoch1_tail_missing';
    throw err;
  }
  const append = [];
  for (let i = start + 1; i < list.length; i += 1) {
    const id = list[i]?.task_id ? String(list[i].task_id) : '';
    if (!id || known.has(id)) continue;
    known.add(id);
    append.push({ task_id: id, row_hash: list[i].row_hash || '' });
  }
  return { last_task_id: String(last.task_id), append };
}
