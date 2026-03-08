// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title FilecoinStorage
 * @author XFuel Protocol — Expansion Circuit #12
 * @notice Decentralized Storage Deals: ZK-verified Filecoin storage proofs,
 *         deal brokering, and retrieval settlement with SP1 attestation.
 *
 * Architecture (inspired by Filecoin + Lighthouse + Storacha, generalized):
 *   1. Storage Provider Registration — Miners register with capacity and location.
 *   2. Deal Submission — Clients submit storage deals with CID, size, duration, payment.
 *   3. Deal Matching — Relayer matches deals to providers (off-chain, ZK-provable).
 *   4. Proof of Storage — SP1-verified WindowPoSt/SnapDeal proofs confirm storage.
 *   5. Settlement — Periodic settlement releases escrowed payments to providers.
 *   6. Retrieval — Clients retrieve data; retrieval fees settled on-chain.
 *
 * Research ties:
 *   - Filecoin (filecoin.io): Decentralized storage with cryptographic proofs
 *     (Proof-of-Replication, Proof-of-Spacetime). 3,800+ active SPs, 20 EiB capacity.
 *   - Lighthouse (lighthouse.storage): Perpetual storage on Filecoin/IPFS,
 *     encryption, access control, pay-once-store-forever model.
 *   - Storacha (storacha.network): Content-addressed data pipelines,
 *     UCAN-based authorization, decentralized hot storage layer.
 *
 *   For XFuel integration:
 *   - EVM anchor for Filecoin deals; actual storage on Filecoin network.
 *   - SP1 proves: "Provider P stored CID C for duration D with proof P"
 *     without running a full Filecoin node on EVM.
 *   - Fees flow to CoreRevenueSplitter (0.5% protocol fee on deal value).
 *   - Fully isolated: own provider registry, deal state, proof tracking.
 *
 * Core Layer integration:
 *   - Emits DealCreated / StorageProofVerified for ai-listener.js coordination.
 *   - Sends protocol fees to CoreRevenueSplitter via depositFee(CIRCUIT_ID).
 *   - Uses ZKVerifierSP1 for storage proof verification.
 */
