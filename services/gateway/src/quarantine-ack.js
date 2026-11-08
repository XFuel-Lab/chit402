/**
 * Public quarantine acknowledgement (chit402.quarantine_ack.v2).
 *
 * One signed document per quarantined log head. It names the head, says why
 * it is not served, names the head that replaces it, and carries a
 * consistency proof that the quarantined root is an earlier prefix of the
 * replacement root in the same epoch.
 *
 * Signing: ES256 compact JWS with the issuer key, header
 * { alg: 'ES256', typ: 'chit402-quarantine-ack+jwt', kid }. The payload
 * segment is the RFC 8785 (JCS) UTF-8 bytes of the claims. The typ keeps it
 * apart from tree heads, receipts and issuer history signed by the same key.
 *
 * The published document is the claims at top level plus `issuer_signature`.
 * A reader trusts only the signed payload; top-level fields must equal it.
 *
 * Node built-ins only, so the verifier side can be copied into other tools.
 */
import crypto from 'node:crypto';

export const QUARANTINE_ACK_SCHEMA_V2 = 'chit402.quarantine_ack.v2';
export const QUARANTINE_ACK_PAYLOAD_VERSION = 2;
export const QUARANTINE_ACK_TYP = 'chit402-quarantine-ack+jwt';

export const QUARANTINE_REASONS = Object.freeze(['publish_append_race']);

const HEX64 = /^[0-9a-f]{64}$/;
const EVM_TX = /^0x[0-9a-f]{64}$/;
const SOLANA_SIG = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const KID = /^[A-Za-z0-9_-]{43}$/;
const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

const TOP_KEYS = [
  'consistency', 'epoch', 'handling', 'iat', 'iss', 'payload_version',
  'quarantined_head', 'reason', 'replacement_head', 'schema',
];
const QUARANTINED_KEYS = ['anchors', 'head_jws_sha256', 'kid', 'prefix_size', 'published_at', 'root', 'tree_size'];
const REPLACEMENT_KEYS = ['anchors', 'published_at', 'root', 'tree_size'];
const CONSISTENCY_KEYS = ['first_tree_size', 'proof', 'second_tree_size'];
const HANDLING_KEYS = ['covered_by', 'escrow_register', 'head_served', 'inclusion_against_head', 'receipts_only_in_head', 'scope'];
export const HANDLING = Object.freeze({
  covered_by: 'replacement_head',
  escrow_register: 'excluded',
  head_served: false,
  inclusion_against_head: 'not_evidence',
  receipts_only_in_head: 0,
  scope: 'this_head_only',
});

