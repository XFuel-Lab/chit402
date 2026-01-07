# XFuel Core Modules

This directory contains the extracted core modules of the XFuel Protocol, organized by functionality.

## Directory Structure

- **zk/** - Zero-knowledge proof components for cross-chain bridge security
- **ferrari/** - Ferrari tokenomics (veXF, revenue distribution)
- **security/** - Security infrastructure (timelock, multi-sig, pausable contracts)

## Purpose

This extraction separates the core protocol components from the broader application, making it easier to:
- Audit critical security components
- Deploy core modules independently
- Maintain and upgrade core functionality
- Integrate with other systems

## Modules

### ZK (Zero-Knowledge Proofs)
- `ZKVerifier.sol` - On-chain Groth16 verifier for deposit proofs
- `proof-generator.js` - Off-chain proof generation service
- `circuits/` - Circom circuit definitions and compiled artifacts

### Ferrari (Tokenomics)
- `RevenueSplitter.sol` - Protocol revenue distribution (50% veXF, 25% buyback, 15% rXF, 10% treasury)
- `veXF.sol` - Vote-escrowed XF token with time-decay voting power

### Security
- `XFuelTimelock.sol` - Timelock controller for delayed execution
- `MultiSigTreasury.sol` - Multi-signature treasury for critical operations
- `XFUELPool-pausable.sol` - Pool contract with emergency pause functionality
- `XFUELRouter-pausable.sol` - Router contract with emergency pause functionality

## Integration

These modules are referenced by the main application contracts in the `contracts/` directory. Import paths have been updated to reflect the new structure.

## Security Notes

⚠️ **Critical Components**: All modules in this directory contain security-critical code.
- Changes require thorough audit and testing
- Timelock and multi-sig protections apply to upgrades
- Emergency pause mechanisms available for incident response

## Version

Extracted: January 7, 2026
Protocol Version: v3.1+

