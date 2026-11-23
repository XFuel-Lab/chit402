/**
 * Listen-time v13 runtime. Runs only when a v13 flag is on.
 * Flags off return before the store, the bind dir, KMS, or setV13Runtime.
 *
 * CHIT_V13_STORE_PATH is the durable chit-store directory.
 * CHIT_V13_BIND_DIR is the mode-700 authorization-binding directory.
 * CHIT_V13_ENV_FILE is an optional operator env file. When it is set and a
 * flag is on, the file must exist, be a regular file, and be mode 600 or
 * tighter. It is then loaded without overriding variables that are already
 * set. When it is unset, the file check is skipped.
 *
 * The checkpoint client is the secp256k1 KMS client, not the P-256 issuer
 * signer. GetPublicKey must recover to the live checkpoint pin. The key id
 * is never written to a log or an error. A log may say that it is set.
 */

import { createPublicKey } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { KMSClient } from '@aws-sdk/client-kms';
import { ethereumAddress } from '../../../packages/cs2-core/ecdsa/index.js';
import { broadcastCommittedAnchor, openAnchorIntentLog } from '../../chit-sealer/kms-secp256k1.js';
import { MAINNET_CHECKPOINT, normHex } from '../../chit-sealer/mainnet-pin.js';
import { openStore } from '../../chit-store/store.js';
import { loadDotenvFile } from './dotenv-load.js';
import logger from './logger.js';
import { testSwitchesOn } from './test-switch.js';
import { v13Flags } from './v13-flags.js';
import { setV13Runtime } from './v13-issue.js';

function bootRefused() {
  const err = new Error('v13 boot refused');
  err.code = 'v13_boot_refused';
  return err;
}

function permissionBits(mode) {
  return mode & 0o777;
}

/** Mode 600 or tighter. Node's stats.mode includes the file-type bits. */
function envFileModeOk(mode) {
  return (permissionBits(mode) & ~0o600) === 0;
}

/** Mode 700 or tighter. A loose directory is refused, never chmod'd. */
function dirModeOk(mode) {
  return (permissionBits(mode) & ~0o700) === 0;
}

function noteCheckpoint(env, deps) {
  const present = env?.CHIT_CHECKPOINT_KMS_KEY_ID != null
    && String(env.CHIT_CHECKPOINT_KMS_KEY_ID).trim() !== '';
  const fields = { checkpointKey: present ? 'set' : 'missing' };
  if (typeof deps.log === 'function') deps.log(fields);
  else logger.info({ checkpointKey: fields.checkpointKey }, 'v13 checkpoint key');
}

/**
 * anchor() calls send(rawTx) and wants a tx hash back.
 * broadcastCommittedAnchor(log, { nonce, fees }, send) broadcasts only a
 * signed row that is already on the intent log, then calls its own send.
 * This wrapper is that arity adapter. It does not sign and it does not
 * open a second broadcaster. With no committed signed row it throws.
 */
export function sendThroughCommittedAnchor(log) {
  return async function send(rawTx) {
    const rows = typeof log?.read === 'function' ? log.read() : [];
    const signed = [...rows].reverse().find((row) => row && row.status === 'signed' && row.raw && row.fees);
    if (!signed) {
      const err = new Error('signed anchor is not committed');
      err.code = 'intent_missing';
      throw err;
    }
    const record = await broadcastCommittedAnchor(
      log,
      { nonce: signed.nonce, fees: signed.fees },
      async () => rawTx,
    );
    return record.tx;
  };
}

function runtimeComplete(runtime) {
  if (!runtime || typeof runtime !== 'object') return false;
  if (!runtime.store) return false;
  if (!runtime.dir) return false;
  if (!runtime.client || typeof runtime.client.send !== 'function') return false;
  if (typeof runtime.send !== 'function') return false;
  return true;
}

function readTightDir(dirPath) {
  if (typeof dirPath !== 'string' || dirPath.trim() === '') return null;
  let st;
  try {
    st = fs.statSync(dirPath);
  } catch {
    return null;
  }
  if (!st.isDirectory()) return null;
  if (!dirModeOk(st.mode)) throw bootRefused();
  return dirPath;
}

function loadEnvFile(env) {
  const raw = env?.CHIT_V13_ENV_FILE;
  if (raw == null || String(raw).trim() === '') return;
  const file = String(raw);
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    throw bootRefused();
  }
  if (!st.isFile()) throw bootRefused();
  if (!envFileModeOk(st.mode)) throw bootRefused();
  const loaded = loadDotenvFile(file);
  if (loaded?.error) throw bootRefused();
}

/**
 * The on-disk book row stores a salt, not the book token. The default id is
 * the lexicographically smallest id on the opened store. A caller is returned
 * only when that book was opened with a token already on the store object.
 * The choice is not taken from the request.
 */
