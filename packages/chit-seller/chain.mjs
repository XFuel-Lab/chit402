/**
 * Payment read by block hash (DS-114).
 *
 * The payment block is loaded with eth_getBlockByHash. It counts only when
 * that same hash is the canonical block at its number and the number is at
 * or below the finalized head. A number-only finality check is not used.
 * A zero block hash is rejected before any read.
 *
 * The Transfer is the receipt log at localLogIndex. The nonce is the
 * AuthorizationUsed event in the same receipt. Logs are not returned.
 */

import { keccak256 } from '../cs2-core/ecdsa/keccak.js';
import { bytesToHex } from '../cs2-core/ecdsa/bytes.js';
import { canonicalPaymentId } from '../cs2-core/line/index.mjs';
import { fromCodec, refuse } from './reasons.mjs';
import {
  addressHex,
  isZeroHex,
  normalizeHex,
  parseQuantity,
  parseUint,
  sameHex,
} from './hex.mjs';

const text = new TextEncoder();

function topicOf(signature) {
  return bytesToHex(keccak256(text.encode(signature)));
}

const TRANSFER_TOPIC = topicOf('Transfer(address,address,uint256)');
const AUTH_USED_TOPIC = topicOf('AuthorizationUsed(address,bytes32)');

async function readCall(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch {
    return refuse('chain_unread');
  }
}

function shapeBlock(block) {
  if (!block || typeof block !== 'object') return null;
  const number = parseQuantity(block.number);
  const hash = normalizeHex(block.hash, 32);
  if (number == null || !hash) return null;
  const transactions = [];
  if (Array.isArray(block.transactions)) {
    for (const tx of block.transactions) {
      if (typeof tx === 'string') transactions.push(normalizeHex(tx, 32));
      else if (tx && typeof tx === 'object') transactions.push(normalizeHex(tx.hash, 32));
      else transactions.push(null);
    }
  }
  const timestamp = block.timestamp == null ? 0n : parseQuantity(block.timestamp);
  return { number, hash, timestamp, transactions };
}

function shapeLog(log) {
  if (!log || typeof log !== 'object') return null;
  const address = addressHex(log.address);
  if (!address) return null;
  const topics = [];
  if (Array.isArray(log.topics)) {
    for (const topic of log.topics) {
      const hex = normalizeHex(topic, 32);
      if (!hex) return null;
      topics.push(hex);
    }
  }
  let data = null;
  if (typeof log.data === 'string') {
    const body = log.data === '0x' || log.data === '0X' ? '' : (
      (log.data.startsWith('0x') || log.data.startsWith('0X')) ? log.data.slice(2) : log.data
    );
    if (body.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(body)) return null;
    data = body.toLowerCase();
  } else if (log.data instanceof Uint8Array) {
    data = bytesToHex(log.data);
  }
  return { address, topics, data };
}

function shapeReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object') return null;
  const blockHash = normalizeHex(receipt.blockHash, 32);
  const txHash = normalizeHex(receipt.transactionHash || receipt.txHash, 32);
  const txIndex = parseQuantity(receipt.transactionIndex);
  if (!blockHash || !txHash || txIndex == null || !Array.isArray(receipt.logs)) return null;
  const logs = [];
  for (const log of receipt.logs) {
    const shaped = shapeLog(log);
    if (!shaped) return null;
    logs.push(shaped);
  }
  let status = 0;
  if (receipt.status === 1 || receipt.status === '0x1' || receipt.status === '0x01') status = 1;
  return { status, blockHash, txHash, txIndex, logs };
}

function topicAddress(topic) {
  if (typeof topic !== 'string' || topic.length !== 64) return null;
  if (!/^0{24}[0-9a-f]{40}$/.test(topic)) return null;
  return topic.slice(24);
}

function transferAt(log) {
  if (!log || log.topics[0] !== TRANSFER_TOPIC || log.topics.length < 3) return null;
  const from = topicAddress(log.topics[1]);
  const to = topicAddress(log.topics[2]);
  if (!from || !to || !log.data || log.data.length !== 64) return null;
  let price;
  try { price = BigInt(`0x${log.data}`); } catch { return null; }
  return { payer: from, payee: to, price, token: log.address };
}

function authUsedAt(log) {
  if (!log || log.topics[0] !== AUTH_USED_TOPIC || log.topics.length < 3) return null;
  const authorizer = topicAddress(log.topics[1]);
  const nonce = log.topics[2];
  if (!authorizer || !nonce || nonce.length !== 64) return null;
  return { authorizer, nonce };
}

/**
 * @param {object} reader getChainId, getBlockByHash, getBlockByNumber, getReceipt
 * @param {object} payment chainId, blockHash, txIndex, localLogIndex, txHash
 */
