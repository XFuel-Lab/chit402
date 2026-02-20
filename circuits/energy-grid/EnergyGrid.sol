// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title EnergyGrid
 * @author XFuel Protocol — Expansion Circuit #13
 * @notice Decentralized Energy Grid: ZK-verified energy production attestation,
 *         peer-to-peer energy trading, and DePIN node settlement.
 *
 * Architecture (inspired by Daylight + Glow + dClimate, generalized):
 *   1. Node Registration  — DER (solar/battery/EV) nodes register with capacity and location.
 *   2. Energy Attestation — Nodes submit ZK-proven energy production data (kWh metered).
 *   3. Grid Settlement    — P2P energy trades settled on-chain with protocol fees.
 *   4. Carbon Credits     — Verified green energy earns tokenized carbon offsets.
 *   5. VPP Coordination   — Virtual Power Plant aggregation for grid services.
 *
 * Research ties:
 *   - Daylight (godaylight.com, 2026): $75M raised; solar+battery DePIN; GRID token
 *     for tokenized energy yield; 45% cheaper electricity; zero-upfront-cost installs.
 *   - Glow (glowlabs.org): Solar farm DePIN on Ethereum; Proof-of-Physical-Work;
 *     GCC (Glow Carbon Credits) for verified green energy production.
 *   - dClimate (dclimate.net): Decentralized climate data marketplace; oracle feeds
 *     for energy production/consumption; carbon offset verification.
 *
 *   For XFuel integration:
 *   - EVM anchor for DER fleet management; actual metering data stays off-chain.
 *   - SP1 proves: "Node N produced E kWh between T1 and T2 with meter hash M"
 *     without revealing proprietary grid topology or customer data.
 *   - Fees flow to CoreRevenueSplitter (0.5% protocol fee on energy trades).
 *   - Fully isolated: own node registry, attestation state, trade settlement.
 *
 * Core Layer integration:
 *   - Emits EnergyAttested / TradeSettled for ai-listener.js coordination.
 *   - Sends protocol fees to CoreRevenueSplitter via depositFee(CIRCUIT_ID).
 *   - Uses ZKVerifierSP1 for energy production proof verification.
 */
