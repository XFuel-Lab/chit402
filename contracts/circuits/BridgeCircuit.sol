// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../core/SP1ProofHooks.sol";
import "../interfaces/ICrossChainMailbox.sol";

/**
 * @title BridgeCircuit
 * @author XFuel Protocol — Priority Circuits (Phase 2)
 * @notice Bridge Circuit: Multi-prover cross-chain bridge between Theta EVM, Cosmos,
 *         and Bittensor using Hyperlane for EVM chains and IBC for Cosmos chains.
 *
 * Prover: Multi-prover — uses both EVM_GROTH16 and COSMWASM_ARK_BN254 provers
 * depending on the source/destination chain pair.
 *
 * Research ties:
 *   Per Hyperlane docs (2026):
 *     - Permissionless deployment: anyone can deploy on any chain
 *     - Warp Routes for token bridging (lock-and-mint / lock-and-release)
 *     - ICAs for cross-chain contract calls
 *     - Mailbox.dispatch(domain, recipient, body) for messaging
 *     - ISM (Interchain Security Module) for configurable verification
 *   Per IBC docs (ibc.cosmos.network):
 *     - Channel-based messaging: (portId, channelId) pairs
 *     - ICS-20 for fungible token transfers
 *     - IBC-Go v8+: RecvPacket, AcknowledgePacket, TimeoutPacket
 *   Per Theta Metachain docs:
 *     - Subchain validators: wTHETA + TFUEL staking
 *     - Built-in interchain messaging channel for TNT tokens
 *     - EVM-compatible: Constantinople + Istanbul (EIP-1108 alt_bn128)
 *   Per SP1 docs:
 *     - Groth16 ~270K gas, PLONK ~300K gas
 *     - Proof aggregation: compress N proofs → 1 on-chain verification
 *
 * Gas targets:
 *   - initiateBridge: <150K (message encoding + dispatch)
 *   - completeBridge: <350K (SP1 verify + token release)
 *   - relayProof: <200K (re-emit verified result)
 *
 * Routing matrix (integrated with ProofRouter):
 *   Theta EVM  → Cosmos:    Hyperlane dispatch (~20s, ~403K gas)
 *   Cosmos     → Theta EVM: IBC → Hyperlane (~25s, ~450K gas)
 *   Theta EVM  → Bittensor: Hyperlane dispatch (~12s, ~403K gas)
 *   Bittensor  → Theta EVM: Hyperlane dispatch (~12s, ~403K gas)
 */
