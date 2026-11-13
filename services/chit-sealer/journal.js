/**
 * Durable sealer journal.
 *
 * The committed epoch (epoch, hourStart, size, root, stateRoot, calldata)
 * and each receipt row, including sealed ciphertext, are fsynced before
 * any broadcast. The file is private (mode 0o600). Recovery reloads this
 * record and can re-commit the store from it. A crash after this write
 * reloads the same record.
 */

import fs from 'node:fs';
import path from 'node:path';
import { bytesToHex, hexToBytes } from '../../packages/cs2-core/ecdsa/bytes.js';
import { EMPTY_ROOT_HEX } from '../../packages/cs2-core/merkle/index.js';
import { createTree, treeFromLeaves } from '../../packages/cs2-core/smt/index.mjs';

function atomicWrite(io, dir, file, text) {
  io.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  const fd = io.openSync(tmp, 'w', 0o600);
  try {
    const buf = Buffer.from(text);
    let offset = 0;
    while (offset < buf.length) {
      const n = io.writeSync(fd, buf, offset, buf.length - offset);
      if (!Number.isInteger(n) || n <= 0) throw new Error('short write');
      offset += n;
    }
    io.fsyncSync(fd);
  } finally {
    io.closeSync(fd);
  }
  io.renameSync(tmp, file);
  const dfd = io.openSync(dir, 'r');
  try {
    io.fsyncSync(dfd);
  } finally {
    io.closeSync(dfd);
  }
}

function exportTree(tree) {
  const leaves = [];
  for (const entry of tree.leaves.values()) {
    leaves.push({
      key: bytesToHex(entry.key),
      value: bytesToHex(entry.value),
      dummy: entry.dummy === true,
    });
  }
  const epoch = tree.epoch
    ? {
      chainId: tree.epoch.chainId.toString(),
      epoch: tree.epoch.epoch,
      hourStart: tree.epoch.hourStart,
      value: bytesToHex(tree.epoch.value),
    }
    : null;
  return { leaves, epoch };
}

function importEpoch(raw) {
  return {
    chainId: BigInt(raw.chainId),
    epoch: raw.epoch,
    hourStart: raw.hourStart,
    value: hexToBytes(raw.value),
  };
}

function importTree(raw) {
  if (!raw || !Array.isArray(raw.leaves) || raw.leaves.length === 0) {
    const tree = createTree();
    if (raw?.epoch) tree.epoch = importEpoch(raw.epoch);
    return tree;
  }
  const map = new Map();
  for (let i = 0; i < raw.leaves.length; i += 1) {
    const row = raw.leaves[i];
    map.set(row.key, {
      key: hexToBytes(row.key),
      value: hexToBytes(row.value),
      dummy: row.dummy === true,
    });
  }
  const built = treeFromLeaves(map, raw.epoch ? importEpoch(raw.epoch) : null);
  if (!built.ok) return null;
  return built.tree;
}

function initial(config) {
  return {
    v: 1,
    chainId: config.chainId.toString(),
    contract: config.contract,
    anchorEpoch: 0,
    lastHourStart: null,
    logSize: 0,
    logRoot: EMPTY_ROOT_HEX,
    nextNonce: 0,
    leaves: [],
    commits: [],
    tree: { leaves: [], epoch: null },
  };
}

function toDisk(state) {
  return {
    v: 1,
    chainId: state.chainId,
    contract: state.contract,
    anchorEpoch: state.anchorEpoch,
    lastHourStart: state.lastHourStart,
    logSize: state.logSize,
    logRoot: state.logRoot,
    nextNonce: state.nextNonce,
    leaves: state.leaves.map((leaf) => bytesToHex(leaf)),
    commits: state.commits,
    tree: exportTree(state.tree),
  };
}

function fromDisk(raw) {
  const tree = importTree(raw.tree);
  if (!tree) return null;
  return {
    v: 1,
    chainId: raw.chainId,
    contract: raw.contract,
    anchorEpoch: raw.anchorEpoch,
    lastHourStart: raw.lastHourStart,
    logSize: raw.logSize,
    logRoot: raw.logRoot,
    nextNonce: raw.nextNonce,
    leaves: raw.leaves.map((hex) => hexToBytes(hex)),
    commits: raw.commits,
    tree,
  };
}

/**
 * @param {string} dir
 * @param {{ chainId: bigint, contract: string }} config
 * @param {object} [io]
 */
export function openJournal(dir, config, io = fs) {
  io.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'sealer-state.json');
  let state;
  if (io.existsSync(file)) {
    const raw = JSON.parse(io.readFileSync(file, 'utf8'));
    state = fromDisk(raw);
    if (!state) {
      const err = new Error('sealer journal is unreadable');
      err.code = 'journal_unreadable';
      throw err;
    }
    if (state.chainId !== config.chainId.toString() || state.contract !== config.contract) {
      const err = new Error('sealer journal does not match this sealer');
      err.code = 'journal_mismatch';
      throw err;
    }
  } else {
    state = fromDisk(initial(config));
  }
  return {
    dir,
    file,
    io,
    state,
    write(next) {
      atomicWrite(io, dir, file, JSON.stringify(toDisk(next)));
      this.state = next;
    },
  };
}
