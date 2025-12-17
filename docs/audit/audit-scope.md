# XFUEL Protocol - Audit Scope

## Overview
XFUEL Protocol is a sub-4s institutional-grade settlement rail that routes Theta EdgeCloud GPU/video revenue to auto-compounding Cosmos Liquid Staking Tokens (LSTs). The protocol consists of a router system, concentrated liquidity pools, treasury backstop, and tip pool lottery mechanisms.

## Contracts to Audit

### Core Contracts

#### 1. XFUELRouter.sol
**Purpose**: Main router contract handling fee distribution and swap/stake operations

**Key Functions**:
- `swapAndStake(uint256 amount, string calldata targetLST)` - Swap TFUEL and stake to Cosmos LST
- `swap(address pool, bool zeroForOne, int256 amountSpecified, address recipient)` - Execute token swaps
- `collectAndDistributeFees(address pool)` - Collect protocol fees and distribute (60% buyback-burn, 25% veXF yield, 15% treasury)
- `_buybackAndBurn(uint256 usdcAmount)` - Internal buyback and burn mechanism
- `setVeXFContract(address _veXFContract)` - Owner: Update veXF contract address
- `setTreasury(address _treasury)` - Owner: Update treasury address

**State Variables**:
- `factory` (XFUELPoolFactory) - Pool factory reference
- `backstop` (TreasuryILBackstop) - IL backstop reference
- `xfuelToken` (IERC20) - XF token for buyback
- `usdcToken` (IERC20) - USDC for veXF yield
- `treasury` (address) - Treasury address
- `veXFContract` (address) - veXF contract address
- Fee splits: `BUYBACK_BPS` (6000), `VEXF_YIELD_BPS` (2500), `TREASURY_BPS` (1500)

**Attack Vectors**:
- Reentrancy in fee collection and distribution
- Price oracle manipulation in `_convertToUSDC`
- Access control bypass (onlyOwner functions)
- Integer overflow/underflow in fee calculations
- Incorrect token ordering assumptions (token0/token1)
- Missing input validation on pool addresses
- Centralization risks with owner functions

#### 2. XFUELPool.sol
**Purpose**: Concentrated liquidity pool for TFUEL↔XPRT swaps (Uniswap-v3 style)

**Key Functions**:
- `initialize(address _token0, address _token1, uint24 _fee, uint160 _sqrtPriceX96)` - Initialize pool
- `swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96)` - Execute swap
- `collectProtocolFees()` - Collect protocol fees to fee recipient
- `setFeeRecipient(address _feeRecipient)` - Factory: Set fee recipient
- `_getAmountOut(uint256 amountIn, bool zeroForOne)` - Calculate swap output
- `_tickFromSqrtPrice(uint160 sqrtPriceX96)` - Convert sqrt price to tick

**State Variables**:
- `token0` (IERC20) - First token (TFUEL)
- `token1` (IERC20) - Second token (XPRT)
- `fee` (uint24) - Fee tier (500 or 800 basis points)
- `liquidity` (uint128) - Current liquidity
- `sqrtPriceX96` (uint160) - Current sqrt price
- `tick` (int24) - Current tick
- `protocolFees0` / `protocolFees1` - Accumulated protocol fees
- `feeRecipient` (address) - Address receiving protocol fees

**Attack Vectors**:
- Reentrancy in swap function
- Price manipulation through large swaps
- Front-running swap transactions
- Integer overflow/underflow in price calculations
- Simplified swap logic may not match full Uniswap-v3 implementation
- Missing slippage protection enforcement
- Rounding errors in constant product formula
- Uninitialized pool usage
- Factory-only access control bypass

#### 3. XFUELPoolFactory.sol
**Purpose**: Factory for creating TFUEL↔XPRT concentrated liquidity pools

**Key Functions**:
- `createPool(address tokenA, address tokenB, uint24 fee, uint160 sqrtPriceX96)` - Create new pool
- `allPoolsLength()` - Get total number of pools created
- `getPool[token0][token1][fee]` - Mapping to find pools

**State Variables**:
- `getPool` - Mapping of token pairs and fees to pool addresses
- `allPools` - Array of all created pools

**Attack Vectors**:
- CREATE2 address collision attacks
- Duplicate pool creation bypass
- Invalid fee tier validation
- Zero address validation
- Front-running pool creation
- Price manipulation during pool initialization

#### 4. TreasuryILBackstop.sol
**Purpose**: Provides impermanent loss coverage >8% for liquidity providers

**Key Functions**:
- `calculateIL(uint256 initialValue, uint256 currentValue)` - Calculate IL percentage
- `provideCoverage(address lpAddress, uint256 initialValue, uint256 currentValue)` - Provide IL coverage if >8%
- `depositTreasury(uint256 amount)` - Deposit treasury funds
- `emergencyWithdraw(uint256 amount)` - Owner: Emergency withdrawal
- `setPool(address _pool)` - Owner: Set pool address

**State Variables**:
- `treasuryToken` (IERC20) - Treasury token (USDC)
- `pool` (address) - Pool address authorized to call provideCoverage
- `IL_THRESHOLD_BPS` (800) - 8% IL threshold
- `totalCoverageProvided` (uint256) - Total coverage provided

