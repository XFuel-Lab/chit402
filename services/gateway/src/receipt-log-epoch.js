/**
 * Epochs of the public receipt log.
 *
 * Epoch 1 is the historical log whose final root is dd20e39a (4 leaves,
 * genesis digest 422cceb1 from the #468 verifier). Epoch 2 opens at the
 * Oct 5 genesis-only root f2043ee9 and records the link back to epoch 1.
 * Earlier Base anchors that are not prefixes of epoch 1 are orphans.
 * Nothing here broadcasts a transaction or re-signs a receipt.
 */
import crypto from 'crypto';

export const EPOCH_RECORD_SCHEMA = 'chit402.tree_epoch.v1';
/** Roots and orphans only. Still valid. Kept in the journal when version 2 is appended. */
export const EPOCH_RECORD_VERSION = 1;
/** Version 2 adds the signed unlogged list. Epochs and orphans stay the version 1 bytes. */
export const EPOCH_RECORD_VERSION_UNLOGGED = 2;
export const EPOCH_RECORD_JWT_TYP = 'chit402-tree-epoch+jwt';
export const UNLOGGED_REASONS = Object.freeze(['missing_row_hash', 'forked', 'depends_on_refused']);

export const EPOCH1_GENESIS_DIGEST = '422cceb1be77114317043b0a00bc18cba6ca9cee34144cd23875c6dcf1b47368';
export const EPOCH1_FINAL_ROOT = 'dd20e39a39a225b7b3441bb7f61532c06562288b74ae5dc4dda015c48312f973';
export const EPOCH1_FINAL_SIZE = 4;
/** SHA-256(0x00 || genesis bytes of digest 422cceb1). Single-leaf root. */
export const EPOCH1_SIZE1_ROOT = '8665a0fcb74c2cfeca3a356efe18fe878cf94c21cd38da6b19a2bb57629bc35c';
/** Anchored size-2 head. The v9 tree_head_hash on xfuel-39af100b. */
export const EPOCH1_SIZE2_ROOT = 'ecf9a330a9e82d45e0887807261276fad2fbfb394189bb8f7f35b0e9163c70ae';

const EPOCH1_PREFIX_ROOTS = Object.freeze({
  1: EPOCH1_SIZE1_ROOT,
  2: EPOCH1_SIZE2_ROOT,
  4: EPOCH1_FINAL_ROOT,
});

/** Size 3 is not pinned. The leaf preimages are not in this repo. */
export function epoch1PrefixRoot(treeSize) {
  return EPOCH1_PREFIX_ROOTS[Number(treeSize)] || null;
}

export function matchEpoch1Prefix(treeSize, root) {
  const want = epoch1PrefixRoot(treeSize);
  const got = String(root || '').replace(/^0x/, '').toLowerCase();
  if (!want || got !== want) return { ok: false, reason: 'epoch1_prefix' };
  return { ok: true };
}
export const EPOCH1_ANCHOR_TASK = 'xfuel-39af100b-23dd-4d86-a16b-4556ca6796af';

export const EPOCH2_GENESIS_DIGEST = '847edd6698d938721c0c59466a601d65cb82c1fdc0abd80104e1132f0cbaa576';
export const EPOCH2_OPENING_ROOT = 'f2043ee96b6e9f678b76bb3c512b5d911293dbb2a3bf198c98252c83802f3286';
export const EPOCH2_OPENING_SIZE = 1;

/**
 * Roots that are on Base and are not a prefix of epoch 1.
 * d7f6c548 is stored as a prefix: the leaves were not recovered, and the
 * remaining bytes are not invented.
 */
