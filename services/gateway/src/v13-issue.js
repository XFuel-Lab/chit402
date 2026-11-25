/**
 * House receipt issuance. Flags off calls buildReceipt and returns those
 * bytes. Flags on admit a final EIP-3009 payment once and book the leaf.
 * closeHour mints the epoch. The contract pin is the mainnet constant.
 * A request body cannot replace it.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { LAYOUT, encodeLine } from '../../../packages/cs2-core/line/index.mjs';
import { authorizationKey } from '../../../packages/cs2-core/line/index.mjs';
import { SAMPLE } from '../../../packages/cs2-core/line/sample.mjs';
import { MAINNET_USDC, assertLivePin, mainnetPin, normHex } from '../../chit-sealer/mainnet-pin.js';
import {
  bookLeaf,
  openIntake,
  pendingIdFor,
  readOwnedPending,
  writeRefund,
} from '../../chit-store/intake.js';
import { fetchReceipt } from '../../chit-store/store.js';
import { decisionHoldResult } from './x402-flags.js';
import { buildReceipt } from './receipt.js';
import {
  assertV13Boot,
  issuanceEnabled,
  mainnetSealerEnabled,
  storeEnabled,
} from './v13-flags.js';
import { sendCheckpointKms } from './checkpoint-kms.js';
import { boundCheckpointAttempt, checkpointKmsTimeoutMs } from '../../chit-sealer/kms-secp256k1.js';

const tails = new Map();
const pendings = new Map();
let houseRuntime = null;

/** Server-side v13 deps. Not read from a request body. */
export function setV13Runtime(next) {
  houseRuntime = next && typeof next === 'object' ? next : null;
}

export function readV13Runtime() {
  return houseRuntime;
}

function note(input, code) {
  const sink = input && input.log;
  if (typeof sink === 'function') sink({ code });
  else if (Array.isArray(sink)) sink.push({ code });
}

export function resetHouseState() {
  tails.clear();
  pendings.clear();
}

export function paymentIsFinal(blockNumber, finalizedNumber) {
  if (typeof blockNumber !== 'number' || typeof finalizedNumber !== 'number') return false;
  if (!Number.isSafeInteger(blockNumber) || !Number.isSafeInteger(finalizedNumber)) return false;
  if (blockNumber < 0 || finalizedNumber < 0) return false;
  return blockNumber <= finalizedNumber;
}

export function houseAuthorizationKey(payment) {
  if (!payment || typeof payment !== 'object') return { ok: false, reason: 'bad_type' };
  return authorizationKey({
    chainId: payment.chainId,
    token: payment.token,
    authorizer: payment.authorizer,
    nonce: payment.nonce,
  });
}

function closed(status, code) {
  const body = { error: code, code };
  return { status, body, bytes: Buffer.from(JSON.stringify(body)) };
}

function notFound() {
  const body = { error: 'not_found' };
  return { status: 404, body, bytes: Buffer.from(JSON.stringify(body)) };
}

function verifyRoot(baseUrl) {
  return baseUrl ? String(baseUrl).replace(/\/$/, '') : 'http://127.0.0.1';
}

function holdResponse(kind, keyHex, baseUrl) {
  const pendingId = pendingIdFor(keyHex);
  const verifyUrl = `${verifyRoot(baseUrl)}/verify/${pendingId}`;
  const terminal = kind === 'refund_owed';
  const held = decisionHoldResult({
    code: terminal ? 'settle_failed' : 'settle_pending',
    holdClass: terminal ? 'terminal' : 'resolvable',
    pendingId,
    verifyUrl,
  });
  const body = {
    error: kind,
    code: kind,
    state: kind,
    pending_id: pendingId,
    verify_url: verifyUrl,
  };
  if (terminal) body.status = 'refund_owed';
  return {
    status: held.status,
    retryAfter: terminal ? null : (held.retryAfter ?? null),
    paid: true,
    body,
    bytes: Buffer.from(JSON.stringify(body)),
  };
}

function intakeDirOf(input) {
  if (input?.store && typeof input.store.dir === 'string' && input.store.dir !== '') return input.store.dir;
  return input?.dir || '';
}

function intakeIo(input) {
  return input?.intakeIo || fs;
}

function tokenHash(token) {
  return createHash('sha256').update(String(token)).digest();
}

function bindingFile(dir) {
  return path.join(dir, 'auth-bindings.json');
}

