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
 * When the client is not injected, credentials come from
 * CHIT_CHECKPOINT_AWS_CREDENTIALS_FILE and CHIT_CHECKPOINT_AWS_PROFILE.
 * The file is mode 600 or tighter. The access key is not logged.
 * The credential path is opened with O_NOFOLLOW and checked again with
 * fstat before fromIni sees it. The client pins defaultsMode and maxAttempts.
 *
 * CHIT_V13_HOUSE_TOKEN_FILE is the path of the house book file. It is read
 * only when a v13 flag is on. The token stays in memory for openStore.
 */

import { createPublicKey } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { inspect } from 'node:util';
import { KMSClient } from '@aws-sdk/client-kms';
import { fromIni } from '@aws-sdk/credential-providers';
import { ethereumAddress } from '../../../packages/cs2-core/ecdsa/index.js';
import { boundCheckpointAttempt, broadcastCommittedAnchor, checkpointKmsTimeoutMs, openAnchorIntentLog } from '../../chit-sealer/kms-secp256k1.js';
import { MAINNET_CHECKPOINT, normHex } from '../../chit-sealer/mainnet-pin.js';
import { openStore } from '../../chit-store/store.js';
import { loadDotenvFile } from './dotenv-load.js';
import logger from './logger.js';
import { testSwitchesOn } from './test-switch.js';
import { v13Flags } from './v13-flags.js';
import { sendCheckpointKms } from './checkpoint-kms.js';
import { setV13Runtime } from './v13-issue.js';

const HOUSE_REASONS = new Set([
  'token_file_missing',
  'token_file_not_regular',
  'token_file_owner',
  'token_file_mode',
  'token_file_dir',
  'token_file_parse',
  'token_file_size',
  'house_book_id',
  'house_token',
  'house_book_pk',
  'store_book',
]);

const CRED_REASONS = new Set([
  'checkpoint_creds_missing',
  'checkpoint_creds_not_regular',
  'checkpoint_creds_owner',
  'checkpoint_creds_mode',
  'checkpoint_creds_dir',
]);