export async function readCanonicalPayment(reader, payment) {
  if (!reader || typeof reader.getBlockByHash !== 'function'
    || typeof reader.getBlockByNumber !== 'function'
    || typeof reader.getReceipt !== 'function'
    || typeof reader.getChainId !== 'function') {
    return refuse('chain_unread');
  }
  const blockHash = normalizeHex(payment.blockHash, 32);
  if (!blockHash) return refuse('missing_block_hash');
  const id = canonicalPaymentId({
    chainId: payment.chainId,
    blockHash,
    txIndex: payment.txIndex,
    localLogIndex: payment.localLogIndex,
  });
  if (!id.ok) return fromCodec(id);

  const chainId = parseUint(payment.chainId, 64);
  const txIndex = parseUint(payment.txIndex, 32);
  const localLogIndex = parseUint(payment.localLogIndex, 16);
  const txHash = normalizeHex(payment.txHash, 32);
  if (chainId == null || txIndex == null || localLogIndex == null || !txHash) return refuse('bad_payment');
  if (!Number.isSafeInteger(Number(txIndex)) || !Number.isSafeInteger(Number(localLogIndex))) {
    return refuse('bad_payment');
  }

  const gotChain = await readCall(() => reader.getChainId());
  if (!gotChain.ok) return gotChain;
  const reportedChain = parseQuantity(gotChain.value);
  if (reportedChain == null) return refuse('chain_unread');
  if (reportedChain !== chainId) return refuse('chain_mismatch');

  const gotBlock = await readCall(() => reader.getBlockByHash(blockHash));
  if (!gotBlock.ok) return gotBlock;
  const block = shapeBlock(gotBlock.value);
  if (!block || !sameHex(block.hash, blockHash)) return refuse('unknown_block');

  const gotHead = await readCall(() => reader.getBlockByNumber('finalized'));
  if (!gotHead.ok) return gotHead;
  const head = shapeBlock(gotHead.value);
  if (!head) return refuse('not_finalized');
  if (block.number > head.number) return refuse('not_finalized');

  const gotCanonical = await readCall(() => reader.getBlockByNumber(block.number));
  if (!gotCanonical.ok) return gotCanonical;
  const canonical = shapeBlock(gotCanonical.value);
  if (!canonical || !sameHex(canonical.hash, blockHash)) return refuse('reorged');

  const atIndex = block.transactions[Number(txIndex)] || null;
  if (!atIndex || !sameHex(atIndex, txHash)) return refuse('tx_mismatch');

  const gotReceipt = await readCall(() => reader.getReceipt(txHash));
  if (!gotReceipt.ok) return gotReceipt;
  const receipt = shapeReceipt(gotReceipt.value);
  if (!receipt) return refuse('chain_unread');
  if (receipt.status !== 1) return refuse('bad_payment');
  if (!sameHex(receipt.blockHash, blockHash)) return refuse('tx_mismatch');
  if (!sameHex(receipt.txHash, txHash)) return refuse('tx_mismatch');
  if (receipt.txIndex !== txIndex) return refuse('tx_mismatch');

  const log = receipt.logs[Number(localLogIndex)];
  const transfer = transferAt(log);
  if (!transfer) return refuse('bad_payment');

  // Keep every AuthorizationUsed. A settle can carry two calls, and the
  // nonce select below has to find the one this authorization named.
  const auths = [];
  for (const entry of receipt.logs) {
    const auth = authUsedAt(entry);
    if (auth) auths.push(auth);
  }
  return {
    ok: true,
    chainId,
    blockHash,
    blockNumber: block.number,
    blockTime: block.timestamp == null ? 0n : block.timestamp,
    txIndex: Number(txIndex),
    localLogIndex: Number(localLogIndex),
    txHash,
    token: transfer.token,
    payer: transfer.payer,
    payee: transfer.payee,
    price: transfer.price,
    auths,
    paymentId: id.hex,
  };
}

export async function selectNonce(observed, nonceHex) {
  if (!observed || !observed.ok) return observed;
  const want = normalizeHex(nonceHex, 32);
  if (!want || isZeroHex(want)) return refuse('nonce_mismatch');
  let hit = null;
  for (const auth of observed.auths) {
    if (sameHex(auth.nonce, want)) {
      hit = auth;
      break;
    }
  }
  if (!hit) return refuse('nonce_mismatch');
  return {
    ok: true,
    chainId: observed.chainId,
    blockHash: observed.blockHash,
    blockNumber: observed.blockNumber,
    blockTime: observed.blockTime,
    txIndex: observed.txIndex,
    localLogIndex: observed.localLogIndex,
    txHash: observed.txHash,
    token: observed.token,
    payer: observed.payer,
    payee: observed.payee,
    price: observed.price,
    nonce: hit.nonce,
    authorizer: hit.authorizer,
    paymentId: observed.paymentId,
  };
}

export function createRpcReader(rpcUrl, { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  if (typeof rpcUrl !== 'string' || rpcUrl.length === 0 || typeof fetchImpl !== 'function') return null;
  async function rpc(method, params) {
    const res = await fetchImpl(rpcUrl, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const err = new Error('chain_unread');
      throw err;
    }
    const data = await res.json();
    if (!data || data.error || !Object.prototype.hasOwnProperty.call(data, 'result')) {
      const err = new Error('chain_unread');
      throw err;
    }
    return data.result;
  }
  return {
    getChainId() {
      return rpc('eth_chainId', []);
    },
    getBlockByHash(hash) {
      const hex = normalizeHex(hash, 32);
      if (!hex) return Promise.reject(new Error('chain_unread'));
      return rpc('eth_getBlockByHash', [`0x${hex}`, false]);
    },
    getBlockByNumber(tag) {
      let param = tag;
      if (typeof tag === 'bigint' || typeof tag === 'number') param = `0x${BigInt(tag).toString(16)}`;
      if (param !== 'finalized' && (typeof param !== 'string' || !/^0x[0-9a-fA-F]+$/.test(param))) {
        return Promise.reject(new Error('chain_unread'));
      }
      return rpc('eth_getBlockByNumber', [param, false]);
    },
    getReceipt(txHash) {
      const hex = normalizeHex(txHash, 32);
      if (!hex) return Promise.reject(new Error('chain_unread'));
      return rpc('eth_getTransactionReceipt', [`0x${hex}`]);
    },
  };
}
