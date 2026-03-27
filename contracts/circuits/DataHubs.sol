// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title DataHubs
 * @author XFuel Protocol — Final Expansion Circuits
 * @notice Decentralized Data Ownership Hubs: ZK-verified data contribution,
 *         provenance attestation, and tokenized dataset access with DAO governance.
 *
 * Architecture (inspired by Vana DataDAOs + Grass DePIN, generalized):
 *   1. Hub Creation  — Data DAOs register with governance and access rules.
 *   2. Data Contribution — Contributors submit data with ZK provenance proofs.
 *   3. Validation — On-chain quality/authenticity scores via SP1 attestation.
 *   4. Access Grants — Consumers purchase access; contributors earn proportional rewards.
 *   5. Provenance — Immutable on-chain audit trail for every data point.
 *
 * Research ties:
 *   Per Vana (vana.org, 2026):
 *     - First open protocol for AI data sovereignty.
 *     - DataDAOs pool user-contributed data with cryptographic ownership.
 *     - VRC-20 tokens: dataset-specific tokens earned for validated contributions.
 *     - Three layers: Data Liquidity, Data Portability, Vana Chain (EVM-compatible).
 *     - Data refinement: normalize, mask PII, encrypt before storage.
 *
 *   Per Grass (grass.io, 2026):
 *     - DePIN on Solana: 8.5M MAU, 90-100TB/day web-scraped data.
 *     - Sovereign data rollup with ZK proofs for provenance.
 *     - $10M from Polychain/Tribe Capital; $702M market cap, $33M annualized revenue.
 *     - Combats data poisoning via on-chain integrity verification.
 *
 *   For XFuel integration:
 *     - Raw data stays off-chain (encrypted); only commitments + proofs on-chain.
 *     - SP1 proves: "Data D from source S satisfies quality Q and provenance P"
 *       without revealing the actual data contents.
 *     - Hub governance via on-chain voting (contribution thresholds, access pricing).
 *     - Fees flow to CoreRevenueSplitter (protocol) + hub treasury (DAO).
 *
 * Core Layer integration:
 *   - Emits DataContributed / AccessGranted for ai-listener.js coordination.
 *   - Sends protocol fees to CoreRevenueSplitter via depositFee(CIRCUIT_ID).
 *   - Uses ZKVerifierSP1 for provenance proof verification.
 *   - Fully isolated: own hub registry, contribution state, access grants.
 */