function bootRefused(reason) {
  const err = new Error('v13 boot refused');
  err.code = 'v13_boot_refused';
  if (HOUSE_REASONS.has(reason) || CRED_REASONS.has(reason)) err.reason = reason;
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
  if (!runtime.caller || typeof runtime.caller.bookId !== 'string' || runtime.caller.bookId === '') return false;
  if (typeof runtime.caller.token !== 'string' || runtime.caller.token === '') return false;
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

function sealedCaller(bookId, token) {
  const caller = {
    bookId,
    token,
    toJSON() {
      return { bookId: this.bookId };
    },
  };
  Object.defineProperty(caller, inspect.custom, {
    enumerable: false,
    value() {
      return { bookId: this.bookId };
    },
  });
  return caller;
}

function sealRuntime(runtime) {
  const sealed = {
    store: runtime.store,
    dir: runtime.dir,
    client: runtime.client,
    send: runtime.send,
    caller: runtime.caller,
    toJSON() {
      return { dir: this.dir, caller: this.caller };
    },
  };
  Object.defineProperty(sealed, inspect.custom, {
    enumerable: false,
    value() {
      const caller = this.caller;
      return {
        dir: this.dir,
        caller: caller && typeof caller.bookId === 'string' ? { bookId: caller.bookId } : null,
      };
    },
  });
  return sealed;
}

function callerForBook(store, id) {
  if (!store || typeof id !== 'string' || id === '') return null;
  const token = typeof store.bookToken === 'function' ? store.bookToken(id) : null;
  if (typeof token !== 'string' || token === '') return null;
  return sealedCaller(id, token);
}

/**
 * The house book id is CHIT_V13_HOUSE_BOOK_ID. The token is the one already
 * on that book in the opened store. A missing id, an unknown id, or a book
 * with no in-memory token is not a caller. Nothing here reads the request.
 */
function canonicalHouseId(env) {
  const raw = typeof env?.CHIT_V13_HOUSE_BOOK_ID === 'string' ? env.CHIT_V13_HOUSE_BOOK_ID : '';
  return normalizeBookId(raw);
}

function requirePresentHouseBookId(env) {
  const raw = env?.CHIT_V13_HOUSE_BOOK_ID;
  if (typeof raw !== 'string' || raw.trim() === '') throw bootRefused('house_book_id');
}

function houseCaller(store, env) {
  const id = canonicalHouseId(env);
  if (!id) return null;
  return callerForBook(store, id);
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
  const timeoutMs = checkpointKmsTimeoutMs(env);
  let out;
  try {
    out = await boundCheckpointAttempt(timeoutMs, () => sendCheckpointKms(client, {
      name: 'GetPublicKey',
      input: { KeyId: keyId },
    }, { abortSignal: AbortSignal.timeout(timeoutMs) }));
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

function checkpointCredsIo(deps) {
  if (deps && deps.fs && typeof deps.fs.lstatSync === 'function') return deps.fs;
  return fs;
}

function checkpointProfile(env) {
  const raw = env?.CHIT_CHECKPOINT_AWS_PROFILE;
  if (typeof raw !== 'string' || raw.trim() === '') return '';
  return raw.trim();
}

function checkpointCredsFile(env) {
  const raw = env?.CHIT_CHECKPOINT_AWS_CREDENTIALS_FILE;
  if (typeof raw !== 'string' || raw.trim() === '') return '';
  return raw;
}

function assertCheckpointCreds(io, file) {
  let listed;
  try {
    listed = io.lstatSync(file);
  } catch (err) {
    if (err && err.code === 'ENOENT') throw bootRefused('checkpoint_creds_missing');
    throw bootRefused('checkpoint_creds_not_regular');
  }
  if (typeof listed.isSymbolicLink === 'function' && listed.isSymbolicLink()) {
    throw bootRefused('checkpoint_creds_not_regular');
  }
  if (typeof listed.isFile !== 'function' || listed.isFile() !== true) {
    throw bootRefused('checkpoint_creds_not_regular');
  }
  const parent = path.dirname(file);
  let dirSt;
  try {
    dirSt = io.lstatSync(parent);
  } catch {
    throw bootRefused('checkpoint_creds_dir');
  }
  if (typeof dirSt.isSymbolicLink === 'function' && dirSt.isSymbolicLink()) {
    throw bootRefused('checkpoint_creds_dir');
  }
  if (typeof dirSt.isDirectory !== 'function' || dirSt.isDirectory() !== true) {
    throw bootRefused('checkpoint_creds_dir');
  }
  if (dirSt.uid !== process.getuid()) throw bootRefused('checkpoint_creds_dir');
  if (!dirModeOk(dirSt.mode)) throw bootRefused('checkpoint_creds_dir');
  if (!envFileModeOk(listed.mode)) throw bootRefused('checkpoint_creds_mode');
  if (listed.uid !== process.getuid()) throw bootRefused('checkpoint_creds_owner');
  let fd;
  const nofollow = fs.constants.O_NOFOLLOW;
  if (
    typeof nofollow !== 'number'
    || typeof io.openSync !== 'function'
    || typeof io.fstatSync !== 'function'
    || typeof io.closeSync !== 'function'
  ) {
    throw bootRefused('checkpoint_creds_not_regular');
  }
  try {
    fd = io.openSync(file, fs.constants.O_RDONLY | nofollow);
  } catch {
    throw bootRefused('checkpoint_creds_not_regular');
  }
  try {
    const st = io.fstatSync(fd);
    if (typeof st.isSymbolicLink === 'function' && st.isSymbolicLink()) throw bootRefused('checkpoint_creds_not_regular');
    if (typeof st.isFile !== 'function' || st.isFile() !== true) throw bootRefused('checkpoint_creds_not_regular');
    if (st.dev !== listed.dev || st.ino !== listed.ino) throw bootRefused('checkpoint_creds_not_regular');
    if (!envFileModeOk(st.mode)) throw bootRefused('checkpoint_creds_mode');
    if (st.uid !== process.getuid()) throw bootRefused('checkpoint_creds_owner');
    const again = io.lstatSync(file);
    if (typeof again.isSymbolicLink === 'function' && again.isSymbolicLink()) throw bootRefused('checkpoint_creds_not_regular');
    if (typeof again.isFile !== 'function' || again.isFile() !== true) throw bootRefused('checkpoint_creds_not_regular');
    if (again.dev !== st.dev || again.ino !== st.ino) throw bootRefused('checkpoint_creds_not_regular');
    if (!envFileModeOk(again.mode)) throw bootRefused('checkpoint_creds_mode');
  } finally {
    try { io.closeSync(fd); } catch { /* the refusal is already set */ }
  }
}

function checkpointCredentials(env, deps) {
  const profile = checkpointProfile(env);
  const file = checkpointCredsFile(env);
  if (!profile || !file) throw bootRefused('checkpoint_creds_missing');
  assertCheckpointCreds(checkpointCredsIo(deps), file);
  return fromIni({ profile, filepath: file });
}

function checkpointClient(env, deps) {
  if (deps?.client !== undefined) return deps.client;
  const region = String(env?.CHIT_CHECKPOINT_KMS_REGION || '').trim();
  if (!region) return null;
  const credentials = checkpointCredentials(env, deps);
  const config = { region, credentials };
  config.defaultsMode = 'standard';
  config.maxAttempts = 2;
  if (deps && deps.requestHandler) config.requestHandler = deps.requestHandler;
  return new KMSClient(config);
}

function houseIo(deps) {
  if (deps && deps.fs && typeof deps.fs.lstatSync === 'function') return deps.fs;
  return fs;
}

function houseTokenPath(env) {
  const raw = env?.CHIT_V13_HOUSE_TOKEN_FILE;
  if (typeof raw !== 'string' || raw.trim() === '') throw bootRefused('token_file_missing');
  return raw;
}

function assertHouseDir(io, file) {
  const parent = path.dirname(file);
  let st;
  try {
    st = io.lstatSync(parent);
  } catch {
    throw bootRefused('token_file_dir');
  }
  if (typeof st.isSymbolicLink === 'function' && st.isSymbolicLink()) throw bootRefused('token_file_dir');
  if (typeof st.isDirectory !== 'function' || st.isDirectory() !== true) throw bootRefused('token_file_dir');
  if (st.uid !== process.getuid()) throw bootRefused('token_file_dir');
  if (!dirModeOk(st.mode)) throw bootRefused('token_file_dir');
}

function openHouseFile(io, file) {
  let listed;
  try {
    listed = io.lstatSync(file);
  } catch (err) {
    if (err && err.code === 'ENOENT') throw bootRefused('token_file_missing');
    throw bootRefused('token_file_not_regular');
  }
  if (typeof listed.isSymbolicLink === 'function' && listed.isSymbolicLink()) throw bootRefused('token_file_not_regular');
  if (typeof listed.isFile !== 'function' || listed.isFile() !== true) throw bootRefused('token_file_not_regular');
  const nofollow = fs.constants.O_NOFOLLOW;
  if (typeof nofollow !== 'number') throw bootRefused('token_file_not_regular');
  try {
    return io.openSync(file, fs.constants.O_RDONLY | nofollow);
  } catch {
    throw bootRefused('token_file_not_regular');
  }
}

function readHouseFd(io, fd, size) {
  const buf = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const n = io.readSync(fd, buf, offset, size - offset, offset);
    if (!Number.isInteger(n) || n <= 0) break;
    offset += n;
  }
  if (offset !== size) throw bootRefused('token_file_parse');
  return buf.toString('utf8');
}

function normalizeBookId(value) {
  if (typeof value !== 'string') return null;
  let hex = value.trim();
  if (hex.startsWith('0x') || hex.startsWith('0X')) hex = hex.slice(2);
  hex = hex.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  return hex;
}

function houseTokenOk(token) {
  if (typeof token !== 'string') return false;
  if (token.length < 16 || token.length > 256) return false;
  if (token.trim() === '') return false;
  if (token !== token.trim()) return false;
  return true;
}

function housePkOk(value) {
  return typeof value === 'string' && /^(0x)?[0-9a-fA-F]{64}$/.test(value);
}

function copyHouseWallets(value) {
  if (!Array.isArray(value)) return null;
  const out = [];
  for (let i = 0; i < value.length; i += 1) {
    const item = value[i];
    if (typeof item !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(item)) return null;
    out.push(item);
  }
  return out;
}

function houseFileTooBig(size) {
  if (!Number.isSafeInteger(size) || size < 0 || size > 8192) throw bootRefused('token_file_size');
}

function rejectHouseShape(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw bootRefused('token_file_parse');
  const keys = Object.keys(parsed);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (key !== 'v' && key !== 'bookId' && key !== 'token' && key !== 'bookPk' && key !== 'wallets') {
      throw bootRefused('token_file_parse');
    }
  }
  if (parsed.v !== 1) throw bootRefused('token_file_parse');
}

function assertHouseFileMode(listed, st) {
  if (!envFileModeOk(listed.mode)) throw bootRefused('token_file_mode');
  if (!envFileModeOk(st.mode)) throw bootRefused('token_file_mode');
}

function parseHouseBook(text, env) {
  if (typeof text !== 'string' || text.length === 0 || text.charCodeAt(0) === 0xfeff) throw bootRefused('token_file_parse');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw bootRefused('token_file_parse');
  }
  rejectHouseShape(parsed);
  const fileNorm = normalizeBookId(parsed.bookId);
  const envId = canonicalHouseId(env);
  if (!fileNorm) throw bootRefused('house_book_id');
  if (!envId || envId !== fileNorm) throw bootRefused('house_book_id');
  if (!houseTokenOk(parsed.token)) throw bootRefused('house_token');
  if (!housePkOk(parsed.bookPk)) throw bootRefused('house_book_pk');
  const book = {
    id: envId,
    token: parsed.token,
    bookPk: parsed.bookPk,
  };
  if (Object.prototype.hasOwnProperty.call(parsed, 'wallets')) {
    const wallets = copyHouseWallets(parsed.wallets);
    if (!wallets) throw bootRefused('token_file_parse');
    book.wallets = wallets;
  }
  return book;
}

