# XFUEL Protocol - Security Fixes Required Before Audit

**Last Updated**: [Date]  
**Status**: ⚠️ Fixes Required

---

## Critical Fixes (MUST FIX)

### C001: Reentrancy Protection

**Severity**: 🔴 CRITICAL  
**Affected Contracts**: Multiple

#### XFUELRouter.collectAndDistributeFees()

**Issue**: No reentrancy protection when making external token transfers.

**Location**: `contracts/XFUELRouter.sol:59-96`

**Fix Required**:
```solidity
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract XFUELRouter is Ownable, ReentrancyGuard {
    function collectAndDistributeFees(address pool) external nonReentrant {
        // ... existing code
    }
}
```

#### XFUELPool.swap()

**Issue**: External token transfers before state updates.

**Location**: `contracts/XFUELPool.sol:93-128`

**Fix Required**:
```solidity
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract XFUELPool {
    function swap(...) external nonReentrant returns (...) {
        // Update state FIRST, then make external calls
        // ... existing code
    }
}
```

#### TreasuryILBackstop.provideCoverage()

**Issue**: External transfer before state update.

**Location**: `contracts/TreasuryILBackstop.sol:53-76`

**Fix Required**:
```solidity
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract TreasuryILBackstop is Ownable, ReentrancyGuard {
    function provideCoverage(...) external nonReentrant {
        // Update state BEFORE transfer
        totalCoverageProvided += coverageAmount;
        treasuryToken.transfer(lpAddress, coverageAmount);
        // ... existing code
    }
}
```

#### TipPool.endPool()

**Issue**: External transfers before state fully updated.

**Location**: `contracts/TipPool.sol:73-99`

**Fix Required**:
```solidity
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract TipPool {
    function endPool(uint256 poolId) external nonReentrant {
        // Update state FIRST (pool.ended = true)
        pool.ended = true;
        address winner = drawWinner(poolId);
        pool.winner = winner;
        
        // THEN make external calls
        if (creatorCut > 0 && pool.creator != address(0)) {
            (bool success, ) = payable(pool.creator).call{value: creatorCut}("");
            require(success, "Transfer failed");
        }
        // ... existing code
    }
}
```

**Testing**: Add reentrancy attack test cases after implementing fixes.

---

### C002: Randomness Implementation

**Severity**: 🔴 CRITICAL  
**Affected Contract**: TipPool

**Issue**: Uses predictable block.timestamp, block.difficulty, block.number for randomness.

**Location**: `contracts/TipPool.sol:116`

**Current Code**:
```solidity
uint256 random = uint256(keccak256(abi.encodePacked(block.timestamp, block.difficulty, block.number, poolId)));
```

**Fix Options**:

#### Option 1: Chainlink VRF (Recommended)
```solidity
import "@chainlink/contracts/src/v0.8/VRFConsumerBase.sol";

contract TipPool is VRFConsumerBase {
    bytes32 internal keyHash;
    uint256 internal fee;
    mapping(bytes32 => uint256) public randomnessRequests;
    mapping(uint256 => bytes32) public poolRandomnessRequests;
    
    function requestRandomWinner(uint256 poolId) external {
        require(LINK.balanceOf(address(this)) >= fee, "Not enough LINK");
        bytes32 requestId = requestRandomness(keyHash, fee);
        poolRandomnessRequests[poolId] = requestId;
    }
    
    function fulfillRandomness(bytes32 requestId, uint256 randomness) internal override {
        uint256 poolId = randomnessRequestToPool[requestId];
        // Use randomness to select winner
    }
}
```

#### Option 2: Commit-Reveal Scheme
```solidity
mapping(uint256 => bytes32) public poolCommits;
mapping(uint256 => uint256) public poolReveals;

function commitPoolRandomness(uint256 poolId, bytes32 commit) external {
    poolCommits[poolId] = commit;
}

function revealAndEndPool(uint256 poolId, uint256 reveal) external {
    require(keccak256(abi.encodePacked(reveal)) == poolCommits[poolId], "Invalid reveal");
    uint256 random = uint256(keccak256(abi.encodePacked(reveal, block.timestamp)));
    // Use random to select winner
}
```

**Testing**: Test randomness distribution and unpredictability.

---

### C003: Slippage Protection

**Severity**: 🔴 CRITICAL  
**Affected Contracts**: XFUELPool, XFUELRouter

#### XFUELPool.swap()

**Issue**: No minimum output amount validation.

**Location**: `contracts/XFUELPool.sol:93-128`

**Fix Required**:
```solidity
function swap(
    address recipient,
    bool zeroForOne,
    int256 amountSpecified,
    uint160 sqrtPriceLimitX96,
    uint256 amountOutMinimum  // ADD THIS
) external returns (int256 amount0, int256 amount1) {
    // ... calculate amountOut ...
    
    require(amountOut >= amountOutMinimum, "XFUELPool: SLIPPAGE_TOO_HIGH");
    
    // ... rest of function
}
```

