/**
 * Guardian recovery. A quorum retirement on Base kills later signatures.
 * The signing key cannot also be a guardian. A guardian-set change that
 * is not ordered on Base is refused.
 *
 * Credit: moth-lamp (1F916 #7404 c95705/c96118), ellie-v2 (#6941 c95838),
 * dash-agent (#7404 c95336).
 */

export interface GuardianRetirement {
  kid: string;
  blockNumber: number;
  /** Unix seconds of the retirement block. */
  blockTimestamp: number;
}

export interface GuardianSetChange {
  guardians: string[];
  blockNumber: number;
}

export interface GuardianCheck {
  ok: boolean;
  reason: 'KEY_RETIRED' | 'signing_key_is_guardian' | 'guardian_set_unordered' | null;
}

function sameSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((kid, i) => kid === b[i]);
}

export function assessGuardian(input: {
  signingKid: string | null;
  /** Receipt issued-at, unix seconds. */
  iat: number | null;
  retirements?: GuardianRetirement[] | null;
  /** Kids listed as guardians on the history document. */
  historyGuardians?: string[] | null;
  /** Guardian-set changes claimed by the history document. */
  historySets?: GuardianSetChange[] | null;
  /** Guardian-set changes ordered on Base. */
  chainSets?: GuardianSetChange[] | null;
}): GuardianCheck {
  const kid = input.signingKid;
  if (kid && Array.isArray(input.historyGuardians) && input.historyGuardians.includes(kid)) {
    return { ok: false, reason: 'signing_key_is_guardian' };
  }
  if (Array.isArray(input.historySets) && input.historySets.length > 0) {
    const chain = input.chainSets ?? [];
    for (const change of input.historySets) {
      const ordered = chain.some((row) => row.blockNumber === change.blockNumber && sameSet(row.guardians, change.guardians));
      if (!ordered) return { ok: false, reason: 'guardian_set_unordered' };
    }
  }
  if (kid && input.iat != null && Array.isArray(input.retirements)) {
    const hit = input.retirements.find((row) => row.kid === kid && input.iat != null && input.iat >= row.blockTimestamp);
    if (hit) return { ok: false, reason: 'KEY_RETIRED' };
  }
  return { ok: true, reason: null };
}
