/**
 * ChaCha20-Poly1305 as AEAD_CHACHA20_POLY1305 (RFC 8439).
 * Vendored for the browser. Hash-pinned in ./PINS.json.
 * No Node-only crypto. Q-H1 keeps this AEAD; do not switch it.
 *
 * The 96-bit nonce is three little-endian words. Poly1305's one-time
 * key is the first 32 bytes of the ChaCha20 block at counter 0.
 * Encryption starts at counter 1. A failed open returns null and does
 * not return plaintext.
 */

function rotl(v, n) {
  return ((v << n) | (v >>> (32 - n))) >>> 0;
}

function quarter(s, a, b, c, d) {
  s[a] = (s[a] + s[b]) >>> 0;
  s[d] = rotl(s[d] ^ s[a], 16);
  s[c] = (s[c] + s[d]) >>> 0;
  s[b] = rotl(s[b] ^ s[c], 12);
  s[a] = (s[a] + s[b]) >>> 0;
  s[d] = rotl(s[d] ^ s[a], 8);
  s[c] = (s[c] + s[d]) >>> 0;
  s[b] = rotl(s[b] ^ s[c], 7);
}

function load32(b, o) {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

function store32(b, o, w) {
  b[o] = w;
  b[o + 1] = w >>> 8;
  b[o + 2] = w >>> 16;
  b[o + 3] = w >>> 24;
}

/** 64-byte ChaCha20 block. Counter is the 32-bit block counter. */
export function chacha20Block(key, counter, nonce) {
  const s = new Uint32Array(16);
  s[0] = 0x61707865;
  s[1] = 0x3320646e;
  s[2] = 0x79622d32;
  s[3] = 0x6b206574;
  s[4] = load32(key, 0);
  s[5] = load32(key, 4);
  s[6] = load32(key, 8);
  s[7] = load32(key, 12);
  s[8] = load32(key, 16);
  s[9] = load32(key, 20);
  s[10] = load32(key, 24);
  s[11] = load32(key, 28);
  s[12] = counter >>> 0;
  s[13] = load32(nonce, 0);
  s[14] = load32(nonce, 4);
  s[15] = load32(nonce, 8);
  const w = s.slice();
  for (let i = 0; i < 10; i += 1) {
    quarter(w, 0, 4, 8, 12);
    quarter(w, 1, 5, 9, 13);
    quarter(w, 2, 6, 10, 14);
    quarter(w, 3, 7, 11, 15);
    quarter(w, 0, 5, 10, 15);
    quarter(w, 1, 6, 11, 12);
    quarter(w, 2, 7, 8, 13);
    quarter(w, 3, 4, 9, 14);
  }
  for (let i = 0; i < 16; i += 1) w[i] = (w[i] + s[i]) >>> 0;
  const out = new Uint8Array(64);
  for (let i = 0; i < 16; i += 1) store32(out, i * 4, w[i]);
  return out;
}

function leToBig(bytes) {
  let x = 0n;
  for (let i = 0; i < bytes.length; i += 1) x |= BigInt(bytes[i]) << BigInt(8 * i);
  return x;
}

function bigToLe(x, n) {
  const out = new Uint8Array(n);
  let v = x;
  for (let i = 0; i < n; i += 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** Poly1305 (RFC 8439 §2.5). Tag is the low 128 bits of acc + s. */
export function poly1305(key, msg) {
  const r = leToBig(key.subarray(0, 16)) & 0x0ffffffc0ffffffc0ffffffc0fffffffn;
  const s = leToBig(key.subarray(16, 32));
  const p = (1n << 130n) - 5n;
  let acc = 0n;
  for (let i = 0; i < msg.length; i += 16) {
    const block = msg.subarray(i, Math.min(i + 16, msg.length));
    const n = leToBig(block) + (1n << BigInt(8 * block.length));
    acc = ((acc + n) * r) % p;
  }
  return bigToLe(acc + s, 16);
}

function macData(aad, ct) {
  const aadPad = (16 - (aad.length % 16)) % 16;
  const ctPad = (16 - (ct.length % 16)) % 16;
  const out = new Uint8Array(aad.length + aadPad + ct.length + ctPad + 16);
  out.set(aad, 0);
  out.set(ct, aad.length + aadPad);
  const lenAt = aad.length + aadPad + ct.length + ctPad;
  const view = new DataView(out.buffer);
  const aadLen = aad.length;
  const ctLen = ct.length;
  view.setUint32(lenAt, aadLen >>> 0, true);
  view.setUint32(lenAt + 4, Math.floor(aadLen / 0x100000000), true);
  view.setUint32(lenAt + 8, ctLen >>> 0, true);
  view.setUint32(lenAt + 12, Math.floor(ctLen / 0x100000000), true);
  return out;
}

function tagsEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

function oneTimeKey(key, nonce) {
  const block = chacha20Block(key, 0, nonce);
  const otk = block.slice(0, 32);
  block.fill(0);
  return otk;
}

function xorStream(key, nonce, data) {
  const out = new Uint8Array(data.length);
  let off = 0;
  let counter = 1;
  while (off < data.length) {
    const ks = chacha20Block(key, counter, nonce);
    const n = Math.min(64, data.length - off);
    for (let i = 0; i < n; i += 1) out[off + i] = data[off + i] ^ ks[i];
    ks.fill(0);
    off += n;
    counter = (counter + 1) >>> 0;
  }
  return out;
}

/**
 * @param {Uint8Array} key 32 bytes
 * @param {Uint8Array} nonce 12 bytes
 * @param {Uint8Array} aad
 * @param {Uint8Array} pt
 * @returns {Uint8Array | null} ciphertext || 16-byte tag
 */
export function aeadSeal(key, nonce, aad, pt) {
  if (!(key instanceof Uint8Array) || key.length !== 32) return null;
  if (!(nonce instanceof Uint8Array) || nonce.length !== 12) return null;
  if (!(aad instanceof Uint8Array) || !(pt instanceof Uint8Array)) return null;
  const otk = oneTimeKey(key, nonce);
  const ct = xorStream(key, nonce, pt);
  const tag = poly1305(otk, macData(aad, ct));
  otk.fill(0);
  const out = new Uint8Array(ct.length + 16);
  out.set(ct, 0);
  out.set(tag, ct.length);
  return out;
}

/**
 * Verify the tag before producing plaintext. Failure returns null.
 * @returns {Uint8Array | null}
 */
export function aeadOpen(key, nonce, aad, sealed) {
  if (!(key instanceof Uint8Array) || key.length !== 32) return null;
  if (!(nonce instanceof Uint8Array) || nonce.length !== 12) return null;
  if (!(aad instanceof Uint8Array) || !(sealed instanceof Uint8Array)) return null;
  if (sealed.length < 16) return null;
  const ct = sealed.subarray(0, sealed.length - 16);
  const tag = sealed.subarray(sealed.length - 16);
  const otk = oneTimeKey(key, nonce);
  const expect = poly1305(otk, macData(aad, ct));
  otk.fill(0);
  if (!tagsEqual(expect, tag)) return null;
  return xorStream(key, nonce, ct);
}
