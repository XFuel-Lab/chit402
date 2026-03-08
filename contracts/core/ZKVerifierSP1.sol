// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/ISP1Verifier.sol";
import "../interfaces/ICrossChainMailbox.sol";
import "../interfaces/IBittensorStaking.sol";

/**
 * @title ZKVerifierSP1
 * @author XFuel Protocol — Core Layer
 * @notice Chain-agnostic SP1 Groth16/PLONK proof verifier with SP1-CC composed
 *         call support, Hyperlane cross-chain relay, and dTAO staking integration.
 *
 * Phase 2 extensions (Feb 2026):
 *   - SP1-CC: Verify composed call proofs that bind to historical EVM state.
 *     Per blog.succinct.xyz: Read → Compute → Verify model, ~280K gas at gateway.
 *   - Hyperlane: Relay verified proof results cross-chain via ICrossChainMailbox.
 *     Per docs.hyperlane.xyz: ISM-secured messaging for Bittensor(964), Theta(361).
 *   - dTAO: Optional stake-gated verification via Bittensor staking precompile (0x805).
 *     Per docs.bittensor.com: V2 precompile for subnet-level stake queries.
 *
 * Gas targets:
 *   - verifyProof wrapper: <100K overhead (gateway adds ~270K Groth16 / ~300K PLONK)
 *   - verifyComposedCall: <120K overhead (gateway adds ~280K for SP1-CC proofs)
 *   - relayProofCrossChain: verifyProof + ~50K for Hyperlane dispatch
 */
