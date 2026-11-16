/**
 * Anchor calldata for ChitAnchor.anchor.
 *
 * The bytes are the Solidity ABI encoding of
 * anchor(bytes32,uint64,uint64,uint64,bytes32,bytes32,bytes32[]).
 * The selector is the first 4 bytes of keccak256 of that signature.
 * A consistency proof is the dynamic bytes32[] tail.
 */

import { checkpointDomain } from '../../packages/cs2-core/ecdsa/domain.js';
import { bytesToHex, concat, hexToBytes } from '../../packages/cs2-core/ecdsa/bytes.js';
import { keccak256 } from '../../packages/cs2-core/ecdsa/keccak.js';

export const ANCHOR_SIGNATURE = 'anchor(bytes32,uint64,uint64,uint64,bytes32,bytes32,bytes32[])';

const selectorBytes = keccak256(new TextEncoder().encode(ANCHOR_SIGNATURE)).subarray(0, 4);

/** Selector hex, no 0x prefix. Tests recompute it from ANCHOR_SIGNATURE. */
export const ANCHOR_SELECTOR = bytesToHex(selectorBytes);

function wordUint(value) {
  const out = new Uint8Array(32);
  let x = BigInt(value);
  for (let i = 31; i >= 0; i -= 1) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

function wordBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) {
    throw Object.assign(new Error('anchor word must be 32 bytes'), { code: 'bad_anchor' });
  }
  return bytes;
}

/**
 * @param {{ chainId: bigint, contract: string, epoch: number, hourStart: number, size: number, root: string, stateRoot: string, proof: string[] }} fields
 */
export function buildAnchorCalldata(fields) {
  const domain = checkpointDomain(fields.chainId, fields.contract);
  const proof = fields.proof || [];
  const headWords = 7;
  const parts = [
    selectorBytes,
    wordBytes(domain),
    wordUint(fields.epoch),
    wordUint(fields.hourStart),
    wordUint(fields.size),
    wordBytes(hexToBytes(fields.root)),
    wordBytes(hexToBytes(fields.stateRoot)),
    wordUint(headWords * 32),
    wordUint(proof.length),
  ];
  for (let i = 0; i < proof.length; i += 1) parts.push(wordBytes(hexToBytes(proof[i])));
  return { domain: bytesToHex(domain), calldata: bytesToHex(concat(parts)) };
}
