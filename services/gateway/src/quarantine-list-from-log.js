/**
 * Quarantine list entries rebuilt from a receipt log, read only (no lock, no
 * journal write). The one build shared by scripts/sign-quarantine-list.mjs
 * (any version) and the production v1 signer: every quarantined head needs a
 * quarantine_ack, its consistency proof runs from its prefix size to the
 * latest signed head of that epoch, and the high-water head is the latest
 * signed head per listed epoch. The production signer uses it to check that
 * its input is exactly what the log builds today. A test pins the script's
 * dry run and this build byte for byte.
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildQuarantineList, quarantineListDir, readQuarantineList } from './quarantine-list.js';

function buildRefused(message) {
  const err = new Error(message);
  err.code = 'quarantine_list_build';
  return err;
}

/**
 * Entries for every quarantined head in the log, in log order, and the
 * latest signed head of an epoch. Throws code `quarantine_list_build`.
 * @param {string} logDir
 * @param {{ ReceiptMerkleTree?: Function }} [deps]
 * @returns {Promise<{ entries: object[], maxSignedHead: (epochNo: number) => object|null }>}
 */
export async function quarantineEntriesFromLog(logDir, deps = {}) {
  const ReceiptMerkleTree = deps.ReceiptMerkleTree || (await import('./receipt-merkle.js')).ReceiptMerkleTree;
  const tree = new ReceiptMerkleTree();
  tree.load(logDir);

  const acks = new Map();
  const journal = fs.readFileSync(path.join(logDir, 'journal.jsonl'), 'utf8');
  for (const line of journal.split('\n')) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row.op === 'quarantine_ack' && row.issuer_signature?.jws) {
      acks.set(`${row.epoch}|${row.tree_size}|${row.root}`, row.issuer_signature.jws);
    }
  }
  const closedOf = (epochNo) => tree.closedEpochs.find((row) => row.epoch === epochNo);
  const epochLeaves = (epochNo) => (tree.epoch === epochNo ? tree.leaves : closedOf(epochNo)?.leaves || null);
  const headsOf = (epochNo) => (tree.epoch === epochNo ? tree.heads || [] : closedOf(epochNo)?.heads || []);
  const maxSignedHead = (epochNo) => {
    const heads = headsOf(epochNo).filter((h) => Number.isSafeInteger(h?.tree_size) && h?.issuer_signature?.jws);
    if (heads.length === 0) return null;
    return heads.reduce((a, b) => (b.tree_size >= a.tree_size ? b : a));
  };

  const entries = [];
  for (const q of tree.quarantinedHeads || []) {
    const key = `${q.epoch}|${q.tree_size}|${q.root}`;
    const ack = acks.get(key);
    if (!ack) throw buildRefused(`quarantined head epoch ${q.epoch} size ${q.tree_size} has no quarantine_ack`);
    const honest = maxSignedHead(q.epoch);
    if (!honest || honest.tree_size < q.tree_size) throw buildRefused(`epoch ${q.epoch} has no signed head at or above size ${q.tree_size}`);
    if (!epochLeaves(q.epoch)) throw buildRefused(`epoch ${q.epoch} leaves are not loaded`);
    const proof = tree.consistency(q.prefix_size, honest.tree_size, q.epoch);
    if (proof.second_root !== honest.root) throw buildRefused(`epoch ${q.epoch} honest head root does not match the leaves`);
    entries.push({
      epoch: q.epoch,
      tree_size: q.tree_size,
      root: q.root,
      prefix_size: q.prefix_size,
      reason: 'publish_append_race',
      consistency: { first: q.prefix_size, second: honest.tree_size, second_root: honest.root, proof: proof.proof },
      quarantine_ack_jws: ack,
    });
  }
  return { entries, maxSignedHead };
}

/** The high-water head (latest signed head) of each epoch the entries list. */
export function highWaterOf(entries, maxSignedHead) {
  const epochs = [...new Set(entries.map((e) => e.epoch))].sort((a, b) => a - b);
  return epochs.map((epochNo) => {
    const h = maxSignedHead(epochNo);
    return { epoch: epochNo, tree_size: h.tree_size, root: h.root };
  });
}

/**
 * @param {string} logDir
 * @param {{ ReceiptMerkleTree?: Function }} [deps]
 * @returns {Promise<object>} unsigned v1 document
 */
export async function buildUnsignedV1FromLog(logDir, deps = {}) {
  if (readQuarantineList(quarantineListDir(logDir))) throw buildRefused('a list version already exists; this build is v1 only');
  const { entries, maxSignedHead } = await quarantineEntriesFromLog(logDir, deps);
  return buildQuarantineList({ entries, highWater: highWaterOf(entries, maxSignedHead), prevBytes: null });
}
