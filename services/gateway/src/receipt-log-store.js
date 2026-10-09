/**
 * Append-only receipt log on disk.
 *
 * The journal is the source of truth. Each record is one JSON line, fsynced.
 * The checkpoint and anchor state are atomic snapshots of that journal.
 * A bad read, a head whose root matches no prefix of the log, or a missing
 * journal while an anchor snapshot exists refuses the boot. There is no
 * silent empty tree. A stored head whose root is the root of a smaller
 * prefix (the publish/append race) is quarantined in memory. The journal
 * line stays. That head is not served.
 */
import fs from 'fs';
import path from 'path';
import logger from './logger.js';
import { getJwks, verifyJwsWithJwks } from './issuer-key.js';
import {
  EPOCH1_FINAL_ROOT,
  EPOCH2_GENESIS_DIGEST,
  EPOCH2_OPENING_ROOT,
  EPOCH2_OPENING_SIZE,
  epochLeafHash,
  epochRecordClaims,
  epochRootOf,
  genesisBytes,
  isSignedEpochV1,
} from './receipt-log-epoch.js';

export const JOURNAL_NAME = 'journal.jsonl';
export const CHECKPOINT_NAME = 'checkpoint.json';
export const ANCHOR_STATE_NAME = 'anchor-state.json';
export const EPOCH_RECORD_NAME = 'epoch-record.json';
export const BUNDLE_INDEX_NAME = 'bundle-index.json';

/** Exact env value required before a durable tree may mint a new genesis. */
export const FRESH_GENESIS_FLAG = 'YES_I_ACCEPT_A_NEW_PUBLIC_RECEIPT_LOG';

export class ReceiptLogRefused extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReceiptLogRefused';
    this.code = code;
  }
}

export function freshGenesisAllowed(env = process.env) {
  return env.RECEIPT_LOG_ACCEPT_FRESH_GENESIS === FRESH_GENESIS_FLAG;
}

export function receiptLogStrict(env = process.env) {
  return env.RECEIPT_LOG_STRICT !== 'false';
}

export function receiptLogBootRequested(env = process.env) {
  if (env.RECEIPT_LOG_BOOT === '0') return false;
  if (env.RECEIPT_LOG_DIR) return true;
  return env.RECEIPT_LOG_BOOT === '1';
}

function fsyncDir(dir) {
  const fd = fs.openSync(dir, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

export function atomicWrite(file, body) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, body);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  fsyncDir(dir);
}

