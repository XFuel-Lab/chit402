/**
 * Durable public-attestation outbox and store (verifier 0.4.6).
 *
 * One row per task_id and at most one live row per normalized payment ref
 * (`base:` + lowercase hash). States: pending, signed, failed, skipped.
 * A signed row is never replaced: a second, different JWS for the same task
 * is refused and alerted, and the first is kept. Rows are never pruned.
 *
 * Storage is an append-only JSON-lines journal: each change appends the
 * whole row and fsyncs, so a write costs one row, not the whole file. Load
 * replays it (last line per task wins); a torn last line is ignored. This
 * module imports no signer. The GET receipt route reads attestations only
 * through `servedAttestation`.
 */
import fs from 'node:fs';
import path from 'node:path';

export const PUBLIC_ATTESTATION_STATES = Object.freeze(['pending', 'signed', 'failed', 'skipped']);

function flagOn(value) {
  return String(value ?? '').trim().toLowerCase() === 'true';
}

/** Issuance (worker) flag. Default off. */
export function publicAttestationSignEnabled(env = process.env) {
  return flagOn(env.PUBLIC_ATTESTATION_SIGN);
}

/** Serve flag. Default off. Turned on only after 0.4.6 is published and rows are stored. */
export function publicAttestationServeEnabled(env = process.env) {
  return flagOn(env.PUBLIC_ATTESTATION_SERVE);
}

export class PublicAttestationStore {
  /**
   * @param {{ file?: string|null, alert?: (event: object) => void }} [opts]
   */
  constructor({ file = null, alert = () => {} } = {}) {
    this.file = file;
    this.alert = alert;
    /** @type {Map<string, object>} */
    this.rows = new Map();
    /** normalized ref -> task_id, live rows only (pending or signed) */
    this.refs = new Map();
    this.load();
  }

  load() {
    this.rows.clear();
    this.refs.clear();
    if (!this.file || !fs.existsSync(this.file)) return;
    const lines = fs.readFileSync(this.file, 'utf8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        continue; // a torn last line from a crash mid-append
      }
      if (!row?.task_id || !PUBLIC_ATTESTATION_STATES.includes(row.state)) continue;
      const id = String(row.task_id);
      const prior = this.rows.get(id);
      // A signed row is final. A later line can never replace its JWS.
      if (prior?.state === 'signed' && (row.state !== 'signed' || row.jws !== prior.jws)) continue;
      if (prior?.ref && this.refs.get(prior.ref) === id) this.refs.delete(prior.ref);
      this.rows.set(id, row);
      if (row.ref && (row.state === 'pending' || row.state === 'signed')) this.refs.set(row.ref, id);
    }
  }

  _persist(row) {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const fd = fs.openSync(this.file, 'a', 0o600);
    try {
      fs.writeSync(fd, `${JSON.stringify(row)}\n`);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }

  get(taskId) {
    return this.rows.get(String(taskId)) || null;
  }

  taskForRef(ref) {
    return this.refs.get(String(ref)) || null;
  }

  /**
   * Queue one task. A task already present is a no-op. A ref already held
   * by another live task is skipped (`duplicate_ref`) and alerted.
   */
  enqueue({ taskId, ref, now = Date.now() }) {
    const id = String(taskId);
    const existing = this.rows.get(id);
    if (existing) return { ok: true, duplicate: true, row: existing };
    const holder = ref ? this.refs.get(ref) : null;
    if (holder && holder !== id) {
      const row = { task_id: id, ref, state: 'skipped', reason: 'duplicate_ref', attempts: 0, created_at: new Date(now).toISOString() };
      this.rows.set(id, row);
      this._persist(row);
      this.alert({ event: 'public_attestation_duplicate_ref', task_id: id, held_by: holder });
      return { ok: false, reason: 'duplicate_ref', row };
    }
    const row = {
      task_id: id,
      ref: ref || null,
      state: 'pending',
      attempts: 0,
      next_at: now,
      last_error: null,
      created_at: new Date(now).toISOString(),
    };
    this.rows.set(id, row);
    if (ref) this.refs.set(ref, id);
    this._persist(row);
    return { ok: true, duplicate: false, row };
  }

  /** Rows due now, oldest first. */
  due(now = Date.now(), limit = Infinity) {
    const out = [];
    for (const row of this.rows.values()) {
      if (row.state !== 'pending') continue;
      if (Number(row.next_at || 0) > now) continue;
      out.push(row);
    }
    out.sort((a, b) => Number(a.next_at || 0) - Number(b.next_at || 0));
    return out.slice(0, limit);
  }

  /**
   * Compare-and-set to signed. Identical bytes are a no-op. Different bytes
   * for a signed task are refused, alerted, and the first JWS is kept.
   */
  markSigned(taskId, { jws, kid, now = Date.now() }) {
    const row = this.rows.get(String(taskId));
    if (!row) return { ok: false, reason: 'no_row' };
    if (row.state === 'signed') {
      if (row.jws === jws) return { ok: true, duplicate: true };
      this.alert({ event: 'public_attestation_conflict', task_id: row.task_id });
      return { ok: false, reason: 'conflict' };
    }
    if (row.state !== 'pending') return { ok: false, reason: row.state };
    row.state = 'signed';
    row.jws = jws;
    row.kid = kid || null;
    row.signed_at = new Date(now).toISOString();
    row.last_error = null;
    this._persist(row);
    return { ok: true, duplicate: false };
  }

  markRetry(taskId, { error, nextAt }) {
    const row = this.rows.get(String(taskId));
    if (!row || row.state !== 'pending') return;
    row.attempts = Number(row.attempts || 0) + 1;
    row.last_error = String(error || 'error').slice(0, 80);
    row.next_at = nextAt;
    this._persist(row);
  }

  markFailed(taskId, { error }) {
    const row = this.rows.get(String(taskId));
    if (!row || row.state !== 'pending') return;
    row.state = 'failed';
    row.attempts = Number(row.attempts || 0) + 1;
    row.last_error = String(error || 'error').slice(0, 80);
    if (row.ref && this.refs.get(row.ref) === row.task_id) this.refs.delete(row.ref);
    this._persist(row);
    this.alert({ event: 'public_attestation_failed', task_id: row.task_id, reason: row.last_error });
  }

  markSkipped(taskId, { reason }) {
    const row = this.rows.get(String(taskId));
    if (!row || row.state !== 'pending') return;
    row.state = 'skipped';
    row.reason = String(reason || 'ineligible').slice(0, 80);
    if (row.ref && this.refs.get(row.ref) === row.task_id) this.refs.delete(row.ref);
    this._persist(row);
  }

  /**
   * The public field, read only. `{ jws }` when signed, `{ status: 'pending' }`
   * while queued, null otherwise (failed, skipped, unknown: the 0.4.5 shell).
   */
  servedAttestation(taskId) {
    const row = this.rows.get(String(taskId));
    if (!row) return null;
    if (row.state === 'signed' && typeof row.jws === 'string') return { jws: row.jws };
    if (row.state === 'pending') return { status: 'pending' };
    return null;
  }

  counts() {
    const out = { pending: 0, signed: 0, failed: 0, skipped: 0 };
    for (const row of this.rows.values()) out[row.state] = (out[row.state] || 0) + 1;
    return out;
  }
}

let active = null;

export function configurePublicAttestationStore(opts = {}) {
  active = new PublicAttestationStore(opts);
  return active;
}

export function getPublicAttestationStore() {
  return active;
}

export function _resetPublicAttestationStoreForTest() {
  active = null;
}
