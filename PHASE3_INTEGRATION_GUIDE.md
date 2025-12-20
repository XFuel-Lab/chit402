# Phase 3 Integration Guide

This guide explains how to complete the Phase 3 integration tasks after deployment.

## Prerequisites

- Phase 3 contracts deployed to Theta Mainnet
- `.env` file configured with `THETA_MAINNET_PRIVATE_KEY`
- Edge Node signer addresses (if available)

## Contract Addresses (Theta Mainnet)

- **ThetaPulseProof**: `0x38D0E8f0e11b29D87EF68F319de5c0471D0aDBfB`
- **InnovationTreasury**: `0x18F4d72375Da223b44ccB670b465002C369D242f`
- **veXF**: `0xA339c07A398D44Db3C5525A70a4ce77D8Fa53EdD`
- **Revenue Token**: `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`

Explorer Links:
- [ThetaPulseProof](https://explorer.thetatoken.org/address/0x38D0E8f0e11b29D87EF68F319de5c0471D0aDBfB)
- [InnovationTreasury](https://explorer.thetatoken.org/address/0x18F4d72375Da223b44ccB670b465002C369D242f)
- [veXF](https://explorer.thetatoken.org/address/0xA339c07A398D44Db3C5525A70a4ce77D8Fa53EdD)

## Task 1: Authorize Edge Node Signers

Edge Node signers are the addresses that will sign TPulse messages to verify user earnings. These need to be authorized in the ThetaPulseProof contract.

### Using the Integration Script

1. Add Edge Node signer addresses to `.env`:
```bash
EDGE_NODE_SIGNERS=0xSigner1Address,0xSigner2Address,0xSigner3Address
```

2. Run the integration script:
```bash
npx hardhat run scripts/phase3-integration-test.ts --network theta-mainnet
```

### Manual Authorization

Alternatively, authorize signers manually:

```typescript
const pulseProof = await ethers.getContractAt('ThetaPulseProof', '0x38D0E8f0e11b29D87EF68F319de5c0471D0aDBfB', signer);
await pulseProof.authorizeSigner('0xSignerAddress');
```

### Verify Authorization

Check if a signer is authorized:
```typescript
const isAuthorized = await pulseProof.authorizedSigners('0xSignerAddress');
console.log('Authorized:', isAuthorized);
```

## Task 2: Test Proof Verification

Proof verification allows Edge Nodes to verify user earnings and grant veXF multipliers.

### How It Works

1. Edge Node creates a signed message with:
   - User address
   - Earnings amount (TFUEL)
   - Unique nonce
   - Chain ID

2. Message hash: `keccak256(abi.encodePacked(user, earnings, nonce, chainId))`

3. Edge Node signs the message hash with their private key

4. User submits the proof to ThetaPulseProof contract

5. Contract verifies signature and grants multiplier based on total proven earnings

### Multiplier Tiers

- **1.5x**: 10,000 TFUEL proven earnings
- **2x**: 50,000 TFUEL proven earnings  
- **3x**: 100,000 TFUEL proven earnings

### Using the Integration Script

The script automatically:
1. Creates a test signature using the deployer as Edge Node
2. Authorizes the deployer as a signer (for testing only)
3. Submits a proof verification
4. Checks the resulting multiplier

### Manual Proof Verification

```typescript
const pulseProof = await ethers.getContractAt('ThetaPulseProof', '0x38D0E8f0e11b29D87EF68F319de5c0471D0aDBfB', signer);

// Edge Node signs the message (off-chain)
const messageHash = ethers.keccak256(
  ethers.solidityPacked(
    ['address', 'uint256', 'uint256', 'uint256'],
    [userAddress, earnings, nonce, chainId]
  )
);
const signature = await edgeNodeSigner.signMessage(ethers.getBytes(messageHash));

// User submits proof
await pulseProof.verifyProof(userAddress, earnings, nonce, signature);
```

### Backend API Endpoint

The backend provides an endpoint at `/api/pulse-proof/verify` for signature validation:

```bash
curl -X POST http://localhost:3001/api/pulse-proof/verify \
  -H "Content-Type: application/json" \
  -d '{
    "userAddress": "0x...",
    "earnings": "15000000000000000000000",
    "nonce": 1234567890,
    "signature": "0x..."
  }'
```

## Task 3: Deposit Funds into InnovationTreasury

The InnovationTreasury has 3 vaults:
- **Builder** (vault 0): For builder grants and development
- **Acquisition** (vault 1): For acquisitions and partnerships
- **Moonshot** (vault 2): For high-risk, high-reward projects

### Using the Integration Script

The script automatically deposits revenue tokens into all 3 vaults if the deployer has a balance.

### Manual Deposit

```typescript
const treasury = await ethers.getContractAt('InnovationTreasury', '0x18F4d72375Da223b44ccB670b465002C369D242f', signer);
const revenueToken = new ethers.Contract(revenueTokenAddress, ['function approve(address,uint256)'], signer);

// Approve treasury to spend tokens
await revenueToken.approve(treasuryAddress, amount);

// Deposit to Builder vault (0 = Builder, 1 = Acquisition, 2 = Moonshot)
await treasury.deposit(0, amount);
```

### Check Vault Balances

```typescript
const builderBalance = await treasury.vaultBalances(0);
const acquisitionBalance = await treasury.vaultBalances(1);
const moonshotBalance = await treasury.vaultBalances(2);
```

## Task 4: Test Proposal Creation and Voting

veXF holders can create proposals to withdraw funds from treasury vaults and vote on them.

### Requirements

- Minimum 1,000 veXF to create a proposal
- 7-day voting period
- 10% quorum (of total veXF supply)
- 51% majority required to pass

### Using the Integration Script

The script automatically:
1. Checks veXF balances
2. Creates a test proposal if deployer has enough veXF
3. Votes on the proposal with available signers
4. Displays proposal details

### Manual Proposal Creation

```typescript
const treasury = await ethers.getContractAt('InnovationTreasury', '0x18F4d72375Da223b44ccB670b465002C369D242f', signer);

// Create proposal
const proposalId = await treasury.createProposal(
  0, // Builder vault
  recipientAddress,
  amount,
  "Proposal description"
);
```

### Vote on Proposal

```typescript
// Vote FOR (true) or AGAINST (false)
await treasury.vote(proposalId, true);
```

### Execute Proposal

After voting period ends and quorum/majority are met:

```typescript
await treasury.executeProposal(proposalId);
```

### Get Proposal Details

```typescript
const proposal = await treasury.getProposal(proposalId);
console.log('Votes For:', proposal.votesFor);
console.log('Votes Against:', proposal.votesAgainst);
console.log('End Time:', new Date(Number(proposal.endTime) * 1000));
```

## Running the Full Integration Test

Run all integration tests at once:

```bash
npx hardhat run scripts/phase3-integration-test.ts --network theta-mainnet
```

The script will:
1. ✅ Authorize Edge Node signers (if provided in `.env`)
2. ✅ Test proof verification
3. ✅ Deposit funds into treasury vaults
4. ✅ Create and vote on a proposal

## Troubleshooting

### "No signers available"
- Ensure `THETA_MAINNET_PRIVATE_KEY` is set in `.env`

### "Insufficient voting power"
- Ensure the account has at least 1,000 veXF locked
- Lock XF tokens in veXF contract to get voting power

### "Unauthorized signer"
- Authorize Edge Node signers using `authorizeSigner()`
- Check that the signer address matches the recovered address from signature

### Network Errors (502, timeout)
- Theta Mainnet may be experiencing network issues
- Retry the operation
- Check Theta network status

## Next Steps

After completing integration tests:

1. ✅ Verify all contracts on Theta Explorer
2. ✅ Transfer contract ownership to multisig/governance
3. ✅ Set up monitoring for contract events
4. ✅ Document Edge Node integration process
5. ✅ Prepare user-facing documentation

## References

- [Phase 3 Deployment Summary](./deployments/phase3-mainnet.json)
- [Theta Explorer](https://explorer.thetatoken.org/)
- Contract ABIs in `artifacts/contracts/`