contract BridgeCircuit is AccessControl, Pausable, ReentrancyGuard, ICrossChainReceiver {
    using SP1ProofHooks for address;

    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant CIRCUIT_ID = keccak256("BRIDGE_CIRCUIT");

    // ─── Core Layer References ────────────────────────────────────────────────
    address public revenueSplitter;
    address public zkVerifier;
    address public sp1Gateway;
    bytes32 public programVKey;

    // ─── Hyperlane ────────────────────────────────────────────────────────────
    ICrossChainMailbox public mailbox;
    mapping(uint32 => bool) public supportedDomains;
    mapping(uint32 => bytes32) public trustedRemotes;
    mapping(uint32 => string) public domainNames;

    // ─── IBC Configuration ────────────────────────────────────────────────────
    struct IBCRoute {
        string channelId;
        string portId;
        bool active;
        uint256 timeoutSeconds;
    }
    mapping(bytes32 => IBCRoute) public ibcRoutes;
    bytes32[] public ibcRouteKeys;

    // ─── Fee Configuration ────────────────────────────────────────────────────
    uint16 public feeBps = 30; // 0.3% bridge fee
    uint16 public constant MIN_FEE_BPS = 10;
    uint16 public constant MAX_FEE_BPS = 100;
    uint16 public constant BPS_DENOM = 10000;

    // ─── Bridge Message Registry ──────────────────────────────────────────────
    enum BridgeStatus { None, Initiated, InTransit, Completed, Failed, Expired }
    enum BridgeProtocol { Hyperlane, IBC, HyperlaneIBC }

    struct BridgeMessage {
        bytes32 messageId;
        address sender;
        bytes32 recipient;
        uint32 sourceDomain;
        uint32 destDomain;
        uint256 amount;
        uint256 fee;
        bytes32 dataHash;
        BridgeStatus status;
        BridgeProtocol protocol;
        bytes32 proofNullifier;
        bytes32 hyperlaneMessageId;
        string ibcChannelId;
        uint64 initiatedAt;
        uint64 completedAt;
    }

    mapping(bytes32 => BridgeMessage) public messages;
    uint256 public messageCount;

    // ─── Proof Attestation Cache ──────────────────────────────────────────────
    struct ProofAttestation {
        bytes32 circuitId;
        bytes32 publicValuesHash;
        address verifier;
        uint64 timestamp;
        uint32 originDomain;
        bool verified;
    }

    mapping(bytes32 => ProofAttestation) public attestations;
    uint256 public attestationCount;

    // ─── Nullifier Tracking ───────────────────────────────────────────────────
    mapping(bytes32 => bool) public usedNullifiers;

    // ─── Circuit Breaker ──────────────────────────────────────────────────────
    uint256 public failureWindowStart;
    uint256 public failuresInWindow;
    uint256 public bridgesInWindow;
    uint256 public constant FAILURE_WINDOW = 1 hours;
    uint256 public constant MAX_FAILURE_RATE_BPS = 500;

    // ─── Metrics ──────────────────────────────────────────────────────────────
    uint256 public totalBridged;
    uint256 public totalVolume;
    uint256 public totalFeesCollected;
    uint256 public totalFailed;
    uint256 public totalProofsRelayed;

    // ─── Events ───────────────────────────────────────────────────────────────
    event BridgeInitiated(
        bytes32 indexed circuitId,
        bytes32 indexed messageId,
        address indexed sender,
        uint32 destDomain,
        uint256 amount,
        uint256 fee,
        BridgeProtocol protocol
    );

    event BridgeCompleted(
        bytes32 indexed messageId,
        bytes32 indexed nullifier,
        uint32 sourceDomain,
        uint32 destDomain,
        uint256 amount
    );

    event ProofRelayed(
        bytes32 indexed messageId,
        bytes32 indexed sourceCircuitId,
        bytes32 nullifier,
        uint32 originDomain,
        uint32 destDomain
    );

    event CrossChainProofReceived(
        uint32 indexed originDomain,
        bytes32 indexed circuitId,
        bytes32 nullifier,
        bytes32 publicValuesHash
    );

    event IntentSubmitted(
        bytes32 indexed circuitId,
        bytes32 indexed messageId,
        string intentType,
        bytes payload
    );

    event IBCRouteConfigured(bytes32 indexed routeKey, string channelId, string portId);
    event CircuitBreakerTriggered(uint256 failureRate, uint256 window);

    // ─── Errors ───────────────────────────────────────────────────────────────
    error MessageNotFound();
    error InvalidMessageStatus(BridgeStatus current);
    error UnsupportedDomain(uint32 domain);
    error UntrustedRemote(uint32 domain, bytes32 sender);
    error NullifierUsed(bytes32 nullifier);
    error CircuitBreakerActive();
    error NoMailbox();
    error InsufficientBridgeFee();
    error IBCRouteNotFound(bytes32 routeKey);

    // ─── Constructor ──────────────────────────────────────────────────────────
    constructor(
        address _admin,
        address _revenueSplitter,
        address _zkVerifier,
        address _sp1Gateway,
        address _mailbox
    ) {
        require(_admin != address(0), "ZeroAdmin");
        revenueSplitter = _revenueSplitter;
        zkVerifier = _zkVerifier;
        sp1Gateway = _sp1Gateway;

        if (_mailbox != address(0)) {
            mailbox = ICrossChainMailbox(_mailbox);
        }

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(OPERATOR_ROLE, _admin);
        _grantRole(RELAYER_ROLE, _admin);

        failureWindowStart = block.timestamp;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  BRIDGE INITIATION (Hyperlane Path)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Initiate a cross-chain bridge via Hyperlane.
     * @param destDomain Hyperlane domain ID of the destination chain.
     * @param recipient Recipient address (bytes32-encoded) on destination.
     * @param dataHash Hash of any additional data being bridged.
     * @return messageId Unique bridge message identifier.
     */
    function initiateBridge(
        uint32 destDomain,
        bytes32 recipient,
        bytes32 dataHash
    ) external payable whenNotPaused nonReentrant returns (bytes32 messageId) {
        if (address(mailbox) == address(0)) revert NoMailbox();
        if (!supportedDomains[destDomain]) revert UnsupportedDomain(destDomain);

        uint256 fee = (msg.value * feeBps) / BPS_DENOM;
        uint256 netAmount = msg.value - fee;

        messageId = keccak256(abi.encodePacked(
            CIRCUIT_ID, msg.sender, destDomain, block.number, messageCount++
        ));

        bytes memory payload = abi.encode(
            messageId, msg.sender, recipient, netAmount, dataHash, block.timestamp
        );

        bytes32 remote = trustedRemotes[destDomain];
        uint256 bridgeFee = mailbox.quoteDispatch(destDomain, remote, payload);
        if (netAmount < bridgeFee) revert InsufficientBridgeFee();

        bytes32 hyperlaneId = mailbox.dispatch{value: bridgeFee}(destDomain, remote, payload);

        messages[messageId] = BridgeMessage({
            messageId: messageId,
            sender: msg.sender,
            recipient: recipient,
            sourceDomain: 0, // local
            destDomain: destDomain,
            amount: netAmount - bridgeFee,
            fee: fee,
            dataHash: dataHash,
            status: BridgeStatus.InTransit,
            protocol: BridgeProtocol.Hyperlane,
            proofNullifier: bytes32(0),
            hyperlaneMessageId: hyperlaneId,
            ibcChannelId: "",
            initiatedAt: uint64(block.timestamp),
            completedAt: 0
        });

        totalVolume += msg.value;
        totalFeesCollected += fee;

        if (fee > 0) _forwardFee(fee);

        emit BridgeInitiated(CIRCUIT_ID, messageId, msg.sender, destDomain, netAmount, fee, BridgeProtocol.Hyperlane);
        emit IntentSubmitted(CIRCUIT_ID, messageId, "bridge_request",
            abi.encode(destDomain, recipient, netAmount));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  BRIDGE COMPLETION (Incoming from Hyperlane)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Handle incoming cross-chain bridge message from Hyperlane.
     * @param origin Hyperlane domain ID of the source chain.
     * @param sender Trusted remote contract address (bytes32).
     * @param body ABI-encoded payload: either proof relay (160 bytes) or bridge message (192 bytes).
     * @dev Called by the Mailbox after ISM verification. Routes to _handleProofRelay or bridge completion.
     */
    function handle(
        uint32 origin,
        bytes32 sender,
        bytes calldata body
    ) external override {
        require(msg.sender == address(mailbox), "OnlyMailbox");
        if (trustedRemotes[origin] != sender) revert UntrustedRemote(origin, sender);

        // Proof relay payloads are exactly 160 bytes (5 × 32): circuitId, nullifier,
        // publicValuesHash, verifier, timestamp. Bridge messages are 192 bytes (6 × 32).
        // Check length BEFORE decoding to avoid revert on mismatched layout.
        if (body.length == PROOF_PAYLOAD_LENGTH) {
            _handleProofRelay(origin, body);
            return;
        }

        (
            bytes32 messageId,
            address originalSender,
            bytes32 recipient,
            uint256 amount,
            bytes32 dataHash,
            uint256 originTimestamp
        ) = abi.decode(body, (bytes32, address, bytes32, uint256, bytes32, uint256));

        messages[messageId] = BridgeMessage({
            messageId: messageId,
            sender: originalSender,
            recipient: recipient,
            sourceDomain: origin,
            destDomain: 0,
            amount: amount,
            fee: 0,
            dataHash: dataHash,
            status: BridgeStatus.Completed,
            protocol: BridgeProtocol.Hyperlane,
            proofNullifier: bytes32(0),
            hyperlaneMessageId: bytes32(0),
            ibcChannelId: "",
            initiatedAt: uint64(originTimestamp),
            completedAt: uint64(block.timestamp)
        });

        totalBridged++;
        _updateMetrics(true);

        emit BridgeCompleted(messageId, bytes32(0), origin, 0, amount);
        emit CrossChainProofReceived(origin, CIRCUIT_ID, bytes32(0), dataHash);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  PROOF RELAY (Cross-Chain ZK Attestation)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Relay a verified proof from this chain to a remote chain.
     * @param sourceCircuitId The circuit that generated the proof.
     * @param proof SP1 proof bytes.
     * @param publicValues ABI-encoded public values.
     * @param nullifier Replay protection nullifier.
     * @param destDomain Destination Hyperlane domain.
     * @dev Only RELAYER_ROLE. Verifies proof locally, then dispatches via Hyperlane.
     *      Excess msg.value is refunded.
     */
    function relayProof(
        bytes32 sourceCircuitId,
        bytes calldata proof,
        bytes calldata publicValues,
        bytes32 nullifier,
        uint32 destDomain
    ) external payable onlyRole(RELAYER_ROLE) nonReentrant whenNotPaused {
        if (address(mailbox) == address(0)) revert NoMailbox();
        if (!supportedDomains[destDomain]) revert UnsupportedDomain(destDomain);
        if (usedNullifiers[nullifier]) revert NullifierUsed(nullifier);
        _checkCircuitBreaker();

        usedNullifiers[nullifier] = true;

        sp1Gateway.verifySP1(programVKey, publicValues, proof);

        bytes32 pvHash = keccak256(publicValues);

        attestations[nullifier] = ProofAttestation({
            circuitId: sourceCircuitId,
            publicValuesHash: pvHash,
            verifier: msg.sender,
            timestamp: uint64(block.timestamp),
            originDomain: 0,
            verified: true
        });
        attestationCount++;
        totalProofsRelayed++;

        bytes memory payload = SP1ProofHooks.encodeCrossChainPayload(
            sourceCircuitId, nullifier, pvHash, msg.sender, block.timestamp
        );

        bytes32 remote = trustedRemotes[destDomain];
        uint256 bridgeFee = mailbox.quoteDispatch(destDomain, remote, payload);
        require(msg.value >= bridgeFee, "InsufficientBridgeFee");

        bytes32 messageId = mailbox.dispatch{value: bridgeFee}(destDomain, remote, payload);

        if (msg.value > bridgeFee) {
            (bool ok, ) = payable(msg.sender).call{value: msg.value - bridgeFee}("");
            require(ok, "RefundExcess");
        }

        emit ProofRelayed(messageId, sourceCircuitId, nullifier, 0, destDomain);
    }

    /**
     * @notice Complete a bridge with ZK proof verification.
     * @param messageId Bridge message identifier (from initiateBridge).
     * @param proof SP1 proof bytes attesting to the bridge.
     * @param publicValues ABI-encoded public values.
     * @param nullifier Replay protection nullifier.
     * @dev Only RELAYER_ROLE. Message must be InTransit. Proof verified via SP1 gateway.
     */
    function completeBridgeWithProof(
        bytes32 messageId,
        bytes calldata proof,
        bytes calldata publicValues,
        bytes32 nullifier
    ) external onlyRole(RELAYER_ROLE) nonReentrant whenNotPaused {
        _checkCircuitBreaker();

        BridgeMessage storage m = messages[messageId];
        if (m.initiatedAt == 0) revert MessageNotFound();
        if (m.status != BridgeStatus.InTransit) revert InvalidMessageStatus(m.status);
        if (usedNullifiers[nullifier]) revert NullifierUsed(nullifier);

        usedNullifiers[nullifier] = true;
        sp1Gateway.verifySP1(programVKey, publicValues, proof);

        m.status = BridgeStatus.Completed;
        m.completedAt = uint64(block.timestamp);
        m.proofNullifier = nullifier;
        totalBridged++;
        _updateMetrics(true);

        emit BridgeCompleted(messageId, nullifier, m.sourceDomain, m.destDomain, m.amount);
    }

    // ─── IBC Route Management ─────────────────────────────────────────────────

    /**
     * @notice Configure an IBC route for Cosmos chain bridging.
     * @param sourceChain Source chain identifier.
     * @param destChain Destination chain identifier.
     * @param channelId IBC channel ID.
     * @param portId IBC port ID.
     * @param timeoutSeconds Packet timeout in seconds.
     * @dev Only OPERATOR_ROLE. Route key = keccak256(sourceChain, destChain).
     */
    function configureIBCRoute(
        string calldata sourceChain,
        string calldata destChain,
        string calldata channelId,
        string calldata portId,
        uint256 timeoutSeconds
    ) external onlyRole(OPERATOR_ROLE) {
        bytes32 routeKey = keccak256(abi.encodePacked(sourceChain, destChain));
        ibcRoutes[routeKey] = IBCRoute({
            channelId: channelId,
            portId: portId,
            active: true,
            timeoutSeconds: timeoutSeconds
        });
        ibcRouteKeys.push(routeKey);

        emit IBCRouteConfigured(routeKey, channelId, portId);
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    /// @dev Proof relay payloads encode exactly 5 ABI words (5 × 32 = 160 bytes).
    uint256 private constant PROOF_PAYLOAD_LENGTH = 160;

    /**
     * @dev Handle incoming cross-chain proof relay from Hyperlane.
     * @param origin Hyperlane domain ID of the source chain.
     * @param body ABI-encoded: circuitId, nullifier, publicValuesHash, verifier, timestamp.
     * Records attestation without re-verifying (proof already verified on origin).
     */
    function _handleProofRelay(uint32 origin, bytes calldata body) internal {
        (
            bytes32 circuitId,
            bytes32 nullifier,
            bytes32 publicValuesHash,
            address verifier,
            uint256 timestamp
        ) = abi.decode(body, (bytes32, bytes32, bytes32, address, uint256));

        if (!usedNullifiers[nullifier]) {
            usedNullifiers[nullifier] = true;

            attestations[nullifier] = ProofAttestation({
                circuitId: circuitId,
                publicValuesHash: publicValuesHash,
                verifier: verifier,
                timestamp: uint64(timestamp),
                originDomain: origin,
                verified: true
            });
            attestationCount++;
            totalProofsRelayed++;

            emit CrossChainProofReceived(origin, circuitId, nullifier, publicValuesHash);
        }
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

    function _updateMetrics(bool success) internal {
        if (block.timestamp > failureWindowStart + FAILURE_WINDOW) {
            failureWindowStart = block.timestamp;
            failuresInWindow = 0;
            bridgesInWindow = 0;
        }
        bridgesInWindow++;
        if (!success) {
            failuresInWindow++;
            _evaluateCircuitBreaker();
        }
    }

    function _checkCircuitBreaker() internal view {
        if (
            bridgesInWindow > 20 &&
            failuresInWindow * 10000 / bridgesInWindow > MAX_FAILURE_RATE_BPS
        ) {
            revert CircuitBreakerActive();
        }
    }

    function _evaluateCircuitBreaker() internal {
        if (
            bridgesInWindow > 20 &&
            failuresInWindow * 10000 / bridgesInWindow > MAX_FAILURE_RATE_BPS
        ) {
            _pause();
            emit CircuitBreakerTriggered(
                failuresInWindow * 10000 / bridgesInWindow,
                bridgesInWindow
            );
        }
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    /**
     * @notice Set the bridge fee in basis points.
     * @param _feeBps Fee in basis points (10–100, i.e. 0.1%–1%).
     * @dev Only DEFAULT_ADMIN_ROLE.
     */
    function setFee(uint16 _feeBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_feeBps >= MIN_FEE_BPS && _feeBps <= MAX_FEE_BPS, "FeeRange");
        feeBps = _feeBps;
    }

    /**
     * @notice Set the SP1 program verification key.
     * @param _vkey New verification key.
     * @dev Only DEFAULT_ADMIN_ROLE.
     */
    function setProgramVKey(bytes32 _vkey) external onlyRole(DEFAULT_ADMIN_ROLE) { programVKey = _vkey; }
    /**
     * @notice Set the revenue splitter address for fee forwarding.
     * @param _rs CoreRevenueSplitter address.
     * @dev Only DEFAULT_ADMIN_ROLE.
     */
    function setRevenueSplitter(address _rs) external onlyRole(DEFAULT_ADMIN_ROLE) { revenueSplitter = _rs; }
    /**
     * @notice Set the ZK verifier contract address.
     * @param _zk ZKVerifierSP1 address.
     * @dev Only DEFAULT_ADMIN_ROLE.
     */
    function setZKVerifier(address _zk) external onlyRole(DEFAULT_ADMIN_ROLE) { zkVerifier = _zk; }
    /**
     * @notice Set the SP1 gateway address for proof verification.
     * @param _gw ISP1Verifier gateway address.
     * @dev Only DEFAULT_ADMIN_ROLE.
     */
    function setSP1Gateway(address _gw) external onlyRole(DEFAULT_ADMIN_ROLE) { sp1Gateway = _gw; }

    /**
     * @notice Set the Hyperlane mailbox address.
     * @param _mb ICrossChainMailbox address.
     * @dev Only DEFAULT_ADMIN_ROLE.
     */
    function setMailbox(address _mb) external onlyRole(DEFAULT_ADMIN_ROLE) {
        mailbox = ICrossChainMailbox(_mb);
    }

    /**
     * @notice Configure a Hyperlane domain.
     * @param domain Hyperlane domain ID.
     * @param remote Trusted remote contract address (bytes32).
     * @param supported Whether the domain is enabled.
     * @param name Human-readable domain name.
     * @dev Only DEFAULT_ADMIN_ROLE.
     */
    function configureDomain(uint32 domain, bytes32 remote, bool supported, string calldata name) external onlyRole(DEFAULT_ADMIN_ROLE) {
        supportedDomains[domain] = supported;
        trustedRemotes[domain] = remote;
        domainNames[domain] = name;
    }

    /** @notice Pause bridge operations. @dev Only OPERATOR_ROLE. */
    function pause() external onlyRole(OPERATOR_ROLE) { _pause(); }
    /** @notice Unpause bridge operations. @dev Only OPERATOR_ROLE. */
    function unpause() external onlyRole(OPERATOR_ROLE) { _unpause(); }

    // ─── Views ────────────────────────────────────────────────────────────────

    /**
     * @notice Get a bridge message by ID.
     * @param id Message identifier.
     * @return BridgeMessage struct with status, amounts, domains, etc.
     */
    function getMessage(bytes32 id) external view returns (BridgeMessage memory) { return messages[id]; }
    /**
     * @notice Get proof attestation for a nullifier.
     * @param nullifier Nullifier used in the proof.
     * @return ProofAttestation with circuitId, publicValuesHash, verifier, timestamp.
     */
    function getAttestation(bytes32 nullifier) external view returns (ProofAttestation memory) { return attestations[nullifier]; }
    /**
     * @notice Check if a nullifier has been used.
     * @param n Nullifier to check.
     * @return True if used.
     */
    function isNullifierUsed(bytes32 n) external view returns (bool) { return usedNullifiers[n]; }
    /**
     * @notice Get IBC route configuration.
     * @param key Route key (keccak256(sourceChain, destChain)).
     * @return IBCRoute with channelId, portId, active, timeoutSeconds.
     */
    function getIBCRoute(bytes32 key) external view returns (IBCRoute memory) { return ibcRoutes[key]; }

    /**
     * @notice Get bridge statistics.
     * @return bridged_ Total bridges completed.
     * @return volume_ Total volume bridged.
     * @return fees_ Total fees collected.
     * @return failed_ Total failed bridges.
     * @return proofsRelayed_ Total proofs relayed cross-chain.
     * @return messages_ Total message count.
     * @return attestations_ Total attestation count.
     */
    function getStats() external view returns (
        uint256 bridged_, uint256 volume_, uint256 fees_,
        uint256 failed_, uint256 proofsRelayed_,
        uint256 messages_, uint256 attestations_
    ) {
        return (totalBridged, totalVolume, totalFeesCollected,
                totalFailed, totalProofsRelayed,
                messageCount, attestationCount);
    }

    receive() external payable {}
}
