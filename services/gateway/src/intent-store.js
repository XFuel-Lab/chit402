/**
 * Durable intent use counts.
 *
 * Same engine as the owner-view nonce store (#519): one sqlite file,
 * WAL, synchronous FULL, and a single UPDATE … WHERE uses_remaining > 0
 * RETURNING inside an immediate transaction. Two settlers cannot both
 * take the last use. A throw while the receipt is signed rolls the use
 * back. This is not an in-memory counter.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const openStores = new Map();

export function resolveIntentStorePath(env = process.env) {
  const configured = String(env.INTENT_DB || '').trim();
  if (configured) return path.resolve(configured);
  const nodeEnv = env.NODE_ENV == null ? '' : String(env.NODE_ENV).trim();
  const production = nodeEnv !== 'test' && nodeEnv !== 'development';
  if (production) return path.resolve('.data/intent.sqlite');
  return path.join(os.tmpdir(), 'chit402-intent', 'intent.sqlite');
}

function failWrite(err) {
  const error = new Error(`intent store cannot be written: ${err?.message || err}`);
  error.cause = err;
  return error;
}

function failRead(err) {
  const error = new Error(`intent store cannot be read: ${err?.message || err}`);
  error.cause = err;
  return error;
}

/**
 * @param {string} [file]
 */
export function openIntentStore(file = resolveIntentStorePath()) {
  const resolved = path.resolve(String(file || ''));
  if (!resolved || resolved === path.parse(resolved).root) {
    throw failWrite(new Error('INTENT_DB is empty'));
  }
  const cached = openStores.get(resolved);
  if (cached) return cached;

  const dir = path.dirname(resolved);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    throw failWrite(err);
  }

  let db;
  try {
    db = new Database(resolved);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    db.pragma('busy_timeout = 5000');
    db.exec(`
      CREATE TABLE IF NOT EXISTS intent_grants (
        intent_id TEXT PRIMARY KEY,
        use_count INTEGER NOT NULL,
        uses_remaining INTEGER NOT NULL,
        record_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS intent_receipts (
        receipt_id TEXT PRIMARY KEY,
        intent_id TEXT NOT NULL,
        use_index INTEGER NOT NULL,
        receipt_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS intent_store_probe (
        k INTEGER PRIMARY KEY,
        v INTEGER NOT NULL
      )
    `);
    db.prepare(
      'INSERT INTO intent_store_probe (k, v) VALUES (1, 1) ON CONFLICT(k) DO UPDATE SET v = excluded.v',
    ).run();
    const probe = db.prepare('SELECT v FROM intent_store_probe WHERE k = 1').get();
    if (!probe || Number(probe.v) !== 1) throw failRead(new Error('probe mismatch'));
  } catch (err) {
    try { db?.close(); } catch { /* already failing closed */ }
    if (String(err?.message || '').startsWith('intent store cannot be read')) throw err;
    throw failWrite(err);
  }

  const updateUse = db.prepare(
    `UPDATE intent_grants
     SET uses_remaining = uses_remaining - 1
     WHERE intent_id = ? AND uses_remaining > 0
     RETURNING uses_remaining, use_count`,
  );
  const insertReceipt = db.prepare(
    `INSERT INTO intent_receipts (receipt_id, intent_id, use_index, receipt_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );

  const consumeTx = db.transaction((intentId, build) => {
    const row = updateUse.get(intentId);
    if (!row) return null;
    const useIndex = Number(row.use_count) - Number(row.uses_remaining);
    const receipt = build(useIndex);
    const receiptId = receipt?.task_id;
    if (typeof receiptId !== 'string' || receiptId.length === 0) {
      throw failWrite(new Error('receipt has no task_id'));
    }
    insertReceipt.run(receiptId, intentId, useIndex, JSON.stringify(receipt), Date.now());
    return { useIndex, receipt };
  });

  const store = {
    path: resolved,
    putGrant(row) {
      try {
        db.prepare(
          `INSERT INTO intent_grants (intent_id, use_count, uses_remaining, record_json, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(row.intentId, row.useCount, row.useCount, JSON.stringify(row.record), Date.now());
      } catch (err) {
        throw failWrite(err);
      }
    },
    getGrant(intentId) {
      try {
        const row = db.prepare(
          `SELECT intent_id AS intentId, use_count AS useCount, uses_remaining AS usesRemaining, record_json AS recordJson
           FROM intent_grants WHERE intent_id = ?`,
        ).get(intentId);
        if (!row) return null;
        return {
          intentId: row.intentId,
          useCount: Number(row.useCount),
          usesRemaining: Number(row.usesRemaining),
          record: JSON.parse(row.recordJson),
        };
      } catch (err) {
        throw failRead(err);
      }
    },
    receiptsFor(intentId) {
      try {
        const rows = db.prepare(
          `SELECT receipt_id AS receiptId, use_index AS useIndex, receipt_json AS receiptJson
           FROM intent_receipts WHERE intent_id = ? ORDER BY use_index ASC`,
        ).all(intentId);
        return rows.map((row) => ({
          receiptId: row.receiptId,
          useIndex: Number(row.useIndex),
          receipt: JSON.parse(row.receiptJson),
        }));
      } catch (err) {
        throw failRead(err);
      }
    },
    /**
     * Take one use and store the receipt, or take nothing.
     * `build` runs inside the write transaction. A throw rolls the use back.
     * @param {string} intentId
     * @param {(useIndex: number) => object} build
     */
    consumeAndRecord(intentId, build) {
      try {
        const taken = consumeTx.immediate(intentId, build);
        if (!taken) return { ok: false, reason: 'intent_violation' };
        return { ok: true, useIndex: taken.useIndex, receipt: taken.receipt };
      } catch (err) {
        throw failWrite(err);
      }
    },
    close() {
      openStores.delete(resolved);
      try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* closed below */ }
      db.close();
    },
  };
  openStores.set(resolved, store);
  return store;
}
