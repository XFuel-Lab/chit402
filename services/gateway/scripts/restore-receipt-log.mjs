#!/usr/bin/env node
/**
 * Rebuild the receipt log from S3 bundles and check it against anchored roots.
 *
 *   RECEIPT_LOG_S3_BUCKET=... RECEIPT_LOG_S3_REGION=... \
 *     node scripts/restore-receipt-log.mjs
 *
 * Default checks: epoch 1 size 4 root dd20e39a, epoch 2 size 1 root f2043ee9.
 * Pass --expect <epoch>:<size>:<root> to add a prefix check (repeatable).
 * Pass --head <tree-head.json> for the anchored signed head. Without it, the
 * newest signed anchored head inside the bundles is used. The index hash and
 * the full recomputed root must match that head.
 * Does not write the local journal and does not broadcast.
 *
 * Loads `.env` the same way the server does (`src/config.js`).
 */
import '../src/config.js';
import fs from 'fs';
import { EPOCH1_FINAL_ROOT, EPOCH1_FINAL_SIZE, EPOCH2_OPENING_ROOT, EPOCH2_OPENING_SIZE } from '../src/receipt-log-epoch.js';
import { verifyTreeHead } from '../src/receipt-merkle.js';
import { createS3Client, restoreFromS3, s3ConfigFromEnv } from '../src/receipt-log-s3.js';

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) return null;
  return process.argv[i + 1];
}

const config = s3ConfigFromEnv();
if (!config) {
  console.error('Set RECEIPT_LOG_S3_BUCKET (and RECEIPT_LOG_S3_REGION).');
  process.exit(2);
}

const expectRoots = [
  { epoch: 1, tree_size: EPOCH1_FINAL_SIZE, root: EPOCH1_FINAL_ROOT },
  { epoch: 2, tree_size: EPOCH2_OPENING_SIZE, root: EPOCH2_OPENING_ROOT },
];
for (let i = 0; i < process.argv.length; i += 1) {
  if (process.argv[i] !== '--expect') continue;
  const [epoch, size, root] = String(process.argv[i + 1] || '').split(':');
  expectRoots.push({ epoch: Number(epoch), tree_size: Number(size), root });
}

const headPath = arg('--head');
const head = headPath ? JSON.parse(fs.readFileSync(headPath, 'utf8')) : null;
const client = await createS3Client(config);
const restored = await restoreFromS3({
  client,
  bucket: config.bucket,
  prefix: config.prefix,
  expectRoots,
  head,
  verifyHead: (candidate) => verifyTreeHead(candidate).valid,
});
for (const epoch of restored.epochs) {
  console.log(`epoch ${epoch.epoch} size ${epoch.tree_size} root ${epoch.root}`);
}
console.log(`bundles ${restored.index.bundles.length}`);