function readRows(dir) {
  const file = bindingFile(dir);
  if (!fs.existsSync(file)) return {};
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (!parsed || parsed.v !== 1 || !parsed.rows || typeof parsed.rows !== 'object') return null;
  return parsed.rows;
}

function writeRows(dir, rows) {
  fs.mkdirSync(dir, { recursive: true });
  const file = bindingFile(dir);
  const tmp = `${file}.tmp`;
  const text = JSON.stringify({ v: 1, rows });
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeFileSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

function bindAuthorization(dir, keyHex, row) {
  const rows = readRows(dir);
  if (rows == null) {
    const err = new Error('bindings unreadable');
    err.code = 'store_not_committed';
    throw err;
  }
  if (rows[keyHex]) return rows[keyHex];
  rows[keyHex] = row;
  writeRows(dir, rows);
  return row;
}

function rowById(dir, receiptId) {
  const rows = readRows(dir);
  if (!rows) return null;
  const keys = Object.keys(rows);
  for (let i = 0; i < keys.length; i += 1) {
    if (rows[keys[i]].receiptId === receiptId) return rows[keys[i]];
  }
  return null;
}

function callerMatches(row, caller) {
  if (!row || !caller || typeof caller.bookId !== 'string' || typeof caller.token !== 'string') return false;
  if (row.bookId !== caller.bookId) return false;
  const got = tokenHash(caller.token);
  const want = Buffer.from(row.tokenHash, 'hex');
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}

async function withLock(key, fn) {
  const prev = tails.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const tail = prev.then(() => gate, () => gate);
  tails.set(key, tail);
  await prev.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (tails.get(key) === tail) tails.delete(key);
  }
}

function coreLine(payment) {
  const encoded = encodeLine({
    payment,
    content: { ...SAMPLE.content, sellerKeyId: '00'.repeat(32) },
    sigma: { alg: 1, sigma: `${'00'.repeat(31)}01${'00'.repeat(31)}01` },
  });
  if (!encoded.ok) {
    const err = new Error('bad line');
    err.code = 'bad_line';
    throw err;
  }
  const line = new Uint8Array(encoded.line);
  // A core line has a zero sigma. This sealer does not attach a seller signature.
  line.fill(0, LAYOUT.sigma, LAYOUT.sigma + LAYOUT.sigmaBytes);
  return line;
}

function legacyResponse(task, receiptOpts) {
  return buildReceipt(task, receiptOpts || {});
}

async function armSealer(input) {
  if (input.client && typeof input.client.send === 'function') {
    const timeoutMs = checkpointKmsTimeoutMs(input.env || {});
    try {
      await boundCheckpointAttempt(timeoutMs, () => sendCheckpointKms(input.client, {
        name: 'GetPublicKey',
        input: { KeyId: String(input.env?.CHIT_CHECKPOINT_KMS_KEY_ID || '') },
      }, { abortSignal: AbortSignal.timeout(timeoutMs) }));
    } catch (err) {
      if (err?.code === 'checkpoint_sign_unavailable') throw err;
      const refused = new Error('checkpoint sign unavailable');
      refused.code = 'checkpoint_sign_unavailable';
      throw refused;
    }
    return;
  }
  if (typeof input.onSealer === 'function') await input.onSealer();
}

/**
 * @param {object} input
 */
async function armIfSealer(env, input) {
  if (mainnetSealerEnabled(env) === true) await armSealer(input);
}

export async function issueHouseReceipt(input) {
  const env = input.env || {};
  if (issuanceEnabled(env) !== true) {
    if (mainnetSealerEnabled(env) === true || storeEnabled(env) === true) {
      assertV13Boot(env, input.pin || mainnetPin());
    }
    await armIfSealer(env, input);
    const body = await legacyResponse(input.task, input.receiptOpts);
    return { status: 200, body, bytes: Buffer.from(JSON.stringify(body)) };
  }
  assertV13Boot(env, input.pin || mainnetPin());
  return issueV13(input);
}

function bindHold(dir, keyHex, caller, held) {
  bindAuthorization(dir, keyHex, {
    receiptId: held.body.pending_id,
    bookId: caller.bookId,
    tokenHash: tokenHash(caller.token).toString('hex'),
    receipt: held.body,
    bytes: held.bytes.toString('utf8'),
    pendingId: held.body.pending_id,
    state: held.body.state,
  });
}

