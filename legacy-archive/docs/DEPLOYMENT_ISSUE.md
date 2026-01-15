# Deployment Environment Issue

## Problem

There is a compatibility issue between the Hardhat plugins and ethers version:

- Project uses: `ethers v5.7.2`
- `@nomicfoundation/hardhat-toolbox` includes: `@nomicfoundation/hardhat-ethers` (expects ethers v6)
- Error: `TypeError: (0 , ethers_1.getAddress) is not a function`

This affects all deployment scripts, not just Phase 1.

## Solution Options

### Option 1: Use nomiclabs plugin only (Recommended for ethers v5)

Modify `hardhat.config.cjs` to remove toolbox and use nomiclabs:

```javascript
// Remove or comment out:
// require('@nomicfoundation/hardhat-toolbox')

// Keep:
require('@nomiclabs/hardhat-ethers')
require('@openzeppelin/hardhat-upgrades')
require('solidity-coverage')
require('dotenv').config()
```

### Option 2: Upgrade to ethers v6

Update `package.json`:
- Remove ethers v5 override
- Update to ethers v6
- Update all code to use ethers v6 APIs

### Option 3: Manual deployment via Remix/Foundry

Deploy contracts manually using Remix IDE or Foundry, which don't have this compatibility issue.

## Current Status

- ✅ Contracts compile successfully
- ✅ Contracts are ready for deployment
- ❌ Hardhat deployment scripts blocked by environment issue
- ✅ Contracts can be deployed via Remix or other tools

## Workaround: Manual Deployment

1. Copy contract code to Remix IDE
2. Compile with Solidity 0.8.22
3. Deploy using Injected Provider (MetaMask/Theta Wallet)
4. Use the initialize function for upgradeable contracts

## Phase 1 Contracts Ready

All Phase 1 contracts are implemented and ready:
- `contracts/veXF.sol`
- `contracts/RevenueSplitter.sol`
- `contracts/CyberneticFeeSwitch.sol`

They can be deployed once the environment issue is resolved.