export const ORPHANED_ROOTS = Object.freeze([
  {
    root: '20d887917a4c32a49434e4b8f8db864cbf26a8e3a0daa6f5f89ab097282413f9',
    kind: 'genesis_only',
    verifier_binary_build_digest: '207e981d0c50dfe0294ab085893e88a930f1b664b4dfec221f82afd666831145',
    chain: 'base',
    window: '2026-09-30 to 2026-10-01',
    times_anchored: 5,
    note: 'The same genesis-only root was anchored five times after process restarts (Sep 30 twice, Oct 1 three times). It is not a prefix of epoch 1.',
  },
  {
    root: null,
    root_prefix: 'd7f6c548',
    recovered: false,
    unrecoverable: true,
    kind: 'populated_lost',
    chain: 'base',
    observed_et: '2026-10-01 8:01 AM ET',
    note: 'A populated tree was anchored on Base and lost on the next restart. The full root is that transaction calldata. The leaves were not recovered, so this record keeps the prefix and does not invent the remaining bytes.',
  },
  {
    root: EPOCH2_OPENING_ROOT,
    kind: 'genesis_only',
    verifier_binary_build_digest: EPOCH2_GENESIS_DIGEST,
    chain: 'base_and_solana',
    observed_at: '2026-10-05T11:22:55.242Z',
    note: 'Anchored after the Oct 5 restart. The Solana memo prev root is 64 zero bytes. This root is also the opening leaf of epoch 2. The link to epoch 1 is prev_epoch_root, not that memo prev.',
  },
]);

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest();
}

export function epochLeafHash(bytes) {
  return sha256(Buffer.concat([Buffer.from([0x00]), Buffer.from(bytes)]));
}

export function epochNodeHash(left, right) {
  return sha256(Buffer.concat([Buffer.from([0x01]), left, right]));
}

export function epochRootOf(leaves) {
  if (!leaves.length) return sha256(Buffer.from([0x00]));
  let level = leaves.map((h) => Buffer.from(h));
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 === level.length) next.push(level[i]);
      else next.push(epochNodeHash(level[i], level[i + 1]));
    }
    level = next;
  }
  return level[0];
}

/** Exact genesis leaf body. Key order matches the gateway tree. */
export function genesisBytes(digest) {
  return Buffer.from(JSON.stringify({
    schema: 'chit402.tree_genesis.v1',
    payload_version: 1,
    verifier_binary_build_digest: String(digest),
  }));
}

export function receiptLeafBytes(taskId, rowHash) {
  return Buffer.from(`${taskId}|${rowHash || ''}`);
}

/**
 * Rebuild epoch 1 from book rows in file order.
 * Leaf 0 is the pinned genesis. Leaf 1 is the anchor task. The next two
 * rows that carry a task_id are leaves 2 and 3. Refuses unless the root
 * equals expectRoot (dd20e39a in production).
 * @param {object[]} rows
 */
export function rebuildEpoch1FromRows(rows, {
  genesisDigest = EPOCH1_GENESIS_DIGEST,
  expectRoot = EPOCH1_FINAL_ROOT,
  anchorTaskId = EPOCH1_ANCHOR_TASK,
  receiptCount = 3,
} = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const start = list.findIndex((row) => String(row?.task_id || '') === anchorTaskId);
  if (start < 0) {
    const err = new Error(`epoch1_anchor_row_missing: ${anchorTaskId}`);
    err.code = 'epoch1_anchor_row_missing';
    throw err;
  }
  const chosen = [];
  const seen = new Set();
  for (let i = start; i < list.length && chosen.length < receiptCount; i += 1) {
    const row = list[i];
    const taskId = row?.task_id ? String(row.task_id) : '';
    if (!taskId || seen.has(taskId)) continue;
    seen.add(taskId);
    chosen.push(row);
  }
  if (chosen.length !== receiptCount) {
    const err = new Error(`epoch1_row_count: need ${receiptCount} receipt rows, found ${chosen.length}`);
    err.code = 'epoch1_row_count';
    throw err;
  }
  const preimages = [
    genesisBytes(genesisDigest),
    ...chosen.map((row) => receiptLeafBytes(row.task_id, row.row_hash || '')),
  ];
  const hashes = preimages.map((body) => epochLeafHash(body));
  const root = epochRootOf(hashes).toString('hex');
  if (root !== String(expectRoot)) {
    const err = new Error(`epoch1_root_mismatch: got ${root} want ${expectRoot}`);
    err.code = 'epoch1_root_mismatch';
    err.root = root;
    err.want = String(expectRoot);
    throw err;
  }
  return {
    epoch: 1,
    genesis_digest: genesisDigest,
    root,
    tree_size: preimages.length,
    preimages,
    leaves: hashes,
    rows: chosen,
  };
}

