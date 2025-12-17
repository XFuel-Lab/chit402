# XFUEL Protocol - Known Issues

This document tracks known issues, concerns, and areas requiring attention before and during the security audit.

## Critical Issues

### C001: Missing Reentrancy Protection
**Status**: 🔴 CRITICAL  
**Location**: All contracts with external calls  
**Description**: No ReentrancyGuard modifiers on functions that make external calls before state updates.

**Affected Functions**:
- `XFUELRouter.collectAndDistributeFees()` - Lines 59-96
- `XFUELPool.swap()` - Lines 93-128
- `TreasuryILBackstop.provideCoverage()` - Lines 53-76
- `TipPool.endPool()` - Lines 73-99

**Risk**: Attacker could reenter and drain funds or corrupt state.

**Recommended Fix**: Add OpenZeppelin ReentrancyGuard and `nonReentrant` modifier.

---

### C002: Pseudorandom Number Generation in TipPool
**Status**: 🔴 CRITICAL  
**Location**: `TipPool.sol::drawWinner()` - Line 116  
**Description**: Uses `block.timestamp`, `block.difficulty`, and `block.number` for randomness, which is predictable and miner-influenceable.

**Code**:
```solidity
uint256 random = uint256(keccak256(abi.encodePacked(block.timestamp, block.difficulty, block.number, poolId)));
```

**Risk**: Miners/validators can predict winners and manipulate outcomes.

**Recommended Fix**: Implement Chainlink VRF or commit-reveal scheme.

---

### C003: No Slippage Protection
**Status**: 🔴 CRITICAL  
**Location**: `XFUELPool.swap()`, `XFUELRouter.swapAndStake()`  
**Description**: Swap functions do not enforce minimum output amounts, allowing front-running.

**Risk**: Users may receive significantly less than expected due to MEV attacks.

**Recommended Fix**: Add `amountOutMinimum` parameter and validation.

---

## High Priority Issues

### H001: Simplified Price Conversion Logic
**Status**: 🟠 HIGH  
**Location**: `XFUELRouter._convertToUSDC()` - Lines 121-125  
**Description**: Uses 1:1 conversion assumption instead of actual price oracles.

**Code**:
```solidity
function _convertToUSDC(uint256 amount0, uint256 amount1) internal pure returns (uint256) {
    // Simplified: assume 1:1 conversion for demo
    // In production, use price oracles
    return amount0 + amount1;
}
```

**Risk**: Incorrect fee distribution amounts.

**Recommended Fix**: Integrate Chainlink price feeds or TWAP mechanism.

---

### H002: Simplified Buyback Logic
**Status**: 🟠 HIGH  
**Location**: `XFUELRouter._buybackAndBurn()` - Lines 101-116  
**Description**: Buyback mechanism is incomplete - only tracks amounts, doesn't execute actual swaps or burns.

**Code**:
```solidity
// In production: swap USDC -> XF, then burn XF
// xfuelToken.transfer(address(0xdead), xfAmount);
```

**Risk**: Buyback-burn mechanism not functional.

**Recommended Fix**: Implement actual DEX swap and burn logic.

---

### H003: Incomplete Swap and Stake Implementation
**Status**: 🟠 HIGH  
**Location**: `XFUELRouter.swapAndStake()` - Lines 146-168  
**Description**: Function is placeholder - doesn't actually execute swaps or IBC transfers.

**Code**:
```solidity
// Simplified calculation: assume 1 TFUEL = 0.95 staked tokens (5% fee)
// This is a placeholder until full swap/stake logic is implemented
stakedAmount = (amount * 95) / 100;
```

**Risk**: Core functionality not implemented.

**Recommended Fix**: Implement full swap → IBC → stake flow.

---

### H004: Missing Pool State Validation
**Status**: 🟠 HIGH  
**Location**: `XFUELPool.swap()` - Line 99  
**Description**: No validation that pool is initialized before swap.

**Risk**: Swaps on uninitialized pools could cause unexpected behavior.

**Recommended Fix**: Add `require(token0 != address(0), "Pool not initialized")`.

---

### H005: Missing Balance Checks
**Status**: 🟠 HIGH  
**Location**: `XFUELRouter.collectAndDistributeFees()` - Lines 85-93  
**Description**: Balance checks exist but may fail silently if insufficient.