function refundOwed(input, keyHex) {
  const held = holdResponse('refund_owed', keyHex, input.baseUrl);
  try {
    const intake = openIntake(intakeDirOf(input), { io: intakeIo(input) });
    writeRefund(intake, {
      paymentRef: keyHex,
      caller: input.caller,
      hourStart: input.observation?.hourStart,
    });
  } catch {
    note(input, 'refund_owed');
  }
  try {
    if (input.dir && input.caller) bindHold(input.dir, keyHex, input.caller, held);
  } catch {
    note(input, 'refund_owed');
  }
  note(input, 'refund_owed');
  return held;
}

async function issueV13(input) {
  const pin = input.pin || mainnetPin();
  assertLivePin(pin);
  if (input.bodyPin || input.requestPin) {
    return closed(400, 'verify_failed');
  }
  let paid = false;
  try {
    const observation = input.observation;
    if (!observation || typeof observation !== 'object') return closed(402, 'settle_unconfirmed');
    if (typeof input.rpc === 'function' && observation.finalizedNumber == null) {
      await input.rpc();
    }
    const final = paymentIsFinal(observation.blockNumber, observation.finalizedNumber);
    if (!final) return closed(402, 'settle_unconfirmed');
    const payment = input.payment;
    const key = houseAuthorizationKey(payment);
    if (!key.ok) return closed(400, 'verify_failed');
    if (Number(payment.chainId) !== 8453) return closed(400, 'verify_failed');
    if (normHex(payment.token) !== normHex(MAINNET_USDC).replace(/^0x/, '')) {
      return closed(400, 'verify_failed');
    }
    if (!issuanceRuntimeReady(input)) {
      const err = new Error('v13 boot refused');
      err.code = 'v13_boot_refused';
      throw err;
    }
    paid = true;
    const dir = input.dir;
    if (!dir) return refundOwed(input, key.hex);
    return await withLock(key.hex, async () => {
      const blockHash = String(observation.blockHash || '').replace(/^0x/, '').toLowerCase();
      let line;
      try {
        line = coreLine({
          ...payment,
          blockHash,
          blockNumber: observation.blockNumber,
          blockTime: observation.blockTime,
          txIndex: observation.txIndex,
          localLogIndex: observation.localLogIndex,
          txHash: String(observation.txHash || '').replace(/^0x/, '').toLowerCase(),
          saltP: payment.saltP,
        });
      } catch (err) {
        note(input, 'intake_not_booked');
        void err;
        return refundOwed(input, key.hex);
      }
      let intake;
      try {
        intake = openIntake(intakeDirOf(input), { io: intakeIo(input) });
      } catch (err) {
        note(input, 'intake_not_booked');
        void err;
        return refundOwed(input, key.hex);
      }
      let booked;
      try {
        booked = bookLeaf(intake, {
          paymentRef: key.hex,
          line,
          caller: input.caller,
          hourStart: observation.hourStart,
        });
      } catch (err) {
        note(input, 'intake_not_booked');
        void err;
        return refundOwed(input, key.hex);
      }
      if (!booked || booked.ok !== true) {
        note(input, booked && booked.reason === 'not_owner' ? 'not_owner' : 'intake_not_booked');
        if (booked && booked.reason === 'not_owner') return notFound();
        return refundOwed(input, key.hex);
      }
      const released = releasedReceipt(input, booked.row);
      if (released) return released;
      const kind = booked.row && booked.row.state === 'refund_owed' ? 'refund_owed' : 'pending_anchor';
      const held = holdResponse(kind, key.hex, input.baseUrl);
      try {
        bindHold(dir, key.hex, input.caller, held);
      } catch (err) {
        note(input, 'intake_not_booked');
        void err;
      }
      return { ...held, replay: booked.replay === true };
    });
  } catch (err) {
    note(input, paid ? 'refund_owed' : 'verify_failed');
    void err;
    if (!paid) return closed(400, 'verify_failed');
    const key = houseAuthorizationKey(input.payment || {});
    if (!key.ok) return refundOwed(input, '00'.repeat(80));
    return refundOwed(input, key.hex);
  }
}

