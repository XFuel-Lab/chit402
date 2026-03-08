// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title WirelessDePIN
 * @author XFuel Protocol -- Expansion Circuit #15
 * @notice Decentralized Wireless Infrastructure: ZK-verified coverage proofs,
 *         hotspot management, data credit settlement, and coverage incentives.
 *
 * Architecture (inspired by Helium + XNET + Wayru, generalized):
 *   1. Hotspot Registration  -- Wireless nodes register with type, location, antenna specs.
 *   2. Coverage Proof        -- ZK-verified Proof-of-Coverage (beacon/witness/challenge).
 *   3. Data Transfer         -- Track data credits burned for IoT/5G data transfer.
 *   4. Coverage Rewards      -- Hotspots earn based on coverage validity and data transfer.
 *   5. Coverage Map          -- On-chain hex-based coverage tracking for network health.
 *
 * Research ties:
 *   - Helium (helium.com): LoRaWAN + 5G DePIN; HNT burn-and-mint; Proof-of-Coverage;
 *     900K+ hotspots; Data Credits for IoT data transfer; Solana-based.
 *   - XNET (xnet.company): Decentralized 5G/LTE; CBRS spectrum; carrier offload;
 *     enterprise connectivity; neutral-host small cells.
 *   - Wayru (wayru.io): Community WiFi hotspots; WRU token; coverage in LATAM;
 *     bandwidth sharing for underserved areas.
 *
 *   For XFuel integration:
 *   - EVM anchor for hotspot fleet; actual RF data stays off-chain.
 *   - SP1 proves: "Hotspot H provided coverage at hex X with RSSI/SNR Y at time T"
 *     without revealing proprietary antenna configs or exact GPS.
 *   - Fees flow to CoreRevenueSplitter (0.5% protocol fee on data credit settlement).
 *   - Fully isolated: own hotspot registry, coverage state, data credit tracking.
 *
 * Core Layer integration:
 *   - Emits CoverageProven / DataTransferred for ai-listener.js coordination.
 *   - Sends protocol fees to CoreRevenueSplitter via depositFee(CIRCUIT_ID).
 *   - Uses ZKVerifierSP1 for coverage proof verification.
 */