contract FilecoinStorage is AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant CIRCUIT_ID = keccak256("FILECOIN_STORAGE_CIRCUIT");

    address public revenueSplitter;
    address public zkVerifier;

    uint16 public protocolFeeBps = 50;        // 0.5% protocol fee on deal value
    uint16 public constant MAX_FEE = 200;     // 2% max
    uint16 public constant BPS_DENOM = 10000;

    // ─── Storage Provider Registry ──────────────────────────────────────
    enum ProviderTier { Standard, Verified, Enterprise }

    struct StorageProvider {
        bytes32 providerId;
        address owner;
        bytes32 minerId;              // Filecoin miner ID hash (e.g., f0xxxxx)
        ProviderTier tier;
        uint256 capacityBytes;        // Available storage capacity
        uint256 pricePerByteEpoch;    // Price in wei per byte per epoch (~30s)
        string  location;             // Geographic region
        uint256 totalDeals;
        uint256 totalEarned;
        uint256 reputation;           // 0-10000 quality score
        bool    active;
        uint64  registeredAt;
    }

    mapping(bytes32 => StorageProvider) public providers;
    uint256 public providerCount;

    // ─── Storage Deals ──────────────────────────────────────────────────
    enum DealStatus { Proposed, Active, ProofSubmitted, Settled, Cancelled, Expired }

    struct StorageDeal {
        bytes32 dealId;
        bytes32 providerId;
        address client;
        bytes32 pieceCid;             // IPFS/Filecoin CID of the data
        uint256 sizeBytes;
        uint256 durationEpochs;       // Storage duration in Filecoin epochs
        uint256 totalPayment;         // Escrowed payment
        uint256 paidOut;              // Amount paid to provider so far
        DealStatus status;
        uint64  createdAt;
        uint64  activatedAt;
        uint64  lastProofAt;
        bytes32 proofNullifier;
    }

    mapping(bytes32 => StorageDeal) public deals;
    uint256 public dealCount;

    // ─── Proof Tracking ─────────────────────────────────────────────────
    struct StorageProof {
        bytes32 proofId;
        bytes32 dealId;
        bytes32 proofHash;            // Hash of WindowPoSt/SnapDeal proof
        uint256 verifiedSectors;
        uint64  submittedAt;
    }

    mapping(bytes32 => StorageProof[]) public dealProofs;
    mapping(bytes32 => bool) public usedNullifiers;

    // ─── Metrics ────────────────────────────────────────────────────────
    uint256 public totalVolume;
    uint256 public totalFeesCollected;
    uint256 public totalStoredBytes;

    // ─── Events ─────────────────────────────────────────────────────────
    event ProviderRegistered(bytes32 indexed providerId, address indexed owner, bytes32 minerId, ProviderTier tier);
    event ProviderUpdated(bytes32 indexed providerId, uint256 capacity, bool active);
    event DealCreated(bytes32 indexed circuitId, bytes32 indexed dealId, address indexed client, bytes32 pieceCid, uint256 sizeBytes, uint256 payment);
    event DealActivated(bytes32 indexed dealId, bytes32 indexed providerId, uint64 activatedAt);
    event StorageProofVerified(bytes32 indexed circuitId, bytes32 indexed dealId, bytes32 proofHash, bytes32 nullifier);
    event DealSettled(bytes32 indexed dealId, uint256 amountPaid, uint256 fee);
    event DealCancelled(bytes32 indexed dealId, uint256 refunded);

    error ProviderNotFound();
    error ProviderNotActive();
    error DealNotFound();
    error InvalidDealStatus();
    error NullifierUsed();
    error InsufficientPayment();
    error DealExpired();
    error NotDealParty();

    constructor(address _admin, address _revenueSplitter, address _zkVerifier) {
        require(_admin != address(0), "ZeroAdmin");
        revenueSplitter = _revenueSplitter;
        zkVerifier = _zkVerifier;
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(RELAYER_ROLE, _admin);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  1. PROVIDER MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════

    function registerProvider(
        bytes32 minerId,
        ProviderTier tier,
        uint256 capacityBytes,
        uint256 pricePerByteEpoch,
        string calldata location
    ) external whenNotPaused returns (bytes32 providerId) {
        require(minerId != bytes32(0), "ZeroMiner");
        require(capacityBytes > 0, "ZeroCap");

        providerId = keccak256(abi.encodePacked(CIRCUIT_ID, msg.sender, providerCount));

        providers[providerId] = StorageProvider({
            providerId: providerId,
            owner: msg.sender,
            minerId: minerId,
            tier: tier,
            capacityBytes: capacityBytes,
            pricePerByteEpoch: pricePerByteEpoch,
            location: location,
            totalDeals: 0,
            totalEarned: 0,
            reputation: 5000,
            active: true,
            registeredAt: uint64(block.timestamp)
        });

        providerCount++;
        emit ProviderRegistered(providerId, msg.sender, minerId, tier);
    }

    function updateProvider(
        bytes32 providerId,
        uint256 newCapacity,
        uint256 newPrice,
        bool active
    ) external {
        StorageProvider storage p = providers[providerId];
        if (p.registeredAt == 0) revert ProviderNotFound();
        require(msg.sender == p.owner || hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "NotAuth");
        p.capacityBytes = newCapacity;
        p.pricePerByteEpoch = newPrice;
        p.active = active;
        emit ProviderUpdated(providerId, newCapacity, active);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  2. DEAL SUBMISSION
    // ═══════════════════════════════════════════════════════════════════

    function createDeal(
        bytes32 providerId,
        bytes32 pieceCid,
        uint256 sizeBytes,
        uint256 durationEpochs
    ) external payable whenNotPaused nonReentrant returns (bytes32 dealId) {
        StorageProvider storage p = providers[providerId];
        if (p.registeredAt == 0) revert ProviderNotFound();
        if (!p.active) revert ProviderNotActive();
        require(pieceCid != bytes32(0), "ZeroCid");
        require(sizeBytes > 0 && sizeBytes <= p.capacityBytes, "BadSize");
        require(durationEpochs > 0, "ZeroDuration");

        uint256 expectedCost = sizeBytes * p.pricePerByteEpoch * durationEpochs;
        if (msg.value < expectedCost) revert InsufficientPayment();

        dealId = keccak256(abi.encodePacked(CIRCUIT_ID, msg.sender, dealCount));

        deals[dealId] = StorageDeal({
            dealId: dealId,
            providerId: providerId,
            client: msg.sender,
            pieceCid: pieceCid,
            sizeBytes: sizeBytes,
            durationEpochs: durationEpochs,
            totalPayment: msg.value,
            paidOut: 0,
            status: DealStatus.Proposed,
            createdAt: uint64(block.timestamp),
            activatedAt: 0,
            lastProofAt: 0,
            proofNullifier: bytes32(0)
        });

        totalStoredBytes += sizeBytes;
        dealCount++;

        emit DealCreated(CIRCUIT_ID, dealId, msg.sender, pieceCid, sizeBytes, msg.value);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  3. DEAL ACTIVATION (by relayer/provider)
    // ═══════════════════════════════════════════════════════════════════

    function activateDeal(bytes32 dealId) external onlyRole(RELAYER_ROLE) {
        StorageDeal storage d = deals[dealId];
        if (d.createdAt == 0) revert DealNotFound();
        if (d.status != DealStatus.Proposed) revert InvalidDealStatus();

        d.status = DealStatus.Active;
        d.activatedAt = uint64(block.timestamp);

        StorageProvider storage p = providers[d.providerId];
        p.totalDeals++;

        emit DealActivated(dealId, d.providerId, uint64(block.timestamp));
    }

    // ═══════════════════════════════════════════════════════════════════
    //  4. ZK-VERIFIED STORAGE PROOF
    // ═══════════════════════════════════════════════════════════════════

    function submitStorageProof(
        bytes32 dealId,
        bytes32 proofHash,
        uint256 verifiedSectors,
        bytes calldata proof,
        bytes calldata publicValues,
        bytes32 nullifier
    ) external onlyRole(RELAYER_ROLE) nonReentrant whenNotPaused {
        StorageDeal storage d = deals[dealId];
        if (d.createdAt == 0) revert DealNotFound();
        if (d.status != DealStatus.Active) revert InvalidDealStatus();
        if (usedNullifiers[nullifier]) revert NullifierUsed();

        usedNullifiers[nullifier] = true;

        // ZK verification of storage proof
        if (zkVerifier != address(0)) {
            (bool ok, ) = zkVerifier.call(
                abi.encodeWithSignature(
                    "verifyProof(bytes32,bytes,bytes,bytes32)",
                    CIRCUIT_ID, publicValues, proof, nullifier
                )
            );
            require(ok, "ProofFailed");
        }

        d.status = DealStatus.ProofSubmitted;
        d.lastProofAt = uint64(block.timestamp);
        d.proofNullifier = nullifier;

        dealProofs[dealId].push(StorageProof({
            proofId: keccak256(abi.encodePacked(dealId, nullifier)),
            dealId: dealId,
            proofHash: proofHash,
            verifiedSectors: verifiedSectors,
            submittedAt: uint64(block.timestamp)
        }));

        // Update provider reputation (reward successful proofs)
        StorageProvider storage p = providers[d.providerId];
        if (p.reputation < 9900) p.reputation += 100;

        emit StorageProofVerified(CIRCUIT_ID, dealId, proofHash, nullifier);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  5. DEAL SETTLEMENT
    // ═══════════════════════════════════════════════════════════════════

    function settleDeal(bytes32 dealId) external nonReentrant {
        StorageDeal storage d = deals[dealId];
        if (d.createdAt == 0) revert DealNotFound();
        if (d.status != DealStatus.ProofSubmitted) revert InvalidDealStatus();

        StorageProvider storage p = providers[d.providerId];
        require(
            msg.sender == d.client || msg.sender == p.owner || hasRole(RELAYER_ROLE, msg.sender),
            "NotParty"
        );

        uint256 fee = (d.totalPayment * protocolFeeBps) / BPS_DENOM;
        uint256 providerPayment = d.totalPayment - fee - d.paidOut;

        d.paidOut += providerPayment;
        d.status = DealStatus.Settled;
        p.totalEarned += providerPayment;
        totalVolume += d.totalPayment;
        totalFeesCollected += fee;

        // Forward protocol fee
        if (fee > 0) _forwardFee(fee);

        // Pay provider
        if (providerPayment > 0) {
            (bool ok, ) = payable(p.owner).call{value: providerPayment}("");
            require(ok, "PayFailed");
        }

        emit DealSettled(dealId, providerPayment, fee);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  6. DEAL CANCELLATION / REFUND
    // ═══════════════════════════════════════════════════════════════════

    function cancelDeal(bytes32 dealId) external nonReentrant {
        StorageDeal storage d = deals[dealId];
        if (d.createdAt == 0) revert DealNotFound();
        require(msg.sender == d.client, "NotClient");
        require(d.status == DealStatus.Proposed, "OnlyProposed");

        d.status = DealStatus.Cancelled;
        uint256 refund = d.totalPayment - d.paidOut;
        totalStoredBytes -= d.sizeBytes;

        if (refund > 0) {
            (bool ok, ) = payable(d.client).call{value: refund}("");
            require(ok, "RefundFailed");
        }

        emit DealCancelled(dealId, refund);
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

    function getProvider(bytes32 id) external view returns (StorageProvider memory) { return providers[id]; }
    function getDeal(bytes32 id) external view returns (StorageDeal memory) { return deals[id]; }
    function getDealProofCount(bytes32 dealId) external view returns (uint256) { return dealProofs[dealId].length; }

    function getStats() external view returns (
        uint256 providers_, uint256 deals_, uint256 volume_,
        uint256 fees_, uint256 storedBytes_
    ) {
        return (providerCount, dealCount, totalVolume, totalFeesCollected, totalStoredBytes);
    }

    receive() external payable {}
}