function releasedReceipt(input, row) {
  if (!row || typeof row.receiptId !== 'string' || row.receiptId === '' || !input?.store) return null;
  if (!input.caller || typeof input.caller.bookId !== 'string' || typeof input.caller.token !== 'string') {
    return null;
  }
  const viewed = fetchReceipt(input.store, {
    receiptId: row.receiptId,
    bookId: input.caller.bookId,
    token: input.caller.token,
  });
  if (!viewed || viewed.status !== 200) return null;
  return {
    status: 200,
    replay: true,
    body: viewed.body,
    bytes: Buffer.from(JSON.stringify(viewed.body)),
  };
}

function holdFromIntake(row) {
  if (!row) return null;
  if (row.state === 'refund_owed') {
    const body = {
      error: 'refund_owed',
      code: 'refund_owed',
      state: 'refund_owed',
      status: 'refund_owed',
      pending_id: row.pendingId,
    };
    return { status: 409, body, bytes: Buffer.from(JSON.stringify(body)) };
  }
  const body = {
    error: 'pending_anchor',
    code: 'pending_anchor',
    state: 'pending_anchor',
    pending_id: row.pendingId,
  };
  return { status: 202, body, bytes: Buffer.from(JSON.stringify(body)) };
}

export function readHouse(input) {
  const dirs = [];
  if (typeof input?.storeDir === 'string' && input.storeDir) dirs.push(input.storeDir);
  if (input?.store && typeof input.store.dir === 'string') dirs.push(input.store.dir);
  if (typeof input?.dir === 'string' && input.dir) dirs.push(input.dir);
  for (let i = 0; i < dirs.length; i += 1) {
    const owned = readOwnedPending(dirs[i], input.receiptId, input.caller);
    if (owned) {
      const released = releasedReceipt({ store: input.store, caller: input.caller }, owned);
      if (released) return released;
      return holdFromIntake(owned);
    }
  }
  const pending = pendings.get(input.receiptId);
  if (pending && pending.open === true) {
    if (!input.caller || pending.bookId !== input.caller.bookId) return notFound();
    const body = { error: 'settle_pending', code: 'settle_pending', pending_id: input.receiptId };
    return { status: 202, body, bytes: Buffer.from(JSON.stringify(body)) };
  }
  const row = rowById(input.dir, input.receiptId);
  if (!callerMatches(row, input.caller)) return notFound();
  if (row.receipt?.state === 'pending_anchor' || row.receipt?.state === 'refund_owed') {
    const status = row.receipt.state === 'refund_owed' ? 409 : 202;
    return { status, body: row.receipt, bytes: Buffer.from(row.bytes, 'utf8') };
  }
  return { status: 200, body: row.receipt, bytes: Buffer.from(row.bytes, 'utf8') };
}

export function pendingOpen(id) {
  const row = pendings.get(id);
  return !!(row && row.open === true);
}

function issuanceRuntimeReady(input) {
  if (!input || typeof input !== 'object') return false;
  if (!input.store || typeof input.store.commitEpoch !== 'function') return false;
  if (typeof input.dir !== 'string' || input.dir === '') return false;
  if (!input.client || typeof input.client.send !== 'function') return false;
  if (typeof input.send !== 'function') return false;
  if (!input.caller || typeof input.caller.bookId !== 'string' || input.caller.bookId === '') return false;
  if (typeof input.caller.token !== 'string' || input.caller.token === '') return false;
  return true;
}

export function clearPending(id) {
  const row = pendings.get(id);
  if (row) row.open = false;
}

/**
 * Local HTTP entry. Pin fields on the body are refused. addressOf is not
 * taken from the body. The caller is the authenticated party on the request.
 */
export async function handleHouse(request, ctx) {
  const body = request?.body && typeof request.body === 'object' ? request.body : {};
  if (Object.prototype.hasOwnProperty.call(body, 'pin')
    || Object.prototype.hasOwnProperty.call(body, 'codeHash')
    || Object.prototype.hasOwnProperty.call(body, 'checkpoint')
    || Object.prototype.hasOwnProperty.call(body, 'anchor')) {
    return closed(400, 'verify_failed');
  }
  const next = { ...ctx, addressOf: undefined, bodyPin: undefined, requestPin: undefined };
  if (request.method === 'GET') {
    return readHouse({
      dir: ctx.dir,
      store: ctx.store,
      receiptId: request.receiptId,
      caller: request.caller,
    });
  }
  return issueHouseReceipt({
    ...next,
    task: body.task,
    receiptOpts: body.receiptOpts,
    payment: body.payment,
    observation: body.observation,
    caller: request.caller,
  });
}
