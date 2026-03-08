// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title SubVault
 * @author xFuel Protocol (@XFuelLab)
 * @notice Vault contract for ZK bridge hybrid: receives TFUEL deposits (0.5% fee to RevSplitter),
 *         handles UnwrapFromBurn (burns signal from Persistence → unlocks 100% TFUEL to original sender).
 *         Yields now managed on Persistence side via IBCTreasury.
 * @dev Deployed deterministically via Create2 from VaultFactory.
 *      Each user gets a unique SubVault based on their persistence address and nonce.
 */
contract SubVault {
    /// @notice The address that receives the deposit fees (RevenueSplitter)
    address public immutable revSplitter;
    
    /// @notice The factory contract that deployed this vault
    address public immutable factory;
    
    /// @notice Fee in basis points (50 = 0.5%)
    uint256 public constant FEE_BASIS_POINTS = 50;
    
    /// @notice Basis points denominator (10000 = 100%)
    uint256 public constant BASIS_POINTS_DENOMINATOR = 10000;
    

    /// @notice Mapping to track original senders for unwrap operations
    /// @dev burnTxHash => original sender address
    mapping(bytes32 => address) public unwrapRecipients;
    
    /// @notice Mapping to track processed burn transactions
    mapping(bytes32 => bool) public processedBurns;

    /**
     * @notice Emitted when a deposit is received and processed
     * @param vault The vault address that received the deposit
     * @param sender The address that sent the deposit
     * @param grossAmount The total amount deposited before fees
     * @param feeAmount The fee amount deducted (0.5%)
     * @param netAmount The net amount remaining in vault after fees
     */
    event DepositReceived(
        address indexed vault,
        address indexed sender,
        uint256 grossAmount,
        uint256 feeAmount,
        uint256 netAmount
    );

    /**
     * @notice Emitted when a refund is processed by the factory
     * @param recipient The address receiving the refund
     * @param amount The amount refunded
     */
    event RefundProcessed(address indexed recipient, uint256 amount);
    
    /**
     * @notice Emitted when UnwrapFromBurn is executed (ZK bridge unlock)
     * @param burnTxHash The transaction hash from Persistence chain burn
     * @param recipient The original sender receiving unlocked TFUEL
     * @param amount The amount of TFUEL unlocked and sent to recipient
     */
    event UnwrapFromBurn(
        bytes32 indexed burnTxHash,
        address indexed recipient,
        uint256 amount
    );

    /**
     * @notice Error thrown when fee transfer to RevSplitter fails
     */
    error FeeTransferFailed();

    /**
     * @notice Error thrown when only factory can call a function
     */
    error OnlyFactory();
    
    /**
     * @notice Error thrown when burn transaction already processed
     */
    error BurnAlreadyProcessed();
    
    /**
     * @notice Error thrown when recipient address is zero
     */
    error ZeroAddress();
    
    /**
     * @notice Error thrown when amount is zero
     */
    error ZeroAmount();
    
    /**
     * @notice Error thrown when vault has insufficient balance
     */
    error InsufficientBalance();
    
    /**
     * @notice Error thrown when transfer fails
     */
    error TransferFailed();

    /**
     * @notice Modifier to restrict function access to factory only
     */
    modifier onlyFactory() {
        if (msg.sender != factory) revert OnlyFactory();
        _;
    }

    /**
     * @notice Constructor sets immutable addresses for factory and RevSplitter
     * @param _revSplitter Address of the RevenueSplitter contract
     * @dev Called by VaultFactory during Create2 deployment
     */
    constructor(address _revSplitter) {
        require(_revSplitter != address(0), "SubVault: zero address");
        revSplitter = _revSplitter;
        factory = msg.sender;
    }

    /**
     * @notice Receive function handles incoming TFUEL deposits
     * @dev Calculates 0.5% fee, sends to RevSplitter, keeps net amount in vault
     *      Emits DepositReceived event with all relevant amounts
     */
    receive() external payable {
        require(msg.value > 0, "SubVault: zero deposit");
        
        // Calculate fee (0.5% = 50 basis points)
        uint256 feeAmount = (msg.value * FEE_BASIS_POINTS) / BASIS_POINTS_DENOMINATOR;
        uint256 netAmount = msg.value - feeAmount;

        // Transfer fee to RevenueSplitter
        if (feeAmount > 0) {
            (bool success, ) = revSplitter.call{value: feeAmount}("");
            if (!success) revert FeeTransferFailed();
        }

        // Net amount stays in this contract (backed reserves for ibcTFUEL)
        // Emit event for indexer/bridge to pick up
        emit DepositReceived(
            address(this),
            msg.sender,
            msg.value,
            feeAmount,
            netAmount
        );
    }

    /**
     * @notice UnwrapFromBurn - Unlocks TFUEL when ibcTFUEL is burned on Persistence chain
     * @param burnTxHash The transaction hash from Persistence chain where ibcTFUEL was burned
     * @param recipient The original sender who should receive unlocked TFUEL
     * @param amount The amount of TFUEL to unlock and send
     * @dev Called by factory (admin/ZK-triggered) upon burn signal from Persistence
     *      No split on reverse burns for peg integrity—full unlock post-burn
     *      Prevents double-processing of same burn transaction
     */
    function unwrapFromBurn(
        bytes32 burnTxHash,
        address payable recipient,
        uint256 amount
    ) external onlyFactory {
        // Validation
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (processedBurns[burnTxHash]) revert BurnAlreadyProcessed();
        if (address(this).balance < amount) revert InsufficientBalance();
        
        // Mark burn as processed to prevent replay
        processedBurns[burnTxHash] = true;
        unwrapRecipients[burnTxHash] = recipient;
        
        // No split on reverse burns for peg integrity—full unlock post-burn
        // Transfer 100% of amount to recipient (fee-free, no retention)
        (bool success, ) = recipient.call{value: amount}("");
        if (!success) revert TransferFailed();
        
        emit UnwrapFromBurn(
            burnTxHash,
            recipient,
            amount
        );
    }

    /**
     * @notice Allows factory admin to refund stuck/expired deposits
     * @param recipient The address to receive the refund
     * @param amount The amount to refund
     * @dev Can only be called by the factory contract (which has access control)
     */
    function refund(address payable recipient, uint256 amount) external onlyFactory {
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (address(this).balance < amount) revert InsufficientBalance();

        (bool success, ) = recipient.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit RefundProcessed(recipient, amount);
    }

    /**
     * @notice Returns the current balance of TFUEL in this vault
     * @return The vault's TFUEL balance
     */
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
    
    /**
     * @notice Checks if a burn transaction has been processed
     * @param burnTxHash The burn transaction hash to check
     * @return True if processed, false otherwise
     */
    function isBurnProcessed(bytes32 burnTxHash) external view returns (bool) {
        return processedBurns[burnTxHash];
    }
    
    /**
     * @notice Gets the recipient address for a burn transaction
     * @param burnTxHash The burn transaction hash to query
     * @return The recipient address (zero address if not set)
     */
    function getUnwrapRecipient(bytes32 burnTxHash) external view returns (address) {
        return unwrapRecipients[burnTxHash];
    }
}

