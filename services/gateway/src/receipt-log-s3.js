/**
 * Hourly receipt-log bundles in S3 with Object Lock (compliance).
 *
 * Off unless RECEIPT_LOG_S3_BUCKET is set. Credentials come from the default
 * AWS chain. Nothing in this module reads a secret from the repo.
 */
import crypto from 'crypto';
import zlib from 'zlib';
import logger from './logger.js';
import { epochLeafHash, epochRootOf } from './receipt-log-epoch.js';

export const BUNDLE_SCHEMA = 'chit402.receipt_log_bundle.v1';
export const BUNDLE_INDEX_SCHEMA = 'chit402.receipt_log_bundle_index.v1';

export function emptyBundleIndex() {
  return { schema: BUNDLE_INDEX_SCHEMA, bundles: [] };
}

/** Stable JSON: object keys sorted, arrays kept in order. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Hash the committed index only. Health counters are not part of the anchor.
 */
export function bundleIndexHash(index) {
  const src = index || emptyBundleIndex();
  const body = {
    schema: src.schema || BUNDLE_INDEX_SCHEMA,
    bundles: src.bundles || [],
  };
  if (src.retention_policy) body.retention_policy = src.retention_policy;
  return sha256Hex(Buffer.from(canonicalJson(body)));
}

export function retentionPolicyFrom(config = {}, env = process.env) {
  const id = config.retentionPolicyId || env.RECEIPT_LOG_RETENTION_POLICY_ID || '';
  const sha = config.retentionPolicySha256 || env.RECEIPT_LOG_RETENTION_POLICY_SHA256 || '';
  if (!id && !sha) return null;
  if (!id || !/^[0-9a-f]{64}$/i.test(String(sha))) {
    logger.error(
      { id: id || null },
      'receipt log retention policy config is incomplete; the bundle index will omit retention_policy',
    );
    return null;
  }
  return { id: String(id), sha256: String(sha).toLowerCase() };
}

export function bundleHour(date) {
  const iso = (date instanceof Date ? date : new Date(date)).toISOString();
  return iso.slice(0, 13);
}

/**
 * One hour's bundle. `leaves` is the full prefix so a later bundle can
 * rebuild the log. `added` is the leaves this hour produced.
 */
export function buildBundle({
  hour,
  epoch,
  leaves,
  heads,
  receipts,
  added,
  prevEpochRoot = null,
  prevEpochSize = 0,
  closedEpochs = [],
}) {
  return {
    schema: BUNDLE_SCHEMA,
    hour,
    epoch,
    prev_epoch_root: prevEpochRoot,
    prev_epoch_size: prevEpochSize,
    tree_size: Array.isArray(leaves) ? leaves.length : 0,
    receipts: receipts || [],
    added: added || [],
    leaves: leaves || [],
    heads: heads || [],
    closed_epochs: closedEpochs,
  };
}

export function compressBundle(bundle) {
  const json = Buffer.from(JSON.stringify(bundle));
  return zlib.gzipSync(json);
}

export function decompressBundle(bytes) {
  const json = zlib.gunzipSync(Buffer.from(bytes));
  return JSON.parse(json.toString('utf8'));
}

export function s3ConfigFromEnv(env = process.env) {
  const bucket = env.RECEIPT_LOG_S3_BUCKET || '';
  if (!bucket) return null;
  const retentionDays = Number(env.RECEIPT_LOG_S3_RETENTION_DAYS || 365);
  return {
    bucket,
    region: env.RECEIPT_LOG_S3_REGION || 'us-east-1',
    prefix: env.RECEIPT_LOG_S3_PREFIX || 'receipt-log/',
    endpoint: env.RECEIPT_LOG_S3_ENDPOINT || undefined,
    forcePathStyle: env.RECEIPT_LOG_S3_FORCE_PATH_STYLE === 'true' || Boolean(env.RECEIPT_LOG_S3_ENDPOINT),
    retentionDays: Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : 365,
  };
}

export async function createS3Client(config) {
  if (config.client) return config.client;
  const { S3Client } = await import('@aws-sdk/client-s3');
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
  });
}

