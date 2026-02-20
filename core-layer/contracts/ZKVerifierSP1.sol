// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/ISP1Verifier.sol";

/**
 * @title ZKVerifierSP1
 * @author XFuel Protocol — Core Layer
 * @notice Chain-agnostic SP1 Groth16/PLONK proof verifier for EVM-compatible networks.
 *
 * Design:
 *   - Wraps the ISP1Verifier gateway for on-chain proof verification.
 *   - Supports multiple program verification keys (one per circuit type).
 *   - Emits events that downstream circuits can subscribe to.
 *   - <100k gas per settlement verification (Groth16 ~270k at gateway, this
 *     contract adds ~30k overhead for nullifier + event).
 *
 * Research ties:
 *   Per SP1 docs v5.x (2026): Groth16 proofs are ~260 bytes on Bn254,
 *   verification costs ~270k gas via the gateway. PLONK is ~868 bytes / ~300k gas
 *   but avoids the Aztec Ignition trusted setup.
 *
 *   Per Bittensor EVM docs: Chain ID 964, RPC lite.chain.opentensor.ai.
 *   Per Theta Metachain docs: Subchain isolation, 1-2s finality, TFUEL gas.
 *
 * Integration:
 *   Deploy on any EVM chain (Theta mainnet 361, testnet 365, Bittensor 964,
 *   or any future EVM subchain). The gateway address is configurable.
 */
