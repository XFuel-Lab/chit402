/**
 * Hex and integer helpers for the v13 checkpoint signature path.
 * Wire hex is lowercase. A 0x prefix is accepted on input and is not written
 * on raw byte output.
 */

export function hexToBytes(value) {
  const hex = String(value ?? '').replace(/^0x/i, '');
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    const err = new Error('bad hex');
    err.code = 'bad_hex';
    throw err;
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes) {
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

export function bytesToBig(bytes) {
  let value = 0n;
  for (let i = 0; i < bytes.length; i += 1) value = (value << 8n) | BigInt(bytes[i]);
  return value;
}

export function bigToBytes(value, length) {
  let v = BigInt(value);
  if (v < 0n) {
    const err = new Error('negative scalar');
    err.code = 'bad_scalar';
    throw err;
  }
  const out = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i -= 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  if (v !== 0n) {
    const err = new Error('scalar overflow');
    err.code = 'bad_scalar';
    throw err;
  }
  return out;
}

export function concat(parts) {
  let n = 0;
  for (const part of parts) n += part.length;
  const out = new Uint8Array(n);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** 65-byte uncompressed point, or 64-byte X||Y. */
export function uncompressedPoint(publicKey) {
  const bytes = publicKey instanceof Uint8Array ? publicKey : Uint8Array.from(publicKey);
  if (bytes.length === 65 && bytes[0] === 0x04) return bytes;
  if (bytes.length === 64) return concat([Uint8Array.of(0x04), bytes]);
  const err = new Error('public key must be an uncompressed point');
  err.code = 'bad_public_key';
  throw err;
}
