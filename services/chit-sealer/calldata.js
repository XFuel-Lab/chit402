/**
 * Anchor calldata in the P0-3 dry-run layout.
 *
 * The checkpoint signer reads fixed offsets: domain, epoch, hourStart,
 * size, root, stateRoot. A consistency proof, if any, is appended after
 * those 120 bytes. This is the payload the signer checks. It is not a
 * Solidity ABI encoding.
 */

import { checkpointDomain } from '../../packages/cs2-core/ecdsa/domain.js';
import { bytesToHex, concat, hexToBytes } from '../../packages/cs2-core/ecdsa/bytes.js';

function u64(value) {
  const out = new Uint8Array(8);
  let x = BigInt(value);
  for (let i = 7; i >= 0; i -= 1) {
    out[i] = Number(x % 256n);
    x = x / 256n;
  }
  return out;
}

/**
 * @param {{ chainId: bigint, contract: string, epoch: number, hourStart: number, size: number, root: string, stateRoot: string, proof: string[] }} fields
 */
export function buildAnchorCalldata(fields) {
  const domain = checkpointDomain(fields.chainId, fields.contract);
  const parts = [
    domain,
    u64(fields.epoch),
    u64(fields.hourStart),
    u64(fields.size),
    hexToBytes(fields.root),
    hexToBytes(fields.stateRoot),
  ];
  const proof = fields.proof || [];
  for (let i = 0; i < proof.length; i += 1) parts.push(hexToBytes(proof[i]));
  return { domain: bytesToHex(domain), calldata: bytesToHex(concat(parts)) };
}
