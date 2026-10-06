#!/usr/bin/env node
/**
 * Rebuild the receipt log from S3 bundles and check it against anchored roots.
 *
 *   RECEIPT_LOG_S3_BUCKET=... RECEIPT_LOG_S3_REGION=... \
 *     node scripts/restore-receipt-log.mjs
 *
 * Default checks: epoch 1 size 4 root dd20e39a, epoch 2 size 1 root f2043ee9.
 * Pass --expect <epoch>:<size>:<root> to add or replace a check (repeatable).
 * Does not write the local journal and does not broadcast.
 */
import { EPOCH1_FINAL_ROOT, EPOCH1_FINAL_SIZE, EPOCH2_OPENING_ROOT, EPOCH2_OPENING_SIZE } from '../src/receipt-log-epoch.js';
import { createS3Client, restoreFromS3, s3ConfigFromEnv } from '../src/receipt-log-s3.js';

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

const client = await createS3Client(config);
const restored = await restoreFromS3({
  client,
  bucket: config.bucket,
  prefix: config.prefix,
  expectRoots,
});
for (const epoch of restored.epochs) {
  console.log(`epoch ${epoch.epoch} size ${epoch.tree_size} root ${epoch.root}`);
}
console.log(`bundles ${restored.index.bundles.length}`);