export function appendJournal(dir, record) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, JOURNAL_NAME);
  const fd = fs.openSync(file, 'a');
  try {
    fs.writeSync(fd, `${JSON.stringify(record)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fsyncDir(dir);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function anchoredStatePresent(state) {
  if (!state || typeof state !== 'object') return false;
  const solana = state.solana || {};
  const base = state.base || {};
  for (const row of Object.values(solana)) {
    if (row?.signature || row?.status === 'anchored') return true;
  }
  for (const row of Object.values(base)) {
    if (row?.tx || row?.status === 'anchored') return true;
  }
  return false;
}

function emptyAnchorState() {
  return { schema: 'chit402.receipt_anchor_state.v1', solana: {}, base: {} };
}

function hexOf(buf) {
  return Buffer.from(buf).toString('hex');
}

function newEpochBucket(epoch, prevEpochRoot, prevEpochSize) {
  return {
    epoch,
    prevEpochRoot: prevEpochRoot || null,
    prevEpochSize: Number(prevEpochSize) || 0,
    status: 'open',
    preimages: [],
    leaves: [],
    meta: [],
    byTask: new Map(),
    heads: [],
    quarantinedHeads: [],
  };
}

function finishEpoch(bucket) {
  const root = bucket.leaves.length ? hexOf(epochRootOf(bucket.leaves)) : null;
  return {
    epoch: bucket.epoch,
    status: bucket.status,
    prevEpochRoot: bucket.prevEpochRoot,
    prevEpochSize: bucket.prevEpochSize,
    root,
    tree_size: bucket.leaves.length,
    preimages: bucket.preimages,
    leaves: bucket.leaves,
    meta: bucket.meta,
    heads: bucket.heads,
    quarantinedHeads: bucket.quarantinedHeads || [],
  };
}

function pushLeaf(bucket, row) {
  if (!row.preimage_b64) {
    throw new ReceiptLogRefused('missing_preimage', `journal leaf ${row.index} has no preimage bytes`);
  }
  const body = Buffer.from(row.preimage_b64, 'base64');
  const hash = epochLeafHash(body);
  const index = bucket.leaves.length;
  if (row.index != null && Number(row.index) !== index) {
    throw new ReceiptLogRefused('leaf_index', `journal leaf index ${row.index} does not follow ${index}`);
  }
  if (row.leaf && String(row.leaf) !== hash.toString('hex')) {
    throw new ReceiptLogRefused('leaf_hash', `stored leaf hash does not match preimage at ${index}`);
  }
  bucket.leaves.push(hash);
  bucket.preimages.push(body);
  const meta = {
    task_id: row.task_id,
    index,
    kind: row.kind || (row.task_id === 'genesis' ? 'genesis' : 'receipt'),
    leaf: hash.toString('hex'),
    preimage_b64: body.toString('base64'),
    epoch: bucket.epoch,
  };
  bucket.meta.push(meta);
  if (row.task_id) bucket.byTask.set(String(row.task_id), index);
}

function prefixRootHex(leaves, size) {
  if (size === 0) return hexOf(epochRootOf([]));
  return hexOf(epochRootOf(leaves.slice(0, size)));
}

/**
 * A present JWS must verify, and the signed root and size must be the head's.
 * Unsigned historical heads have no JWS and are not this case.
 */
const TREE_HEAD_JWT_TYP = 'chit402-tree-head+jwt';
const ROTATED_KEY_REASONS = new Set(['no_matching_key', 'empty_jwks']);

/**
 * Keys a stored raced head may be signed by: the live key plus earlier keys
 * the operator lists in ISSUER_HISTORY_EXTRA (revoked keys excluded), so an
 * issuer key rotation does not turn an old quarantined head into a refusal.
 */
function storedHeadJwks() {
  const keys = [...(getJwks()?.keys || [])];
  const raw = process.env.ISSUER_HISTORY_EXTRA;
  if (raw && String(raw).trim()) {
    try {
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : parsed?.entries;
      for (const entry of Array.isArray(list) ? list : []) {
        if (!entry || typeof entry.kid !== 'string' || !entry.jwk || entry.status === 'revoked') continue;
        if (keys.some((k) => k.kid === entry.kid)) continue;
        keys.push({ ...entry.jwk, kid: entry.kid, alg: entry.jwk.alg || 'ES256' });
      }
    } catch {
      // Unparsable history extra: live key only.
    }
  }
  return { keys };
}

function storedHeadSignature(head) {
  const jws = head?.issuer_signature?.jws;
  if (typeof jws !== 'string' || jws.length === 0) return { present: false, valid: false };
  let header = null;
  try {
    header = JSON.parse(Buffer.from(jws.split('.')[0], 'base64url').toString('utf8'));
  } catch {
    return { present: true, valid: false, reason: 'header_parse_error' };
  }
  if (header?.typ !== TREE_HEAD_JWT_TYP) return { present: true, valid: false, reason: 'wrong_typ' };
  const result = verifyJwsWithJwks(jws, storedHeadJwks());
  if (!result.valid) return { present: true, valid: false, reason: result.reason || 'signature_invalid' };
  const payload = result.payload || {};
  if (String(payload.root) !== String(head.root) || Number(payload.tree_size) !== Number(head.tree_size)) {
    return { present: true, valid: false, reason: 'head_mismatch' };
  }
  return { present: true, valid: true };
}

function refuseTamperedHead(reason) {
  throw new ReceiptLogRefused(
    'head_signature',
    `stored head signature refused (${reason || 'invalid'})`,
  );
}

/**
 * Keep a head whose root is the prefix of `tree_size`. Quarantine a signed
 * head whose root is a smaller prefix of that same log (publish/append race).
 * A root that matches no prefix still refuses. A tampered signature refuses.
 * @returns {{ quarantine: boolean, prefixSize?: number }}
 */
function classifyStoredHead(bucket, head) {
  if (!head || head.root == null || head.tree_size == null) return { quarantine: false };
  const size = Number(head.tree_size);
  if (!Number.isInteger(size) || size < 0 || size > bucket.leaves.length) {
    throw new ReceiptLogRefused('head_size', `stored head tree_size ${head.tree_size} is outside the log`);
  }
  const stored = String(head.root).replace(/^0x/, '');
  const claimed = prefixRootHex(bucket.leaves, size);
  const signature = storedHeadSignature(head);
  if (stored === claimed) {
    // A known key with a bad signature is tampering. A kid no longer in the
    // key set (issuer key rotation) loads as on main; verifiers still check it.
    if (signature.present && !signature.valid && !ROTATED_KEY_REASONS.has(signature.reason)) {
      refuseTamperedHead(signature.reason);
    }
    return { quarantine: false };
  }
  let prefixSize = null;
  for (let k = size - 1; k >= 1; k -= 1) {
    if (prefixRootHex(bucket.leaves, k) === stored) {
      prefixSize = k;
      break;
    }
  }
  if (prefixSize == null) {
    throw new ReceiptLogRefused(
      'root_mismatch',
      `recomputed root ${claimed} does not match stored head ${head.root} at size ${size}`,
    );
  }
  // The race head is issuer-signed. An unsigned or tampered mismatch is not it.
  if (!signature.present) {
    throw new ReceiptLogRefused(
      'root_mismatch',
      `recomputed root ${claimed} does not match stored head ${head.root} at size ${size}`,
    );
  }
  if (!signature.valid) refuseTamperedHead(signature.reason);
  return { quarantine: true, prefixSize };
}

/**
 * Replay the journal. Throws ReceiptLogRefused on a bad file, a tampered
 * head signature, or a root that matches no prefix. A raced head (root of a
 * smaller prefix) is returned on the epoch as `quarantinedHeads` and is not
 * placed in `heads`. An empty directory is `{ empty: true }`.
 */
export function readReceiptLog(dir, { strict = true, allowFresh = false } = {}) {
  const journalPath = path.join(dir, JOURNAL_NAME);
  const checkpointPath = path.join(dir, CHECKPOINT_NAME);
  const anchorPath = path.join(dir, ANCHOR_STATE_NAME);
  const epochPath = path.join(dir, EPOCH_RECORD_NAME);
  const bundlePath = path.join(dir, BUNDLE_INDEX_NAME);

  let journalExists = false;
  try {
    journalExists = fs.statSync(journalPath).isFile();
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw new ReceiptLogRefused('load_failed', `receipt log journal unreadable: ${err.message}`);
    }
  }

  let anchorState = null;
  if (fs.existsSync(anchorPath)) {
    try {
      anchorState = readJson(anchorPath);
    } catch (err) {
      throw new ReceiptLogRefused('corrupt_anchor_state', `anchor state does not parse: ${err.message}`);
    }
  }

  if (!journalExists) {
    const anchored = anchoredStatePresent(anchorState);
    if (anchored && strict && !allowFresh) {
      throw new ReceiptLogRefused(
        'missing_log',
        'receipt log journal is missing while anchored heads exist on disk',
      );
    }
    if (anchored && !strict) {
      return { empty: true, anchorState, missingWhileAnchored: true };
    }
    if (fs.existsSync(checkpointPath) || fs.existsSync(epochPath)) {
      throw new ReceiptLogRefused(
        'missing_log',
        'receipt log checkpoint or epoch record exists without a journal',
      );
    }
    return { empty: true, anchorState: anchorState || emptyAnchorState() };
  }

  let text;
  try {
    text = fs.readFileSync(journalPath, 'utf8');
  } catch (err) {
    throw new ReceiptLogRefused('load_failed', `receipt log journal unreadable: ${err.message}`);
  }

  const epochs = [];
  let current = null;
  let foldedAnchors = emptyAnchorState();
  let epochRecord = null;
  let epochRecordV1 = null;
  let bundleIndex = null;
  const intents = [];

  const lines = text.split('\n');
  for (let lineNo = 0; lineNo < lines.length; lineNo += 1) {
    const line = lines[lineNo];
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch (err) {
      throw new ReceiptLogRefused('corrupt_journal', `journal line ${lineNo + 1} does not parse: ${err.message}`);
    }
    if (row.op === 'epoch_open') {
      if (current && current.status === 'open') {
        current.status = 'closed';
        epochs.push(finishEpoch(current));
      }
      current = newEpochBucket(Number(row.epoch), row.prev_epoch_root, row.prev_epoch_size);
    } else if (row.op === 'leaf') {
      if (!current) current = newEpochBucket(Number(row.epoch) || 1, null, 0);
      try {
        pushLeaf(current, row);
      } catch (err) {
        if (err instanceof ReceiptLogRefused) throw err;
        throw new ReceiptLogRefused('load_failed', err.message);
      }
    } else if (row.op === 'head') {
      if (!current) throw new ReceiptLogRefused('head_without_epoch', 'journal head has no open epoch');
      if (!row.head || typeof row.head !== 'object') {
        throw new ReceiptLogRefused('bad_head', 'journal head record is empty');
      }
      const verdict = classifyStoredHead(current, row.head);
      if (verdict.quarantine) {
        const record = {
          epoch: current.epoch,
          tree_size: Number(row.head.tree_size),
          prefix_size: verdict.prefixSize,
          root: String(row.head.root).replace(/^0x/, ''),
        };
        current.quarantinedHeads.push(record);
        logger.error(
          record,
          'RECEIPT LOG QUARANTINE: raced head root matches a smaller prefix; excluded from inclusion and head serving',
        );
      } else {
        current.heads.push(row.head);
      }
      foldAnchor(foldedAnchors, row.head);
    } else if (row.op === 'epoch_close') {
      if (!current) throw new ReceiptLogRefused('epoch_close', 'journal closed an epoch that was not open');
      current.status = 'closed';
      const done = finishEpoch(current);
      if (row.final_root && done.root !== row.final_root) {
        throw new ReceiptLogRefused(
          'root_mismatch',
          `epoch ${done.epoch} recomputed ${done.root} does not match stored final root ${row.final_root}`,
        );
      }
      if (row.final_size != null && Number(row.final_size) !== done.tree_size) {
        throw new ReceiptLogRefused('head_size', `epoch ${done.epoch} size does not match the close record`);
      }
      epochs.push(done);
      current = null;
    } else if (row.op === 'anchor') {
      foldAnchorRecord(foldedAnchors, row);
    } else if (row.op === 'anchor_intent') {
      intents.push(row);
    } else if (row.op === 'epoch_record') {
      epochRecord = row.record || null;
      if (isSignedEpochV1(epochRecord)) epochRecordV1 = epochRecord;
    } else if (row.op === 'bundle_index') {
      bundleIndex = row.index || null;
    } else {
      throw new ReceiptLogRefused('bad_op', `journal line ${lineNo + 1} has unknown op ${row.op}`);
    }
  }
  if (current) epochs.push(finishEpoch(current));
  if (epochs.length === 0) {
    throw new ReceiptLogRefused('empty_journal', 'receipt log journal has no epoch');
  }

  const open = epochs[epochs.length - 1];
  if (open.status === 'closed' && epochs.length > 0) {
    // A closed final epoch is still the log tip until a later epoch opens.
  }

  if (fs.existsSync(checkpointPath)) {
    let checkpoint;
    try {
      checkpoint = readJson(checkpointPath);
    } catch (err) {
      throw new ReceiptLogRefused('corrupt_checkpoint', `checkpoint does not parse: ${err.message}`);
    }
    const recorded = Array.isArray(checkpoint.epochs) ? checkpoint.epochs : [];
    if (recorded.length > epochs.length) {
      throw new ReceiptLogRefused('checkpoint_ahead', 'checkpoint lists more epochs than the journal');
    }
    for (let i = 0; i < recorded.length; i += 1) {
      const want = recorded[i];
      const got = epochs[i];
      if (Number(want.tree_size) > got.tree_size) {
        throw new ReceiptLogRefused('checkpoint_ahead', `checkpoint epoch ${got.epoch} is ahead of the journal`);
      }
      if (Number(want.tree_size) === got.tree_size && want.root && want.root !== got.root) {
        throw new ReceiptLogRefused(
          'root_mismatch',
          `checkpoint root ${want.root} does not match recomputed ${got.root}`,
        );
      }
    }
  }

  if (anchorState && anchoredStatePresent(anchorState)) {
    for (const [key, row] of Object.entries(anchorState.solana || {})) {
      const folded = foldedAnchors.solana[key];
      if (row?.signature && (!folded || folded.signature !== row.signature)) {
        if (strict && !folded) {
          throw new ReceiptLogRefused(
            'missing_log',
            `anchor state records Solana day ${key} but the journal has no matching anchor`,
          );
        }
      }
    }
  }

  if (!epochRecord && fs.existsSync(epochPath)) {
    try {
      epochRecord = readJson(epochPath);
    } catch (err) {
      throw new ReceiptLogRefused('corrupt_epoch_record', `epoch record does not parse: ${err.message}`);
    }
  }
  if (!epochRecordV1 && isSignedEpochV1(epochRecord)) epochRecordV1 = epochRecord;
  if (!bundleIndex && fs.existsSync(bundlePath)) {
    try {
      bundleIndex = readJson(bundlePath);
    } catch (err) {
      throw new ReceiptLogRefused('corrupt_bundle_index', `bundle index does not parse: ${err.message}`);
    }
  }

  return {
    empty: false,
    epochs,
    anchorState: mergeAnchor(foldedAnchors, anchorState),
    epochRecord,
    epochRecordV1,
    bundleIndex,
    intents,
  };
}

function foldAnchor(state, head) {
  const sol = head?.anchors?.solana;
  const day = String(head?.published_at || '').slice(0, 10);
  const scope = 'global';
  if (sol?.status === 'anchored' && sol.signature && day) {
    const key = `${scope}|${day}`;
    if (!state.solana[key]) {
      state.solana[key] = {
        status: sol.status,
        signature: sol.signature,
        slot: sol.slot ?? null,
        cluster: sol.cluster || null,
        memo: sol.memo || null,
        root: head.root,
        prev: head.prev_root || null,
        day,
        scope,
      };
    }
  }
  const base = head?.anchors?.base || head?.anchor;
  if (base?.status === 'anchored' && base.tx && head.root) {
    if (!state.base[head.root]) {
      state.base[head.root] = {
        status: base.status,
        tx: base.tx,
        calldata: base.calldata || null,
        from: base.from || head.anchor_from || null,
        chain_id: base.chain_id || 8453,
      };
    }
  }
}

function foldAnchorRecord(state, row) {
  if (row.solana?.signature && row.day) {
    const scope = row.scope || 'global';
    const key = `${scope}|${row.day}`;
    if (!state.solana[key]) state.solana[key] = { ...row.solana, day: row.day, scope, root: row.root, prev: row.prev };
  }
  if (row.base?.tx && row.root && !state.base[row.root]) {
    state.base[row.root] = row.base;
  }
}

function sameAnchorTx(left, right) {
  const a = String(left || '').toLowerCase();
  const b = String(right || '').toLowerCase();
  return Boolean(a) && a === b;
}

/**
 * Journal wins on the same key. A file row that already recorded
 * `receipt_confirmed` for that same tx keeps the flag and `block_ts`.
 * A different tx stays with the journal, which fails the upgrade closed.
 */
function mergeBaseRow(file, folded) {
  if (!folded) return file || null;
  if (!file || file.receipt_confirmed !== true) return folded;
  if (folded.tx && file.tx && !sameAnchorTx(file.tx, folded.tx)) return folded;
  return {
    ...file,
    ...folded,
    status: file.status === 'anchored' ? 'anchored' : (folded.status || file.status),
    tx: folded.tx || file.tx,
    from: folded.from || file.from || null,
    nonce: folded.nonce ?? file.nonce ?? null,
    chain_id: folded.chain_id ?? file.chain_id ?? null,
    receipt_confirmed: true,
    block_ts: folded.block_ts ?? file.block_ts ?? null,
  };
}

function mergeAnchor(folded, fileState) {
  const out = emptyAnchorState();
  out.solana = { ...(fileState?.solana || {}), ...folded.solana };
  out.base = { ...(fileState?.base || {}) };
  for (const [key, row] of Object.entries(folded.solana)) out.solana[key] = row;
  for (const [key, row] of Object.entries(folded.base || {})) {
    out.base[key] = mergeBaseRow(fileState?.base?.[key], row);
  }
  return out;
}

export function checkpointBody(epochs) {
  return `${JSON.stringify({
    schema: 'chit402.receipt_log_checkpoint.v1',
    epochs: epochs.map((row) => ({
      epoch: row.epoch,
      status: row.status,
      tree_size: row.tree_size,
      root: row.root,
      prev_epoch_root: row.prevEpochRoot || null,
      prev_epoch_size: row.prevEpochSize || 0,
    })),
  })}\n`;
}

export function writeCheckpoint(dir, epochs) {
  atomicWrite(path.join(dir, CHECKPOINT_NAME), checkpointBody(epochs));
}

export function writeAnchorState(dir, state) {
  atomicWrite(path.join(dir, ANCHOR_STATE_NAME), `${JSON.stringify(state)}\n`);
}

export function writeEpochRecordFile(dir, record) {
  atomicWrite(path.join(dir, EPOCH_RECORD_NAME), `${JSON.stringify(record)}\n`);
}

/**
 * Append a later epoch record. Earlier journal lines stay, including a
 * payload version 1 record. The file copy is the latest record.
 */
export function appendSignedEpochRecord(dir, record) {
  appendJournal(dir, { v: 1, op: 'epoch_record', record });
  writeEpochRecordFile(dir, record);
  return record;
}

export function writeBundleIndexFile(dir, index) {
  atomicWrite(path.join(dir, BUNDLE_INDEX_NAME), `${JSON.stringify(index)}\n`);
}

/**
 * Write a restored epoch-1 log. When the rebuilt root is the historical
 * dd20e39a root, also open epoch 2 at f2043ee9 and record the orphans.
 * Refuses to replace a journal that is already there.
 */
export function writeRestoredEpochs(dir, rebuilt, { signRecord, epochClaims } = {}) {
  const journalPath = path.join(dir, JOURNAL_NAME);
  if (fs.existsSync(journalPath)) {
    throw new ReceiptLogRefused('log_exists', 'receipt log journal already exists; refusing to overwrite it');
  }
  fs.mkdirSync(dir, { recursive: true });
  const real = rebuilt.root === EPOCH1_FINAL_ROOT;
  appendJournal(dir, {
    v: 1,
    op: 'epoch_open',
    epoch: 1,
    prev_epoch_root: null,
    prev_epoch_size: 0,
  });
  rebuilt.preimages.forEach((body, index) => {
    const taskId = index === 0 ? 'genesis' : String(rebuilt.rows[index - 1].task_id);
    appendJournal(dir, {
      v: 1,
      op: 'leaf',
      epoch: 1,
      index,
      task_id: taskId,
      kind: index === 0 ? 'genesis' : 'receipt',
      preimage_b64: Buffer.from(body).toString('base64'),
    });
  });
  appendJournal(dir, {
    v: 1,
    op: 'head',
    epoch: 1,
    head: {
      schema: 'chit402.tree_head.v2',
      payload_version: 2,
      historical: true,
      signed: false,
      epoch: 1,
      tree_size: rebuilt.tree_size,
      root: rebuilt.root,
      prev_epoch_root: null,
      prev_epoch_size: 0,
      prev_root: '0'.repeat(64),
      note: 'Observed final root of epoch 1. The original head was not re-signed.',
    },
  });
  appendJournal(dir, {
    v: 1,
    op: 'epoch_close',
    epoch: 1,
    final_root: rebuilt.root,
    final_size: rebuilt.tree_size,
  });
  if (real) {
    const genesis = genesisBytes(EPOCH2_GENESIS_DIGEST);
    const opening = epochLeafHash(genesis).toString('hex');
    if (opening !== EPOCH2_OPENING_ROOT) {
      throw new ReceiptLogRefused('epoch2_opening', `epoch 2 genesis hashed to ${opening}`);
    }
    appendJournal(dir, {
      v: 1,
      op: 'epoch_open',
      epoch: 2,
      prev_epoch_root: rebuilt.root,
      prev_epoch_size: rebuilt.tree_size,
    });
    appendJournal(dir, {
      v: 1,
      op: 'leaf',
      epoch: 2,
      index: 0,
      task_id: 'genesis',
      kind: 'genesis',
      preimage_b64: genesis.toString('base64'),
    });
    appendJournal(dir, {
      v: 1,
      op: 'head',
      epoch: 2,
      head: {
        schema: 'chit402.tree_head.v2',
        payload_version: 2,
        historical: true,
        signed: false,
        epoch: 2,
        tree_size: EPOCH2_OPENING_SIZE,
        root: EPOCH2_OPENING_ROOT,
        prev_epoch_root: EPOCH1_FINAL_ROOT,
        prev_epoch_size: rebuilt.tree_size,
        prev_root: '0'.repeat(64),
        note: 'Observed Oct 5 head. Its on-chain memo prev is zeros. Not re-signed. Epoch 2 links to epoch 1 through prev_epoch_root.',
      },
    });
  }
  const claims = epochClaims || epochRecordClaims({
    epoch1Root: rebuilt.root,
    epoch1Size: rebuilt.tree_size,
    epoch2Root: real ? EPOCH2_OPENING_ROOT : null,
    epoch2Size: real ? EPOCH2_OPENING_SIZE : 0,
  });
  if (!real) {
    claims.epochs = [{
      ...claims.epochs[0],
      final_root: rebuilt.root,
      final_size: rebuilt.tree_size,
    }];
    claims.orphans = [];
  }
  const record = typeof signRecord === 'function' ? signRecord(claims) : claims;
  appendJournal(dir, { v: 1, op: 'epoch_record', record });
  writeEpochRecordFile(dir, record);
  return record;
}
