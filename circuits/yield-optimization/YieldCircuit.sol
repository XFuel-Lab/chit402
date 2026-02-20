// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title YieldCircuit
 * @author XFuel Protocol — Final Expansion Circuits
 * @notice Generalized Yield Optimization Circuit: ZK-verified multi-pool
 *         rebalancing with concentrated-liquidity awareness and cross-chain routing.
 *
 * Architecture (inspired by Osmosis CL pools, generalized):
 *   1. Pool Registry — Track yield-bearing pools across chains.
 *   2. Position Management — Users deposit; system tracks proportional positions.
 *   3. ZK Rebalance — SP1 proves optimal allocation across pools.
 *   4. Harvest — Claim accumulated yield with fee deduction.
 *   5. Cross-chain — IBC/bridge-aware routing for multi-chain yield capture.
 *
 * Research ties:
 *   Per Osmosis (osmosis.zone, 2026):
 *     - Concentrated liquidity ("supercharged pools"): 200-300x capital efficiency.
 *     - Geometric tick spacing for granular price control.
 *     - Tracks liquidity (L) and sqrt price rather than raw reserves.
 *     - Incentives based on position proximity to current price + uptime.
 *     - Cross-chain via IBC: seamless Cosmos-wide yield routing.
 *
 *   For XFuel integration:
 *     - Pool configs stored as hashes; actual positions managed off-chain.
 *     - SP1 proves: "Rebalance R from allocation A to A' maximizes yield Y"
 *       across registered pools without revealing proprietary routing signals.
 *     - Supports concentrated liquidity tick ranges as first-class parameters.
 *     - Fees flow to CoreRevenueSplitter (protocol) + performance fee to optimizer.
 *
 * Core Layer integration:
 *   - Emits PositionRebalanced for ai-listener.js yield optimization routing.
 *   - Sends protocol fees to CoreRevenueSplitter via depositFee(CIRCUIT_ID).
 *   - Uses ZKVerifierSP1 for rebalance proof verification.
 *   - Fully isolated: own pool registry, position state, harvest accounting.
 */
