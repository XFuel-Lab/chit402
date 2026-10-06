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
import { AbiCoder, Wallet, JsonRpcProvider, Interface, keccak256 } from 'ethers';
import { EPOCH1_FINAL_ROOT } from './receipt-log-epoch.js';
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

/**
 * Creation (init) bytecode hash and length, without constructor args.
 * A deployment is this init code plus abi.encode(owner, appender, 1, 4, dd20e39a…).
 * The address and creation tx hash are empty until Christopher deploys.
 * Boot and the verifier refuse a witness until both are set, because a
 * matching runtime hash can be returned by other init code.
 */
export const CHIT_LOG_WITNESS_INIT_CODE_HASH = '0xdc6fe53c6d13b36e59069b4c23442cbfefda18aa28775f14bf2daae98f8bc901';
export const CHIT_LOG_WITNESS_INIT_CODE_BYTES = 3613;
export const CHIT_LOG_WITNESS_ADDRESS_PIN = null;
export const CHIT_LOG_WITNESS_CREATION_TX_PIN = null;

export function witnessCreationPin(env = process.env) {
  const address = env.CHIT_LOG_WITNESS_ADDRESS || CHIT_LOG_WITNESS_ADDRESS_PIN || null;
  const tx = env.CHIT_LOG_WITNESS_CREATION_TX || CHIT_LOG_WITNESS_CREATION_TX_PIN || null;
  return { address, tx };
}

/**
 * True when `input` is our creation bytecode plus the epoch-1 constructor
 * args, and the receipt created `address`.
 */
export function witnessCreationMatches(input, receipt, address) {
  const raw = String(input || '').toLowerCase();
  if (!raw.startsWith('0x')) return { ok: false, reason: 'witness_creation_input' };
  const body = raw.slice(2);
  const prefixLen = CHIT_LOG_WITNESS_INIT_CODE_BYTES * 2;
  if (body.length <= prefixLen) return { ok: false, reason: 'witness_creation_input' };
  const prefix = `0x${body.slice(0, prefixLen)}`;
  if (keccak256(prefix).toLowerCase() !== CHIT_LOG_WITNESS_INIT_CODE_HASH) {
    return { ok: false, reason: 'witness_creation_input' };
  }
  let decoded;
  try {
    decoded = AbiCoder.defaultAbiCoder().decode(
      ['address', 'address', 'uint256', 'uint256', 'bytes32'],
      `0x${body.slice(prefixLen)}`,
    );
  } catch {
    return { ok: false, reason: 'witness_creation_args' };
  }
  const epoch = Number(decoded[2]);
  const size = Number(decoded[3]);
  const root = String(decoded[4]).replace(/^0x/, '').toLowerCase();
  if (epoch !== 1 || size !== 4 || root !== EPOCH1_FINAL_ROOT) {
    return { ok: false, reason: 'witness_creation_args' };
  }
  if (String(decoded[0]).toLowerCase() === '0x0000000000000000000000000000000000000000') {
    return { ok: false, reason: 'witness_creation_args' };
  }
  const created = String(receipt?.contractAddress || '').toLowerCase();
  if (!created || created !== String(address || '').toLowerCase()) {
    return { ok: false, reason: 'witness_creation_address' };
  }
  const status = receipt?.status;
  if (!(status === '0x1' || status === 1 || status === '0x01')) {
    return { ok: false, reason: 'witness_creation_receipt' };
  }
  return { ok: true, owner: String(decoded[0]), appender: String(decoded[1]) };
}

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

/** Base mainnet. The witness refuses this id unless Christopher has signed off. */
export const WITNESS_MAINNET_CHAIN_ID = 8453;

/**
 * The chain the witness may sign for. There is no default.
 * 8453 is refused unless RECEIPT_LOG_WITNESS_ALLOW_MAINNET is exactly `1`.
 * That flag is Christopher's personal sign-off, not a dry-run switch.
 */
export function parseWitnessChainId(env = process.env) {
  const raw = env.BASE_CHAIN_ID;
  if (raw == null || String(raw).trim() === '') {
    return { ok: false, code: 'witness_chain_unset' };
  }
  const text = String(raw).trim();
  if (!/^[0-9]+$/.test(text)) return { ok: false, code: 'witness_chain_unset' };
  const chainId = Number(text);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    return { ok: false, code: 'witness_chain_unset' };
  }
  if (chainId === WITNESS_MAINNET_CHAIN_ID && env.RECEIPT_LOG_WITNESS_ALLOW_MAINNET !== '1') {
    return { ok: false, code: 'witness_mainnet_refused' };
  }
  return { ok: true, chainId };
}

