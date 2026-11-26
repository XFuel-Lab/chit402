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
import { guardCloseHour } from '../../chit-sealer/guard.js';
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
import { committedReceiptForLine, noteAnchored } from '../../chit-store/store.js';
import logger from './logger.js';
import { testSwitchesOn } from './test-switch.js';
import { mainnetSealerEnabled, readClosedFlag, storeEnabled } from './v13-flags.js';

export const ANCHOR_SCHEDULER_FLAG = 'CHIT_V13_ANCHOR_SCHEDULER';
export const ANCHOR_TICK_MS = 60_000;

const HOUR = 3600;
const STUCK_DEFAULT_MS = 120_000;
const SEALER_FILES = ['sealer-state.json', 'anchor-intents.jsonl'];

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
]);

let active = null;

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
 */
export function selectAnchorHour(state, now, intakeCount) {
  if (!Number.isSafeInteger(intakeCount) || intakeCount <= 0) {
    return { action: 'skip', reason: 'empty_hour' };
  }
  const lastComplete = finishedHour(now);
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
  const send = async (wire, sendOpts = {}) => broadcaster.sendRaw(wire, sendOpts && sendOpts.signal);
  return {
    env,
    log: deps.log,
    signer,
    sealer,
    broadcaster,
    send,
    stuckMs: stuckAfterMs(env),
  };
}

async function releaseFinalized(session) {
  let admitted;
  try {
    admitted = await session.broadcaster.finalizedAnchored();
  } catch (err) {
    report(session.log, err && err.code);
    return;
  }
  const rows = Array.isArray(admitted) ? admitted : [];
  for (let i = 0; i < rows.length; i += 1) {
    const item = rows[i];
    if (!item || item.finalized !== true) continue;
    try {
      noteAnchored(session.sealer.store, {
        epoch: item.epoch,
        hourStart: item.hourStart,
        size: item.size,
        root: item.root,
        stateRoot: item.stateRoot,
        finalized: true,
        chainId: Number(MAINNET_CHAIN_ID),
        contract: MAINNET_ANCHOR,
        from: item.from,
      });
    } catch {
      report(session.log, 'sealer_unavailable');
    }
  }
}

async function maybeBump(session) {
  const commits = session.sealer.state.commits.filter((row) => row.broadcast === true);
  if (commits.length === 0) return null;
  let rows;
  try {
    rows = session.sealer.intentLog.read();
  } catch {
    report(session.log, 'sealer_unavailable');
    return end(false, 'sealer_unavailable');
  }
  const now = Date.now();
  for (let i = commits.length - 1; i >= 0; i -= 1) {
    const commit = commits[i];
    const broadcast = [...rows].reverse().find((row) => (
      row && row.nonce === String(commit.nonce) && row.status === 'broadcast' && typeof row.tx === 'string'
    ));
    if (!broadcast) continue;
    const at = Date.parse(broadcast.at);
    if (!Number.isFinite(at) || now - at < session.stuckMs) continue;
    let receipt;
    try {
      receipt = await session.broadcaster.receipt(broadcast.tx);
    } catch (err) {
      report(session.log, err && err.code);
      return end(false, 'anchor_rpc_unavailable');
    }
    if (receipt) continue;
    try {
      const quote = bumpFeeQuote(commit.fees, session.signer.feeCeiling);
      assertFeeCeiling({
        gasLimit: quote.gasLimit.toString(),
        maxFeePerGas: quote.maxFeePerGas.toString(),
        maxPriorityFeePerGas: quote.maxPriorityFeePerGas.toString(),
      }, session.signer.feeCeiling);
    } catch {
      report(session.log, 'fee_ceiling');
      return end(false, 'fee_ceiling');
    }
    const bumped = await feeBump(session.sealer, { nonce: commit.nonce, send: session.send });
    const reason = bumped && bumped.ok === true ? null : (bumped && bumped.reason) || 'broadcast_failed';
    if (reason) report(session.log, reason);
    return end(bumped && bumped.ok === true, reason);
  }
  return null;
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
    return end(false, err && err.code);
  }
  try {
    await releaseFinalized(session);
    const pending = pendingCommits(session.sealer);
    if (pending.length > 0) {
      const recovered = await recover(session.sealer, { send: session.send });
      const reason = recovered && recovered.ok === true ? null : (recovered && recovered.reason) || 'broadcast_failed';
      if (reason) report(session.log, reason);
      return end(recovered && recovered.ok === true, reason);
    }
    const bumped = await maybeBump(session);
    if (bumped) return bumped;
    const intake = pendingIntakeCount(session.sealer.store);
    if (!intake.ok) {
      report(session.log, 'intake_unreadable');
      return end(false, 'intake_unreadable');
    }
    const plan = selectAnchorHour(session.sealer.state, session.sealer.clock(), intake.count);
    if (plan.action !== 'close') return end(true, plan.reason);
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
    if (closed && closed.ok !== true) report(session.log, reason);
    return end(closed && closed.ok === true, reason);
  } catch (err) {
    report(session.log, err && err.code, err && err.reason);
    return end(false, allowed(err && err.code) ? err.code : 'sealer_unavailable');
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
  stopV13AnchorScheduler();
  const timer = setInterval(() => {
    kick(session).then(() => {}, () => {});
  }, ANCHOR_TICK_MS);
  if (typeof timer.unref === 'function') timer.unref();
  active = { timer, session };
  return {
    started: true,
    tick: () => kick(session),
    stop: stopV13AnchorScheduler,
  };
}

export function stopV13AnchorScheduler() {
  const current = active;
  active = null;
  if (current && current.timer) clearInterval(current.timer);
}

export function anchorSchedulerTimerForTest() {
  return active ? active.timer : null;
}
