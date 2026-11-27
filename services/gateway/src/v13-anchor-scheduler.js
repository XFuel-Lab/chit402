/**
 * Hourly v13 checkpoint scheduler.
 *
 * CHIT_V13_ANCHOR_SCHEDULER defaults off. Off starts no timer, opens no
 * sealer journal, and makes no RPC call. On requires the store flag, the
 * mainnet sealer flag, a mode-700 sealer directory, two independent Base
 * RPC URLs, and CHIT_CHECKPOINT_MAX_FEE_PER_GAS. The house runtime send
 * stays refuseUnpreparedHouseSend. This module never assigns runtime.send.
 *
 * Quiet hours are not anchored. A gap above MAX_BACKLOG is closed in a
 * 168-hour window so closeHour does not return backlog_too_large, and the
 * window still carries any pending intake. Empty windows are not submitted.
 */

import fs from 'node:fs';
import path from 'node:path';
import { MAX_BACKLOG, feeBump, hourIsFinished, openSealer, pendingCommits, recover } from '../../chit-sealer/close.js';
import { guardCloseHour, withSealerGuard } from '../../chit-sealer/guard.js';
import { assertFeeCeiling, bumpFeeQuote, createCheckpointSigner } from '../../chit-sealer/kms-secp256k1.js';
import { guardKmsClient } from '../../chit-sealer/anchor-mainnet.js';
import { MAINNET_ANCHOR, MAINNET_CHAIN_ID } from '../../chit-sealer/mainnet-pin.js';
import {
  assertSealerRpcPair,
  createBaseBroadcaster,
  dirModeOk,
  fileModeOk,
  readFeeCapWei,
} from '../../chit-sealer/rpc-base.js';
import { readPendingLines } from '../../chit-store/intake.js';
import { committedReceiptForLine, isHouseShapedEpoch, noteAnchored } from '../../chit-store/store.js';
import logger from './logger.js';
import { testSwitchesOn } from './test-switch.js';
import { mainnetSealerEnabled, readClosedFlag, storeEnabled } from './v13-flags.js';

export const ANCHOR_SCHEDULER_FLAG = 'CHIT_V13_ANCHOR_SCHEDULER';
export const ANCHOR_TICK_MS = 60_000;
export const STOP_WAIT_MS = 5_000;

const HOUR = 3600;
const STUCK_DEFAULT_MS = 120_000;
const CLOSE_MARGIN_DEFAULT_SEC = 120;
const FINALITY_DEPTH_DEFAULT = 64;
const STALL_HOURS_DEFAULT = 3;
const SEALER_FILES = ['sealer-state.json', 'anchor-intents.jsonl'];
const HOLD_FILE = 'anchor-hold.json';
const BUMP_FILE = 'anchor-bumps.json';

const REASONS = new Set([
  'fee_ceiling',
  'anchor_chain_mismatch',
  'v13_pin_refused',
  'anchor_rpc_unavailable',
  'anchor_target',
  'anchor_unprepared',
  'sealer_busy',
  'sealer_unavailable',
  'broadcast_failed',
  'empty_hour',
  'hour_not_finished',
  'hour_already_covered',
  'backlog_window',
  'intake_unreadable',
  'nothing_pending',
  'nonce_reused',
  'bad_fees',
  'bad_broadcast',
  'store_not_committed',
  'commit_failed',
  'nonce_unused',
  'anchor_reverted',
  'anchor_bump_spent',
  'anchor_head_mismatch',
  'anchor_simulation_failed',
  'anchor_quorum',
  'anchor_nonce_conflict',
  'anchor_nonce_retired',
  'anchor_stalled',
  'anchor_hold_unreadable',
]);

const HOLD_REASONS = new Set(['anchor_reverted', 'anchor_nonce_conflict', 'anchor_nonce_retired']);

let active = null;
let anchorStall = null;
let legacyUnreleased = 0;

const STALL_SEEN_FILE = 'anchor-stall-seen.json';
const stallSeenMem = new Map();

/** Allow-listed stall code for /health. Null when the scheduler is moving. */
export function anchorStallStatus() {
  return anchorStall;
}

/**
 * Unreleased non-house epochs that have no journal commit. They still
 * use the hour-end stall clock, and /health reports the count so an old
 * book is visible on the first enable.
 */
export function legacyUnreleasedEpochs() {
  return legacyUnreleased;
}

function setAnchorStall(code) {
  anchorStall = typeof code === 'string' && allowed(code) ? code : null;
}

function bootRefused() {
  const err = new Error('v13 boot refused');
  err.code = 'v13_boot_refused';
  return err;
}

export function anchorSchedulerEnabled(env) {
  return readClosedFlag(env, ANCHOR_SCHEDULER_FLAG) === true;
}

function allowed(code) {
  return typeof code === 'string' && REASONS.has(code);
}

function defaultReport(fields, msg) {
  logger.error({ code: fields.code, reason: fields.reason }, msg);
}

function report(log, code, reason) {
  const fields = { code: allowed(code) ? code : 'sealer_unavailable' };
  if (reason && allowed(reason)) fields.reason = reason;
  try {
    const sink = typeof log === 'function' ? log : defaultReport;
    sink(fields, 'v13 anchor tick');
  } catch {
    // The tick result is already decided.
  }
}

