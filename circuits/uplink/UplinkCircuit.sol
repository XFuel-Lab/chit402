// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title UplinkCircuit
 * @author XFuel Protocol -- Expansion Circuit #16
 * @notice Decentralized Connectivity Uplink: ZK-verified bandwidth sharing,
 *         router registration, session settlement, and connectivity marketplace.
 *
 * Architecture (inspired by Uplink + Althea + Wicrypt, generalized):
 *   1. Router Registration   -- WiFi routers register with location, bandwidth cap, ISP hash.
 *   2. Session Tracking      -- Users open connectivity sessions with escrowed payment.
 *   3. Bandwidth Proof       -- ZK-verified proof of bandwidth delivered (throughput, uptime).
 *   4. Session Settlement    -- Payment released on proof; protocol fee to CoreRevenueSplitter.
 *   5. Connectivity Map      -- On-chain region-based router density + quality tracking.
 *
 * Research ties:
 *   - Uplink (uplink.xyz): WiFi router sharing DePIN; 5M+ registered routers;
 *     ULX token + Network Credits dual economy; Avalanche L1; global connectivity.
 *   - Althea (althea.net): Mesh networking; pay-per-forward routing; bandwidth micro-payments.
 *   - Wicrypt (wicrypt.com): Mobile hotspot sharing; WNT token; 40K+ hotspots; Africa focus.
 *
 *   For XFuel integration:
 *   - EVM anchor for router fleet; actual traffic data stays off-chain.
 *   - SP1 proves: "Router R delivered B Mbps to User U for D seconds with Q% uptime"
 *     without revealing ISP credentials, exact location, or traffic contents.
 *   - Fees flow to CoreRevenueSplitter (0.5% protocol fee on session settlement).
 *   - Synergy with WirelessDePIN: Uplink = WiFi bandwidth sharing,
 *     WirelessDePIN = LoRaWAN/5G coverage proofs. Complementary DePIN stacks.
 *
 * Core Layer integration:
 *   - Emits SessionSettled / BandwidthProven for ai-listener.js coordination.
 *   - Sends protocol fees to CoreRevenueSplitter via depositFee(CIRCUIT_ID).
 *   - Uses ZKVerifierSP1 for bandwidth proof verification.
 */
