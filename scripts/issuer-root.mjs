/**
 * Off-chain reference for ChitIssuerRoot.
 *
 * Commitment (matches `commitmentHash` / `commit`):
 *   keccak256(abi.encode(
 *     prevRootHash, rootSeq, chainId, registry,
 *     ops, freezes, histVersion, histSnapshot))
 *
 * Op tuple: (uint8 kind, bytes32 kid, uint64 timestamp, uint8 reasonCode)
 *   1 ADD_STANDBY  timestamp = notBefore, reasonCode = 0
 *   2 PROMOTE      timestamp = 0,         reasonCode = 0
 *   3 RETIRE       timestamp = notAfter,  reasonCode = 0
 *   4 REVOKE       timestamp = revokedAt, reasonCode in {1, 2, 3, 255}
 * FreezeArg tuple: (bytes32 universeId, bytes32 universeHash, uint64 enumeratedCount)
 *
 * Legacy-freeze Merkle root. Same rules as
 * services/gateway/src/legacy-receipt-merkle.js on
 * cursor/gateway-v11-issuer-root-5306 (not the daily receipt tree):
 *   leaf = SHA-256(0x00 || payload_hash bytes)
 *   node = SHA-256(0x01 || left || right)
 *   sort payload_hash bytes ascending (stable for ties), then hash
 *   duplicate the last node when a level has more than one node and an odd count
 *   a single leaf is the root
 *   empty root = SHA-256(0x00)
 * Domain separation blocks a node from being reused as a leaf.
 *
 * Legacy universe id (sha256 of the JCS universe object):
 *   0xb623c1816e895dd967c4e51f0e066dafda546195a909e9b51283be4b5109caf4
 * Vectors: test/fixtures/legacy-merkle-vectors.json, copied from
 * services/gateway/test/fixtures/legacy-merkle-vectors.json on that branch.
 */
import { createHash } from 'node:crypto';
import { AbiCoder, getBytes, hexlify, keccak256 } from 'ethers';

export const OP = Object.freeze({
  ADD_STANDBY: 1,
  PROMOTE: 2,
  RETIRE: 3,
  REVOKE: 4,
});

export const REASON = Object.freeze({
  COMPROMISE: 1,
  SUPERSEDED: 2,
  LOST: 3,
  OTHER: 255,
});

const coder = AbiCoder.defaultAbiCoder();

const COMMITMENT_TYPES = [
  'bytes32',
  'uint64',
  'uint256',
  'address',
  'tuple(uint8 kind, bytes32 kid, uint64 timestamp, uint8 reasonCode)[]',
  'tuple(bytes32 universeId, bytes32 universeHash, uint64 enumeratedCount)[]',
  'uint64',
  'bytes32',
];

export function hashCommitment({
  prevRootHash,
  rootSeq,
  chainId,
  registry,
  ops,
  freezes,
  histVersion,
  histSnapshot,
}) {
  const encoded = coder.encode(COMMITMENT_TYPES, [
    prevRootHash,
    rootSeq,
    chainId,
    registry,
    (ops ?? []).map((op) => [op.kind, op.kid, op.timestamp, op.reasonCode]),
    (freezes ?? []).map((freeze) => [freeze.universeId, freeze.universeHash, freeze.enumeratedCount]),
    histVersion,
    histSnapshot,
  ]);
  return keccak256(encoded);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest();
}

export const LEGACY_UNIVERSE_ID = '0xb623c1816e895dd967c4e51f0e066dafda546195a909e9b51283be4b5109caf4';

export const LEGACY_PREDICATE = Object.freeze({
  schema: 'chit402.universe_predicate.v1',
  name: 'legacy_receipts_pre_v11',
  subject: 'book receipt',
  include:
    'book row with a stored issuer signature, payload_version below 11, and no issuer_root claim in the JWS payload',
  exclude: 'rows with no issuer signature; payload_version 11 or greater; any issuer_root claim',
  leaf: 'stored payload_hash bytes',
  re_sign: false,
});

function payloadHashBytes(value) {
  const raw = Buffer.from(getBytes(value));
  if (raw.length !== 32) throw new Error('payload_hash must be 32 bytes');
  return raw;
}

export function emptyLegacyRoot() {
  return sha256(Buffer.from([0x00]));
}

export function legacyLeaf(payloadHash) {
  return sha256(Buffer.concat([Buffer.from([0x00]), payloadHashBytes(payloadHash)]));
}

export function legacyNode(left, right) {
  return sha256(Buffer.concat([Buffer.from([0x01]), Buffer.from(left), Buffer.from(right)]));
}

/** Stable ascending sort of payload_hash bytes. Equal hashes keep input order. */
export function sortPayloadHashes(payloadHashes) {
  return payloadHashes
    .map((hash, order) => ({ bytes: payloadHashBytes(hash), order }))
    .sort((a, b) => {
      const cmp = Buffer.compare(a.bytes, b.bytes);
      return cmp === 0 ? a.order - b.order : cmp;
    })
    .map((row) => row.bytes);
}

/**
 * Root over payload hashes. Sorts first. Empty input is SHA-256(0x00).
 * @param {Array<string|Uint8Array>} payloadHashes
 */
export function merkleRoot(payloadHashes) {
  const sorted = sortPayloadHashes(payloadHashes);
  if (sorted.length === 0) return hexlify(emptyLegacyRoot());
  let level = sorted.map((raw) => sha256(Buffer.concat([Buffer.from([0x00]), raw])));
  while (level.length > 1) {
    if (level.length % 2 === 1) level = [...level, level[level.length - 1]];
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(legacyNode(level[i], level[i + 1]));
    }
    level = next;
  }
  return hexlify(level[0]);
}

