/**
 * Build, sign and seal the next quarantine list version. Run at the host,
 * once per version, from services/gateway. Dry run by default: prints the
 * unsigned document and signs nothing.
 *
 *   node scripts/sign-quarantine-list.mjs --log-dir "$RECEIPT_LOG_DIR"
 *   node scripts/sign-quarantine-list.mjs --log-dir "$RECEIPT_LOG_DIR" --apply --confirm YES
 *
 * Signing always refuses a production environment (NODE_ENV unset or not
 * test/development), ISSUER_SIGNER=kms or an active KMS signer, and the
 * production kid. No flag or env var overrides that. Only a stub or test
 * signer signs here. Signing list v1 with the production issuer is a later,
 * separately reviewed host step. Never point a test or rehearsal run at the
 * real key.
 *
 * Reads the receipt log read-only (no lock, no journal write). Every
 * quarantined head must already carry a quarantine_ack in the journal.
 * Each entry's consistency proof runs from its prefix size to the latest
 * signed head of that epoch. The new version keeps every prior entry byte
 * for byte. The signature is a JWS from the active issuer signer; this
 * script never signs a fixed head or a binding.
 */
import fs from 'node:fs';
import path from 'node:path';

process.env.DOTENV_CONFIG_QUIET = 'true';
const { ReceiptMerkleTree } = await import('../src/receipt-merkle.js');
const {
  buildQuarantineList,
  quarantineListDir,
  readQuarantineList,
  quarantineSignGuard,
  signQuarantineList,
  writeQuarantineListVersion,
} = await import('../src/quarantine-list.js');
const { jcsRfc8785 } = await import('../src/offer-receipt.js');
const { recordEscrowRefusal } = await import('../src/receipt-failures.js');

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const logDir = arg('--log-dir') || process.env.RECEIPT_LOG_DIR || '';
if (!logDir) fail('--log-dir or RECEIPT_LOG_DIR is required');
const apply = process.argv.includes('--apply');
if (apply && arg('--confirm') !== 'YES') fail('--apply needs --confirm YES');
if (apply) {
  // Before reading the log: production, KMS and the production kid are always refused.
  const guard = quarantineSignGuard({ env: process.env });
  if (!guard.ok) {
    // Appended to RECEIPT_FAILURES_FILE when set. A running gateway reads that
    // file once at boot, so it shows this row only after a restart.
    recordEscrowRefusal({ path: 'quarantine_sign', reason: guard.reason });
    fail(`refused: ${guard.reason}. This script signs only with a stub or test signer; there is no override.`);
  }
}

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

function epochLeaves(epochNo) {
  if (tree.epoch === epochNo) return tree.leaves;
  const closed = tree.closedEpochs.find((row) => row.epoch === epochNo);
  return closed ? closed.leaves : null;
}

function headsOf(epochNo) {
  if (tree.epoch === epochNo) return tree.heads || [];
  const closed = tree.closedEpochs.find((row) => row.epoch === epochNo);
  return (closed && closed.heads) || [];
}

function maxSignedHead(epochNo) {
  const heads = headsOf(epochNo).filter((h) => Number.isSafeInteger(h?.tree_size) && h?.issuer_signature?.jws);
  if (heads.length === 0) return null;
  return heads.reduce((a, b) => (b.tree_size >= a.tree_size ? b : a));
}

const fresh = [];
for (const q of tree.quarantinedHeads || []) {
  const key = `${q.epoch}|${q.tree_size}|${q.root}`;
  const ack = acks.get(key);
  if (!ack) fail(`quarantined head epoch ${q.epoch} size ${q.tree_size} has no quarantine_ack; acknowledge it first`);
  const honest = maxSignedHead(q.epoch);
  if (!honest || honest.tree_size < q.tree_size) {
    fail(`epoch ${q.epoch} has no signed head at or above size ${q.tree_size}`);
  }
  if (!epochLeaves(q.epoch)) fail(`epoch ${q.epoch} leaves are not loaded`);
  const proof = tree.consistency(q.prefix_size, honest.tree_size, q.epoch);
  if (proof.second_root !== honest.root) fail(`epoch ${q.epoch} honest head root does not match the leaves`);
  fresh.push({
    epoch: q.epoch,
    tree_size: q.tree_size,
    root: q.root,
    prefix_size: q.prefix_size,
    reason: 'publish_append_race',
    consistency: {
      first: q.prefix_size,
      second: honest.tree_size,
      second_root: honest.root,
      proof: proof.proof,
    },
    quarantine_ack_jws: ack,
  });
}

const dir = quarantineListDir(logDir);
const prev = readQuarantineList(dir);
const prevEntries = prev ? (JSON.parse(prev.bytes).entries || []) : [];
const seen = new Set(prevEntries.map((e) => `${e.epoch}|${e.tree_size}|${e.root}`));
const entries = [...prevEntries, ...fresh.filter((e) => !seen.has(`${e.epoch}|${e.tree_size}|${e.root}`))];
const epochs = [...new Set(entries.map((e) => e.epoch))].sort((a, b) => a - b);
const highWater = epochs.map((epochNo) => {
  const h = maxSignedHead(epochNo);
  return { epoch: epochNo, tree_size: h.tree_size, root: h.root };
});

const doc = buildQuarantineList({ entries, highWater, prevBytes: prev ? prev.bytes : null });
if (prev && entries.length === prevEntries.length && jcsRfc8785(doc.high_water) === jcsRfc8785(JSON.parse(prev.bytes).high_water)) {
  console.log(`no change since version ${prev.version}`);
  process.exit(0);
}
if (!apply) {
  console.log(jcsRfc8785(doc));
  console.error(`dry run: version ${doc.version}, ${entries.length} entries; nothing signed or written`);
  process.exit(0);
}
let bytes;
try {
  bytes = await signQuarantineList(doc, { env: process.env });
} catch (err) {
  if (err?.code === 'quarantine_sign_refused') fail(`refused: ${err.reason}. Nothing signed or written.`);
  throw err;
}
const written = writeQuarantineListVersion(dir, bytes);
console.log(JSON.stringify({ version: written.version, file: written.file, entries: entries.length }));
