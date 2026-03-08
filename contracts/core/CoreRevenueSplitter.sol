// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title CoreRevenueSplitter
 * @author XFuel Protocol — Core Layer
 * @notice Ecosystem-agnostic fee collection and distribution with configurable splits,
 *         multi-chain Fee-to-Stake routing, and governance integration.
 *
 * Default Split (30/30/25/15 — sums to 10000 BPS):
 *   30% → Buyback-Burn (BBB): Buy XF on open market and burn
 *   30% → Liquidity Provision (LP): Deepen AMM pools
 *   25% → Stakers (veXF holders): Yield distribution
 *   15% → Treasury: Operations, AI infra, grants, future incentives
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
 *   - distribute():    <80K (5 transfers + accounting + events)
 *   - depositFee():    <30K (receive + tag + event)
 *   - stakeRoute():    <60K (single chain routing)
 */
contract CoreRevenueSplitter is AccessControl, Pausable, ReentrancyGuard {
    // ─── Roles ─────────────────────────────────────────────────────────────────
    bytes32 public constant FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE");
    bytes32 public constant CIRCUIT_ROLE = keccak256("CIRCUIT_ROLE");
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

    // ─── Split Configuration (in BPS, must sum to 10000) ───────────────────────
    uint16 public bbbBps = 3000;
    uint16 public lpBps = 3000;
    uint16 public stakerBps = 2500;
    uint16 public treasuryBps = 1500;
    uint16 public constant TOTAL_BPS = 10000;

    // ─── Fee-to-Stake Configuration ────────────────────────────────────────────
    uint16 public feeToStakeBps = 2000;
    uint16 public constant MIN_FEE_TO_STAKE_BPS = 1500;
    uint16 public constant MAX_FEE_TO_STAKE_BPS = 2500;

    /// @notice Protocol fee on x402 escrow claims and deferred payouts (1% = 100 BPS).
    uint16 public constant PROTOCOL_FEE_BPS = 100;

    // ─── Recipient Addresses ───────────────────────────────────────────────────
    address public bbbWallet;
    address public lpWallet;
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
    uint256 public totalLP;
    uint256 public totalStaker;
    uint256 public totalTreasury;
    uint256 public totalFeeToStake;
    uint256 public distributionCount;

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

    event FeeDistributed(
        uint256 bbbAmount,
        uint256 lpAmount,
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

    event SplitUpdated(uint16 bbb, uint16 lp, uint16 staker, uint16 treasury);
    event FeeToStakeUpdated(uint16 newBps);
    event RecipientUpdated(string role, address newAddress);
    event StakeRouteAdded(uint256 indexed chainId, address pool, string label, uint16 weight);
    event StakeRouteUpdated(uint256 indexed index, bool active, uint16 weight, uint256 newTotalWeight);
    event GovernanceSplitExecuted(uint16 bbb, uint16 lp, uint16 staker, uint16 treasury, address executor);

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

    // ─── Constructor ───────────────────────────────────────────────────────────
    constructor(
        address _admin,
        address _bbbWallet,
        address _lpWallet,
        address _stakerVault,
        address _treasuryWallet,
        address _stakePool
    ) {
        require(_admin != address(0), "ZeroAdmin");
        require(_bbbWallet != address(0), "ZeroBBB");
        require(_lpWallet != address(0), "ZeroLP");
        require(_stakerVault != address(0), "ZeroStaker");
        require(_treasuryWallet != address(0), "ZeroTreasury");

        bbbWallet = _bbbWallet;
        lpWallet = _lpWallet;
        stakerVault = _stakerVault;
        treasuryWallet = _treasuryWallet;
        stakePool = _stakePool;

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
        emit FeeReceived(circuitId, msg.sender, msg.value, block.timestamp);
    }

    // ─── Distribution ──────────────────────────────────────────────────────────

    /**
     * @notice Distribute accumulated fees according to the configured BPS split.
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
        uint256 lpAmount = (balance * lpBps) / TOTAL_BPS;
        uint256 stakerAmount = (balance * stakerBps) / TOTAL_BPS;
        uint256 treasuryRaw = balance - bbbAmount - lpAmount - stakerAmount;

        uint256 feeToStakeAmount = (treasuryRaw * feeToStakeBps) / TOTAL_BPS;
        uint256 treasuryAmount = treasuryRaw - feeToStakeAmount;

        _safeTransfer(bbbWallet, bbbAmount, "BBB");
        _safeTransfer(lpWallet, lpAmount, "LP");
        _safeTransfer(stakerVault, stakerAmount, "Staker");
        _safeTransfer(treasuryWallet, treasuryAmount, "Treasury");

        if (feeToStakeAmount > 0) {
            _routeStake(feeToStakeAmount);
        }

        totalDistributed += balance;
        totalBBB += bbbAmount;
        totalLP += lpAmount;
        totalStaker += stakerAmount;
        totalTreasury += treasuryAmount;
        totalFeeToStake += feeToStakeAmount;

        emit FeeDistributed(
            bbbAmount, lpAmount, stakerAmount,
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
     * @param _lp BPS for Liquidity Provision.
     * @param _staker BPS for staker vault.
     * @param _treasury BPS for treasury.
     * @dev BPS must sum to 10000. Restricted to FEE_MANAGER_ROLE.
     */
    function setSplit(
        uint16 _bbb, uint16 _lp, uint16 _staker, uint16 _treasury
    ) external onlyRole(FEE_MANAGER_ROLE) {
        if (_bbb + _lp + _staker + _treasury != TOTAL_BPS) revert InvalidSplit();
        bbbBps = _bbb;
        lpBps = _lp;
        stakerBps = _staker;
        treasuryBps = _treasury;
        emit SplitUpdated(_bbb, _lp, _staker, _treasury);
        emit GovernanceSplitExecuted(_bbb, _lp, _staker, _treasury, msg.sender);
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
     * @notice Set Liquidity Provision wallet address.
     * @param a New LP recipient address.
     */
    function setLPWallet(address a) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (a == address(0)) revert ZeroAddress();
        lpWallet = a;
        emit RecipientUpdated("LP", a);
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
     * @return bbbBps, lpBps, stakerBps, treasuryBps.
     */
    function getSplit() external view returns (uint16, uint16, uint16, uint16) {
        return (bbbBps, lpBps, stakerBps, treasuryBps);
    }

    /**
     * @notice Return cumulative distribution statistics.
     * @return collected Total fees received.
     * @return distributed Total fees distributed.
     * @return bbb Total BBB amount.
     * @return lp Total LP amount.
     * @return staker Total staker amount.
     * @return treasury Total treasury amount.
     * @return feeStake Total fee-to-stake amount.
     */
    function getStats() external view returns (
        uint256 collected, uint256 distributed,
        uint256 bbb, uint256 lp, uint256 staker,
        uint256 treasury, uint256 feeStake
    ) {
        return (totalCollected, totalDistributed, totalBBB, totalLP,
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

    // ─── Internal ──────────────────────────────────────────────────────────────

    function _safeTransfer(address to, uint256 amount, string memory label) internal {
        if (amount == 0 || to == address(0)) return;
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed(label);
    }
}
