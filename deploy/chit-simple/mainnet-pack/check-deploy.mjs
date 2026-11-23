/**
 * Offline check that a chain-8453 deployment matches the live pin.
 * Recomputes the CREATE address from the deployer and nonce, and the
 * checkpoint domain. Does not open a socket and does not broadcast.
 * The Sepolia example pin is a different file and is not read as this hash.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak256 } from '../../../packages/cs2-core/ecdsa/keccak.js';
import { rlpBytes, rlpInt, rlpList } from '../../../packages/cs2-core/ecdsa/rlp.js';
import { bytesToHex } from '../../../packages/cs2-core/ecdsa/bytes.js';

const here = dirname(fileURLToPath(import.meta.url));

export function normHex(value) {
  return String(value || '').trim().toLowerCase().replace(/^0x/, '');
}

export function createAddress(deployer, nonce) {
  const sender = Uint8Array.from(Buffer.from(normHex(deployer), 'hex'));
  if (sender.length !== 20) return '';
  const encoded = rlpList([rlpBytes(sender), rlpInt(BigInt(nonce))]);
  const hash = keccak256(encoded);
  return `0x${bytesToHex(hash.subarray(12))}`;
}

export function checkpointDomain(chainId, address) {
  const chain = Buffer.alloc(8);
  chain.writeBigUInt64BE(BigInt(chainId));
  const body = Buffer.concat([
    Buffer.from('chit402-checkpoint-v1'),
    chain,
    Buffer.from(normHex(address), 'hex'),
  ]);
  return `0x${createHash('sha256').update(body).digest('hex')}`;
}

export function expectedRuntime() {
  return JSON.parse(readFileSync(join(here, 'expected-runtime.json'), 'utf8'));
}

/**
 * Empty string means the view matches the chain-8453 pack.
 * Any other string is a refusal. Chain 84532 is not this pack.
 */
export function checkMainnetPack(view) {
  if (!view || typeof view !== 'object') return 'view is missing';
  if (Number(view.chainId) !== 8453) return 'chain is not 8453';
  const doc = expectedRuntime();
  const address = createAddress(view.deployer, view.nonce);
  if (!address || address !== `0x${normHex(doc.contract)}`) return 'create address mismatch';
  if (`0x${normHex(view.address)}` !== address) return 'address mismatch';
  const domain = checkpointDomain(view.chainId, address);
  if (domain !== normHex(doc.domain) && domain !== `0x${normHex(doc.domain)}`) return 'domain mismatch';
  if (`0x${normHex(view.codeHash)}` !== `0x${normHex(doc.runtimeCodeHash)}`) return 'code hash mismatch';
  return '';
}