/**
 * Canonical unlogged rows. Key order is task_id, agent_id, reason.
 * The hash is SHA-256 of JSON.stringify(this array). No row_hash is derived.
 */
export function canonicalUnloggedRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    task_id: String(row?.task_id || ''),
    agent_id: row?.agent_id == null || row?.agent_id === '' ? null : Number(row.agent_id),
    reason: String(row?.reason || ''),
  }));
}

export function unloggedSection(rows) {
  const list = canonicalUnloggedRows(rows);
  const hash = crypto.createHash('sha256').update(JSON.stringify(list)).digest('hex');
  return { count: list.length, hash, rows: list };
}

export function verifyUnloggedSection(section) {
  if (!section || typeof section !== 'object') return { ok: false, reason: 'unlogged_missing' };
  if (!Array.isArray(section.rows)) return { ok: false, reason: 'unlogged_missing' };
  const list = canonicalUnloggedRows(section.rows);
  if (JSON.stringify(list) !== JSON.stringify(section.rows)) {
    return { ok: false, reason: 'unlogged_canonical' };
  }
  for (const row of list) {
    if (!row.task_id) return { ok: false, reason: 'unlogged_task' };
    if (!UNLOGGED_REASONS.includes(row.reason)) return { ok: false, reason: 'unlogged_reason' };
  }
  if (Number(section.count) !== list.length) return { ok: false, reason: 'unlogged_count' };
  const hash = crypto.createHash('sha256').update(JSON.stringify(list)).digest('hex');
  if (section.hash !== hash) return { ok: false, reason: 'unlogged_hash' };
  return { ok: true };
}

/**
 * Reason from a version 2 record whose unlogged section hashes. Null when
 * the section is absent, not version 2, or does not verify.
 */
export function attestedUnloggedEntry(record, taskId) {
  if (Number(record?.payload_version) !== EPOCH_RECORD_VERSION_UNLOGGED) return null;
  const checked = verifyUnloggedSection(record?.unlogged);
  if (!checked.ok) return null;
  const id = String(taskId || '');
  return record.unlogged.rows.find((row) => row.task_id === id) || null;
}

/**
 * Version 2 claims. epochs and orphans are the same arrays as `base`
 * (the version 1 record). The version 1 object is not modified.
 */
export function epochRecordWithUnlogged(base, unloggedRows) {
  if (!base?.epochs || !base?.orphans) {
    const err = new Error('epoch_record_incomplete');
    err.code = 'epoch_record_incomplete';
    throw err;
  }
  return {
    schema: base.schema || EPOCH_RECORD_SCHEMA,
    payload_version: EPOCH_RECORD_VERSION_UNLOGGED,
    epochs: base.epochs,
    orphans: base.orphans,
    unlogged: unloggedSection(unloggedRows),
  };
}

export function epochRecordClaims({
  epoch1Root = EPOCH1_FINAL_ROOT,
  epoch1Size = EPOCH1_FINAL_SIZE,
  epoch2Root = EPOCH2_OPENING_ROOT,
  epoch2Size = EPOCH2_OPENING_SIZE,
} = {}) {
  return {
    schema: EPOCH_RECORD_SCHEMA,
    payload_version: EPOCH_RECORD_VERSION,
    epochs: [
      {
        epoch: 1,
        status: 'closed',
        final_root: epoch1Root,
        final_size: epoch1Size,
        genesis_digest: EPOCH1_GENESIS_DIGEST,
        prev_epoch_root: null,
        prev_epoch_size: 0,
      },
      {
        epoch: 2,
        status: 'open',
        opening_root: epoch2Root,
        opening_size: epoch2Size,
        genesis_digest: EPOCH2_GENESIS_DIGEST,
        prev_epoch_root: epoch1Root,
        prev_epoch_size: epoch1Size,
      },
    ],
    orphans: ORPHANED_ROOTS.map((row) => ({ ...row })),
  };
}

/**
 * Follow epoch links. Epoch 1 has no predecessor. Each later epoch must name
 * the previous epoch's final root and size. Orphans are listed, not elected.
 */
