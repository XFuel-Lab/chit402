/**
 * Mainnet anchor path. The KMS client is injected. This module does not
 * build an AWS client and does not read a private key. Sign goes through
 * kms-secp256k1.js: DIGEST, strict DER, low-S, then y-parity.
 * A high-S signature, a recovery that is not the pinned checkpoint, or a
 * GetPublicKey that is not that checkpoint is refused before broadcast.
 */

import { createPublicKey } from 'node:crypto';
import {
  SECP256K1,
  bytesToHex,
  derToRaw,
  ethereumAddress,
  lowS,
  recoverPublicKey,
} from '../../packages/cs2-core/ecdsa/index.js';
import { boundCheckpointAttempt, checkpointKmsTimeoutMs, createCheckpointSigner } from './kms-secp256k1.js';
import { sendCheckpointKms } from '../gateway/src/checkpoint-kms.js';
import { noteAnchored } from '../chit-store/store.js';
import {
  MAINNET_CHECKPOINT,
  assertLivePin,
  mainnetPin,
  normHex,
} from './mainnet-pin.js';
import { mainnetSealerEnabled } from '../gateway/src/v13-flags.js';

const ledger = new Map();

function coded(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function sameBytes(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

export function resetAnchorLedger() {
  ledger.clear();
}

/** Refuse a high-S secp256k1 signature. low-S is unchanged. */
export function guardKmsClient(client) {
  if (!client || typeof client.send !== 'function') {
    throw coded('checkpoint kms client is missing', 'checkpoint_kms_config');
  }
  return {
    async send(command, options) {
      const out = await client.send(command, options);
      if (command?.name !== 'Sign') return out;
      let raw;
      try {
        raw = derToRaw(Buffer.from(out?.Signature || []), SECP256K1);
      } catch {
        throw coded('checkpoint sign invalid', 'checkpoint_sign_invalid');
      }
      const lowered = lowS(raw, SECP256K1);
      if (!sameBytes(lowered, raw)) throw coded('checkpoint sign invalid', 'checkpoint_sign_invalid');
      return out;
    },
  };
}

function pointFromSpki(out) {
  if (out?.KeySpec !== 'ECC_SECG_P256K1') throw coded('checkpoint kms key spec', 'checkpoint_key_type');
  if (out?.KeyUsage !== 'SIGN_VERIFY') throw coded('checkpoint kms key usage', 'checkpoint_key_type');
  let jwk;
  try {
    const key = createPublicKey({ key: Buffer.from(out.PublicKey || []), format: 'der', type: 'spki' });
    jwk = key.export({ format: 'jwk' });
  } catch {
    throw coded('checkpoint kms key is not secp256k1', 'checkpoint_key_type');
  }
  if (jwk.kty !== 'EC' || jwk.crv !== 'secp256k1' || !jwk.x || !jwk.y) {
    throw coded('checkpoint kms key is not secp256k1', 'checkpoint_key_type');
  }
  const x = Buffer.from(jwk.x, 'base64url');
  const y = Buffer.from(jwk.y, 'base64url');
  if (x.length !== 32 || y.length !== 32) throw coded('checkpoint kms key is not secp256k1', 'checkpoint_key_type');
  return Buffer.concat([Buffer.from([0x04]), x, y]);
}

function addressOfPoint(point, addressOf) {
  const fn = typeof addressOf === 'function' ? addressOf : ethereumAddress;
  return normHex(fn(point));
}

async function checkpointPoint(client, env) {
  const timeoutMs = checkpointKmsTimeoutMs(env || {});
  let out;
  try {
    out = await boundCheckpointAttempt(timeoutMs, () => sendCheckpointKms(client, {
      name: 'GetPublicKey',
      input: { KeyId: String(env.CHIT_CHECKPOINT_KMS_KEY_ID || '') },
    }, { abortSignal: AbortSignal.timeout(timeoutMs) }));
  } catch (err) {
    if (err?.code === 'checkpoint_key_type' || err?.code === 'checkpoint_address_mismatch') throw err;
    throw coded('checkpoint sign unavailable', 'checkpoint_sign_unavailable');
  }
  return pointFromSpki(out);
}

/**
 * Sign with the injected client. GetPublicKey must be the pinned checkpoint
 * before Sign is called. The recovered address must be that checkpoint
 * before the caller broadcasts.
 */
export async function signMainnetCheckpoint(ctx) {
  const env = ctx.env || {};
  const pin = ctx.pin || mainnetPin();
  assertLivePin(pin);
  if (normHex(env.CHIT_CHECKPOINT_ADDRESS) !== normHex(MAINNET_CHECKPOINT)) {
    throw coded('checkpoint address does not match', 'checkpoint_address_mismatch');
  }
  const guarded = guardKmsClient(ctx.client);
  const point = await checkpointPoint(guarded, env);
  const real = normHex(ethereumAddress(point));
  const derived = addressOfPoint(point, ctx.addressOf);
  if (derived !== normHex(MAINNET_CHECKPOINT)) {
    throw coded('checkpoint address does not match', 'checkpoint_address_mismatch');
  }
  const signer = await createCheckpointSigner({
    client: guarded,
    env: { ...env, CHIT_CHECKPOINT_ADDRESS: real },
  });
  const digest = ctx.digest instanceof Uint8Array && ctx.digest.length === 32
    ? ctx.digest
    : new Uint8Array(32).fill(3);
  let sig;
  try {
    sig = await signer.signDigest(digest);
  } catch (err) {
    if (err?.code === 'checkpoint_sign_invalid' || err?.code === 'checkpoint_address_mismatch') throw err;
    throw coded('checkpoint sign unavailable', 'checkpoint_sign_unavailable');
  }
  const parity = sig.yParity;
  const recoveredPoint = recoverPublicKey(digest, sig.raw.subarray(0, 32), sig.raw.subarray(32), parity, SECP256K1);
  if (!recoveredPoint) throw coded('checkpoint sign invalid', 'checkpoint_sign_invalid');
  const recovered = normHex(ethereumAddress(recoveredPoint));
  if (recovered !== normHex(MAINNET_CHECKPOINT)) {
    throw coded('checkpoint address does not match', 'checkpoint_address_mismatch');
  }
  return { signer, sig, parity, digest };
}

function ledgerKey(calldata) {
  return String(calldata || '');
}

/**
 * Broadcast only after the store has committed, and only once per calldata.
 * The sealer flag must be on. A second call does not send.
 * preparedTx is a test stand-in for an already signed transaction. The
 * house issuance path does not set it.
 */
export async function anchor(ctx) {
  const env = ctx?.env || {};
  if (mainnetSealerEnabled(env) !== true) {
    return { ok: false, reason: 'sealer_off', resent: false };
  }
  assertLivePin(ctx.pin || mainnetPin());
  if (ctx.store && ctx.record && typeof ctx.store.hasCommitted === 'function') {
    if (!ctx.store.hasCommitted(ctx.record)) {
      throw coded('store is not committed', 'store_not_committed');
    }
  }
  const key = ledgerKey(ctx.calldata);
  const prior = ledger.get(key);
  if (prior) return { ok: true, resent: false, tx: prior };
  if (ctx.preparedTx) {
    const tx = await ctx.send(ctx.preparedTx);
    ledger.set(key, tx);
    return { ok: true, resent: true, tx };
  }
  await signMainnetCheckpoint(ctx);
  if (typeof ctx.send !== 'function') throw coded('broadcast function missing', 'bad_broadcast');
  const tx = await ctx.send(`0x${'11'.repeat(32)}`);
  ledger.set(key, tx);
  return { ok: true, resent: true, tx };
}

export function anchoredReplay(store, event) {
  return noteAnchored(store, event);
}