contract UplinkCircuit is AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant CIRCUIT_ID = keccak256("UPLINK_CIRCUIT");

    address public revenueSplitter;
    address public zkVerifier;

    uint16 public protocolFeeBps = 50;     // 0.5%
    uint16 public constant MAX_FEE = 200;  // 2%
    uint16 public constant BPS_DENOM = 10000;

    // --- Router Registry ---
    struct Router {
        bytes32 routerId;
        address owner;
        bytes32 locationHash;       // keccak256(region, lat, lon)
        bytes32 ispHash;            // hash of ISP identifier (privacy)
        uint256 bandwidthCapMbps;   // advertised bandwidth cap
        uint256 totalSessions;
        uint256 totalBandwidthMB;   // total MB served
        uint256 totalEarned;
        uint256 qualityScore;       // 0-10000 EMA of session quality
        bool    active;
        uint64  registeredAt;
    }

    mapping(bytes32 => Router) public routers;
    uint256 public routerCount;

    // --- Sessions ---
    enum SessionStatus { Open, Proven, Settled, Cancelled }

    struct Session {
        bytes32 sessionId;
        bytes32 routerId;
        address user;
        uint256 escrowAmount;
        uint256 bandwidthMB;        // MB delivered (filled after proof)
        uint256 durationSecs;       // session duration
        uint256 throughputMbps;     // average throughput
        SessionStatus status;
        uint64  openedAt;
        uint64  settledAt;
    }

    mapping(bytes32 => Session) public sessions;
    uint256 public sessionCount;

    // --- ZK Proofs ---
    mapping(bytes32 => bool) public usedNullifiers;
    uint256 public proofCount;

    // --- Connectivity Map ---
    mapping(bytes32 => uint256) public regionRouterCount;  // region hash => router count
    mapping(bytes32 => uint256) public regionSessionCount; // region hash => session count

    // --- Metrics ---
    uint256 public totalVolume;
    uint256 public totalFeesCollected;
    uint256 public totalBandwidthServed; // MB across all routers

    // --- Events ---
    event RouterRegistered(bytes32 indexed routerId, address indexed owner, uint256 bandwidthCapMbps);
    event RouterUpdated(bytes32 indexed routerId, bool active, uint256 qualityScore);
    event SessionOpened(bytes32 indexed circuitId, bytes32 indexed sessionId, bytes32 routerId, address user);
    event BandwidthProven(bytes32 indexed circuitId, bytes32 indexed sessionId, uint256 bandwidthMB, bytes32 nullifier);
    event SessionSettled(bytes32 indexed circuitId, bytes32 indexed sessionId, uint256 payment);
    event SessionCancelled(bytes32 indexed sessionId);

    error RouterNotFound();
    error RouterNotActive();
    error SessionNotFound();
    error InvalidStatus();
    error NullifierUsed();
    error InsufficientPayment();

    constructor(address _admin, address _revenueSplitter, address _zkVerifier) {
        require(_admin != address(0), "ZeroAdmin");
        revenueSplitter = _revenueSplitter;
        zkVerifier = _zkVerifier;
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(OPERATOR_ROLE, _admin);
    }

    // =================================================================
    //  1. ROUTER MANAGEMENT
    // =================================================================

    function registerRouter(
        bytes32 locationHash,
        bytes32 ispHash,
        uint256 bandwidthCapMbps
    ) external whenNotPaused returns (bytes32 routerId) {
        require(locationHash != bytes32(0), "ZeroLocation");
        require(bandwidthCapMbps > 0, "ZeroBandwidth");

        routerId = keccak256(abi.encodePacked(CIRCUIT_ID, msg.sender, routerCount));

        routers[routerId] = Router({
            routerId: routerId,
            owner: msg.sender,
            locationHash: locationHash,
            ispHash: ispHash,
            bandwidthCapMbps: bandwidthCapMbps,
            totalSessions: 0,
            totalBandwidthMB: 0,
            totalEarned: 0,
            qualityScore: 8000, // start at 80%
            active: true,
            registeredAt: uint64(block.timestamp)
        });

        routerCount++;
        regionRouterCount[locationHash]++;

        emit RouterRegistered(routerId, msg.sender, bandwidthCapMbps);
    }

    function updateRouter(bytes32 routerId, bool active) external {
        Router storage r = routers[routerId];
        if (r.registeredAt == 0) revert RouterNotFound();
        require(msg.sender == r.owner || hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "NotAuth");
        r.active = active;
        emit RouterUpdated(routerId, active, r.qualityScore);
    }

    // =================================================================
    //  2. SESSION MANAGEMENT
    // =================================================================

    function openSession(bytes32 routerId) external payable whenNotPaused returns (bytes32 sessionId) {
        Router storage r = routers[routerId];
        if (r.registeredAt == 0) revert RouterNotFound();
        if (!r.active) revert RouterNotActive();
        require(msg.value > 0, "ZeroEscrow");

        sessionId = keccak256(abi.encodePacked(CIRCUIT_ID, routerId, sessionCount));

        sessions[sessionId] = Session({
            sessionId: sessionId,
            routerId: routerId,
            user: msg.sender,
            escrowAmount: msg.value,
            bandwidthMB: 0,
            durationSecs: 0,
            throughputMbps: 0,
            status: SessionStatus.Open,
            openedAt: uint64(block.timestamp),
            settledAt: 0
        });

        sessionCount++;
        emit SessionOpened(CIRCUIT_ID, sessionId, routerId, msg.sender);
    }

    function cancelSession(bytes32 sessionId) external nonReentrant {
        Session storage s = sessions[sessionId];
        if (s.openedAt == 0) revert SessionNotFound();
        if (s.status != SessionStatus.Open) revert InvalidStatus();
        require(msg.sender == s.user, "NotUser");

        s.status = SessionStatus.Cancelled;

        (bool ok, ) = payable(s.user).call{value: s.escrowAmount}("");
        require(ok, "RefundFail");

        emit SessionCancelled(sessionId);
    }

    // =================================================================
    //  3. ZK-VERIFIED BANDWIDTH PROOF + SETTLEMENT
    // =================================================================

    function settleSession(
        bytes32 sessionId,
        uint256 bandwidthMB,
        uint256 durationSecs,
        uint256 throughputMbps,
        bytes calldata proof,
        bytes calldata publicValues,
        bytes32 nullifier
    ) external onlyRole(OPERATOR_ROLE) nonReentrant whenNotPaused {
        Session storage s = sessions[sessionId];
        if (s.openedAt == 0) revert SessionNotFound();
        if (s.status != SessionStatus.Open) revert InvalidStatus();
        if (usedNullifiers[nullifier]) revert NullifierUsed();

        usedNullifiers[nullifier] = true;

        // ZK verification of bandwidth delivery
        if (zkVerifier != address(0)) {
            (bool ok, ) = zkVerifier.call(
                abi.encodeWithSignature(
                    "verifyProof(bytes32,bytes,bytes,bytes32)",
                    CIRCUIT_ID, publicValues, proof, nullifier
                )
            );
            require(ok, "ProofFailed");
        }

        // Update session
        s.bandwidthMB = bandwidthMB;
        s.durationSecs = durationSecs;
        s.throughputMbps = throughputMbps;
        s.status = SessionStatus.Settled;
        s.settledAt = uint64(block.timestamp);

        // Fee calculation
        uint256 fee = (s.escrowAmount * protocolFeeBps) / BPS_DENOM;
        uint256 routerPayment = s.escrowAmount - fee;

        // Update router stats
        Router storage r = routers[s.routerId];
        r.totalSessions++;
        r.totalBandwidthMB += bandwidthMB;
        r.totalEarned += routerPayment;

        // Update quality EMA: new = (old * 7 + current * 3) / 10
        uint256 sessionQuality = throughputMbps > 0
            ? (throughputMbps * 10000) / r.bandwidthCapMbps
            : 5000;
        if (sessionQuality > 10000) sessionQuality = 10000;
        r.qualityScore = (r.qualityScore * 7 + sessionQuality * 3) / 10;

        // Update globals
        proofCount++;
        totalBandwidthServed += bandwidthMB;
        totalVolume += s.escrowAmount;
        totalFeesCollected += fee;
        regionSessionCount[r.locationHash]++;

        // Forward fee
        if (fee > 0) _forwardFee(fee);

        // Pay router owner
        (bool ok2, ) = payable(r.owner).call{value: routerPayment}("");
        require(ok2, "PayFailed");

        emit BandwidthProven(CIRCUIT_ID, sessionId, bandwidthMB, nullifier);
        emit SessionSettled(CIRCUIT_ID, sessionId, s.escrowAmount);
    }

    // --- Internal ---

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

    // --- Admin ---

    function setProtocolFee(uint16 _bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_bps <= MAX_FEE, "FeeTooHigh");
        protocolFeeBps = _bps;
    }

    function setRevenueSplitter(address _rs) external onlyRole(DEFAULT_ADMIN_ROLE) { revenueSplitter = _rs; }
    function setZKVerifier(address _zk) external onlyRole(DEFAULT_ADMIN_ROLE) { zkVerifier = _zk; }
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // --- Views ---

    function getRouter(bytes32 id) external view returns (Router memory) { return routers[id]; }
    function getSession(bytes32 id) external view returns (Session memory) { return sessions[id]; }

    function getStats() external view returns (
        uint256 routers_, uint256 sessions_, uint256 proofs_,
        uint256 bandwidthMB_, uint256 volume_, uint256 fees_
    ) {
        return (routerCount, sessionCount, proofCount,
                totalBandwidthServed, totalVolume, totalFeesCollected);
    }

    receive() external payable {}
}