contract YieldCircuit is AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant OPTIMIZER_ROLE = keccak256("OPTIMIZER_ROLE");
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");
    bytes32 public constant CIRCUIT_ID = keccak256("YIELD_OPTIMIZATION_CIRCUIT");

    address public revenueSplitter;
    address public zkVerifier;

    uint16 public protocolFeeBps = 50;          // 0.5% on deposits
    uint16 public harvestFeeBps = 100;           // 1% on harvested yield
    uint16 public constant MAX_FEE = 200;
    uint16 public constant BPS_DENOM = 10000;

    // ─── Pool Registry ────────────────────────────────────────────────────
    struct YieldPool {
        bytes32 poolId;
        address registrar;
        string protocol;              // "osmosis", "uniswap-v3", "curve", "aave"
        string chain;                 // "osmosis-1", "ethereum", "arbitrum"
        bytes32 configHash;           // Hash of pool config (tick ranges, pair, fees)
        uint256 currentApy;           // Basis points (e.g. 3000 = 30% APY)
        uint256 totalAllocated;
        bool active;
        uint64 registeredAt;
        uint64 lastUpdatedAt;
    }

    mapping(bytes32 => YieldPool) public pools;
    bytes32[] public poolIds;
    uint256 public poolCount;

    // ─── User Positions ───────────────────────────────────────────────────
    struct Position {
        bytes32 positionId;
        address owner;
        uint256 deposited;
        uint256 currentValue;
        uint256 harvestedTotal;
        uint256 pendingYield;
        uint64 createdAt;
        uint64 lastHarvestAt;
    }

    mapping(bytes32 => Position) public positions;
    bytes32[] public positionIds;
    uint256 public positionCount;

    // ─── Allocation State ─────────────────────────────────────────────────
    struct Allocation {
        bytes32 positionId;
        bytes32 poolId;
        uint256 amount;
    }

    mapping(bytes32 => Allocation[]) public positionAllocations;

    // ─── Rebalance Records ────────────────────────────────────────────────
    struct RebalanceRecord {
        bytes32 rebalanceId;
        bytes32 positionId;
        bytes32 fromAllocationHash;
        bytes32 toAllocationHash;
        bytes32 nullifier;
        uint256 yieldCaptured;
        uint64 timestamp;
    }

    mapping(bytes32 => RebalanceRecord) public rebalances;
    uint256 public totalRebalances;

    // ─── Nullifier Tracking ───────────────────────────────────────────────
    mapping(bytes32 => bool) public usedNullifiers;

    // ─── Metrics ──────────────────────────────────────────────────────────
    uint256 public totalDeposited;
    uint256 public totalHarvested;
    uint256 public totalProtocolFees;

    // ─── Events ───────────────────────────────────────────────────────────
    event PoolRegistered(bytes32 indexed poolId, string protocol, string chain, uint256 apy);
    event PoolUpdated(bytes32 indexed poolId, uint256 newApy, bool active);
    event PositionOpened(bytes32 indexed circuitId, bytes32 indexed positionId, address owner, uint256 deposited);
    event PositionRebalanced(bytes32 indexed circuitId, bytes32 indexed positionId, bytes32 rebalanceId, bytes32 toAllocationHash, uint256 yieldCaptured, bytes32 nullifier);
    event YieldHarvested(bytes32 indexed positionId, address indexed owner, uint256 amount, uint256 fee);
    event PositionClosed(bytes32 indexed positionId, uint256 returned);

    error PoolNotFound();
    error PositionNotFound();
    error NullifierUsed();
    error InsufficientYield();

    constructor(address _admin, address _revenueSplitter, address _zkVerifier) {
        require(_admin != address(0), "ZeroAdmin");
        revenueSplitter = _revenueSplitter;
        zkVerifier = _zkVerifier;
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(OPTIMIZER_ROLE, _admin);
        _grantRole(KEEPER_ROLE, _admin);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  1. POOL REGISTRY
    // ═══════════════════════════════════════════════════════════════════════

    function registerPool(
        string calldata protocol,
        string calldata chain,
        bytes32 configHash,
        uint256 currentApy
    ) external onlyRole(OPTIMIZER_ROLE) returns (bytes32 poolId) {
        poolId = keccak256(abi.encodePacked(CIRCUIT_ID, protocol, chain, poolCount));

        pools[poolId] = YieldPool({
            poolId: poolId,
            registrar: msg.sender,
            protocol: protocol,
            chain: chain,
            configHash: configHash,
            currentApy: currentApy,
            totalAllocated: 0,
            active: true,
            registeredAt: uint64(block.timestamp),
            lastUpdatedAt: uint64(block.timestamp)
        });

        poolIds.push(poolId);
        poolCount++;
        emit PoolRegistered(poolId, protocol, chain, currentApy);
    }

    function updatePool(bytes32 poolId, uint256 newApy, bool active) external onlyRole(OPTIMIZER_ROLE) {
        YieldPool storage p = pools[poolId];
        if (p.registeredAt == 0) revert PoolNotFound();
        p.currentApy = newApy;
        p.active = active;
        p.lastUpdatedAt = uint64(block.timestamp);
        emit PoolUpdated(poolId, newApy, active);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  2. POSITION MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════

    function openPosition() external payable whenNotPaused nonReentrant returns (bytes32 positionId) {
        require(msg.value > 0, "ZeroDeposit");

        uint256 fee = (msg.value * protocolFeeBps) / BPS_DENOM;
        uint256 netDeposit = msg.value - fee;

        positionId = keccak256(abi.encodePacked(CIRCUIT_ID, msg.sender, positionCount));

        positions[positionId] = Position({
            positionId: positionId,
            owner: msg.sender,
            deposited: netDeposit,
            currentValue: netDeposit,
            harvestedTotal: 0,
            pendingYield: 0,
            createdAt: uint64(block.timestamp),
            lastHarvestAt: 0
        });

        positionIds.push(positionId);
        positionCount++;
        totalDeposited += netDeposit;
        totalProtocolFees += fee;

        if (fee > 0) _forwardFee(fee);

        emit PositionOpened(CIRCUIT_ID, positionId, msg.sender, netDeposit);
    }

    function closePosition(bytes32 positionId) external nonReentrant {
        Position storage p = positions[positionId];
        if (p.createdAt == 0) revert PositionNotFound();
        require(p.owner == msg.sender, "NotOwner");

        uint256 toReturn = p.currentValue + p.pendingYield;
        require(toReturn > 0, "Nothing");

        p.currentValue = 0;
        p.pendingYield = 0;

        (bool ok, ) = payable(msg.sender).call{value: toReturn}("");
        require(ok, "PayFailed");

        emit PositionClosed(positionId, toReturn);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  3. ZK-VERIFIED REBALANCE
    // ═══════════════════════════════════════════════════════════════════════

    function rebalancePosition(
        bytes32 positionId,
        bytes32 toAllocationHash,
        uint256 yieldCaptured,
        bytes calldata proof,
        bytes calldata publicValues,
        bytes32 nullifier
    ) external onlyRole(KEEPER_ROLE) nonReentrant whenNotPaused {
        Position storage p = positions[positionId];
        if (p.createdAt == 0) revert PositionNotFound();
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

        // Apply yield
        p.pendingYield += yieldCaptured;
        p.currentValue += yieldCaptured;

        bytes32 rebalanceId = keccak256(abi.encodePacked(positionId, totalRebalances));
        bytes32 fromHash = keccak256(abi.encodePacked(positionId, "current"));

        rebalances[rebalanceId] = RebalanceRecord({
            rebalanceId: rebalanceId,
            positionId: positionId,
            fromAllocationHash: fromHash,
            toAllocationHash: toAllocationHash,
            nullifier: nullifier,
            yieldCaptured: yieldCaptured,
            timestamp: uint64(block.timestamp)
        });

        totalRebalances++;
        emit PositionRebalanced(CIRCUIT_ID, positionId, rebalanceId, toAllocationHash, yieldCaptured, nullifier);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  4. YIELD HARVEST
    // ═══════════════════════════════════════════════════════════════════════

    function harvestYield(bytes32 positionId) external nonReentrant {
        Position storage p = positions[positionId];
        if (p.createdAt == 0) revert PositionNotFound();
        require(p.owner == msg.sender, "NotOwner");
        if (p.pendingYield == 0) revert InsufficientYield();

        uint256 gross = p.pendingYield;
        uint256 fee = (gross * harvestFeeBps) / BPS_DENOM;
        uint256 net = gross - fee;

        p.pendingYield = 0;
        p.harvestedTotal += net;
        p.lastHarvestAt = uint64(block.timestamp);
        totalHarvested += net;
        totalProtocolFees += fee;

        if (fee > 0) _forwardFee(fee);

        (bool ok, ) = payable(msg.sender).call{value: net}("");
        require(ok, "PayFailed");

        emit YieldHarvested(positionId, msg.sender, net, fee);
    }

    // ─── Internal ─────────────────────────────────────────────────────────

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

    // ─── Admin ────────────────────────────────────────────────────────────

    function setProtocolFee(uint16 _bps) external onlyRole(DEFAULT_ADMIN_ROLE) { require(_bps <= MAX_FEE); protocolFeeBps = _bps; }
    function setHarvestFee(uint16 _bps) external onlyRole(DEFAULT_ADMIN_ROLE) { require(_bps <= MAX_FEE); harvestFeeBps = _bps; }
    function setRevenueSplitter(address _rs) external onlyRole(DEFAULT_ADMIN_ROLE) { revenueSplitter = _rs; }
    function setZKVerifier(address _zk) external onlyRole(DEFAULT_ADMIN_ROLE) { zkVerifier = _zk; }
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ─── Views ────────────────────────────────────────────────────────────

    function getPool(bytes32 id) external view returns (YieldPool memory) { return pools[id]; }
    function getPosition(bytes32 id) external view returns (Position memory) { return positions[id]; }
    function getRebalance(bytes32 id) external view returns (RebalanceRecord memory) { return rebalances[id]; }

    function getStats() external view returns (
        uint256 pools_, uint256 positions_, uint256 deposited_,
        uint256 harvested_, uint256 fees_, uint256 rebalances_
    ) {
        return (poolCount, positionCount, totalDeposited, totalHarvested, totalProtocolFees, totalRebalances);
    }

    receive() external payable {}
}
