/**
 * Ethereum RLP. Integers have no leading zeros. A 20-byte address is a
 * string, not an integer, so leading zeros stay.
 */

import { bytesToBig, concat } from './bytes.js';

function encodeLen(len) {
  const bytes = [];
  let n = len;
  while (n > 0) {
    bytes.push(n & 0xff);
    n = Math.floor(n / 256);
  }
  bytes.reverse();
  return Uint8Array.from(bytes);
}

function prefix(shortBase, payload) {
  if (payload.length <= 55) {
    const out = new Uint8Array(1 + payload.length);
    out[0] = shortBase + payload.length;
    out.set(payload, 1);
    return out;
  }
  const lenBytes = encodeLen(payload.length);
  const out = new Uint8Array(1 + lenBytes.length + payload.length);
  out[0] = shortBase + 55 + lenBytes.length;
  out.set(lenBytes, 1);
  out.set(payload, 1 + lenBytes.length);
  return out;
}

export function rlpBytes(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  if (b.length === 1 && b[0] < 0x80) return b;
  return prefix(0x80, b);
}

export function rlpList(encodedItems) {
  return prefix(0xc0, concat(encodedItems));
}

export function rlpInt(value) {
  let v = BigInt(value);
  if (v < 0n) {
    const err = new Error('rlp negative');
    err.code = 'rlp_negative';
    throw err;
  }
  if (v === 0n) return Uint8Array.of(0x80);
  const bytes = [];
  while (v > 0n) {
    bytes.push(Number(v & 0xffn));
    v >>= 8n;
  }
  bytes.reverse();
  return rlpBytes(Uint8Array.from(bytes));
}

function readLen(buf, offset, count) {
  if (count === 0 || offset + count > buf.length) {
    const err = new Error('rlp short');
    err.code = 'rlp_invalid';
    throw err;
  }
  if (buf[offset] === 0x00) {
    const err = new Error('rlp non-minimal length');
    err.code = 'rlp_invalid';
    throw err;
  }
  let len = 0;
  for (let i = 0; i < count; i += 1) len = len * 256 + buf[offset + i];
  return { len, next: offset + count };
}

function readItem(buf, offset) {
  if (offset >= buf.length) {
    const err = new Error('rlp short');
    err.code = 'rlp_invalid';
    throw err;
  }
  const prefixByte = buf[offset];
  if (prefixByte < 0x80) return { value: buf.subarray(offset, offset + 1), next: offset + 1 };
  if (prefixByte <= 0xb7) {
    const len = prefixByte - 0x80;
    const start = offset + 1;
    if (start + len > buf.length) throw Object.assign(new Error('rlp short'), { code: 'rlp_invalid' });
    if (len === 1 && buf[start] < 0x80) throw Object.assign(new Error('rlp non-minimal'), { code: 'rlp_invalid' });
    return { value: buf.subarray(start, start + len), next: start + len };
  }
  if (prefixByte <= 0xbf) {
    const { len, next } = readLen(buf, offset + 1, prefixByte - 0xb7);
    if (len < 56 || next + len > buf.length) throw Object.assign(new Error('rlp bad string'), { code: 'rlp_invalid' });
    return { value: buf.subarray(next, next + len), next: next + len };
  }
  if (prefixByte <= 0xf7) {
    const len = prefixByte - 0xc0;
    return readList(buf, offset + 1, offset + 1 + len);
  }
  const { len, next } = readLen(buf, offset + 1, prefixByte - 0xf7);
  if (len < 56) throw Object.assign(new Error('rlp non-minimal list'), { code: 'rlp_invalid' });
  return readList(buf, next, next + len);
}

function readList(buf, start, end) {
  if (end > buf.length) throw Object.assign(new Error('rlp short list'), { code: 'rlp_invalid' });
  const items = [];
  let offset = start;
  while (offset < end) {
    const item = readItem(buf, offset);
    if (item.next > end) throw Object.assign(new Error('rlp overrun'), { code: 'rlp_invalid' });
    items.push(item.value);
    offset = item.next;
  }
  return { value: items, next: end };
}

export function rlpDecode(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  const item = readItem(buf, 0);
  if (item.next !== buf.length) {
    const err = new Error('rlp trailing');
    err.code = 'rlp_invalid';
    throw err;
  }
  return item.value;
}

export function rlpIntValue(bytes) {
  if (bytes.length === 0) return 0n;
  return bytesToBig(bytes);
}
