// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title CoreRevenueSplitter
 * @author XFuel Protocol — Core Layer
 * @custom:security-contact security@xfuel.app
 * @notice Ecosystem-agnostic fee collection and distribution with configurable splits,
 *         multi-chain Fee-to-Stake routing, and governance integration.
 *
 * Default Split (30/30/25/15 — sums to 10000 BPS):
 *   30% → Buyback-Burn (BBB): Buy XF on open market and burn
 *   30% → Growth & Expansion Treasury (GET): Machine incentives, LP boost, agent grants
 *   25% → Stakers (veXF holders): Yield distribution
 *   15% → Treasury: Operations, AI infra, future incentives
 *
 * GET Sub-Splits (of the 30% GET allocation, sums to 10000 sub-BPS):
 *   50% → Machine & Agent Incentives (compute subsidies, routing rewards, volume boosts)
 *   30% → LP Boost (AMM pool deepening, concentrated liquidity)
 *   20% → Agent-Driven Grant Proposals (community grants, auto-burn after 6 months)
 *
 * Fee-to-Stake (15-25% of treasury allocation):
 *   Routes to chain-specific validator staking pools:
 *   - Theta (361): wTHETA/TFUEL staking (1,000 wTHETA + 20,000 TFUEL per validator)
 *   - Bittensor EVM (964): dTAO staking via precompile at 0x0805
 *   - Cosmos (osmosis-1): BankMsg native staking via IBC relay
 *
 * Research ties:
 *   Per Theta docs: TFUEL gas burned (deflationary), subchain validators need collateral
 *   Per Bittensor docs: StakingV2 precompile at 0x0805, dTAO subnet-specific staking
 *   Per Osmosis docs: Governance-whitelisted CosmWasm, OSMO native staking
 *
 * Gas targets:
 *   - distribute():    <450K (4 main transfers + GET sub-split + stake routing + accounting + events)
 *   - depositFee():    <30K (receive + tag + event)
 *   - stakeRoute():    <60K (single chain routing)
 */