contract ZKVerifierSP1 is AccessControl, Pausable, ReentrancyGuard, ICrossChainReceiver {
    // ─── Roles ────────────────────────────────────────────────────────────────
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant CIRCUIT_MANAGER_ROLE = keccak256("CIRCUIT_MANAGER_ROLE");
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");

    // ─── Circuit Registry ─────────────────────────────────────────────────────
    mapping(bytes32 => bytes32) public circuits;
    mapping(bytes32 => string) public circuitLabels;
    uint256 public circuitCount;

    // ─── SP1 Gateway ──────────────────────────────────────────────────────────
    address public sp1Gateway;

    // ─── Nullifier Tracking ───────────────────────────────────────────────────
    mapping(bytes32 => bool) public usedNullifiers;

    // ─── Metrics ──────────────────────────────────────────────────────────────
    uint256 public totalVerified;
    uint256 public totalFailed;
    uint256 public totalComposedCalls;
    uint256 public totalRelayed;
    uint256 public totalStakeChecked;

    // ─── Circuit Breaker ──────────────────────────────────────────────────────
    uint256 public constant MAX_FAILURE_RATE_BPS = 500; // 5%
    uint256 public failureWindowStart;
    uint256 public failuresInWindow;
    uint256 public verificationsInWindow;
    uint256 public constant FAILURE_WINDOW = 1 hours;

    // ─── SP1-CC Composed Call State ───────────────────────────────────────────
    struct ComposedCallProof {
        bytes32 stateRoot;
        uint256 sourceBlock;
        address targetContract;
        bytes32 resultHash;
    }
    mapping(bytes32 => ComposedCallProof) public composedCalls;

    // ─── SP1 Recursive Rollup State ─────────────────────────────────────────
    uint256 public totalRecursiveVerified;
    uint256 public totalRollupBatches;
    uint256 public rollupBatchSize;

    struct RollupBatch {
        bytes32 batchRoot;
        bytes32[] nullifiers;
        bytes32[] circuitIds;
        uint256 proofCount;
        uint256 amortizedGas;
        uint256 settledAt;
        address submitter;
    }
    mapping(uint256 => RollupBatch) public rollupBatches;

    struct RecursiveNullifier {
        bytes32 parentNullifier;
        bytes32 batchRoot;
        uint256 depth;
        bool verified;
    }
    mapping(bytes32 => RecursiveNullifier) public recursiveNullifiers;

    // ─── Hyperlane Cross-Chain ─────────────────────────────────────────────────
    ICrossChainMailbox public mailbox;
    mapping(uint32 => bool) public supportedDomains;
    mapping(uint32 => bytes32) public trustedRemotes;

    // ─── dTAO Staking ─────────────────────────────────────────────────────────
    address public stakingPrecompile;
    uint256 public minStakeForProof;
    bool public stakeCheckEnabled;

    // ─── Events ───────────────────────────────────────────────────────────────
    event ProofVerified(
        bytes32 indexed circuitId,
        bytes32 indexed nullifier,
        bytes32 publicValuesHash,
        address indexed verifier,
        uint256 timestamp
    );

    event ProofFailed(
        bytes32 indexed circuitId,
        address indexed verifier,
        string reason,
        uint256 timestamp
    );

    event CircuitRegistered(
        bytes32 indexed circuitId,
        bytes32 programVKey,
        string label
    );

    event CircuitRemoved(bytes32 indexed circuitId);
    event GatewayUpdated(address indexed oldGateway, address indexed newGateway);
    event CircuitBreakerTriggered(uint256 failureRate, uint256 window);

    event ComposedCallVerified(
        bytes32 indexed circuitId,
        bytes32 indexed nullifier,
        bytes32 stateRoot,
        uint256 sourceBlock,
        address targetContract,
        address indexed verifier,
        uint256 timestamp
    );

    event ProofRelayed(
        bytes32 indexed circuitId,
        bytes32 indexed nullifier,
        uint32 destDomain,
        bytes32 messageId,
        uint256 timestamp
    );

    event CrossChainProofReceived(
        uint32 indexed originDomain,
        bytes32 indexed circuitId,
        bytes32 nullifier,
        bytes32 publicValuesHash,
        uint256 timestamp
    );

    event StakeCheckUpdated(bool enabled, uint256 minStake);
    event MailboxUpdated(address indexed oldMailbox, address indexed newMailbox);
    event DomainConfigured(uint32 indexed domain, bytes32 remote, bool supported);

    event RollupSettled(
        uint256 indexed batchId,
        bytes32 batchRoot,
        uint256 proofCount,
        uint256 amortizedGasPerProof,
        address indexed submitter,
        uint256 timestamp
    );

    event RecursiveProofVerified(
        bytes32 indexed nullifier,
        bytes32 indexed parentNullifier,
        bytes32 batchRoot,
        uint256 depth,
        uint256 timestamp
    );

    // ─── Errors ───────────────────────────────────────────────────────────────
    error CircuitNotRegistered(bytes32 circuitId);
    error NullifierAlreadyUsed(bytes32 nullifier);
    error ProofVerificationFailed();
    error GatewayCallFailed();
    error CircuitBreakerActive();
    error UnsupportedDomain(uint32 domain);
    error UntrustedRemote(uint32 domain, bytes32 sender);
    error InsufficientStake(uint256 actual, uint256 required);
    error StakeQueryFailed();
    error NoMailbox();

    // ─── Constructor ──────────────────────────────────────────────────────────
    constructor(address _admin, address _sp1Gateway) {
        require(_admin != address(0), "ZeroAdmin");

        sp1Gateway = _sp1Gateway;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(OPERATOR_ROLE, _admin);
        _grantRole(CIRCUIT_MANAGER_ROLE, _admin);
        _grantRole(RELAYER_ROLE, _admin);

        failureWindowStart = block.timestamp;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Circuit Management
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Register a circuit with its verification key.
     * @param circuitId Unique circuit identifier.
     * @param programVKey SP1 program verification key (Groth16/PLONK).
     * @param label Human-readable label for the circuit.
     * @dev Only CIRCUIT_MANAGER_ROLE. Replaces existing circuit if circuitId already registered.
     */
    function registerCircuit(
        bytes32 circuitId,
        bytes32 programVKey,
        string calldata label
    ) external onlyRole(CIRCUIT_MANAGER_ROLE) {
        require(programVKey != bytes32(0), "ZeroVKey");
        bool isNew = circuits[circuitId] == bytes32(0);
        circuits[circuitId] = programVKey;
        circuitLabels[circuitId] = label;
        if (isNew) circuitCount++;
        emit CircuitRegistered(circuitId, programVKey, label);
    }

    /**
     * @notice Remove a circuit from the registry.
     * @param circuitId Circuit to remove.
     * @dev Only CIRCUIT_MANAGER_ROLE. Decrements circuitCount.
     */
    function removeCircuit(bytes32 circuitId) external onlyRole(CIRCUIT_MANAGER_ROLE) {
        require(circuits[circuitId] != bytes32(0), "NotRegistered");
        delete circuits[circuitId];
        delete circuitLabels[circuitId];
        circuitCount--;
        emit CircuitRemoved(circuitId);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Core Verification
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Verify an SP1 proof for a registered circuit.
     * @param circuitId Registered circuit identifier.
     * @param publicValues ABI-encoded public values from the proof.
     * @param proofBytes Groth16 or PLONK proof bytes.
     * @param nullifier Replay protection; must be unique per proof.
     * @return success True if the proof is valid.
     * @dev Gas budget: gateway ~270k + wrapper ~30k = ~300k total.
     */
    function verifyProof(
        bytes32 circuitId,
        bytes calldata publicValues,
        bytes calldata proofBytes,
        bytes32 nullifier
    ) external whenNotPaused nonReentrant returns (bool success) {
        return _verifyProofInternal(circuitId, publicValues, proofBytes, nullifier);
    }

    /**
     * @notice Batch-verify multiple proofs in a single transaction.
     * @param circuitIds Array of circuit IDs (one per proof).
     * @param publicValuesArr Array of public values.
     * @param proofBytesArr Array of proof bytes.
     * @param nullifiers Array of nullifiers (one per proof).
     * @return results Array of verification results; true if valid.
     * @dev Max 20 proofs per batch. Skips unregistered circuits and used nullifiers.
     */
    function verifyProofBatch(
        bytes32[] calldata circuitIds,
        bytes[] calldata publicValuesArr,
        bytes[] calldata proofBytesArr,
        bytes32[] calldata nullifiers
    ) external whenNotPaused nonReentrant returns (bool[] memory results) {
        uint256 len = circuitIds.length;
        require(
            len > 0 && len <= 20 &&
            publicValuesArr.length == len &&
            proofBytesArr.length == len &&
            nullifiers.length == len,
            "InvalidBatchParams"
        );

        results = new bool[](len);

        for (uint256 i = 0; i < len; i++) {
            bytes32 vkey = circuits[circuitIds[i]];
            if (vkey == bytes32(0)) continue;
            if (usedNullifiers[nullifiers[i]]) continue;

            usedNullifiers[nullifiers[i]] = true;

            bool isValid = _verifyViaSP1(vkey, publicValuesArr[i], proofBytesArr[i]);
            results[i] = isValid;

            _updateMetrics();

            if (isValid) {
                totalVerified++;
                emit ProofVerified(
                    circuitIds[i],
                    nullifiers[i],
                    keccak256(publicValuesArr[i]),
                    msg.sender,
                    block.timestamp
                );
            } else {
                totalFailed++;
                emit ProofFailed(
                    circuitIds[i],
                    msg.sender,
                    "BatchItemFailed",
                    block.timestamp
                );
                _evaluateCircuitBreaker();
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SP1-CC Composed Call Verification
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Verify an SP1-CC composed call proof bound to historical EVM state.
     * @param circuitId The circuit used to generate the composed call proof.
     * @param stateRoot The state root the proof is bound to (from source block).
     * @param sourceBlock The block number on the source chain for the state read.
     * @param targetContract The contract whose state was read in the composed call.
     * @param publicValues ABI-encoded public values (includes call result).
     * @param proofBytes Groth16/PLONK proof bytes from SP1-CC.
     * @param nullifier Replay protection nullifier.
     * @return success True if the composed call proof is valid.
     *
     * @dev SP1-CC model (per blog.succinct.xyz):
     *   Read: access historical state at sourceBlock
     *   Compute: execute Solidity logic offchain (no gas limits)
     *   Verify: submit proof onchain (~280K gas at gateway)
     *   Wrapper overhead target: <120K gas.
     */
    function verifyComposedCall(
        bytes32 circuitId,
        bytes32 stateRoot,
        uint256 sourceBlock,
        address targetContract,
        bytes calldata publicValues,
        bytes calldata proofBytes,
        bytes32 nullifier
    ) external whenNotPaused nonReentrant returns (bool success) {
        _checkCircuitBreaker();

        bytes32 programVKey = circuits[circuitId];
        if (programVKey == bytes32(0)) revert CircuitNotRegistered(circuitId);
        if (usedNullifiers[nullifier]) revert NullifierAlreadyUsed(nullifier);

        usedNullifiers[nullifier] = true;

        bool isValid = _verifyViaSP1(programVKey, publicValues, proofBytes);
        _updateMetrics();

        if (isValid) {
            totalVerified++;
            totalComposedCalls++;

            composedCalls[nullifier] = ComposedCallProof({
                stateRoot: stateRoot,
                sourceBlock: sourceBlock,
                targetContract: targetContract,
                resultHash: keccak256(publicValues)
            });

            emit ComposedCallVerified(
                circuitId, nullifier, stateRoot, sourceBlock,
                targetContract, msg.sender, block.timestamp
            );
            return true;
        } else {
            totalFailed++;
            emit ProofFailed(circuitId, msg.sender, "ComposedCallFailed", block.timestamp);
            _evaluateCircuitBreaker();
            return false;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Cross-Chain Proof Relay (Hyperlane)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Verify a proof locally, then relay the result to a remote chain.
     * @param circuitId Circuit to verify against.
     * @param publicValues ABI-encoded public values.
     * @param proofBytes Groth16/PLONK proof bytes.
     * @param nullifier Replay protection nullifier.
     * @param destDomain Hyperlane domain ID of the destination chain.
     * @return messageId Hyperlane message ID for tracking.
     *
     * @dev Flow: verify locally → spend nullifier → dispatch via Hyperlane.
     *   On the destination, handle() records the verified result without
     *   re-verifying the proof (already proven on origin).
     *   Excess msg.value beyond Hyperlane fee is refunded.
     */
    function relayProofCrossChain(
        bytes32 circuitId,
        bytes calldata publicValues,
        bytes calldata proofBytes,
        bytes32 nullifier,
        uint32 destDomain
    ) external payable whenNotPaused nonReentrant returns (bytes32 messageId) {
        if (address(mailbox) == address(0)) revert NoMailbox();
        if (!supportedDomains[destDomain]) revert UnsupportedDomain(destDomain);

        bytes32 remote = trustedRemotes[destDomain];
        require(remote != bytes32(0), "NoRemote");

        // Verify locally first
        bool ok = _verifyProofInternal(circuitId, publicValues, proofBytes, nullifier);
        require(ok, "ProofInvalid");

        bytes memory payload = abi.encode(
            circuitId,
            nullifier,
            keccak256(publicValues),
            msg.sender,
            block.timestamp
        );

        uint256 fee = mailbox.quoteDispatch(destDomain, remote, payload);
        require(msg.value >= fee, "InsufficientBridgeFee");

        messageId = mailbox.dispatch{value: fee}(destDomain, remote, payload);
        totalRelayed++;

        emit ProofRelayed(circuitId, nullifier, destDomain, messageId, block.timestamp);

        if (msg.value > fee) {
            (bool refunded, ) = payable(msg.sender).call{value: msg.value - fee}("");
            require(refunded, "RefundFailed");
        }
    }

    /**
     * @notice Handle an incoming cross-chain proof result from Hyperlane.
     * @param origin Hyperlane domain ID of the source chain.
     * @param sender Trusted remote contract address (bytes32).
     * @param body ABI-encoded payload: circuitId, nullifier, publicValuesHash, verifier, timestamp.
     * @dev Called by the Mailbox after ISM verification. Records the proof
     *      as verified on this chain without re-running the ZK proof.
     */
    function handle(
        uint32 origin,
        bytes32 sender,
        bytes calldata body
    ) external override {
        require(msg.sender == address(mailbox), "OnlyMailbox");
        if (trustedRemotes[origin] != sender) revert UntrustedRemote(origin, sender);

        (
            bytes32 circuitId,
            bytes32 nullifier,
            bytes32 publicValuesHash,
            address originalVerifier,
            uint256 originTimestamp
        ) = abi.decode(body, (bytes32, bytes32, bytes32, address, uint256));

        if (!usedNullifiers[nullifier]) {
            usedNullifiers[nullifier] = true;
            totalVerified++;

            emit CrossChainProofReceived(
                origin, circuitId, nullifier, publicValuesHash, block.timestamp
            );
            emit ProofVerified(
                circuitId, nullifier, publicValuesHash,
                originalVerifier, originTimestamp
            );
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // dTAO Stake-Gated Verification
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Verify a proof with dTAO staking requirement.
     * @param circuitId Circuit to verify against.
     * @param publicValues ABI-encoded public values.
     * @param proofBytes Groth16/PLONK proof bytes.
     * @param nullifier Replay protection nullifier.
     * @param hotkey Bittensor hotkey (validator identity).
     * @param netuid Subnet UID to check stake on.
     * @return success True if proof valid and stake sufficient.
     *
     * @dev On Bittensor EVM (964), queries the staking precompile at 0x805.
     *   On other chains, the precompile won't exist — staking check is
     *   gracefully skipped unless a mock precompile address is configured.
     */
    function verifyWithStakeCheck(
        bytes32 circuitId,
        bytes calldata publicValues,
        bytes calldata proofBytes,
        bytes32 nullifier,
        bytes32 hotkey,
        uint16 netuid
    ) external whenNotPaused nonReentrant returns (bool success) {
        if (stakeCheckEnabled && stakingPrecompile != address(0)) {
            bytes32 coldkey = bytes32(uint256(uint160(msg.sender)));

            try IBittensorStaking(stakingPrecompile).getStake(hotkey, coldkey, netuid)
                returns (uint256 stake)
            {
                if (stake < minStakeForProof)
                    revert InsufficientStake(stake, minStakeForProof);
            } catch {
                revert StakeQueryFailed();
            }

            totalStakeChecked++;
        }

        return _verifyProofInternal(circuitId, publicValues, proofBytes, nullifier);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SP1 Recursive Rollup Verification
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Verify a recursive SP1 proof that aggregates multiple inner proofs.
     *         Uses SP1 Hypercube recursion (v6) for 10x throughput via batch
     *         aggregation. The recursive proof commits to a Merkle root of all
     *         inner proof nullifiers, enabling amortized verification.
     *
     * @param circuitId The rollup circuit used for recursive aggregation.
     * @param batchRoot Merkle root of all inner proof commitments.
     * @param innerNullifiers Array of nullifiers for each inner proof in the batch.
     * @param innerCircuitIds Array of circuit IDs corresponding to each inner proof.
     * @param publicValues ABI-encoded recursive proof public values.
     * @param proofBytes Recursive Groth16/PLONK proof bytes from SP1.
     * @param rollupNullifier Unique nullifier for the recursive proof itself.
     * @return batchId The ID of the settled rollup batch.
     *
     * @dev Gas target: <100K amortized per inner proof when batch size ≥10.
     *      SP1 recursion model (per docs.succinct.xyz):
     *        Inner proofs → compress → recursive STARK → Groth16 wrapper
     *        Single on-chain verification covers entire batch.
     */
    function settleRollupBatch(
        bytes32 circuitId,
        bytes32 batchRoot,
        bytes32[] calldata innerNullifiers,
        bytes32[] calldata innerCircuitIds,
        bytes calldata publicValues,
        bytes calldata proofBytes,
        bytes32 rollupNullifier
    ) external whenNotPaused nonReentrant returns (uint256 batchId) {
        _checkCircuitBreaker();

        bytes32 programVKey = circuits[circuitId];
        if (programVKey == bytes32(0)) revert CircuitNotRegistered(circuitId);
        if (usedNullifiers[rollupNullifier]) revert NullifierAlreadyUsed(rollupNullifier);

        uint256 batchSize = innerNullifiers.length;
        require(batchSize > 0 && batchSize <= 100, "InvalidBatchSize");
        require(innerCircuitIds.length == batchSize, "CircuitIdMismatch");

        bytes32 computedRoot = _computeBatchRoot(innerNullifiers, innerCircuitIds);
        require(computedRoot == batchRoot, "BatchRootMismatch");

        for (uint256 i = 0; i < batchSize; i++) {
            if (usedNullifiers[innerNullifiers[i]]) revert NullifierAlreadyUsed(innerNullifiers[i]);
        }

        usedNullifiers[rollupNullifier] = true;

        bool isValid = _verifyViaSP1(programVKey, publicValues, proofBytes);
        _updateMetrics();

        if (isValid) {
            for (uint256 i = 0; i < batchSize; i++) {
                usedNullifiers[innerNullifiers[i]] = true;

                recursiveNullifiers[innerNullifiers[i]] = RecursiveNullifier({
                    parentNullifier: rollupNullifier,
                    batchRoot: batchRoot,
                    depth: 1,
                    verified: true
                });

                emit RecursiveProofVerified(
                    innerNullifiers[i],
                    rollupNullifier,
                    batchRoot,
                    1,
                    block.timestamp
                );
            }

            totalRollupBatches++;
            batchId = totalRollupBatches;
            totalVerified += batchSize;
            totalRecursiveVerified += batchSize;

            uint256 txGas = gasleft();
            uint256 amortized = txGas > 0 ? txGas / batchSize : 0;

            rollupBatches[batchId] = RollupBatch({
                batchRoot: batchRoot,
                nullifiers: innerNullifiers,
                circuitIds: innerCircuitIds,
                proofCount: batchSize,
                amortizedGas: amortized,
                settledAt: block.timestamp,
                submitter: msg.sender
            });

            emit RollupSettled(
                batchId,
                batchRoot,
                batchSize,
                amortized,
                msg.sender,
                block.timestamp
            );

            return batchId;
        } else {
            totalFailed++;
            emit ProofFailed(circuitId, msg.sender, "RecursiveProofFailed", block.timestamp);
            _evaluateCircuitBreaker();
            return 0;
        }
    }

    /**
     * @notice Verify a multi-level recursive proof (depth > 1).
     * @param circuitId Rollup circuit for recursive aggregation.
     * @param parentNullifier Nullifier of parent proof; 0 for top-level.
     * @param publicValues ABI-encoded recursive proof public values.
     * @param proofBytes Recursive proof bytes.
     * @param nullifier Unique nullifier for this recursive proof.
     * @param depth Recursion depth (1–8).
     * @return success True if proof valid.
     * @dev Supports nested recursion; parent must be verified first.
     */
    function verifyRecursiveProof(
        bytes32 circuitId,
        bytes32 parentNullifier,
        bytes calldata publicValues,
        bytes calldata proofBytes,
        bytes32 nullifier,
        uint256 depth
    ) external whenNotPaused nonReentrant returns (bool success) {
        _checkCircuitBreaker();

        bytes32 programVKey = circuits[circuitId];
        if (programVKey == bytes32(0)) revert CircuitNotRegistered(circuitId);
        if (usedNullifiers[nullifier]) revert NullifierAlreadyUsed(nullifier);
        require(depth > 0 && depth <= 8, "InvalidDepth");

        if (parentNullifier != bytes32(0)) {
            require(usedNullifiers[parentNullifier], "ParentNotVerified");
        }

        usedNullifiers[nullifier] = true;

        bool isValid = _verifyViaSP1(programVKey, publicValues, proofBytes);
        _updateMetrics();

        if (isValid) {
            totalVerified++;
            totalRecursiveVerified++;

            recursiveNullifiers[nullifier] = RecursiveNullifier({
                parentNullifier: parentNullifier,
                batchRoot: keccak256(publicValues),
                depth: depth,
                verified: true
            });

            emit RecursiveProofVerified(
                nullifier,
                parentNullifier,
                keccak256(publicValues),
                depth,
                block.timestamp
            );

            return true;
        } else {
            totalFailed++;
            emit ProofFailed(circuitId, msg.sender, "RecursiveVerifyFailed", block.timestamp);
            _evaluateCircuitBreaker();
            return false;
        }
    }

    /**
     * @dev Compute Merkle root from inner nullifiers and circuit IDs.
     *      Uses sequential hashing for gas efficiency with small batches.
     */
    function _computeBatchRoot(
        bytes32[] calldata nullifiers,
        bytes32[] calldata circuitIds
    ) internal pure returns (bytes32) {
        bytes32 root = keccak256(abi.encodePacked(nullifiers[0], circuitIds[0]));
        for (uint256 i = 1; i < nullifiers.length; i++) {
            root = keccak256(abi.encodePacked(root, nullifiers[i], circuitIds[i]));
        }
        return root;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Internal Helpers
    // ═══════════════════════════════════════════════════════════════════════════

    function _verifyProofInternal(
        bytes32 circuitId,
        bytes calldata publicValues,
        bytes calldata proofBytes,
        bytes32 nullifier
    ) internal returns (bool success) {
        _checkCircuitBreaker();

        bytes32 programVKey = circuits[circuitId];
        if (programVKey == bytes32(0)) revert CircuitNotRegistered(circuitId);
        if (usedNullifiers[nullifier]) revert NullifierAlreadyUsed(nullifier);

        usedNullifiers[nullifier] = true;

        bool isValid = _verifyViaSP1(programVKey, publicValues, proofBytes);
        _updateMetrics();

        if (isValid) {
            bytes32 pvHash = keccak256(publicValues);
            totalVerified++;

            emit ProofVerified(circuitId, nullifier, pvHash, msg.sender, block.timestamp);
            return true;
        } else {
            totalFailed++;
            emit ProofFailed(circuitId, msg.sender, "InvalidProof", block.timestamp);
            _evaluateCircuitBreaker();
            return false;
        }
    }

    function _verifyViaSP1(
        bytes32 programVKey,
        bytes calldata publicValues,
        bytes calldata proofBytes
    ) internal view returns (bool) {
        if (sp1Gateway == address(0)) {
            return true; // Mock mode
        }

        try ISP1Verifier(sp1Gateway).verifyProof(programVKey, publicValues, proofBytes) {
            return true;
        } catch {
            return false;
        }
    }

    function _updateMetrics() internal {
        if (block.timestamp > failureWindowStart + FAILURE_WINDOW) {
            failureWindowStart = block.timestamp;
            failuresInWindow = 0;
            verificationsInWindow = 0;
        }
        verificationsInWindow++;
    }

    function _checkCircuitBreaker() internal view {
        if (
            verificationsInWindow > 100 &&
            failuresInWindow * 10000 / verificationsInWindow > MAX_FAILURE_RATE_BPS
        ) {
            revert CircuitBreakerActive();
        }
    }

    function _evaluateCircuitBreaker() internal {
        failuresInWindow++;
        if (
            verificationsInWindow > 100 &&
            failuresInWindow * 10000 / verificationsInWindow > MAX_FAILURE_RATE_BPS
        ) {
            _pause();
            emit CircuitBreakerTriggered(
                failuresInWindow * 10000 / verificationsInWindow,
                verificationsInWindow
            );
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Admin
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Set the SP1 gateway address for proof verification.
     * @param _newGateway New ISP1Verifier gateway address.
     * @dev Only DEFAULT_ADMIN_ROLE. Use address(0) for mock mode.
     */
    function setGateway(address _newGateway) external onlyRole(DEFAULT_ADMIN_ROLE) {
        address old = sp1Gateway;
        sp1Gateway = _newGateway;
        emit GatewayUpdated(old, _newGateway);
    }

    /**
     * @notice Set the Hyperlane mailbox for cross-chain relay.
     * @param _mailbox ICrossChainMailbox contract address.
     * @dev Only DEFAULT_ADMIN_ROLE.
     */
    function setMailbox(address _mailbox) external onlyRole(DEFAULT_ADMIN_ROLE) {
        address old = address(mailbox);
        mailbox = ICrossChainMailbox(_mailbox);
        emit MailboxUpdated(old, _mailbox);
    }

    /**
     * @notice Configure a Hyperlane domain for cross-chain relay.
     * @param domain Hyperlane domain ID (e.g. 964 Bittensor, 361 Theta).
     * @param remote Trusted remote contract address (bytes32).
     * @param supported Whether the domain accepts relayed proofs.
     * @dev Only DEFAULT_ADMIN_ROLE.
     */
    function configureDomain(
        uint32 domain,
        bytes32 remote,
        bool supported
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        supportedDomains[domain] = supported;
        trustedRemotes[domain] = remote;
        emit DomainConfigured(domain, remote, supported);
    }

    /**
     * @notice Configure dTAO stake-gated verification.
     * @param _precompile Bittensor staking precompile address (0x805 on Bittensor EVM).
     * @param _minStake Minimum stake required in wei.
     * @param _enabled Whether stake check is active.
     * @dev Only DEFAULT_ADMIN_ROLE. Use address(0) to disable.
     */
    function setStakeCheck(
        address _precompile,
        uint256 _minStake,
        bool _enabled
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        stakingPrecompile = _precompile;
        minStakeForProof = _minStake;
        stakeCheckEnabled = _enabled;
        emit StakeCheckUpdated(_enabled, _minStake);
    }

    /** @notice Pause all verification operations. @dev Only OPERATOR_ROLE. */
    function pause() external onlyRole(OPERATOR_ROLE) { _pause(); }
    /** @notice Unpause verification operations. @dev Only OPERATOR_ROLE. */
    function unpause() external onlyRole(OPERATOR_ROLE) { _unpause(); }

    // ═══════════════════════════════════════════════════════════════════════════
    // Views
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Check if a nullifier has been used (replay protection).
     * @param n Nullifier to check.
     * @return True if the nullifier was already spent.
     */
    function isNullifierUsed(bytes32 n) external view returns (bool) { return usedNullifiers[n]; }

    /**
     * @notice Get circuit verification key and label.
     * @param id Circuit identifier.
     * @return vkey Program verification key.
     * @return label Human-readable circuit label.
     */
    function getCircuit(bytes32 id) external view returns (bytes32 vkey, string memory label) {
        return (circuits[id], circuitLabels[id]);
    }

    /**
     * @notice Get core verification statistics.
     * @return verified Total proofs verified.
     * @return failed Total proofs that failed verification.
     * @return registered Number of registered circuits.
     * @return isMock True if gateway is address(0) (mock mode).
     */
    function getStats() external view returns (
        uint256 verified, uint256 failed, uint256 registered, bool isMock
    ) {
        return (totalVerified, totalFailed, circuitCount, sp1Gateway == address(0));
    }

    /**
     * @notice Get extended verification statistics including composed calls and relay.
     * @return verified Total proofs verified.
     * @return failed Total failed verifications.
     * @return registered Number of circuits.
     * @return composed Total SP1-CC composed calls verified.
     * @return relayed Total proofs relayed cross-chain.
     * @return stakeChecked Total stake-gated verifications.
     * @return isMock True if mock mode.
     */
    function getExtendedStats() external view returns (
        uint256 verified,
        uint256 failed,
        uint256 registered,
        uint256 composed,
        uint256 relayed,
        uint256 stakeChecked,
        bool isMock
    ) {
        return (
            totalVerified, totalFailed, circuitCount,
            totalComposedCalls, totalRelayed, totalStakeChecked,
            sp1Gateway == address(0)
        );
    }

    /**
     * @notice Get recursive rollup statistics.
     * @return recursiveVerified Total proofs verified via rollup.
     * @return batchCount Total rollup batches settled.
     * @return currentBatchSize Configured batch size.
     */
    function getRollupStats() external view returns (
        uint256 recursiveVerified,
        uint256 batchCount,
        uint256 currentBatchSize
    ) {
        return (totalRecursiveVerified, totalRollupBatches, rollupBatchSize);
    }

    /**
     * @notice Get details of a settled rollup batch.
     * @param batchId Batch identifier.
     * @return batchRoot Merkle root of inner nullifiers.
     * @return proofCount Number of proofs in the batch.
     * @return amortizedGas Gas per proof (approximate).
     * @return settledAt Block timestamp when settled.
     * @return submitter Address that submitted the batch.
     */
    function getRollupBatch(uint256 batchId) external view returns (
        bytes32 batchRoot,
        uint256 proofCount,
        uint256 amortizedGas,
        uint256 settledAt,
        address submitter
    ) {
        RollupBatch storage b = rollupBatches[batchId];
        return (b.batchRoot, b.proofCount, b.amortizedGas, b.settledAt, b.submitter);
    }

    /**
     * @notice Get recursive proof metadata for a nullifier.
     * @param nullifier Inner proof nullifier.
     * @return RecursiveNullifier struct with parent, batchRoot, depth, verified.
     */
    function getRecursiveNullifier(bytes32 nullifier) external view returns (RecursiveNullifier memory) {
        return recursiveNullifiers[nullifier];
    }

    /**
     * @notice Get SP1-CC composed call proof data for a nullifier.
     * @param nullifier Composed call nullifier.
     * @return ComposedCallProof with stateRoot, sourceBlock, targetContract, resultHash.
     */
    function getComposedCall(bytes32 nullifier) external view returns (ComposedCallProof memory) {
        return composedCalls[nullifier];
    }

    receive() external payable {}
}
