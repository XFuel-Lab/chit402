/**
 * Admission of one Anchored log. No chain client and no compiler: the fast
 * suite and the gateway hook load this file on its own.
 *
 * A log is admissible when it is on the pinned chain, from the pinned
 * contract, sent by the checkpoint current at that log, and in a block the
 * chain already calls finalized.
 */
export const LISTENER_CHAIN_ID = 84532;

export function acceptAnchoredLog({ address, txFrom, checkpoint, chainId, blockNumber, finalizedNumber, contract }) {
  if (Number(chainId) !== LISTENER_CHAIN_ID) return false;
  if (String(address).toLowerCase() !== String(contract).toLowerCase()) return false;
  if (String(txFrom).toLowerCase() !== String(checkpoint).toLowerCase()) return false;
  if (finalizedNumber == null || BigInt(blockNumber) > BigInt(finalizedNumber)) return false;
  return true;
}