contract EnergyGrid is AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant CIRCUIT_ID = keccak256("ENERGY_GRID_CIRCUIT");

    address public revenueSplitter;
    address public zkVerifier;

    uint16 public protocolFeeBps = 50;        // 0.5% protocol fee on trades
    uint16 public constant MAX_FEE = 200;     // 2% max
    uint16 public constant BPS_DENOM = 10000;

    // ─── DER Node Registry ──────────────────────────────────────────────
    enum NodeType { Solar, Battery, EV, Wind, Hybrid }

    struct EnergyNode {
        bytes32 nodeId;
        address owner;
        NodeType nodeType;
        bytes32 locationHash;         // keccak256(lat, lon, grid_zone)
        uint256 capacityWatts;        // Peak capacity in watts
        uint256 totalKwhAttested;     // Lifetime kWh attested
        uint256 totalEarned;
        uint256 reputation;           // 0-10000
        bool    active;
        uint64  registeredAt;
    }

    mapping(bytes32 => EnergyNode) public nodes;
    uint256 public nodeCount;

    // ─── Energy Attestations ────────────────────────────────────────────
    struct Attestation {
        bytes32 attestId;
        bytes32 nodeId;
        uint256 kwhProduced;          // Energy produced in this period (scaled 1e3)
        uint256 periodStart;          // Unix timestamp
        uint256 periodEnd;
        bytes32 meterHash;            // Hash of raw meter readings
        bytes32 proofNullifier;
        uint64  attestedAt;
    }

    mapping(bytes32 => Attestation) public attestations;
    uint256 public attestationCount;
    mapping(bytes32 => bool) public usedNullifiers;

    // ─── Energy Trades ──────────────────────────────────────────────────
    enum TradeStatus { Open, Matched, Settled, Cancelled }

    struct EnergyTrade {
        bytes32 tradeId;
        bytes32 sellerNodeId;
        address buyer;
        uint256 kwhAmount;            // kWh to be traded (scaled 1e3)
        uint256 pricePerKwh;          // wei per kWh
        uint256 totalPayment;
        TradeStatus status;
        uint64  createdAt;
        uint64  settledAt;
    }

    mapping(bytes32 => EnergyTrade) public trades;
    uint256 public tradeCount;

    // ─── Carbon Credits ─────────────────────────────────────────────────
    uint256 public totalCarbonCredits;  // Accumulated credits (1 credit = 1 MWh green energy)
    mapping(address => uint256) public carbonBalance;

    // ─── Metrics ────────────────────────────────────────────────────────
    uint256 public totalKwhTraded;
    uint256 public totalVolume;
    uint256 public totalFeesCollected;

    // ─── Events ─────────────────────────────────────────────────────────
    event NodeRegistered(bytes32 indexed nodeId, address indexed owner, NodeType nodeType, uint256 capacityWatts);
    event NodeUpdated(bytes32 indexed nodeId, uint256 capacity, bool active);
    event EnergyAttested(bytes32 indexed circuitId, bytes32 indexed nodeId, bytes32 attestId, uint256 kwhProduced, bytes32 nullifier);
    event TradeCreated(bytes32 indexed circuitId, bytes32 indexed tradeId, bytes32 sellerNodeId, uint256 kwhAmount, uint256 pricePerKwh);
    event TradeSettled(bytes32 indexed tradeId, address indexed buyer, uint256 payment, uint256 fee);
    event TradeCancelled(bytes32 indexed tradeId, uint256 refunded);
    event CarbonCredited(address indexed owner, uint256 credits);

    error NodeNotFound();
    error NodeNotActive();
    error TradeNotFound();
    error InvalidTradeStatus();
    error NullifierUsed();
    error InsufficientPayment();
    error NotTradeParty();

    constructor(address _admin, address _revenueSplitter, address _zkVerifier) {
        require(_admin != address(0), "ZeroAdmin");
        revenueSplitter = _revenueSplitter;
        zkVerifier = _zkVerifier;
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(OPERATOR_ROLE, _admin);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  1. NODE MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════

    function registerNode(
        NodeType nodeType,
        bytes32 locationHash,
        uint256 capacityWatts
    ) external whenNotPaused returns (bytes32 nodeId) {
        require(locationHash != bytes32(0), "ZeroLocation");
        require(capacityWatts > 0, "ZeroCap");

        nodeId = keccak256(abi.encodePacked(CIRCUIT_ID, msg.sender, nodeCount));

        nodes[nodeId] = EnergyNode({
            nodeId: nodeId,
            owner: msg.sender,
            nodeType: nodeType,
            locationHash: locationHash,
            capacityWatts: capacityWatts,
            totalKwhAttested: 0,
            totalEarned: 0,
            reputation: 5000,
            active: true,
            registeredAt: uint64(block.timestamp)
        });

        nodeCount++;
        emit NodeRegistered(nodeId, msg.sender, nodeType, capacityWatts);
    }

    function updateNode(bytes32 nodeId, uint256 newCapacity, bool active) external {
        EnergyNode storage n = nodes[nodeId];
        if (n.registeredAt == 0) revert NodeNotFound();
        require(msg.sender == n.owner || hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "NotAuth");
        n.capacityWatts = newCapacity;
        n.active = active;
        emit NodeUpdated(nodeId, newCapacity, active);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  2. ZK-VERIFIED ENERGY ATTESTATION
    // ═══════════════════════════════════════════════════════════════════

    function attestEnergy(
        bytes32 nodeId,
        uint256 kwhProduced,
        uint256 periodStart,
        uint256 periodEnd,
        bytes32 meterHash,
        bytes calldata proof,
        bytes calldata publicValues,
        bytes32 nullifier
    ) external onlyRole(OPERATOR_ROLE) nonReentrant whenNotPaused {
        EnergyNode storage n = nodes[nodeId];
        if (n.registeredAt == 0) revert NodeNotFound();
        if (!n.active) revert NodeNotActive();
        if (usedNullifiers[nullifier]) revert NullifierUsed();
        require(periodEnd > periodStart, "BadPeriod");
        require(kwhProduced > 0, "ZeroKwh");

        usedNullifiers[nullifier] = true;

        // ZK verification of metered production
        if (zkVerifier != address(0)) {
            (bool ok, ) = zkVerifier.call(
                abi.encodeWithSignature(
                    "verifyProof(bytes32,bytes,bytes,bytes32)",
                    CIRCUIT_ID, publicValues, proof, nullifier
                )
            );
            require(ok, "ProofFailed");
        }

        bytes32 attestId = keccak256(abi.encodePacked(
            CIRCUIT_ID, nodeId, attestationCount
        ));

        attestations[attestId] = Attestation({
            attestId: attestId,
            nodeId: nodeId,
            kwhProduced: kwhProduced,
            periodStart: periodStart,
            periodEnd: periodEnd,
            meterHash: meterHash,
            proofNullifier: nullifier,
            attestedAt: uint64(block.timestamp)
        });

        attestationCount++;
        n.totalKwhAttested += kwhProduced;

        // Reputation boost for consistent attestation
        if (n.reputation < 9900) n.reputation += 100;

        // Issue carbon credits: 1 credit per MWh (1000 kWh)
        uint256 credits = kwhProduced / 1000;
        if (credits > 0) {
            carbonBalance[n.owner] += credits;
            totalCarbonCredits += credits;
            emit CarbonCredited(n.owner, credits);
        }

        emit EnergyAttested(CIRCUIT_ID, nodeId, attestId, kwhProduced, nullifier);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  3. P2P ENERGY TRADING
    // ═══════════════════════════════════════════════════════════════════

    function createTrade(
        bytes32 sellerNodeId,
        uint256 kwhAmount,
        uint256 pricePerKwh
    ) external whenNotPaused returns (bytes32 tradeId) {
        EnergyNode storage n = nodes[sellerNodeId];
        if (n.registeredAt == 0) revert NodeNotFound();
        require(msg.sender == n.owner, "NotOwner");
        require(kwhAmount > 0, "ZeroKwh");

        tradeId = keccak256(abi.encodePacked(CIRCUIT_ID, msg.sender, tradeCount));

        trades[tradeId] = EnergyTrade({
            tradeId: tradeId,
            sellerNodeId: sellerNodeId,
            buyer: address(0),
            kwhAmount: kwhAmount,
            pricePerKwh: pricePerKwh,
            totalPayment: 0,
            status: TradeStatus.Open,
            createdAt: uint64(block.timestamp),
            settledAt: 0
        });

        tradeCount++;
        emit TradeCreated(CIRCUIT_ID, tradeId, sellerNodeId, kwhAmount, pricePerKwh);
    }

    function buyTrade(bytes32 tradeId) external payable nonReentrant whenNotPaused {
        EnergyTrade storage t = trades[tradeId];
        if (t.createdAt == 0) revert TradeNotFound();
        if (t.status != TradeStatus.Open) revert InvalidTradeStatus();

        uint256 totalCost = t.kwhAmount * t.pricePerKwh;
        if (msg.value < totalCost) revert InsufficientPayment();

        uint256 fee = (msg.value * protocolFeeBps) / BPS_DENOM;
        uint256 sellerPayment = msg.value - fee;

        t.buyer = msg.sender;
        t.totalPayment = msg.value;
        t.status = TradeStatus.Settled;
        t.settledAt = uint64(block.timestamp);

        EnergyNode storage n = nodes[t.sellerNodeId];
        n.totalEarned += sellerPayment;
        totalKwhTraded += t.kwhAmount;
        totalVolume += msg.value;
        totalFeesCollected += fee;

        // Forward protocol fee
        if (fee > 0) _forwardFee(fee);

        // Pay seller
        (bool ok, ) = payable(n.owner).call{value: sellerPayment}("");
        require(ok, "PayFailed");

        emit TradeSettled(tradeId, msg.sender, sellerPayment, fee);
    }

    function cancelTrade(bytes32 tradeId) external {
        EnergyTrade storage t = trades[tradeId];
        if (t.createdAt == 0) revert TradeNotFound();
        EnergyNode storage n = nodes[t.sellerNodeId];
        require(msg.sender == n.owner, "NotOwner");
        require(t.status == TradeStatus.Open, "OnlyOpen");

        t.status = TradeStatus.Cancelled;
        emit TradeCancelled(tradeId, 0);
    }

    // ─── Internal ───────────────────────────────────────────────────────

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

    // ─── Admin ──────────────────────────────────────────────────────────

    function setProtocolFee(uint16 _bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_bps <= MAX_FEE, "FeeTooHigh");
        protocolFeeBps = _bps;
    }

    function setRevenueSplitter(address _rs) external onlyRole(DEFAULT_ADMIN_ROLE) { revenueSplitter = _rs; }
    function setZKVerifier(address _zk) external onlyRole(DEFAULT_ADMIN_ROLE) { zkVerifier = _zk; }
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ─── Views ──────────────────────────────────────────────────────────

    function getNode(bytes32 id) external view returns (EnergyNode memory) { return nodes[id]; }
    function getAttestation(bytes32 id) external view returns (Attestation memory) { return attestations[id]; }
    function getTrade(bytes32 id) external view returns (EnergyTrade memory) { return trades[id]; }

    function getStats() external view returns (
        uint256 nodes_, uint256 attestations_, uint256 trades_,
        uint256 kwhTraded_, uint256 volume_, uint256 fees_, uint256 carbonCredits_
    ) {
        return (nodeCount, attestationCount, tradeCount,
                totalKwhTraded, totalVolume, totalFeesCollected, totalCarbonCredits);
    }

    receive() external payable {}
}
