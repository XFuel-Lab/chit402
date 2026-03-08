// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AutonomousVaults
 * @author XFuel Protocol — Further Expansion Circuits
 * @notice Autonomous AI Vault Circuit: AI-driven, tokenized yield strategies
 *         with ZK-verified rebalancing and on-chain performance attestation.
 *
 * Architecture (inspired by Almanak agent swarms, generalized):
 *   1. Vault Creation — Strategists create vaults with encoded strategy params.
 *   2. Strategy Registration — AI strategies are committed as hashes (private logic).
 *   3. Deposit/Withdraw — Users deposit into vaults, receive proportional shares.
 *   4. Rebalance — Off-chain AI agent swarms compute optimal allocations,
 *      then submit rebalance proofs verified on-chain via SP1 ZK proofs.
 *   5. Performance — Rolling performance tracked; strategist fees on profits.
 *
 * Research ties:
 *   Per Almanak (almanak.co, 2026):
 *     - 18 specialized AI agents collaborate: strategist, coder, QA, backtester,
 *       vault manager, security expert. Human-AI hybrid control.
 *     - ERC-7540 vaults for composability; non-custodial, tradable vault shares.
 *     - Monte Carlo simulations (10K+ scenarios) for strategy optimization.
 *     - Strategy types: technical analysis, LP management, automated looping,
 *       arbitrage, yield farming, cross-chain rebalancing.
 *     - $8.45M raised (Delphi Labs, HashKey Capital). Targets $90-100T market.
 *
 *   For XFuel integration:
 *     - Strategy logic stays off-chain (private AI); only commitment on-chain.
 *     - SP1 proves: "Given strategy S and market state M, rebalance R is optimal"
 *       without revealing the strategy's proprietary signals/weights.
 *     - Fees flow to CoreRevenueSplitter (protocol) + strategist (performance fee).
 *
 * Core Layer integration:
 *   - Emits VaultRebalanced for ai-listener.js to coordinate with AI agents.
 *   - Sends protocol fees to CoreRevenueSplitter via depositFee(CIRCUIT_ID).
 *   - Uses ZKVerifierSP1 for rebalance proof verification.
 *   - Fully isolated: own vault registry, strategy state, share accounting.
 */