contract DataHubs is AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant CURATOR_ROLE   = keccak256("CURATOR_ROLE");
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    bytes32 public constant RELAYER_ROLE   = keccak256("RELAYER_ROLE");
    bytes32 public constant CIRCUIT_ID     = keccak256("DATA_HUBS_CIRCUIT");

    address public revenueSplitter;
    address public zkVerifier;

    uint16 public protocolFeeBps = 50;        // 0.5% protocol fee on access purchases
    uint16 public constant MAX_FEE = 200;     // 2% max
    uint16 public constant BPS_DENOM = 10000;

    // ─── Hub Registry ─────────────────────────────────────────────────────
    struct DataHub {
        bytes32 hubId;
        address creator;
        string name;
        string category;              // "social", "web", "financial", "medical", "iot"
        bytes32 governanceHash;       // Hash of DAO governance rules
        uint256 minQualityScore;      // Minimum quality for accepted contributions (0-10000)
        uint256 accessPrice;          // Base price for dataset access
        uint256 totalContributions;
        uint256 totalRevenue;
        bool active;
        uint64 createdAt;
    }

    mapping(bytes32 => DataHub) public hubs;
    uint256 public hubCount;

    // ─── Data Contributions ───────────────────────────────────────────────
    enum ContributionStatus { Pending, Validated, Rejected, Disputed }

    struct Contribution {
        bytes32 contributionId;
        bytes32 hubId;
        address contributor;
        bytes32 dataCommitment;       // keccak256(encrypted_data) — data stays off-chain
        bytes32 provenanceHash;       // Hash of source + timestamp + method
        bytes32 proofNullifier;
        uint256 qualityScore;         // 0-10000, set after validation
        uint256 sizeBytes;
        ContributionStatus status;
        uint64 submittedAt;
        uint64 validatedAt;
        // ─── Theta EdgeStore fields ───────────────────────────────────────
        // edgeStoreCid replaces the mock keccak commitment as the canonical
        // off-chain data address.  Set by the relayer after upload succeeds.
        // edgeStoreNodeId identifies which EdgeStore node holds the content.
        bytes32 edgeStoreCid;         // EdgeStore content key (0x hex from upload response)
        bytes32 edgeStoreNodeId;      // EdgeStore node identifier (keccak256 of node address)
    }

    mapping(bytes32 => Contribution) public contributions;
    uint256 public contributionCount;
    mapping(bytes32 => uint256) public hubContributionCount;

    // ─── Contributor Rewards ──────────────────────────────────────────────
    mapping(bytes32 => mapping(address => uint256)) public contributorShares;
    mapping(bytes32 => uint256) public hubTotalShares;

    // ─── Access Grants ────────────────────────────────────────────────────
    struct AccessGrant {
        bytes32 grantId;
        bytes32 hubId;
        address consumer;
        uint256 payment;
        uint64 grantedAt;
        uint64 expiresAt;
    }

    mapping(bytes32 => AccessGrant) public grants;
    uint256 public grantCount;

    // ─── Provenance Registry (Phase 5: Privacy Markets) ─────────────────
    struct ProvenanceRecord {
        bytes32 recordId;
        bytes32 hubId;
        bytes32 contributionId;
        bytes32 sourceCommitment;         // Poseidon(source_identity || timestamp || method)
        bytes32 lineageHash;              // Hash of full data lineage chain
        bytes32 proofNullifier;
        address attestor;
        uint64 attestedAt;
        bool verified;
    }

    mapping(bytes32 => ProvenanceRecord) public provenanceRecords;
    uint256 public provenanceCount;
    uint256 public totalProvenanceAttestations;

    // ─── Nullifier Tracking ───────────────────────────────────────────────
    mapping(bytes32 => bool) public usedNullifiers;

    // ─── Metrics ──────────────────────────────────────────────────────────
    uint256 public totalVolume;
    uint256 public totalFeesCollected;
    uint256 public totalContributorPayouts;

    // ─── Semantic Cache (50% fee savings on repeat access queries) ────────
    struct AccessCache {
        bytes32 cacheKey;         // keccak256(hubId || consumer)
        bytes32 hubId;
        address consumer;
        uint64 cachedAt;
        uint64 expiresAt;
        uint256 hitCount;
        bool valid;
    }

    mapping(bytes32 => AccessCache) public accessCache;
    uint256 public cacheHits;
    uint256 public cacheSavings;
    uint16 public cacheFeeDiscountBps = 5000;
    uint256 public cacheExpirySeconds = 24 hours;

    // ─── Events ───────────────────────────────────────────────────────────
    event HubCreated(bytes32 indexed circuitId, bytes32 indexed hubId, address indexed creator, string name, string category);
    event DataContributed(bytes32 indexed circuitId, bytes32 indexed hubId, bytes32 contributionId, address contributor, bytes32 dataCommitment);
    event ContributionValidated(bytes32 indexed contributionId, uint256 qualityScore, bytes32 nullifier);
    event AccessGranted(bytes32 indexed hubId, bytes32 grantId, address consumer, uint256 payment);
    event ContributorPaid(bytes32 indexed hubId, address indexed contributor, uint256 amount);
    event HubUpdated(bytes32 indexed hubId, uint256 newPrice, bool active);

    // Emitted when a relayer seals a contribution with its Theta EdgeStore CID.
    // This is the on-chain proof that the data has been durably stored on Theta's
    // decentralised storage layer — replacing the temporary keccak commitment.
    event EdgeStoreSealed(
        bytes32 indexed contributionId,
        bytes32 indexed edgeStoreCid,
        bytes32 edgeStoreNodeId,
        address indexed sealedBy
    );

    event DataProvenanced(
        bytes32 indexed circuitId,
        bytes32 indexed recordId,
        bytes32 indexed contributionId,
        bytes32 sourceCommitment,
        bytes32 lineageHash,
        bytes32 nullifier
    );

    event ProvenanceVerified(bytes32 indexed recordId, address indexed attestor);

    event AccessCacheHit(bytes32 indexed cacheKey, bytes32 indexed hubId, address consumer, uint256 feeSaved);
    event AccessCached(bytes32 indexed cacheKey, bytes32 indexed hubId, uint64 expiresAt);

    error HubNotFound();
    error HubNotActive();
    error ContributionNotFound();
    error InvalidStatus();
    error NullifierUsed();
    error QualityTooLow();
    error InsufficientPayment();
    error AlreadySealed();

    constructor(address _admin, address _revenueSplitter, address _zkVerifier) {
        require(_admin != address(0), "ZeroAdmin");
        revenueSplitter = _revenueSplitter;
        zkVerifier = _zkVerifier;
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(CURATOR_ROLE, _admin);
        _grantRole(VALIDATOR_ROLE, _admin);
        _grantRole(RELAYER_ROLE, _admin);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  1. HUB MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════

    function createHub(
        string calldata name,
        string calldata category,
        bytes32 governanceHash,
        uint256 minQualityScore,
        uint256 accessPrice
    ) external whenNotPaused returns (bytes32 hubId) {
        require(minQualityScore <= 10000, "InvalidScore");

        hubId = keccak256(abi.encodePacked(CIRCUIT_ID, msg.sender, hubCount));

        hubs[hubId] = DataHub({
            hubId: hubId,
            creator: msg.sender,
            name: name,
            category: category,
            governanceHash: governanceHash,
            minQualityScore: minQualityScore,
            accessPrice: accessPrice,
            totalContributions: 0,
            totalRevenue: 0,
            active: true,
            createdAt: uint64(block.timestamp)
        });

        hubCount++;
        emit HubCreated(CIRCUIT_ID, hubId, msg.sender, name, category);
    }

    function updateHub(bytes32 hubId, uint256 newPrice, bool active) external {
        DataHub storage h = hubs[hubId];
        if (h.createdAt == 0) revert HubNotFound();
        require(msg.sender == h.creator || hasRole(CURATOR_ROLE, msg.sender), "NotAuth");
        h.accessPrice = newPrice;
        h.active = active;
        emit HubUpdated(hubId, newPrice, active);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  2. DATA CONTRIBUTION
    // ═══════════════════════════════════════════════════════════════════════

    function contributeData(
        bytes32 hubId,
        bytes32 dataCommitment,
        bytes32 provenanceHash,
        uint256 sizeBytes
    ) external whenNotPaused returns (bytes32 contributionId) {
        DataHub storage h = hubs[hubId];
        if (h.createdAt == 0) revert HubNotFound();
        if (!h.active) revert HubNotActive();
        require(dataCommitment != bytes32(0), "ZeroCommitment");

        contributionId = keccak256(abi.encodePacked(
            CIRCUIT_ID, hubId, msg.sender, contributionCount
        ));

        contributions[contributionId] = Contribution({
            contributionId: contributionId,
            hubId: hubId,
            contributor: msg.sender,
            dataCommitment: dataCommitment,
            provenanceHash: provenanceHash,
            proofNullifier: bytes32(0),
            qualityScore: 0,
            sizeBytes: sizeBytes,
            status: ContributionStatus.Pending,
            submittedAt: uint64(block.timestamp),
            validatedAt: 0,
            edgeStoreCid: bytes32(0),
            edgeStoreNodeId: bytes32(0)
        });

        contributionCount++;
        emit DataContributed(CIRCUIT_ID, hubId, contributionId, msg.sender, dataCommitment);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  3. ZK-VERIFIED VALIDATION
    // ═══════════════════════════════════════════════════════════════════════

    function validateContribution(
        bytes32 contributionId,
        uint256 qualityScore,
        bytes calldata proof,
        bytes calldata publicValues,
        bytes32 nullifier
    ) external onlyRole(VALIDATOR_ROLE) nonReentrant whenNotPaused {
        Contribution storage c = contributions[contributionId];
        if (c.submittedAt == 0) revert ContributionNotFound();
        if (c.status != ContributionStatus.Pending) revert InvalidStatus();
        if (usedNullifiers[nullifier]) revert NullifierUsed();
        require(qualityScore <= 10000, "InvalidScore");

        usedNullifiers[nullifier] = true;

        // Verify SP1 proof of data quality/provenance
        if (zkVerifier != address(0)) {
            (bool ok, ) = zkVerifier.call(
                abi.encodeWithSignature(
                    "verifyProof(bytes32,bytes,bytes,bytes32)",
                    CIRCUIT_ID, publicValues, proof, nullifier
                )
            );
            require(ok, "ProofFailed");
        }

        DataHub storage h = hubs[c.hubId];

        if (qualityScore < h.minQualityScore) {
            c.status = ContributionStatus.Rejected;
            c.qualityScore = qualityScore;
            c.validatedAt = uint64(block.timestamp);
            c.proofNullifier = nullifier;
            return;
        }

        c.status = ContributionStatus.Validated;
        c.qualityScore = qualityScore;
        c.validatedAt = uint64(block.timestamp);
        c.proofNullifier = nullifier;

        // Update hub stats
        h.totalContributions++;
        hubContributionCount[c.hubId]++;

        // Update contributor shares (quality-weighted)
        contributorShares[c.hubId][c.contributor] += qualityScore;
        hubTotalShares[c.hubId] += qualityScore;

        emit ContributionValidated(contributionId, qualityScore, nullifier);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  4. DATA ACCESS
    // ═══════════════════════════════════════════════════════════════════════

    function purchaseAccess(
        bytes32 hubId,
        uint64 duration
    ) external payable whenNotPaused nonReentrant returns (bytes32 grantId) {
        DataHub storage h = hubs[hubId];
        if (h.createdAt == 0) revert HubNotFound();
        if (!h.active) revert HubNotActive();
        if (msg.value < h.accessPrice) revert InsufficientPayment();

        uint256 fee = (msg.value * protocolFeeBps) / BPS_DENOM;
        uint256 netRevenue = msg.value - fee;

        grantId = keccak256(abi.encodePacked(CIRCUIT_ID, hubId, msg.sender, grantCount));

        grants[grantId] = AccessGrant({
            grantId: grantId,
            hubId: hubId,
            consumer: msg.sender,
            payment: netRevenue,
            grantedAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + duration)
        });

        h.totalRevenue += netRevenue;
        grantCount++;
        totalVolume += msg.value;
        totalFeesCollected += fee;

        if (fee > 0) _forwardFee(fee);

        emit AccessGranted(hubId, grantId, msg.sender, netRevenue);

        bytes32 cacheKey = keccak256(abi.encodePacked(hubId, msg.sender));
        accessCache[cacheKey] = AccessCache({
            cacheKey: cacheKey,
            hubId: hubId,
            consumer: msg.sender,
            cachedAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + cacheExpirySeconds),
            hitCount: 0,
            valid: true
        });
        emit AccessCached(cacheKey, hubId, uint64(block.timestamp + cacheExpirySeconds));
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  5. CONTRIBUTOR REWARDS
    // ═══════════════════════════════════════════════════════════════════════

    function claimRewards(bytes32 hubId) external nonReentrant {
        DataHub storage h = hubs[hubId];
        if (h.createdAt == 0) revert HubNotFound();

        uint256 shares = contributorShares[hubId][msg.sender];
        require(shares > 0, "NoShares");
        uint256 total = hubTotalShares[hubId];
        require(total > 0, "NoPool");

        uint256 reward = (h.totalRevenue * shares) / total;
        require(reward > 0, "NoReward");

        // Reset contributor shares and reduce pool
        contributorShares[hubId][msg.sender] = 0;
        hubTotalShares[hubId] -= shares;
        h.totalRevenue -= reward;
        totalContributorPayouts += reward;

        (bool ok, ) = payable(msg.sender).call{value: reward}("");
        require(ok, "PayFailed");

        emit ContributorPaid(hubId, msg.sender, reward);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  6. ZK-VERIFIED PROVENANCE (Privacy-Preserving Data Lineage)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Attest data provenance with ZK proof of lineage.
     *         Uses Poseidon commitment for source identity privacy.
     *         Gas target: <50K for micro-attestations.
     * @param contributionId Contribution to attest.
     * @param sourceCommitment Poseidon(source_identity || timestamp || method).
     * @param lineageHash Hash of the full data lineage chain.
     * @param proof SP1 proof of provenance validity.
     * @param publicValues Encoded provenance public values.
     * @param nullifier Replay protection.
     */
    function attestProvenance(
        bytes32 contributionId,
        bytes32 sourceCommitment,
        bytes32 lineageHash,
        bytes calldata proof,
        bytes calldata publicValues,
        bytes32 nullifier
    ) external onlyRole(VALIDATOR_ROLE) nonReentrant whenNotPaused returns (bytes32 recordId) {
        Contribution storage c = contributions[contributionId];
        if (c.submittedAt == 0) revert ContributionNotFound();
        if (usedNullifiers[nullifier]) revert NullifierUsed();
        require(sourceCommitment != bytes32(0), "ZeroCommitment");

        usedNullifiers[nullifier] = true;

        if (zkVerifier != address(0)) {
            (bool ok, ) = zkVerifier.call(
                abi.encodeWithSignature(
                    "verifyProof(bytes32,bytes,bytes,bytes32)",
                    CIRCUIT_ID, publicValues, proof, nullifier
                )
            );
            require(ok, "ProofFailed");
        }

        recordId = keccak256(abi.encodePacked(
            CIRCUIT_ID, contributionId, sourceCommitment, provenanceCount++
        ));

        provenanceRecords[recordId] = ProvenanceRecord({
            recordId: recordId,
            hubId: c.hubId,
            contributionId: contributionId,
            sourceCommitment: sourceCommitment,
            lineageHash: lineageHash,
            proofNullifier: nullifier,
            attestor: msg.sender,
            attestedAt: uint64(block.timestamp),
            verified: true
        });

        totalProvenanceAttestations++;

        emit DataProvenanced(
            CIRCUIT_ID, recordId, contributionId, sourceCommitment, lineageHash, nullifier
        );
        emit ProvenanceVerified(recordId, msg.sender);
    }

    function getProvenanceRecord(bytes32 id) external view returns (ProvenanceRecord memory) {
        return provenanceRecords[id];
    }

    function queryCachedAccess(
        bytes32 hubId
    ) external payable whenNotPaused nonReentrant returns (bool hasAccess, bool fromCache) {
        bytes32 cacheKey = keccak256(abi.encodePacked(hubId, msg.sender));
        AccessCache storage cached = accessCache[cacheKey];
        
        if (cached.valid && block.timestamp < cached.expiresAt) {
            DataHub storage h = hubs[hubId];
            uint256 discountedPrice = (h.accessPrice * cacheFeeDiscountBps) / BPS_DENOM;
            require(msg.value >= discountedPrice, "InsufficientCacheFee");
            
            cached.hitCount++;
            cacheHits++;
            uint256 saved = h.accessPrice - discountedPrice;
            cacheSavings += saved;
            
            emit AccessCacheHit(cacheKey, hubId, msg.sender, saved);
            return (true, true);
        }
        return (false, false);
    }

    // ─── Internal ─────────────────────────────────────────────────────────

    /**
     * @notice Seal a contribution with its Theta EdgeStore content identifier.
     * @param contributionId   Contribution to seal.
     * @param edgeStoreCid     EdgeStore content key returned by the upload API
     *                         (`0x` prefixed hex string, stored as bytes32).
     * @param edgeStoreNodeId  keccak256 of the EdgeStore node address that holds
     *                         the content, for geographic/reliability audits.
     *
     * Called by the relayer (RELAYER_ROLE) after a successful EdgeStore upload.
     * The CID permanently replaces the temporary keccak dataCommitment as the
     * canonical off-chain data address — validators can retrieve and verify the
     * content directly from `https://data.thetaedgestore.com/api/v2/data/<cid>`.
     *
     * Sealing is idempotent-guarded: once set, the CID cannot be changed
     * (prevents a compromised relayer from redirecting a validated contribution
     * to different content).
     */
    function attachEdgeStoreCid(
        bytes32 contributionId,
        bytes32 edgeStoreCid,
        bytes32 edgeStoreNodeId
    ) external onlyRole(RELAYER_ROLE) whenNotPaused {
        Contribution storage c = contributions[contributionId];
        if (c.submittedAt == 0) revert ContributionNotFound();
        if (c.edgeStoreCid != bytes32(0)) revert AlreadySealed();
        require(edgeStoreCid != bytes32(0), "ZeroCid");

        c.edgeStoreCid     = edgeStoreCid;
        c.edgeStoreNodeId  = edgeStoreNodeId;

        emit EdgeStoreSealed(contributionId, edgeStoreCid, edgeStoreNodeId, msg.sender);
    }

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

    function setProtocolFee(uint16 _bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_bps <= MAX_FEE, "FeeTooHigh");
        protocolFeeBps = _bps;
    }

    function setRevenueSplitter(address _rs) external onlyRole(DEFAULT_ADMIN_ROLE) { revenueSplitter = _rs; }
    function setZKVerifier(address _zk) external onlyRole(DEFAULT_ADMIN_ROLE) { zkVerifier = _zk; }
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ─── Views ────────────────────────────────────────────────────────────

    function getHub(bytes32 id) external view returns (DataHub memory) { return hubs[id]; }
    function getContribution(bytes32 id) external view returns (Contribution memory) { return contributions[id]; }
    function getGrant(bytes32 id) external view returns (AccessGrant memory) { return grants[id]; }
    function getContributorShares(bytes32 hubId, address user) external view returns (uint256) { return contributorShares[hubId][user]; }

    function getStats() external view returns (
        uint256 hubs_, uint256 contributions_, uint256 grants_,
        uint256 volume_, uint256 fees_, uint256 payouts_
    ) {
        return (hubCount, contributionCount, grantCount, totalVolume, totalFeesCollected, totalContributorPayouts);
    }

    receive() external payable {}
}
