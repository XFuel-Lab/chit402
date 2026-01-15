# Phase 3 Integration Guide

Phase 3 introduces Theta Pulse Proof verification and the Innovation Treasury system with veXF governance.

## Overview

Phase 3 adds two major components:

1. **ThetaPulseProof**: Verifies signed TPulse messages from Edge Nodes and grants permanent veXF multipliers based on proven earnings (up to 3×)
2. **InnovationTreasury**: 3-vault system (Builder, Acquisition, Moonshot) with basic veXF proposal/voting mechanism

## Contracts

### ThetaPulseProof.sol

Verifies signed TPulse messages from authorized Edge Nodes and grants permanent veXF multipliers based on cumulative proven earnings.

**Features:**
- Signature verification using ECDSA with Ethereum signed message format
- Authorized Edge Node signer management
- Nonce-based replay attack prevention
- Cumulative earnings tracking
- Tiered multiplier system:
  - Tier 1: 10k TFUEL = 1.5× multiplier
  - Tier 2: 50k TFUEL = 2× multiplier
  - Tier 3: 100k TFUEL = 3× multiplier
- Permanent multipliers stored on-chain in veXF contract
- UUPS upgradeable

**Key Functions:**
- `verifyProof(user, earnings, nonce, signature)` - Verify and record Edge Node proof
- `authorizeSigner(signer)` - Authorize an Edge Node signer (owner only)
- `revokeSigner(signer)` - Revoke Edge Node signer (owner only)
- `getMultiplier(user)` - Get current multiplier based on proven earnings
- `setVeXF(veXF)` - Set veXF contract address (owner only)

**Message Format:**
```
keccak256(abi.encodePacked(user, earnings, nonce, chainId))
```

The message is then signed using Ethereum signed message format (`\x19Ethereum Signed Message:\n32` + hash).

**Integration with veXF:**
- ThetaPulseProof calls `veXF.setPermanentMultiplier(user, multiplierBps)`
- Permanent multipliers stack with time-based multipliers from lock duration
- Final veXF balance = baseBalance * permanentMultiplier / 10000

### InnovationTreasury.sol

3-vault treasury system with basic veXF-based proposal and voting mechanism. Prepares for full Governor integration later.

**Vaults:**
1. **Builder** (0): Funds for protocol development and builder incentives
2. **Acquisition** (1): Funds for strategic acquisitions and partnerships
3. **Moonshot** (2): High-risk, high-reward experimental projects

**Features:**
- Separate balances for each vault
- veXF-based proposal creation (minimum 1000 veXF required)
- 7-day voting period
- Quorum requirement: 10% of total veXF supply
- Majority requirement: 51% of votes cast
- Proposal execution after voting ends
- Proposal cancellation (proposer or owner)
- UUPS upgradeable

**Key Functions:**
- `deposit(vault, amount)` - Deposit tokens into a vault
- `createProposal(vault, recipient, amount, description)` - Create withdrawal proposal
- `vote(proposalId, support)` - Vote on a proposal (true = yes, false = no)
- `executeProposal(proposalId)` - Execute a passed proposal
- `cancelProposal(proposalId)` - Cancel a proposal (proposer or owner only)
- `getProposal(proposalId)` - Get proposal details
- `hasVoted(proposalId, voter)` - Check if a voter has voted

**Voting Parameters:**
- Minimum voting power to create proposal: 1000 veXF
- Voting period: 7 days
- Quorum: 10% of total veXF supply
- Majority: 51% of votes cast

## veXF Enhancements (Phase 3)

veXF contract has been enhanced to support permanent multipliers:

**New Features:**
- `setPermanentMultiplier(user, multiplierBps)` - Set permanent multiplier (only callable by ThetaPulseProof)
- `getPermanentMultiplier(user)` - Get permanent multiplier for a user
- `setPulseProofContract(pulseProofContract)` - Set ThetaPulseProof contract address (owner only)