**Risk**: Fee distribution could fail partially, leaving funds stuck.

**Recommended Fix**: Revert if insufficient balance, or handle gracefully.

---

## Medium Priority Issues

### M001: No Timelock on Emergency Functions
**Status**: 🟡 MEDIUM  
**Location**: `TreasuryILBackstop.emergencyWithdraw()` - Line 90  
**Description**: Owner can immediately withdraw all treasury funds.

**Risk**: Single point of failure - owner compromise = fund loss.

**Recommended Fix**: Add timelock delay (e.g., 48 hours).

---

### M002: Single Owner Control
**Status**: 🟡 MEDIUM  
**Location**: All contracts using `Ownable`  
**Description**: Single owner controls all critical functions.

**Risk**: Centralization risk - owner key compromise or malicious owner.

**Recommended Fix**: Migrate to multi-sig wallet (Gnosis Safe).

---

### M003: Simplified IL Calculation
**Status**: 🟡 MEDIUM  
**Location**: `TreasuryILBackstop.calculateIL()` - Lines 39-45  
**Description**: Uses basic formula that may not accurately reflect all IL scenarios.

**Risk**: Incorrect coverage amounts.

**Recommended Fix**: Use standard IL formula and add test cases.

---

### M004: Missing Input Validation
**Status**: 🟡 MEDIUM  
**Location**: Multiple functions  
**Description**: Various functions lack comprehensive input validation.

**Examples**:
- `XFUELRouter.collectAndDistributeFees()` - No validation that pool exists
- `XFUELPoolFactory.createPool()` - No validation of initial price reasonableness
- `TipPool.createPool()` - No maximum duration limit

**Risk**: Invalid inputs could cause unexpected behavior.

**Recommended Fix**: Add comprehensive require statements.

---

### M005: No Maximum Duration for Tip Pools
**Status**: 🟡 MEDIUM  
**Location**: `TipPool.createPool()` - Line 37  
**Description**: No upper bound on pool duration.

**Risk**: Pools could be created with extremely long durations, locking funds.

**Recommended Fix**: Add `require(duration <= MAX_DURATION, "Duration too long")`.

---

### M006: Missing Zero Address Checks
**Status**: 🟡 MEDIUM  
**Location**: Various functions  
**Description**: Some functions don't validate non-zero addresses.

**Examples**:
- `XFUELRouter.setVeXFContract()` - Could set to zero address
- `XFUELRouter.setTreasury()` - Could set to zero address

**Risk**: Funds could be sent to zero address (unrecoverable).

**Recommended Fix**: Add `require(_address != address(0))` checks.

---

## Low Priority Issues

### L001: Missing Events
**Status**: 🟢 LOW  
**Location**: Various functions  
**Description**: Some state-changing functions don't emit events.

**Examples**:
- `XFUELRouter.setVeXFContract()` - No event
- `XFUELRouter.setTreasury()` - No event
- `TreasuryILBackstop.setPool()` - No event

**Risk**: Reduced transparency and off-chain tracking capability.

**Recommended Fix**: Add event emissions for all state changes.

---

### L002: Incomplete NatSpec Documentation
**Status**: 🟢 LOW  
**Location**: All contracts  
**Description**: Some functions lack comprehensive NatSpec comments.

**Risk**: Reduced code clarity and auditability.

**Recommended Fix**: Add @param and @return documentation.

---

### L003: No Pause Mechanism
**Status**: 🟢 LOW  
**Location**: All contracts  
**Description**: No emergency pause functionality.

**Risk**: Cannot stop protocol if critical vulnerability discovered.

**Recommended Fix**: Consider adding Pausable contract from OpenZeppelin.

---

### L004: Hardcoded Fee Splits
**Status**: 🟢 LOW  
**Location**: `XFUELRouter.sol` - Lines 24-26  
**Description**: Fee splits (60/25/15) are hardcoded constants.

**Risk**: Cannot adjust fees without redeployment.

**Recommended Fix**: Consider making configurable (with governance).

---

## Design Concerns