function readHouseBook(env, deps) {
  const io = houseIo(deps);
  const file = houseTokenPath(env);
  assertHouseDir(io, file);
  const fd = openHouseFile(io, file);
  try {
    const st = io.fstatSync(fd);
    const listed = io.lstatSync(file);
    if (typeof st.isSymbolicLink === 'function' && st.isSymbolicLink()) throw bootRefused('token_file_not_regular');
    if (typeof st.isFile !== 'function' || st.isFile() !== true) throw bootRefused('token_file_not_regular');
    if (typeof listed.isSymbolicLink === 'function' && listed.isSymbolicLink()) throw bootRefused('token_file_not_regular');
    if (typeof listed.isFile !== 'function' || listed.isFile() !== true) throw bootRefused('token_file_not_regular');
    houseFileTooBig(st.size);
    assertHouseFileMode(listed, st);
    if (st.uid !== process.getuid()) throw bootRefused('token_file_owner');
    return parseHouseBook(readHouseFd(io, fd, st.size), env);
  } finally {
    try { io.closeSync(fd); } catch { /* the refusal is already set */ }
  }
}

function saltHexOk(value) {
  return typeof value === 'string' && /^(0x)?[0-9a-fA-F]{64}$/.test(value);
}

function assertStoredHouseSalt(dir, bookId) {
  const state = path.join(dir, 'store-state.json');
  let text;
  try {
    text = fs.readFileSync(state, 'utf8');
  } catch {
    throw bootRefused('store_book');
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw bootRefused('store_book');
  }
  const books = parsed && parsed.books && typeof parsed.books === 'object' && !Array.isArray(parsed.books)
    ? parsed.books
    : null;
  const row = books && books[bookId] && typeof books[bookId] === 'object' ? books[bookId] : null;
  if (!row || !saltHexOk(row.bookSalt)) throw bootRefused('store_book');
}

function openDurableStore(dir, env, deps) {
  const state = path.join(dir, 'store-state.json');
  let st;
  try {
    st = fs.statSync(state);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  requirePresentHouseBookId(env);
  const house = readHouseBook(env, deps);
  assertStoredHouseSalt(dir, house.id);
  const open = typeof deps.openStore === 'function' ? deps.openStore : openStore;
  const book = { id: house.id, token: house.token, bookPk: house.bookPk };
  if (Array.isArray(house.wallets)) book.wallets = house.wallets;
  return open(dir, { books: [book] });
}

async function guardListen(env, deps) {
  loadEnvFile(env);
  const storeDir = readTightDir(env?.CHIT_V13_STORE_PATH);
  const bindDir = readTightDir(env?.CHIT_V13_BIND_DIR);
  let store = null;
  if (storeDir) {
    try {
      store = openDurableStore(storeDir, env, deps);
    } catch (err) {
      if (err?.code === 'v13_boot_refused') throw err;
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
    caller: houseCaller(store, env),
  };
  if (!runtimeComplete(runtime)) throw bootRefused();
  await assertCheckpointPin(client, env, deps);
  setV13Runtime(sealRuntime(runtime));
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
