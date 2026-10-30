/**
 * RFC 9180 HPKE, one suite only:
 * DHKEM(X25519, HKDF-SHA256) / HKDF-SHA256 / ChaCha20-Poly1305.
 * kem_id 0x0020, kdf_id 0x0001, aead_id 0x0003.
 *
 * The line seal uses base mode. PSK, Auth, and AuthPSK exist so the
 * RFC 9180 appendix A.2 vectors can run. No Node-only crypto.
 *
 * Failure is { ok: false, reason } and carries no key, plaintext, or length.
 */

import { aeadOpen, aeadSeal } from './vendor/chacha20poly1305.js';
import { hkdfExpand, hkdfExtract } from './vendor/hkdf.js';
import { x25519, x25519Public } from './vendor/x25519.js';

export const KEM_ID = 0x0020;
export const KDF_ID = 0x0001;
export const AEAD_ID = 0x0003;
export const NSECRET = 32;
export const NK = 32;
export const NN = 12;
export const NH = 32;
export const MODE_BASE = 0x00;
export const MODE_PSK = 0x01;
export const MODE_AUTH = 0x02;
export const MODE_AUTH_PSK = 0x03;

const HPKE_V1 = ascii('HPKE-v1');
const SUITE_KEM = concat([ascii('KEM'), u16(KEM_ID)]);
const SUITE_HPKE = concat([ascii('HPKE'), u16(KEM_ID), u16(KDF_ID), u16(AEAD_ID)]);

function ascii(text) {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i);
  return out;
}

function u16(n) {
  return Uint8Array.of((n >>> 8) & 0xff, n & 0xff);
}