function retainUntil(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export async function putLockedObject({ client, bucket, key, body, retentionDays, contentType, contentEncoding }) {
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType || 'application/octet-stream',
    ContentEncoding: contentEncoding,
    ObjectLockMode: 'COMPLIANCE',
    ObjectLockRetainUntilDate: retainUntil(retentionDays),
  });
  await client.send(command);
  return command;
}

export async function getObjectBytes({ client, bucket, key }) {
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (out.Body && typeof out.Body.transformToByteArray === 'function') {
    return Buffer.from(await out.Body.transformToByteArray());
  }
  if (Buffer.isBuffer(out.Body)) return out.Body;
  if (typeof out.Body === 'string') return Buffer.from(out.Body);
  const chunks = [];
  for await (const chunk of out.Body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/**
 * Write one hourly bundle and append its SHA-256 to the index.
 * The bytes that are hashed are the gzip body that is uploaded.
 */
/**
 * Hourly timer. Failures are logged by the caller. The timer does not keep
 * a short-lived test process alive.
 */
export function startHourlyBundleTimer({ tree, config, receipts, onError, intervalMs = 60 * 60 * 1000 } = {}) {
  const tick = async () => {
    const live = typeof tree === 'function' ? tree() : tree;
    try {
      const rows = typeof receipts === 'function' ? receipts() : (receipts || []);
      await publishTreeBundle(live, { ...config, receipts: rows });
    } catch (err) {
      try {
        if (live && typeof live.noteBundleFailure === 'function') live.noteBundleFailure();
      } catch {
        /* a status write must not take the process down */
      }
      if (onError) onError(err);
    }
  };
  const timer = setInterval(() => { tick(); }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return { timer, tick };
}

export async function publishTreeBundle(tree, config) {
  const view = tree.bundleView(config.receipts || [], config.now || new Date());
  const last = tree.bundleIndex?.bundles?.[tree.bundleIndex.bundles.length - 1];
  if (last && last.hour === view.hour) return { skipped: true, reason: 'hour_already_bundled', index: tree.bundleIndex };
  if (!view.leaves.length) return { skipped: true, reason: 'empty_log', index: tree.bundleIndex };
  const client = config.client || await createS3Client(config);
  const bundle = buildBundle({
    hour: view.hour,
    epoch: view.epoch,
    leaves: view.leaves,
    heads: view.heads,
    receipts: view.receipts,
    added: view.added,
    prevEpochRoot: view.prevEpochRoot,
    prevEpochSize: view.prevEpochSize,
    closedEpochs: view.closedEpochs,
  });
  const uploaded = await uploadHourlyBundle({
    client,
    bucket: config.bucket,
    prefix: config.prefix,
    retentionDays: config.retentionDays,
    bundle,
    index: tree.bundleIndex || emptyBundleIndex(),
    retentionPolicy: retentionPolicyFrom(config),
  });
  uploaded.index.last_bundle_ok_at = new Date(config.now || Date.now()).toISOString();
  uploaded.index.consecutive_failures = 0;
  tree.noteBundle(uploaded.index, view.tree_size);
  return uploaded;
}

export async function uploadHourlyBundle({
  client,
  bucket,
  prefix,
  retentionDays,
  bundle,
  index,
  retentionPolicy = null,
}) {
  const body = compressBundle(bundle);
  const digest = sha256Hex(body);
  const key = `${String(prefix || '').replace(/\/$/, '')}/${bundle.hour}/bundle.json.gz`.replace(/^\//, '');
  await putLockedObject({
    client,
    bucket,
    key,
    body,
    retentionDays,
    contentType: 'application/json',
    contentEncoding: 'gzip',
  });
  const next = {
    schema: BUNDLE_INDEX_SCHEMA,
    bundles: [
      ...(index?.bundles || []),
      {
        hour: bundle.hour,
        key,
        sha256: digest,
        epoch: bundle.epoch,
        tree_size: bundle.tree_size,
        bytes: body.length,
        added: (bundle.added || []).map((row) => row.index),
      },
    ],
  };
  if (retentionPolicy) next.retention_policy = retentionPolicy;
  if (index?.last_bundle_ok_at) next.last_bundle_ok_at = index.last_bundle_ok_at;
  const indexKey = `${String(prefix || '').replace(/\/$/, '')}/bundle-index.json`.replace(/^\//, '');
  const indexBody = Buffer.from(JSON.stringify(next));
  await putLockedObject({
    client,
    bucket,
    key: indexKey,
    body: indexBody,
    retentionDays,
    contentType: 'application/json',
  });
  return { index: next, key, sha256: digest, index_hash: bundleIndexHash(next), index_key: indexKey };
}

/**
 * Download the index and every bundle, check SHA-256, and rebuild leaf
 * preimages. `expectRoots` is a list of `{ root, tree_size, epoch }` the
 * rebuilt log must contain (the anchored heads).
 */
export async function restoreFromS3({ client, bucket, prefix, expectRoots = [] }) {
  const indexKey = `${String(prefix || '').replace(/\/$/, '')}/bundle-index.json`.replace(/^\//, '');
  const indexBytes = await getObjectBytes({ client, bucket, key: indexKey });
  const index = JSON.parse(indexBytes.toString('utf8'));
  if (index.schema !== BUNDLE_INDEX_SCHEMA || !Array.isArray(index.bundles)) {
    throw new Error('bundle_index_malformed');
  }
  const byEpoch = new Map();
  for (const row of index.bundles) {
    const bytes = await getObjectBytes({ client, bucket, key: row.key });
    const digest = sha256Hex(bytes);
    if (digest !== row.sha256) {
      throw new Error(`bundle_hash_mismatch: ${row.key}`);
    }
    const bundle = decompressBundle(bytes);
    if (bundle.schema !== BUNDLE_SCHEMA) throw new Error(`bundle_schema: ${row.key}`);
    const rebuilt = rebuildBundle(bundle);
    if (bundle.tree_size != null && Number(bundle.tree_size) !== rebuilt.tree_size) {
      throw new Error(`bundle_size_mismatch: ${row.key}`);
    }
    for (const closed of bundle.closed_epochs || []) {
      const older = rebuildBundle({
        epoch: closed.epoch,
        leaves: closed.leaves,
        prev_epoch_root: closed.prev_epoch_root,
        prev_epoch_size: closed.prev_epoch_size,
        heads: [],
      });
      byEpoch.set(closed.epoch, older);
    }
    byEpoch.set(bundle.epoch, rebuilt);
  }
  for (const want of expectRoots) {
    const got = byEpoch.get(want.epoch);
    if (!got) throw new Error(`restore_missing_epoch: ${want.epoch}`);
    const matched = rootAtSize(got, want.tree_size || got.tree_size);
    if (want.root && matched !== want.root) {
      throw new Error(`restore_root_mismatch: epoch ${want.epoch} got ${matched} want ${want.root}`);
    }
  }
  return { index, epochs: [...byEpoch.values()] };
}

function leafBodies(leaves) {
  return (leaves || []).map((leaf) => Buffer.from(leaf.preimage_b64 || '', 'base64'));
}

function rebuildBundle(bundle) {
  const bodies = leafBodies(bundle.leaves);
  const hashes = bodies.map((body) => epochLeafHash(body));
  const root = hashes.length ? epochRootOf(hashes).toString('hex') : null;
  return {
    epoch: bundle.epoch,
    leaves: bundle.leaves || [],
    hashes,
    root,
    tree_size: bodies.length,
    prev_epoch_root: bundle.prev_epoch_root || null,
    prev_epoch_size: bundle.prev_epoch_size || 0,
    heads: bundle.heads || [],
  };
}

function rootAtSize(epoch, size) {
  const n = Number(size);
  if (!Number.isInteger(n) || n < 1 || n > epoch.hashes.length) return null;
  return epochRootOf(epoch.hashes.slice(0, n)).toString('hex');
}