contract ZKVerifierSP1 is AccessControl, Pausable, ReentrancyGuard {
    // ─── Roles ────────────────────────────────────────────────────────────────
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant CIRCUIT_MANAGER_ROLE = keccak256("CIRCUIT_MANAGER_ROLE");

    // ─── Circuit Registry ─────────────────────────────────────────────────────
    /// @notice Registered program verification keys (circuitId => programVKey).
    mapping(bytes32 => bytes32) public circuits;

    /// @notice Human-readable circuit labels.
    mapping(bytes32 => string) public circuitLabels;

    /// @notice Number of registered circuits.
    uint256 public circuitCount;

    // ─── SP1 Gateway ──────────────────────────────────────────────────────────
    /// @notice Address of the SP1 Verifier Gateway (or address(0) for mock mode).
    address public sp1Gateway;

    // ─── Nullifier Tracking ───────────────────────────────────────────────────
    mapping(bytes32 => bool) public usedNullifiers;

    // ─── Metrics ──────────────────────────────────────────────────────────────
    uint256 public totalVerified;
    uint256 public totalFailed;

    // ─── Circuit Breaker ──────────────────────────────────────────────────────
    uint256 public constant MAX_FAILURE_RATE_BPS = 500; // 5%
    uint256 public failureWindowStart;
    uint256 public failuresInWindow;
    uint256 public verificationsInWindow;
    uint256 public constant FAILURE_WINDOW = 1 hours;

    // ─── Events (circuits listen to these) ────────────────────────────────────
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

    // ─── Errors ───────────────────────────────────────────────────────────────
    error CircuitNotRegistered(bytes32 circuitId);
    error NullifierAlreadyUsed(bytes32 nullifier);
    error ProofVerificationFailed();
    error GatewayCallFailed();
    error CircuitBreakerActive();

    // ─── Constructor ──────────────────────────────────────────────────────────
    /**
     * @param _admin Admin address (DEFAULT_ADMIN_ROLE).
     * @param _sp1Gateway SP1 Verifier Gateway address. Set to address(0) for mock mode.
     */
    constructor(address _admin, address _sp1Gateway) {
        require(_admin != address(0), "ZeroAdmin");

        sp1Gateway = _sp1Gateway;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(OPERATOR_ROLE, _admin);
        _grantRole(CIRCUIT_MANAGER_ROLE, _admin);

        failureWindowStart = block.timestamp;
    }

    // ─── Circuit Management ───────────────────────────────────────────────────

    /**
     * @notice Register a new SP1 program circuit.
     * @param circuitId Unique circuit identifier (e.g., keccak256("AITask")).
     * @param programVKey The SP1 program verification key.
     * @param label Human-readable label for the circuit.
     */
    function registerCircuit(
        bytes32 circuitId,
        bytes32 programVKey,
        string calldata label
    ) external onlyRole(CIRCUIT_MANAGER_ROLE) {
        require(programVKey != bytes32(0), "ZeroVKey");
        circuits[circuitId] = programVKey;
        circuitLabels[circuitId] = label;
        if (circuits[circuitId] == bytes32(0)) circuitCount++;
        emit CircuitRegistered(circuitId, programVKey, label);
    }

    /**
     * @notice Remove a circuit from the registry.
     */
    function removeCircuit(bytes32 circuitId) external onlyRole(CIRCUIT_MANAGER_ROLE) {
        require(circuits[circuitId] != bytes32(0), "NotRegistered");
        delete circuits[circuitId];
        delete circuitLabels[circuitId];
        circuitCount--;
        emit CircuitRemoved(circuitId);
    }

    // ─── Core Verification ────────────────────────────────────────────────────

    /**
     * @notice Verify an SP1 proof for a registered circuit.
     * @param circuitId The circuit to verify against.
     * @param publicValues ABI-encoded public values from the SP1 program.
     * @param proofBytes Groth16 or PLONK proof bytes.
     * @param nullifier Unique nullifier for replay protection.
     * @return success True if the proof is valid.
     *
     * @dev Gas budget: gateway ~270k + this contract ~30k = ~300k total.
     *      Target is <100k for the wrapper logic alone.
     *
     *      Emits ProofVerified on success — downstream contracts (AIDePINRouter,
     *      RevenueSplitter, circuit modules) can subscribe to this event.
     */
    function verifyProof(
        bytes32 circuitId,
        bytes calldata publicValues,
        bytes calldata proofBytes,
        bytes32 nullifier
    ) external whenNotPaused nonReentrant returns (bool success) {
        // Check circuit breaker
        _checkCircuitBreaker();

        // Validate circuit
        bytes32 programVKey = circuits[circuitId];
        if (programVKey == bytes32(0)) revert CircuitNotRegistered(circuitId);

        // Check nullifier
        if (usedNullifiers[nullifier]) revert NullifierAlreadyUsed(nullifier);

        // Mark nullifier (optimistic — prevents re-entry with same nullifier)
        usedNullifiers[nullifier] = true;

        // Verify via SP1 gateway
        bool isValid = _verifyViaSP1(programVKey, publicValues, proofBytes);

        // Update metrics
        _updateMetrics(isValid);

        if (isValid) {
            bytes32 pvHash = keccak256(publicValues);
            totalVerified++;

            emit ProofVerified(circuitId, nullifier, pvHash, msg.sender, block.timestamp);
            return true;
        } else {
            totalFailed++;
            emit ProofFailed(circuitId, msg.sender, "InvalidProof", block.timestamp);

            // Circuit breaker check
            _evaluateCircuitBreaker();

            return false;
        }
    }

    /**
     * @notice Batch-verify multiple proofs in a single transaction.
     * @dev Useful for settling multiple AI tasks at once.
     *      Continues on individual failures (does not revert the batch).
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
            }
        }

        _updateMetrics(true); // update window
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    /**
     * @dev Call the SP1 gateway. Returns true in mock mode (gateway == address(0)).
     */
    function _verifyViaSP1(
        bytes32 programVKey,
        bytes calldata publicValues,
        bytes calldata proofBytes
    ) internal view returns (bool) {
        if (sp1Gateway == address(0)) {
            // Mock mode — accept all proofs (for testnet / governance prep)
            return true;
        }

        try ISP1Verifier(sp1Gateway).verifyProof(programVKey, publicValues, proofBytes) {
            return true;
        } catch {
            return false;
        }
    }

    function _updateMetrics(bool /* isValid */) internal {
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

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setGateway(address _newGateway) external onlyRole(DEFAULT_ADMIN_ROLE) {
        address old = sp1Gateway;
        sp1Gateway = _newGateway;
        emit GatewayUpdated(old, _newGateway);
    }

    function pause() external onlyRole(OPERATOR_ROLE) { _pause(); }
    function unpause() external onlyRole(OPERATOR_ROLE) { _unpause(); }

    // ─── Views ────────────────────────────────────────────────────────────────

    function isNullifierUsed(bytes32 n) external view returns (bool) { return usedNullifiers[n]; }

    function getCircuit(bytes32 id) external view returns (bytes32 vkey, string memory label) {
        return (circuits[id], circuitLabels[id]);
    }

    function getStats() external view returns (
        uint256 verified, uint256 failed, uint256 registered, bool isMock
    ) {
        return (totalVerified, totalFailed, circuitCount, sp1Gateway == address(0));
    }
}
