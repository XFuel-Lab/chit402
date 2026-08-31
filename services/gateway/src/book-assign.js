/**
 * Book Assignment — possession-gated slice grants for an agent's book.
 *
 * Possession holder can grant read (and optionally collect) of a window/slice
 * to a new owner without delegating spend. Does not leak a public agent list.
 *
 * Per whitepaper: "this week's inference is now the auditor's pack."
 *
 * Assignment types:
 *   read    — can read entries in the slice
 *   collect — can collect (export, claim) entries in the slice
 *
 * Slice definition:
 *   from_date / to_date — date range (ISO 8601)
 *   task_ids — explicit list of task_ids
 *   limit — last N entries
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import logger from './logger.js';

export const GRANT_TYPES = {
  READ: 'read',
  COLLECT: 'collect',
};

export class BookAssignmentStore {
  /**
   * @param {{ dir?: string|null, persist?: boolean }} [opts]
   */
  constructor({ dir = null, persist = false } = {}) {
    this.dir = persist && dir ? String(dir) : null;
    this.persist = !!this.dir;
    /** @type {Map<string, object>} assignmentId → assignment object */
    this.assignments = new Map();
    /** @type {Map<number, string[]>} agentId → assignment ids */
    this.byAgent = new Map();

    if (this.persist) {
      try {
        fs.mkdirSync(this.dir, { recursive: true });
        this._load();
      } catch (err) {
        logger.warn({ err: err.message, dir: this.dir }, 'book-assign: persist disabled');
        this.persist = false;
        this.dir = null;
      }
    }
  }

  _file() {
    return path.join(this.dir, 'book-assignments.json');
  }

  _load() {
    try {
      const data = JSON.parse(fs.readFileSync(this._file(), 'utf8'));
      for (const a of data.assignments || []) {
        this.assignments.set(a.assignment_id, a);
        const agentAssigns = this.byAgent.get(a.agent_id) || [];
        agentAssigns.push(a.assignment_id);
        this.byAgent.set(a.agent_id, agentAssigns);
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn({ err: err.message }, 'book-assign: load failed');
      }
    }
  }

  _save() {
    if (!this.persist) return;
    try {
      const target = this._file();
      const tmp = `${target}.tmp-${process.pid}`;
      const assignments = [...this.assignments.values()];
      fs.writeFileSync(tmp, JSON.stringify({ assignments }));
      fs.renameSync(tmp, target);
    } catch (err) {
      logger.warn({ err: err.message }, 'book-assign: save failed');
    }
  }

  /**
   * Generate a unique assignment token for the grantee.
   */
  _generateToken() {
    return `xfuel-assign-${crypto.randomBytes(16).toString('hex')}`;
  }

  /**
   * Create an assignment. Possession-gated (caller verifies).
   * @param {number|string} agentId
   * @param {{ grant_type: string, grantee?: string, slice: object, expires_at?: string }} opts
   */
  create(agentId, { grant_type, grantee = null, slice = {}, expires_at = null } = {}) {
    const id = Number(agentId);
    if (!Number.isInteger(id) || id < 1) {
      return { ok: false, reason: 'invalid agent_id' };
    }
    if (!Object.values(GRANT_TYPES).includes(grant_type)) {
      return { ok: false, reason: `invalid grant_type: ${grant_type}` };
    }
    if (!slice || typeof slice !== 'object') {
      return { ok: false, reason: 'slice definition required' };
    }

    const hasSliceDef = slice.from_date || slice.to_date || slice.task_ids || slice.limit;
    if (!hasSliceDef) {
      return { ok: false, reason: 'slice must define from_date, to_date, task_ids, or limit' };
    }

    const assignmentId = `assign-${crypto.randomBytes(8).toString('hex')}`;
    const token = this._generateToken();

    const assignment = {
      assignment_id: assignmentId,
      agent_id: id,
      grant_type,
      grantee: grantee || null,
      token,
      slice: {
        from_date: slice.from_date || null,
        to_date: slice.to_date || null,
        task_ids: Array.isArray(slice.task_ids) ? slice.task_ids : null,
        limit: slice.limit ? Number(slice.limit) : null,
      },
      expires_at: expires_at || null,
      created_at: new Date().toISOString(),
      revoked: false,
    };

    this.assignments.set(assignmentId, assignment);
    const agentAssigns = this.byAgent.get(id) || [];
    agentAssigns.push(assignmentId);
    this.byAgent.set(id, agentAssigns);
    this._save();

    return { ok: true, assignment };
  }

  /**
   * Get an assignment by ID. Does not verify possession.
   * @param {string} assignmentId
   */
  get(assignmentId) {
    return this.assignments.get(String(assignmentId)) || null;
  }

  /**
   * Get an assignment by token. Used by grantee to access the slice.
   * @param {string} token
   */
  getByToken(token) {
    for (const a of this.assignments.values()) {
      if (a.token === token && !a.revoked) {
        if (a.expires_at && new Date(a.expires_at) < new Date()) {
          continue;
        }
        return a;
      }
    }
    return null;
  }

  /**
   * List assignments for an agent. Possession-gated (caller verifies).
   * @param {number|string} agentId
   */
  listByAgent(agentId) {
    const id = Number(agentId);
    const assignIds = this.byAgent.get(id) || [];
    return assignIds.map(aid => this.assignments.get(aid)).filter(Boolean);
  }

  /**
   * Revoke an assignment. Possession-gated (caller verifies).
   * @param {number|string} agentId
   * @param {string} assignmentId
   */
  revoke(agentId, assignmentId) {
    const id = Number(agentId);
    const assignment = this.assignments.get(String(assignmentId));
    if (!assignment || assignment.agent_id !== id) {
      return { ok: false, reason: 'assignment not found or wrong agent' };
    }
    assignment.revoked = true;
    assignment.revoked_at = new Date().toISOString();
    this._save();
    return { ok: true, assignment };
  }
}

