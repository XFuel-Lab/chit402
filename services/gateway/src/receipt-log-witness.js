/**
 * Base witness for the receipt log. Off unless RECEIPT_LOG_WITNESS=1.
 *
 * When the flag is on, the daily anchor sends `ChitLogWitness.append` with an
 * RFC 6962 consistency proof from the head the contract already stores. The
 * zero-value self-transfer (bare 32-byte root) still goes out. That transfer
 * is an extra witness. It is not the acceptance check.
 *
 * Boot reads the contract head and refuses to start unless the journal is a
 * consistent extension of that head in the same epoch. A new epoch is accepted
 * only after the Safe has called `declareEpoch`. The Oct 5 reset, a size-1
 * root with no link to the size-4 head, is not an extension.
 */
import { Wallet, JsonRpcProvider, Interface, keccak256 } from 'ethers';
import logger from './logger.js';
import { ReceiptLogRefused } from './receipt-log-store.js';
import { consistencyProof, rootOf, verifyConsistency } from './receipt-merkle.js';

export const WITNESS_ABI = [
  'function head() view returns (uint256 epoch, uint256 size, bytes32 root)',
  'function accepts(uint256 newSize, bytes32 newRoot, bytes32[] proof) view returns (bool)',
  'function append(uint256 newSize, bytes32 newRoot, bytes32[] proof)',
  'function appender() view returns (address)',
  'function owner() view returns (address)',
];

const iface = new Interface(WITNESS_ABI);

/** Runtime code hash of ChitLogWitness at solc 0.8.24, optimizer 200. */
export const CHIT_LOG_WITNESS_CODEHASH = '0xdb6c644296d0fd4ca867c38fc4fc9c2fd20ca19b4b8ed69b2701c32c9c79e63a';

export function witnessCodeMatches(bytecode) {
  const code = String(bytecode || '');
  if (!code || code === '0x') return false;
  return keccak256(code).toLowerCase() === CHIT_LOG_WITNESS_CODEHASH;
}

/** The only on value is `1`. Unset, `0`, `true`, and `yes` stay off. */
export function receiptWitnessEnabled(env = process.env) {
  return env.RECEIPT_LOG_WITNESS === '1';
}

export function witnessAddress(env = process.env) {
  const raw = String(env.CHIT_LOG_WITNESS_ADDRESS || '').trim();
  return raw || null;
}

export function witnessRpcUrl(env = process.env) {
  return env.BASE_RPC_URL || env.SETTLEMENT_RPC_URL || null;
}

function witnessPrivateKey(env = process.env) {
  return env.RECEIPT_WITNESS_PRIVATE_KEY || env.RECEIPT_ANCHOR_PRIVATE_KEY || null;
}

export function encodeAppend(newSize, newRoot, proof) {
  const root = `0x${String(newRoot).replace(/^0x/, '')}`;
  const nodes = (proof || []).map((node) => `0x${String(node).replace(/^0x/, '')}`);
  return iface.encodeFunctionData('append', [BigInt(newSize), root, nodes]);
}

export function decodeHead(data) {
  const [epoch, size, root] = iface.decodeFunctionResult('head', data);
  return {
    epoch: Number(epoch),
    size: Number(size),
    root: String(root).replace(/^0x/, '').toLowerCase(),
  };
}

export async function readWitnessCode({
  address = witnessAddress(),
  rpcUrl = witnessRpcUrl(),
  request = null,
} = {}) {
  if (!address) throw new Error('witness_unconfigured');
  if (typeof request === 'function') {
    return request(rpcUrl, 'eth_getCode', [address, 'latest']);
  }
  if (!rpcUrl) throw new Error('no_rpc');
  const provider = new JsonRpcProvider(rpcUrl);
  return provider.getCode(address);
}

export async function readWitnessHead({
  address = witnessAddress(),
  rpcUrl = witnessRpcUrl(),
  request = null,
} = {}) {
  if (!address) throw new Error('witness_unconfigured');
  if (!rpcUrl && typeof request !== 'function') throw new Error('no_rpc');
  const data = iface.encodeFunctionData('head', []);
  let raw;
  if (typeof request === 'function') {
    raw = await request(rpcUrl, 'eth_call', [{ to: address, data }, 'latest']);
  } else {
    const provider = new JsonRpcProvider(rpcUrl);
    raw = await provider.call({ to: address, data });
  }
  if (!raw || raw === '0x') throw new Error('witness_empty');
  return decodeHead(raw);
}

function prefixRoot(leaves, size) {
  return Buffer.from(rootOf(leaves.slice(0, size))).toString('hex');
}

/**
 * The open epoch must be the contract epoch, and the journal prefix at the
 * contract size must be the contract root. A larger journal must verify as
 * an RFC 6962 extension. A smaller journal, a different epoch, or a different
 * root at the same size is refused.
 */
