/**
 * Durable owner-view nonces and sessions.
 * A memory map is not a nonce store: a restart would mint the same
 * challenge again, or drop a session the holder still has.
 * Writes are synchronous and the consume is one DELETE … RETURNING,
 * so two callers cannot both spend a nonce.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const openStores = new Map();

export function resolveOwnerStorePath(env = process.env) {
  const configured = String(env.OWNER_VIEW_DB || '').trim();
  if (configured) return path.resolve(configured);
  return path.join(os.tmpdir(), 'chit402-owner-view', 'owner-view.sqlite');
}

function failWrite(err) {
  const message = err?.message || String(err);
  const error = new Error(`owner view store cannot be written: ${message}`);
  error.cause = err;
  return error;
}

function failRead(err) {
  const message = err?.message || String(err);
  const error = new Error(`owner view store cannot be read: ${message}`);
  error.cause = err;
  return error;
}

/**
 * Open (or reuse) the durable store. Throws when the file cannot be
 * created, written, or read back. Callers must not fall back to memory.
 */
export function openOwnerStore(file = resolveOwnerStorePath()) {
  const resolved = path.resolve(String(file || ''));
  if (!resolved || resolved === path.parse(resolved).root) {
    throw failWrite(new Error('OWNER_VIEW_DB is empty'));
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
    db.pragma('busy_timeout = 3000');
    db.exec(`
      CREATE TABLE IF NOT EXISTS owner_nonces (
        nonce TEXT PRIMARY KEY,
        canonical TEXT NOT NULL,
        audience TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        challenge_json TEXT NOT NULL
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS owner_sessions (
        token TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        agent_id INTEGER,
        payer TEXT,
        house INTEGER NOT NULL,
        receipt_ids TEXT,
        expires_at INTEGER NOT NULL
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS owner_store_probe (
        k INTEGER PRIMARY KEY,
        v INTEGER NOT NULL
      )
    `);
    db.prepare(
      'INSERT INTO owner_store_probe (k, v) VALUES (1, 1) ON CONFLICT(k) DO UPDATE SET v = excluded.v',
    ).run();
    const probe = db.prepare('SELECT v FROM owner_store_probe WHERE k = 1').get();
    if (!probe || Number(probe.v) !== 1) throw failRead(new Error('probe mismatch'));
  } catch (err) {
    try { db?.close(); } catch { /* already failing closed */ }
    if (String(err?.message || '').startsWith('owner view store cannot be read')) throw err;
    throw failWrite(err);
  }

  const store = {
    path: resolved,
    insertNonce(row) {
      try {
        db.prepare(
          `INSERT INTO owner_nonces (nonce, canonical, audience, scope_key, expires_at, challenge_json)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          row.nonce,
          row.canonical,
          row.audience,
          row.scopeKey,
          row.expiresAt,
          JSON.stringify(row.challenge),
        );
      } catch (err) {
        throw failWrite(err);
      }
    },
    /**
     * Atomically take the nonce. The row is gone before this returns,
     * including when two processes race.
     */
    consumeNonce(nonce) {
      try {
        const row = db.prepare(
          `DELETE FROM owner_nonces
           WHERE nonce = ?
           RETURNING canonical, audience, scope_key AS scopeKey, expires_at AS expiresAt`,
        ).get(nonce);
        if (!row) return null;
        return {
          canonical: row.canonical,
          audience: row.audience,
          scopeKey: row.scopeKey,
          expiresAt: Number(row.expiresAt),
        };
      } catch (err) {
        throw failRead(err);
      }
    },
    insertSession(row) {
      try {
        db.prepare(
          `INSERT INTO owner_sessions (token, kind, agent_id, payer, house, receipt_ids, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          row.token,
          row.kind,
          row.agentId ?? null,
          row.payer ?? null,
          row.house ? 1 : 0,
          row.receiptIds ? JSON.stringify(row.receiptIds) : null,
          row.expiresAt,
        );
      } catch (err) {
        throw failWrite(err);
      }
    },
    readSession(token) {
      try {
        const row = db.prepare(
          `SELECT token, kind, agent_id AS agentId, payer, house, receipt_ids AS receiptIds, expires_at AS expiresAt
           FROM owner_sessions WHERE token = ?`,
        ).get(token);
        if (!row) return null;
        return {
          token: row.token,
          kind: row.kind,
          agentId: row.agentId == null ? null : Number(row.agentId),
          payer: row.payer,
          house: Number(row.house) === 1,
          receiptIds: row.receiptIds ? JSON.parse(row.receiptIds) : null,
          expiresAt: Number(row.expiresAt),
        };
      } catch (err) {
        throw failRead(err);
      }
    },
    deleteSession(token) {
      try {
        db.prepare('DELETE FROM owner_sessions WHERE token = ?').run(token);
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
