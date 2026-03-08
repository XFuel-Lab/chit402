// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AkashCircuit
 * @author XFuel Protocol — Expansion Circuits
 * @notice Decentralized GPU Leasing Circuit: Reverse-auction deployment management
 *         for Akash Network and generalized DePIN compute providers.
 *
 * Architecture:
 *   1. Tenants create deployments specifying GPU requirements + max price.
 *   2. Providers bid on deployments (reverse auction — lowest bidder wins).
 *   3. Leases are created when a bid is accepted, with escrow held on-chain.
 *   4. Per-block lease payments drain the escrow to the provider.
 *   5. On lease completion, SP1 proof attests compute delivery for settlement.
 *
 * Research ties:
 *   Per Akash Network docs (2026):
 *     - SDL (Stack Definition Language) defines deployment specs (GPU vendor/model,
 *       CPU, memory, storage, endpoints).
 *     - Reverse auction: tenants set max price, providers bid. Lowest bid wins.
 *     - Lease payments: deposit-and-withdraw mechanism with per-block payment rates.
 *     - Bid deposits returned when bid closes (win or lose).
 *     - GPU support: NVIDIA H100, A100, consumer 30/40-series, AMD MI300X.
 *     - Take rates: 4% AKT / 20% USDC for network revenue.
 *     - IBC integration: AKT transfers via Cosmos IBC channels.
 *
 *   Per Akash SDK:
 *     - Parse SDL YAML → deployment specs programmatically.
 *     - Create/query/update/close deployments via API.
 *     - Manage bids and leases through the marketplace module.
 *
 * Core Layer integration:
 *   - Emits DeploymentCreated for ai-listener.js to coordinate with Akash providers.
 *   - Sends fees to CoreRevenueSplitter via depositFee(CIRCUIT_ID).
 *   - Uses ZKVerifierSP1 for compute delivery attestation.
 *   - Fully isolated: own deployment registry, bid book, lease state.
 */
