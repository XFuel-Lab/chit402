// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockVRF
 * @dev Mock Chainlink VRF coordinator for testing Jackpot draws.
 *      Stores the last consumer and requestId so tests can call
 *      fulfillRandomWords() manually with any random value.
 */
contract MockVRF {
    uint256 public lastRequestId;
    address public lastConsumer;
    uint256 public requestCount;

    event RandomWordsRequested(uint256 requestId, address consumer);

    function requestRandomWords(
        bytes32, uint64, uint16, uint32, uint32
    ) external returns (uint256 requestId) {
        requestCount++;
        requestId = requestCount;
        lastRequestId = requestId;
        lastConsumer = msg.sender;
        emit RandomWordsRequested(requestId, msg.sender);
    }
}