contract AutonomousVaults is AccessControl, Pausable, ReentrancyGuard {
    // ─── Roles ────────────────────────────────────────────────────────────────
    bytes32 public constant STRATEGIST_ROLE = keccak256("STRATEGIST_ROLE");
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");

    // ─── Circuit Identity ─────────────────────────────────────────────────────
    bytes32 public constant CIRCUIT_ID = keccak256("AUTONOMOUS_VAULTS_CIRCUIT");

    // ─── Core Layer References ────────────────────────────────────────────────
    address public revenueSplitter;
    address public zkVerifier;

    // ─── Fee Configuration ────────────────────────────────────────────────────
    uint16 public protocolFeeBps = 50;       // 0.5% protocol fee on deposits
    uint16 public constant MAX_PROTOCOL_FEE = 100;
    uint16 public constant MAX_PERF_FEE = 2000;  // 20% max performance fee
    uint16 public constant BPS_DENOM = 10000;

    // ─── Strategy Registry ────────────────────────────────────────────────────
    struct Strategy {
        bytes32 strategyId;
        address creator;
        bytes32 logicCommitment;    // keccak256(strategy_logic) — stays private
        string description;         // Public description
        string category;            // "yield", "arbitrage", "lp", "rebalance"
        uint16 performanceFeeBps;   // Creator's fee on profits (up to 20%)
        uint256 totalAum;           // Assets under management
        bool active;
        uint64 createdAt;
    }

    mapping(bytes32 => Strategy) public strategies;
    uint256 public strategyCount;

    // ─── Vault Registry ───────────────────────────────────────────────────────
    enum VaultStatus { Active, Paused, Closed }

    struct Vault {
        bytes32 vaultId;
        bytes32 strategyId;
        address strategist;
        uint256 totalDeposits;
        uint256 totalShares;
        uint256 highWaterMark;      // For performance fee calculation
        uint256 currentNav;         // Current net asset value
        uint256 rebalanceCount;
        VaultStatus status;
        uint64 createdAt;
        uint64 lastRebalanceAt;
    }

    mapping(bytes32 => Vault) public vaults;
    bytes32[] public vaultIds;
    uint256 public vaultCount;

    // ─── User Positions ───────────────────────────────────────────────────────
    struct Position {
        uint256 shares;
        uint256 depositedValue;
        uint64 depositedAt;
    }

    /// @notice vaultId => user => Position
    mapping(bytes32 => mapping(address => Position)) public positions;

    // ─── Rebalance Records ────────────────────────────────────────────────────
    struct RebalanceRecord {
        bytes32 rebalanceId;
        bytes32 vaultId;
        bytes32 allocationHash;     // Hash of target allocation
        bytes32 proofNullifier;
        uint256 navBefore;
        uint256 navAfter;
        uint64 timestamp;
    }

    mapping(bytes32 => RebalanceRecord) public rebalances;
    uint256 public totalRebalances;

    // ─── Nullifier Tracking ───────────────────────────────────────────────────
    mapping(bytes32 => bool) public usedNullifiers;

    // ─── Metrics ──────────────────────────────────────────────────────────────
    uint256 public totalDeposited;
    uint256 public totalWithdrawn;
    uint256 public totalProtocolFees;
    uint256 public totalPerformanceFees;

    // ─── Events ───────────────────────────────────────────────────────────────
    event StrategyRegistered(
        bytes32 indexed strategyId,
        address indexed creator,
        bytes32 logicCommitment,
        string category
    );

    event VaultCreated(
        bytes32 indexed circuitId,
        bytes32 indexed vaultId,
        bytes32 indexed strategyId,
        address strategist
    );

    event Deposited(
        bytes32 indexed vaultId,
        address indexed user,
        uint256 amount,
        uint256 shares,
        uint256 fee
    );

    event Withdrawn(
        bytes32 indexed vaultId,
        address indexed user,
        uint256 shares,
        uint256 amount
    );

    event VaultRebalanced(
        bytes32 indexed circuitId,
        bytes32 indexed vaultId,
        bytes32 rebalanceId,
        bytes32 allocationHash,
        uint256 navBefore,
        uint256 navAfter,
        bytes32 nullifier
    );

    event PerformanceFeeCharged(
        bytes32 indexed vaultId,
        uint256 fee,
        address indexed strategist
    );

    event VaultStatusChanged(bytes32 indexed vaultId, VaultStatus newStatus);

    // ─── Errors ───────────────────────────────────────────────────────────────
    error StrategyNotFound();
    error VaultNotFound();
    error VaultNotActive();
    error VaultClosed();
    error InsufficientShares();
    error NullifierUsed();
    error NotStrategist();
    error FeeTooHigh();
    error ZeroDeposit();

    // ─── Constructor ──────────────────────────────────────────────────────────
    constructor(
        address _admin,
        address _revenueSplitter,
        address _zkVerifier
    ) {
        require(_admin != address(0), "ZeroAdmin");
        revenueSplitter = _revenueSplitter;
        zkVerifier = _zkVerifier;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(STRATEGIST_ROLE, _admin);
        _grantRole(KEEPER_ROLE, _admin);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  1. STRATEGY REGISTRY
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Register a private AI strategy. Only logic commitment stored on-chain.
     * @param logicCommitment keccak256 of the strategy logic/parameters.
     * @param description Human-readable description.
     * @param category Strategy category.
     * @param performanceFeeBps Strategist's performance fee (max 20%).
     */
    function registerStrategy(
        bytes32 logicCommitment,
        string calldata description,
        string calldata category,
        uint16 performanceFeeBps
    ) external whenNotPaused returns (bytes32 strategyId) {
        require(logicCommitment != bytes32(0), "ZeroCommitment");
        if (performanceFeeBps > MAX_PERF_FEE) revert FeeTooHigh();

        strategyId = keccak256(abi.encodePacked(
            CIRCUIT_ID, msg.sender, logicCommitment, strategyCount
        ));

        strategies[strategyId] = Strategy({
            strategyId: strategyId,
            creator: msg.sender,
            logicCommitment: logicCommitment,
            description: description,
            category: category,
            performanceFeeBps: performanceFeeBps,
            totalAum: 0,
            active: true,
            createdAt: uint64(block.timestamp)
        });

        strategyCount++;
        emit StrategyRegistered(strategyId, msg.sender, logicCommitment, category);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  2. VAULT MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Create a new vault backed by a registered strategy.
     */
    function createVault(
        bytes32 strategyId
    ) external whenNotPaused returns (bytes32 vaultId) {
        Strategy storage s = strategies[strategyId];
        if (s.createdAt == 0) revert StrategyNotFound();
        require(s.creator == msg.sender || hasRole(STRATEGIST_ROLE, msg.sender), "NotCreator");

        vaultId = keccak256(abi.encodePacked(
            CIRCUIT_ID, msg.sender, strategyId, vaultCount
        ));

        vaults[vaultId] = Vault({
            vaultId: vaultId,
            strategyId: strategyId,
            strategist: msg.sender,
            totalDeposits: 0,
            totalShares: 0,
            highWaterMark: 0,
            currentNav: 0,
            rebalanceCount: 0,
            status: VaultStatus.Active,
            createdAt: uint64(block.timestamp),
            lastRebalanceAt: 0
        });

        vaultIds.push(vaultId);
        vaultCount++;

        emit VaultCreated(CIRCUIT_ID, vaultId, strategyId, msg.sender);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  3. DEPOSIT / WITHDRAW
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Deposit into a vault, receiving proportional shares.
     */
    function deposit(
        bytes32 vaultId
    ) external payable whenNotPaused nonReentrant {
        if (msg.value == 0) revert ZeroDeposit();
        Vault storage v = vaults[vaultId];
        if (v.createdAt == 0) revert VaultNotFound();
        if (v.status != VaultStatus.Active) revert VaultNotActive();

        // Protocol fee
        uint256 fee = (msg.value * protocolFeeBps) / BPS_DENOM;
        uint256 netDeposit = msg.value - fee;

        // Calculate shares: first depositor gets 1:1, then proportional
        uint256 newShares;
        if (v.totalShares == 0) {
            newShares = netDeposit;
        } else {
            newShares = (netDeposit * v.totalShares) / v.currentNav;
        }

        // Update vault
        v.totalDeposits += netDeposit;
        v.totalShares += newShares;
        v.currentNav += netDeposit;

        // Update strategy AUM
        strategies[v.strategyId].totalAum += netDeposit;

        // Update user position
        Position storage pos = positions[vaultId][msg.sender];
        pos.shares += newShares;
        pos.depositedValue += netDeposit;
        pos.depositedAt = uint64(block.timestamp);

        // Metrics
        totalDeposited += netDeposit;
        totalProtocolFees += fee;

        // Forward protocol fee
        if (fee > 0) _forwardFee(fee);

        emit Deposited(vaultId, msg.sender, netDeposit, newShares, fee);
    }

    /**
     * @notice Withdraw from a vault by burning shares.
     */
    function withdraw(
        bytes32 vaultId,
        uint256 shares
    ) external nonReentrant {
        Vault storage v = vaults[vaultId];
        if (v.createdAt == 0) revert VaultNotFound();
        if (v.status == VaultStatus.Closed) revert VaultClosed();

        Position storage pos = positions[vaultId][msg.sender];
        if (pos.shares < shares) revert InsufficientShares();

        // Calculate withdrawal amount proportional to NAV
        uint256 amount = (shares * v.currentNav) / v.totalShares;

        // Update vault
        v.totalShares -= shares;
        v.currentNav -= amount;

        // Update strategy AUM
        strategies[v.strategyId].totalAum -= amount;

        // Update user position
        pos.shares -= shares;
        totalWithdrawn += amount;

        // Transfer
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "WithdrawFailed");

        emit Withdrawn(vaultId, msg.sender, shares, amount);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  4. ZK-VERIFIED REBALANCE
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Execute a vault rebalance with ZK proof of optimal allocation.
     * @param vaultId Target vault.
     * @param allocationHash Hash of the new target allocation.
     * @param newNav Updated NAV after rebalance (simulated off-chain).
     * @param proof SP1 proof that the rebalance is optimal given strategy + market.
     * @param publicValues SP1 public values.
     * @param nullifier Replay protection.
     *
     * @dev Only KEEPER_ROLE can trigger rebalances. The SP1 proof attests:
     *      "Given strategy commitment S and market state M, allocation A maximizes
     *       the objective" — without revealing S.
     */
    function rebalance(
        bytes32 vaultId,
        bytes32 allocationHash,
        uint256 newNav,
        bytes calldata proof,
        bytes calldata publicValues,
        bytes32 nullifier
    ) external onlyRole(KEEPER_ROLE) nonReentrant whenNotPaused {
        Vault storage v = vaults[vaultId];
        if (v.createdAt == 0) revert VaultNotFound();
        if (v.status != VaultStatus.Active) revert VaultNotActive();
        if (usedNullifiers[nullifier]) revert NullifierUsed();

        usedNullifiers[nullifier] = true;

        // Verify SP1 proof
        if (zkVerifier != address(0)) {
            (bool ok, ) = zkVerifier.call(
                abi.encodeWithSignature(
                    "verifyProof(bytes32,bytes,bytes,bytes32)",
                    CIRCUIT_ID, publicValues, proof, nullifier
                )
            );
            require(ok, "ProofFailed");
        }

        uint256 navBefore = v.currentNav;

        // Charge performance fee if NAV increased above high water mark
        if (newNav > v.highWaterMark && v.highWaterMark > 0) {
            uint256 profit = newNav - v.highWaterMark;
            Strategy storage s = strategies[v.strategyId];
            uint256 perfFee = (profit * s.performanceFeeBps) / BPS_DENOM;

            if (perfFee > 0 && perfFee < newNav) {
                newNav -= perfFee;
                totalPerformanceFees += perfFee;

                // Pay strategist
                (bool ok2, ) = payable(v.strategist).call{value: perfFee}("");
                require(ok2, "PerfFeePay");

                emit PerformanceFeeCharged(vaultId, perfFee, v.strategist);
            }
        }

        // Update vault
        v.currentNav = newNav;
        if (newNav > v.highWaterMark) {
            v.highWaterMark = newNav;
        }
        v.rebalanceCount++;
        v.lastRebalanceAt = uint64(block.timestamp);

        // Record rebalance
        bytes32 rebalanceId = keccak256(abi.encodePacked(
            vaultId, totalRebalances++
        ));

        rebalances[rebalanceId] = RebalanceRecord({
            rebalanceId: rebalanceId,
            vaultId: vaultId,
            allocationHash: allocationHash,
            proofNullifier: nullifier,
            navBefore: navBefore,
            navAfter: newNav,
            timestamp: uint64(block.timestamp)
        });

        emit VaultRebalanced(
            CIRCUIT_ID, vaultId, rebalanceId, allocationHash,
            navBefore, newNav, nullifier
        );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  5. VAULT ADMIN
    // ═══════════════════════════════════════════════════════════════════════════

    function pauseVault(bytes32 vaultId) external {
        Vault storage v = vaults[vaultId];
        if (v.createdAt == 0) revert VaultNotFound();
        require(
            msg.sender == v.strategist || hasRole(DEFAULT_ADMIN_ROLE, msg.sender),
            "NotAuthorized"
        );
        v.status = VaultStatus.Paused;
        emit VaultStatusChanged(vaultId, VaultStatus.Paused);
    }

    function resumeVault(bytes32 vaultId) external {
        Vault storage v = vaults[vaultId];
        if (v.createdAt == 0) revert VaultNotFound();
        require(
            msg.sender == v.strategist || hasRole(DEFAULT_ADMIN_ROLE, msg.sender),
            "NotAuthorized"
        );
        v.status = VaultStatus.Active;
        emit VaultStatusChanged(vaultId, VaultStatus.Active);
    }

    function closeVault(bytes32 vaultId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Vault storage v = vaults[vaultId];
        if (v.createdAt == 0) revert VaultNotFound();
        v.status = VaultStatus.Closed;
        emit VaultStatusChanged(vaultId, VaultStatus.Closed);
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _forwardFee(uint256 amount) internal {
        if (amount == 0 || revenueSplitter == address(0)) return;
        (bool ok, ) = revenueSplitter.call{value: amount}(
            abi.encodeWithSignature("depositFee(bytes32)", CIRCUIT_ID)
        );
        if (!ok) {
            (bool ok2, ) = payable(revenueSplitter).call{value: amount}("");
            require(ok2, "FeeFwd");
        }
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setProtocolFee(uint16 _bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_bps <= MAX_PROTOCOL_FEE, "FeeTooHigh");
        protocolFeeBps = _bps;
    }

    function setRevenueSplitter(address _rs) external onlyRole(DEFAULT_ADMIN_ROLE) {
        revenueSplitter = _rs;
    }

    function setZKVerifier(address _zk) external onlyRole(DEFAULT_ADMIN_ROLE) {
        zkVerifier = _zk;
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getStrategy(bytes32 id) external view returns (Strategy memory) {
        return strategies[id];
    }

    function getVault(bytes32 id) external view returns (Vault memory) {
        return vaults[id];
    }

    function getPosition(bytes32 vaultId, address user) external view returns (Position memory) {
        return positions[vaultId][user];
    }

    function getRebalance(bytes32 id) external view returns (RebalanceRecord memory) {
        return rebalances[id];
    }

    function getStats() external view returns (
        uint256 strategies_, uint256 vaults_, uint256 deposited_,
        uint256 withdrawn_, uint256 protocolFees_, uint256 perfFees_,
        uint256 rebalances_
    ) {
        return (strategyCount, vaultCount, totalDeposited, totalWithdrawn,
                totalProtocolFees, totalPerformanceFees, totalRebalances);
    }

    receive() external payable {}
}
