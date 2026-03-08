// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title ICrossChainMailbox
 * @notice Core Layer interface for Hyperlane Mailbox integration.
 *
 * Per Hyperlane docs (2026): Mailbox is the core entrypoint for cross-chain
 * messaging. dispatch() sends messages, quoteDispatch() estimates fees,
 * and IMessageRecipient.handle() receives messages on the destination.
 *
 * Supports Bittensor EVM (964), Theta (361/365), Ethereum, and any
 * Hyperlane-enabled chain.
 */
interface ICrossChainMailbox {
    function dispatch(
        uint32 destinationDomain,
        bytes32 recipientAddress,
        bytes calldata messageBody
    ) external payable returns (bytes32 messageId);

    function quoteDispatch(
        uint32 destinationDomain,
        bytes32 recipientAddress,
        bytes calldata messageBody
    ) external view returns (uint256 fee);

    function localDomain() external view returns (uint32);
}

/**
 * @title ICrossChainReceiver
 * @notice Contracts implement this to receive Hyperlane messages.
 */
interface ICrossChainReceiver {
    function handle(
        uint32 origin,
        bytes32 sender,
        bytes calldata body
    ) external;
}