function stuckAfterMs(env) {
  const raw = env == null ? undefined : env.CHIT_SEALER_STUCK_MS;
  if (raw == null || String(raw).trim() === '') return STUCK_DEFAULT_MS;
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) return STUCK_DEFAULT_MS;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 0 || value > 3_600_000) return STUCK_DEFAULT_MS;
  return value;
}

function readSealerDir(dirPath) {
  if (typeof dirPath !== 'string' || dirPath.trim() === '') throw bootRefused();
  let st;
  try {
    st = fs.lstatSync(dirPath);
  } catch {
    throw bootRefused();
  }
  if (typeof st.isSymbolicLink === 'function' && st.isSymbolicLink()) throw bootRefused();
  if (typeof st.isDirectory !== 'function' || st.isDirectory() !== true) throw bootRefused();
  if (!dirModeOk(st.mode)) throw bootRefused();
  for (let i = 0; i < SEALER_FILES.length; i += 1) {
    const file = path.join(dirPath, SEALER_FILES[i]);
    let fst;
    try {
      fst = fs.lstatSync(file);
    } catch (err) {
      if (err && err.code === 'ENOENT') continue;
      throw bootRefused();
    }
    if (typeof fst.isSymbolicLink === 'function' && fst.isSymbolicLink()) throw bootRefused();
    if (typeof fst.isFile !== 'function' || fst.isFile() !== true) throw bootRefused();
    if (!fileModeOk(fst.mode)) throw bootRefused();
  }
  return dirPath;
}

/**
 * Config gate for the scheduler flag. Does not open a journal, a socket,
 * or a timer. A missing flag requirement throws v13_boot_refused.
 * @param {object} env
 */
export function assertAnchorSchedulerBoot(env) {
  const source = env || {};
  if (storeEnabled(source) !== true || mainnetSealerEnabled(source) !== true) throw bootRefused();
  const ceiling = readFeeCapWei(source.CHIT_CHECKPOINT_MAX_FEE_PER_GAS);
  if (ceiling == null) throw bootRefused();
  const urls = assertSealerRpcPair(source.CHIT_SEALER_RPC_URL, source.CHIT_SEALER_RPC_URL_2, source);
  const dir = readSealerDir(source.CHIT_V13_SEALER_DIR);
  return { dir, ceiling, urls };
}

/** Seconds after the hour ends before a close is attempted. Default 120. */
export function closeMarginSec(env) {
  const raw = env == null ? undefined : env.CHIT_SEALER_CLOSE_MARGIN_SEC;
  if (raw == null || String(raw).trim() === '') return CLOSE_MARGIN_DEFAULT_SEC;
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) return CLOSE_MARGIN_DEFAULT_SEC;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 0 || value > 3600) return CLOSE_MARGIN_DEFAULT_SEC;
  return value;
}

function holdFile(dir) {
  return path.join(dir, HOLD_FILE);
}

// A FIFO open blocks the event loop unless O_NONBLOCK is set before the type check.
const OPEN_READ = fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | (fs.constants.O_CLOEXEC || 0);
const OPEN_WRITE = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC
  | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW | (fs.constants.O_CLOEXEC || 0);

function readRegularText(file) {
  const fd = fs.openSync(file, OPEN_READ | fs.constants.O_NOFOLLOW);
  try {
    const st = fs.fstatSync(fd);
    if (typeof st.isFile !== 'function' || st.isFile() !== true) {
      const err = new Error('not a regular file');
      err.code = 'ENOTREG';
      throw err;
    }
    return fs.readFileSync(fd, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function writeRegularFile(file, text) {
  const fd = fs.openSync(file, OPEN_WRITE, 0o600);
  try {
    const st = fs.fstatSync(fd);
    if (typeof st.isFile !== 'function' || st.isFile() !== true) {
      const err = new Error('not a regular file');
      err.code = 'ENOTREG';
      throw err;
    }
    const buf = Buffer.from(text);
    let offset = 0;
    while (offset < buf.length) {
      const n = fs.writeSync(fd, buf, offset, buf.length - offset);
      if (!Number.isInteger(n) || n <= 0) throw new Error('short write');
      offset += n;
    }
  } finally {
    fs.closeSync(fd);
  }
  try { fs.chmodSync(file, 0o600); } catch { /* mode was set on create */ }
}

// anchor_hold_unreadable stays until a builder deletes anchor-hold.json.
// The scheduler does not clear that file itself.
function holdReason(dir) {
  let text;
  try {
    text = readRegularText(holdFile(dir));
  } catch (err) {
    if (err && err.code === 'ENOENT') return '';
    return 'anchor_hold_unreadable';
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed && parsed.v === 1 && HOLD_REASONS.has(parsed.reason)) return parsed.reason;
  } catch {
    return 'anchor_hold_unreadable';
  }
  return 'anchor_hold_unreadable';
}

function fsyncDir(dir) {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0);
  const dfd = fs.openSync(dir, flags);
  try {
    fs.fsyncSync(dfd);
  } finally {
    fs.closeSync(dfd);
  }
}

function tempPath(file) {
  return `${file}.${process.pid}.tmp`;
}

function hostileTemp(file) {
  let existing = null;
  try {
    existing = fs.lstatSync(tempPath(file));
  } catch (err) {
    if (!err || err.code !== 'ENOENT') return true;
    return false;
  }
  const regular = typeof existing.isFile === 'function' && existing.isFile() === true
    && !(typeof existing.isSymbolicLink === 'function' && existing.isSymbolicLink());
  return !regular;
}

function atomicReplace(dir, file, text) {
  const tmp = tempPath(file);
  let existing = null;
  try {
    existing = fs.lstatSync(tmp);
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw err;
  }
  if (existing) {
    const regular = typeof existing.isFile === 'function' && existing.isFile() === true
      && !(typeof existing.isSymbolicLink === 'function' && existing.isSymbolicLink());
    if (!regular) {
      const err = new Error('hold temp is not a regular file');
      err.code = 'ENOTREG';
      throw err;
    }
    fs.unlinkSync(tmp);
  }
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL
    | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK | (fs.constants.O_CLOEXEC || 0);
  const fd = fs.openSync(tmp, flags, 0o600);
  try {
    const st = fs.fstatSync(fd);
    if (typeof st.isFile !== 'function' || st.isFile() !== true) {
      const err = new Error('not a regular file');
      err.code = 'ENOTREG';
      throw err;
    }
    const buf = Buffer.from(text);
    let offset = 0;
    while (offset < buf.length) {
      const n = fs.writeSync(fd, buf, offset, buf.length - offset);
      if (!Number.isInteger(n) || n <= 0) throw new Error('short write');
      offset += n;
    }
    fs.fsyncSync(fd);
  } catch (err) {
    try { fs.closeSync(fd); } catch { /* closing a failed tmp */ }
    try { fs.unlinkSync(tmp); } catch { /* tmp may already be gone */ }
    throw err;
  }
  fs.closeSync(fd);
  fs.renameSync(tmp, file);
  fsyncDir(dir);
}

const NONCE_CLEAR_FILE = 'anchor-nonce-clear.json';

function clearFile(dir) {
  return path.join(dir, NONCE_CLEAR_FILE);
}

/**
 * A clear file is ignored unless it is strictly {v:1, nonce}, mode 600,
 * owned by this process, and newer than the current hold file.
 * @param {string} dir
 */
function duplicateJsonKey(text) {
  const seen = new Set();
  const re = /"((?:\\.|[^"\\])*)"\s*:/g;
  let match = re.exec(text);
  while (match) {
    if (seen.has(match[1])) return true;
    seen.add(match[1]);
    match = re.exec(text);
  }
  return false;
}

