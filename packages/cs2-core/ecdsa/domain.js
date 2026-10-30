/**
 * Checkpoint domain: SHA-256("chit402-checkpoint-v1" || chainId as 8-byte
 * big-endian || the contract address). The transaction signature covers
 * chainId, the contract and this domain when those bytes sit in the calldata.
 */

import { createHash } from 'node:crypto';
import { bytesToHex, hexToBytes } from './bytes.js';

const TAG = new TextEncoder().encode('chit402-checkpoint-v1');

export function checkpointDomain(chainId, contract) {
  const id = BigInt(chainId);
  if (id < 0n || id > 0xffffffffffffffffn) {
    const err = new Error('chain id does not fit in 8 bytes');
    err.code = 'bad_domain';
    throw err;
  }
  const addr = typeof contract === 'string' ? hexToBytes(contract) : contract;
  if (!addr || addr.length !== 20) {
    const err = new Error('contract must be 20 bytes');
    err.code = 'bad_domain';
    throw err;
  }
  const chain = Buffer.alloc(8);
  chain.writeBigUInt64BE(id);
  const digest = createHash('sha256').update(TAG).update(chain).update(addr).digest();
  return new Uint8Array(digest);
}

export function checkpointDomainHex(chainId, contract) {
  return bytesToHex(checkpointDomain(chainId, contract));
}