#### XFUELRouter.swapAndStake()

**Issue**: No slippage protection parameter.

**Location**: `contracts/XFUELRouter.sol:146-168`

**Fix Required**:
```solidity
function swapAndStake(
    uint256 amount,
    string calldata targetLST,
    uint256 minAmountOut  // ADD THIS
) external payable returns (uint256 stakedAmount) {
    // ... calculate stakedAmount ...
    
    require(stakedAmount >= minAmountOut, "XFUELRouter: SLIPPAGE_TOO_HIGH");
    
    // ... rest of function
}
```

**Testing**: Test slippage validation with various price movements.

---

### M-03: Token Transfer Bug in XFUELPool.swap()

**Severity**: 🟠 HIGH  
**Affected Contract**: XFUELPool

**Issue**: When `zeroForOne=false`, transfers `amountOut` instead of `amountIn`.

**Location**: `contracts/XFUELPool.sol:120`

**Current (WRONG)**:
```solidity
} else {
    uint256 amountIn = uint256(amountSpecified);
    uint256 amountOut = _getAmountOut(amountIn, false);
    
    token1.transferFrom(msg.sender, address(this), amountOut);  // WRONG!
    token0.transfer(recipient, amountIn);
    // ...
}
```

**Fix Required**:
```solidity
} else {
    uint256 amountIn = uint256(amountSpecified);
    uint256 amountOut = _getAmountOut(amountIn, false);
    
    token1.transferFrom(msg.sender, address(this), amountIn);  // FIXED
    token0.transfer(recipient, amountOut);  // FIXED
    
    amount0 = int256(amountOut);
    amount1 = -amountSpecified;
}
```

**Testing**: Verify swaps work correctly in both directions.

---

## High Priority Fixes

### H001: Price Oracle Integration

**Severity**: 🟠 HIGH  
**Affected Contract**: XFUELRouter

**Issue**: Uses 1:1 conversion instead of actual price.

**Location**: `contracts/XFUELRouter.sol:121-125`

**Fix Required**:
```solidity
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract XFUELRouter {
    AggregatorV3Interface public priceOracle;
    
    function _convertToUSDC(uint256 amount0, uint256 amount1) internal view returns (uint256) {
        // Get prices from Chainlink
        (,int256 price0,,,) = priceOracle.latestRoundData();
        // Convert and sum
        return (amount0 * uint256(price0)) / 1e8 + amount1;
    }
}
```

---

### H004: Input Validation

**Severity**: 🟠 HIGH  
**Affected Contracts**: Multiple

#### XFUELRouter Constructor

**Fix Required**:
```solidity
constructor(...) Ownable(msg.sender) {
    require(_factory != address(0), "Invalid factory");
    require(_backstop != address(0), "Invalid backstop");
    require(_xfuelToken != address(0), "Invalid xfuelToken");
    require(_usdcToken != address(0), "Invalid usdcToken");
    require(_treasury != address(0), "Invalid treasury");
    require(_veXFContract != address(0), "Invalid veXFContract");
    // ... rest
}
```

#### TipPool.createPool()

**Fix Required**:
```solidity
function createPool(uint256 duration, address creator) external payable {
    require(duration > 0 && duration <= 365 days, "Invalid duration");
    require(creator != address(0), "Invalid creator");
    // ... rest
}
```

---

### M05: SafeERC20 Usage

**Severity**: 🟡 MEDIUM  
**Affected Contracts**: Multiple

**Fix Required**:
```solidity
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract XFUELRouter {
    using SafeERC20 for IERC20;
    
    // Replace all:
    // usdcToken.transfer(...)
    // With:
    usdcToken.safeTransfer(...);
}
```

Apply to:
- XFUELRouter
- TreasuryILBackstop
- XFUELPool (if using IERC20)

---

## Summary

### Fixes Required Before Audit

1. ✅ **C001**: Add ReentrancyGuard to 4 functions
2. ✅ **C002**: Replace randomness implementation (VRF or commit-reveal)
3. ✅ **C003**: Add slippage protection to swap functions
4. ✅ **M-03**: Fix token transfer bug in XFUELPool.swap()
5. ✅ **H001**: Integrate price oracle (or document as placeholder)
6. ✅ **H004**: Add input validation to constructors and functions
7. ✅ **M05**: Use SafeERC20 for all token transfers

### Estimated Implementation Time

- Critical fixes: 1-2 weeks
- High priority fixes: 1 week
- Testing and verification: 1 week
- **Total**: 3-4 weeks

---

## Testing After Fixes

After implementing fixes, ensure:

1. All existing tests still pass
2. New tests added for fixed vulnerabilities
3. Reentrancy attack tests pass
4. Slippage protection tests pass
5. Randomness tests (if applicable) verify unpredictability
6. Integration tests cover all fixed flows

---

**Status**: ⚠️ **FIXES REQUIRED BEFORE AUDIT**  
**Priority**: Address critical fixes immediately