/**
 * Inclusion proof for `index` in an already-sorted payload-hash list.
 * @param {string[]} sortedPayloadHashes
 * @param {number} index
 */
export function legacyInclusionProof(sortedPayloadHashes, index) {
  if (!Number.isInteger(index) || index < 0 || index >= sortedPayloadHashes.length) return null;
  let level = sortedPayloadHashes.map((hash) => legacyLeaf(hash));
  let idx = index;
  const proof = [];
  while (level.length > 1) {
    if (level.length % 2 === 1) level = [...level, level[level.length - 1]];
    const sibling = idx ^ 1;
    proof.push({
      hash: Buffer.from(level[sibling]).toString('hex'),
      position: sibling < idx ? 'left' : 'right',
    });
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(legacyNode(level[i], level[i + 1]));
    idx = Math.floor(idx / 2);
    level = next;
  }
  return proof;
}

export function verifyLegacyInclusion(payloadHash, proof, rootHex) {
  if (!Array.isArray(proof)) return false;
  let hash;
  try {
    hash = legacyLeaf(payloadHash);
  } catch {
    return false;
  }
  for (const step of proof) {
    if (!step || (step.position !== 'left' && step.position !== 'right')) return false;
    const sib = Buffer.from(String(step.hash).replace(/^0x/, ''), 'hex');
    if (sib.length !== 32) return false;
    hash = step.position === 'left' ? legacyNode(sib, hash) : legacyNode(hash, sib);
  }
  return hash.toString('hex') === String(rootHex || '').replace(/^0x/, '').toLowerCase();
}

function jcsString(str) {
  let result = '"';
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const code = str.charCodeAt(i);
    if (code < 32) result += `\\u${code.toString(16).padStart(4, '0')}`;
    else if (char === '"') result += '\\"';
    else if (char === '\\') result += '\\\\';
    else result += char;
  }
  return `${result}"`;
}

function jcsValue(value) {
  if (value === null || value === undefined) return 'null';
  const type = typeof value;
  if (type === 'boolean') return value ? 'true' : 'false';
  if (type === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot canonicalize Infinity or NaN');
    if (Object.is(value, -0)) return '0';
    return String(value);
  }
  if (type === 'string') return jcsString(value);
  if (Array.isArray(value)) return `[${value.map(jcsValue).join(',')}]`;
  if (type === 'object') {
    const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const pairs = [];
    for (const key of keys) {
      if (value[key] !== undefined) pairs.push(`${jcsString(key)}:${jcsValue(value[key])}`);
    }
    return `{${pairs.join(',')}}`;
  }
  throw new Error(`Cannot canonicalize value of type ${type}`);
}

export function jcsCanonicalize(value) {
  return jcsValue(value);
}

export function universeId({ book_id, window_id, predicate_hash }) {
  if (typeof book_id !== 'string' || typeof window_id !== 'string' || typeof predicate_hash !== 'string') {
    throw new Error('universe fields must be strings');
  }
  return hexlify(
    sha256(
      Buffer.from(
        jcsCanonicalize({
          schema: 'chit402.universe.v1',
          book_id,
          window_id,
          predicate_hash,
        }),
        'utf8',
      ),
    ),
  );
}

/** sha256(JCS(predicate)) then sha256(JCS(universe body)). Matches the gateway fixture. */
export function legacyUniverseId() {
  const predicateHash = sha256(Buffer.from(jcsCanonicalize(LEGACY_PREDICATE), 'utf8')).toString('hex');
  return universeId({
    book_id: 'chit402:global',
    window_id: 'legacy_receipts_pre_v11',
    predicate_hash: predicateHash,
  });
}

export function kidToBytes32(b64url) {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const buf = Buffer.from(String(b64url).replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
  if (buf.length !== 32) throw new Error(`kid decodes to ${buf.length} bytes, expected 32`);
  return hexlify(buf);
}

function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  if (i === -1 || i + 1 >= argv.length) throw new Error(`missing ${flag}`);
  return argv[i + 1];
}

function argValues(argv, flag) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag) out.push(argv[i + 1]);
  }
  return out;
}

function parseOp(text) {
  const [kind, kid, timestamp, reasonCode] = text.split(',');
  return {
    kind: Number(kind),
    kid,
    timestamp: BigInt(timestamp),
    reasonCode: Number(reasonCode),
  };
}

function parseFreeze(text) {
  const [universeId_, universeHash, enumeratedCount] = text.split(',');
  return {
    universeId: universeId_,
    universeHash,
    enumeratedCount: BigInt(enumeratedCount),
  };
}

function main(argv) {
  const cmd = argv[0];
  if (cmd === 'hash') {
    const digest = hashCommitment({
      prevRootHash: argValue(argv, '--prev'),
      rootSeq: BigInt(argValue(argv, '--seq')),
      chainId: BigInt(argValue(argv, '--chain')),
      registry: argValue(argv, '--registry'),
      histVersion: BigInt(argValue(argv, '--hist-version')),
      histSnapshot: argValue(argv, '--hist-snapshot'),
      ops: argValues(argv, '--op').map(parseOp),
      freezes: argValues(argv, '--freeze').map(parseFreeze),
    });
    process.stdout.write(digest);
    return;
  }
  if (cmd === 'merkle') {
    process.stdout.write(merkleRoot(argv.slice(1)));
    return;
  }
  if (cmd === 'kid') {
    process.stdout.write(kidToBytes32(argValue(argv, '--kid')));
    return;
  }
  throw new Error('usage: issuer-root.mjs hash|merkle|kid ...');
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('issuer-root.mjs');
if (invokedDirectly) main(process.argv.slice(2));