**Multiplier Stacking:**
- Base multiplier: 1× to 4× based on lock duration (existing Phase 1 behavior)
- Permanent multiplier: 1× to 3× from ThetaPulseProof (Phase 3)
- Final multiplier: baseMultiplier * permanentMultiplier / 10000
- Example: 4× base (max lock) * 3× permanent (max tier) = 12× total (theoretical max)

## Deployment

Deploy Phase 3 contracts (requires Phase 1 to be deployed):

```bash
# Deploy to local network
npx hardhat run scripts/phase3-deploy.ts

# Deploy to Theta testnet
npx hardhat run scripts/phase3-deploy.ts --network theta-testnet
```

**Prerequisites:**
- Phase 1 contracts must be deployed
- Phase 1 deployment file at `deployments/phase1-{chainId}.json` OR
- Environment variables set:
  - `VEXF_ADDRESS`
  - `REVENUE_TOKEN_ADDRESS`

**Optional Environment Variables:**
- `EDGE_NODE_SIGNERS` - Comma-separated list of Edge Node signer addresses to authorize automatically

**Deployment Output:**
- Contract addresses saved to `deployments/phase3-{chainId}.json`
- `.env` file updated with Phase 3 contract addresses:
  - `VITE_THETA_PULSE_PROOF_ADDRESS`
  - `VITE_INNOVATION_TREASURY_ADDRESS`
  - `THETA_PULSE_PROOF_ADDRESS`
- veXF automatically configured with ThetaPulseProof contract

**Deployment Steps:**
1. Deploy ThetaPulseProof proxy
2. Deploy InnovationTreasury proxy
3. Configure veXF to allow ThetaPulseProof to set multipliers
4. Optionally authorize Edge Node signers

## Testing

Run comprehensive test suite:

```bash
# Run all Phase 3 tests
npx hardhat test test/ThetaPulseProof.test.cjs
npx hardhat test test/InnovationTreasury.test.cjs

# Run with coverage (target: 95%+)
npm run test:coverage
```

**Test Coverage:**
- ThetaPulseProof: Signature verification, multiplier tiers, replay attack prevention, signer management
- InnovationTreasury: Vault deposits, proposal creation, voting, execution, quorum/majority checks

## Backend Integration

### Pulse Proof Verification Endpoint

**POST `/api/pulse-proof/verify`**

Verify and prepare TPulse message proof for on-chain submission.

**Request Body:**
```json
{
  "userAddress": "0x...",
  "earnings": "15000000000000000000",
  "nonce": 1,
  "signature": "0x..."
}
```

**Response:**
```json
{
  "success": true,
  "contractAddress": "0x...",
  "calldata": "0x...",
  "message": "Proof verified. Submit transaction to contract."
}
```

**GET `/api/pulse-proof/verify-signature`**

Verify signature format without submitting to chain (validation only).

**Query Parameters:**
- `userAddress`: User address
- `earnings`: Earnings amount (string)
- `nonce`: Nonce (number)
- `signature`: Signature hex string

**Response:**
```json
{
  "success": true,
  "signer": "0x...",
  "valid": true,
  "messageHash": "0x...",
  "ethSignedMessageHash": "0x..."
}
```

## Integration Examples

### ThetaPulseProof Integration

**1. Edge Node Signs Message:**
```javascript
// Edge Node side
const messageHash = ethers.keccak256(
  ethers.solidityPacked(
    ['address', 'uint256', 'uint256', 'uint256'],
    [userAddress, earnings, nonce, chainId]
  )
);
const signature = await edgeNodeWallet.signMessage(ethers.getBytes(messageHash));
```

**2. User Submits Proof:**
```solidity
// On-chain
pulseProof.verifyProof(user, earnings, nonce, signature);
// - Verifies signature
// - Updates totalProvenEarnings
// - Grants/updates permanent multiplier in veXF
```

**3. Check Multiplier:**
```solidity
uint256 multiplier = pulseProof.getMultiplier(user);
// Returns: 10000 (1x), 15000 (1.5x), 20000 (2x), or 30000 (3x)
```

