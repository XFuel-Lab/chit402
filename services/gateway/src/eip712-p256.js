/**
 * EIP-712 typed structs signed by the issuer P-256 key.
 *
 * The message handed to the signer is the 66-byte preimage
 * M = 0x19 0x01 || domainSeparator || structHash. Both signers hash with
 * SHA-256, so the ECDSA hash is e = SHA-256(M) ("sha256(eip712_preimage)").
 * Verifiers (and the escrow contract) compute the same e and run P-256
 * verify. There is no keccak digest signing and no prehash mode.
 *
 * Callers pass typed fields only, never bytes. The struct kinds this module
 * can sign are fixed here (TreeHead, ReceiptBinding). Each kind has its own
 * domain name, so a signature for one never verifies as the other.
 * The domain salt is the log id, from the boot-verified epoch-1 root and
 * genesis digest (see logIdSalt).
 */
import crypto from 'node:crypto';
import { keccak256 } from 'ethers';
import { lowS, P256_HALF_ORDER } from './ecdsa-der.js';
import { claimTypedPreimageCapability, typedPreimageShapeOk } from './issuer-signer-guard.js';
import { peekIssuerSigner } from './issuer-signer-state.js';

function coded(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

export const EIP712_DOMAIN_TYPE = 'EIP712Domain(string name,string version,uint256 chainId,bytes32 salt)';
export const EIP712_DOMAIN_VERSION = '1';
/** Base Sepolia. The escrow v0 contract chain. */
export const EIP712_CHAIN_ID = 84532;
export const EIP712_DIGEST_ALG = 'sha256(eip712_preimage)';
export const LOG_ID_TAG = 'chit402.receipt-log.v1';
/**
 * keccak256("chit402.receipt-log.v1" || epoch-1 root dd20e39a... || genesis
 * digest 422cceb1...). The value every fixed signature must be made under.
 */
export const EXPECTED_LOG_SALT = '0x7a92860b2db8dfee1901affef1a3352ab94a3b3bfcc410aef7238ef170435211';

export const TREE_HEAD_TYPE = 'TreeHead(uint32 epoch,uint64 tree_size,bytes32 root,uint64 published_at,bytes32 kid)';
export const TREE_HEAD_DOMAIN_NAME = 'Chit402TreeHead';

export const RECEIPT_BINDING_TYPE = 'ReceiptBinding(bytes32 leaf_hash,bytes32 payer_commitment,uint64 amount_atomic,bytes32 asset_id,bytes32 kid)';
export const RECEIPT_BINDING_DOMAIN_NAME = 'Chit402ReceiptBinding';
/** keccak256("chit402.payer-commitment.v1") */
export const PAYER_COMMITMENT_TAG_TEXT = 'chit402.payer-commitment.v1';
/** CAIP-19 style id of the payment asset, Base USDC. */
export const BASE_USDC_ASSET_TEXT = 'eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';

const HEX32 = /^[0-9a-f]{64}$/;
const HEX32_0X = /^0x[0-9a-f]{64}$/;

export function keccakHex(bytes) {
  return keccak256(bytes);
}

function utf8Keccak(text) {
  return keccakHex(Buffer.from(text, 'utf8'));
}

export const EIP712_DOMAIN_TYPEHASH = utf8Keccak(EIP712_DOMAIN_TYPE);
export const TREE_HEAD_TYPEHASH = utf8Keccak(TREE_HEAD_TYPE);
export const RECEIPT_BINDING_TYPEHASH = utf8Keccak(RECEIPT_BINDING_TYPE);
export const PAYER_COMMITMENT_TAG = utf8Keccak(PAYER_COMMITMENT_TAG_TEXT);
export const BASE_USDC_ASSET_ID = utf8Keccak(BASE_USDC_ASSET_TEXT);

function bytesOf0x(hex) {
  return Buffer.from(hex.slice(2), 'hex');
}

/**
 * A uint word. Accepts a JS safe integer or bigint in [0, 2^bits - 1].
 * @param {number|bigint} value
 * @param {number} bits
 */
export function uintWord(value, bits) {
  let n;
  if (typeof value === 'bigint') n = value;
  else if (typeof value === 'number' && Number.isSafeInteger(value)) n = BigInt(value);
  else throw coded('integer field is not a safe integer', 'eip712_field_range');
  if (n < 0n || n > (1n << BigInt(bits)) - 1n) {
    throw coded(`integer field is outside uint${bits}`, 'eip712_field_range');
  }
  return Buffer.from(n.toString(16).padStart(64, '0'), 'hex');
}

/**
 * A bytes32 word from exactly 0x + 64 lowercase hex.
 * @param {string} hex
 */
export function bytes32Word(hex) {
  if (typeof hex !== 'string' || !HEX32_0X.test(hex)) {
    throw coded('bytes32 field must be 0x + 64 lowercase hex', 'eip712_field_range');
  }
  return bytesOf0x(hex);
}

/**
 * Log id salt. Both inputs are 64 lowercase hex (no 0x).
 * @param {string} epoch1Root
 * @param {string} genesisDigest
 */
export function logIdSalt(epoch1Root, genesisDigest) {
  if (!HEX32.test(String(epoch1Root || '')) || !HEX32.test(String(genesisDigest || ''))) {
    throw coded('log id inputs must be 64 lowercase hex', 'eip712_log_id');
  }
  return keccakHex(Buffer.concat([
    Buffer.from(LOG_ID_TAG, 'utf8'),
    Buffer.from(epoch1Root, 'hex'),
    Buffer.from(genesisDigest, 'hex'),
  ]));
}

/**
 * @param {string} name
 * @param {string} salt 0x + 64 lowercase hex
 */
export function domainSeparator(name, salt) {
  return keccakHex(Buffer.concat([
    bytesOf0x(EIP712_DOMAIN_TYPEHASH),
    bytesOf0x(utf8Keccak(name)),
    bytesOf0x(utf8Keccak(EIP712_DOMAIN_VERSION)),
    uintWord(EIP712_CHAIN_ID, 256),
    bytes32Word(salt),
  ]));
}

/**
 * The bytes32 form of a base64url RFC 7638 thumbprint kid.
 * @param {string} kid
 */
export function kidBytes32(kid) {
  const text = String(kid || '');
  if (!/^[A-Za-z0-9_-]{43}$/.test(text)) throw coded('kid must be 43 base64url characters', 'eip712_kid');
  const raw = Buffer.from(text, 'base64url');
  if (raw.length !== 32 || raw.toString('base64url') !== text) {
    throw coded('kid must decode to exactly 32 bytes', 'eip712_kid');
  }
  return `0x${raw.toString('hex')}`;
}

/**
 * TreeHead message: { epoch, tree_size, root, published_at, kid } with
 * root and kid as 0x bytes32 strings and the rest integers.
 * @param {{ epoch: number, tree_size: number, root: string, published_at: number, kid: string }} m
 */
export function treeHeadStructHash(m) {
  return keccakHex(Buffer.concat([
    bytesOf0x(TREE_HEAD_TYPEHASH),
    uintWord(m.epoch, 32),
    uintWord(m.tree_size, 64),
    bytes32Word(m.root),
    uintWord(m.published_at, 64),
    bytes32Word(m.kid),
  ]));
}

/**
 * keccak256(abi.encode(PAYER_COMMITMENT_TAG, payer, payer_salt)).
 * @param {string} payer 0x + 40 hex (any case)
 * @param {Buffer} payerSalt exactly 32 bytes
 */
export function payerCommitment(payer, payerSalt) {
  if (typeof payer !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(payer)) {
    throw coded('payer must be a 20-byte address', 'eip712_field_range');
  }
  if (!Buffer.isBuffer(payerSalt) || payerSalt.length !== 32) {
    throw coded('payer salt must be 32 bytes', 'eip712_field_range');
  }
  const addressWord = Buffer.concat([Buffer.alloc(12), Buffer.from(payer.slice(2), 'hex')]);
  return keccakHex(Buffer.concat([bytesOf0x(PAYER_COMMITMENT_TAG), addressWord, payerSalt]));
}

// Amounts travel as decimal strings in JSON (uint64 can exceed 2^53).
function amountValue(v) {
  if (typeof v === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(v)) return BigInt(v);
  return v;
}

/**
 * ReceiptBinding message: { leaf_hash, payer_commitment, amount_atomic,
 * asset_id, kid } with the bytes32 fields as 0x strings.
 */
export function receiptBindingStructHash(m) {
  return keccakHex(Buffer.concat([
    bytesOf0x(RECEIPT_BINDING_TYPEHASH),
    bytes32Word(m.leaf_hash),
    bytes32Word(m.payer_commitment),
    uintWord(amountValue(m.amount_atomic), 64),
    bytes32Word(m.asset_id),
    bytes32Word(m.kid),
  ]));
}

/**
 * Struct kinds this module may sign. Not extensible from outside.
 */
const TYPED_STRUCTS = Object.freeze({
  TreeHead: Object.freeze({
    typehash: TREE_HEAD_TYPEHASH,
    domainName: TREE_HEAD_DOMAIN_NAME,
    structHash: treeHeadStructHash,
  }),
  ReceiptBinding: Object.freeze({
    typehash: RECEIPT_BINDING_TYPEHASH,
    domainName: RECEIPT_BINDING_DOMAIN_NAME,
    structHash: receiptBindingStructHash,
  }),
});

export function allowedTypedStructs() {
  return Object.keys(TYPED_STRUCTS).map((kind) => ({ kind, typehash: TYPED_STRUCTS[kind].typehash }));
}

/**
 * @param {string} domainSep 0x bytes32
 * @param {string} structHash 0x bytes32
 */
export function typedPreimage(domainSep, structHash) {
  return Buffer.concat([Buffer.from([0x19, 0x01]), bytes32Word(domainSep), bytes32Word(structHash)]);
}

/**
 * Everything a verifier recomputes for one typed struct.
 * @param {string} kind
 * @param {object} message
 * @param {string} salt
 */
export function typedDigest(kind, message, salt) {
  const spec = Object.prototype.hasOwnProperty.call(TYPED_STRUCTS, kind) ? TYPED_STRUCTS[kind] : null;
  if (!spec) throw coded('typed struct kind is not allowed', 'eip712_type_not_allowed');
  const structHash = spec.structHash(message);
  const domainSep = domainSeparator(spec.domainName, salt);
  const preimage = typedPreimage(domainSep, structHash);
  return {
    typehash: spec.typehash,
    domainName: spec.domainName,
    domainSeparator: domainSep,
    structHash,
    preimage,
    e: `0x${crypto.createHash('sha256').update(preimage).digest('hex')}`,
  };
}

function publicKeyFromJwk(jwk) {
  return crypto.createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y },
    format: 'jwk',
  });
}

