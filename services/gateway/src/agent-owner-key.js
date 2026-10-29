/**
 * Binds an agent owner key to a registered agent_id.
 * The registered agent wallet and the key itself both sign the bind message.
 * Sessions opened with that key are the only path into that agent's book.
 * The receipt issuer key is not used here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';
import { persistFailed } from './persist-error.js';
import { writeAtomicJson } from './atomic-json-file.js';

export function agentBindMessage(agentId, publicKey) {
  return `Chit402 agent key bind v1\nagent_id:${agentId}\npubkey:${publicKey}`;
}

const OWNER_ADDRESS = /^0x[0-9a-f]{40}$/;

function assertOwnerRow(key, row) {
  const id = Number(key);
  if (!Number.isInteger(id) || id < 1 || String(id) !== String(key)) {
    throw new Error('owner key row rejected');
  }
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('owner key row rejected');
  }
  if (Number(row.agentId) !== id) throw new Error('owner key row rejected');
  if (typeof row.publicKey !== 'string' || !OWNER_ADDRESS.test(row.publicKey)) {
    throw new Error('owner key row rejected');
  }
  if (typeof row.boundAt !== 'number') throw new Error('owner key row rejected');
}

export class AgentOwnerKeyStore {
  /**
   * @param {{ dir?: string|null, persist?: boolean, fs?: object }} [opts]
   */
  constructor({ dir = null, persist = false, fs: fsImpl = null } = {}) {
    this.byAgent = new Map();
    this.dir = persist && dir ? String(dir) : null;
    this.persist = !!this.dir;
    this._fs = fsImpl || undefined;
    if (this.persist) {
      try {
        fs.mkdirSync(this.dir, { recursive: true });
        this._load();
      } catch (err) {
        throw err?.code === 'persist_failed' ? err : persistFailed(err, 'agent-owner-key: mkdir failed');
      }
    }
  }

  _file() {
    return path.join(this.dir, 'agent-owner-keys.json');
  }

  _load() {
    let raw;
    try {
      raw = fs.readFileSync(this._file(), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw persistFailed(err, 'agent-owner-key: load failed');
    }
    let snap;
    try {
      snap = JSON.parse(raw);
    } catch (err) {
      throw persistFailed(err, 'agent-owner-key: load failed');
    }
    if (!snap || typeof snap !== 'object' || Array.isArray(snap) || snap.version !== 1) {
      throw persistFailed(new Error('owner key store shape'), 'agent-owner-key: load failed');
    }
    const bindings = snap.bindings;
    if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) {
      throw persistFailed(new Error('owner key store shape'), 'agent-owner-key: load failed');
    }
    for (const [key, row] of Object.entries(bindings)) {
      try {
        assertOwnerRow(key, row);
      } catch (err) {
        throw persistFailed(err, 'agent-owner-key: load failed');
      }
      this.byAgent.set(Number(row.agentId), {
        agentId: row.agentId,
        publicKey: row.publicKey,
        boundAt: row.boundAt,
      });
    }
  }

  _save() {
    if (!this.persist) return;
    const bindings = {};
    for (const [id, row] of this.byAgent) {
      bindings[String(id)] = {
        agentId: row.agentId,
        publicKey: row.publicKey,
        boundAt: row.boundAt,
      };
    }
    writeAtomicJson(this._file(), { version: 1, bindings }, {
      fs: this._fs,
      label: 'agent-owner-key: save failed',
    });
  }

  get(agentId) {
    return this.byAgent.get(Number(agentId)) || null;
  }

  /**
   * @param {{ agentId: number|string, publicKey: string, walletSignature: string, keySignature: string, agentWallet: string }} input
   */
  bind({ agentId, publicKey, walletSignature, keySignature, agentWallet }) {
    const id = Number(agentId);
    if (!Number.isInteger(id) || id < 1) return { ok: false };
    if (!publicKey || !walletSignature || !keySignature || !agentWallet) return { ok: false };
    const message = agentBindMessage(id, publicKey);
    let wallet;
    let key;
    try {
      wallet = ethers.verifyMessage(message, walletSignature);
      key = ethers.verifyMessage(message, keySignature);
    } catch {
      return { ok: false };
    }
    if (wallet.toLowerCase() !== String(agentWallet).toLowerCase()) return { ok: false };
    if (key.toLowerCase() !== String(publicKey).toLowerCase()) return { ok: false };
    const row = {
      agentId: id,
      publicKey: key.toLowerCase(),
      boundAt: Date.now(),
    };
    const had = this.byAgent.has(id);
    const prior = this.byAgent.get(id);
    this.byAgent.set(id, row);
    try {
      this._save();
    } catch (err) {
      if (had) this.byAgent.set(id, prior);
      else this.byAgent.delete(id);
      throw err;
    }
    return { ok: true, row };
  }
}