function concat(parts) {
  let len = 0;
  for (const part of parts) len += part.length;
  const out = new Uint8Array(len);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function isZero(bytes) {
  let acc = 0;
  for (let i = 0; i < bytes.length; i += 1) acc |= bytes[i];
  return acc === 0;
}

function fail(reason) {
  return { ok: false, reason };
}

function labeledExtract(suite, salt, label, ikm) {
  return hkdfExtract(salt, concat([HPKE_V1, suite, ascii(label), ikm]));
}

function labeledExpand(suite, prk, label, info, length) {
  const labeled = concat([u16(length), HPKE_V1, suite, ascii(label), info]);
  return hkdfExpand(prk, labeled, length);
}

function dh(sk, pk) {
  const out = x25519(sk, pk);
  if (!out || isZero(out)) return null;
  return out;
}

function extractAndExpand(sharedDh, kemContext) {
  const eae = labeledExtract(SUITE_KEM, new Uint8Array(0), 'eae_prk', sharedDh);
  const secret = labeledExpand(SUITE_KEM, eae, 'shared_secret', kemContext, NSECRET);
  eae.fill(0);
  return secret;
}

/**
 * DeriveKeyPair (RFC 9180 §7.1.3). The returned scalar is the KDF output.
 * X25519 clamps it when it is used. Matches the published test vectors.
 * @param {Uint8Array} ikm
 */
export function deriveKeyPair(ikm) {
  if (!(ikm instanceof Uint8Array) || ikm.length === 0) return fail('bad_key');
  const prk = labeledExtract(SUITE_KEM, new Uint8Array(0), 'dkp_prk', ikm);
  const sk = labeledExpand(SUITE_KEM, prk, 'sk', new Uint8Array(0), 32);
  prk.fill(0);
  if (!sk) return fail('bad_key');
  const pk = x25519Public(sk);
  if (!pk) return fail('bad_key');
  return { ok: true, sk, pk };
}

function encapWith(pkR, skE, skS) {
  if (!(pkR instanceof Uint8Array) || pkR.length !== 32) return fail('bad_key');
  if (!(skE instanceof Uint8Array) || skE.length !== 32) return fail('bad_key');
  const pkE = x25519Public(skE);
  if (!pkE) return fail('bad_key');
  const dhER = dh(skE, pkR);
  if (!dhER) {
    pkE.fill(0);
    return fail('bad_key');
  }
  let kemContext;
  let sharedDh;
  if (skS) {
    if (!(skS instanceof Uint8Array) || skS.length !== 32) return fail('bad_key');
    const pkS = x25519Public(skS);
    const dhSR = dh(skS, pkR);
    if (!pkS || !dhSR) return fail('bad_key');
    sharedDh = concat([dhER, dhSR]);
    kemContext = concat([pkE, pkR, pkS]);
    dhSR.fill(0);
  } else {
    sharedDh = dhER;
    kemContext = concat([pkE, pkR]);
  }
  const shared = extractAndExpand(sharedDh, kemContext);
  sharedDh.fill(0);
  if (!shared) return fail('open_failed');
  return { ok: true, shared, enc: pkE };
}

function decapWith(enc, skR, pkS) {
  if (!(enc instanceof Uint8Array) || enc.length !== 32) return fail('bad_key');
  if (!(skR instanceof Uint8Array) || skR.length !== 32) return fail('bad_key');
  const pkR = x25519Public(skR);
  const dhRE = dh(skR, enc);
  if (!pkR || !dhRE) return fail('open_failed');
  let sharedDh;
  let kemContext;
  if (pkS) {
    if (!(pkS instanceof Uint8Array) || pkS.length !== 32) return fail('bad_key');
    const dhRS = dh(skR, pkS);
    if (!dhRS) return fail('open_failed');
    sharedDh = concat([dhRE, dhRS]);
    kemContext = concat([enc, pkR, pkS]);
    dhRS.fill(0);
  } else {
    sharedDh = dhRE;
    kemContext = concat([enc, pkR]);
  }
  const shared = extractAndExpand(sharedDh, kemContext);
  sharedDh.fill(0);
  if (!shared) return fail('open_failed');
  return { ok: true, shared };
}

/**
 * @param {number} mode
 * @param {Uint8Array} sharedSecret
 * @param {Uint8Array} info
 * @param {Uint8Array} psk
 * @param {Uint8Array} pskId
 */
export function keySchedule(mode, sharedSecret, info, psk, pskId) {
  const gotPsk = psk.length !== 0;
  const gotId = pskId.length !== 0;
  if (gotPsk !== gotId) return fail('bad_key');
  if (gotPsk && (mode === MODE_BASE || mode === MODE_AUTH)) return fail('bad_key');
  if (!gotPsk && (mode === MODE_PSK || mode === MODE_AUTH_PSK)) return fail('bad_key');
  const pskIdHash = labeledExtract(SUITE_HPKE, new Uint8Array(0), 'psk_id_hash', pskId);
  const infoHash = labeledExtract(SUITE_HPKE, new Uint8Array(0), 'info_hash', info);
  const keyScheduleContext = concat([Uint8Array.of(mode), pskIdHash, infoHash]);
  const secret = labeledExtract(SUITE_HPKE, sharedSecret, 'secret', psk);
  const key = labeledExpand(SUITE_HPKE, secret, 'key', keyScheduleContext, NK);
  const baseNonce = labeledExpand(SUITE_HPKE, secret, 'base_nonce', keyScheduleContext, NN);
  const exporterSecret = labeledExpand(SUITE_HPKE, secret, 'exp', keyScheduleContext, NH);
  if (!key || !baseNonce || !exporterSecret) return fail('open_failed');
  return {
    ok: true,
    keyScheduleContext,
    secret,
    key,
    baseNonce,
    exporterSecret,
  };
}

function scheduleRole(mode, shared, info, psk, pskId) {
  const sharedSecret = shared.slice();
  const sched = keySchedule(mode, shared, info, psk, pskId);
  shared.fill(0);
  if (!sched.ok) {
    sharedSecret.fill(0);
    return sched;
  }
  return { ok: true, ...sched, sharedSecret, seq: 0 };
}

function wipeSchedule(ctx) {
  if (!ctx) return;
  for (const name of ['key', 'baseNonce', 'exporterSecret', 'secret', 'sharedSecret']) {
    if (ctx[name]) ctx[name].fill(0);
  }
}

/**
 * @param {{ mode?: number, pkR: Uint8Array, skE: Uint8Array, skS?: Uint8Array, info?: Uint8Array, psk?: Uint8Array, pskId?: Uint8Array }} input
 */
export function setupS(input) {
  const mode = input.mode ?? MODE_BASE;
  const info = input.info ?? new Uint8Array(0);
  const psk = input.psk ?? new Uint8Array(0);
  const pskId = input.pskId ?? new Uint8Array(0);
  const auth = mode === MODE_AUTH || mode === MODE_AUTH_PSK;
  const encap = encapWith(input.pkR, input.skE, auth ? input.skS : undefined);
  if (!encap.ok) return encap;
  const role = scheduleRole(mode, encap.shared, info, psk, pskId);
  if (!role.ok) return role;
  return { ...role, enc: encap.enc };
}

/**
 * @param {{ mode?: number, enc: Uint8Array, skR: Uint8Array, pkS?: Uint8Array, info?: Uint8Array, psk?: Uint8Array, pskId?: Uint8Array }} input
 */
export function setupR(input) {
  const mode = input.mode ?? MODE_BASE;
  const info = input.info ?? new Uint8Array(0);
  const psk = input.psk ?? new Uint8Array(0);
  const pskId = input.pskId ?? new Uint8Array(0);
  const auth = mode === MODE_AUTH || mode === MODE_AUTH_PSK;
  const decap = decapWith(input.enc, input.skR, auth ? input.pkS : undefined);
  if (!decap.ok) return decap;
  return scheduleRole(mode, decap.shared, info, psk, pskId);
}

/** Nonce = base_nonce XOR I2OSP(seq, Nn). */
export function computeNonce(baseNonce, seq) {
  if (!Number.isSafeInteger(seq) || seq < 0) return null;
  const out = baseNonce.slice();
  let n = seq;
  for (let i = out.length - 1; i >= 0; i -= 1) {
    const x = (out[i] ^ (n & 0xff)) & 0xff;
    out[i] = x;
    n = Math.floor(n / 256);
  }
  if (n !== 0) return null;
  return out;
}

export function contextSeal(ctx, seq, aad, pt) {
  const nonce = computeNonce(ctx.baseNonce, seq);
  if (!nonce) return fail('open_failed');
  const ct = aeadSeal(ctx.key, nonce, aad, pt);
  nonce.fill(0);
  if (!ct) return fail('open_failed');
  return { ok: true, ct };
}

export function contextOpen(ctx, seq, aad, ct) {
  const nonce = computeNonce(ctx.baseNonce, seq);
  if (!nonce) return fail('open_failed');
  const pt = aeadOpen(ctx.key, nonce, aad, ct);
  nonce.fill(0);
  if (!pt) return fail('open_failed');
  return { ok: true, pt };
}

/** Export (RFC 9180 §5.3). L is the output length. */
export function contextExport(ctx, exporterContext, length) {
  const out = labeledExpand(SUITE_HPKE, ctx.exporterSecret, 'sec', exporterContext, length);
  if (!out) return fail('open_failed');
  return { ok: true, bytes: out };
}

/**
 * One-shot base-mode seal. esk is the ephemeral scalar.
 * @returns {{ ok: true, enc: Uint8Array, ct: Uint8Array } | { ok: false, reason: string }}
 */
export function sealBase(pkR, info, aad, pt, esk) {
  const setup = setupS({ pkR, skE: esk, info, mode: MODE_BASE });
  if (!setup.ok) return setup;
  const sealed = contextSeal(setup, 0, aad, pt);
  wipeSchedule(setup);
  if (!sealed.ok) return sealed;
  return { ok: true, enc: setup.enc, ct: sealed.ct };
}

/** One-shot base-mode open. */
export function openBase(enc, skR, info, aad, ct) {
  const setup = setupR({ enc, skR, info, mode: MODE_BASE });
  if (!setup.ok) return setup;
  const opened = contextOpen(setup, 0, aad, ct);
  wipeSchedule(setup);
  if (!opened.ok) return opened;
  return { ok: true, pt: opened.pt };
}
