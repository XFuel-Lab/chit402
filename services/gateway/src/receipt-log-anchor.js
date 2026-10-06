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
import { epochRootOf } from './receipt-log-epoch.js';
import { analyzeSeq } from './book-seq.js';

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
  const epochs = Array.isArray(parsed.epochs) ? parsed.epochs : [];
  if (epochs.length === 0 && parsed.root) {
    epochs.push({ epoch: Number(parsed.epoch), root: parsed.root, tree_size: parsed.tree_size });
  }
  if (epochs.length === 0) {
    throw new ReceiptLogRefused('bad_pin', 'receipt log pin file needs epochs');
  }
  const first = epochs[0];
  return {
    epoch: Number(first.epoch),
    root: normalizeRoot(first.root || first.opening_root),
    epochs,
    anchors: Array.isArray(parsed.anchors) ? parsed.anchors : [],
    source: 'file',
    file,
  };
}

export function epochLeaves(tree, epochNo) {
  const closed = (tree?.closedEpochs || []).find((row) => row.epoch === epochNo);
  if (closed) return closed.leaves || [];
  if (tree?.epoch === epochNo) return tree.leaves || [];
  return null;
}

/**
 * Recompute each pinned epoch from the journal leaves. An empty journal
 * fails here too: it has neither epoch.
 */