function defaultCaller(store) {
  if (!store?.books || typeof store.books.keys !== 'function') return null;
  const ids = [];
  for (const id of store.books.keys()) ids.push(String(id));
  ids.sort();
  if (ids.length === 0) return null;
  const id = ids[0];
  const token = typeof store.bookToken === 'function' ? store.bookToken(id) : null;
  if (typeof token !== 'string' || token === '') return null;
  return { bookId: id, token };
}

function pointFromGetPublicKey(out) {
  if (out?.KeySpec !== 'ECC_SECG_P256K1') throw bootRefused();
  if (out?.KeyUsage !== 'SIGN_VERIFY') throw bootRefused();
  let jwk;
  try {
    const key = createPublicKey({ key: Buffer.from(out.PublicKey || []), format: 'der', type: 'spki' });
    jwk = key.export({ format: 'jwk' });
  } catch {
    throw bootRefused();
  }
  if (jwk.kty !== 'EC' || jwk.crv !== 'secp256k1' || !jwk.x || !jwk.y) throw bootRefused();
  const x = Buffer.from(jwk.x, 'base64url');
  const y = Buffer.from(jwk.y, 'base64url');
  if (x.length !== 32 || y.length !== 32) throw bootRefused();
  return Buffer.concat([Buffer.from([0x04]), x, y]);
}

function seenAddress(point, env, deps) {
  const real = normHex(ethereumAddress(point));
  if (deps?.testInjection === true && testSwitchesOn(process.env) && typeof deps.addressOf === 'function') {
    return normHex(deps.addressOf(point));
  }
  return real;
}

async function assertCheckpointPin(client, env, deps) {
  const keyId = String(env?.CHIT_CHECKPOINT_KMS_KEY_ID || '').trim();
  if (!keyId || !client || typeof client.send !== 'function') throw bootRefused();
  let timeoutMs = 3000;
  const timeoutRaw = env?.CHIT_CHECKPOINT_KMS_TIMEOUT_MS;
  if (timeoutRaw != null && String(timeoutRaw).trim() !== '') {
    const n = Number(timeoutRaw);
    if (Number.isFinite(n) && n > 0) timeoutMs = Math.floor(n);
  }
  let out;
  try {
    out = await client.send({
      name: 'GetPublicKey',
      input: { KeyId: keyId },
    }, { abortSignal: AbortSignal.timeout(timeoutMs) });
  } catch {
    noteCheckpoint(env, deps);
    throw bootRefused();
  }
  let recovered;
  try {
    recovered = seenAddress(pointFromGetPublicKey(out), env, deps);
  } catch (err) {
    noteCheckpoint(env, deps);
    if (err?.code === 'v13_boot_refused') throw err;
    throw bootRefused();
  }
  if (normHex(recovered) !== normHex(MAINNET_CHECKPOINT)) {
    noteCheckpoint(env, deps);
    throw bootRefused();
  }
  noteCheckpoint(env, deps);
}

function checkpointClient(env, deps) {
  if (deps?.client !== undefined) return deps.client;
  const region = String(env?.CHIT_CHECKPOINT_KMS_REGION || '').trim();
  if (!region) return null;
  return new KMSClient({ region });
}

function openDurableStore(dir, deps) {
  const state = path.join(dir, 'store-state.json');
  let st;
  try {
    st = fs.statSync(state);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  const open = typeof deps.openStore === 'function' ? deps.openStore : openStore;
  return open(dir);
}

async function guardListen(env, deps) {
  loadEnvFile(env);
  const storeDir = readTightDir(env?.CHIT_V13_STORE_PATH);
  const bindDir = readTightDir(env?.CHIT_V13_BIND_DIR);
  let store = null;
  if (storeDir) {
    try {
      store = openDurableStore(storeDir, deps);
    } catch {
      throw bootRefused();
    }
  }
  const client = checkpointClient(env, deps);
  let send = null;
  if (bindDir) {
    try {
      send = sendThroughCommittedAnchor(openAnchorIntentLog(bindDir));
    } catch {
      send = null;
    }
  }
  const runtime = {
    store,
    dir: bindDir,
    client,
    send,
    caller: defaultCaller(store),
  };
  if (!runtimeComplete(runtime)) throw bootRefused();
  await assertCheckpointPin(client, env, deps);
  setV13Runtime({
    store: runtime.store,
    dir: runtime.dir,
    client: runtime.client,
    send: runtime.send,
    caller: runtime.caller,
  });
  return { ok: true, wired: true };
}

/**
 * The production boot function startServer calls after assertV13Boot and
 * before listen. Any one v13 flag requires a complete runtime. Flags off
 * do not open the store, the bind dir, or KMS.
 * @param {object} [env]
 * @param {object} [deps]
 */
export async function wireV13Runtime(env = process.env, deps = {}) {
  const flags = v13Flags(env || {});
  if (flags.issuance === true) return guardListen(env, deps);
  if (flags.mainnetSealer === true) return guardListen(env, deps);
  if (flags.store === true) return guardListen(env, deps);
  return { ok: true, wired: false };
}