contract WirelessDePIN is AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant CIRCUIT_ID = keccak256("WIRELESS_DEPIN_CIRCUIT");

    address public revenueSplitter;
    address public zkVerifier;

    uint16 public protocolFeeBps = 50;
    uint16 public constant MAX_FEE = 200;
    uint16 public constant BPS_DENOM = 10000;

    // --- Hotspot Registry ---
    enum HotspotType { LoRaWAN, FiveG, WiFi, CBRS, Generic }

    struct Hotspot {
        bytes32 hotspotId;
        address owner;
        HotspotType hotspotType;
        bytes32 locationHex;        // H3 hex or keccak256(lat,lon,resolution)
        bytes32 antennaHash;        // hash of antenna specs (gain, height, type)
        uint256 totalCoverageProofs;
        uint256 totalDataCredits;   // data credits facilitated
        uint256 totalEarned;
        uint256 rewardScale;        // 0-10000 (reward scaling based on density)
        bool    active;
        uint64  registeredAt;
    }

    mapping(bytes32 => Hotspot) public hotspots;
    uint256 public hotspotCount;

    // --- Coverage Proofs ---
    struct CoverageProof {
        bytes32 proofId;
        bytes32 hotspotId;
        bytes32 challengerHex;     // challenger location hex
        int16   rssi;              // signal strength (dBm, scaled x10)
        int16   snr;               // signal-to-noise (dB, scaled x10)
        uint256 witnessCount;      // number of witnesses
        bytes32 proofNullifier;
        uint64  provenAt;
    }

    mapping(bytes32 => CoverageProof) public coverageProofs;
    uint256 public coverageProofCount;
    mapping(bytes32 => bool) public usedNullifiers;

    // --- Data Credits ---
    struct DataTransfer {
        bytes32 transferId;
        bytes32 hotspotId;
        uint256 dataBytes;         // bytes transferred
        uint256 creditsBurned;     // data credits consumed
        uint256 paymentAmount;     // payment for data transfer
        address payer;
        uint64  transferredAt;
    }

    mapping(bytes32 => DataTransfer) public dataTransfers;
    uint256 public transferCount;

    // --- Coverage Map ---
    mapping(bytes32 => uint256) public hexCoverage;  // hex => proof count

    // --- Metrics ---
    uint256 public totalDataTransferred;  // total bytes
    uint256 public totalCreditsUsed;
    uint256 public totalVolume;
    uint256 public totalFeesCollected;

    // --- Events ---
    event HotspotRegistered(bytes32 indexed hotspotId, address indexed owner, HotspotType hotspotType);
    event HotspotUpdated(bytes32 indexed hotspotId, bool active, uint256 rewardScale);
    event CoverageProven(bytes32 indexed circuitId, bytes32 indexed hotspotId, bytes32 proofId, int16 rssi, bytes32 nullifier);
    event DataTransferred(bytes32 indexed circuitId, bytes32 indexed hotspotId, bytes32 transferId, uint256 dataBytes, uint256 payment);
    event HexCoverageUpdated(bytes32 indexed locationHex, uint256 proofCount);

    error HotspotNotFound();
    error HotspotNotActive();
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
    //  1. HOTSPOT MANAGEMENT
    // =================================================================

    function registerHotspot(
        HotspotType hotspotType,
        bytes32 locationHex,
        bytes32 antennaHash
    ) external whenNotPaused returns (bytes32 hotspotId) {
        require(locationHex != bytes32(0), "ZeroHex");
        require(antennaHash != bytes32(0), "ZeroAntenna");

        hotspotId = keccak256(abi.encodePacked(CIRCUIT_ID, msg.sender, hotspotCount));

        hotspots[hotspotId] = Hotspot({
            hotspotId: hotspotId,
            owner: msg.sender,
            hotspotType: hotspotType,
            locationHex: locationHex,
            antennaHash: antennaHash,
            totalCoverageProofs: 0,
            totalDataCredits: 0,
            totalEarned: 0,
            rewardScale: 10000,  // full rewards by default
            active: true,
            registeredAt: uint64(block.timestamp)
        });

        hotspotCount++;
        emit HotspotRegistered(hotspotId, msg.sender, hotspotType);
    }

    function updateHotspot(bytes32 hotspotId, bool active, uint256 rewardScale) external {
        Hotspot storage h = hotspots[hotspotId];
        if (h.registeredAt == 0) revert HotspotNotFound();
        require(msg.sender == h.owner || hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "NotAuth");
        require(rewardScale <= 10000, "BadScale");
        h.active = active;
        h.rewardScale = rewardScale;
        emit HotspotUpdated(hotspotId, active, rewardScale);
    }

    // =================================================================
    //  2. ZK-VERIFIED COVERAGE PROOF
    // =================================================================

    function submitCoverageProof(
        bytes32 hotspotId,
        bytes32 challengerHex,
        int16 rssi,
        int16 snr,
        uint256 witnessCount,
        bytes calldata proof,
        bytes calldata publicValues,
        bytes32 nullifier
    ) external onlyRole(OPERATOR_ROLE) nonReentrant whenNotPaused {
        Hotspot storage h = hotspots[hotspotId];
        if (h.registeredAt == 0) revert HotspotNotFound();
        if (!h.active) revert HotspotNotActive();
        if (usedNullifiers[nullifier]) revert NullifierUsed();

        usedNullifiers[nullifier] = true;

        // ZK verification of coverage
        if (zkVerifier != address(0)) {
            (bool ok, ) = zkVerifier.call(
                abi.encodeWithSignature(
                    "verifyProof(bytes32,bytes,bytes,bytes32)",
                    CIRCUIT_ID, publicValues, proof, nullifier
                )
            );
            require(ok, "ProofFailed");
        }

        bytes32 proofId = keccak256(abi.encodePacked(CIRCUIT_ID, hotspotId, coverageProofCount));

        coverageProofs[proofId] = CoverageProof({
            proofId: proofId,
            hotspotId: hotspotId,
            challengerHex: challengerHex,
            rssi: rssi,
            snr: snr,
            witnessCount: witnessCount,
            proofNullifier: nullifier,
            provenAt: uint64(block.timestamp)
        });

        coverageProofCount++;
        h.totalCoverageProofs++;

        // Update hex coverage map
        hexCoverage[h.locationHex]++;
        emit HexCoverageUpdated(h.locationHex, hexCoverage[h.locationHex]);

        emit CoverageProven(CIRCUIT_ID, hotspotId, proofId, rssi, nullifier);
    }

    // =================================================================
    //  3. DATA CREDIT SETTLEMENT
    // =================================================================

    function settleDataTransfer(
        bytes32 hotspotId,
        uint256 dataBytes,
        uint256 creditsBurned
    ) external payable nonReentrant whenNotPaused {
        Hotspot storage h = hotspots[hotspotId];
        if (h.registeredAt == 0) revert HotspotNotFound();
        if (!h.active) revert HotspotNotActive();
        require(dataBytes > 0, "ZeroData");
        require(msg.value > 0, "ZeroPayment");

        uint256 fee = (msg.value * protocolFeeBps) / BPS_DENOM;
        uint256 hotspotPayment = msg.value - fee;

        bytes32 transferId = keccak256(abi.encodePacked(CIRCUIT_ID, hotspotId, transferCount));

        dataTransfers[transferId] = DataTransfer({
            transferId: transferId,
            hotspotId: hotspotId,
            dataBytes: dataBytes,
            creditsBurned: creditsBurned,
            paymentAmount: msg.value,
            payer: msg.sender,
            transferredAt: uint64(block.timestamp)
        });

        transferCount++;
        h.totalDataCredits += creditsBurned;
        h.totalEarned += hotspotPayment;

        totalDataTransferred += dataBytes;
        totalCreditsUsed += creditsBurned;
        totalVolume += msg.value;
        totalFeesCollected += fee;

        // Forward protocol fee
        if (fee > 0) _forwardFee(fee);

        // Pay hotspot owner
        (bool ok, ) = payable(h.owner).call{value: hotspotPayment}("");
        require(ok, "PayFailed");

        emit DataTransferred(CIRCUIT_ID, hotspotId, transferId, dataBytes, msg.value);
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

    function getHotspot(bytes32 id) external view returns (Hotspot memory) { return hotspots[id]; }
    function getCoverageProof(bytes32 id) external view returns (CoverageProof memory) { return coverageProofs[id]; }
    function getDataTransfer(bytes32 id) external view returns (DataTransfer memory) { return dataTransfers[id]; }

    function getStats() external view returns (
        uint256 hotspots_, uint256 proofs_, uint256 transfers_,
        uint256 dataBytes_, uint256 credits_, uint256 volume_, uint256 fees_
    ) {
        return (hotspotCount, coverageProofCount, transferCount,
                totalDataTransferred, totalCreditsUsed, totalVolume, totalFeesCollected);
    }

    receive() external payable {}
}