function readNonceClear(dir) {
  const file = clearFile(dir);
  let fd;
  try {
    fd = fs.openSync(file, OPEN_READ | fs.constants.O_NOFOLLOW);
  } catch {
    return null;
  }
  try {
    let st;
    try {
      st = fs.fstatSync(fd);
    } catch {
      return null;
    }
    if (typeof st.isSymbolicLink === 'function' && st.isSymbolicLink()) return null;
    if (typeof st.isFile !== 'function' || st.isFile() !== true) return null;
    if (typeof st.uid === 'number' && typeof process.getuid === 'function' && st.uid !== process.getuid()) return null;
    if (!fileModeOk(st.mode)) return null;
    let holdStat;
    try {
      holdStat = fs.lstatSync(holdFile(dir));
    } catch {
      return null;
    }
    if (!(st.mtimeMs > holdStat.mtimeMs)) return null;
    let text;
    try {
      text = fs.readFileSync(fd, 'utf8');
    } catch {
      return null;
    }
    if (duplicateJsonKey(text)) return null;
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const keys = Object.keys(parsed);
    if (keys.length !== 2 || !Object.prototype.hasOwnProperty.call(parsed, 'v') || !Object.prototype.hasOwnProperty.call(parsed, 'nonce')) {
      return null;
    }
    if (parsed.v !== 1 || typeof parsed.nonce !== 'string' || !/^(0|[1-9][0-9]*)$/.test(parsed.nonce)) return null;
    return { nonce: parsed.nonce, file };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Consume a clear file into an anchor_nonce_retired hold. A conflict hold
 * that fails these checks is left in place. A reverted hold is never replaced.
 * @param {object} session
 */
async function acceptNonceClear(session) {
  if (holdReason(session.dir) !== 'anchor_nonce_conflict') return false;
  const clear = readNonceClear(session.dir);
  if (!clear) return false;
  const current = currentCommit(session);
  if (!current) return false;
  let committed;
  try {
    committed = BigInt(current.nonce);
  } catch {
    return false;
  }
  if (BigInt(clear.nonce) !== committed) return false;
  let ready;
  try {
    ready = await session.broadcaster.prepare();
  } catch {
    return false;
  }
  let chainNonce;
  try {
    chainNonce = await session.broadcaster.accountNonce(undefined, ready);
  } catch {
    return false;
  }
  if (typeof chainNonce !== 'bigint' || chainNonce <= committed) return false;
  const hashes = txHashesFor(session, current);
  let absent = false;
  try {
    absent = hashes.length > 0 && await session.broadcaster.hashesAbsent(hashes, undefined, ready);
  } catch {
    return false;
  }
  if (!absent) return false;
  writeHold(session.dir, 'anchor_nonce_retired');
  try { fs.unlinkSync(clear.file); } catch { /* the retired hold is already the record */ }
  return true;
}

function writeHold(dir, reason) {
  const code = HOLD_REASONS.has(reason) ? reason : 'anchor_reverted';
  atomicReplace(dir, holdFile(dir), `${JSON.stringify({ v: 1, reason: code })}\n`);
}

function bumpFile(dir) {
  return path.join(dir, BUMP_FILE);
}

function readBumps(dir) {
  try {
    const parsed = JSON.parse(readRegularText(bumpFile(dir)));
    if (parsed && parsed.v === 2 && parsed.bumps && typeof parsed.bumps === 'object') return parsed.bumps;
    if (parsed && parsed.v === 1 && Array.isArray(parsed.epochs)) {
      const bumps = {};
      for (let i = 0; i < parsed.epochs.length; i += 1) bumps[String(parsed.epochs[i])] = { hashes: [] };
      return bumps;
    }
  } catch {
    return {};
  }
  return {};
}

function bumpedEpochs(dir) {
  return new Set(Object.keys(readBumps(dir)));
}

function rememberBump(dir, epoch, hashes) {
  const bumps = readBumps(dir);
  const prior = bumps[String(epoch)] && Array.isArray(bumps[String(epoch)].hashes)
    ? bumps[String(epoch)].hashes
    : [];
  const next = new Set(prior);
  const list = Array.isArray(hashes) ? hashes : [];
  for (let i = 0; i < list.length; i += 1) {
    if (typeof list[i] === 'string' && /^0x[0-9a-fA-F]{64}$/.test(list[i])) next.add(list[i].toLowerCase());
  }
  bumps[String(epoch)] = { hashes: [...next] };
  writeRegularFile(bumpFile(dir), `${JSON.stringify({ v: 2, bumps })}\n`);
}

export function finalityDepth(env) {
  const raw = env == null ? undefined : env.CHIT_SEALER_FINALITY_DEPTH;
  if (raw == null || String(raw).trim() === '') return FINALITY_DEPTH_DEFAULT;
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) return FINALITY_DEPTH_DEFAULT;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 0 || value > 100000) return FINALITY_DEPTH_DEFAULT;
  return value;
}

