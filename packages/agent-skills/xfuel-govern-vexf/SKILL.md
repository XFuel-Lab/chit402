---
name: xfuel-govern-vexf
description: >-
  Participate in XFuel veXF governance: lock XF to gain voting power, create
  proposals, and vote (Curve-style vote-escrow, up to 3x multiplier). Use when an
  agent or user wants to lock tokens for governance weight, submit a protocol
  proposal (circuit priority, fee structure, treasury spend, emergency pause), or
  cast a vote. Reads voting power directly; builds calldata for writes (no keys
  held by the skill).
---

# XFuel: veXF Governance

Lock XF, check voting power, create proposals, and vote.

## Prerequisites

- `THETA_RPC_URL` (a Theta ETH-RPC endpoint — public or dedicated; **not** ZAN,
  which does not serve Theta RPC) and `VE_GOVERNANCE_ADDRESS` (see `deploy/manifests/`).
- Writes are signed server-side or out-of-band; this skill builds calldata.

## Parameters

| Name | Required | Description |
|------|----------|-------------|
| `action` | yes | `power` \| `lock` \| `propose` \| `vote`. |
| `address` | for power | Address to read voting power for. |
| `amount_wei` / `unlock_time` | for lock | XF amount + unix unlock time (rounded to week). |
| `proposal_type` | for propose | enum index: see table below. |
| `target_circuit` / `description` / `execution_data` | for propose | Proposal payload. |
| `proposal_id` / `support` | for vote | Proposal id + yes/no. |

## Proposal types & quorum

| Index | Type | Quorum | Controls |
|-------|------|--------|----------|
| 0 | CircuitPriority | 10% | Priority routing |
| 1 | LPAllocation | 15% | GET sub-allocation |
| 2 | FeeStructure | 20% | Fee BPS / splits |
| 3 | TreasurySpend | 25% | Expenditures >$50K |
| 4 | EmergencyPause | 5% + 67% supermajority | Circuit breakers |

> Confirm the exact enum ordering against `veXFGovernance.sol` (`ProposalType`)
> before submitting; pass the numeric index.

## Procedure

1. **power** — read current voting power:

   ```js
   import { XFuelOnChain } from 'xfuel-sdk/onchain';
   const gov = new XFuelOnChain({ rpcUrl: process.env.THETA_RPC_URL, veGovernanceAddress: process.env.VE_GOVERNANCE_ADDRESS });
   const power = await gov.getVotingPower(address);
   ```

2. **lock** — `gov.encodeLock(amount_wei, unlock_time)` → submit calldata.
   (Verified signature: `lock(uint256 amount, uint256 unlockTime)`.)

3. **propose** — `gov.encodeCreateProposal(proposal_type, target_circuit,
   description, execution_data)`. Requires non-zero voting power.

4. **vote** — `gov.encodeVote(proposal_id, support)`. Replay protection is via the
   contract's `hasVoted` mapping — **there is no nullifier parameter** (do not
   pass one; older docs are inaccurate).

## Runnable example

[`packages/sdk/examples/govern-vexf.ts`](../../sdk/examples/govern-vexf.ts) —
`npx tsx examples/govern-vexf.ts` walks power → lock → propose → vote. Calldata
builders run fully offline; the voting-power read runs when `THETA_RPC_URL` +
`VE_GOVERNANCE_ADDRESS` are set.

## Failure modes

- `InsufficientVotingPower` → lock XF first (and let the lock settle).
- `AlreadyVoted` / `VotingClosed` → one vote per proposal; check `endTime`.

## Notes

- Voting power decays with lock time (Curve-style). Re-read `power` near vote time.