/** RFC 8785 for the value types used here (strings, safe integers, booleans, null, arrays, objects). */
export function jcs(value) {
  if (value === null) return 'null';
  const type = typeof value;
  if (type === 'string') return JSON.stringify(value);
  if (type === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('quarantine ack allows safe integers only');
    return String(value);
  }
  if (type === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map(jcs).join(',')}]`;
  if (type === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${jcs(value[k])}`).join(',')}}`;
  }
  throw new Error(`cannot canonicalize ${type}`);
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest();
}

function nodeHash(left, right) {
  return sha256(Buffer.concat([Buffer.from([0x01]), left, right]));
}

function largestPowerOfTwoLessThan(n) {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

/**
 * RFC 6962 consistency check, same recipe as receipt-merkle.js
 * verifyConsistency. True only when the proof rebuilds both roots exactly.
 */
export function verifyConsistencyProof(m, n, oldRoot, newRoot, proof) {
  if (!Number.isSafeInteger(m) || !Number.isSafeInteger(n) || m < 1 || n < m) return false;
  if (!HEX64.test(String(oldRoot)) || !HEX64.test(String(newRoot))) return false;
  if (!Array.isArray(proof) || !proof.every((p) => HEX64.test(String(p)))) return false;
  if (m === n) return oldRoot === newRoot && proof.length === 0;
  if (proof.length === 0) return false;
  let i = 0;
  const take = () => {
    if (i >= proof.length) throw new Error('short_proof');
    return Buffer.from(proof[i++], 'hex');
  };
  const check = (start, end, oldEnd) => {
    if (end <= oldEnd) {
      const hash = take();
      return { hash, old: hash };
    }
    if (start >= oldEnd) return { hash: take(), old: null };
    const k = largestPowerOfTwoLessThan(end - start);
    const left = check(start, start + k, oldEnd);
    const right = check(start + k, end, oldEnd);
    const hash = nodeHash(left.hash, right.hash);
    let old = null;
    if (left.old && right.old) old = nodeHash(left.old, right.old);
    else if (left.old && start + k >= oldEnd) old = left.old;
    return { hash, old };
  };
  try {
    const rebuilt = check(0, n, m);
    if (i !== proof.length || !rebuilt.old) return false;
    return rebuilt.hash.toString('hex') === newRoot && rebuilt.old.toString('hex') === oldRoot;
  } catch {
    return false;
  }
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function exactKeys(obj, keys, path, errors) {
  if (!isObject(obj)) {
    errors.push(`${path}: not an object`);
    return false;
  }
  const got = Object.keys(obj).sort();
  const want = [...keys].sort();
  if (got.length !== want.length || got.some((k, idx) => k !== want[idx])) {
    errors.push(`${path}: keys must be exactly ${want.join(',')}`);
    return false;
  }
  return true;
}

function posInt(v) {
  return Number.isSafeInteger(v) && v >= 1;
}

function validAnchors(anchors, path, errors, { requireBase }) {
  if (!isObject(anchors)) {
    errors.push(`${path}: not an object`);
    return;
  }
  for (const key of Object.keys(anchors)) {
    if (key !== 'base' && key !== 'solana') errors.push(`${path}.${key}: unknown anchor`);
  }
  if (anchors.base !== undefined) {
    const b = anchors.base;
    if (exactKeys(b, ['chain_id', 'tx'], `${path}.base`, errors)) {
      if (b.chain_id !== 8453) errors.push(`${path}.base.chain_id: must be 8453`);
      if (!EVM_TX.test(String(b.tx))) errors.push(`${path}.base.tx: must be 0x plus 64 lowercase hex`);
    }
  } else if (requireBase) {
    errors.push(`${path}.base: required`);
  }
  if (anchors.solana !== undefined) {
    const s = anchors.solana;
    if (exactKeys(s, ['cluster', 'signature'], `${path}.solana`, errors)) {
      if (s.cluster !== 'mainnet-beta') errors.push(`${path}.solana.cluster: must be mainnet-beta`);
      if (!SOLANA_SIG.test(String(s.signature))) errors.push(`${path}.solana.signature: not base58`);
    }
  }
}

/**
 * Strict claim check. Returns every problem found, not only the first.
 * @param {object} claims
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateQuarantineAckClaims(claims) {
  const errors = [];
  if (!exactKeys(claims, TOP_KEYS, 'claims', errors)) return { ok: false, errors };
  if (claims.schema !== QUARANTINE_ACK_SCHEMA_V2) errors.push('schema: must be chit402.quarantine_ack.v2');
  if (claims.payload_version !== QUARANTINE_ACK_PAYLOAD_VERSION) errors.push('payload_version: must be 2');
  if (claims.iss !== 'chit402') errors.push('iss: must be chit402');
  if (!posInt(claims.iat)) errors.push('iat: must be a positive integer (unix seconds)');
  if (!posInt(claims.epoch)) errors.push('epoch: must be a positive integer');
  if (!QUARANTINE_REASONS.includes(claims.reason)) errors.push(`reason: must be one of ${QUARANTINE_REASONS.join(',')}`);

  const q = claims.quarantined_head;
  const r = claims.replacement_head;
  const c = claims.consistency;
  const qOk = exactKeys(q, QUARANTINED_KEYS, 'quarantined_head', errors);
  const rOk = exactKeys(r, REPLACEMENT_KEYS, 'replacement_head', errors);
  const cOk = exactKeys(c, CONSISTENCY_KEYS, 'consistency', errors);
  if (exactKeys(claims.handling, HANDLING_KEYS, 'handling', errors)) {
    for (const key of HANDLING_KEYS) {
      if (claims.handling[key] !== HANDLING[key]) errors.push(`handling.${key}: must be ${JSON.stringify(HANDLING[key])}`);
    }
  }
  if (qOk) {
    if (!posInt(q.tree_size)) errors.push('quarantined_head.tree_size: must be a positive integer');
    if (!posInt(q.prefix_size) || !(q.prefix_size < q.tree_size)) {
      errors.push('quarantined_head.prefix_size: must be a positive integer below tree_size');
    }
    if (!HEX64.test(String(q.root))) errors.push('quarantined_head.root: must be 64 lowercase hex');
    if (!ISO_MS.test(String(q.published_at))) errors.push('quarantined_head.published_at: must be an ISO 8601 UTC time');
    if (!KID.test(String(q.kid))) errors.push('quarantined_head.kid: must be a 43-character base64url kid');
    if (!HEX64.test(String(q.head_jws_sha256))) errors.push('quarantined_head.head_jws_sha256: must be 64 lowercase hex');
    validAnchors(q.anchors, 'quarantined_head.anchors', errors, { requireBase: false });
  }
  if (rOk) {
    if (!posInt(r.tree_size)) errors.push('replacement_head.tree_size: must be a positive integer');
    if (!HEX64.test(String(r.root))) errors.push('replacement_head.root: must be 64 lowercase hex');
    if (!ISO_MS.test(String(r.published_at))) errors.push('replacement_head.published_at: must be an ISO 8601 UTC time');
    validAnchors(r.anchors, 'replacement_head.anchors', errors, { requireBase: false });
  }
  if (qOk && rOk) {
    if (q.root === r.root) errors.push('replacement_head.root: must differ from the quarantined root');
    if (posInt(q.tree_size) && posInt(r.tree_size) && r.tree_size < q.tree_size) {
      errors.push('replacement_head.tree_size: must be at least the quarantined tree_size');
    }
  }
  if (cOk) {
    if (!Array.isArray(c.proof)) errors.push('consistency.proof: must be an array');
    if (qOk && c.first_tree_size !== q.prefix_size) errors.push('consistency.first_tree_size: must equal quarantined_head.prefix_size');
    if (rOk && c.second_tree_size !== r.tree_size) errors.push('consistency.second_tree_size: must equal replacement_head.tree_size');
  }
  if (errors.length === 0) {
    const proven = verifyConsistencyProof(c.first_tree_size, c.second_tree_size, q.root, r.root, c.proof);
    if (!proven) errors.push('consistency.proof: does not prove the quarantined root is a prefix of the replacement root');
  }
  return { ok: errors.length === 0, errors };
}

function b64urlJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/** Exact signing input: base64url(header JSON) "." base64url(JCS(claims)). */
export function quarantineAckSigningInput(claims, kid) {
  if (!KID.test(String(kid))) throw new Error('kid must be a 43-character base64url kid');
  const header = { alg: 'ES256', typ: QUARANTINE_ACK_TYP, kid };
  const payload = Buffer.from(jcs(claims), 'utf8').toString('base64url');
  return `${b64urlJson(header)}.${payload}`;
}

/**
 * Sign validated claims. `signer` is the gateway issuer signer shape:
 * { kid, publicJwk, sign(Buffer) -> 64-byte r||s }. The result is
 * self-verified under signer.publicJwk before it is returned.
 */
export async function signQuarantineAck(claims, signer) {
  const check = validateQuarantineAckClaims(claims);
  if (!check.ok) {
    const err = new Error(`quarantine ack claims invalid: ${check.errors.join('; ')}`);
    err.code = 'quarantine_ack_invalid';
    throw err;
  }
  if (!signer || typeof signer.sign !== 'function' || !signer.publicJwk) {
    throw new Error('signer must have sign() and publicJwk');
  }
  const input = quarantineAckSigningInput(claims, signer.kid);
  const sig = Buffer.from(await signer.sign(Buffer.from(input, 'utf8')));
  if (sig.length !== 64) throw new Error('signer must return a 64-byte r||s signature');
  const jws = `${input}.${sig.toString('base64url')}`;
  const doc = {
    ...JSON.parse(jcs(claims)),
    issuer_signature: {
      alg: 'ES256',
      typ: QUARANTINE_ACK_TYP,
      payload_version: QUARANTINE_ACK_PAYLOAD_VERSION,
      kid: signer.kid,
      jws,
    },
  };
  const self = verifyQuarantineAck(doc, { keys: [{ ...signer.publicJwk, kid: signer.kid }] });
  if (!self.ok) throw new Error(`self-verify failed: ${self.reason}`);
  return doc;
}

function decodeSegment(seg) {
  return Buffer.from(String(seg), 'base64url');
}

function verifyEs256(input, sigBytes, jwk) {
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) return false;
  if (sigBytes.length !== 64) return false;
  try {
    const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, format: 'jwk' });
    return crypto.verify('sha256', Buffer.from(input, 'utf8'), { key, dsaEncoding: 'ieee-p1363' }, sigBytes);
  } catch {
    return false;
  }
}

/**
 * Verify a published quarantine ack.
 * @param {object} doc published document
 * @param {{ keys: object[] }} keyset keys from the issuer history (never a key the document carries)
 * @returns {{ ok: boolean, reason: string|null, claims?: object, errors?: string[] }}
 */
export function verifyQuarantineAck(doc, keyset) {
  if (!isObject(doc)) return { ok: false, reason: 'not_an_object' };
  const sig = doc.issuer_signature;
  if (!isObject(sig) || typeof sig.jws !== 'string') return { ok: false, reason: 'unsigned' };
  const parts = sig.jws.split('.');
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return { ok: false, reason: 'bad_jws' };
  let header;
  let claims;
  try {
    header = JSON.parse(decodeSegment(parts[0]).toString('utf8'));
    claims = JSON.parse(decodeSegment(parts[1]).toString('utf8'));
  } catch {
    return { ok: false, reason: 'bad_jws' };
  }
  if (!exactKeys(header, ['alg', 'kid', 'typ'], 'header', [])) return { ok: false, reason: 'bad_header' };
  if (header.alg !== 'ES256') return { ok: false, reason: 'bad_alg' };
  if (header.typ !== QUARANTINE_ACK_TYP) return { ok: false, reason: 'wrong_typ' };
  if (sig.kid !== header.kid || sig.typ !== QUARANTINE_ACK_TYP || sig.alg !== 'ES256') {
    return { ok: false, reason: 'signature_block_mismatch' };
  }
  const keys = Array.isArray(keyset?.keys) ? keyset.keys : [];
  const key = keys.find((k) => k && k.kid === header.kid);
  if (!key) return { ok: false, reason: 'kid_not_trusted' };
  if (!verifyEs256(`${parts[0]}.${parts[1]}`, decodeSegment(parts[2]), key)) {
    return { ok: false, reason: 'signature_invalid' };
  }
  let canonical;
  try {
    canonical = jcs(claims);
  } catch {
    return { ok: false, reason: 'payload_not_canonical' };
  }
  if (decodeSegment(parts[1]).toString('utf8') !== canonical) return { ok: false, reason: 'payload_not_canonical' };
  const check = validateQuarantineAckClaims(claims);
  if (!check.ok) return { ok: false, reason: 'claims_invalid', errors: check.errors };
  const { issuer_signature: _sig, ...outer } = doc;
  let outerCanonical;
  try {
    outerCanonical = jcs(outer);
  } catch {
    return { ok: false, reason: 'outer_mismatch' };
  }
  if (outerCanonical !== canonical) return { ok: false, reason: 'outer_mismatch' };
  return { ok: true, reason: null, claims };
}

/** sha256 hex of the JCS bytes of a whole published document, for a register entry. */
export function quarantineAckDocumentHash(doc) {
  return sha256(Buffer.from(jcs(doc), 'utf8')).toString('hex');
}

export const FILL_FROM_JOURNAL = 'FILL_FROM_JOURNAL';
const TREE_HEAD_TYP = 'chit402-tree-head+jwt';

function decodeJws(jws) {
  const parts = String(jws || '').split('.');
  if (parts.length !== 3) return null;
  try {
    return {
      header: JSON.parse(decodeSegment(parts[0]).toString('utf8')),
      payload: JSON.parse(decodeSegment(parts[1]).toString('utf8')),
      input: `${parts[0]}.${parts[1]}`,
      sig: decodeSegment(parts[2]),
    };
  } catch {
    return null;
  }
}

/**
 * Signed head rows from receipt-log journal text, grouped by epoch.
 * Read-only: parses lines, never writes.
 */
export function journalHeads(journalText) {
  const out = [];
  let epoch = null;
  for (const line of String(journalText || '').split('\n')) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      throw new Error('journal line does not parse');
    }
    if (row.op === 'epoch_open') epoch = Number(row.epoch);
    if (row.op !== 'head' || !isObject(row.head)) continue;
    const jws = row.head.issuer_signature?.jws || null;
    out.push({ epoch, head: row.head, jws, decoded: jws ? decodeJws(jws) : null });
  }
  return out;
}

function sameHead(entry, epoch, treeSize, root) {
  const signed = entry.decoded?.payload;
  if (!signed) return false;
  return entry.epoch === epoch
    && Number(signed.tree_size) === treeSize
    && String(signed.root || '').replace(/^0x/, '').toLowerCase() === root;
}

/**
 * Fill the journal-only fields of a draft (the quarantined head's signed
 * published_at, kid and JWS hash) and set iat. Checks the replacement head's
 * signed time and both heads' Base anchors against the journal. Throws on
 * any disagreement. `verifyKey`, when given, must verify the stored head JWS.
 * @returns {object} claims ready for validateQuarantineAckClaims
 */
export function fillQuarantineAckFromJournal(draft, journalText, { nowSeconds, verifyKey = null } = {}) {
  if (!isObject(draft) || draft.schema !== QUARANTINE_ACK_SCHEMA_V2) throw new Error('draft is not a chit402.quarantine_ack.v2 draft');
  const claims = JSON.parse(JSON.stringify(draft));
  const q = claims.quarantined_head;
  const r = claims.replacement_head;
  const heads = journalHeads(journalText);
  const raced = heads.filter((e) => sameHead(e, claims.epoch, q.tree_size, q.root));
  if (raced.length !== 1) throw new Error(`expected exactly one signed journal head for the quarantined root, found ${raced.length}`);
  const rh = raced[0].decoded;
  if (rh.header.typ !== TREE_HEAD_TYP) throw new Error('quarantined journal head is not a tree head JWS');
  if (verifyKey && rh.header.kid === verifyKey.kid && !verifyEs256(rh.input, rh.sig, verifyKey)) {
    throw new Error('quarantined journal head JWS does not verify under the issuer key');
  }
  const fill = (field, value) => {
    if (q[field] === FILL_FROM_JOURNAL || q[field] == null) q[field] = value;
    else if (q[field] !== value) throw new Error(`quarantined_head.${field} in the draft does not match the journal`);
  };
  fill('published_at', String(rh.payload.published_at));
  fill('kid', String(rh.header.kid));
  fill('head_jws_sha256', sha256(Buffer.from(raced[0].jws, 'utf8')).toString('hex'));
  const racedTx = rh.payload.anchors?.base?.tx || rh.payload.anchor_tx || null;
  if (q.anchors?.base?.tx && racedTx && String(racedTx).toLowerCase() !== q.anchors.base.tx) {
    throw new Error('quarantined head Base tx in the draft does not match the signed head');
  }
  const repl = heads.filter((e) => sameHead(e, claims.epoch, r.tree_size, r.root));
  if (repl.length < 1) throw new Error('replacement head is not in the journal');
  const rp = repl[0].decoded.payload;
  if (String(rp.published_at) !== r.published_at) throw new Error('replacement_head.published_at does not match the signed head');
  const replTx = rp.anchors?.base?.tx || rp.anchor_tx || null;
  if (r.anchors?.base?.tx && replTx && String(replTx).toLowerCase() !== r.anchors.base.tx) {
    throw new Error('replacement head Base tx in the draft does not match the signed head');
  }
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 1) throw new Error('nowSeconds is required');
  claims.iat = nowSeconds;
  return claims;
}

/**
 * Head identity for exclusion: (epoch, tree_size, root, head_jws_sha256).
 * A root alone never identifies a head: the same root is an honest head at
 * its true size. `head` is { epoch, tree_size, root } plus either `jws`
 * (the compact head JWS) or `head_jws_sha256`.
 * @returns {{ epoch: number, tree_size: number, root: string, head_jws_sha256: string } | null}
 */
export function headIdentity(head) {
  if (!isObject(head)) return null;
  const epoch = head.epoch;
  const treeSize = head.tree_size;
  const root = typeof head.root === 'string' ? head.root : null;
  let jwsHash = null;
  if (typeof head.jws === 'string' && head.jws.length > 0) {
    jwsHash = sha256(Buffer.from(head.jws, 'utf8')).toString('hex');
    if (head.head_jws_sha256 != null && head.head_jws_sha256 !== jwsHash) return null;
  } else if (typeof head.head_jws_sha256 === 'string') {
    jwsHash = head.head_jws_sha256;
  }
  if (!posInt(epoch) || !posInt(treeSize) || !HEX64.test(String(root)) || !HEX64.test(String(jwsHash))) return null;
  return { epoch, tree_size: treeSize, root, head_jws_sha256: jwsHash };
}

/** True when two identities name the same signed head. All four parts must match. */
export function sameHeadIdentity(a, b) {
  return !!a && !!b
    && a.epoch === b.epoch
    && a.tree_size === b.tree_size
    && a.root === b.root
    && a.head_jws_sha256 === b.head_jws_sha256;
}

/**
 * Does this verified ack name exactly this head? Matching is by
 * (epoch, tree_size, root, head_jws_sha256). A head with an incomplete
 * identity is never matched, so a root-only lookup always returns false.
 */
export function ackExcludesHead(claims, head) {
  if (!isObject(claims) || !isObject(claims.quarantined_head)) return false;
  const want = headIdentity({ ...claims.quarantined_head, epoch: claims.epoch, jws: undefined });
  return sameHeadIdentity(want, headIdentity(head));
}
