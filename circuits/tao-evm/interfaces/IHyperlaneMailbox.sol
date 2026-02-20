// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IHyperlaneMailbox
 * @notice Minimal interface for Hyperlane's Mailbox contract (cross-chain messaging).
 *
 * Research (docs.hyperlane.xyz, Feb 2026):
 *   - dispatch() sends a message from origin → destination via Hyperlane relayers.
 *   - destinationDomain is Hyperlane's chain identifier (NOT EVM chain ID).
 *   - recipientAddress is left-padded bytes32 of the destination contract.
 *   - quoteDispatch() returns the fee for a message (includes ISM + relayer gas).
 *   - process() is called by relayer on destination to deliver the message.
 *   - Hyperlane supports Bittensor EVM (964), Theta (361 if deployed), Ethereum, etc.
 */
interface IHyperlaneMailbox {
    /**
     * @notice Send a cross-chain message.
     * @param destinationDomain Hyperlane domain ID of the destination chain.
     * @param recipientAddress Left-padded bytes32 address of recipient contract.
     * @param messageBody Arbitrary bytes payload.
     * @return messageId Unique identifier for the dispatched message.
     */
    function dispatch(
        uint32 destinationDomain,
        bytes32 recipientAddress,
        bytes calldata messageBody
    ) external payable returns (bytes32 messageId);

    /**
     * @notice Estimate the fee for dispatching a message.
     */
    function quoteDispatch(
        uint32 destinationDomain,
        bytes32 recipientAddress,
        bytes calldata messageBody
    ) external view returns (uint256 fee);

    /**
     * @notice Get the local domain ID.
     */
    function localDomain() external view returns (uint32);
}

/**
 * @title IMessageRecipient
 * @notice Interface that destination contracts must implement to receive Hyperlane messages.
 */
interface IMessageRecipient {
    /**
     * @notice Handle an incoming cross-chain message.
     * @param origin The Hyperlane domain ID of the sending chain.
     * @param sender The address of the sending contract (as bytes32).
     * @param body The message payload.
     */
    function handle(
        uint32 origin,
        bytes32 sender,
        bytes calldata body
    ) external;
}
