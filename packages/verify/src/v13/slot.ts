/**
 * Slot-record admission check. P0-4 will export verifySlot with a chain
 * binding. Until that lands this is the interface the v13 path calls.
 * No size cap: a slot value may carry a long tail.
 *
 * The admitting contract is the bundled pin whose coverage contains the
 * record's admission hour. Every signature verifies under that contract's
 * domain. A mismatch is ignored. validFrom and revokedAt are the admission
 * block, which must sit after the previous epoch's anchor block and no
 * later than the anchor block of the first epoch that shows the record.
 */

import { DOMAIN_NAME, DOMAIN_VERSION, checkAdmissionProof } from './key-record.js';

export { DOMAIN_NAME, DOMAIN_VERSION };

export interface SlotDomain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

export interface VerifySlotInput {
  chainId: number;
  admitting: string | null;
  signedDomain: SlotDomain | null;
  admissionBlock: number | null;
  previousAnchorBlock: number | null;
  showingAnchorBlock: number | null;
  paymentBlock: number | null;
  absentAtPrior?: boolean;
  emptySlotAtPrior?: boolean;
  memberAtEpoch?: boolean;
}

export interface VerifySlotResult {
  ignored: boolean;
  inBounds: boolean;
  domain: SlotDomain | null;
  reason: string | null;
}

export function domainFor(chainId: number, verifyingContract: string): SlotDomain {
  return {
    name: DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId,
    verifyingContract,
  };
}

/**
 * Coverage is [genesisHourStart, retireHourStart). The retire hour itself
 * is outside. A null retire hour means the pin has not retired.
 */
export function admittingContract(
  pins: readonly { address: string; chainId: number; genesisHourStart: number; retireHourStart: number | null }[],
  chainId: number,
  hourStart: number,
): string | null {
  for (const pin of pins) {
    if (pin.chainId !== chainId) continue;
    if (hourStart < pin.genesisHourStart) continue;
    if (pin.retireHourStart != null && hourStart >= pin.retireHourStart) continue;
    return pin.address;
  }
  return null;
}

export function verifySlot(input: VerifySlotInput): VerifySlotResult {
  const domain = input.admitting ? domainFor(input.chainId, input.admitting) : null;
  if (!input.signedDomain) {
    return { ignored: false, inBounds: false, domain, reason: 'domain_unsigned' };
  }
  if (
    input.signedDomain
    && domain
    && (
      input.signedDomain.verifyingContract.toLowerCase() !== domain.verifyingContract.toLowerCase()
      || input.signedDomain.name !== domain.name
      || input.signedDomain.version !== domain.version
      || input.signedDomain.chainId !== domain.chainId
    )
  ) {
    return { ignored: false, inBounds: false, domain, reason: 'domain_mismatch' };
  }
  if (
    input.admissionBlock != null
    && input.previousAnchorBlock != null
    && input.showingAnchorBlock != null
  ) {
    const checked = checkAdmissionProof({
      absentAtPrior: input.absentAtPrior === true,
      emptySlotAtPrior: input.emptySlotAtPrior === true,
      memberAtEpoch: input.memberAtEpoch === true,
      priorAnchor: input.previousAnchorBlock,
      anchor: input.showingAnchorBlock,
      block: input.admissionBlock,
    });
    if (!checked.ok) {
      return { ignored: false, inBounds: false, domain, reason: 'admission_unproven' };
    }
  }
  return { ignored: false, inBounds: true, domain, reason: null };
}