export function stallHours(env) {
  const raw = env == null ? undefined : env.CHIT_SEALER_STALL_HOURS;
  if (raw == null || String(raw).trim() === '') return STALL_HOURS_DEFAULT;
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) return STALL_HOURS_DEFAULT;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 0 || value > 168) return STALL_HOURS_DEFAULT;
  return value;
}

function finishedHour(now) {
  if (typeof now !== 'number' || !Number.isSafeInteger(now) || now < 0 || Object.is(now, -0)) {
    return Number.NaN;
  }
  return (Math.floor(now / HOUR) * HOUR) - HOUR;
}

/**
 * Skip a finished hour that has no pending intake. When the gap since the
 * last anchor is above MAX_BACKLOG, close the farthest hour closeHour accepts
 * so a later intake hour is not backlog_too_large. That window is not empty:
 * the caller has already required intake.
 * @param {object} state
 * @param {number} now
 * @param {number} intakeCount
 * @param {number} [marginSec]
 */
export function selectAnchorHour(state, now, intakeCount, marginSec = CLOSE_MARGIN_DEFAULT_SEC) {
  if (!Number.isSafeInteger(intakeCount) || intakeCount <= 0) {
    return { action: 'skip', reason: 'empty_hour' };
  }
  const margin = Number.isSafeInteger(marginSec) && marginSec >= 0 ? marginSec : CLOSE_MARGIN_DEFAULT_SEC;
  const effective = now - margin;
  const lastComplete = finishedHour(effective);
  if (!hourIsFinished(lastComplete, now)) return { action: 'skip', reason: 'hour_not_finished' };
  const last = state ? state.lastHourStart : null;
  if (last == null) return { action: 'close', hourStart: lastComplete };
  if (!Number.isSafeInteger(last)) return { action: 'skip', reason: 'hour_not_finished' };
  if (lastComplete <= last) return { action: 'skip', reason: 'hour_already_covered' };
  const gap = (lastComplete - last) / HOUR;
  if (!Number.isSafeInteger(gap) || gap < 1) return { action: 'skip', reason: 'hour_not_finished' };
  if (gap > MAX_BACKLOG) {
    const hourStart = last + (MAX_BACKLOG * HOUR);
    if (!hourIsFinished(hourStart, now)) return { action: 'skip', reason: 'hour_not_finished' };
    return { action: 'close', hourStart, reason: 'backlog_window' };
  }
  return { action: 'close', hourStart: lastComplete };
}

function pendingIntakeCount(store) {
  const pending = readPendingLines(store.dir, store.io);
  if (!pending.ok) return pending;
  let count = 0;
  for (let i = 0; i < pending.lines.length; i += 1) {
    const hex = Buffer.from(pending.lines[i].line).toString('hex');
    if (committedReceiptForLine(store, hex)) continue;
    count += 1;
  }
  return { ok: true, count };
}

function end(ok, reason) {
  const body = { ok: ok === true };
  if (reason && allowed(reason)) body.reason = reason;
  return body;
}

async function loadSigner(env, client, deps) {
  if (deps && deps.testInjection === true && testSwitchesOn(env) && deps.signer) return deps.signer;
  try {
    return await createCheckpointSigner({ client: guardKmsClient(client), env });
  } catch {
    throw bootRefused();
  }
}