### InnovationTreasury Integration

**1. Deposit to Vault:**
```solidity
treasuryToken.approve(treasury, amount);
treasury.deposit(InnovationTreasury.VaultType.Builder, amount);
```

**2. Create Proposal:**
```solidity
// Requires minimum 1000 veXF voting power
treasury.createProposal(
  InnovationTreasury.VaultType.Builder,
  recipient,
  amount,
  "Fund builder grant program"
);
```

**3. Vote on Proposal:**
```solidity
// veXF holders vote
treasury.vote(proposalId, true); // true = yes, false = no
```

**4. Execute Proposal:**
```solidity
// After 7 days and if quorum + majority met
treasury.executeProposal(proposalId);
// Transfers funds from vault to recipient
```

### veXF Multiplier Stacking

**Example: User with max lock and Tier 3 earnings:**
```solidity
// User locks XF for 4 years (max lock)
veXF.createLock(amount, unlockTime); // Gets 4× base multiplier

// User proves 100k TFUEL earnings
pulseProof.verifyProof(user, parseEther("100000"), nonce, signature);
// Gets 3× permanent multiplier

// Final veXF balance calculation:
// baseBalance = XF * 4 (from lock duration)
// permanentMultiplier = 30000 (3×)
// finalBalance = baseBalance * 30000 / 10000 = baseBalance * 3
// Total effective multiplier: 4 × 3 = 12×
```

## Security Considerations

### ThetaPulseProof
- **Signature Verification**: Uses OpenZeppelin's MessageHashUtils and ECDSA for secure signature verification
- **Replay Protection**: Nonce-based system prevents duplicate proof submissions
- **Authorized Signers**: Only authorized Edge Nodes can sign valid proofs
- **Multiplier Limits**: Maximum 3× permanent multiplier (30000 basis points)

### InnovationTreasury
- **Quorum Protection**: Requires 10% of total veXF supply to vote
- **Majority Requirement**: 51% of votes must support proposal
- **Voting Period**: 7-day voting period prevents rushed decisions
- **Access Control**: Only veXF holders with sufficient voting power can create proposals
- **Cancellation**: Proposals can be cancelled by proposer or owner before execution

## Upgradeability

All Phase 3 contracts use UUPS (Universal Upgradeable Proxy Standard) pattern:
- **Proxy**: User-facing address (never changes)
- **Implementation**: Logic contract (upgradeable by owner)
- **Upgrade**: Only owner can authorize upgrades

**Upgrade Process:**
```bash
# Deploy new implementation
npx hardhat run scripts/upgrade-phase3.ts --network theta-testnet
```

## Future Enhancements

### Planned for Phase 4:
- Full Governor integration for InnovationTreasury (replacing basic proposal system)
- Timelock for proposal execution
- Delegation support for veXF voting
- Multi-signature support for treasury operations
- Advanced proposal types (parameter changes, contract upgrades)

### ThetaPulseProof Enhancements:
- Batch proof verification
- Historical earnings verification
- Dynamic multiplier tiers based on total network earnings
- Integration with Edge Node reputation system

## Environment Variables

Add to `.env` file:
```bash
# Phase 3 Contracts
VITE_THETA_PULSE_PROOF_ADDRESS=0x...
VITE_INNOVATION_TREASURY_ADDRESS=0x...
THETA_PULSE_PROOF_ADDRESS=0x...

# Edge Node Signers (optional, comma-separated)
EDGE_NODE_SIGNERS=0x...,0x...,0x...

# Backend
THETA_RPC_URL=https://eth-rpc-api-testnet.thetatoken.org/rpc
```

## Next Steps

1. Deploy Phase 3 contracts to testnet
2. Authorize Edge Node signers in ThetaPulseProof
3. Test proof verification with real Edge Node signatures
4. Deposit initial funds to InnovationTreasury vaults
5. Test proposal creation and voting with veXF holders
6. Transfer ownership to multisig/governance
7. Monitor multiplier grants and treasury proposals