export function assertJournalMatchesPin(tree, pin) {
  const epochs = pin?.epochs || (pin?.root ? [{ epoch: pin.epoch, root: pin.root, tree_size: pin.tree_size }] : []);
  if (epochs.length === 0) {
    throw new ReceiptLogRefused('bad_pin', 'receipt log pin has no epochs');
  }
  for (const wanted of epochs) {
    const leaves = epochLeaves(tree, Number(wanted.epoch));
    const stated = wanted.tree_size || wanted.opening_size;
    const size = stated == null || stated === '' ? leaves?.length || 0 : Number(stated);
    const root = normalizeRoot(wanted.root || wanted.opening_root);
    if (!leaves || !root || !size) {
      throw new ReceiptLogRefused(
        'pin_unmet',
        `journal has no epoch ${wanted.epoch} to compare with the pin`,
      );
    }
    if (leaves.length < size) {
      throw new ReceiptLogRefused(
        'pin_unmet',
        `epoch ${wanted.epoch} has ${leaves.length} leaves; pin requires ${size}`,
      );
    }
    const recomputed = Buffer.from(epochRootOf(leaves.slice(0, size))).toString('hex');
    if (recomputed !== root) {
      throw new ReceiptLogRefused(
        'pin_unmet',
        `epoch ${wanted.epoch} recomputed ${recomputed} does not match pin ${root}`,
      );
    }
  }
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
 * Load one known anchor by hash. Base uses eth_getTransactionByHash.
 * Solana uses getTransaction. A null RPC result refuses the boot.
 */
export async function assertKnownAnchorTxs(pin, { request, baseRpc, solanaRpc, tree } = {}) {
  const anchors = pin?.anchors || [];
  const roots = tree ? knownHeadRoots(tree) : null;
  for (const anchor of anchors) {
    const want = normalizeRoot(anchor.root);
    if (!want) {
      throw new ReceiptLogRefused('bad_pin', 'pin anchor is missing a 32-byte root');
    }
    if (!anchor.tx) {
      throw new ReceiptLogRefused(
        'anchor_tx_unspecified',
        `pin anchor for root ${want} on ${anchor.chain || 'base'} has no transaction hash`,
      );
    }
    const chain = anchor.chain || 'base';
    let tx = null;
    if (chain === 'solana') {
      const url = solanaRpc || process.env.SOLANA_RPC_URL || '';
      if (!url && !request) {
        throw new ReceiptLogRefused('anchor_rpc_missing', 'Solana RPC is not configured');
      }
      tx = await rpc(url, 'getTransaction', [anchor.tx, { encoding: 'json', maxSupportedTransactionVersion: 0 }], request);
      if (!tx) {
        throw new ReceiptLogRefused('anchor_rpc_missing', `Solana did not return ${anchor.tx}`);
      }
      if (!JSON.stringify(tx).includes(want)) {
        throw new ReceiptLogRefused('anchor_root_mismatch', `Solana tx ${anchor.tx} does not contain ${want}`);
      }
    } else {
      const url = baseRpc || process.env.BASE_RPC_URL || process.env.SETTLEMENT_RPC_URL || '';
      if (!url && !request) {
        throw new ReceiptLogRefused('anchor_rpc_missing', 'Base RPC is not configured');
      }
      tx = await rpc(url, 'eth_getTransactionByHash', [anchor.tx], request);
      if (!tx) {
        throw new ReceiptLogRefused('anchor_rpc_missing', `Base did not return ${anchor.tx}`);
      }
      const got = calldataRoot(tx.input || tx.data);
      if (got !== want) {
        throw new ReceiptLogRefused('anchor_root_mismatch', `Base tx ${anchor.tx} calldata is ${got || 'empty'}`);
      }
    }
    // Orphans and intermediate heads are on chain and are not stored as
    // journal heads. Only anchors with in_journal left on (the default)
    // have to appear in the head history.
    if (roots && anchor.in_journal !== false && !roots.has(want)) {
      throw new ReceiptLogRefused(
        'anchor_not_in_journal',
        `anchored root ${want} from ${anchor.tx} is not in the journal head history`,
      );
    }
  }
}

/**
 * Receipt lookup for a write-ahead intent. A broadcast hash is not anchored
 * until eth_getTransactionReceipt says the transaction landed. A missing
 * transaction was dropped and may be resent at the same nonce.
 */
export async function lookupBaseTxByNonceOrHash({
  rpcUrl,
  txHash,
  root,
  request,
} = {}) {
  const want = normalizeRoot(root);
  if (!txHash) return null;
  const url = rpcUrl || process.env.BASE_RPC_URL || process.env.SETTLEMENT_RPC_URL || '';
  const tx = await rpc(url, 'eth_getTransactionByHash', [txHash], request);
  if (!tx) return { dropped: true };
  const receipt = await rpc(url, 'eth_getTransactionReceipt', [txHash], request);
  if (!receipt) return { dropped: true };
  const status = receipt.status;
  const ok = status === '0x1' || status === 1 || status === '0x01';
  const got = calldataRoot(tx.input);
  if (want && got && got !== want) return { mismatch: true, tx: tx.hash, root: got };
  if (!ok) return { mined: true, receiptOk: false, tx: tx.hash, root: got };
  return { tx: tx.hash, nonce: Number(tx.nonce), root: got, receiptOk: true };
}

export function anchorWalletAddress() {
  return process.env.RECEIPT_ANCHOR_FROM || null;
}

/**
 * Refuse when the latest Base root anchor is not in the journal head history.
 * No RPC and no injected reader means there is nothing to compare.
 */
export async function assertLatestBaseAnchor(tree, opts = {}) {
  if (typeof opts.readLatest === 'function') {
    const found = await opts.readLatest();
    if (!found?.root) return;
    const root = normalizeRoot(found.root);
    if (!root) return;
    if (knownHeadRoots(tree).has(root)) return;
    throw new ReceiptLogRefused(
      'anchor_not_in_journal',
      `Base anchor root ${root} from ${found.tx || 'the anchor wallet'} is not in the journal head history`,
    );
  }
  const pin = opts.pin || readReceiptLogPin();
  await assertKnownAnchorTxs(pin, {
    request: opts.request,
    baseRpc: opts.baseRpc,
    solanaRpc: opts.solanaRpc,
    tree,
  });
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
  const refusals = [];
  const byAgent = new Map();
  for (const row of list) {
    const id = Number(row?.agent_id);
    if (!Number.isInteger(id) || id < 1) continue;
    const group = byAgent.get(id) || [];
    group.push(row);
    byAgent.set(id, group);
  }
  for (const [agentId, group] of byAgent) {
    const analysis = analyzeSeq(group);
    if (analysis.forked || analysis.status === 'FORKED' || analysis.duplicates.length > 0) {
      refusals.push({
        agent_id: agentId,
        reason: 'FORKED',
        gaps: analysis.gaps,
        duplicates: analysis.duplicates,
      });
    } else if (analysis.gaps.length > 0 || analysis.status === 'gapped') {
      refusals.push({
        agent_id: agentId,
        reason: 'gap',
        gaps: analysis.gaps,
        duplicates: analysis.duplicates,
      });
    }
  }
  for (const row of list) {
    if (!row?.task_id) continue;
    if (row.row_hash == null || row.row_hash === '') {
      refusals.push({ task_id: String(row.task_id), reason: 'missing_row_hash' });
    }
  }
  if (refusals.length > 0) {
    const err = new Error('backfill_refused');
    err.code = 'backfill_refused';
    err.refusals = refusals;
    throw err;
  }
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
