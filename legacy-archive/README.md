# Legacy Archive

This folder contains historical files that have been deprecated for simplicity.

## What was removed and why

### Dynamic Fee System (DROPPED: Unnecessary complexity - fixed at 0.5%)
- `CyberneticFeeSwitch.sol` - Governance-settable fee tiers with Growth/Extraction modes
- `IFeeAdapter.sol` - Interface for dynamic fee control
- `CyberneticFeeSwitch.test.cjs` - Test suite for dynamic fees
- `test-fee-switch.ts` - Script for testing fee switch functionality

**Rationale**: The protocol now uses a static 0.5% fee (50 basis points) for simplicity and predictability. The dynamic fee system added unnecessary complexity without clear benefits.

### TipPool System (DROPPED: Out of scope)
- `TipPool.sol` - Tip pools with lottery functionality
- `TipPool.test.cjs` - Test suite for tip pools

**Rationale**: TipPool functionality was outside the core protocol scope and has been archived for potential future use.

### Axelar Bridge (DROPPED: Replaced by IBC/ZK bridge)
- `axelarBridge.ts` - Axelar cross-chain bridge utility

**Rationale**: The protocol pivoted to IBC Channel 190 and ZK bridge solutions. Axelar integration was abandoned.

### Phase 1 Deployment Scripts (DROPPED: Outdated)
- `phase1-deploy.ts` - TypeScript deployment script for Phase 1 (includes CyberneticFeeSwitch)
- `phase1-deploy.cjs` - CommonJS deployment script for Phase 1
- `monitor-fees.ts` - Fee monitoring script for dynamic fees

**Rationale**: These scripts deployed the dynamic fee system which is no longer used. New deployment scripts should not include CyberneticFeeSwitch or IFeeAdapter.

### Security Module (DROPPED: Outdated)
- `XFUELRouter-pausable.sol` - Router security module with dynamic fee logic
- `XFUELPool-pausable.sol` - Pool security module with dynamic fee tiers

**Rationale**: These core modules contained outdated dynamic fee logic. The main contracts now have the corrected static 0.5% fee implementation.

## Current Fee Structure

The protocol now uses a **static 0.5% fee** across all contracts:
- `SubVault.sol`: `FEE_BASIS_POINTS = 50` (0.5%)
- `XFUELPool.sol`: `FEE_BASIS_POINTS = 50` (0.5%)
- `XFUELRouter.sol`: `FEE_BASIS_POINTS = 50` (0.5%)

## Date Archived
January 7, 2026

## Migration Notes
If you need to reference the old dynamic fee system:
1. The CyberneticFeeSwitch contract supported two modes:
   - Growth Mode: 0.1% fee (10 bps)
   - Extraction Mode: 1.0% fee (100 bps)
2. The IFeeAdapter interface allowed XFUELRouter to query dynamic fees
3. Fee changes had a 7-day cooldown period
4. veXF holders with minimum balance could change fee settings

These features have been replaced with a simple, fixed 0.5% fee.

