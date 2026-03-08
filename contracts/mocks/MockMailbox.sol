// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/ICrossChainMailbox.sol";

/**
 * @title MockMailbox
 * @dev Test-only mock for Hyperlane Mailbox. Stores dispatched messages
 *      and allows simulating cross-chain delivery via deliverTo().
 */
contract MockMailbox is ICrossChainMailbox {
    uint32 public localDomain;
    uint256 public mockFee;
    uint256 public messageCount;

    struct Message {
        uint32 dest;
        bytes32 recipient;
        bytes body;
        bytes32 messageId;
    }

    Message[] public messages;

    constructor(uint32 _localDomain, uint256 _mockFee) {
        localDomain = _localDomain;
        mockFee = _mockFee;
    }

    function dispatch(
        uint32 dest,
        bytes32 recipient,
        bytes calldata body
    ) external payable returns (bytes32 messageId) {
        require(msg.value >= mockFee, "InsufficientFee");
        messageId = keccak256(abi.encode(dest, recipient, body, messageCount));
        messages.push(Message(dest, recipient, body, messageId));
        messageCount++;
        return messageId;
    }

    function quoteDispatch(
        uint32,
        bytes32,
        bytes calldata
    ) external view returns (uint256) {
        return mockFee;
    }

    /// @dev Simulate delivering a message to a receiver contract.
    function deliverTo(
        address receiver,
        uint32 origin,
        bytes32 sender,
        bytes calldata body
    ) external {
        ICrossChainReceiver(receiver).handle(origin, sender, body);
    }

    function getLastMessage() external view returns (Message memory) {
        require(messageCount > 0, "NoMessages");
        return messages[messageCount - 1];
    }
}