export function checkEpochLinks(claims) {
  const epochs = claims?.epochs;
  if (!Array.isArray(epochs) || epochs.length === 0) {
    return { ok: false, reason: 'no_epochs' };
  }
  for (let i = 0; i < epochs.length; i += 1) {
    const row = epochs[i];
    if (Number(row.epoch) !== i + 1) return { ok: false, reason: 'epoch_index' };
    if (i === 0) {
      if (row.prev_epoch_root != null) return { ok: false, reason: 'epoch1_has_prev' };
      if (Number(row.prev_epoch_size) !== 0) return { ok: false, reason: 'epoch1_size' };
      if (row.final_root !== EPOCH1_FINAL_ROOT || Number(row.final_size) !== EPOCH1_FINAL_SIZE) {
        return { ok: false, reason: 'epoch1_root' };
      }
      if (row.genesis_digest !== EPOCH1_GENESIS_DIGEST) {
        return { ok: false, reason: 'epoch1_genesis' };
      }
      continue;
    }
    const prev = epochs[i - 1];
    const prevRoot = prev.final_root || prev.opening_root;
    const prevSize = prev.final_size ?? prev.opening_size;
    if (row.prev_epoch_root !== prevRoot) return { ok: false, reason: 'prev_epoch_root' };
    if (Number(row.prev_epoch_size) !== Number(prevSize)) return { ok: false, reason: 'prev_epoch_size' };
  }
  if (!Array.isArray(claims.orphans)) return { ok: false, reason: 'orphans_missing' };
  return { ok: true, epochs };
}

/**
 * Epoch 1 is pinned. A self-consistent record with a different final root
 * is not accepted. d7f6c548 must be present with root null and unrecoverable.
 */
export function assertPinnedEpochRecord(record) {
  const jws = record?.issuer_signature?.jws;
  if (!jws) return { ok: false, reason: 'epoch_signature_missing' };
  const linked = checkEpochLinks(record);
  if (!linked.ok) return linked;
  const epoch1 = record.epochs.find((row) => Number(row.epoch) === 1);
  if (!epoch1) return { ok: false, reason: 'epoch1_missing' };
  if (epoch1.final_root !== EPOCH1_FINAL_ROOT || Number(epoch1.final_size) !== EPOCH1_FINAL_SIZE) {
    return { ok: false, reason: 'epoch1_root' };
  }
  if (epoch1.genesis_digest !== EPOCH1_GENESIS_DIGEST) {
    return { ok: false, reason: 'epoch1_genesis' };
  }
  const epoch2 = record.epochs.find((row) => Number(row.epoch) === 2);
  if (epoch2) {
    if (epoch2.prev_epoch_root !== EPOCH1_FINAL_ROOT || Number(epoch2.prev_epoch_size) !== EPOCH1_FINAL_SIZE) {
      return { ok: false, reason: 'prev_epoch_root' };
    }
    if (epoch2.opening_root && epoch2.opening_root !== EPOCH2_OPENING_ROOT) {
      return { ok: false, reason: 'epoch2_opening' };
    }
  }
  const lost = record.orphans.find((row) => row?.root_prefix === 'd7f6c548');
  if (!lost) return { ok: false, reason: 'orphan_d7f6c548_missing' };
  if (lost.root != null) return { ok: false, reason: 'orphan_d7f6c548_root_invented' };
  if (lost.unrecoverable !== true) return { ok: false, reason: 'orphan_d7f6c548_unmarked' };
  const genesisOnly = '20d887917a4c32a49434e4b8f8db864cbf26a8e3a0daa6f5f89ab097282413f9';
  if (!record.orphans.some((row) => row?.root === genesisOnly)) {
    return { ok: false, reason: 'orphans_incomplete' };
  }
  if (!record.orphans.some((row) => row?.root === EPOCH2_OPENING_ROOT)) {
    return { ok: false, reason: 'orphans_incomplete' };
  }
  const version = Number(record.payload_version) || EPOCH_RECORD_VERSION;
  if (version === EPOCH_RECORD_VERSION) {
    if (record.unlogged != null) return { ok: false, reason: 'unlogged_unexpected' };
  } else if (version === EPOCH_RECORD_VERSION_UNLOGGED) {
    const listed = verifyUnloggedSection(record.unlogged);
    if (!listed.ok) return listed;
  } else {
    return { ok: false, reason: 'epoch_record_version' };
  }
  return { ok: true };
}
