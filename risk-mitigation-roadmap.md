# XFuel Protocol - Risk Mitigation Roadmap

**Version:** 1.0  
**Last Updated:** January 6, 2026  
**Status:** Active - Pre-Audit Phase

---

## Executive Summary

This document consolidates risk analysis from the XFuel Protocol Whitepaper (Section 8) with specific audit findings from security reviews, prioritizing mitigation strategies by funding requirements and implementation phases. The roadmap distinguishes between **no-funding actions** (internal code fixes, tests, documentation) and **post-funding initiatives** (external audits, bug bounties, infrastructure).

---

## Table of Contents

1. [Risk Categories](#risk-categories)
2. [Prioritization Framework](#prioritization-framework)
3. [Technical Risks](#technical-risks)
4. [Economic Risks](#economic-risks)
5. [Regulatory Risks](#regulatory-risks)
6. [Implementation Timeline](#implementation-timeline)
7. [Success Metrics](#success-metrics)

---

## Risk Categories

Risks are classified into three primary categories aligned with Whitepaper Section 8:

1. **Technical Risks**: Smart contract vulnerabilities, ZK proof security, infrastructure failures
2. **Economic Risks**: Token price volatility, liquidity issues, peg instability
3. **Regulatory Risks**: Compliance, securities classification, operational restrictions

---

## Prioritization Framework

### Funding Classification

| **Funding Need** | **Description** | **Timeline** |
|------------------|-----------------|--------------|
| **No-Funding** | Internal fixes (code, tests, docs) | Q1-Q2 2026 |
| **Post-Funding** | External resources (audits, bounties, oracles) | Q2-Q4 2026 |

### Severity Levels

| **Severity** | **Symbol** | **Criteria** | **Action Required** |
|--------------|------------|--------------|---------------------|
| **Critical** | 🔴 | Protocol insolvency, fund loss | Immediate fix |
| **High** | 🟠 | Economic imbalance, user loss | Fix before mainnet |
| **Medium** | 🟡 | UX degradation, temporary issues | Fix in Q2 2026 |
| **Low** | 🟢 | Minor improvements, optimizations | Fix in Q3-Q4 2026 |

---

## Technical Risks

### T-01: Reentrancy Vulnerabilities

**Whitepaper Alignment:** Section 8.1 - Smart Contract Exploits  
**Audit Finding:** H-01, C001 (TipPool, XFUELRouter, TreasuryILBackstop)

| **Property** | **Details** |
|--------------|-------------|
| **Severity** | 🔴 **Critical** |
| **Likelihood** | 🟡 Medium (depends on attack sophistication) |
| **Impact** | Protocol insolvency, fund drainage |
| **Funding Need** | **No-Funding** (internal code fix) |
| **Phase** | **Phase 1: Pre-Audit (Jan-Feb 2026)** |

#### Description
Multiple contracts perform external calls (token transfers) before updating state, violating the Checks-Effects-Interactions pattern. Attackers could re-enter during transfers to drain funds or manipulate state.

**Affected Contracts:**
- `TipPool.endPool()` - Lines 73-99
- `XFUELRouter.collectAndDistributeFees()` - Lines 59-96
- `TreasuryILBackstop.provideCoverage()` - Lines 53-76
- `XFUELPool.swap()` - Lines 93-128

#### Mitigation Strategy

**No-Funding Actions:**
1. ✅ **Add ReentrancyGuard** (OpenZeppelin) to all affected contracts
2. ✅ **Refactor state updates** to occur before external calls
3. ✅ **Replace `transfer()` with `call()`** for better gas handling
4. ✅ **Add reentrancy attack tests** (Hardhat/Foundry)
5. ✅ **Code review** by 2+ internal developers

**Implementation:**
```solidity
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract TipPool is ReentrancyGuard {
    function endPool(uint256 poolId) external nonReentrant {
        // 1. Checks
        require(!pool.ended, "Pool already ended");
        
        // 2. Effects (state updates FIRST)
        pool.ended = true;
        address winner = drawWinner(poolId);
        pool.winner = winner;
        
        // 3. Interactions (external calls LAST)
        (bool success, ) = payable(winner).call{value: prize}("");
        require(success, "Transfer failed");
    }
}
```

**Testing Requirements:**
- Unit tests with malicious reentrancy contracts
- Integration tests across all affected functions
- Gas profiling to ensure no regressions

**Timeline:**
- Week 1-2: Implement fixes
- Week 3: Testing and code review
- Week 4: Deploy to testnet

---

### T-02: Predictable Randomness in Lottery

**Whitepaper Alignment:** Section 8.1 - Technical Risks  
**Audit Finding:** H-02, C002 (TipPool.drawWinner())

| **Property** | **Details** |
|--------------|-------------|
| **Severity** | 🔴 **Critical** |
| **Likelihood** | 🟠 Medium-High (miner manipulation) |
| **Impact** | Lottery rigging, trust damage, user loss |
| **Funding Need** | **Post-Funding** (Chainlink VRF requires LINK tokens) |
| **Phase** | **Phase 2: Post-Funding (Q2 2026)** |

#### Description
`drawWinner()` uses predictable on-chain data (`block.timestamp`, `block.difficulty`, `block.number`) for randomness. Miners/validators can manipulate these values to influence lottery outcomes.

**Current Implementation (INSECURE):**
```solidity
uint256 random = uint256(keccak256(abi.encodePacked(
    block.timestamp, block.difficulty, block.number, poolId
)));
```

#### Mitigation Strategy

**No-Funding Actions (Interim):**
1. ✅ **Replace `block.difficulty` with `block.prevrandao`** (Solidity 0.8.18+)
2. ✅ **Add commit-reveal scheme** for basic protection
3. ✅ **Document limitations** in user-facing warnings
4. ✅ **Limit pool sizes** until VRF integrated ($1K max prize)

**Post-Funding Actions:**
1. 🎯 **Integrate Chainlink VRF** (requires LINK tokens + keeper fees)
2. 🎯 **Implement two-step winner selection** (request → fulfill)
3. 🎯 **Add VRF callback tests** (Chainlink testnet)
4. 🎯 **Budget $500/month** for VRF operations (Q2-Q4 2026)

**Interim Implementation (No-Funding):**
```solidity
mapping(uint256 => bytes32) public poolCommits;

// Step 1: Commit (before pool end)
function commitRandomness(uint256 poolId, bytes32 commit) external {
    require(msg.sender == owner, "Unauthorized");
    poolCommits[poolId] = commit;
}

// Step 2: Reveal (after pool end)
function revealAndDrawWinner(uint256 poolId, uint256 reveal) external {
    require(keccak256(abi.encodePacked(reveal)) == poolCommits[poolId]);
    uint256 random = uint256(keccak256(abi.encodePacked(reveal, block.prevrandao)));
    // Use random to select winner
}
```

**Long-Term Implementation (Post-Funding):**
```solidity
import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";

contract TipPool is VRFConsumerBaseV2 {
    uint64 subscriptionId;
    bytes32 keyHash;
    
    function requestRandomWinner(uint256 poolId) external {
        uint256 requestId = requestRandomness(keyHash, subscriptionId, 3, 100000, 1);
        poolToRequest[poolId] = requestId;
    }
    
    function fulfillRandomWords(uint256 requestId, uint256[] memory randomWords) internal override {
        uint256 poolId = requestToPool[requestId];
        uint256 random = randomWords[0];
        // Select winner using cryptographically secure random value
    }
}
```

**Timeline:**
- **Interim (Jan 2026)**: Commit-reveal implementation
- **Long-term (Q2 2026)**: Chainlink VRF integration (post-funding)

---

### T-03: ZK Proof Forgery

**Whitepaper Alignment:** Section 8.1 - ZK Proof Forgery  
**Audit Finding:** Whitepaper analysis (not in audit report)

| **Property** | **Details** |
|--------------|-------------|
| **Severity** | 🔴 **Critical** |
| **Likelihood** | 🟢 **Negligible** (2^-128^ probability) |
| **Impact** | Protocol insolvency (mint ibcTFUEL without TFUEL collateral) |
| **Funding Need** | **Post-Funding** (external audit + bug bounty) |
| **Phase** | **Phase 2: CertiK Audit (Q2 2026)** |

#### Description
Adversary generates valid Groth16 proof without locking TFUEL on Theta, minting unbacked ibcTFUEL on Persistence.

#### Mitigation Strategy

**No-Funding Actions:**
1. ✅ **Merkle proof validation** (already implemented in circuit)
2. ✅ **Nonce replay protection** (ZKVerifier contract)
3. ✅ **Pairing equation verification** (BN254 curve ops)
4. ✅ **Internal ZK circuit review** (backend team)
5. ✅ **Testnet stress testing** (1000+ proof generations)

**Post-Funding Actions:**
1. 🎯 **CertiK ZK-SNARK audit** ($80K-$120K, Q2 2026)
2. 🎯 **Circom circuit formal verification** ($30K-$50K)
3. 🎯 **$500K bug bounty program** (Immunefi platform)
4. 🎯 **Trusted setup MPC ceremony** (100+ participants)
5. 🎯 **Public audit of ceremony transcripts**

**Current Protections (Already Implemented):**
- Groth16 cryptographic soundness (2^-128^ forgery probability)
- Merkle tree validation (proof of vault ownership)
- Nonce uniqueness checks (prevents replay attacks)
- VaultFactory state verification (current root matching)

**Timeline:**
- **Q1 2026**: Internal ZK circuit review + testnet testing
- **Q2 2026**: CertiK comprehensive audit (post-funding)
- **Q2 2026**: Bug bounty launch ($500K pool)

---

### T-04: IBC Relayer Failure

**Whitepaper Alignment:** Section 8.1 - IBC Relayer Failure  
**Audit Finding:** Whitepaper analysis

| **Property** | **Details** |
|--------------|-------------|
| **Severity** | 🟡 **Medium** |
| **Likelihood** | 🟡 Low-Medium (depends on relayer uptime) |
| **Impact** | Temporary UX degradation, delayed transfers |
| **Funding Need** | **No-Funding** (existing infrastructure) |
| **Phase** | **Phase 1: Pre-Mainnet (Q1 2026)** |

#### Description
IBC relayer downtime prevents Theta → Persistence transfers, causing user frustration and capital lockup.

#### Mitigation Strategy

**No-Funding Actions:**
1. ✅ **Deploy 5 independent relayers** (decentralized operators)
2. ✅ **Auto-restart on failure** (systemd service)
3. ✅ **10-minute IBC timeout** with auto-refund
4. ✅ **User-initiated manual relay** option (frontend button)
5. ✅ **Monitoring dashboard** (uptime, latency, success rate)

**Post-Funding Actions:**
1. 🎯 **Relayer incentive program** ($5K/month stipend for operators)
2. 🎯 **Hermes relayer upgrade** (latest Cosmos IBC version)
3. 🎯 **Redundant infrastructure** (multi-region deployment)

**Implementation:**
```typescript
// Auto-retry logic in IBC listener
async function relayPacket(packet: IBCPacket) {
  const maxRetries = 3;
  const relayers = ['relayer1', 'relayer2', 'relayer3', 'relayer4', 'relayer5'];
  
  for (let i = 0; i < maxRetries; i++) {
    const relayer = relayers[i % relayers.length];
    try {
      await relayer.relay(packet);
      return; // Success
    } catch (err) {
      console.warn(`Relayer ${relayer} failed, trying next...`);
    }
  }
  
  // Trigger refund if all relayers fail
  await initiateRefund(packet);
}
```

**Timeline:**
- **Jan 2026**: Deploy 5 relayers (testnet)
- **Feb 2026**: Mainnet deployment with monitoring

---

### T-05: Smart Contract Logic Errors

**Whitepaper Alignment:** Section 8.1 - Smart Contract Exploits  
**Audit Finding:** M-03 (XFUELPool.swap token transfer bug)

| **Property** | **Details** |
|--------------|-------------|
| **Severity** | 🟠 **High** |
| **Likelihood** | 🟠 Medium (logic errors common in swaps) |
| **Impact** | Swap failures, incorrect token transfers, user losses |
| **Funding Need** | **No-Funding** (internal code fix) |
| **Phase** | **Phase 1: Pre-Audit (Jan 2026)** |

#### Description
`XFUELPool.swap()` transfers `amountOut` from sender instead of `amountIn` when `zeroForOne=false`, causing swaps to fail or transfer incorrect amounts.

**Current Code (WRONG):**
```solidity
} else {
    uint256 amountIn = uint256(amountSpecified);
    uint256 amountOut = _getAmountOut(amountIn, false);
    
    token1.transferFrom(msg.sender, address(this), amountOut);  // WRONG!
    token0.transfer(recipient, amountIn);  // WRONG!
}
```

#### Mitigation Strategy

**No-Funding Actions:**
1. ✅ **Fix token transfer logic** (use `amountIn` for transferFrom)
2. ✅ **Add swap direction tests** (both zeroForOne true/false)
3. ✅ **Add slippage protection** (`minAmountOut` parameter)
4. ✅ **Audit all swap paths** (manual code review)
5. ✅ **Integration tests** with real token contracts

**Fixed Implementation:**
```solidity
} else {
    uint256 amountIn = uint256(amountSpecified);
    uint256 amountOut = _getAmountOut(amountIn, false);
    
    // FIXED: Transfer amountIn from sender
    token1.transferFrom(msg.sender, address(this), amountIn);
    token0.transfer(recipient, amountOut);
    
    // Add slippage protection
    require(amountOut >= minAmountOut, "XFUELPool: SLIPPAGE_TOO_HIGH");
    
    amount0 = int256(amountOut);
    amount1 = -amountSpecified;
}
```

**Timeline:**
- **Week 1**: Fix implementation
- **Week 2**: Comprehensive swap testing
- **Week 3**: Testnet deployment

---

### T-06: Missing Access Controls

**Whitepaper Alignment:** Section 8.1 - Smart Contract Exploits  
**Audit Finding:** H-03 (XFUELRouter.collectAndDistributeFees)

| **Property** | **Details** |
|--------------|-------------|
| **Severity** | 🟠 **High** |
| **Likelihood** | 🟡 Medium (public function, no access control) |
| **Impact** | Unauthorized fee collection, gas griefing, economic disruption |
| **Funding Need** | **No-Funding** (internal code fix) |
| **Phase** | **Phase 1: Pre-Audit (Jan 2026)** |

#### Description
`collectAndDistributeFees()` has no access control, allowing anyone to trigger fee distribution at inappropriate times or repeatedly for gas griefing attacks.

#### Mitigation Strategy

**No-Funding Actions:**
1. ✅ **Add access control modifier** (onlyOwner or authorized keepers)
2. ✅ **Implement cooldown period** (24-hour minimum between calls)
3. ✅ **Add keeper whitelist** (Chainlink Keepers post-funding)
4. ✅ **Event logging** for all fee collections (transparency)

**Implementation:**
```solidity
mapping(address => bool) public authorizedCollectors;
uint256 public lastFeeCollection;
uint256 public constant COOLDOWN_PERIOD = 24 hours;

modifier onlyAuthorizedCollector() {
    require(
        authorizedCollectors[msg.sender] || msg.sender == owner(),
        "XFUELRouter: UNAUTHORIZED"
    );
    _;
}

function collectAndDistributeFees(address pool) 
    external 
    onlyAuthorizedCollector 
{
    require(
        block.timestamp >= lastFeeCollection + COOLDOWN_PERIOD,
        "XFUELRouter: COOLDOWN_ACTIVE"
    );
    
    lastFeeCollection = block.timestamp;
    
    // ... existing fee distribution logic
}

function addAuthorizedCollector(address collector) external onlyOwner {
    authorizedCollectors[collector] = true;
    emit CollectorAuthorized(collector);
}
```

**Post-Funding Actions:**
1. 🎯 **Chainlink Keepers integration** ($50/month, Q2 2026)
2. 🎯 **Gelato Network automation** (alternative to Keepers)

**Timeline:**
- **Week 1**: Implement access controls
- **Week 2**: Testing with authorized/unauthorized callers
- **Q2 2026**: Integrate Chainlink Keepers (post-funding)

---

### T-07: Unsafe ERC20 Operations

**Whitepaper Alignment:** Section 8.1 - Smart Contract Exploits  
**Audit Finding:** M-05 (TreasuryILBackstop, XFUELRouter)

| **Property** | **Details** |
|--------------|-------------|
| **Severity** | 🟡 **Medium** |
| **Likelihood** | 🟡 Low (depends on token compatibility) |
| **Impact** | Transfer failures with non-standard tokens (USDT) |
| **Funding Need** | **No-Funding** (internal code fix) |
| **Phase** | **Phase 1: Pre-Audit (Jan 2026)** |

#### Description
Contracts use raw `transfer()` and `transferFrom()` which fail for non-standard ERC20 tokens (e.g., USDT doesn't return boolean).

#### Mitigation Strategy

**No-Funding Actions:**
1. ✅ **Import SafeERC20** (OpenZeppelin)
2. ✅ **Replace all `transfer()` with `safeTransfer()`**
3. ✅ **Replace all `transferFrom()` with `safeTransferFrom()`**
4. ✅ **Test with USDT mock** (non-standard token)
5. ✅ **Add return value checks** where SafeERC20 not used

**Implementation:**
```solidity
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract XFUELRouter {
    using SafeERC20 for IERC20;
    
    function collectAndDistributeFees(address pool) external {
        // BEFORE (unsafe):
        // usdcToken.transfer(veXFContract, veXFAmount);
        
        // AFTER (safe):
        usdcToken.safeTransfer(veXFContract, veXFAmount);
    }
}
```

**Timeline:**
- **Week 1**: Refactor all token operations
- **Week 2**: Testing with USDT and other tokens

---

### T-08: Missing Input Validation

**Whitepaper Alignment:** Section 8.1 - Smart Contract Exploits  
**Audit Finding:** M-02, H-004, L-03 (Multiple contracts)

| **Property** | **Details** |
|--------------|-------------|
| **Severity** | 🟡 **Medium** |
| **Likelihood** | 🟡 Medium (user error or malicious input) |
| **Impact** | Contract deployment failures, invalid states |
| **Funding Need** | **No-Funding** (internal code fix) |
| **Phase** | **Phase 1: Pre-Audit (Jan 2026)** |

#### Description
Constructors and functions lack validation for zero addresses, invalid durations, and boundary conditions.

**Affected Functions:**
- `XFUELRouter` constructor (no zero address checks)
- `TipPool.createPool()` (no duration validation)
- `TreasuryILBackstop.provideCoverage()` (no LP address validation)

#### Mitigation Strategy

**No-Funding Actions:**
1. ✅ **Add zero address checks** in all constructors
2. ✅ **Add boundary validation** (min/max values)
3. ✅ **Add require statements** with descriptive errors
4. ✅ **Test edge cases** (0, max uint256, address(0))

**Implementation Examples:**

**XFUELRouter Constructor:**
```solidity
constructor(
    address _factory,
    address _backstop,
    address _xfuelToken,
    address _usdcToken,
    address _treasury,
    address _veXFContract
) Ownable(msg.sender) {
    require(_factory != address(0), "Invalid factory");
    require(_backstop != address(0), "Invalid backstop");
    require(_xfuelToken != address(0), "Invalid xfuelToken");
    require(_usdcToken != address(0), "Invalid usdcToken");
    require(_treasury != address(0), "Invalid treasury");
    require(_veXFContract != address(0), "Invalid veXFContract");
    
    factory = XFUELPoolFactory(_factory);
    backstop = TreasuryILBackstop(_backstop);
    xfuelToken = IERC20(_xfuelToken);
    usdcToken = IERC20(_usdcToken);
    treasury = _treasury;
    veXFContract = _veXFContract;
}
```

**TipPool.createPool():**
```solidity
function createPool(uint256 duration, address creator) external payable {
    require(duration > 0, "Duration must be positive");
    require(duration <= 365 days, "Duration too long");
    require(creator != address(0), "Invalid creator");
    
    // ... rest of function
}
```

**Timeline:**
- **Week 1-2**: Add validation to all contracts
- **Week 3**: Edge case testing

---

### T-09: Legacy Code Bloat

**Whitepaper Alignment:** Section 2 - Project Evolution  
**Audit Finding:** Technical debt from multiple pivots

| **Property** | **Details** |
|--------------|-------------|
| **Severity** | 🟡 **Medium** |
| **Likelihood** | 🟠 Medium-High (natural accumulation during pivots) |
| **Impact** | Increased attack surface, maintenance burden, slower development |
| **Funding Need** | **No-Funding** (internal refactoring + extraction) |
| **Phase** | **Phase 1-2: Q1-Q2 2026** |

#### Description
XFuel Protocol's codebase contains legacy artifacts from previous architectural pivots (oracle-based model, multi-chain exploration, pre-ZK implementations). This "code bloat" includes:
- Unused contracts (e.g., oracle connectors, obsolete bridging logic)
- Dead code paths (feature flags from abandoned experiments)
- Redundant dependencies (outdated libraries from prototype phases)
- Inconsistent naming/patterns (mixing old and new conventions)

**Example Artifacts:**
- `contracts/legacy/OracleValidator.sol` (replaced by ZK proofs)
- `backend/oracles/chainlink-adapter.ts` (superseded by Groth16)
- Commented-out multisig code in VaultFactory
- Placeholder functions for multi-chain routing (never implemented)

**Risks:**
1. **Increased Attack Surface**: More code = more potential vulnerabilities (auditors must review dead code)
2. **Maintenance Overhead**: Developers waste time navigating obsolete modules
3. **Confusion**: New contributors struggle to distinguish current vs legacy architecture
4. **Gas Inefficiency**: Compiled contracts may include unused bytecode (higher deployment costs)
5. **Audit Complexity**: CertiK audit costs increase if scope includes legacy code

#### Mitigation Strategy

**No-Funding Actions (Q1 2026 - Extraction & Archival):**

1. ✅ **Legacy Code Audit** (Internal)
   - Inventory all files/functions unused in production
   - Document purpose of each legacy module
   - Categorize: "Safe to delete" vs "Keep for reference"

2. ✅ **Extraction to Archive** (Preserve History)
   - Create `legacy/` directory in repo root
   - Move obsolete code with README explaining context
   - Tag Git commit as "Pre-Extraction Snapshot" (rollback safety)

3. ✅ **Dead Code Removal** (Active Codebase)
   - Delete unused imports, functions, contracts
   - Remove commented-out code blocks (Git history preserves)
   - Consolidate duplicate utility functions
   - Eliminate unused environment variables

4. ✅ **Dependency Cleanup**
   - Remove unused npm packages (backend)
   - Update outdated libraries (OpenZeppelin 4.9 → 5.0)
   - Prune stale contract imports

5. ✅ **Documentation Update**
   - Update architecture diagrams to reflect current state
   - Remove references to deprecated features in docs
   - Add "Project Evolution" context (see Whitepaper Section 2)

**Extraction Plan (Specific Files):**

**Move to `legacy/pre-zk-bridge/`:**
```
contracts/legacy/OracleValidator.sol
contracts/legacy/MultisigBridge.sol
backend/oracles/chainlink-adapter.ts
backend/oracles/price-feed-aggregator.ts
scripts/deploy-oracle-contracts.js
```

**Delete Entirely (No Historical Value):**
```
node_modules/ (old dependencies)
.env.example.old
test/deprecated/ (tests for removed features)
dist/ (stale build artifacts)
```

**Refactor (Consolidate Duplicates):**
```
// BEFORE (3 duplicate implementations):
contracts/utils/SafeMath.sol (custom)
contracts/helpers/MathUtils.sol (redundant)
@openzeppelin/contracts/utils/math/SafeMath.sol (standard)

// AFTER (use OpenZeppelin only):
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
```

**Benefits of Extraction:**
- **Reduced codebase size**: ~30% reduction (estimated 15K → 10.5K lines)
- **Faster audits**: CertiK scope reduced by 25% (lower cost)
- **Clearer architecture**: New developers onboard faster
- **Gas savings**: VaultFactory deployment cost reduced by ~10% (remove unused code)

#### Implementation Timeline

**Week 1-2: Inventory & Planning**
- Complete legacy code audit (internal team)
- Create extraction checklist (file-by-file list)
- Set up `legacy/` directory structure
- Document each module's purpose in extraction README

**Week 3-4: Execution**
- Move oracle-related code to `legacy/pre-zk-bridge/`
- Delete dead code (commented blocks, unused functions)
- Remove stale dependencies (npm prune, outdated imports)
- Update all documentation references

**Week 5: Validation**
- Compile all contracts (ensure no broken imports)
- Run full test suite (100% pass rate required)
- Deploy to testnet (verify functionality unchanged)
- Code review by 2+ developers

**Week 6: Finalization**
- Tag Git commit as "v3.1-post-extraction"
- Update README with new architecture overview
- Document extraction in legacy/ directory
- Prepare for CertiK audit (cleaner scope)

#### Success Metrics

| **Metric** | **Before Extraction** | **Target After** | **Status** |
|------------|----------------------|------------------|------------|
| Total LOC (Solidity) | ~8,000 lines | ~5,600 lines (-30%) | 🎯 Q1 2026 |
| Active Contracts | 22 contracts | 15 contracts (-7 legacy) | 🎯 Q1 2026 |
| npm Dependencies | 145 packages | 100 packages (-45) | 🎯 Q1 2026 |
| Test Coverage | 87% | >90% (cleaner codebase) | 🎯 Q1 2026 |
| Build Time | 45s | 30s (-33% faster) | 🎯 Q1 2026 |
| Audit Scope (CertiK) | 8K LOC | 5.6K LOC (25% cheaper) | 🎯 Q2 2026 |

#### Post-Funding Actions (Q2 2026)

1. 🎯 **Professional Code Review** ($5K-$10K)
   - Hire external Solidity auditor for architecture review
   - Identify additional optimization opportunities
   - Validate extraction completeness

2. 🎯 **Automated Refactoring Tools**
   - Use Slither/Mythril to detect dead code
   - Integrate unused code detection in CI/CD
   - Set up code coverage enforcement (reject PRs <90%)

3. 🎯 **Documentation Website** ($3K-$5K)
   - Host legacy/ directory as browsable archive (GitHub Pages)
   - Add "Project Evolution" timeline visualization
   - Link to Whitepaper Section 2 for context

#### Related Risks

This risk connects to:
- **T-03 (ZK Proof Forgery)**: Cleaner code = fewer places to hide bugs
- **T-05 (Smart Contract Logic Errors)**: Less code = easier to reason about correctness
- **R-01 (Securities Classification)**: Clear documentation aids legal review

#### Notes

**Why Medium Severity?**
- Not immediately exploitable (unlike reentrancy)
- But increases long-term risk via complexity/confusion
- Impacts audit costs and team velocity

**Why No-Funding?**
- Extraction is internal refactoring (no external dependencies)
- Can be done by existing team during Q1 2026
- Saves money on Q2 audit (smaller scope)

**Lesson from Pivots:**
Legacy code is **technical debt interest**. XFuel's multiple pivots were strategic wins (trust → ZK = correct choice), but debt must be repaid via disciplined cleanup. This mitigation demonstrates **adaptive engineering** (evolve architecture, then clean up).

---

## Economic Risks

### E-01: ibcTFUEL Depeg

**Whitepaper Alignment:** Section 8.2 - ibcTFUEL Depeg  
**Audit Finding:** Whitepaper analysis (rounding errors from audit could exacerbate)

| **Property** | **Details** |
|--------------|-------------|
| **Severity** | 🟡 **Medium** |
| **Likelihood** | 🟡 Low-Medium (depends on LP depth) |
| **Impact** | User losses, trust damage, peg instability |
| **Funding Need** | **Mixed** (no-funding circuit breakers, post-funding LP depth) |
| **Phase** | **Phase 1-2: Q1-Q2 2026** |

#### Description
ibcTFUEL trades below 1:1 with TFUEL on Dexter pools due to insufficient liquidity, price manipulation, or rounding errors in swap calculations.

#### Mitigation Strategy

**No-Funding Actions:**
1. ✅ **Circuit breaker at 0.5% deviation** (auto-pause deposits)
2. ✅ **Rounding error audits** in swap math (identified in audit findings)
3. ✅ **Arbitrage incentive documentation** (profitable to restore peg)
4. ✅ **Real-time price monitoring** (frontend + backend alerts)
5. ✅ **Emergency pause mechanism** (3-of-5 multisig)

**Post-Funding Actions:**
1. 🎯 **30% LP funding allocation** (Ferrari tokenomics, ongoing)
2. 🎯 **Treasury backstop** (buy ibcTFUEL at 0.98:1 floor, $50K reserve)
3. 🎯 **Chainlink price oracle** ($200/month data feeds)
4. 🎯 **LP incentive programs** (additional liquidity mining)

**Rounding Error Fixes (New from Audit):**
```solidity
// BEFORE (potential precision loss):
uint256 amountOut = (amountIn * reserve1) / reserve0;

// AFTER (use higher precision):
uint256 amountOut = (amountIn * reserve1 * 1e18) / (reserve0 * 1e18);

// Add minimum output validation
require(amountOut > 0, "Output amount too small");
```

**Circuit Breaker Implementation:**
```solidity
uint256 public constant PEG_DEVIATION_THRESHOLD = 50; // 0.5% (50 bps)

function checkPegDeviation() internal view returns (bool) {
    uint256 dexterPrice = getDexterPrice(); // ibcTFUEL/TFUEL price
    uint256 deviation = abs(dexterPrice - 1e18) * 10000 / 1e18; // in bps
    
    return deviation <= PEG_DEVIATION_THRESHOLD;
}

function deposit(uint256 amount) external {
    require(checkPegDeviation(), "Peg deviation too high - deposits paused");
    // ... rest of deposit logic
}
```

**Timeline:**
- **Jan 2026**: Implement circuit breakers + rounding fixes
- **Feb 2026**: Deploy 30% LP funding (Ferrari tokenomics)
- **Q2 2026**: Treasury backstop + Chainlink oracle (post-funding)

---

### E-02: XF Token Death Spiral

**Whitepaper Alignment:** Section 8.2 - XF Death Spiral  
**Audit Finding:** Whitepaper analysis

| **Property** | **Details** |
|--------------|-------------|
| **Severity** | 🟡 **Medium** |
| **Likelihood** | 🟡 Low (USDC yields reduce sell pressure) |
| **Impact** | Tokenomics disruption, governance issues |
| **Funding Need** | **No-Funding** (design already implemented) |
| **Phase** | **Ongoing Monitoring** |

#### Description
XF price crashes trigger panic selling, further depressing price in a downward spiral.

#### Mitigation Strategy

**No-Funding Actions (Already Implemented):**
1. ✅ **veXF yields in USDC** (not XF—no sell pressure)
2. ✅ **70% BBB burned** (creates buyback floor)
3. ✅ **Lock incentives** (up to 11.5× multiplier)
4. ✅ **Long-term lock periods** (1-4 years reduce circulating supply)

**Post-Funding Actions:**
1. 🎯 **Treasury buyback program** (purchase XF at discount during downturns)
2. 🎯 **Market-making partnerships** (0.5% spread maintenance)
3. 🎯 **LP depth targets** ($500K XF/TFUEL liquidity by Q3 2026)

**Monitoring Metrics:**
- Daily trading volume (detect panic selling)
- veXF lock rate (% of supply locked)
- USDC yield APY (maintain attractiveness)
- Circulating supply trend (burn rate effectiveness)

**Timeline:**
- **Ongoing**: Monitor metrics monthly
- **Q2 2026**: Activate treasury buyback if needed (post-funding)

---

### E-03: Insufficient LP Depth

**Whitepaper Alignment:** Section 8.2 - Economic Risks (implicit)  
**Audit Finding:** Related to slippage issues (M-04)

| **Property** | **Details** |
|--------------|-------------|
| **Severity** | 🟡 **Medium** |
| **Likelihood** | 🟠 Medium (early-stage protocol) |
| **Impact** | High slippage, poor UX, user churn |
| **Funding Need** | **Post-Funding** (LP capital deployment) |
| **Phase** | **Phase 2: Q2-Q3 2026** |

#### Description
Insufficient liquidity on Dexter (ibcTFUEL/stkXPRT pools) causes high slippage for users, reducing adoption.

#### Mitigation Strategy

**No-Funding Actions:**
1. ✅ **Slippage protection parameters** (minAmountOut in swaps)
2. ✅ **Frontend slippage warnings** (>2% show alert)
3. ✅ **Gradual volume ramp** (limit deposits until depth grows)

**Post-Funding Actions:**
1. 🎯 **30% LP funding allocation** (Ferrari tokenomics, $30K-$40K/month)
2. 🎯 **Initial LP seeding** ($200K target by Q2 2026)
3. 🎯 **LP incentive programs** (additional yield for providers)
4. 🎯 **Dexter Superfluid integration** (auto-compounding for efficiency)

**Slippage Protection (No-Funding Fix):**
```solidity
function swapAndStake(
    uint256 amount,
    string calldata targetLST,
    uint256 minAmountOut  // NEW: slippage protection
) external payable returns (uint256 stakedAmount) {
    require(amount > 0, "Amount must be greater than 0");
    require(msg.value == amount, "TFUEL amount must match msg.value");
    
    // Calculate output amount
    stakedAmount = calculateSwapOutput(amount, targetLST);
    
    // SLIPPAGE CHECK
    require(stakedAmount >= minAmountOut, "XFUELRouter: SLIPPAGE_TOO_HIGH");
    
    // ... rest of function
}
```

**Timeline:**
- **Jan 2026**: Implement slippage protection
- **Q2 2026**: Deploy $200K LP seeding (post-funding)
- **Q3 2026**: Scale to $500K+ LP depth

---

### E-04: Price Oracle Manipulation

**Whitepaper Alignment:** Section 8.1 - Technical Risks (implicit)  
**Audit Finding:** M-07 (Missing price oracle)

| **Property** | **Details** |
|--------------|-------------|
| **Severity** | 🟠 **High** |
| **Likelihood** | 🟡 Medium (depends on oracle implementation) |
| **Impact** | Incorrect fee distribution, economic imbalances |
| **Funding Need** | **Post-Funding** (Chainlink data feeds) |
| **Phase** | **Phase 2: Q2 2026** |

#### Description
`XFUELRouter._convertToUSDC()` uses 1:1 placeholder conversion instead of real prices, causing incorrect fee splits (60/25/15).

**Current Implementation (WRONG):**
```solidity
function _convertToUSDC(uint256 amount0, uint256 amount1) internal pure returns (uint256) {
    // Simplified: assume 1:1 conversion for demo
    return amount0 + amount1;
}
```

#### Mitigation Strategy

**No-Funding Actions (Interim):**
1. ✅ **Document placeholder limitation** (whitepaper + docs)
2. ✅ **Manual price updates** (owner-controlled fallback)
3. ✅ **Off-chain monitoring** (detect price divergence)

**Post-Funding Actions:**
1. 🎯 **Chainlink price feeds integration** ($200/month, Q2 2026)
2. 🎯 **Staleness checks** (reject prices >1 hour old)
3. 🎯 **Fallback oracle** (Uniswap V3 TWAP as backup)
4. 🎯 **Circuit breaker** (pause if price anomaly detected)

**Chainlink Integration (Post-Funding):**
```solidity
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract XFUELRouter {
    AggregatorV3Interface public tfuelUsdOracle;
    AggregatorV3Interface public xprtUsdOracle;
    uint256 public constant STALENESS_THRESHOLD = 1 hours;
    
    function _convertToUSDC(uint256 amount0, uint256 amount1) internal view returns (uint256) {
        // Get TFUEL/USD price
        (, int256 tfuelPrice, , uint256 tfuelUpdatedAt, ) = tfuelUsdOracle.latestRoundData();
        require(block.timestamp - tfuelUpdatedAt <= STALENESS_THRESHOLD, "Stale price");
        
        // Get XPRT/USD price
        (, int256 xprtPrice, , uint256 xprtUpdatedAt, ) = xprtUsdOracle.latestRoundData();
        require(block.timestamp - xprtUpdatedAt <= STALENESS_THRESHOLD, "Stale price");
        
        // Convert to USDC (6 decimals)
        uint256 tfuelValueUSD = (amount0 * uint256(tfuelPrice)) / 1e8;
        uint256 xprtValueUSD = (amount1 * uint256(xprtPrice)) / 1e8;
        
        return tfuelValueUSD + xprtValueUSD;
    }
}
```

**Timeline:**
- **Q1 2026**: Document limitation, use 1:1 fallback
- **Q2 2026**: Integrate Chainlink (post-funding)

---

## Regulatory Risks

### R-01: Securities Classification

**Whitepaper Alignment:** Section 8.3 - Securities Classification  
**Audit Finding:** Whitepaper analysis

| **Property** | **Details** |
|--------------|-------------|
| **Severity** | 🟡 **Medium** |
| **Likelihood** | 🟡 Medium (uncertain US crypto policy) |
| **Impact** | Operational disruption, geofencing, legal costs |
| **Funding Need** | **Post-Funding** (legal counsel) |
| **Phase** | **Phase 2: Q2 2026** |

#### Description
XF token could be classified as a security by regulators (SEC Howey Test), requiring registration or operational restrictions.

#### Mitigation Strategy

**No-Funding Actions:**
1. ✅ **Utility-first design** (veXF for governance, not investment)
2. ✅ **Decentralization roadmap** (DAO transition Q3 2026)
3. ✅ **Documentation** (emphasize utility, not investment returns)
4. ✅ **Terms of Service** (clear risk disclosures)

**Post-Funding Actions:**
1. 🎯 **Legal opinion** from crypto law firm ($20K-$30K)
2. 🎯 **Compliance audit** (KYC/AML readiness, $10K-$15K)
3. 🎯 **Geofencing capability** (block US IPs if needed)
4. 🎯 **Regulatory monitoring** (ongoing counsel retainer)

**Decentralization Milestones:**
- **Q1 2026**: veXF governance live (parameter voting)
- **Q2 2026**: Treasury governed by DAO
- **Q3 2026**: Admin keys transferred to Governor contract (no single owner)
- **Q4 2026**: Full DAO transition (protocol fully autonomous)

**Timeline:**
- **Q1 2026**: Implement governance features
- **Q2 2026**: Legal opinion + compliance audit (post-funding)
- **Q3 2026**: DAO transition complete

---

## Implementation Timeline

### Phase 1: Pre-Audit (January - February 2026) - No-Funding

**Focus:** Critical security fixes and internal improvements

| **Week** | **Tasks** | **Risks Addressed** |
|----------|-----------|---------------------|
| **1-2** | • Add ReentrancyGuard to all contracts<br>• Fix XFUELPool.swap() token transfer bug<br>• Add access controls to collectAndDistributeFees() | T-01, T-05, T-06 |
| **3-4** | • Implement SafeERC20 across all contracts<br>• Add input validation (zero address checks, boundaries)<br>• Refactor state updates (Checks-Effects-Interactions) | T-07, T-08, T-01 |
| **5-6** | • Implement commit-reveal for lottery (interim)<br>• Add slippage protection to swaps<br>• Fix rounding errors in AMM math | T-02, E-03, E-01 |
| **7-8** | • Circuit breaker for ibcTFUEL depeg<br>• Comprehensive test suite (unit + integration)<br>• Testnet deployment + stress testing | E-01, All technical risks |

**Deliverables:**
- ✅ All critical audit findings fixed
- ✅ 90%+ test coverage
- ✅ Testnet deployment with 1000+ transactions
- ✅ Internal security review complete

---

### Phase 2: Post-Funding Audit (Q2 2026) - Post-Funding

**Focus:** External audits, infrastructure, and economic deployment

| **Month** | **Tasks** | **Funding Required** | **Risks Addressed** |
|-----------|-----------|----------------------|---------------------|
| **April** | • CertiK comprehensive audit (contracts + ZK circuits)<br>• Chainlink VRF integration<br>• Deploy 5 IBC relayers (mainnet) | $100K-$150K | T-03, T-02, T-04 |
| **May** | • Bug bounty launch (Immunefi, $500K pool)<br>• Chainlink price oracle integration<br>• Initial LP seeding ($200K) | $700K+ | T-03, E-04, E-03 |
| **June** | • Legal opinion + compliance audit<br>• Mainnet v1.0 launch<br>• Monitoring infrastructure (Grafana, alerts) | $40K-$50K | R-01, All risks |

**Deliverables:**
- ✅ CertiK audit report (clean or addressed findings)
- ✅ Bug bounty live ($500K pool)
- ✅ Mainnet v1.0 with <4s settlements
- ✅ $200K+ LP depth on Dexter

---

### Phase 3: Scale & Decentralize (Q3-Q4 2026) - Post-Funding

**Focus:** Governance transition, LP growth, and continuous monitoring

| **Quarter** | **Tasks** | **Funding Required** | **Risks Addressed** |
|-------------|-----------|----------------------|---------------------|
| **Q3** | • DAO transition (admin keys → Governor)<br>• Scale LP depth to $500K+<br>• AI yield optimizer (ML-powered routing) | $50K-$100K | R-01, E-02, E-03 |
| **Q4** | • Continuous security monitoring<br>• Expand bug bounty ($1M pool)<br>• Prepare for multi-chain expansion | $200K-$300K | All risks (ongoing) |

**Deliverables:**
- ✅ Full DAO governance (no centralized owner)
- ✅ $500K+ LP depth (self-sustaining via Ferrari tokenomics)
- ✅ Zero critical vulnerabilities (ongoing audits)

---

## Success Metrics

### Security Metrics

| **Metric** | **Target** | **Timeline** | **Phase** |
|------------|------------|--------------|-----------|
| Critical vulnerabilities fixed | 100% | Feb 2026 | Pre-Audit |
| Test coverage | >90% | Feb 2026 | Pre-Audit |
| CertiK audit score | >85/100 | Q2 2026 | Post-Funding |
| Bug bounty submissions | 0 critical exploits | Ongoing | Post-Funding |
| Mainnet uptime | >99.5% | Q3 2026 | Ongoing |

### Economic Metrics

| **Metric** | **Target** | **Timeline** | **Phase** |
|------------|------------|--------------|-----------|
| ibcTFUEL peg stability | <0.5% deviation | Q2 2026 | Post-Funding |
| LP depth (Dexter) | $200K → $500K | Q2-Q3 2026 | Post-Funding |
| XF circulating supply locked (veXF) | >40% | Q3 2026 | Ongoing |
| Protocol revenue (annual) | $180K-$360K | Year 1-2 | Ongoing |
| User slippage complaints | <1% of transactions | Q2 2026 | Post-Funding |

### Governance Metrics

| **Metric** | **Target** | **Timeline** | **Phase** |
|------------|------------|--------------|-----------|
| veXF voter participation | >50% | Q3 2026 | Post-Funding |
| DAO proposals executed | >10/quarter | Q3 2026 | Post-Funding |
| Admin keys decentralized | 100% (Governor contract) | Q3 2026 | Post-Funding |

---

## Document Control

| **Property** | **Details** |
|--------------|-------------|
| **Version** | 1.0 |
| **Last Updated** | January 6, 2026 |
| **Next Review** | February 15, 2026 (post Phase 1 completion) |
| **Owner** | XFuel Security Team |
| **Approvers** | CTO, Lead Auditor, Community Governance (post-DAO) |

---

## References

1. **XFuel Whitepaper v3.1** - Section 8: Risk Analysis & Mitigation
2. **Mock Security Audit Report** (December 2024) - `docs/audit/mock-audit-report.md`
3. **Security Fixes Required** - `docs/audit/SECURITY_FIXES_REQUIRED.md`
4. **CertiK Audit Scope** (Q2 2026) - Pending
5. **Ferrari Tokenomics Model** - Whitepaper Section 4
6. **ZK-SNARK Security Analysis** - Whitepaper Section 3

---

**⚠️ Disclaimer:** This roadmap is a living document and will be updated as new risks are identified or mitigation strategies are refined. All timelines and funding estimates are subject to change based on resource availability and protocol development priorities.

---

© 2026 XFuel Protocol. Licensed under MIT License.