contract CoreRevenueSplitter is AccessControl, Pausable, ReentrancyGuard {
    // ─── Roles ─────────────────────────────────────────────────────────────────
    bytes32 public constant FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE");
    bytes32 public constant CIRCUIT_ROLE = keccak256("CIRCUIT_ROLE");
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

    // ─── TDROP ERC-20 Fee Accounting (Track 4.2) ──────────────────────────────
    // receiveERC20Fee() pulls TDROP (or any TNT-20) from the calling circuit
    // and records it for attribution and future distribution (e.g., TDROP buy-back,
    // TDROP staker yield).  TDROP is NOT mixed with TFUEL in the main distribution
    // pool — it is held separately in `erc20Balances` until a governance-approved
    // distribution path is implemented (Track 4.1 roadmap item).
    mapping(address => uint256) public erc20Balances;      // token → amount held
    mapping(bytes32 => mapping(address => uint256)) public circuitErc20Fees; // circuitId → token → amount
    mapping(address => uint256) public totalErc20Collected; // token → lifetime total

    event ERC20FeeReceived(
        bytes32 indexed circuitId,
        address indexed token,
        address indexed sender,
        uint256 amount,
        uint8   providerTag,
        uint256 timestamp
    );

    // ─── Split Configuration (in BPS, must sum to 10000) ───────────────────────
    uint16 public bbbBps = 3000;
    uint16 public getBps = 3000;
    uint16 public stakerBps = 2500;
    uint16 public treasuryBps = 1500;
    uint16 public constant TOTAL_BPS = 10000;

    // ─── GET Sub-Split Configuration (in BPS, must sum to 10000) ─────────────
    uint16 public incentivesBps = 5000;   // 50% of GET → Machine & Agent Incentives
    uint16 public lpBoostBps = 3000;      // 30% of GET → LP Boost
    uint16 public grantsBps = 2000;       // 20% of GET → Agent-Driven Grant Proposals

    // ─── Volume-Triggered Boost (applied to incentives distribution rate) ────
    uint16 public boostMultiplier = 10000; // 10000 = 1.0x, 25000 = 2.5x
    uint16 public constant MIN_BOOST = 10000;
    uint16 public constant MAX_BOOST = 25000;
    uint256 public monthlyVolume;
    uint256 public lastVolumeReset;

    // ─── Theta-Native Boost Accounting ───────────────────────────────────────
    // Tracks the share of fees that originated from THETA_NATIVE executions.
    // Used by distribute() to auto-scale boostMultiplier without admin action.
    // THETA_NATIVE tag = 1 (mirrors ThetaInferenceCircuit.ProviderTag enum).
    uint8  public constant PROVIDER_TAG_THETA_NATIVE = 1;
    uint256 public thetaNativeFeesSinceReset;  // fees tagged THETA_NATIVE this period
    uint256 public totalFeesSinceReset;        // all fees this period (tagged + untagged)
    uint256 public totalThetaNativeFees;       // lifetime Theta-native fee volume
    // Boost scale: 100% Theta-native → MAX_BOOST; 0% → MIN_BOOST (linear interpolation)
    bool   public dynamicBoostEnabled = true;  // governance can disable if needed

    // ─── Agent Grant Proposals ──────────────────────────────────────────────
    struct GrantProposal {
        bytes32 proposalId;
        address recipient;
        uint256 amount;
        address submitter;
        uint256 createdAt;
        uint256 votesFor;
        uint256 votesAgainst;
        bool executed;
        bool cancelled;
    }

    uint256 public grantProposalCount;
    mapping(uint256 => GrantProposal) public grantProposals;
    mapping(uint256 => mapping(address => bool)) public grantVotes;
    uint256 public grantPoolBalance;
    uint256 public lastGrantActivity;
    uint256 public constant GRANT_EXPIRY = 180 days;

    // ─── Fee-to-Stake Configuration ────────────────────────────────────────────
    uint16 public feeToStakeBps = 2000;
    uint16 public constant MIN_FEE_TO_STAKE_BPS = 1500;
    uint16 public constant MAX_FEE_TO_STAKE_BPS = 2500;

    /// @notice Protocol fee on x402 escrow claims and deferred payouts (1% = 100 BPS).
    uint16 public constant PROTOCOL_FEE_BPS = 100;

    // ─── Recipient Addresses ───────────────────────────────────────────────────
    address public bbbWallet;
    address public getWallet;
    address public stakerVault;
    address public treasuryWallet;
    address public stakePool;

    // ─── Multi-Chain Stake Pool Registry ───────────────────────────────────────
    struct StakeRoute {
        address pool;
        uint256 chainId;
        string label;
        uint16 weightBps;     // share of fee-to-stake allocation
        bool active;
    }

    StakeRoute[] public stakeRoutes;
    uint256 public totalStakeWeight;

    // Bittensor EVM staking precompile (dTAO)
    address public constant BITTENSOR_STAKING_V2 = 0x0000000000000000000000000000000000000805;
    uint256 public constant BITTENSOR_CHAIN_ID = 964;
    uint256 public constant THETA_CHAIN_ID = 361;

    // ─── x402 Escrow & Deferred Claims (v3) ───────────────────────────────────
    struct Escrow {
        address payer;
        address payee;
        uint256 amount;
        uint256 maxAmount;        // pay-up-to cap
        bytes32 taskId;
        uint256 createdAt;
        uint256 expiresAt;
        bool claimed;
        bool refunded;
    }

    uint256 public escrowCount;
    mapping(uint256 => Escrow) public escrows;
    mapping(address => uint256[]) public payerEscrows;
    mapping(address => uint256[]) public payeeEscrows;

    struct DeferredClaim {
        address claimant;
        uint256 amount;
        bytes32 proofNullifier;
        uint256 claimableAfter;
        bool claimed;
    }

    uint256 public deferredClaimCount;
    mapping(uint256 => DeferredClaim) public deferredClaims;
    mapping(address => uint256) public totalDeferred;

    uint256 public totalEscrowed;
    uint256 public totalClaimed;
    uint256 public totalRefunded;

    // ─── Metrics ───────────────────────────────────────────────────────────────
    uint256 public totalCollected;
    uint256 public totalDistributed;
    uint256 public totalBBB;
    uint256 public totalGET;
    uint256 public totalStaker;
    uint256 public totalTreasury;
    uint256 public totalFeeToStake;
    uint256 public distributionCount;
    uint256 public totalIncentivesDistributed;
    uint256 public totalLPBoostDistributed;
    uint256 public totalGrantsDistributed;

    mapping(bytes32 => uint256) public circuitFees;
    mapping(uint256 => uint256) public chainStakeTotal; // chainId → total staked

    // ─── Chainlink Oracle Integration (TVL/LP feeds) ─────────────────────
    struct OracleFeed {
        address feedAddress;       // Chainlink AggregatorV3Interface
        string label;              // "ETH/USD", "XF/USD", etc.
        uint256 lastPrice;
        uint256 lastUpdated;
        uint256 stalenessThreshold;  // Max age in seconds
        bool active;
    }

    mapping(bytes32 => OracleFeed) public oracleFeeds;
    bytes32[] public feedKeys;
    uint256 public tvlEstimate;
    uint256 public lastTVLUpdate;

    event OracleFeedAdded(bytes32 indexed feedKey, address feedAddress, string label);
    event OracleFeedUpdated(bytes32 indexed feedKey, uint256 price, uint256 timestamp);
    event TVLUpdated(uint256 newTVL, uint256 timestamp);
    event PartnershipIntegrated(string partner, bytes32 circuitId, uint256 timestamp);

    // ─── Events ────────────────────────────────────────────────────────────────
    event FeeReceived(
        bytes32 indexed circuitId,
        address indexed sender,
        uint256 amount,
        uint256 timestamp
    );

    // Emitted when a tagged fee deposit arrives — providerTag mirrors ProviderTag enum
    event FeeReceivedTagged(
        bytes32 indexed circuitId,
        address indexed sender,
        uint256 amount,
        uint8   providerTag,
        uint256 timestamp
    );

    // Emitted when dynamic boost is recalculated at distribute() time
    event DynamicBoostApplied(
        uint16  oldMultiplier,
        uint16  newMultiplier,
        uint256 thetaNativeFees,
        uint256 totalFees,
        uint256 thetaNativeRatioBps
    );

    event FeeDistributed(
        uint256 bbbAmount,
        uint256 getAmount,
        uint256 stakerAmount,
        uint256 treasuryAmount,
        uint256 feeToStakeAmount,
        uint256 distributionId,
        uint256 timestamp
    );

    event StakeRouted(
        uint256 indexed chainId,
        address indexed pool,
        uint256 amount,
        string label,
        uint256 timestamp
    );

    event SplitUpdated(uint16 bbb, uint16 get_, uint16 staker, uint16 treasury);
    event FeeToStakeUpdated(uint16 newBps);
    event RecipientUpdated(string role, address newAddress);
    event StakeRouteAdded(uint256 indexed chainId, address pool, string label, uint16 weight);
    event StakeRouteUpdated(uint256 indexed index, bool active, uint16 weight, uint256 newTotalWeight);
    event GovernanceSplitExecuted(uint16 bbb, uint16 get_, uint16 staker, uint16 treasury, address executor);

    event SubSplitUpdated(uint16 incentivesBps, uint16 lpBoostBps, uint16 grantsBps);
    event BoostMultiplierUpdated(uint16 oldMultiplier, uint16 newMultiplier, uint256 monthlyVolume);
    event GrantProposalSubmitted(uint256 indexed proposalIndex, bytes32 proposalId, address recipient, uint256 amount, address submitter);
    event GrantVoteCast(uint256 indexed proposalIndex, address indexed voter, bool support);
    event GrantExecuted(uint256 indexed proposalIndex, address recipient, uint256 amount);
    event GrantBurned(uint256 indexed proposalIndex, uint256 amount, uint256 timestamp);

    event EscrowCreated(
        uint256 indexed escrowId,
        address indexed payer,
        address indexed payee,
        uint256 amount,
        uint256 maxAmount,
        bytes32 taskId,
        uint256 expiresAt
    );

    event EscrowClaimed(
        uint256 indexed escrowId,
        address indexed payee,
        uint256 amount,
        uint256 feeDeducted,
        uint256 timestamp
    );

    event EscrowRefunded(
        uint256 indexed escrowId,
        address indexed payer,
        uint256 amount,
        uint256 timestamp
    );

    event DeferredClaimCreated(
        uint256 indexed claimId,
        address indexed claimant,
        uint256 amount,
        bytes32 proofNullifier,
        uint256 claimableAfter
    );

    event DeferredClaimExecuted(
        uint256 indexed claimId,
        address indexed claimant,
        uint256 amount,
        uint256 timestamp
    );

    // ─── Errors ────────────────────────────────────────────────────────────────
    error InvalidSplit();
    error InvalidFeeToStake();
    error ZeroAddress();
    error TransferFailed(string recipient);
    error NothingToDistribute();
    error InvalidStakeRoute();
    error RouteIndexOutOfBounds();
    error EscrowNotFound();
    error EscrowAlreadyClaimed();
    error EscrowExpired();
    error EscrowNotExpired();
    error NotEscrowPayee();
    error NotEscrowPayer();
    error ExceedsPayUpTo();
    error ClaimNotReady();
    error ClaimAlreadyClaimed();
    error InvalidSubSplit();
    error InvalidBoostMultiplier();
    error GrantAlreadyVoted();
    error GrantNotFound();
    error GrantAlreadyExecuted();
    error GrantExpired();

    // ─── Constructor ───────────────────────────────────────────────────────────
    constructor(
        address _admin,
        address _bbbWallet,
        address _getWallet,
        address _stakerVault,
        address _treasuryWallet,
        address _stakePool
    ) {
        require(_admin != address(0), "ZeroAdmin");
        require(_bbbWallet != address(0), "ZeroBBB");
        require(_getWallet != address(0), "ZeroGET");
        require(_stakerVault != address(0), "ZeroStaker");
        require(_treasuryWallet != address(0), "ZeroTreasury");

        bbbWallet = _bbbWallet;
        getWallet = _getWallet;
        stakerVault = _stakerVault;
        treasuryWallet = _treasuryWallet;
        stakePool = _stakePool;

        lastVolumeReset = block.timestamp;
        lastGrantActivity = block.timestamp;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(FEE_MANAGER_ROLE, _admin);
        _grantRole(CIRCUIT_ROLE, _admin);
        _grantRole(GOVERNANCE_ROLE, _admin);
    }

    // ─── Fee Ingress ───────────────────────────────────────────────────────────

    receive() external payable {
        totalCollected += msg.value;
        emit FeeReceived(bytes32(0), msg.sender, msg.value, block.timestamp);
    }

    /**
     * @notice Deposit protocol fee tagged with a circuit ID for attribution.
     * @param circuitId Identifier for the circuit originating the fee.
     * @dev Reverts on zero value. Gas target: <30K.
     */
    function depositFee(bytes32 circuitId) external payable whenNotPaused {
        require(msg.value > 0, "ZeroAmount");
        totalCollected += msg.value;
        circuitFees[circuitId] += msg.value;
        totalFeesSinceReset += msg.value;
        emit FeeReceived(circuitId, msg.sender, msg.value, block.timestamp);
    }

    /**
     * @notice Deposit a fee tagged with a ProviderTag.
     * @param circuitId  Circuit identifier (keccak256 of circuit name).
     * @param providerTag  Provider tag value (1 = THETA_NATIVE, 3 = DEPIN_AKASH, etc.).
     *
     * When providerTag == PROVIDER_TAG_THETA_NATIVE (1), the deposit is counted toward
     * the Theta-native volume used by the dynamic boost calculation in distribute().
     * Higher Theta-native share → higher boostMultiplier → more incentives to Theta
     * ecosystem participants.  The relationship is linear:
     *   boostMultiplier = MIN_BOOST + (MAX_BOOST - MIN_BOOST) * (thetaNativeRatio)
     * where thetaNativeRatio = thetaNativeFeesSinceReset / totalFeesSinceReset ∈ [0, 1].
     */
    function depositFeeWithTag(bytes32 circuitId, uint8 providerTag) external payable whenNotPaused {
        require(msg.value > 0, "ZeroAmount");
        totalCollected += msg.value;
        circuitFees[circuitId] += msg.value;
        totalFeesSinceReset += msg.value;

        if (providerTag == PROVIDER_TAG_THETA_NATIVE) {
            thetaNativeFeesSinceReset += msg.value;
            totalThetaNativeFees += msg.value;
        }

        emit FeeReceivedTagged(circuitId, msg.sender, msg.value, providerTag, block.timestamp);
    }

    /**
     * @notice Retroactively tag a previously deposited fee with a providerTag.
     * @param circuitId   Same circuitId used in the original depositFee() call.
     * @param providerTag Provider tag (1 = THETA_NATIVE, 3 = DEPIN_AKASH, etc.).
     * @param amount      Amount of the original fee deposit being tagged.
     *
     * Called by ThetaInferenceCircuit.settleIntent() after attestEdgeCloudNode()
     * has recorded the ProviderTag on-chain.  The fee was already forwarded to this
     * contract at submitIntent() time; this call updates the boost accounting only.
     *
     * @dev No ETH is transferred. Emits FeeReceivedTagged with amount for indexing.
     *      Callable by any registered circuit (no access control — circuits self-report).
     */
    function tagFeeOrigin(bytes32 circuitId, uint8 providerTag, uint256 amount) external whenNotPaused {
        require(amount > 0, "ZeroAmount");
        // Only update the running totals; the fee itself was already counted
        totalFeesSinceReset += amount;

        if (providerTag == PROVIDER_TAG_THETA_NATIVE) {
            thetaNativeFeesSinceReset += amount;
            totalThetaNativeFees += amount;
        }

        emit FeeReceivedTagged(circuitId, msg.sender, amount, providerTag, block.timestamp);
    }

    /**
     * @notice Accept a TNT-20 / ERC-20 fee (e.g., TDROP) from a registered circuit.
     *
     * This is the counterpart to `depositFeeWithTag()` for ERC-20 tokens.
     * The circuit must have already approved this contract for `amount` of `token`
     * before calling.  The fee is pulled via `transferFrom` and held in
     * `erc20Balances[token]` for future governance-directed distribution.
     *
     * Design notes:
     *   - TDROP is NOT added to the TFUEL distribution pool.  It is held separately
     *     until a distribution path is ratified (governance vote via Track 4.1 roadmap).
     *   - providerTag mirrors ProviderTag enum; TDROP payments are always THETA_NATIVE (1)
     *     since TDROP is a Theta-native token.
     *   - Non-fatal in ThetaInferenceCircuit: if this call reverts (e.g., wrong allowance)
     *     the circuit catches the error and the intent still proceeds.
     *   - `erc20Balances` accumulates until a future `distributeERC20()` governance fn
     *     is added (Track 4.1 roadmap: TDROP buy-back or staker yield).
     *
     * @param circuitId   Circuit originating the fee.
     * @param token       ERC-20 token address (e.g., TDROP).
     * @param amount      Amount to pull from msg.sender.
     * @param providerTag ProviderTag enum value from the circuit (uint8).
     */
    function receiveERC20Fee(
        bytes32 circuitId,
        address token,
        uint256 amount,
        uint8   providerTag
    ) external whenNotPaused {
        require(token != address(0), "ZeroToken");
        require(amount > 0, "ZeroAmount");

        bool ok = IERC20(token).transferFrom(msg.sender, address(this), amount);
        require(ok, "ERC20TransferFailed");

        erc20Balances[token]                   += amount;
        circuitErc20Fees[circuitId][token]     += amount;
        totalErc20Collected[token]             += amount;

        // Mirror Theta-native boost accounting for TDROP (always tagged as native)
        if (providerTag == PROVIDER_TAG_THETA_NATIVE) {
            thetaNativeFeesSinceReset += amount;
            totalThetaNativeFees      += amount;
            totalFeesSinceReset       += amount;
        }

        emit ERC20FeeReceived(circuitId, token, msg.sender, amount, providerTag, block.timestamp);
    }

    /**
     * @notice Return the ERC-20 balance held for a specific token.
     * @param token  ERC-20 token address (e.g., TDROP).
     * @return Amount of `token` held by this contract, awaiting distribution.
     */
    function getERC20Balance(address token) external view returns (uint256) {
        return erc20Balances[token];
    }

    /**
     * @notice Return the ERC-20 fees attributed to a specific circuit and token.
     * @param circuitId  Circuit identifier.
     * @param token      ERC-20 token address.
     * @return Amount of `token` collected from that circuit.
     */
    function getCircuitERC20Fees(bytes32 circuitId, address token) external view returns (uint256) {
        return circuitErc20Fees[circuitId][token];
    }

    /**
     * @dev Compute the dynamic boost multiplier from the current Theta-native ratio.
     *      Linear interpolation: 0% native → MIN_BOOST; 100% native → MAX_BOOST.
     *      Falls back to the manually-set boostMultiplier when dynamic boost is disabled
     *      or when no tagged fees have been received this period.
     */
    function _computeBoost() internal view returns (uint16) {
        if (!dynamicBoostEnabled || totalFeesSinceReset == 0) {
            return boostMultiplier;
        }
        // thetaNativeRatioBps ∈ [0, 10000]
        uint256 ratioBps = (thetaNativeFeesSinceReset * TOTAL_BPS) / totalFeesSinceReset;
        uint256 boost = uint256(MIN_BOOST) + ((uint256(MAX_BOOST) - uint256(MIN_BOOST)) * ratioBps) / TOTAL_BPS;
        if (boost > MAX_BOOST) boost = MAX_BOOST;
        return uint16(boost);
    }

    // ─── Distribution ──────────────────────────────────────────────────────────

    /**
     * @notice Distribute accumulated fees according to the configured BPS split.
     *         GET allocation is further sub-split: incentives (with volume boost) and
     *         LP boost are forwarded to the GET wallet; the grants portion is retained
     *         in the contract for agent-driven grant proposals.
     *         Fee-to-Stake portion is routed to multi-chain stake pools if configured,
     *         otherwise falls back to the default stakePool address.
     * @dev Intentionally permissionless — anyone can trigger distribution when balance > 0.
     *      This ensures fees are distributed promptly without relying on a single operator.
     *      The function is protected by nonReentrant and whenNotPaused. Admin can pause
     *      to block distributions if needed.
     */
    function distribute() external nonReentrant whenNotPaused {
        uint256 balance = address(this).balance;
        if (balance == 0) revert NothingToDistribute();

        distributionCount++;

        uint256 bbbAmount = (balance * bbbBps) / TOTAL_BPS;
        uint256 getAmount = (balance * getBps) / TOTAL_BPS;
        uint256 stakerAmount = (balance * stakerBps) / TOTAL_BPS;
        uint256 treasuryRaw = balance - bbbAmount - getAmount - stakerAmount;

        uint256 feeToStakeAmount = (treasuryRaw * feeToStakeBps) / TOTAL_BPS;
        uint256 treasuryAmount = treasuryRaw - feeToStakeAmount;

        // ── Dynamic boost: auto-scale from Theta-native fee share ────────────
        // boostMultiplier is recomputed each distribute() based on what fraction
        // of fees since the last distribution were tagged THETA_NATIVE.
        // This requires zero admin action — the boost follows real usage.
        uint16 effectiveBoost = _computeBoost();
        if (effectiveBoost != boostMultiplier) {
            uint256 ratioBps = totalFeesSinceReset > 0
                ? (thetaNativeFeesSinceReset * TOTAL_BPS) / totalFeesSinceReset
                : 0;
            emit DynamicBoostApplied(boostMultiplier, effectiveBoost, thetaNativeFeesSinceReset, totalFeesSinceReset, ratioBps);
            boostMultiplier = effectiveBoost;
        }

        // Reset period counters for next distribution window
        thetaNativeFeesSinceReset = 0;
        totalFeesSinceReset = 0;

        // GET sub-split: incentives (with dynamic boost), LP boost, grants pool
        uint256 incentivesRaw = (getAmount * incentivesBps) / TOTAL_BPS;
        uint256 incentivesAmount = (incentivesRaw * effectiveBoost) / TOTAL_BPS;
        if (incentivesAmount > getAmount) incentivesAmount = getAmount;
        uint256 lpBoostAmount = (getAmount * lpBoostBps) / TOTAL_BPS;
        uint256 grantsAmount = getAmount - incentivesRaw - lpBoostAmount;

        // Forward incentives + LP boost to GET wallet; grants portion stays in contract
        uint256 getForwarded = getAmount - grantsAmount;

        _safeTransfer(bbbWallet, bbbAmount, "BBB");
        _safeTransfer(getWallet, getForwarded, "GET");
        _safeTransfer(stakerVault, stakerAmount, "Staker");
        _safeTransfer(treasuryWallet, treasuryAmount, "Treasury");

        if (feeToStakeAmount > 0) {
            _routeStake(feeToStakeAmount);
        }

        grantPoolBalance += grantsAmount;
        lastGrantActivity = block.timestamp;

        totalDistributed += balance;
        totalBBB += bbbAmount;
        totalGET += getAmount;
        totalStaker += stakerAmount;
        totalTreasury += treasuryAmount;
        totalFeeToStake += feeToStakeAmount;
        totalIncentivesDistributed += incentivesAmount;
        totalLPBoostDistributed += lpBoostAmount;
        totalGrantsDistributed += grantsAmount;

        monthlyVolume += balance;

        emit FeeDistributed(
            bbbAmount, getAmount, stakerAmount,
            treasuryAmount, feeToStakeAmount,
            distributionCount, block.timestamp
        );
    }

    /**
     * @notice Route fee-to-stake funds to registered chain-specific pools.
     *         Falls back to default stakePool if no routes are configured.
     */
    function _routeStake(uint256 amount) internal {
        if (stakeRoutes.length > 0 && totalStakeWeight > 0) {
            uint256 distributed = 0;
            for (uint256 i = 0; i < stakeRoutes.length; i++) {
                StakeRoute memory r = stakeRoutes[i];
                if (!r.active || r.pool == address(0)) continue;

                uint256 share;
                if (i == stakeRoutes.length - 1) {
                    share = amount - distributed;
                } else {
                    share = (amount * r.weightBps) / totalStakeWeight;
                }

                if (share > 0) {
                    _safeTransfer(r.pool, share, r.label);
                    chainStakeTotal[r.chainId] += share;
                    distributed += share;
                    emit StakeRouted(r.chainId, r.pool, share, r.label, block.timestamp);
                }
            }
        } else if (stakePool != address(0)) {
            _safeTransfer(stakePool, amount, "StakePool");
            chainStakeTotal[block.chainid] += amount;
            emit StakeRouted(block.chainid, stakePool, amount, "DefaultPool", block.timestamp);
        } else {
            _safeTransfer(treasuryWallet, amount, "Treasury(stake)");
            totalTreasury += amount;
        }
    }

    // ─── Stake Route Management ────────────────────────────────────────────────

    /**
     * @notice Register a chain-specific staking pool for Fee-to-Stake routing.
     * @param _pool Pool address on the current chain (or bridge relay contract).
     * @param _chainId Target chain ID (361=Theta, 964=Bittensor, 1=Ethereum).
     * @param _label Human-readable label (e.g., "wTHETA/TFUEL", "dTAO Subnet 1").
     * @param _weightBps Weight in BPS relative to other routes.
     * @dev Restricted to FEE_MANAGER_ROLE. Reverts if pool is zero or weightBps is zero.
     */
    function addStakeRoute(
        address _pool,
        uint256 _chainId,
        string calldata _label,
        uint16 _weightBps
    ) external onlyRole(FEE_MANAGER_ROLE) {
        if (_pool == address(0) || _weightBps == 0) revert InvalidStakeRoute();

        stakeRoutes.push(StakeRoute({
            pool: _pool,
            chainId: _chainId,
            label: _label,
            weightBps: _weightBps,
            active: true
        }));
        totalStakeWeight += _weightBps;

        emit StakeRouteAdded(_chainId, _pool, _label, _weightBps);
    }

    /**
     * @notice Update an existing stake route's active status and weight.
     * @param index Index in stakeRoutes array.
     * @param _active Whether the route receives fee-to-stake allocation.
     * @param _weightBps Weight in BPS relative to other routes.
     * @dev Reverts if index >= stakeRoutes.length.
     */
    function updateStakeRoute(uint256 index, bool _active, uint16 _weightBps)
        external onlyRole(FEE_MANAGER_ROLE)
    {
        if (index >= stakeRoutes.length) revert RouteIndexOutOfBounds();

        StakeRoute storage r = stakeRoutes[index];
        totalStakeWeight = totalStakeWeight - r.weightBps + _weightBps;
        r.active = _active;
        r.weightBps = _weightBps;

        emit StakeRouteUpdated(index, _active, _weightBps, totalStakeWeight);
    }

    /**
     * @notice Return the number of registered stake routes.
     * @return Number of stake routes.
     */
    function getStakeRouteCount() external view returns (uint256) {
        return stakeRoutes.length;
    }

    /**
     * @notice Return stake route at index.
     * @param index Index in stakeRoutes array.
     * @return The StakeRoute struct.
     */
    function getStakeRoute(uint256 index) external view returns (StakeRoute memory) {
        return stakeRoutes[index];
    }

    // ─── Governance Integration ────────────────────────────────────────────────

    /**
     * @notice Update fee split via governance vote execution.
     *         Called by veXFGovernance.executeProposal() for FeeStructure proposals.
     * @param _bbb BPS for Buyback-Burn (e.g., 3000 = 30%).
     * @param _get BPS for Growth & Expansion Treasury.
     * @param _staker BPS for staker vault.
     * @param _treasury BPS for treasury.
     * @dev BPS must sum to 10000. Restricted to FEE_MANAGER_ROLE.
     */
    function setSplit(
        uint16 _bbb, uint16 _get, uint16 _staker, uint16 _treasury
    ) external onlyRole(FEE_MANAGER_ROLE) {
        if (_bbb + _get + _staker + _treasury != TOTAL_BPS) revert InvalidSplit();
        bbbBps = _bbb;
        getBps = _get;
        stakerBps = _staker;
        treasuryBps = _treasury;
        emit SplitUpdated(_bbb, _get, _staker, _treasury);
        emit GovernanceSplitExecuted(_bbb, _get, _staker, _treasury, msg.sender);
    }

    /**
     * @notice Set fee-to-stake allocation as BPS of treasury portion.
     * @param _bps BPS (1500–2500). Share of treasury routed to stake pools.
     * @dev Restricted to FEE_MANAGER_ROLE.
     */
    function setFeeToStake(uint16 _bps) external onlyRole(FEE_MANAGER_ROLE) {
        if (_bps < MIN_FEE_TO_STAKE_BPS || _bps > MAX_FEE_TO_STAKE_BPS) {
            revert InvalidFeeToStake();
        }
        feeToStakeBps = _bps;
        emit FeeToStakeUpdated(_bps);
    }

    // ─── Recipient Configuration ───────────────────────────────────────────────

    /**
     * @notice Set Buyback-Burn wallet address.
     * @param a New BBB recipient address.
     */
    function setBBBWallet(address a) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (a == address(0)) revert ZeroAddress();
        bbbWallet = a;
        emit RecipientUpdated("BBB", a);
    }

    /**
     * @notice Set Growth & Expansion Treasury (GET) wallet address.
     * @param a New GET recipient address.
     */
    function setGETWallet(address a) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (a == address(0)) revert ZeroAddress();
        getWallet = a;
        emit RecipientUpdated("GET", a);
    }

    /**
     * @notice Set staker vault address (veXF holders).
     * @param a New staker vault address.
     */
    function setStakerVault(address a) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (a == address(0)) revert ZeroAddress();
        stakerVault = a;
        emit RecipientUpdated("Staker", a);
    }

    /**
     * @notice Set treasury wallet address.
     * @param a New treasury recipient address.
     */
    function setTreasuryWallet(address a) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (a == address(0)) revert ZeroAddress();
        treasuryWallet = a;
        emit RecipientUpdated("Treasury", a);
    }

    /**
     * @notice Set default stake pool (fallback when no routes configured).
     * @param a Stake pool address. Zero allowed (routes to treasury).
     */
    function setStakePool(address a) external onlyRole(DEFAULT_ADMIN_ROLE) {
        stakePool = a;
        emit RecipientUpdated("StakePool", a);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ─── x402 Escrow Operations ────────────────────────────────────────────────

    /**
     * @notice Create an escrow for a micropayment task (x402 pattern).
     *         Payer locks funds with a pay-up-to cap. Payee claims after task
     *         completion with ZK proof, or payer reclaims after expiry.
     *
     * @param payee Recipient address (service provider / AI agent).
     * @param maxAmount Pay-up-to cap (actual claim may be less).
     * @param taskId Task identifier for tracking.
     * @param duration Escrow duration in seconds before expiry.
     * @return escrowId The created escrow ID.
     *
     * @dev Gas target: <50K for creation. Supports A2A/Akash micropays.
     */
    function createEscrow(
        address payee,
        uint256 maxAmount,
        bytes32 taskId,
        uint256 duration
    ) external payable whenNotPaused nonReentrant returns (uint256 escrowId) {
        require(payee != address(0) && payee != msg.sender, "InvalidPayee");
        require(msg.value > 0, "ZeroAmount");
        require(msg.value <= maxAmount, "ExceedsMax");
        require(duration > 0 && duration <= 30 days, "InvalidDuration");

        escrowCount++;
        escrowId = escrowCount;

        escrows[escrowId] = Escrow({
            payer: msg.sender,
            payee: payee,
            amount: msg.value,
            maxAmount: maxAmount,
            taskId: taskId,
            createdAt: block.timestamp,
            expiresAt: block.timestamp + duration,
            claimed: false,
            refunded: false
        });

        payerEscrows[msg.sender].push(escrowId);
        payeeEscrows[payee].push(escrowId);
        totalEscrowed += msg.value;

        emit EscrowCreated(escrowId, msg.sender, payee, msg.value, maxAmount, taskId, block.timestamp + duration);
    }

    /**
     * @notice Claim escrow funds after task completion.
     *         Deducts protocol fee and routes to RevenueSplitter.
     *
     * @param escrowId The escrow to claim.
     * @param claimAmount Amount to claim (must be <= maxAmount).
     *
     * @dev Gas target: <50K for claims. Fee is 1% routed to distribution.
     */
    function claimEscrow(
        uint256 escrowId,
        uint256 claimAmount
    ) external whenNotPaused nonReentrant {
        Escrow storage e = escrows[escrowId];
        if (e.payer == address(0)) revert EscrowNotFound();
        if (e.claimed || e.refunded) revert EscrowAlreadyClaimed();
        if (msg.sender != e.payee) revert NotEscrowPayee();
        if (block.timestamp > e.expiresAt) revert EscrowExpired();
        if (claimAmount > e.maxAmount) revert ExceedsPayUpTo();
        if (claimAmount > e.amount) claimAmount = e.amount;

        e.claimed = true;

        uint256 protocolFee = (claimAmount * PROTOCOL_FEE_BPS) / TOTAL_BPS;
        uint256 payeeAmount = claimAmount - protocolFee;

        _safeTransfer(e.payee, payeeAmount, "EscrowClaim");

        if (protocolFee > 0) {
            totalCollected += protocolFee;
            circuitFees[e.taskId] += protocolFee;
        }

        uint256 remainder = e.amount - claimAmount;
        if (remainder > 0) {
            _safeTransfer(e.payer, remainder, "EscrowRemainder");
        }

        totalClaimed += claimAmount;

        emit EscrowClaimed(escrowId, e.payee, payeeAmount, protocolFee, block.timestamp);
    }

    /**
     * @notice Refund escrow to payer after expiry.
     */
    function refundEscrow(uint256 escrowId) external nonReentrant {
        Escrow storage e = escrows[escrowId];
        if (e.payer == address(0)) revert EscrowNotFound();
        if (e.claimed || e.refunded) revert EscrowAlreadyClaimed();
        if (msg.sender != e.payer) revert NotEscrowPayer();
        if (block.timestamp <= e.expiresAt) revert EscrowNotExpired();

        e.refunded = true;
        _safeTransfer(e.payer, e.amount, "EscrowRefund");
        totalRefunded += e.amount;

        emit EscrowRefunded(escrowId, e.payer, e.amount, block.timestamp);
    }

    // ─── x402 Deferred Claims ──────────────────────────────────────────────────

    /**
     * @notice Create a deferred claim that can be executed after a delay.
     *         Used for pay-per-use AI tasks where settlement is deferred
     *         until proof verification completes.
     *
     * @param claimant Address that can claim the funds.
     * @param proofNullifier ZK proof nullifier linking to verified computation.
     * @param delaySeconds Delay before claim becomes executable.
     *
     * @dev Gas target: <30K for creation.
     */
    function createDeferredClaim(
        address claimant,
        bytes32 proofNullifier,
        uint256 delaySeconds
    ) external payable onlyRole(CIRCUIT_ROLE) whenNotPaused returns (uint256 claimId) {
        require(claimant != address(0), "ZeroClaimant");
        require(msg.value > 0, "ZeroAmount");
        require(delaySeconds <= 7 days, "DelayTooLong");

        deferredClaimCount++;
        claimId = deferredClaimCount;

        deferredClaims[claimId] = DeferredClaim({
            claimant: claimant,
            amount: msg.value,
            proofNullifier: proofNullifier,
            claimableAfter: block.timestamp + delaySeconds,
            claimed: false
        });

        totalDeferred[claimant] += msg.value;

        emit DeferredClaimCreated(claimId, claimant, msg.value, proofNullifier, block.timestamp + delaySeconds);
    }

    /**
     * @notice Execute a deferred claim after the delay period.
     *
     * @dev Gas target: <50K for execution.
     */
    function executeDeferredClaim(uint256 claimId) external nonReentrant whenNotPaused {
        DeferredClaim storage c = deferredClaims[claimId];
        if (c.claimant == address(0)) revert EscrowNotFound();
        if (c.claimed) revert ClaimAlreadyClaimed();
        if (block.timestamp < c.claimableAfter) revert ClaimNotReady();

        c.claimed = true;
        totalDeferred[c.claimant] -= c.amount;

        uint256 protocolFee = (c.amount * PROTOCOL_FEE_BPS) / TOTAL_BPS;
        uint256 claimantAmount = c.amount - protocolFee;

        _safeTransfer(c.claimant, claimantAmount, "DeferredClaim");

        if (protocolFee > 0) {
            totalCollected += protocolFee;
        }

        totalClaimed += c.amount;

        emit DeferredClaimExecuted(claimId, c.claimant, claimantAmount, block.timestamp);
    }

    // ─── x402 Views ────────────────────────────────────────────────────────────

    function getEscrow(uint256 escrowId) external view returns (Escrow memory) {
        return escrows[escrowId];
    }

    function getPayerEscrowCount(address payer) external view returns (uint256) {
        return payerEscrows[payer].length;
    }

    function getDeferredClaim(uint256 claimId) external view returns (DeferredClaim memory) {
        return deferredClaims[claimId];
    }

    function getX402Stats() external view returns (
        uint256 escrowed, uint256 claimed, uint256 refunded,
        uint256 activeEscrows, uint256 activeClaims
    ) {
        return (totalEscrowed, totalClaimed, totalRefunded, escrowCount, deferredClaimCount);
    }

    // ─── Oracle Integration ──────────────────────────────────────────────────

    /**
     * @notice Register a Chainlink oracle feed for TVL/pricing.
     * @param feedKey Unique identifier for the feed.
     * @param feedAddress Chainlink AggregatorV3Interface address.
     * @param label Human-readable label (e.g., "ETH/USD").
     * @param stalenessThreshold Max age in seconds before price is stale.
     * @dev Restricted to FEE_MANAGER_ROLE.
     */
    function addOracleFeed(
        bytes32 feedKey,
        address feedAddress,
        string calldata label,
        uint256 stalenessThreshold
    ) external onlyRole(FEE_MANAGER_ROLE) {
        require(feedAddress != address(0), "ZeroFeed");
        oracleFeeds[feedKey] = OracleFeed({
            feedAddress: feedAddress,
            label: label,
            lastPrice: 0,
            lastUpdated: 0,
            stalenessThreshold: stalenessThreshold > 0 ? stalenessThreshold : 3600,
            active: true
        });
        feedKeys.push(feedKey);
        emit OracleFeedAdded(feedKey, feedAddress, label);
        emit PartnershipIntegrated("chainlink", feedKey, block.timestamp);
    }

    /**
     * @notice Refresh a Chainlink oracle price feed. Permissionless by design — any
     *         caller can trigger a refresh, enabling keepers and bots to maintain
     *         up-to-date pricing without requiring a privileged role.
     * @param feedKey The registered feed identifier.
     * @return price The updated price from the oracle.
     */
    function updateOraclePrice(bytes32 feedKey) external returns (uint256 price) {
        OracleFeed storage feed = oracleFeeds[feedKey];
        require(feed.active, "FeedNotActive");
        
        (bool ok, bytes memory data) = feed.feedAddress.staticcall(
            abi.encodeWithSignature("latestRoundData()")
        );
        require(ok, "OracleCallFailed");
        
        (, int256 answer,, uint256 updatedAt,) = abi.decode(data, (uint80, int256, uint256, uint256, uint80));
        require(answer > 0, "NegativePrice");
        require(block.timestamp - updatedAt <= feed.stalenessThreshold, "StalePrice");
        
        feed.lastPrice = uint256(answer);
        feed.lastUpdated = updatedAt;
        
        emit OracleFeedUpdated(feedKey, uint256(answer), updatedAt);
        return uint256(answer);
    }

    /**
     * @notice Manually set TVL estimate (used when oracle feeds insufficient).
     * @param _tvl TVL value in wei or USD units (depends on config).
     * @dev Restricted to FEE_MANAGER_ROLE.
     */
    function updateTVL(uint256 _tvl) external onlyRole(FEE_MANAGER_ROLE) {
        tvlEstimate = _tvl;
        lastTVLUpdate = block.timestamp;
        emit TVLUpdated(_tvl, block.timestamp);
    }

    function getOracleFeed(bytes32 key) external view returns (OracleFeed memory) {
        return oracleFeeds[key];
    }

    function getFeedCount() external view returns (uint256) {
        return feedKeys.length;
    }

    // ─── Views ─────────────────────────────────────────────────────────────────

    /**
     * @notice Return current fee split in BPS.
     * @return bbbBps, getBps, stakerBps, treasuryBps.
     */
    function getSplit() external view returns (uint16, uint16, uint16, uint16) {
        return (bbbBps, getBps, stakerBps, treasuryBps);
    }

    /**
     * @notice Return GET sub-split in BPS.
     * @return incentives, lpBoost, grants sub-allocations.
     */
    function getSubSplit() external view returns (uint16, uint16, uint16) {
        return (incentivesBps, lpBoostBps, grantsBps);
    }

    /**
     * @notice Return cumulative distribution statistics.
     * @return collected Total fees received.
     * @return distributed Total fees distributed.
     * @return bbb Total BBB amount.
     * @return get_ Total GET amount.
     * @return staker Total staker amount.
     * @return treasury Total treasury amount.
     * @return feeStake Total fee-to-stake amount.
     */
    function getStats() external view returns (
        uint256 collected, uint256 distributed,
        uint256 bbb, uint256 get_, uint256 staker,
        uint256 treasury, uint256 feeStake
    ) {
        return (totalCollected, totalDistributed, totalBBB, totalGET,
                totalStaker, totalTreasury, totalFeeToStake);
    }

    /**
     * @notice Return contract ETH balance awaiting distribution.
     * @return Current balance in wei.
     */
    function pendingBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /**
     * @notice Return total staked amount routed to a specific chain.
     * @param chainId Target chain ID (e.g., 361=Theta, 964=Bittensor).
     * @return Total wei routed to that chain's stake pools.
     */
    function getChainStakeTotal(uint256 chainId) external view returns (uint256) {
        return chainStakeTotal[chainId];
    }

    // ─── GET Sub-Split Management ──────────────────────────────────────────────

    /**
     * @notice Set GET sub-allocations (incentives, LP boost, grants).
     * @param _incentivesBps Machine & Agent Incentives share (default 5000 = 50%).
     * @param _lpBoostBps LP Boost share (default 3000 = 30%).
     * @param _grantsBps Agent-Driven Grants share (default 2000 = 20%).
     * @dev Must sum to 10000. Callable by admin or GOVERNANCE_ROLE.
     */
    function setSubSplits(
        uint16 _incentivesBps,
        uint16 _lpBoostBps,
        uint16 _grantsBps
    ) external {
        require(
            hasRole(DEFAULT_ADMIN_ROLE, msg.sender) || hasRole(GOVERNANCE_ROLE, msg.sender),
            "NotAdminOrGovernance"
        );
        if (_incentivesBps + _lpBoostBps + _grantsBps != TOTAL_BPS) revert InvalidSubSplit();
        incentivesBps = _incentivesBps;
        lpBoostBps = _lpBoostBps;
        grantsBps = _grantsBps;
        emit SubSplitUpdated(_incentivesBps, _lpBoostBps, _grantsBps);
    }

    /**
     * @notice Update boost multiplier based on monthly protocol volume.
     *         Volume thresholds (in wei): >$10M equivalent ≈ 2.5x boost.
     * @param _multiplier New multiplier in BPS (10000 = 1.0x, 25000 = 2.5x).
     * @dev Callable by FEE_MANAGER_ROLE. Resets monthly volume counter if 30 days elapsed.
     */
    function volumeTriggeredBoost(uint16 _multiplier) external onlyRole(FEE_MANAGER_ROLE) {
        if (_multiplier < MIN_BOOST || _multiplier > MAX_BOOST) revert InvalidBoostMultiplier();

        if (block.timestamp >= lastVolumeReset + 30 days) {
            monthlyVolume = 0;
            lastVolumeReset = block.timestamp;
        }

        uint16 oldMultiplier = boostMultiplier;
        boostMultiplier = _multiplier;
        emit BoostMultiplierUpdated(oldMultiplier, _multiplier, monthlyVolume);
    }

    /**
     * @notice Enable or disable the dynamic Theta-native boost calculation.
     * @param enabled  If true, distribute() auto-scales boostMultiplier from the
     *                 Theta-native fee share.  If false, the manually-set boostMultiplier
     *                 is used as a fixed value (original behaviour).
     * @dev Callable by DEFAULT_ADMIN_ROLE or GOVERNANCE_ROLE.
     *      Disable if a governance vote sets a fixed multiplier for a promotional period.
     */
    function setDynamicBoostEnabled(bool enabled)
        external
    {
        require(
            hasRole(DEFAULT_ADMIN_ROLE, msg.sender) || hasRole(GOVERNANCE_ROLE, msg.sender),
            "NotAdminOrGovernance"
        );
        dynamicBoostEnabled = enabled;
    }

    /**
     * @notice Preview the effective boost that would be applied if distribute() ran now.
     * @return effectiveBoost  Boost in BPS (10000 = 1.0x, up to 25000 = 2.5x).
     * @return thetaNativeRatioBps  Share of tagged fees that are THETA_NATIVE, in BPS.
     */
    function previewBoost() external view returns (uint16 effectiveBoost, uint256 thetaNativeRatioBps) {
        effectiveBoost = _computeBoost();
        thetaNativeRatioBps = totalFeesSinceReset > 0
            ? (thetaNativeFeesSinceReset * TOTAL_BPS) / totalFeesSinceReset
            : 0;
    }

    // ─── Agent Grant Proposals ──────────────────────────────────────────────

    /**
     * @notice Submit an agent-driven grant proposal.
     * @param proposalId Unique off-chain proposal identifier.
     * @param amount Requested grant amount (capped at 5% of grant pool).
     * @param recipient Address to receive the grant if approved.
     * @dev Callable by any address (agent-submittable). Emits GrantProposalSubmitted.
     */
    function agentGrantProposal(
        bytes32 proposalId,
        uint256 amount,
        address recipient
    ) external whenNotPaused returns (uint256 proposalIndex) {
        require(recipient != address(0), "ZeroRecipient");
        require(amount > 0, "ZeroAmount");
        require(amount <= (grantPoolBalance * 500) / TOTAL_BPS, "ExceedsPoolCap");

        grantProposalCount++;
        proposalIndex = grantProposalCount;

        grantProposals[proposalIndex] = GrantProposal({
            proposalId: proposalId,
            recipient: recipient,
            amount: amount,
            submitter: msg.sender,
            createdAt: block.timestamp,
            votesFor: 0,
            votesAgainst: 0,
            executed: false,
            cancelled: false
        });

        emit GrantProposalSubmitted(proposalIndex, proposalId, recipient, amount, msg.sender);
    }

    /**
     * @notice Vote on a grant proposal (veXF-votable — restricted to GOVERNANCE_ROLE).
     * @param proposalIndex Index of the grant proposal.
     * @param support True to vote for, false to vote against.
     * @dev Restricted to GOVERNANCE_ROLE. Reverts if already voted or proposal not found.
     */
    function voteGrant(uint256 proposalIndex, bool support) external onlyRole(GOVERNANCE_ROLE) {
        GrantProposal storage p = grantProposals[proposalIndex];
        if (p.createdAt == 0) revert GrantNotFound();
        if (p.executed || p.cancelled) revert GrantAlreadyExecuted();
        if (grantVotes[proposalIndex][msg.sender]) revert GrantAlreadyVoted();

        grantVotes[proposalIndex][msg.sender] = true;
        if (support) {
            p.votesFor++;
        } else {
            p.votesAgainst++;
        }
        emit GrantVoteCast(proposalIndex, msg.sender, support);
    }

    /**
     * @notice Execute an approved grant proposal (votesFor > votesAgainst).
     * @param proposalIndex Index of the grant proposal to execute.
     * @dev Transfers funds from grant pool to recipient. Auto-burns (cancels) the
     *      proposal if it is older than 6 months (GRANT_EXPIRY) from its creation date.
     */
    function claimGrant(uint256 proposalIndex) external nonReentrant whenNotPaused {
        GrantProposal storage p = grantProposals[proposalIndex];
        if (p.createdAt == 0) revert GrantNotFound();
        if (p.executed || p.cancelled) revert GrantAlreadyExecuted();

        // Auto-burn: if grant pool has been idle for 6 months, burn the proposal
        if (block.timestamp > p.createdAt + GRANT_EXPIRY) {
            p.cancelled = true;
            emit GrantBurned(proposalIndex, p.amount, block.timestamp);
            return;
        }

        require(p.votesFor > p.votesAgainst, "NotApproved");
        require(p.amount <= grantPoolBalance, "InsufficientGrantPool");

        p.executed = true;
        grantPoolBalance -= p.amount;
        lastGrantActivity = block.timestamp;

        _safeTransfer(p.recipient, p.amount, "Grant");
        emit GrantExecuted(proposalIndex, p.recipient, p.amount);
    }

    /**
     * @notice Return grant proposal details.
     * @param proposalIndex Index of the grant proposal.
     * @return GrantProposal struct with proposal data, votes, and execution status.
     */
    function getGrantProposal(uint256 proposalIndex) external view returns (GrantProposal memory) {
        return grantProposals[proposalIndex];
    }

    // ─── Internal ──────────────────────────────────────────────────────────────

    function _safeTransfer(address to, uint256 amount, string memory label) internal {
        if (amount == 0 || to == address(0)) return;
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed(label);
    }
}
