/**
 * House receipt issuance. Flags off calls buildReceipt and returns those
 * bytes. Flags on admit a final EIP-3009 payment once, commit it in
 * chit-store, then anchor. The contract pin is the mainnet constant.
 * A request body cannot replace it.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { LAYOUT, encodeLine } from '../../../packages/cs2-core/line/index.mjs';
import { authorizationKey } from '../../../packages/cs2-core/line/index.mjs';
import { SAMPLE } from '../../../packages/cs2-core/line/sample.mjs';
import { anchor } from '../../chit-sealer/anchor-mainnet.js';
import { MAINNET_ANCHOR, MAINNET_USDC, assertLivePin, mainnetPin, normHex } from '../../chit-sealer/mainnet-pin.js';
import { decisionHoldResult } from './x402-flags.js';
import { buildReceipt } from './receipt.js';
import {
  assertV13Boot,
  issuanceEnabled,
  mainnetSealerEnabled,
  storeEnabled,
} from './v13-flags.js';

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

function pendingPaid(keyHex, baseUrl, caller) {
  const pendingId = createHash('sha256').update(String(keyHex)).digest('hex').slice(0, 32);
  const root = baseUrl ? String(baseUrl).replace(/\/$/, '') : 'http://127.0.0.1';
  const verifyUrl = `${root}/verify/${pendingId}`;
  pendings.set(pendingId, {
    key: keyHex,
    open: true,
    bookId: caller && typeof caller.bookId === 'string' ? caller.bookId : '',
    tokenHash: caller && typeof caller.token === 'string' ? tokenHash(caller.token).toString('hex') : '',
  });
  const held = decisionHoldResult({
    code: 'settle_pending',
    holdClass: 'resolvable',
    pendingId,
    verifyUrl,
  });
  const body = {
    error: held.error,
    code: held.code,
    pending_id: held.pending_id,
    verify_url: held.verify_url,
  };
  return { status: held.status, paid: true, body, bytes: Buffer.from(JSON.stringify(body)) };
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

function rowFor(dir, keyHex) {
  const rows = readRows(dir);
  if (!rows) return null;
  return rows[keyHex] || null;
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

function hexBytes(hex) {
  return Uint8Array.from(Buffer.from(hex, 'hex'));
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

function receiptDocument(line, blockHash, epoch) {
  return {
    v: 13,
    schema: 'chit402.cs2.receipt.v1',
    line: Buffer.from(line).toString('hex'),
    index: 0,
    epoch,
    contract: MAINNET_ANCHOR,
    blockHash,
  };
}

function legacyResponse(task, receiptOpts) {
  return buildReceipt(task, receiptOpts || {});
}

async function armSealer(input) {
  if (input.client && typeof input.client.send === 'function') {
    await input.client.send({ name: 'GetPublicKey', input: { KeyId: String(input.env?.CHIT_CHECKPOINT_KMS_KEY_ID || '') } }, {});
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

async function issueV13(input) {
  try {
    await armIfSealer(input.env, input);
  } catch (err) {
    note(input, 'checkpoint_sign_unavailable');
    return closed(503, 'gateway_not_configured');
  }
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
    paid = true;
    const dir = input.dir;
    if (!dir) return pendingPaid(key.hex, input.baseUrl, input.caller);
    return await withLock(key.hex, async () => {
      const existing = rowFor(dir, key.hex);
      if (existing) {
        if (existing.pendingId) pendings.delete(existing.pendingId);
        return {
          status: 200,
          replay: true,
          body: existing.receipt,
          bytes: Buffer.from(existing.bytes, 'utf8'),
        };
      }
      const blockHash = String(observation.blockHash || '').replace(/^0x/, '').toLowerCase();
      const line = coreLine({
        ...payment,
        blockHash,
        blockNumber: observation.blockNumber,
        blockTime: observation.blockTime,
        txIndex: observation.txIndex,
        localLogIndex: observation.localLogIndex,
        txHash: String(observation.txHash || '').replace(/^0x/, '').toLowerCase(),
        saltP: payment.saltP,
      });
      const epoch = 1 + Number(BigInt(`0x${key.hex.slice(-8)}`) % 100000n);
      const document = receiptDocument(line, blockHash, epoch);
      const bytes = JSON.stringify(document);
      const record = {
        epoch,
        hourStart: observation.hourStart,
        size: 1024,
        root: createHash('sha256').update(line).digest('hex'),
        stateRoot: createHash('sha256').update(bytes).digest('hex'),
        chainId: String(pin.chainId),
        contract: pin.address,
        checkpoint: pin.checkpoint,
        receipts: [{ id: key.hex.slice(0, 32), bookId: input.caller.bookId }],
      };
      let stored;
      try {
        stored = input.store.commitEpoch(record);
      } catch (err) {
        note(input, 'store_not_committed');
        return pendingPaid(key.hex, input.baseUrl, input.caller);
      }
      if (!stored || stored.ok !== true) {
        note(input, 'store_not_committed');
        return pendingPaid(key.hex, input.baseUrl, input.caller);
      }
      const saved = {
        receiptId: key.hex.slice(0, 32),
        bookId: input.caller.bookId,
        tokenHash: tokenHash(input.caller.token).toString('hex'),
        receipt: document,
        bytes,
        pendingId: null,
      };
      bindAuthorization(dir, key.hex, saved);
      const holdId = createHash('sha256').update(key.hex).digest('hex').slice(0, 32);
      pendings.delete(holdId);
      if (mainnetSealerEnabled(input.env) === true) {
        try {
          await anchor({
            env: input.env,
            pin,
            store: input.store,
            record,
            calldata: `${record.root}:${record.epoch}`,
            client: input.client,
            send: input.send,
            digest: hexBytes(record.root),
            addressOf: testAddressOf(input),
          });
        } catch (err) {
          note(input, err?.code || 'anchor_pending');
          return {
            status: 200,
            body: document,
            bytes: Buffer.from(bytes),
          };
        }
      }
      return { status: 200, body: document, bytes: Buffer.from(bytes) };
    });
  } catch (err) {
    note(input, paid ? 'v13_pending' : 'verify_failed');
    if (!paid) return closed(400, 'verify_failed');
    const key = houseAuthorizationKey(input.payment || {});
    return pendingPaid(key.ok ? key.hex : 'unkeyed', input.baseUrl, input.caller);
  }
}

export function readHouse(input) {
  const pending = pendings.get(input.receiptId);
  if (pending && pending.open === true) {
    if (!input.caller || pending.bookId !== input.caller.bookId) return notFound();
    const body = { error: 'settle_pending', code: 'settle_pending', pending_id: input.receiptId };
    return { status: 202, body, bytes: Buffer.from(JSON.stringify(body)) };
  }
  const row = rowById(input.dir, input.receiptId);
  if (!callerMatches(row, input.caller)) return notFound();
  return { status: 200, body: row.receipt, bytes: Buffer.from(row.bytes, 'utf8') };
}

export function pendingOpen(id) {
  const row = pendings.get(id);
  return !!(row && row.open === true);
}

function testAddressOf(input) {
  if (input?.testInjection !== true) return undefined;
  if (process.env.NODE_ENV !== 'test') return undefined;
  return typeof input.addressOf === 'function' ? input.addressOf : undefined;
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