/**
 * Verify r || s over the preimage. Accepts high-S too (the contract does).
 * @param {Buffer} preimage
 * @param {string} r 0x bytes32
 * @param {string} s 0x bytes32
 * @param {{ x: string, y: string }} jwk
 */
export function verifyTypedSignature(preimage, r, s, jwk) {
  try {
    const sig = Buffer.concat([bytes32Word(r), bytes32Word(s)]);
    return crypto.verify('sha256', preimage, { key: publicKeyFromJwk(jwk), dsaEncoding: 'ieee-p1363' }, sig);
  } catch {
    return false;
  }
}

const CAPABILITY = claimTypedPreimageCapability();

/**
 * Sign one allowlisted struct with the active issuer signer.
 * The struct's kid must be the signer's kid. Output is low-S and checked
 * against the signer's public key before it is returned.
 * @param {string} kind
 * @param {object} message typed fields
 * @param {{ salt: string, signer?: object }} opts
 */
export async function signTypedStruct(kind, message, { salt, signer = null } = {}) {
  const digest = typedDigest(kind, message, salt);
  if (!typedPreimageShapeOk(digest.preimage)) throw coded('typed preimage shape', 'eip712_preimage');
  const active = signer || peekIssuerSigner() || await (await import('./issuer-signer.js')).initIssuerSigner();
  if (kidBytes32(active.kid) !== message.kid) {
    throw coded('struct kid is not the signer kid', 'eip712_kid_mismatch');
  }
  const raw = await active.sign(digest.preimage, { typedPreimage: CAPABILITY });
  if (!Buffer.isBuffer(raw) || raw.length !== 64) throw coded('signer returned a bad signature', 'eip712_signature');
  const sig = lowS(raw);
  const r = `0x${sig.subarray(0, 32).toString('hex')}`;
  const s = `0x${sig.subarray(32).toString('hex')}`;
  if (BigInt(s) > P256_HALF_ORDER) throw coded('signature is not low-S', 'eip712_signature');
  if (!verifyTypedSignature(digest.preimage, r, s, active.publicJwk)) {
    throw coded('typed signature does not verify under the signer key', 'eip712_self_verify');
  }
  return { ...digest, r, s, kid: active.kid };
}
