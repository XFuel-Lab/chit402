// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IERC8004ValidationRegistry
 * @notice Pinned interface for the ERC-8004 (Trustless Agents) Validation Registry.
 * @dev Source: https://eips.ethereum.org/EIPS/eip-8004 — "Validation Registry" section
 *      (pinned July 2026). The registry is a request/response system: an agent owner/operator
 *      opens a request naming a validator address; the named validator answers with a score
 *      0..100 (0 = failed, 100 = passed; intermediate = spectrum) plus optional evidence.
 *
 *      XFuel plugs in as a **validator**: an XFuel-produced PBR receipt (payment + model
 *      authenticity + output binding) is mapped to a `validationResponse`. See
 *      contracts/core/XFuelValidationAdapter.sol and docs/ERC8004_INTEGRATION.md.
 *
 *      Spec is still evolving; this interface is isolated so upstream churn stays behind the
 *      adapter. Pin/replace the ABI here when the EIP finalizes.
 */
interface IERC8004ValidationRegistry {
    /// @notice Emitted when a validation request is opened for `validatorAddress`.
    event ValidationRequest(
        address indexed validatorAddress,
        uint256 indexed agentId,
        string requestURI,
        bytes32 indexed requestHash
    );

    /// @notice Emitted when the named validator records a response.
    event ValidationResponse(
        address indexed validatorAddress,
        uint256 indexed agentId,
        bytes32 indexed requestHash,
        uint8 response,
        string responseURI,
        bytes32 responseHash,
        string tag
    );

    /**
     * @notice Open a validation request. MUST be called by the owner/operator of `agentId`.
     * @param validatorAddress The address that is allowed to answer this request.
     * @param agentId          The agent under review (ERC-8004 Identity Registry id).
     * @param requestURI       Off-chain data with everything the validator needs (inputs/outputs).
     * @param requestHash      keccak256 commitment to the request payload; identifies the request.
     */
    function validationRequest(
        address validatorAddress,
        uint256 agentId,
        string calldata requestURI,
        bytes32 requestHash
    ) external;

    /**
     * @notice Answer a request. MUST be called by the `validatorAddress` named in the request.
     * @param requestHash  The request being answered.
     * @param response     Score 0..100 (0 = failed, 100 = passed).
     * @param responseURI  Optional off-chain evidence/audit URI.
     * @param responseHash Optional commitment to the evidence (for non-IPFS URIs).
     * @param tag          Optional categorization (e.g. "xfuel:settlement").
     */
    function validationResponse(
        bytes32 requestHash,
        uint8 response,
        string calldata responseURI,
        bytes32 responseHash,
        string calldata tag
    ) external;

    /// @notice Read a single validation record.
    function getValidationStatus(bytes32 requestHash)
        external
        view
        returns (
            address validatorAddress,
            uint256 agentId,
            uint8 response,
            bytes32 responseHash,
            string memory tag,
            uint256 lastUpdate
        );

    /// @notice Aggregate stats for an agent (optional validator/tag filters).
    function getSummary(uint256 agentId, address[] calldata validatorAddresses, string calldata tag)
        external
        view
        returns (uint64 count, uint8 averageResponse);

    /// @notice All request hashes recorded for an agent.
    function getAgentValidations(uint256 agentId) external view returns (bytes32[] memory requestHashes);

    /// @notice All request hashes routed to a validator.
    function getValidatorRequests(address validatorAddress) external view returns (bytes32[] memory requestHashes);
}
