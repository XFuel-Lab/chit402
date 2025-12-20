# Edge Node Signers Setup

## Overview

Edge Node signers are addresses that will sign TPulse messages to verify user earnings on the Theta network. These addresses must be authorized in the ThetaPulseProof contract before they can sign valid proofs.

## Adding Edge Node Signers to .env

Add the following line to your `.env` file:

```bash
EDGE_NODE_SIGNERS=0xSigner1Address,0xSigner2Address,0xSigner3Address
```

### Format
- **Comma-separated** list of Ethereum addresses
- No spaces (or spaces will be trimmed automatically)
- Each address must be a valid Ethereum address (0x followed by 40 hex characters)

### Example

```bash
EDGE_NODE_SIGNERS=0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb,0x8ba1f109551bD432803012645Hac136c6e2c5a6,0x90F79bf6EB2c4f870365E785982E1f101E93b906
```

## Authorization Process

Once you've added Edge Node signer addresses to `.env`, run the integration test script:

```bash
npx hardhat run scripts/phase3-integration-test.ts --network theta-mainnet
```

The script will:
1. Read addresses from `EDGE_NODE_SIGNERS` environment variable
2. Check if each signer is already authorized
3. Authorize any signers that aren't already authorized
4. Provide transaction links for each authorization

### Manual Authorization

You can also authorize signers manually:

```typescript
const pulseProof = await ethers.getContractAt(
  'ThetaPulseProof',
  '0x38D0E8f0e11b29D87EF68F319de5c0471D0aDBfB',
  signer
);

await pulseProof.authorizeSigner('0xSignerAddress');
```

## Verifying Authorization

Check if a signer is authorized:

```typescript
const isAuthorized = await pulseProof.authorizedSigners('0xSignerAddress');
console.log('Authorized:', isAuthorized);
```

Or use the Theta Explorer:
https://explorer.thetatoken.org/address/0x38D0E8f0e11b29D87EF68F319de5c0471D0aDBfB#readContract

## Current Status

- **ThetaPulseProof Contract**: `0x38D0E8f0e11b29D87EF68F319de5c0471D0aDBfB`
- **Deployer (for testing)**: `0x627082bFAdffb16B979d99A8eFc8F1874c0990C4` ✅ Already authorized
- **Production Edge Node Signers**: ⚠️ Not yet configured

## Notes

- The deployer address is automatically authorized during testing for proof verification
- Production Edge Node signers should be added to `.env` and authorized via the integration script
- Only authorized signers can sign valid proofs that will be accepted by the contract
- You can revoke authorization later using `revokeSigner()` if needed