async function openSession(opts) {
  const env = opts.env || {};
  const deps = opts.deps || {};
  const boot = assertAnchorSchedulerBoot(env);
  const runtime = opts.runtime;
  if (!runtime || !runtime.store || !runtime.client || typeof runtime.client.send !== 'function') {
    throw bootRefused();
  }
  const signer = await loadSigner(env, runtime.client, deps);
  if (!signer || typeof signer.signEip1559 !== 'function' || signer.feeCeiling == null) throw bootRefused();
  const clock = typeof opts.clock === 'function' ? opts.clock : () => Math.floor(Date.now() / 1000);
  let sealer;
  try {
    sealer = openSealer({
      dir: boot.dir,
      store: runtime.store,
      signer,
      chainId: BigInt(MAINNET_CHAIN_ID),
      contract: MAINNET_ANCHOR,
      clock,
    });
  } catch {
    throw bootRefused();
  }
  let broadcaster;
  try {
    broadcaster = createBaseBroadcaster({
      urls: boot.urls,
      fetchImpl: deps.fetch,
      timeoutMs: deps.timeoutMs,
    });
  } catch {
    throw bootRefused();
  }
  const send = async (wire, sendOpts = {}) => {
    try {
      return await broadcaster.sendRaw(wire, sendOpts && sendOpts.signal);
    } catch (err) {
      if (err && err.code === 'anchor_nonce_conflict') {
        const found = await lookupCommitted(broadcaster, sealer, sendOpts && sendOpts.signal, boot.dir);
        if (found) return found;
        throw err;
      }
      throw err;
    }
  };
  const guarded = guardSigner(signer, sealer, broadcaster, boot.dir);
  sealer.signer = guarded;
  return {
    env,
    dir: boot.dir,
    log: deps.log,
    signer: guarded,
    sealer,
    broadcaster,
    send,
    stuckMs: stuckAfterMs(env),
  };
}

