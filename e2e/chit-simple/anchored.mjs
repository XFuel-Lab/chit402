/**
 * Admission of one Anchored log. No chain client and no compiler: the fast
 * suite and the gateway hook load this file on its own.
 *
 * Chain id, contract, and the checkpoint the walk starts from come from the
 * pin. A log is admissible when the observed chain id is that pin's chain,
 * the log is from the pin's contract, the tx sender is the checkpoint current
 * at that log, and the block is one the chain already calls finalized.
 *
 * CheckpointKeyRotated moves that checkpoint only when the log is from the
 * pin's contract and its own block is finalized. A rotation in a later block
 * is ignored until the chain includes it in the finalized tag.
 */
import { keccak256 } from '../../packages/cs2-core/ecdsa/keccak.js';

const ANCHORED_SIG = 'Anchored(uint64,uint64,uint64,bytes32,bytes32,uint8)';
const ROTATE_SIG = 'CheckpointKeyRotated(uint64,address,address)';

function topic0(signature) {
  return `0x${Buffer.from(keccak256(new TextEncoder().encode(signature))).toString('hex')}`;
}

export const ANCHORED_TOPIC = topic0(ANCHORED_SIG);
export const ROTATE_TOPIC = topic0(ROTATE_SIG);

function topicOf(log) {
  return String(log?.topics?.[0] || '').toLowerCase();
}

function wordAt(data, index) {
  const body = String(data || '').replace(/^0x/i, '');
  return body.slice(index * 64, (index + 1) * 64);
}

function addressWord(word) {
  return `0x${word.slice(24)}`.toLowerCase();
}

export function startingCheckpoint(pin) {
  const raw = typeof pin?.checkpoint === 'string' ? pin.checkpoint.toLowerCase() : '';
  return /^0x[0-9a-f]{40}$/.test(raw) ? raw : '';
}

export function chainMatchesPin(observedChainId, pin) {
  if (pin == null || pin.chainId == null || pin.chainId === '') return false;
  const pinned = Number(pin.chainId);
  if (!Number.isSafeInteger(pinned) || pinned < 0) return false;
  return Number(observedChainId) === pinned;
}

export function acceptAnchoredLog({ address, txFrom, checkpoint, chainId, blockNumber, finalizedNumber, contract, pinnedChainId }) {
  if (!Number.isSafeInteger(Number(pinnedChainId)) || Number(chainId) !== Number(pinnedChainId)) return false;
  if (String(address).toLowerCase() !== String(contract).toLowerCase()) return false;
  if (String(txFrom).toLowerCase() !== String(checkpoint).toLowerCase()) return false;
  if (finalizedNumber == null || BigInt(blockNumber) > BigInt(finalizedNumber)) return false;
  return true;
}

export function acceptCheckpointRotation({ address, contract, blockNumber, finalizedNumber }) {
  if (String(address || '').toLowerCase() !== String(contract || '').toLowerCase()) return false;
  if (finalizedNumber == null) return false;
  if (BigInt(blockNumber) > BigInt(finalizedNumber)) return false;
  return true;
}

function decodeAnchored(log) {
  return {
    epoch: Number(BigInt(log.topics[1])),
    hourStart: Number(BigInt(log.topics[2])),
    size: Number(BigInt(`0x${wordAt(log.data, 0)}`)),
    root: wordAt(log.data, 1),
    stateRoot: wordAt(log.data, 2),
  };
}

function rotatedTo(log) {
  const next = addressWord(wordAt(log.data, 2));
  return /^0x[0-9a-f]{40}$/.test(next) ? next : '';
}

/**
 * Walk logs in chain order against one pin. No RPC.
 * `txFromOf(log)` is the sender of that log's transaction.
 */
export function admitListenerLogs({ pin, observedChainId, finalizedNumber, logs, txFromOf }) {
  const checkpoint0 = startingCheckpoint(pin);
  const contract = typeof pin?.address === 'string' ? pin.address : '';
  if (!chainMatchesPin(observedChainId, pin)) {
    return { ok: true, reason: 'chain_id', checkpoint: checkpoint0, admitted: [] };
  }
  if (!contract || !checkpoint0) {
    return { ok: true, reason: 'pin', checkpoint: checkpoint0, admitted: [] };
  }
  let checkpoint = checkpoint0;
  const admitted = [];
  const pinnedChainId = Number(pin.chainId);
  for (const log of logs || []) {
    const topic = topicOf(log);
    if (topic === ROTATE_TOPIC.toLowerCase()) {
      if (!acceptCheckpointRotation({
        address: log.address,
        contract,
        blockNumber: log.blockNumber,
        finalizedNumber,
      })) continue;
      const next = rotatedTo(log);
      if (next) checkpoint = next;
      continue;
    }
    if (topic !== ANCHORED_TOPIC.toLowerCase()) continue;
    const txFrom = txFromOf(log);
    if (!acceptAnchoredLog({
      address: log.address,
      txFrom,
      checkpoint,
      chainId: observedChainId,
      pinnedChainId,
      blockNumber: log.blockNumber,
      finalizedNumber,
      contract,
    })) continue;
    admitted.push({ log, txFrom, decoded: decodeAnchored(log) });
  }
  return { ok: true, reason: null, checkpoint, admitted };
}
