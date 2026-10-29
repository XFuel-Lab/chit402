/**
 * Binds an agent owner key to a registered agent_id.
 * The registered agent wallet and the key itself both sign the bind message.
 * Sessions opened with that key are the only path into that agent's book.
 * The receipt issuer key is not used here.
 * When persist is on, the map is agent-owner-keys.json in the agents dir.
 * The file holds addresses, not secrets.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';
import { persistFailed } from './persist-error.js';
import { unlinkStaleAtomicTemps, writeAtomicJsonFile } from './atomic-json-file.js';

const ADDRESS = /^0x[0-9a-f]{40}$/;

export function agentBindMessage(agentId, publicKey) {
  return `Chit402 agent key bind v1\nagent_id:${agentId}\npubkey:${publicKey}`;
}

function rejectOwnerRow() {
  throw persistFailed(new Error('bad owner-key row'), 'agent-owner-key: load failed');
}

function validateOwnerBinding(key, row) {
  const id = Number(key);
  if (!Number.isInteger(id) || id < 1 || String(id) !== key) rejectOwnerRow();
  if (!row || typeof row !== 'object' || Array.isArray(row) || row.agentId !== id) rejectOwnerRow();
  if (typeof row.publicKey !== 'string' || !ADDRESS.test(row.publicKey)) rejectOwnerRow();
  if (!Number.isInteger(row.boundAt)) rejectOwnerRow();
  return {
    agentId: id,
    publicKey: row.publicKey,
    boundAt: row.boundAt,
  };
}

export class AgentOwnerKeyStore {
  /**
   * @param {{ dir?: string|null, persist?: boolean, fs?: typeof import('node:fs') }} [opts]
   */
  constructor({ dir = null, persist = false, fs: fsImpl = fs } = {}) {
    this.dir = persist && dir ? String(dir) : null;
    this.persist = !!this.dir;
    this._fs = fsImpl;
    this.byAgent = new Map();
    if (this.persist) {
      try {
        this._fs.mkdirSync(this.dir, { recursive: true });
        unlinkStaleAtomicTemps(this.dir, this._fs);
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
      raw = this._fs.readFileSync(this._file(), 'utf8');
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
      throw persistFailed(new Error('agent-owner-key shape'), 'agent-owner-key: load failed');
    }
    const bindings = snap.bindings;
    if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) {
      throw persistFailed(new Error('bindings map missing'), 'agent-owner-key: load failed');
    }
    for (const [key, row] of Object.entries(bindings)) {
      const binding = validateOwnerBinding(key, row);
      this.byAgent.set(binding.agentId, binding);
    }
  }

  _save() {
    if (!this.persist) return;
    const bindings = {};
    for (const [key, row] of this.byAgent) {
      bindings[String(key)] = {
        agentId: row.agentId,
        publicKey: row.publicKey,
        boundAt: row.boundAt,
      };
    }
    writeAtomicJsonFile(this._file(), JSON.stringify({ version: 1, bindings }), {
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
    const prior = had ? this.byAgent.get(id) : undefined;
    this.byAgent.set(id, row);
    try {
      this._save(); // bind persist
    } catch (err) {
      if (had) this.byAgent.set(id, prior);
      else this.byAgent.delete(id);
      throw err;
    }
    return { ok: true, row };
  }
}