function coded(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

function expectedHead(state) {
  const commits = state && Array.isArray(state.commits) ? state.commits : [];
  const open = [...commits].reverse().find((row) => row && row.broadcast === false);
  const epoch = open ? Number(open.epoch) - 1 : Number(state && state.anchorEpoch ? state.anchorEpoch : 0) - 1;
  if (!Number.isSafeInteger(epoch) || epoch < 0) return { epoch: 0, hourStart: 0 };
  const prior = [...commits].reverse().find((row) => Number(row.epoch) === epoch);
  return { epoch, hourStart: prior ? Number(prior.hourStart) : 0 };
}

function guardSigner(signer, sealer, broadcaster, dir) {
  return {
    kind: signer.kind,
    address: signer.address,
    publicKey: signer.publicKey,
    get feeCeiling() { return signer.feeCeiling; },
    async signDigest(digest, opts) {
      return signer.signDigest(digest, opts);
    },
    async signEip1559(tx, opts) {
      const signal = opts && opts.signal;
      if (signal && signal.aborted) throw coded('sealer_unavailable');
      const held = holdReason(dir);
      if (held) throw coded(held);
      const head = await broadcaster.chainHead(signal);
      const expected = expectedHead(sealer.state);
      if (head.epoch !== expected.epoch || head.hourStart !== expected.hourStart) {
        throw coded('anchor_head_mismatch');
      }
      await broadcaster.simulateAnchor(tx, signal);
      const signed = await signer.signEip1559(tx, opts);
      if (signal && signal.aborted) throw coded('sealer_unavailable');
      return signed;
    },
  };
}

function hashList(rows, nonce) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < rows.length; i += 1) {
    const item = rows[i];
    if (!item || String(item.nonce) !== String(nonce)) continue;
    const candidates = [];
    if (typeof item.tx === 'string') candidates.push(item.tx);
    if (typeof item.hash === 'string') {
      candidates.push(item.hash.startsWith('0x') ? item.hash : `0x${item.hash}`);
    }
    for (let j = 0; j < candidates.length; j += 1) {
      const hash = candidates[j];
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) continue;
      const key = hash.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

function txHashesFor(session, commit) {
  let rows = [];
  try {
    rows = session.sealer.intentLog.read();
  } catch {
    rows = [];
  }
  const fromLog = hashList(rows, commit.nonce);
  const saved = readBumps(session.dir);
  const extra = saved[String(commit.epoch)] && Array.isArray(saved[String(commit.epoch)].hashes)
    ? saved[String(commit.epoch)].hashes
    : [];
  const seen = new Set(fromLog);
  for (let i = 0; i < extra.length; i += 1) {
    if (typeof extra[i] === 'string' && /^0x[0-9a-fA-F]{64}$/.test(extra[i]) && !seen.has(extra[i].toLowerCase())) {
      seen.add(extra[i].toLowerCase());
      fromLog.push(extra[i].toLowerCase());
    }
  }
  return fromLog;
}

async function lookupCommitted(broadcaster, sealer, signal, dir) {
  const commits = sealer.state.commits || [];
  const current = commits.length > 0 ? commits[commits.length - 1] : null;
  if (!current) return '';
  let rows = [];
  try { rows = sealer.intentLog.read(); } catch { rows = []; }
  const hashes = hashList(rows, current.nonce);
  const saved = dir ? readBumps(dir) : {};
  const extra = saved[String(current.epoch)] && Array.isArray(saved[String(current.epoch)].hashes)
    ? saved[String(current.epoch)].hashes
    : [];
  const seen = new Set(hashes);
  for (let i = 0; i < extra.length; i += 1) {
    if (typeof extra[i] === 'string' && /^0x[0-9a-fA-F]{64}$/.test(extra[i]) && !seen.has(extra[i].toLowerCase())) {
      seen.add(extra[i].toLowerCase());
      hashes.push(extra[i].toLowerCase());
    }
  }
  for (let i = 0; i < hashes.length; i += 1) {
    const found = await broadcaster.findTx(hashes[i], signal);
    if (found) return found;
  }
  return '';
}

function currentCommit(session) {
  const commits = session.sealer.state.commits || [];
  return commits.length > 0 ? commits[commits.length - 1] : null;
}

function receiptReverted(watched) {
  return !!(watched && watched.reverted === true);
}

async function observeHashes(session, hashes) {
  let mined = false;
  for (let i = 0; i < hashes.length; i += 1) {
    const observed = await session.broadcaster.observeTx(hashes[i], undefined, finalityDepth(session.env));
    if (observed && observed.reverted === true) return { reverted: true };
    if (observed && observed.pending !== true && observed.reverted !== true && observed.status === 1n) mined = true;
    if (observed && observed.finalized === true) return { finalized: observed, mined: true };
  }
  return { mined };
}

async function releaseFinalized(session) {
  const held = holdReason(session.dir);
  if (held) {
    report(session.log, held);
    return { held: true, reason: held };
  }
  const current = currentCommit(session);
  if (!current || current.broadcast !== true) return { held: false };
  const hashes = txHashesFor(session, current);
  if (hashes.length === 0) return { held: false };
  let watched;
  try {
    watched = await observeHashes(session, hashes);
  } catch (err) {
    report(session.log, err && err.code);
    if (err && (err.code === 'anchor_quorum' || err.code === 'anchor_head_mismatch')) {
      return { held: false, reason: err.code };
    }
    return { held: false };
  }
  if (receiptReverted(watched)) {
    writeHold(session.dir, 'anchor_reverted');
    report(session.log, 'anchor_reverted');
    return { held: true, reason: 'anchor_reverted' };
  }
  const observed = watched && watched.finalized;
  if (!observed || observed.finalized !== true) {
    return { held: false, waiting: !!(watched && watched.mined) };
  }
  try {
    noteAnchored(session.sealer.store, {
      epoch: observed.epoch,
      hourStart: observed.hourStart,
      size: observed.size,
      root: observed.root,
      stateRoot: observed.stateRoot,
      finalized: true,
      chainId: Number(MAINNET_CHAIN_ID),
      contract: MAINNET_ANCHOR,
      from: observed.from,
    });
  } catch {
    report(session.log, 'sealer_unavailable');
  }
  return { held: false, released: true, mined: true };
}

async function maybeBump(session) {
  const current = currentCommit(session);
  if (!current || current.broadcast !== true) return null;
  const hashes = txHashesFor(session, current);
  let watched;
  try {
    watched = hashes.length > 0 ? await observeHashes(session, hashes) : { mined: false };
  } catch (err) {
    report(session.log, err && err.code);
    if (err && err.code === 'anchor_quorum') return end(false, 'anchor_quorum');
    return end(false, 'anchor_rpc_unavailable');
  }
  if (receiptReverted(watched)) {
    writeHold(session.dir, 'anchor_reverted');
    report(session.log, 'anchor_reverted');
    return end(false, 'anchor_reverted');
  }
  if (watched && watched.finalized) return null;
  if (watched && watched.mined) return end(true, null);
  if (bumpedEpochs(session.dir).has(String(current.epoch))) {
    report(session.log, 'anchor_bump_spent');
    if (unminedPastStuck(session, current)) return end(false, 'anchor_bump_spent');
    return end(true, 'anchor_bump_spent');
  }
  let rows;
  try {
    rows = session.sealer.intentLog.read();
  } catch {
    report(session.log, 'sealer_unavailable');
    return end(false, 'sealer_unavailable');
  }
  const broadcast = [...rows].reverse().find((row) => (
    row && row.nonce === String(current.nonce) && row.status === 'broadcast' && typeof row.tx === 'string'
  ));
  if (!broadcast) return null;
  const at = Date.parse(broadcast.at);
  if (!Number.isFinite(at) || Date.now() - at < session.stuckMs) return null;
  try {
    const quote = bumpFeeQuote(current.fees, session.signer.feeCeiling);
    assertFeeCeiling({
      gasLimit: quote.gasLimit.toString(),
      maxFeePerGas: quote.maxFeePerGas.toString(),
      maxPriorityFeePerGas: quote.maxPriorityFeePerGas.toString(),
    }, session.signer.feeCeiling);
  } catch {
    report(session.log, 'fee_ceiling');
    return end(false, 'fee_ceiling');
  }
  rememberBump(session.dir, current.epoch, hashes);
  const bumped = await withSealerGuard(({ signal }) => feeBump(session.sealer, {
    nonce: current.nonce,
    send: (wire) => session.send(wire, { signal }),
    signal,
  }), { env: session.env, log: (fields) => report(session.log, fields && fields.code) });
  rememberBump(session.dir, current.epoch, txHashesFor(session, current));
  const reason = bumped && bumped.ok === true ? null : (bumped && bumped.reason) || 'broadcast_failed';
  if (reason === 'anchor_nonce_conflict') writeHold(session.dir, 'anchor_nonce_conflict');
  if (reason) report(session.log, reason);
  return end(bumped && bumped.ok === true, reason);
}

function hourEnd(hourStart) {
  if (!Number.isSafeInteger(hourStart) || hourStart < 0) return null;
  const end = hourStart + HOUR;
  if (!Number.isSafeInteger(end)) return null;
  return end;
}

function earlier(origin, candidate) {
  if (candidate == null) return origin;
  if (origin == null || candidate < origin) return candidate;
  return origin;
}

function commitWaitStart(commit, hourStart) {
  if (commit && Number.isSafeInteger(commit.committedAt) && commit.committedAt >= 0) return commit.committedAt;
  return hourEnd(hourStart);
}

function stallSeenFile(dir) {
  return path.join(dir, STALL_SEEN_FILE);
}

function readStallSeen(dir, now) {
  let text;
  try {
    text = readRegularText(stallSeenFile(dir));
  } catch (err) {
    if (!err || err.code === 'ENOENT') return { at: null };
    const kept = stallSeenMem.has(dir) ? stallSeenMem.get(dir) : null;
    return { at: kept, unreadable: true };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { at: null };
  }
  if (!parsed || parsed.v !== 1 || !Number.isSafeInteger(parsed.at) || parsed.at < 0 || parsed.at > now) {
    return { at: null };
  }
  stallSeenMem.set(dir, parsed.at);
  return { at: parsed.at };
}

function writeStallSeen(dir, at) {
  atomicReplace(dir, stallSeenFile(dir), `${JSON.stringify({ v: 1, at })}\n`);
}

function unminedPastStuck(session, current) {
  let rows = [];
  try {
    rows = session.sealer.intentLog.read();
  } catch {
    return true;
  }
  const broadcast = [...rows].reverse().find((row) => (
    row && row.nonce === String(current.nonce) && row.status === 'broadcast' && typeof row.at === 'string'
  ));
  const at = broadcast ? Date.parse(broadcast.at) : Number.NaN;
  if (!Number.isFinite(at)) return true;
  return Date.now() - at >= session.stuckMs;
}

function intakeStall(session) {
  const now = session.sealer.clock();
  if (!Number.isSafeInteger(now) || now < 0) return '';
  let origin = null;
  let nullHour = false;
  let legacy = 0;
  try {
    const pending = readPendingLines(session.sealer.store.dir, session.sealer.store.io);
    if (pending.ok && Array.isArray(pending.lines)) {
      for (let i = 0; i < pending.lines.length; i += 1) {
        const row = pending.lines[i];
        const hex = Buffer.from(row.line).toString('hex');
        if (committedReceiptForLine(session.sealer.store, hex)) continue;
        const fromHour = hourEnd(row.hourStart);
        if (fromHour == null) {
          nullHour = true;
          continue;
        }
        origin = earlier(origin, fromHour);
      }
    }
  } catch {
    // A missing intake file is not a stall by itself.
  }
  if (nullHour) {
    const stamp = readStallSeen(session.dir, now) || { at: null };
    let seen = stamp.at;
    if (stamp.unreadable === true) {
      seen = seen == null ? now : seen;
      stallSeenMem.set(session.dir, seen);
      try { writeStallSeen(session.dir, seen); } catch { /* the in-memory stamp still starts the clock */ }
    } else if (seen == null) {
      seen = now;
      stallSeenMem.delete(session.dir);
      try { writeStallSeen(session.dir, seen); } catch { /* a missing file is rewritten */ }
    }
    origin = earlier(origin, seen);
  } else {
    stallSeenMem.delete(session.dir);
    try { fs.unlinkSync(stallSeenFile(session.dir)); } catch { /* no stamp to drop */ }
  }
  const commits = session.sealer.state && Array.isArray(session.sealer.state.commits)
    ? session.sealer.state.commits
    : [];
  const epochs = session.sealer.store && session.sealer.store.epochs;
  if (epochs && typeof epochs.values === 'function') {
    for (const row of epochs.values()) {
      if (!row || row.released === true || isHouseShapedEpoch(session.sealer.store, row)) continue;
      const commit = commits.find((item) => Number(item.epoch) === Number(row.epoch));
      if (!commit) legacy += 1;
      origin = earlier(origin, commitWaitStart(commit, row.hourStart));
    }
  }
  legacyUnreleased = legacy;
  if (origin == null) return '';
  const elapsed = now - origin;
  if (elapsed > stallHours(session.env) * 3600) return 'anchor_stalled';
  return '';
}

function finish(session, body) {
  let held = '';
  try {
    held = holdReason(session.dir) || '';
  } catch {
    held = 'anchor_hold_unreadable';
  }
  const spent = body && body.ok === false && body.reason === 'anchor_bump_spent' ? 'anchor_bump_spent' : '';
  const tempHold = body && body.ok === false && body.reason === 'anchor_hold_unreadable' ? 'anchor_hold_unreadable' : '';
  let stalled = '';
  try {
    stalled = intakeStall(session) || '';
  } catch {
    stalled = held || tempHold ? '' : 'sealer_unavailable';
  }
  const code = held || tempHold || spent || stalled;
  if (code) {
    report(session.log, code);
    setAnchorStall(code);
  } else {
    setAnchorStall(null);
  }
  return body;
}

/**
 * One scheduler pass. Never throws. A refusal is a bounded reason.
 * @param {object} session
 */
export async function runAnchorTick(session) {
  try {
    await session.broadcaster.prepare();
  } catch (err) {
    report(session.log, err && err.code);
    return finish(session, end(false, err && err.code));
  }
  try {
    if (hostileTemp(holdFile(session.dir))) {
      return finish(session, end(false, 'anchor_hold_unreadable'));
    }
    const heldNow = holdReason(session.dir);
    if (heldNow === 'anchor_nonce_retired') return finish(session, end(false, 'anchor_nonce_retired'));
    if (await acceptNonceClear(session)) return finish(session, end(false, 'anchor_nonce_retired'));
    const released = await releaseFinalized(session);
    if (released && released.held === true) return finish(session, end(false, released.reason || 'anchor_reverted'));
    if (released && released.reason) return finish(session, end(false, released.reason));
    const pending = pendingCommits(session.sealer);
    if (pending.length > 0) {
      const recovered = await withSealerGuard(({ signal }) => recover(session.sealer, {
        send: (wire) => session.send(wire, { signal }),
        signal,
      }), { env: session.env, log: (fields) => report(session.log, fields && fields.code) });
      const reason = recovered && recovered.ok === true ? null : (recovered && recovered.reason) || 'broadcast_failed';
      if (reason === 'anchor_nonce_conflict') {
        writeHold(session.dir, 'anchor_nonce_conflict');
        report(session.log, 'anchor_nonce_conflict');
        return finish(session, end(false, 'anchor_nonce_conflict'));
      }
      if (reason) report(session.log, reason);
      if (recovered && recovered.ok === true) {
        const again = await releaseFinalized(session);
        if (again && again.held === true) return finish(session, end(false, again.reason || 'anchor_reverted'));
        if (again && again.waiting === true) return finish(session, end(true, null));
      }
      return finish(session, end(recovered && recovered.ok === true, reason));
    }
    const bumped = await maybeBump(session);
    if (bumped) return finish(session, bumped);
    const intake = pendingIntakeCount(session.sealer.store);
    if (!intake.ok) {
      report(session.log, 'intake_unreadable');
      return finish(session, end(false, 'intake_unreadable'));
    }
    const plan = selectAnchorHour(
      session.sealer.state,
      session.sealer.clock(),
      intake.count,
      closeMarginSec(session.env),
    );
    if (plan.action !== 'close') return finish(session, end(true, plan.reason));
    const head = await session.broadcaster.chainHead();
    const wantEpoch = Number(session.sealer.state.anchorEpoch || 0);
    const wantHour = session.sealer.state.lastHourStart == null ? 0 : Number(session.sealer.state.lastHourStart);
    if (head.epoch !== wantEpoch || head.hourStart !== wantHour) {
      report(session.log, 'anchor_head_mismatch');
      return finish(session, end(false, 'anchor_head_mismatch'));
    }
    const quote = await session.broadcaster.quote();
    assertFeeCeiling(quote, session.signer.feeCeiling);
    const closed = await guardCloseHour(session.sealer, {
      hourStart: plan.hourStart,
      lines: [],
      fees: quote,
      send: session.send,
    }, {
      env: session.env,
      log: (fields) => report(session.log, fields && fields.code),
    });
    const reason = closed && closed.ok === true ? (plan.reason || null) : (closed && closed.reason) || 'broadcast_failed';
    if (reason === 'anchor_nonce_conflict') writeHold(session.dir, 'anchor_nonce_conflict');
    if (closed && closed.ok !== true) report(session.log, reason);
    return finish(session, end(closed && closed.ok === true, reason));
  } catch (err) {
    report(session.log, err && err.code, err && err.reason);
    return finish(session, end(false, allowed(err && err.code) ? err.code : 'sealer_unavailable'));
  }
}

function kick(session) {
  if (session.inflight) return session.inflight;
  session.inflight = runAnchorTick(session).finally(() => {
    session.inflight = null;
  });
  return session.inflight;
}

/**
 * Starts the interval only when the scheduler flag is on. Flags off return
 * before the directory, the signer, and the RPC client exist.
 * @param {object} [opts]
 */
export async function startV13AnchorScheduler(opts = {}) {
  const env = opts.env || {};
  if (anchorSchedulerEnabled(env) !== true) {
    return { started: false, async tick() { return { ok: true, skipped: true }; }, stop() {} };
  }
  const session = await openSession(opts);
  try {
    await session.broadcaster.prepare();
    if (typeof session.broadcaster.bootUnreachable === 'function' && session.broadcaster.bootUnreachable()) {
      report(session.log, 'anchor_rpc_unavailable');
    }
  } catch (err) {
    const code = err && err.code;
    if (code === 'anchor_chain_mismatch' || code === 'v13_pin_refused') throw bootRefused();
    report(session.log, code);
  }
  stopV13AnchorScheduler();
  const timer = setInterval(() => {
    kick(session).then(() => {}, () => {});
  }, ANCHOR_TICK_MS);
  if (typeof timer.unref === 'function') timer.unref();
  active = { timer, session, inflight: () => session.inflight };
  return {
    started: true,
    tick: () => kick(session),
    stop: stopV13AnchorScheduler,
  };
}

export async function stopV13AnchorScheduler() {
  const current = active;
  active = null;
  setAnchorStall(null);
  if (!current) return;
  if (current.timer) clearInterval(current.timer);
  const inflight = current.inflight && current.inflight();
  if (!inflight) return;
  await Promise.race([
    Promise.resolve(inflight).then(() => {}, () => {}),
    new Promise((resolve) => { setTimeout(resolve, STOP_WAIT_MS); }),
  ]);
}

export function anchorSchedulerTimerForTest() {
  return active ? active.timer : null;
}