/**
 * Filter ledger entries by slice definition.
 * @param {object[]} entries
 * @param {{ from_date?: string, to_date?: string, task_ids?: string[], limit?: number }} slice
 */
export function filterBySlice(entries, slice = {}) {
  let filtered = [...entries];

  if (slice.from_date) {
    const from = new Date(slice.from_date);
    filtered = filtered.filter(e => {
      const at = new Date(e.collected_at || e.recorded_at);
      return at >= from;
    });
  }

  if (slice.to_date) {
    const to = new Date(slice.to_date);
    filtered = filtered.filter(e => {
      const at = new Date(e.collected_at || e.recorded_at);
      return at <= to;
    });
  }

  if (slice.task_ids && Array.isArray(slice.task_ids)) {
    const ids = new Set(slice.task_ids.map(String));
    filtered = filtered.filter(e => ids.has(String(e.task_id)));
  }

  if (slice.limit && Number(slice.limit) > 0) {
    filtered = filtered.slice(-Number(slice.limit));
  }

  return filtered;
}

/**
 * Read a slice of the book using an assignment token.
 * Does not require possession — the token IS the access credential.
 *
 * @param {string} token
 * @param {{
 *   assignments: BookAssignmentStore,
 *   ledger: { listByAgent: Function },
 * }} deps
 */
export function readSliceByToken(token, { assignments, ledger } = {}) {
  if (!token || !assignments || !ledger) {
    return { status: 401, body: null };
  }

  const assignment = assignments.getByToken(token);
  if (!assignment) {
    return { status: 403, body: null };
  }

  if (assignment.expires_at && new Date(assignment.expires_at) < new Date()) {
    return { status: 403, body: null, reason: 'assignment expired' };
  }

  const entries = ledger.listByAgent(assignment.agent_id, { limit: 200 });
  const sliced = filterBySlice(entries, assignment.slice);

  return {
    status: 200,
    body: {
      assignment_id: assignment.assignment_id,
      agent_id: assignment.agent_id,
      grant_type: assignment.grant_type,
      slice: assignment.slice,
      entries: sliced.map(e => ({
        task_id: e.task_id,
        payment: {
          ref: e.payment_ref,
          rail: e.rail,
          amount: e.amount ?? null,
        },
        collected_at: e.collected_at || e.recorded_at || null,
        route: (e.model || e.hub) ? {
          ...(e.model ? { model: e.model } : {}),
          ...(e.hub ? { hub: e.hub } : {}),
        } : undefined,
        parent_ref: e.parent_ref || null,
      })),
      expires_at: assignment.expires_at,
    },
  };
}

let _assignStore = null;

export function getBookAssignmentStore(opts) {
  if (!_assignStore) _assignStore = new BookAssignmentStore(opts);
  return _assignStore;
}

export function resetBookAssignmentStore() {
  _assignStore = null;
}

export default {
  BookAssignmentStore,
  GRANT_TYPES,
  filterBySlice,
  readSliceByToken,
  getBookAssignmentStore,
  resetBookAssignmentStore,
};
