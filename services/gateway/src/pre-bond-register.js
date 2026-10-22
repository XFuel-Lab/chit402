/**
 * PROPOSED pre-bond register (chit402.pre_bond_register.v0).
 *
 * Every signed log head as of bond start, each marked `good` or
 * `excluded`. An excluded entry points to a public quarantine ack by the
 * SHA-256 of that ack document. The register hash below is what the bond
 * pins at deploy; that pinned hash, not any later file, decides which heads
 * are excluded.
 *
 * Status: proposed. Not used by the gateway. Node built-ins only.
 */
import crypto from 'node:crypto';
import {
  ackExcludesHead,
  headIdentity,
  jcs,
  quarantineAckDocumentHash,
  sameHeadIdentity,
  verifyQuarantineAck,
} from './quarantine-ack.js';

export const PRE_BOND_REGISTER_SCHEMA = 'chit402.pre_bond_register.v0';
/** Domain separator for the register hash. The NUL keeps it from being a JSON prefix. */
export const PRE_BOND_REGISTER_DOMAIN = 'chit402.pre_bond_register.v0\u0000';

const HEX64 = /^[0-9a-f]{64}$/;
const KID = /^[A-Za-z0-9_-]{43}$/;
const ISO_S = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const TOP_KEYS = ['as_of', 'heads', 'issuer_kid', 'schema'];
const ENTRY_KEYS = ['ack_sha256', 'epoch', 'head_jws_sha256', 'root', 'status', 'tree_size'];

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function sameKeys(obj, keys) {
  if (!isObject(obj)) return false;
  const got = Object.keys(obj).sort();
  return got.length === keys.length && got.every((k, i) => k === keys[i]);
}

function posInt(v) {
  return Number.isSafeInteger(v) && v >= 1;
}

function entryOrder(a, b) {
  if (a.epoch !== b.epoch) return a.epoch - b.epoch;
  if (a.tree_size !== b.tree_size) return a.tree_size - b.tree_size;
  if (a.root !== b.root) return a.root < b.root ? -1 : 1;
  if (a.head_jws_sha256 !== b.head_jws_sha256) return a.head_jws_sha256 < b.head_jws_sha256 ? -1 : 1;
  return 0;
}

/**
 * sha256( "chit402.pre_bond_register.v0" || 0x00 || JCS(register) ), hex.
 * This is the value the bond pins at deploy.
 */
export function preBondRegisterHash(register) {
  return crypto.createHash('sha256')
    .update(Buffer.from(PRE_BOND_REGISTER_DOMAIN, 'utf8'))
    .update(Buffer.from(jcs(register), 'utf8'))
    .digest('hex');
}

/**
 * Shape check, then (when `acks` and `keys` are given) the ack check for
 * each excluded entry: the ack's document hash is `ack_sha256`, it verifies
 * under `keys`, it names this exact head by all four parts, and its `iat`
 * is before `as_of` (bond start).
 * @param {object} register
 * @param {{ acks?: object[], keys?: object[] }} [opts]
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validatePreBondRegister(register, { acks = null, keys = null } = {}) {
  const errors = [];
  if (!sameKeys(register, TOP_KEYS)) return { ok: false, errors: [`register: keys must be exactly ${TOP_KEYS.join(',')}`] };
  if (register.schema !== PRE_BOND_REGISTER_SCHEMA) errors.push(`schema: must be ${PRE_BOND_REGISTER_SCHEMA}`);
  if (!ISO_S.test(String(register.as_of)) || Number.isNaN(Date.parse(register.as_of))) {
    errors.push('as_of: must be bond start as YYYY-MM-DDTHH:MM:SSZ');
  }
  if (!KID.test(String(register.issuer_kid))) errors.push('issuer_kid: must be a 43-character base64url kid');
  if (!Array.isArray(register.heads) || register.heads.length === 0) {
    errors.push('heads: must be a non-empty array');
    return { ok: false, errors };
  }
  register.heads.forEach((e, i) => {
    const p = `heads[${i}]`;
    if (!sameKeys(e, ENTRY_KEYS)) {
      errors.push(`${p}: keys must be exactly ${ENTRY_KEYS.join(',')}`);
      return;
    }
    if (!posInt(e.epoch)) errors.push(`${p}.epoch: must be a positive integer`);
    if (!posInt(e.tree_size)) errors.push(`${p}.tree_size: must be a positive integer`);
    if (!HEX64.test(String(e.root))) errors.push(`${p}.root: must be 64 lowercase hex`);
    if (!HEX64.test(String(e.head_jws_sha256))) errors.push(`${p}.head_jws_sha256: must be 64 lowercase hex`);
    if (e.status === 'good') {
      if (e.ack_sha256 !== null) errors.push(`${p}.ack_sha256: must be null for a good head`);
    } else if (e.status === 'excluded') {
      if (!HEX64.test(String(e.ack_sha256))) errors.push(`${p}.ack_sha256: must be 64 lowercase hex for an excluded head`);
    } else {
      errors.push(`${p}.status: must be good or excluded`);
    }
    if (i > 0 && sameKeys(register.heads[i - 1], ENTRY_KEYS) && entryOrder(register.heads[i - 1], e) >= 0) {
      errors.push(`${p}: entries must be strictly sorted by (epoch, tree_size, root, head_jws_sha256) with no duplicates`);
    }
  });
  if (errors.length) return { ok: false, errors };

  if (acks !== null || keys !== null) {
    const bondStart = Math.floor(Date.parse(register.as_of) / 1000);
    const byHash = new Map((acks || []).map((doc) => [quarantineAckDocumentHash(doc), doc]));
    register.heads.forEach((e, i) => {
      if (e.status !== 'excluded') return;
      const p = `heads[${i}]`;
      const doc = byHash.get(e.ack_sha256);
      if (!doc) {
        errors.push(`${p}: no ack document with this ack_sha256`);
        return;
      }
      const v = verifyQuarantineAck(doc, { keys: keys || [] });
      if (!v.ok) {
        errors.push(`${p}: ack does not verify (${v.reason})`);
        return;
      }
      if (!ackExcludesHead(v.claims, e)) errors.push(`${p}: ack names a different head (epoch, tree_size, root and head JWS hash must all match)`);
      if (!(v.claims.iat < bondStart)) errors.push(`${p}: ack iat is not before bond start (as_of)`);
    });
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Is this signed head excluded by the register? Lookup is by all four parts.
 * A head given by root alone, or with any part missing, is never excluded.
 * A head not on the register is not excluded (it counts as post-bond).
 */
export function registerExcludes(register, head) {
  const id = headIdentity(head);
  if (!id || !isObject(register) || !Array.isArray(register.heads)) return false;
  return register.heads.some((e) => e.status === 'excluded' && sameHeadIdentity(headIdentity(e), id));
}

/** Is this signed head on the register at all (good or excluded)? Same four-part lookup. */
export function registerLists(register, head) {
  const id = headIdentity(head);
  if (!id || !isObject(register) || !Array.isArray(register.heads)) return false;
  return register.heads.some((e) => sameHeadIdentity(headIdentity(e), id));
}

/**
 * May an inclusion proof against this head be used as evidence at all?
 * Never for an excluded head: not to show a receipt is in the log and not
 * to show it is missing. Other heads are subject to the normal checks.
 */
export function inclusionEvidenceAllowed(register, head) {
  return !registerExcludes(register, head);
}
