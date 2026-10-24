# EquivocationEscrowV0

Base Sepolia (chainId 84532) test bond for the Chit402 receipt log. Test USDC only.
Mainnet needs its own design; nothing here is a mainnet parameter.

## What it does

The log issuer posts a bond in Circle's Base Sepolia USDC. Anyone holding two EIP-712
tree heads signed by the pinned P-256 key that disagree about the log can submit them:

- **Type A:** same epoch and tree size, different roots.
- **Type B:** same epoch, different leaf hashes at the same index, each with an inclusion
  proof under its head (RFC 9162 loop, ported from `services/gateway/src/receipt-merkle.js`).

Submission is commit then reveal. The first valid reveal opens an incident and, within the
freeze cap below, stops withdrawal at once. The epoch bounty goes to the earliest commit among reveals that land in
the contest window. Affected payers register refunds with a signed `ReceiptBinding` during
the claim window, and the incident settles pro rata if refunds exceed the bond.

Incident and freeze rules:

- **One incident per (epoch, kid).** Incidents are keyed by the conflicting epoch plus the
  pinned kid (`incidentKey(epoch)`). Later keys from the same epoch join its incident while
  its claim window is open and revert with `IncidentClosed` after that, so a settled or
  expired epoch never re-opens.
- **At most one open incident at a time.** A key from a different epoch reverts with
  `AnotherIncidentOpen` until the open incident is settled (anyone may call
  `settle(incidentId)` after its window).
- **Cumulative freeze cap of 28 days** (`FREEZE_CAP`) over the bond's whole life. Each new
  incident freezes withdrawal from its opening for min(14 days, unused cap), charged to
  `frozenUsed` up front (`freezeUntil`). Once the cap is used, the owner's notice and
  withdrawal path works again and later evidence can no longer freeze; it still records
  and pays from the remaining bond within the caps.
- **Accepted payouts stay honored.** Bounties already credited and refunds registered in an
  accepted incident pay within their caps after the cap is hit and after withdrawal. At
  withdrawal the owner receives the bond minus refunds registered in an unsettled incident
  and pending bounties within the bounty cap; those stay in the contract. Closing stops new
  reveals and new refund registrations. Refunds are one per leaf across all incidents.

## Signing format

- `TreeHead(uint32 epoch,uint64 tree_size,bytes32 root,uint64 published_at,bytes32 kid)`
  under domain `Chit402TreeHead`, version `1`, chainId 84532, salt = log id.
- `ReceiptBinding(bytes32 leaf_hash,bytes32 payer_commitment,uint64 amount_atomic,bytes32 asset_id,bytes32 kid)`
  under domain `Chit402ReceiptBinding`, same version, chainId and salt.
- The P-256 key signs `e = SHA-256(0x1901 || domainSeparator || structHash)`. The contract
  checks `e` with the `0x100` precompile and accepts high-S. A call passes only if it
  succeeds, returns exactly 32 bytes, and the word is 1.
- The constructor recomputes the RFC 7638 thumbprint of the pinned x/y and requires it to
  equal `kid`, and requires one genuine signed head (liveness proof).

Shared vectors: `test/escrow/vectors/eip712.json`.

## Parameters

| | |
|---|---|
| Token | Circle Base Sepolia USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (6 decimals, checked on a fork) |
| Minimum bond to activate | 1,000 USDC |
| Bounty | 50 USDC per epoch, 100 USDC total |
| Refund | min(signed amount, 5 USDC) per leaf, one per leaf across incidents |
| Bond period before notice | 14 days |
| Notice before withdrawal | 14 days |
| Claim window per incident | 14 days |
| Cumulative freeze cap | 28 days |
| Commit delay / reveal window / contest window | 5 minutes / 24 hours / 1 hour |
| Open commits per address | 8 |

Times are `block.timestamp` seconds. Commits stop at `withdrawableAt` (notice + 14 days).
Withdrawal waits for `withdrawableAt + MIN_DELAY + REVEAL_WINDOW` and for any current
freeze to end. Before activation the owner may withdraw at any time, which closes the
contract.

`asset_id` in a binding names the receipt's payment asset (Base mainnet USDC,
`eip155:8453/erc20:0x8335...2913`). Refunds are paid in Base Sepolia test USDC against
those amounts. That is testnet accounting only.

## Not in v0

No pause, upgrade, key rotation, ownership transfer, or quarantine list change after
activation. Evidence types A and B only. Accounting uses `bondAccounted`, never
`balanceOf`, so direct transfers change nothing. Payments are pull only.

Tests and the deploy script are in `test/escrow/`.
