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

export const DOMAIN_NAME = 'Chit402';
export const DOMAIN_VERSION = '13';

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
 * Coverage is [genesisHourStart, retireHourStart]. A null retire hour
 * means the pin has not retired. The admitting contract is that pin.
 */
export function admittingContract(
  pins: readonly { address: string; chainId: number; genesisHourStart: number; retireHourStart: number | null }[],
  chainId: number,
  hourStart: number,
): string | null {
  for (const pin of pins) {
    if (pin.chainId !== chainId) continue;
    if (hourStart < pin.genesisHourStart) continue;
    if (pin.retireHourStart != null && hourStart > pin.retireHourStart) continue;
    return pin.address;
  }
  return null;
}

export function verifySlot(input: VerifySlotInput): VerifySlotResult {
  const domain = input.admitting ? domainFor(input.chainId, input.admitting) : null;
  if (
    input.signedDomain
    && domain
    && input.signedDomain.verifyingContract.toLowerCase() !== domain.verifyingContract.toLowerCase()
  ) {
    return { ignored: true, inBounds: false, domain, reason: 'old_domain_ignored' };
  }
  if (
    input.admissionBlock != null
    && input.previousAnchorBlock != null
    && input.showingAnchorBlock != null
  ) {
    const inBounds = input.admissionBlock > input.previousAnchorBlock
      && input.admissionBlock <= input.showingAnchorBlock;
    if (!inBounds) {
      return { ignored: true, inBounds: false, domain, reason: 'admission_block_out_of_bounds' };
    }
  }
  return { ignored: false, inBounds: true, domain, reason: null };
}