export function journalExtendsHead(tree, contractHead) {
  const epoch = Number(tree?.epoch);
  const leaves = tree?.leaves || [];
  const size = leaves.length;
  const root = size ? prefixRoot(leaves, size) : null;
  const stored = {
    epoch: Number(contractHead?.epoch),
    size: Number(contractHead?.size),
    root: String(contractHead?.root || '').replace(/^0x/, '').toLowerCase(),
  };
  if (!Number.isInteger(stored.epoch) || stored.epoch < 1 || !Number.isInteger(stored.size) || stored.size < 1) {
    return { ok: false, reason: 'witness_head', detail: 'contract head is not a tree' };
  }
  if (!/^[0-9a-f]{64}$/.test(stored.root)) {
    return { ok: false, reason: 'witness_head', detail: 'contract root is not 32 bytes' };
  }
  if (epoch !== stored.epoch) {
    return {
      ok: false,
      reason: 'witness_epoch',
      detail: `contract epoch ${stored.epoch} size ${stored.size} root ${stored.root}; journal epoch ${epoch} size ${size} root ${root || 'none'}. A new epoch counts only after the Safe calls declareEpoch`,
    };
  }
  if (size < stored.size) {
    return {
      ok: false,
      reason: 'witness_shrink',
      detail: `journal size ${size} is behind contract size ${stored.size}`,
    };
  }
  const atStored = prefixRoot(leaves, stored.size);
  if (atStored !== stored.root) {
    return {
      ok: false,
      reason: 'witness_root',
      detail: `journal prefix at size ${stored.size} is ${atStored}, contract root is ${stored.root}`,
    };
  }
  if (size === stored.size) return { ok: true, proof: [] };
  const proof = consistencyProof(leaves, stored.size, size);
  if (!verifyConsistency(stored.size, size, stored.root, root, proof)) {
    return { ok: false, reason: 'witness_proof', detail: 'RFC 6962 consistency proof did not verify' };
  }
  return { ok: true, proof, root };
}

export async function assertWitnessJournal(tree, opts = {}) {
  const enabled = opts.enabled !== undefined ? opts.enabled : receiptWitnessEnabled();
  if (!enabled) return { checked: false };
  const address = opts.address !== undefined ? opts.address : witnessAddress();
  if (!address) {
    throw new ReceiptLogRefused(
      'witness_unconfigured',
      'RECEIPT_LOG_WITNESS=1 and CHIT_LOG_WITNESS_ADDRESS is unset',
    );
  }
  let contractHead;
  try {
    contractHead = typeof opts.readHead === 'function'
      ? await opts.readHead()
      : await readWitnessHead({ address, rpcUrl: opts.rpcUrl, request: opts.request });
  } catch (err) {
    throw new ReceiptLogRefused('witness_rpc', err.message || 'witness head read failed');
  }
  if (typeof opts.readCode === 'function') {
    const code = await opts.readCode();
    if (!witnessCodeMatches(code)) {
      throw new ReceiptLogRefused(
        'witness_code',
        'witness runtime code hash does not match the pinned ChitLogWitness',
      );
    }
  }
  const check = journalExtendsHead(tree, contractHead);
  if (!check.ok) {
    throw new ReceiptLogRefused(check.reason || 'witness_not_extension', check.detail || 'journal is not an extension of the witness head');
  }
  return { checked: true, head: contractHead };
}

/**
 * Build the append the daily anchor should send. `sameKey` means the witness
 * signer is the Base anchor signer, so the two transactions must use
 * consecutive nonces. Returns null when the flag is off.
 */
export async function planWitnessAppend(tree, rootHex, opts = {}) {
  if (!(opts.enabled !== undefined ? opts.enabled : receiptWitnessEnabled())) return null;
  const address = opts.address !== undefined ? opts.address : witnessAddress();
  const key = opts.privateKey !== undefined ? opts.privateKey : witnessPrivateKey();
  const pending = (reason) => ({
    status: 'pending',
    reason,
    to: address,
    tx: null,
    calldata: null,
  });
  if (!address) return pending('witness_unconfigured');
  if (!key) return pending('no_key');
  let contractHead;
  try {
    contractHead = typeof opts.readHead === 'function'
      ? await opts.readHead()
      : await readWitnessHead({ address, rpcUrl: opts.rpcUrl, request: opts.request });
  } catch (err) {
    return pending(err.message || 'witness_rpc');
  }
  const check = journalExtendsHead(tree, contractHead);
  if (!check.ok) return pending(check.reason || 'witness_not_extension');
  if (contractHead.size === tree.leaves.length && contractHead.root === String(rootHex).toLowerCase()) {
    return {
      status: 'witnessed',
      reason: 'already',
      to: address,
      tx: null,
      calldata: null,
      epoch: contractHead.epoch,
      size: contractHead.size,
      root: contractHead.root,
    };
  }
  const proof = check.proof || [];
  const calldata = encodeAppend(tree.leaves.length, rootHex, proof);
  return {
    status: 'ready',
    reason: null,
    to: address,
    calldata,
    tx: null,
    proof,
    newSize: tree.leaves.length,
    newRoot: String(rootHex).replace(/^0x/, '').toLowerCase(),
    privateKey: key,
  };
}

