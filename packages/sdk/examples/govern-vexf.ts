/**
 * XFuel SDK — veXF governance quickstart.
 *
 * Walks the governance lifecycle an agent uses to participate in XFuel protocol
 * decisions (Curve-style vote-escrow, up to 3x multiplier):
 *
 *   power (read) ─► lock XF ─► createProposal ─► vote
 *
 * The on-chain module reads voting power directly and builds calldata for writes
 * (lock / propose / vote) — it never holds a key. Submit the calldata via the
 * server relayer or sign it with your own wallet out of band.
 *
 * ─── Run it ──────────────────────────────────────────────────────────────────
 *   # Offline: builds lock/propose/vote calldata with no keys and no network.
 *   npx tsx examples/govern-vexf.ts
 *
 *   # With the voting-power read (needs an RPC + the deployed address):
 *   THETA_RPC_URL=https://eth-rpc-api-testnet.thetatoken.org/rpc \
 *   VE_GOVERNANCE_ADDRESS=0xYourVeGovernance \
 *   VOTER_ADDRESS=0xYourAgent \
 *   npx tsx examples/govern-vexf.ts
 *
 * Theta note: use a Theta ETH-RPC endpoint (public or dedicated) — NOT ZAN, which
 * does not serve Theta RPC.
 *
 * Published-package users import from 'xfuel-sdk/onchain'.
 */
import { keccak256, toUtf8Bytes } from 'ethers';
import { XFuelOnChain } from '../src/onchain.js';

const {
  VE_GOVERNANCE_ADDRESS = '0x0000000000000000000000000000000000009099', // placeholder
  THETA_RPC_URL,
  VOTER_ADDRESS = '0x1111111111111111111111111111111111111111',
} = process.env;

// veXFGovernance.ProposalType enum — confirm ordering against the contract.
const ProposalType = {
  CircuitPriority: 0,
  LPAllocation: 1,
  FeeStructure: 2,
  TreasurySpend: 3,
  EmergencyPause: 4,
} as const;

const WEEK = 604800; // locks round down to a week boundary (Curve-style)
const XF = (n: number) => (BigInt(Math.round(n * 1e6)) * 10n ** 12n).toString(); // n XF → wei
const b32 = (label: string) => keccak256(toUtf8Bytes(label));

function show(label: string, c: { to: string; data: string; value?: string }) {
  console.log(`  ${label.padEnd(16)} to=${c.to} value=${c.value ?? '0'} data=${c.data.slice(0, 26)}…`);
}

async function main() {
  const gov = new XFuelOnChain({
    veGovernanceAddress: VE_GOVERNANCE_ADDRESS,
    rpcUrl: THETA_RPC_URL, // only used for the power read
  });

  const now = Math.floor(Date.now() / 1000);
  const unlockTime = Math.floor((now + 365 * 24 * 3600) / WEEK) * WEEK; // ~1 year, week-aligned

  console.log('XFuel veXF governance quickstart');
  console.log(`  veGovernance : ${VE_GOVERNANCE_ADDRESS}`);
  console.log(`  reads        : ${THETA_RPC_URL ? 'on (RPC set)' : 'off (offline calldata only)'}`);

  // 1) POWER — read current voting power (decays with lock time; re-read near vote time).
  console.log('\n=== 1. Read voting power ===');
  if (THETA_RPC_URL && process.env.VE_GOVERNANCE_ADDRESS) {
    try {
      const power = await gov.getVotingPower(VOTER_ADDRESS);
      console.log(`  votingPower(${VOTER_ADDRESS}) = ${power.toString()}`);
    } catch (err) {
      console.log(`  · read skipped (${err instanceof Error ? err.message : String(err)})`);
    }
  } else {
    console.log('  · skipped — set THETA_RPC_URL + VE_GOVERNANCE_ADDRESS to read live power.');
  }

  // 2) LOCK — lock XF to gain voting weight (amount in wei, week-aligned unlock).
  console.log('\n=== 2. Lock XF for voting power ===');
  console.log(`  unlockTime = ${unlockTime} (~1 year, week-aligned)`);
  show('lock', gov.encodeLock(XF(1000), unlockTime)); // lock 1,000 XF

  // 3) PROPOSE — create a proposal (requires non-zero voting power on-chain).
  console.log('\n=== 3. Create a proposal ===');
  const proposal = gov.encodeCreateProposal(
    ProposalType.FeeStructure,
    b32('circuit:theta-inference'), // target circuit
    'Lower base fee 50→40 bps for Theta inference tasks',
    '0x', // execution_data (ABI-encoded params; empty for a signalling proposal)
  );
  show('createProposal', proposal);
  console.log(`  type=FeeStructure(${ProposalType.FeeStructure})  quorum≈20%`);

  // 4) VOTE — cast a vote on a proposal id (replay guard is the contract's hasVoted;
  //           there is NO nullifier parameter).
  console.log('\n=== 4. Vote on a proposal ===');
  const proposalId = Number(process.env.PROPOSAL_ID ?? 1);
  show('vote (yes)', gov.encodeVote(proposalId, true));
  show('vote (no)', gov.encodeVote(proposalId, false));

  console.log('\nDone. Reads are live via RPC; writes are calldata — submit via the relayer or sign yourself.');
}

main().catch((err) => {
  console.error('\nExample failed:', err?.message ?? err);
  process.exit(1);
});
