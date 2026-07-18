// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "../interfaces/IERC8004ValidationRegistry.sol";

/**
 * @title XFuelValidationAdapter
 * @notice XFuel's on-chain identity as an ERC-8004 **validator**. Bridges an XFuel-produced
 *         verdict (derived from a PBR receipt: payment + model authenticity + output binding)
 *         into the ERC-8004 Validation Registry, and records the XFuel task that backs each
 *         verdict so a third party can trace a validation record → the real paid task.
 *         Phase 3 of docs/TIER3_VERIFIABLE_INFERENCE_BUILD_SPEC.md (moat #2).
 *
 * @dev Flow (ERC-8004): an agent owner/operator calls `validationRequest(validatorAddress =
 *      THIS adapter, agentId, requestURI, requestHash)` on the registry. XFuel's off-chain
 *      service computes the verdict from the settled receipt and calls {submitValidation}
 *      here (SUBMITTER_ROLE); this adapter — as the named validator — calls
 *      `registry.validationResponse(...)`. Because the registry only accepts a response from
 *      the named validator, THIS contract's address is the XFuel validator identity agents
 *      point their requests at.
 *
 *      The registry spec is still evolving; all coupling to it lives behind this adapter (the
 *      registry address is admin-updatable) so upstream churn never touches XFuel core.
 */
contract XFuelValidationAdapter is AccessControl, Pausable {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    /// @notice Backend key(s) allowed to push XFuel verdicts on-chain.
    bytes32 public constant SUBMITTER_ROLE = keccak256("SUBMITTER_ROLE");

    /// @notice The ERC-8004 Validation Registry this adapter answers on.
    IERC8004ValidationRegistry public registry;

    /// @notice requestHash → XFuel taskId hash that backs the verdict (provenance).
    mapping(bytes32 => bytes32) public taskForRequest;
    /// @notice requestHash → whether XFuel has already answered it.
    mapping(bytes32 => bool) public answered;

    uint256 public validationsSubmitted;

    event RegistrySet(address indexed previous, address indexed current);
    event XFuelValidationSubmitted(
        bytes32 indexed requestHash,
        bytes32 indexed taskIdHash,
        uint256 indexed agentId,
        uint8 response,
        string tag
    );

    error ZeroRegistry();
    error ZeroRequestHash();
    error ResponseOutOfRange(uint8 response);
    error AlreadyAnswered(bytes32 requestHash);

    /**
     * @param admin    DEFAULT_ADMIN / OPERATOR (protocol Safe).
     * @param registry_ ERC-8004 Validation Registry address (may be zero if set later).
     */
    constructor(address admin, address registry_) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        _grantRole(SUBMITTER_ROLE, admin);
        if (registry_ != address(0)) {
            registry = IERC8004ValidationRegistry(registry_);
            emit RegistrySet(address(0), registry_);
        }
    }

    /// @notice Point the adapter at a (new) ERC-8004 Validation Registry.
    function setRegistry(address registry_) external onlyRole(OPERATOR_ROLE) {
        if (registry_ == address(0)) revert ZeroRegistry();
        emit RegistrySet(address(registry), registry_);
        registry = IERC8004ValidationRegistry(registry_);
    }

    /**
     * @notice Push an XFuel verdict for a request into the ERC-8004 registry.
     * @param requestHash  The open request (named this adapter as validator).
     * @param agentId      The agent under review (for the provenance event).
     * @param response     Score 0..100 derived from the XFuel receipt (0 = failed, 100 = passed).
     * @param responseURI  Evidence URI (the public XFuel receipt verify_url).
     * @param responseHash Commitment to the evidence (e.g. keccak of the canonical receipt tuple).
     * @param tag          Categorization, e.g. "xfuel:settlement" / "xfuel:signed".
     * @param taskIdHash   keccak256 of the XFuel taskId backing this verdict (provenance link).
     */
    function submitValidation(
        bytes32 requestHash,
        uint256 agentId,
        uint8 response,
        string calldata responseURI,
        bytes32 responseHash,
        string calldata tag,
        bytes32 taskIdHash
    ) external whenNotPaused onlyRole(SUBMITTER_ROLE) {
        if (address(registry) == address(0)) revert ZeroRegistry();
        if (requestHash == bytes32(0)) revert ZeroRequestHash();
        if (response > 100) revert ResponseOutOfRange(response);
        if (answered[requestHash]) revert AlreadyAnswered(requestHash);

        answered[requestHash] = true;
        taskForRequest[requestHash] = taskIdHash;
        unchecked {
            validationsSubmitted++;
        }

        registry.validationResponse(requestHash, response, responseURI, responseHash, tag);
        emit XFuelValidationSubmitted(requestHash, taskIdHash, agentId, response, tag);
    }

    /// @notice The XFuel task hash backing a request's verdict (0 if none).
    function provenanceOf(bytes32 requestHash) external view returns (bytes32 taskIdHash, bool isAnswered) {
        return (taskForRequest[requestHash], answered[requestHash]);
    }

    function pause() external onlyRole(OPERATOR_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(OPERATOR_ROLE) {
        _unpause();
    }
}