### D001: Simplified Uniswap-v3 Implementation
**Status**: ⚠️ DESIGN CONCERN  
**Location**: `XFUELPool.sol`  
**Description**: Pool uses simplified constant product formula instead of full Uniswap-v3 concentrated liquidity math.

**Risk**: May not match Uniswap-v3 behavior exactly, causing unexpected behavior.

**Recommendation**: Either fully implement Uniswap-v3 logic or clearly document deviations.

---

### D002: No Liquidity Position Tracking
**Status**: ⚠️ DESIGN CONCERN  
**Location**: `XFUELPool.sol`  
**Description**: Pool doesn't track individual LP positions (only total liquidity).

**Risk**: Cannot support multiple LPs or position-specific operations.

**Recommendation**: Document limitation or implement full LP position tracking.

---

### D003: Mock VRF Commented Out
**Status**: ⚠️ DESIGN CONCERN  
**Location**: `TipPool.sol` - Line 115  
**Description**: Code comments indicate VRF should be used but it's not implemented.

**Risk**: Production code uses predictable randomness.

**Recommendation**: Implement real VRF before mainnet.

---

## Test Coverage Concerns

### T001: Minimal Test Coverage
**Status**: 🔴 CRITICAL  
**Description**: Only `MockXFUELRouter` has tests. All production contracts lack tests.

**Missing Tests**:
- `XFUELRouter` - No tests
- `XFUELPool` - No tests
- `XFUELPoolFactory` - No tests
- `TreasuryILBackstop` - No tests
- `TipPool` - No tests

**Risk**: Undetected bugs in production.

**Recommendation**: Write comprehensive test suite before audit.

---

### T002: No Integration Tests
**Status**: 🟠 HIGH  
**Description**: No tests for cross-contract interactions.

**Missing**:
- Router → Pool interactions
- Pool → Backstop interactions
- Fee collection flow
- Swap and stake flow

**Risk**: Integration bugs not detected.

**Recommendation**: Add integration tests.

---

### T003: No Fuzz Testing
**Status**: 🟡 MEDIUM  
**Description**: No property-based or fuzz testing.

**Risk**: Edge cases not covered.

**Recommendation**: Consider using Foundry fuzzing or Echidna.

---

## External Dependencies

### E001: IBC Bridge Security
**Status**: ⚠️ EXTERNAL RISK  
**Description**: IBC bridge to Cosmos is external dependency with unknown security posture.

**Risk**: Bridge exploit could result in total loss of bridged funds.

**Recommendation**: 
- Audit IBC bridge implementation
- Add monitoring and circuit breakers
- Consider insurance coverage

---

### E002: Cosmos LST Contract Security
**Status**: ⚠️ EXTERNAL RISK  
**Description**: Cosmos Liquid Staking Token contracts are external dependencies.

**Risk**: LST contract exploit could affect XFUEL users.

**Recommendation**: Review LST contracts or rely on their audits.

---

## Code Quality

### Q001: Inconsistent Error Messages
**Status**: 🟢 LOW  
**Description**: Error messages use different formats across contracts.

**Recommendation**: Standardize error message format.

---

### Q002: Magic Numbers
**Status**: 🟢 LOW  
**Description**: Some constants are used inline instead of named constants.

**Example**: `(amount * 95) / 100` should use named constant.

**Recommendation**: Extract magic numbers to named constants.

---

## Summary

- **Critical**: 4 issues
- **High**: 5 issues
- **Medium**: 6 issues
- **Low**: 4 issues
- **Design Concerns**: 3 items
- **Test Coverage**: 3 concerns
- **External Dependencies**: 2 risks

**Total Issues**: 27

---

## Action Items Before Audit

1. ✅ Fix all Critical issues (C001-C003, T001)
2. ⚠️ Address High priority issues (H001-H005)
3. ⚠️ Consider Medium priority issues (M001-M006)
4. ⚠️ Improve test coverage to >80%
5. ⚠️ Document external dependencies and risks

---

## Notes for Auditors

- Many functions contain `// Simplified` or `// Placeholder` comments indicating incomplete implementations
- Code appears to be in active development - many TODOs in comments
- Focus audit on implemented functionality, but note placeholder sections
- Pay special attention to reentrancy vulnerabilities
- Verify randomness implementation in TipPool
- Check all access control mechanisms