export function normalizeReportedChainId(value) {
  if (typeof value === 'bigint') {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : null;
  }
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  try {
    if (/^0x[0-9a-fA-F]+$/.test(text)) {
      const n = Number(BigInt(text));
      return Number.isSafeInteger(n) ? n : null;
    }
    if (/^[0-9]+$/.test(text)) {
      const n = Number(text);
      return Number.isSafeInteger(n) ? n : null;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Boot and every witness broadcast call this. It refuses an unset chain id,
 * refuses mainnet without Christopher's sign-off, then requires eth_chainId
 * on the configured RPC to equal BASE_CHAIN_ID. The returned id is the only
 * chain a witness transaction may be signed for.
 */
export async function assertWitnessChain({
  env = process.env,
  rpcUrl = null,
  request = null,
  readChainId = null,
} = {}) {
  const parsed = parseWitnessChainId(env);
  if (!parsed.ok) {
    const message = parsed.code === 'witness_mainnet_refused'
      ? 'witness refuses Base mainnet (8453) until Christopher signs off. RECEIPT_LOG_WITNESS_ALLOW_MAINNET=1 is that sign-off and nothing else.'
      : 'RECEIPT_LOG_WITNESS=1 requires an explicit BASE_CHAIN_ID. There is no default.';
    throw new ReceiptLogRefused(parsed.code, message);
  }
  let reported;
  try {
    if (typeof readChainId === 'function') {
      reported = await readChainId();
    } else {
      const url = rpcUrl || witnessRpcUrl(env);
      const call = request || (async (rpc, method, params) => {
        if (!rpc) throw new Error('no_rpc');
        const provider = new JsonRpcProvider(rpc);
        return provider.send(method, params);
      });
      reported = await call(url, 'eth_chainId', []);
    }
  } catch (err) {
    if (err instanceof ReceiptLogRefused) throw err;
    throw new ReceiptLogRefused(
      'witness_chain_mismatch',
      err.message || 'eth_chainId failed',
    );
  }
  const got = normalizeReportedChainId(reported);
  if (got !== parsed.chainId) {
    throw new ReceiptLogRefused(
      'witness_chain_mismatch',
      `eth_chainId ${got == null ? 'unreadable' : got} does not match BASE_CHAIN_ID ${parsed.chainId}`,
    );
  }
  return parsed.chainId;
}

export function witnessPrivateKey(env = process.env) {
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

export async function readWitnessCreation({ txHash, rpcUrl = witnessRpcUrl(), request = null } = {}) {
  if (!txHash) return null;
  const call = request || (async (rpc, method, params) => {
    if (!rpc) throw new Error('no_rpc');
    const provider = new JsonRpcProvider(rpc);
    return provider.send(method, params);
  });
  const tx = await call(rpcUrl, 'eth_getTransactionByHash', [txHash]);
  if (!tx) return null;
  const receipt = await call(rpcUrl, 'eth_getTransactionReceipt', [txHash]);
  return { input: tx.input || tx.data || null, hash: tx.hash || txHash, receipt };
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
  readChainId = null,
} = {}) {
  if (!plan || plan.status !== 'ready') return plan;
  await assertWitnessChain({ rpcUrl, request, readChainId });
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

/**
 * Same recovery as the bare-root anchor: eth_getTransactionByHash of the
 * stored keccak, then eth_getTransactionCount when that hash is missing.
 * A missing hash whose nonce is still unused is rebroadcast as the same raw
 * bytes. A nonce that was mined as something else is replaced.
 */
export async function lookupWitnessSubmission({
  txHash = null,
  nonce = null,
  from = null,
  to = null,
  calldata = null,
  rpcUrl = witnessRpcUrl(),
  request = null,
} = {}) {
  const sender = String(from || witnessSignerAddress() || '').toLowerCase();
  const dest = String(to || witnessAddress() || '').toLowerCase();
  if (!sender || !dest) return { blocked: true, pending: true, reason: 'sender_unknown' };
  const url = rpcUrl || '';
  const call = request || (async (rpc, method, params) => {
    if (!rpc) throw new Error('no_rpc');
    const provider = new JsonRpcProvider(rpc);
    return provider.send(method, params);
  });
  const classify = async (tx, hash) => {
    const txFrom = String(tx.from || '').toLowerCase();
    const txTo = String(tx.to || '').toLowerCase();
    const txNonce = tx.nonce == null ? null : Number(tx.nonce);
    const input = String(tx.input || tx.data || '').toLowerCase();
    const wantInput = String(calldata || '').toLowerCase();
    let receipt;
    try {
      receipt = await call(url, 'eth_getTransactionReceipt', [hash]);
    } catch {
      return { blocked: true, pending: true, reason: 'rpc_error', tx: hash };
    }
    if (!receipt) return { pending: true, blocked: true, tx: hash, reason: 'receipt_pending' };
    const ok = receipt.status === '0x1' || receipt.status === 1 || receipt.status === '0x01';
    const fromOk = txFrom === sender;
    const toOk = txTo === dest;
    const nonceOk = nonce == null || txNonce == null || txNonce === Number(nonce);
    const inputOk = !wantInput || input === wantInput;
    if (!ok) return { reverted: true, mined: true, tx: hash, reason: 'reverted' };
    if (fromOk && toOk && nonceOk && inputOk) {
      return { receiptOk: true, tx: hash, nonce: txNonce, from: txFrom, to: txTo };
    }
    return {
      replaced: true,
      mined: true,
      tx: hash,
      reason: !fromOk ? 'from_mismatch' : !toOk ? 'to_mismatch' : !inputOk ? 'calldata_replaced' : 'nonce_mismatch',
    };
  };
  if (txHash) {
    let tx;
    try {
      tx = await call(url, 'eth_getTransactionByHash', [txHash]);
    } catch {
      return { blocked: true, pending: true, reason: 'rpc_error' };
    }
    if (tx) return classify(tx, tx.hash || txHash);
  }
  if (nonce == null || !sender) return { blocked: true, pending: true, reason: 'nonce_unknown', tx: txHash };
  let countRaw;
  try {
    countRaw = await call(url, 'eth_getTransactionCount', [sender, 'latest']);
  } catch {
    return { blocked: true, pending: true, reason: 'rpc_error', tx: txHash };
  }
  const count = Number(countRaw);
  if (!Number.isInteger(count)) return { blocked: true, pending: true, reason: 'rpc_error', tx: txHash };
  if (count <= Number(nonce)) return { missing: true, rebroadcast: true, tx: txHash, nonce: Number(nonce) };
  return { replaced: true, reason: 'nonce_consumed', tx: txHash, nonce: Number(nonce) };
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
