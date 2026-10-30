/**
 * EIP-2718 type-2 (EIP-1559) signing payload.
 * digest = keccak256(0x02 || rlp([chainId, nonce, priority, maxFee, gas,
 *   to, value, data, accessList])).
 * The signed bytes append signature_y_parity, r and s. y-parity is 0 or 1.
 */

import { bytesToBig, bytesToHex, concat, hexToBytes } from './bytes.js';
import { keccak256 } from './keccak.js';
import { rlpBytes, rlpDecode, rlpInt, rlpIntValue, rlpList } from './rlp.js';

function addressBytes(to) {
  const bytes = typeof to === 'string' ? hexToBytes(to) : to;
  if (!bytes || bytes.length !== 20) {
    const err = new Error('eip1559 to must be 20 bytes');
    err.code = 'bad_tx';
    throw err;
  }
  return bytes;
}

function dataBytes(data) {
  if (data == null || data === '0x') return new Uint8Array();
  if (typeof data === 'string') return hexToBytes(data);
  return data instanceof Uint8Array ? data : Uint8Array.from(data);
}

function requireZeroValue(value) {
  const v = value == null ? 0n : BigInt(value);
  if (v !== 0n) {
    const err = new Error('checkpoint tx value must be zero');
    err.code = 'bad_tx';
    throw err;
  }
  return 0n;
}

export function eip1559Body(tx) {
  return [
    rlpInt(tx.chainId),
    rlpInt(tx.nonce),
    rlpInt(tx.maxPriorityFeePerGas),
    rlpInt(tx.maxFeePerGas),
    rlpInt(tx.gasLimit),
    rlpBytes(addressBytes(tx.to)),
    rlpInt(requireZeroValue(tx.value)),
    rlpBytes(dataBytes(tx.data)),
    rlpList([]),
  ];
}

export function eip1559Unsigned(tx) {
  return concat([Uint8Array.of(0x02), rlpList(eip1559Body(tx))]);
}

export function eip1559Digest(tx) {
  return keccak256(eip1559Unsigned(tx));
}

/**
 * @param {object} tx
 * @param {{ yParity: 0|1, r: Uint8Array, s: Uint8Array }} sig
 * @returns {Uint8Array} 0x02 || rlp(...)
 */
export function eip1559Serialize(tx, sig) {
  if (sig.yParity !== 0 && sig.yParity !== 1) {
    const err = new Error('y parity must be 0 or 1');
    err.code = 'bad_tx';
    throw err;
  }
  if (sig.r?.length !== 32 || sig.s?.length !== 32) {
    const err = new Error('r and s must be 32 bytes');
    err.code = 'bad_tx';
    throw err;
  }
  const fields = eip1559Body(tx);
  fields.push(rlpInt(sig.yParity));
  fields.push(rlpInt(bytesToBig(sig.r)));
  fields.push(rlpInt(bytesToBig(sig.s)));
  return concat([Uint8Array.of(0x02), rlpList(fields)]);
}

export function eip1559Decode(raw) {
  const bytes = typeof raw === 'string' ? hexToBytes(raw) : raw;
  if (!bytes || bytes[0] !== 0x02) {
    const err = new Error('not an eip1559 transaction');
    err.code = 'bad_tx';
    throw err;
  }
  const list = rlpDecode(bytes.subarray(1));
  if (!Array.isArray(list) || (list.length !== 9 && list.length !== 12)) {
    const err = new Error('eip1559 field count');
    err.code = 'bad_tx';
    throw err;
  }
  return {
    chainId: rlpIntValue(list[0]),
    nonce: rlpIntValue(list[1]),
    maxPriorityFeePerGas: rlpIntValue(list[2]),
    maxFeePerGas: rlpIntValue(list[3]),
    gasLimit: rlpIntValue(list[4]),
    to: bytesToHex(list[5]),
    value: rlpIntValue(list[6]),
    data: bytesToHex(list[7]),
    yParity: list.length === 12 ? Number(rlpIntValue(list[9])) : null,
    r: list.length === 12 ? bytesToHex(list[10]).padStart(64, '0') : null,
    s: list.length === 12 ? bytesToHex(list[11]).padStart(64, '0') : null,
  };
}

export function eip1559TxHash(raw) {
  const bytes = typeof raw === 'string' ? hexToBytes(raw) : raw;
  return keccak256(bytes);
}