contract AkashCircuit is AccessControl, Pausable, ReentrancyGuard {
    // ─── Roles ────────────────────────────────────────────────────────────────
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // ─── Circuit Identity ─────────────────────────────────────────────────────
    bytes32 public constant CIRCUIT_ID = keccak256("AKASH_DEPIN_CIRCUIT");

    // ─── Core Layer References ────────────────────────────────────────────────
    address public revenueSplitter;
    address public zkVerifier;

    // ─── Fee Configuration ────────────────────────────────────────────────────
    uint16 public feeBps = 50;                  // 0.5% protocol fee
    uint16 public constant MIN_FEE_BPS = 10;
    uint16 public constant MAX_FEE_BPS = 100;
    uint16 public constant BPS_DENOM = 10000;

    // ─── GPU Specs (on-chain catalog) ─────────────────────────────────────────
    struct GPUSpec {
        bytes32 specId;
        string vendor;                // "nvidia", "amd"
        string model;                 // "h100", "a100-80gb", "rtx-4090"
        uint256 vramMB;               // VRAM in MB (e.g., 81920 for H100)
        uint256 basePrice;            // Suggested base price per hour (wei)
        bool available;
    }

    mapping(bytes32 => GPUSpec) public gpuSpecs;
    bytes32[] public specIds;
    uint256 public specCount;

    // ─── Deployment Registry ──────────────────────────────────────────────────
    enum DeploymentStatus { None, Open, Bidding, Leased, Completed, Cancelled, Disputed }

    struct Deployment {
        bytes32 deploymentId;
        address tenant;
        bytes32 specId;               // Required GPU spec
        bytes32 sdlHash;              // Hash of the full SDL (Stack Definition Language)
        uint256 maxPricePerBlock;     // Max the tenant will pay per block
        uint256 escrow;               // Total escrow deposited by tenant
        uint256 duration;             // Requested lease duration in blocks
        DeploymentStatus status;
        uint64 createdAt;
        uint64 leasedAt;
    }

    mapping(bytes32 => Deployment) public deployments;
    uint256 public deploymentCount;

    // ─── Bidding (Reverse Auction) ────────────────────────────────────────────
    struct Bid {
        bytes32 bidId;
        bytes32 deploymentId;
        address provider;
        uint256 pricePerBlock;        // Provider's bid price per block
        uint256 deposit;              // Bid deposit (returned when bid closes)
        bool active;
        uint64 submittedAt;
    }

    mapping(bytes32 => Bid) public bids;
    mapping(bytes32 => bytes32[]) public deploymentBids; // deploymentId => bidIds
    uint256 public bidCount;
    uint256 public constant MIN_BID_DEPOSIT = 0.01 ether;

    // ─── Leases ───────────────────────────────────────────────────────────────
    struct Lease {
        bytes32 leaseId;
        bytes32 deploymentId;
        bytes32 bidId;
        address tenant;
        address provider;
        uint256 pricePerBlock;
        uint256 escrowRemaining;
        uint256 startBlock;
        uint256 endBlock;
        uint256 totalPaid;
        bool active;
        bytes32 completionProofNullifier;
    }

    mapping(bytes32 => Lease) public leases;
    uint256 public leaseCount;

    // ─── Nullifier Tracking ───────────────────────────────────────────────────
    mapping(bytes32 => bool) public usedNullifiers;

    // ─── Metrics ──────────────────────────────────────────────────────────────
    uint256 public totalFeesCollected;
    uint256 public totalVolume;
    uint256 public totalLeasesCompleted;
    uint256 public activeLeaseCount;

    // ─── Events ───────────────────────────────────────────────────────────────
    event GPUSpecRegistered(bytes32 indexed specId, string vendor, string model, uint256 vramMB);

    event DeploymentCreated(
        bytes32 indexed circuitId,
        bytes32 indexed deploymentId,
        address indexed tenant,
        bytes32 specId,
        uint256 maxPricePerBlock,
        uint256 escrow,
        uint256 duration
    );

    event BidPlaced(
        bytes32 indexed deploymentId,
        bytes32 indexed bidId,
        address indexed provider,
        uint256 pricePerBlock,
        uint256 deposit
    );

    event BidAccepted(
        bytes32 indexed deploymentId,
        bytes32 indexed bidId,
        bytes32 leaseId
    );

    event LeasePayment(
        bytes32 indexed leaseId,
        uint256 amount,
        uint256 remaining
    );

    event LeaseCompleted(
        bytes32 indexed leaseId,
        bytes32 nullifier,
        uint256 totalPaid,
        uint256 refund
    );

    event DeploymentCancelled(bytes32 indexed deploymentId, uint256 refund);
    event BidWithdrawn(bytes32 indexed bidId, uint256 depositReturned);

    // ─── Errors ───────────────────────────────────────────────────────────────
    error SpecNotFound();
    error DeploymentNotFound();
    error DeploymentNotOpen();
    error NotTenant();
    error BidNotFound();
    error BidTooHigh();
    error BidDepositTooLow();
    error LeaseNotFound();
    error LeaseNotActive();
    error LeaseNotExpired();
    error NullifierUsed();
    error InsufficientEscrow();
    error NotProvider();

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
        _grantRole(OPERATOR_ROLE, _admin);
        _grantRole(RELAYER_ROLE, _admin);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  1. GPU SPEC CATALOG
    // ═══════════════════════════════════════════════════════════════════════════

    function registerGPUSpec(
        string calldata vendor,
        string calldata model,
        uint256 vramMB,
        uint256 basePrice
    ) external onlyRole(OPERATOR_ROLE) returns (bytes32 specId) {
        specId = keccak256(abi.encodePacked(vendor, model, specCount));

        gpuSpecs[specId] = GPUSpec({
            specId: specId,
            vendor: vendor,
            model: model,
            vramMB: vramMB,
            basePrice: basePrice,
            available: true
        });

        specIds.push(specId);
        specCount++;

        emit GPUSpecRegistered(specId, vendor, model, vramMB);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  2. DEPLOYMENT CREATION
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Create a GPU deployment request.
     * @param specId Required GPU specification.
     * @param sdlHash Hash of the deployment's SDL (Stack Definition Language).
     * @param maxPricePerBlock Maximum price willing to pay per block.
     * @param duration Requested lease duration in blocks.
     * @return deploymentId Unique deployment identifier.
     *
     * @dev msg.value is the total escrow (must cover duration * maxPricePerBlock).
     *      Emits DeploymentCreated for ai-listener to coordinate bidding.
     */
    function createDeployment(
        bytes32 specId,
        bytes32 sdlHash,
        uint256 maxPricePerBlock,
        uint256 duration
    ) external payable whenNotPaused nonReentrant returns (bytes32 deploymentId) {
        if (gpuSpecs[specId].specId == bytes32(0)) revert SpecNotFound();
        require(msg.value >= maxPricePerBlock * duration, "InsufficientEscrow");
        require(duration > 0, "ZeroDuration");

        uint256 fee = (msg.value * feeBps) / BPS_DENOM;
        uint256 netEscrow = msg.value - fee;

        deploymentId = keccak256(abi.encodePacked(
            CIRCUIT_ID, msg.sender, specId, block.number, deploymentCount++
        ));

        deployments[deploymentId] = Deployment({
            deploymentId: deploymentId,
            tenant: msg.sender,
            specId: specId,
            sdlHash: sdlHash,
            maxPricePerBlock: maxPricePerBlock,
            escrow: netEscrow,
            duration: duration,
            status: DeploymentStatus.Open,
            createdAt: uint64(block.timestamp),
            leasedAt: 0
        });

        totalVolume += msg.value;
        totalFeesCollected += fee;

        if (fee > 0) _forwardFee(fee);

        emit DeploymentCreated(
            CIRCUIT_ID, deploymentId, msg.sender,
            specId, maxPricePerBlock, netEscrow, duration
        );
    }

    /**
     * @notice Cancel an open deployment and reclaim escrow.
     */
    function cancelDeployment(bytes32 deploymentId) external nonReentrant {
        Deployment storage d = deployments[deploymentId];
        if (d.createdAt == 0) revert DeploymentNotFound();
        if (d.tenant != msg.sender) revert NotTenant();
        if (d.status != DeploymentStatus.Open && d.status != DeploymentStatus.Bidding) {
            revert DeploymentNotOpen();
        }

        d.status = DeploymentStatus.Cancelled;

        // Return all bid deposits
        bytes32[] storage bidList = deploymentBids[deploymentId];
        for (uint256 i = 0; i < bidList.length; i++) {
            Bid storage b = bids[bidList[i]];
            if (b.active && b.deposit > 0) {
                b.active = false;
                (bool ok, ) = payable(b.provider).call{value: b.deposit}("");
                require(ok, "BidRefund");
            }
        }

        // Return tenant escrow
        if (d.escrow > 0) {
            uint256 refund = d.escrow;
            d.escrow = 0;
            (bool ok2, ) = payable(d.tenant).call{value: refund}("");
            require(ok2, "EscrowRefund");
        }

        emit DeploymentCancelled(deploymentId, d.escrow);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  3. REVERSE AUCTION BIDDING
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Place a bid on a deployment (provider submits their price).
     * @param deploymentId Deployment to bid on.
     * @param pricePerBlock Price per block the provider wants.
     * @return bidId Unique bid identifier.
     *
     * @dev Must be <= deployment's maxPricePerBlock.
     *      Requires a minimum bid deposit (returned when bid closes).
     */
    function placeBid(
        bytes32 deploymentId,
        uint256 pricePerBlock
    ) external payable whenNotPaused returns (bytes32 bidId) {
        Deployment storage d = deployments[deploymentId];
        if (d.createdAt == 0) revert DeploymentNotFound();
        if (d.status != DeploymentStatus.Open && d.status != DeploymentStatus.Bidding) {
            revert DeploymentNotOpen();
        }
        if (pricePerBlock > d.maxPricePerBlock) revert BidTooHigh();
        if (msg.value < MIN_BID_DEPOSIT) revert BidDepositTooLow();

        bidId = keccak256(abi.encodePacked(
            CIRCUIT_ID, msg.sender, deploymentId, bidCount++
        ));

        bids[bidId] = Bid({
            bidId: bidId,
            deploymentId: deploymentId,
            provider: msg.sender,
            pricePerBlock: pricePerBlock,
            deposit: msg.value,
            active: true,
            submittedAt: uint64(block.timestamp)
        });

        deploymentBids[deploymentId].push(bidId);

        if (d.status == DeploymentStatus.Open) {
            d.status = DeploymentStatus.Bidding;
        }

        emit BidPlaced(deploymentId, bidId, msg.sender, pricePerBlock, msg.value);
    }

    /**
     * @notice Accept a bid and create a lease (tenant only).
     */
    function acceptBid(
        bytes32 bidId
    ) external nonReentrant whenNotPaused returns (bytes32 leaseId) {
        Bid storage b = bids[bidId];
        if (!b.active) revert BidNotFound();

        Deployment storage d = deployments[b.deploymentId];
        if (d.tenant != msg.sender) revert NotTenant();
        if (d.status != DeploymentStatus.Bidding && d.status != DeploymentStatus.Open) {
            revert DeploymentNotOpen();
        }

        // Create lease
        leaseId = keccak256(abi.encodePacked(
            CIRCUIT_ID, b.deploymentId, bidId, leaseCount++
        ));

        leases[leaseId] = Lease({
            leaseId: leaseId,
            deploymentId: b.deploymentId,
            bidId: bidId,
            tenant: d.tenant,
            provider: b.provider,
            pricePerBlock: b.pricePerBlock,
            escrowRemaining: d.escrow,
            startBlock: block.number,
            endBlock: block.number + d.duration,
            totalPaid: 0,
            active: true,
            completionProofNullifier: bytes32(0)
        });

        d.status = DeploymentStatus.Leased;
        d.leasedAt = uint64(block.timestamp);
        b.active = false;
        activeLeaseCount++;

        // Return bid deposit to winning provider
        if (b.deposit > 0) {
            (bool ok, ) = payable(b.provider).call{value: b.deposit}("");
            require(ok, "DepositReturn");
        }

        // Return deposits to losing bidders
        bytes32[] storage bidList = deploymentBids[b.deploymentId];
        for (uint256 i = 0; i < bidList.length; i++) {
            if (bidList[i] != bidId) {
                Bid storage loser = bids[bidList[i]];
                if (loser.active && loser.deposit > 0) {
                    loser.active = false;
                    (bool ok2, ) = payable(loser.provider).call{value: loser.deposit}("");
                    require(ok2, "LoserRefund");
                }
            }
        }

        emit BidAccepted(b.deploymentId, bidId, leaseId);
    }

    /**
     * @notice Withdraw a bid (provider cancels their bid).
     */
    function withdrawBid(bytes32 bidId) external nonReentrant {
        Bid storage b = bids[bidId];
        if (!b.active) revert BidNotFound();
        require(b.provider == msg.sender, "OnlyProvider");

        Deployment storage d = deployments[b.deploymentId];
        require(d.status != DeploymentStatus.Leased, "AlreadyLeased");

        b.active = false;

        if (b.deposit > 0) {
            uint256 dep = b.deposit;
            b.deposit = 0;
            (bool ok, ) = payable(b.provider).call{value: dep}("");
            require(ok, "DepositReturn");
        }

        emit BidWithdrawn(bidId, b.deposit);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  4. LEASE MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Claim lease payment for blocks served.
     * @param leaseId Active lease.
     * @param blocksServed Number of blocks to claim payment for.
     */
    function claimLeasePayment(
        bytes32 leaseId,
        uint256 blocksServed
    ) external nonReentrant {
        Lease storage l = leases[leaseId];
        if (!l.active) revert LeaseNotActive();
        require(msg.sender == l.provider || hasRole(RELAYER_ROLE, msg.sender), "NotProvider");

        uint256 maxBlocks = block.number - l.startBlock - (l.totalPaid / l.pricePerBlock);
        require(blocksServed <= maxBlocks, "TooManyBlocks");

        uint256 payment = blocksServed * l.pricePerBlock;
        require(payment <= l.escrowRemaining, "ExceedsEscrow");

        l.escrowRemaining -= payment;
        l.totalPaid += payment;

        (bool ok, ) = payable(l.provider).call{value: payment}("");
        require(ok, "PaymentFailed");

        emit LeasePayment(leaseId, payment, l.escrowRemaining);
    }

    /**
     * @notice Complete a lease with ZK proof of compute delivery.
     */
    function completeLease(
        bytes32 leaseId,
        bytes calldata proof,
        bytes calldata publicValues,
        bytes32 nullifier
    ) external onlyRole(RELAYER_ROLE) nonReentrant whenNotPaused {
        Lease storage l = leases[leaseId];
        if (!l.active) revert LeaseNotActive();
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

        l.active = false;
        l.completionProofNullifier = nullifier;
        activeLeaseCount--;
        totalLeasesCompleted++;

        // Refund remaining escrow to tenant
        uint256 refund = l.escrowRemaining;
        l.escrowRemaining = 0;

        Deployment storage d = deployments[l.deploymentId];
        d.status = DeploymentStatus.Completed;

        if (refund > 0) {
            (bool ok2, ) = payable(l.tenant).call{value: refund}("");
            require(ok2, "RefundFailed");
        }

        emit LeaseCompleted(leaseId, nullifier, l.totalPaid, refund);
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

    function setFee(uint16 _feeBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_feeBps >= MIN_FEE_BPS && _feeBps <= MAX_FEE_BPS, "FeeRange");
        feeBps = _feeBps;
    }

    function setRevenueSplitter(address _rs) external onlyRole(DEFAULT_ADMIN_ROLE) {
        revenueSplitter = _rs;
    }

    function setZKVerifier(address _zk) external onlyRole(DEFAULT_ADMIN_ROLE) {
        zkVerifier = _zk;
    }

    function pause() external onlyRole(OPERATOR_ROLE) { _pause(); }
    function unpause() external onlyRole(OPERATOR_ROLE) { _unpause(); }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getDeployment(bytes32 id) external view returns (Deployment memory) {
        return deployments[id];
    }

    function getBid(bytes32 id) external view returns (Bid memory) {
        return bids[id];
    }

    function getLease(bytes32 id) external view returns (Lease memory) {
        return leases[id];
    }

    function getDeploymentBidCount(bytes32 depId) external view returns (uint256) {
        return deploymentBids[depId].length;
    }

    function getStats() external view returns (
        uint256 deployments_, uint256 bids_, uint256 leases_,
        uint256 active_, uint256 completed_,
        uint256 volume_, uint256 fees_
    ) {
        return (deploymentCount, bidCount, leaseCount,
                activeLeaseCount, totalLeasesCompleted,
                totalVolume, totalFeesCollected);
    }

    receive() external payable {}
}
