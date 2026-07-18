// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IERC8004ValidationRegistry.sol";

/**
 * @title MockERC8004ValidationRegistry
 * @notice Minimal ERC-8004 Validation Registry for tests. Records responses keyed by
 *         requestHash with the caller as validatorAddress (mirrors the "only the named
 *         validator can answer" rule loosely — here any caller becomes the validator).
 */
contract MockERC8004ValidationRegistry is IERC8004ValidationRegistry {
    struct Record {
        address validatorAddress;
        uint256 agentId;
        uint8 response;
        bytes32 responseHash;
        string tag;
        uint256 lastUpdate;
        bool exists;
    }

    mapping(bytes32 => Record) public records;
    mapping(bytes32 => address) public requestValidator; // set by validationRequest
    mapping(uint256 => bytes32[]) private _agentValidations;
    mapping(address => bytes32[]) private _validatorRequests;

    function validationRequest(
        address validatorAddress,
        uint256 agentId,
        string calldata requestURI,
        bytes32 requestHash
    ) external override {
        requestValidator[requestHash] = validatorAddress;
        _validatorRequests[validatorAddress].push(requestHash);
        emit ValidationRequest(validatorAddress, agentId, requestURI, requestHash);
    }

    function validationResponse(
        bytes32 requestHash,
        uint8 response,
        string calldata responseURI,
        bytes32 responseHash,
        string calldata tag
    ) external override {
        Record storage rec = records[requestHash];
        // agentId is not passed on response; keep any prior value (0 if request not opened here)
        rec.validatorAddress = msg.sender;
        rec.response = response;
        rec.responseHash = responseHash;
        rec.tag = tag;
        rec.lastUpdate = block.timestamp;
        if (!rec.exists) {
            rec.exists = true;
            _agentValidations[rec.agentId].push(requestHash);
        }
        emit ValidationResponse(msg.sender, rec.agentId, requestHash, response, responseURI, responseHash, tag);
    }

    function getValidationStatus(bytes32 requestHash)
        external
        view
        override
        returns (
            address validatorAddress,
            uint256 agentId,
            uint8 response,
            bytes32 responseHash,
            string memory tag,
            uint256 lastUpdate
        )
    {
        Record storage rec = records[requestHash];
        return (rec.validatorAddress, rec.agentId, rec.response, rec.responseHash, rec.tag, rec.lastUpdate);
    }

    function getSummary(uint256, address[] calldata, string calldata)
        external
        pure
        override
        returns (uint64 count, uint8 averageResponse)
    {
        return (0, 0);
    }

    function getAgentValidations(uint256 agentId) external view override returns (bytes32[] memory) {
        return _agentValidations[agentId];
    }

    function getValidatorRequests(address validatorAddress) external view override returns (bytes32[] memory) {
        return _validatorRequests[validatorAddress];
    }
}