**Attack Vectors**:
- Incorrect IL calculation (division by zero, overflow)
- Authorization bypass (who can call provideCoverage)
- Griefing with fake IL claims
- Treasury drain through repeated coverage claims
- Front-running coverage provision
- Owner centralization risk (emergencyWithdraw)
- Integer precision issues in IL calculation

#### 5. TipPool.sol
**Purpose**: Lottery-style tip pools with weighted random winner selection

**Key Functions**:
- `createPool(uint256 duration, address creator)` - Create new tip pool
- `tipPool(uint256 poolId)` - Add tip to pool (payable)
- `endPool(uint256 poolId)` - End pool and distribute winnings
- `drawWinner(uint256 poolId)` - Draw weighted random winner
- `getPoolInfo(uint256 poolId)` - Get pool information
- `getPoolTippers(uint256 poolId)` - Get list of tippers
- `getTipAmount(uint256 poolId, address tipper)` - Get tip amount for user

**State Variables**:
- `pools` - Mapping of pool ID to Pool struct
- `nextPoolId` - Next pool ID counter
- `CREATOR_CUT_BPS` (1000) - 10% to creator
- `WINNER_CUT_BPS` (9000) - 90% to winner

**Attack Vectors**:
- Pseudo-random number generation vulnerability (block.timestamp, block.difficulty)
- Miner/manipulator influence on random seed
- Reentrancy in endPool distribution
- Integer overflow in tip calculations
- Front-running winner selection
- Griefing with dust tips
- Missing access control on endPool (who can call it?)
- Rounding errors in fee distribution
- Pool state manipulation
- Time manipulation attacks

#### 6. Ownable.sol
**Purpose**: Simple ownership pattern for access control

**Key Functions**:
- `transferOwnership(address newOwner)` - Owner: Transfer ownership
- `onlyOwner` modifier - Access control modifier

**Attack Vectors**:
- Ownership transfer to zero address (guarded)
- Ownership transfer to malicious contract
- Missing renounceOwnership function
- Front-running ownership transfers

#### 7. MockXFUELRouter.sol
**Purpose**: Mock router for testing (excluded from production audit)

### Interfaces

#### 8. IERC20.sol
**Purpose**: Standard ERC20 interface

**Attack Vectors**:
- Non-standard ERC20 implementations (no return values)
- Reentrant transfers
- Fee-on-transfer tokens
- Rebasing tokens

## Cross-Contract Interaction Flows

### Flow 1: Swap and Stake
1. User calls `XFUELRouter.swapAndStake()` with TFUEL
2. Router routes through `XFUELPool` for swap
3. Swap executes TFUEL → XPRT (or target LST)
4. Result is staked via IBC to Cosmos chain
5. Fees collected and distributed per router logic

**Attack Vectors**:
- Sandwich attacks on swaps
- MEV extraction
- Cross-chain bridge vulnerabilities (IBC)
- Partial failure handling
- Slippage tolerance bypass

### Flow 2: Fee Collection and Distribution
1. `collectAndDistributeFees()` called on router
2. Router calls `XFUELPool.collectProtocolFees()`
3. Fees converted to USDC equivalent
4. Split: 60% buyback-burn, 25% veXF, 15% treasury
5. Transfers executed

**Attack Vectors**:
- Reentrancy during fee collection
- Price oracle manipulation
- Incorrect fee split calculations
- Missing balance checks before transfers

### Flow 3: IL Coverage Claim
1. LP experiences IL >8%
2. Pool calls `TreasuryILBackstop.provideCoverage()`
3. IL calculated and verified
4. Treasury funds transferred to LP

**Attack Vectors**:
- Fake IL claims
- Timing attacks (claiming before actual IL)
- Calculation manipulation
- Treasury exhaustion

### Flow 4: Tip Pool Lottery
1. Creator calls `TipPool.createPool()`
2. Users tip pool with native tokens
3. Pool ends (time-based)
4. Winner drawn via weighted random
5. Funds distributed: 10% creator, 90% winner

**Attack Vectors**:
- Randomness manipulation
- Front-running winner selection
- Pool state corruption
- MEV extraction on distribution

## External Dependencies

### On-Chain
- Theta Network (EVM-compatible chain)
- IBC bridge to Cosmos chains
- Cosmos Liquid Staking Token contracts (external)

### Off-Chain
- Price oracles (if used in production)
- VRF provider (mentioned but not implemented)

## Attack Categories to Focus On

1. **Reentrancy**: All contracts with external calls
2. **Access Control**: Ownable patterns, factory-only functions
3. **Integer Arithmetic**: Overflow/underflow, precision loss
4. **Price Manipulation**: Swap functions, oracle usage
5. **Randomness**: TipPool winner selection
6. **Centralization**: Owner functions, emergency controls
7. **Input Validation**: All public/external functions
8. **State Consistency**: Cross-contract state management
9. **Economic Attacks**: Fee distribution, IL coverage calculations
10. **Cross-Chain**: IBC bridge integration points

## Lines of Code
- Total Solidity: ~800 LOC (excluding interfaces/mocks)
- XFUELRouter: ~188 LOC
- XFUELPool: ~163 LOC
- TipPool: ~181 LOC
- TreasuryILBackstop: ~93 LOC
- XFUELPoolFactory: ~53 LOC
- Ownable: ~28 LOC

## Solidity Version
- All contracts: ^0.8.20

## Testing Coverage
- Current: Minimal (only MockXFUELRouter tested)
- Recommended: Comprehensive unit and integration tests for all contracts

