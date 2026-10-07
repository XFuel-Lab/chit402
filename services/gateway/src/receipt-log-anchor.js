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
import { Wallet, getAddress } from 'ethers';
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

function readPinFile(env) {
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

/**
 * The committed pin is always the gate: both epoch prefixes, the chain
 * hash list, and the RPC checks. Env may only add a stricter current
 * root. A value that disagrees with a closed epoch refuses boot.
 */
export function readReceiptLogPin(env = process.env) {
  const filePin = readPinFile(env);
  const epochEnv = env.RECEIPT_LOG_EXPECTED_EPOCH;
  const rootEnv = env.RECEIPT_LOG_EXPECTED_ROOT;
  const hasEpoch = epochEnv != null && String(epochEnv) !== '';
  const hasRoot = rootEnv != null && String(rootEnv) !== '';
  if (!hasEpoch && !hasRoot) return filePin;
  if (!hasEpoch || !hasRoot) {
    throw new ReceiptLogRefused(
      'bad_pin',
      'RECEIPT_LOG_EXPECTED_EPOCH and RECEIPT_LOG_EXPECTED_ROOT must both be set. They cannot replace the committed pin.',
    );
  }
  const root = normalizeRoot(rootEnv);
  const epoch = Number(epochEnv);
  if (!root || !Number.isInteger(epoch) || epoch < 1) {
    throw new ReceiptLogRefused(
      'bad_pin',
      'RECEIPT_LOG_EXPECTED_EPOCH and RECEIPT_LOG_EXPECTED_ROOT must both be set to an epoch number and a 32-byte root',
    );
  }
  if (!filePin) {
    throw new ReceiptLogRefused('bad_pin', 'env expected root cannot replace a missing receipt log pin file');
  }
  const pinned = filePin.epochs.find((row) => Number(row.epoch) === epoch);
  if (!pinned) {
    throw new ReceiptLogRefused('bad_pin', `env epoch ${epoch} is not in the committed pin`);
  }
  const pinnedRoot = normalizeRoot(pinned.root || pinned.opening_root);
  const closed = Number(pinned.epoch) === 1 || pinned.status === 'closed' || (pinned.tree_size != null && !pinned.opening_root);
  if (closed && root !== pinnedRoot) {
    throw new ReceiptLogRefused(
      'bad_pin',
      `env root ${root} conflicts with the committed epoch ${epoch} root ${pinnedRoot}`,
    );
  }
  return {
    ...filePin,
    stricter: root === pinnedRoot ? null : { epoch, root },
    source: 'file',
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
  if (pin?.stricter?.root) {
    const leaves = epochLeaves(tree, Number(pin.stricter.epoch));
    if (!leaves?.length) {
      throw new ReceiptLogRefused(
        'pin_unmet',
        `env epoch ${pin.stricter.epoch} is not in the journal`,
      );
    }
    const full = Buffer.from(epochRootOf(leaves)).toString('hex');
    if (full !== pin.stricter.root) {
      throw new ReceiptLogRefused(
        'pin_unmet',
        `epoch ${pin.stricter.epoch} root ${full} does not meet the stricter env root ${pin.stricter.root}`,
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

function receiptSucceeded(status) {
  return status === '0x1' || status === 1 || status === '0x01';
}

/**
 * Sender for Base anchors. The private key wins when FROM is unset.
 * Both set and different refuses boot. A key that does not parse refuses boot.
 */
export function resolveAnchorSender(env = process.env) {
  const key = env.RECEIPT_ANCHOR_PRIVATE_KEY || '';
  const fromRaw = env.RECEIPT_ANCHOR_FROM || '';
  let derived = null;
  if (key) {
    try {
      derived = new Wallet(key).address;
    } catch (err) {
      throw new ReceiptLogRefused(
        'anchor_key',
        `RECEIPT_ANCHOR_PRIVATE_KEY is not a signing key: ${err.message}`,
      );
    }
  }
  let from = null;
  if (fromRaw) {
    try {
      from = getAddress(fromRaw);
    } catch {
      throw new ReceiptLogRefused('anchor_from', 'RECEIPT_ANCHOR_FROM is not an address');
    }
  }
  if (from && derived && from.toLowerCase() !== derived.toLowerCase()) {
    throw new ReceiptLogRefused(
      'anchor_sender_mismatch',
      'RECEIPT_ANCHOR_FROM does not match the address of RECEIPT_ANCHOR_PRIVATE_KEY',
    );
  }
  return derived || from || null;
}

export function anchorWalletAddress(env = process.env) {
  return resolveAnchorSender(env);
}

/** Production Base mainnet. Signed anchors use this chain id. */
export const BASE_ANCHOR_CHAIN_ID = 8453;
export const BASE_ANCHOR_CHAIN_ID_HEX = '0x2105';

function chainIdIsBaseMainnet(chainId) {
  if (chainId == null || chainId === '') return false;
  if (Number(chainId) === BASE_ANCHOR_CHAIN_ID) return true;
  const hex = String(chainId).toLowerCase();
  if (!hex.startsWith('0x')) return false;
  const body = hex.slice(2).replace(/^0+/, '') || '0';
  return `0x${body}` === BASE_ANCHOR_CHAIN_ID_HEX;
}

/**
 * Refuse unless BASE_RPC_URL is Base mainnet. No URL and no injected
 * request means there is no RPC to send to. A wrong or failed eth_chainId
 * throws anchor_chain_mismatch before any signed bytes are broadcast.
 */
export async function assertBaseChainId({ rpcUrl, request } = {}) {
  const url = rpcUrl || process.env.BASE_RPC_URL || process.env.SETTLEMENT_RPC_URL || '';
  if (!url && typeof request !== 'function') return null;
  let chainId;
  try {
    chainId = await rpc(url, 'eth_chainId', [], request);
  } catch (err) {
    throw new ReceiptLogRefused('anchor_chain_mismatch', `eth_chainId failed: ${err.message}`);
  }
  if (!chainIdIsBaseMainnet(chainId)) {
    throw new ReceiptLogRefused(
      'anchor_chain_mismatch',
      `BASE_RPC_URL chain id is ${chainId || 'empty'}, want ${BASE_ANCHOR_CHAIN_ID_HEX}`,
    );
  }
  return chainId;
}

/**
 * Adopt only a mined self-transfer whose calldata is exactly the intent
 * root, whose sender is ours, and whose receipt status is 1.
 * Anything else mined at that nonce is replaced.
 * A missing hash is rebroadcast only when the latest nonce count has not
 * passed the reserved nonce. RPC errors stay blocked.
 * ots_getTransactionBySenderAndNonce is optional. Public Base RPC does not
 * implement it, and a failure there is not an answer.
 */
export async function lookupBaseTxByNonceOrHash({
  rpcUrl,
  txHash,
  root,
  nonce,
  from,
  to,
  request,
} = {}) {
  const want = normalizeRoot(root);
  let sender = '';
  try {
    sender = String(from || resolveAnchorSender() || '').toLowerCase();
  } catch (err) {
    if (err?.code === 'anchor_sender_mismatch' || err?.code === 'anchor_key' || err?.code === 'anchor_from') {
      throw err;
    }
    return { pending: true, blocked: true, reason: 'sender_unknown' };
  }
  const anchorTo = String(to || sender || '').toLowerCase();
  if (!sender || !anchorTo) {
    return { pending: true, blocked: true, reason: 'sender_unknown' };
  }
  const url = rpcUrl || process.env.BASE_RPC_URL || process.env.SETTLEMENT_RPC_URL || '';

  const classify = async (tx, hash) => {
    const txFrom = String(tx.from || '').toLowerCase();
    const txTo = String(tx.to || '').toLowerCase();
    const txNonce = tx.nonce == null ? null : Number(tx.nonce);
    const got = calldataRoot(tx.input || tx.data);
    let receipt;
    try {
      receipt = await rpc(url, 'eth_getTransactionReceipt', [hash], request);
    } catch {
      return { pending: true, blocked: true, reason: 'rpc_error', tx: hash };
    }
    const rootOk = Boolean(want && got && got === want);
    const fromOk = txFrom === sender;
    const toOk = txTo === anchorTo;
    const nonceOk = nonce == null || txNonce == null || txNonce === Number(nonce);
    if (!receipt) {
      if (rootOk && fromOk && toOk && nonceOk) {
        return { visible: true, tx: hash, nonce: txNonce, root: got, from: txFrom, to: txTo };
      }
      return { pending: true, blocked: true, tx: hash, reason: 'receipt_pending' };
    }
    const ok = receiptSucceeded(receipt.status);
    if (ok && rootOk && fromOk && toOk && nonceOk) {
      return {
        tx: hash,
        nonce: txNonce,
        root: got,
        from: txFrom,
        to: txTo,
        receiptOk: true,
        receiptStatus: receipt.status,
      };
    }
    return {
      replaced: true,
      mined: true,
      tx: hash,
      root: got,
      reason: !ok ? 'receipt_failed'
        : !rootOk ? 'calldata_replaced'
          : !fromOk ? 'from_mismatch'
            : !toOk ? 'to_mismatch'
              : 'nonce_mismatch',
    };
  };

  if (txHash) {
    let tx;
    try {
      tx = await rpc(url, 'eth_getTransactionByHash', [txHash], request);
    } catch {
      return { pending: true, blocked: true, reason: 'rpc_error' };
    }
    if (tx) return classify(tx, tx.hash || txHash);
    return classifyMissingHash({ url, nonce, sender, txHash, request });
  }

  if (nonce != null) {
    const nonceHex = `0x${Number(nonce).toString(16)}`;
    try {
      const probed = await rpc(url, 'ots_getTransactionBySenderAndNonce', [sender, nonceHex], request);
      if (probed) return classify(probed, probed.hash);
    } catch {
      // Optional. A normal RPC has no ots method.
    }
    return classifyMissingHash({ url, nonce, sender, txHash: null, request });
  }
  return { pending: true, blocked: true, reason: 'no_tx_hash' };
}

async function classifyMissingHash({ url, nonce, sender, txHash, request }) {
  if (nonce == null || !sender) {
    return { pending: true, blocked: true, reason: 'nonce_unknown', tx: txHash };
  }
  let countRaw;
  try {
    countRaw = await rpc(url, 'eth_getTransactionCount', [sender, 'latest'], request);
  } catch {
    return { pending: true, blocked: true, reason: 'rpc_error', tx: txHash };
  }
  const count = Number(countRaw);
  if (!Number.isInteger(count)) {
    return { pending: true, blocked: true, reason: 'rpc_error', tx: txHash };
  }
  if (count <= Number(nonce)) {
    return { missing: true, rebroadcast: true, tx: txHash, nonce: Number(nonce) };
  }
  return { replaced: true, reason: 'nonce_consumed', tx: txHash, nonce: Number(nonce) };
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
  const unscoped = [];
  for (const row of list) {
    const id = Number(row?.agent_id);
    const hasChain = Boolean(row?.task_id) || row?.seq != null;
    if (!Number.isInteger(id) || id < 1) {
      if (hasChain) {
        unscoped.push(row);
        refusals.push({
          task_id: row?.task_id ? String(row.task_id) : null,
          reason: 'missing_agent_id',
        });
      }
      continue;
    }
    const group = byAgent.get(id) || [];
    group.push(row);
    byAgent.set(id, group);
  }
  if (unscoped.length > 0) {
    const analysis = analyzeSeq(unscoped);
    if (analysis.forked || analysis.status === 'FORKED' || analysis.duplicates.length > 0) {
      refusals.push({
        reason: 'FORKED',
        gaps: analysis.gaps,
        duplicates: analysis.duplicates,
      });
    } else if (analysis.gaps.length > 0 || analysis.status === 'gapped') {
      refusals.push({
        reason: 'gap',
        gaps: analysis.gaps,
        duplicates: analysis.duplicates,
      });
    }
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