function receiptOk(status) {
  return status === '0x1' || status === 1 || status === '0x01' || status === true;
}

/**
 * A hash from sendTransaction is `broadcast`, not witnessed. `witnessed`
 * requires a mined success receipt and `head()` equal to the new size and root.
 * A mined failure is `reverted`. A send that throws before a hash is `failed`.
 */
export async function confirmWitnessAppend(record, {
  readReceipt = null,
  readHead = null,
  rpcUrl = witnessRpcUrl(),
  address = witnessAddress(),
  request = null,
} = {}) {
  if (!record?.tx) {
    return { ...record, status: 'failed', reason: record?.reason || 'no_tx' };
  }
  let receipt = null;
  try {
    if (typeof readReceipt === 'function') receipt = await readReceipt(record.tx);
    else if (rpcUrl) {
      const provider = new JsonRpcProvider(rpcUrl);
      receipt = await provider.getTransactionReceipt(record.tx);
    } else {
      return { ...record, status: 'broadcast', reason: 'unmined' };
    }
  } catch (err) {
    return { ...record, status: 'broadcast', reason: err.message || 'receipt_rpc' };
  }
  if (!receipt) return { ...record, status: 'broadcast', reason: 'unmined' };
  if (!receiptOk(receipt.status)) {
    return { ...record, status: 'reverted', reason: 'reverted' };
  }
  let onchain;
  try {
    onchain = typeof readHead === 'function'
      ? await readHead()
      : await readWitnessHead({ address, rpcUrl, request });
  } catch (err) {
    return { ...record, status: 'broadcast', reason: err.message || 'head_unconfirmed' };
  }
  const root = String(onchain?.root || '').replace(/^0x/, '').toLowerCase();
  const want = String(record.newRoot || '').replace(/^0x/, '').toLowerCase();
  if (Number(onchain?.size) === Number(record.newSize) && root === want && root) {
    return {
      ...record,
      status: 'witnessed',
      reason: null,
      size: Number(onchain.size),
      root,
    };
  }
  return { ...record, status: 'failed', reason: 'head_mismatch' };
}

export async function sendWitnessAppend(plan, {
  send = null,
  nonce = null,
  rpcUrl = witnessRpcUrl(),
  readReceipt = null,
  readHead = null,
  request = null,
} = {}) {
  if (!plan || plan.status !== 'ready') return plan;
  const base = {
    to: plan.to,
    calldata: plan.calldata,
    newSize: plan.newSize,
    newRoot: plan.newRoot,
  };
  let tx = null;
  try {
    if (typeof send === 'function') {
      tx = await send({ to: plan.to, data: plan.calldata, value: '0', nonce });
    } else {
      if (!rpcUrl) return { ...base, status: 'pending', reason: 'no_rpc', tx: null };
      const provider = new JsonRpcProvider(rpcUrl);
      const wallet = new Wallet(plan.privateKey, provider);
      const sent = await wallet.sendTransaction({
        to: plan.to,
        data: plan.calldata,
        value: 0n,
        ...(nonce != null ? { nonce } : {}),
      });
      tx = sent.hash;
    }
  } catch (err) {
    logger.error({ err: err.message }, 'receipt witness append failed');
    return { ...base, status: 'failed', reason: err.message || 'send_failed', tx: null };
  }
  if (!tx) return { ...base, status: 'failed', reason: 'no_tx', tx: null };
  return confirmWitnessAppend(
    { ...base, status: 'broadcast', reason: 'unmined', tx },
    { readReceipt, readHead, rpcUrl, address: plan.to, request },
  );
}

/** Boot refuses a shared anchor and appender key. The appender is a separate key. */
export function assertDistinctWitnessKey(env = process.env) {
  if (!receiptWitnessEnabled(env)) return { ok: true, skipped: true };
  if (!witnessSharesAnchorKey(env)) return { ok: true };
  throw new ReceiptLogRefused(
    'witness_same_key',
    'RECEIPT_LOG_WITNESS appender address equals the Base anchor address. Use a separate appender key.',
  );
}

export function witnessSignerAddress(env = process.env) {
  const key = witnessPrivateKey(env);
  if (!key) return null;
  try {
    return new Wallet(key).address.toLowerCase();
  } catch {
    return null;
  }
}

export function anchorSignerAddress(env = process.env) {
  const key = env.RECEIPT_ANCHOR_PRIVATE_KEY;
  if (!key) return null;
  try {
    return new Wallet(key).address.toLowerCase();
  } catch {
    return null;
  }
}

/** True when the witness append and the bare-root transfer share a nonce stream. */
export function witnessSharesAnchorKey(env = process.env) {
  const left = witnessSignerAddress(env);
  const right = anchorSignerAddress(env);
  return Boolean(left && right && left === right);
}
