// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title IBCTreasury
 * @author xFuel Protocol (@XFuelLab)
 * @notice Persistence-side treasury for managing LP fees and yields from IBC operations.
 *         Implements monthly batch processing: 70% retained for rebalance/growth,
 *         30% emitted for reverse-burn to RevSplitter (Theta bonus revenue).
 * @dev Deployed on Persistence chain to manage ibcTFUEL LP yields and fees.
 *      Integrates with backend events for bot monitoring and verification of unwraps.
 */
contract IBCTreasury is AccessControl, Pausable, ReentrancyGuard {
    /// @notice Role identifier for operators who can execute monthly batch processing
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    
    /// @notice Role identifier for accounts that can pause the contract
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Address of the RevenueSplitter on Theta chain (receives 30% via IBC bridge)
    address public revSplitter;

    /// @notice Percentage retained for rebalance/growth (70% = 7000 basis points)
    uint256 public constant RETAIN_BPS = 7000;
    
    /// @notice Percentage sent for reverse-burn (30% = 3000 basis points)
    uint256 public constant REVERSE_BURN_BPS = 3000;
    
    /// @notice Basis points denominator (10000 = 100%)
    uint256 public constant BASIS_POINTS_DENOMINATOR = 10000;
    
    /// @notice Minimum interval between batch processes (30 days)
    uint256 public constant BATCH_INTERVAL = 30 days;

    /// @notice Timestamp of the last batch process
    uint256 public lastBatchProcessTime;
    
    /// @notice Total accumulated fees and yields from LP operations
    uint256 public accumulatedYields;
    
    /// @notice Total amount retained for rebalancing over time
    uint256 public totalRetained;
    
    /// @notice Total amount sent for reverse-burn to RevSplitter
    uint256 public totalReverseBurned;

    /**
     * @notice Emitted when yields/fees are deposited into the treasury
     * @param source The source of the yield (e.g., LP pool address)
     * @param amount The amount deposited
     * @param timestamp The timestamp of the deposit
     */
    event YieldDeposited(
        address indexed source,
        uint256 amount,
        uint256 timestamp
    );

    /**
     * @notice Emitted when monthly batch processing is executed
     * @param batchId Unique identifier for this batch
     * @param totalProcessed Total amount processed in this batch
     * @param retainedAmount Amount retained for rebalance/growth (70%)
     * @param reverseBurnAmount Amount emitted for reverse-burn (30%)
     * @param timestamp The timestamp of the batch process
     */
    event MonthlyBatchProcessed(
        uint256 indexed batchId,
        uint256 totalProcessed,
        uint256 retainedAmount,
        uint256 reverseBurnAmount,
        uint256 timestamp
    );

    /**
     * @notice Emitted when reverse-burn is initiated to RevSplitter
     * @param batchId The batch ID associated with this reverse-burn
     * @param amount The amount being sent for reverse-burn
     * @param revSplitter The RevenueSplitter address receiving the funds
     * @param timestamp The timestamp of the reverse-burn
     */
    event ReverseBurnInitiated(
        uint256 indexed batchId,
        uint256 amount,
        address indexed revSplitter,
        uint256 timestamp
    );

    /**
     * @notice Emitted when RevenueSplitter address is updated
     * @param oldRevSplitter The previous RevenueSplitter address
     * @param newRevSplitter The new RevenueSplitter address
     */
    event RevSplitterUpdated(address indexed oldRevSplitter, address indexed newRevSplitter);

    /**
     * @notice Error thrown when trying to process batch too soon
     */
    error BatchIntervalNotReached();

    /**
     * @notice Error thrown when zero address is provided where not allowed
     */
    error ZeroAddress();

    /**
     * @notice Error thrown when amount is zero
     */
    error ZeroAmount();

    /**
     * @notice Error thrown when no yields available to process
     */
    error NoYieldsAvailable();

    /**
     * @notice Error thrown when transfer fails
     */
    error TransferFailed();

    /**
     * @notice Constructor initializes the treasury with admin and RevSplitter address
     * @param _admin The address that will have DEFAULT_ADMIN_ROLE, OPERATOR_ROLE, and PAUSER_ROLE
     * @param _revSplitter The address of the RevenueSplitter contract on Theta chain
     * @dev Grants DEFAULT_ADMIN_ROLE, OPERATOR_ROLE, and PAUSER_ROLE to the admin address
     */
    constructor(address _admin, address _revSplitter) {
        if (_admin == address(0) || _revSplitter == address(0)) {
            revert ZeroAddress();
        }

        revSplitter = _revSplitter;
        lastBatchProcessTime = block.timestamp;

        // Grant roles to admin
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(OPERATOR_ROLE, _admin);
        _grantRole(PAUSER_ROLE, _admin);
    }

    /**
     * @notice Receive function to accept yield/fee deposits
     * @dev Emits YieldDeposited event for backend monitoring
     */
    receive() external payable {
        if (msg.value == 0) revert ZeroAmount();
        
        accumulatedYields += msg.value;

        emit YieldDeposited(msg.sender, msg.value, block.timestamp);
    }

    /**
     * @notice Deposits yields/fees from LP operations into the treasury
     * @dev Allows explicit deposits with source tracking for better monitoring
     */
    function depositYield() external payable {
        if (msg.value == 0) revert ZeroAmount();
        
        accumulatedYields += msg.value;

        emit YieldDeposited(msg.sender, msg.value, block.timestamp);
    }

    /**
     * @notice Executes monthly batch processing of accumulated yields
     * @dev 70% retained for rebalance/growth, 30% sent for reverse-burn to RevSplitter
     *      Can only be called once per BATCH_INTERVAL (30 days)
     *      Operator role required
     * @return batchId Unique identifier for this batch
     * @return retainedAmount Amount retained (70%)
     * @return reverseBurnAmount Amount sent for reverse-burn (30%)
     */
    function monthlyBatchProcess() 
        external 
        onlyRole(OPERATOR_ROLE) 
        whenNotPaused 
        nonReentrant 
        returns (uint256 batchId, uint256 retainedAmount, uint256 reverseBurnAmount) 
    {
        // Check if batch interval has passed
        if (block.timestamp < lastBatchProcessTime + BATCH_INTERVAL) {
            revert BatchIntervalNotReached();
        }

        // Check if there are yields to process
        if (accumulatedYields == 0) {
            revert NoYieldsAvailable();
        }

        // Calculate split: 70% retain, 30% reverse-burn
        uint256 totalToProcess = accumulatedYields;
        retainedAmount = (totalToProcess * RETAIN_BPS) / BASIS_POINTS_DENOMINATOR;
        reverseBurnAmount = (totalToProcess * REVERSE_BURN_BPS) / BASIS_POINTS_DENOMINATOR;

        // Generate batch ID based on timestamp
        batchId = block.timestamp;

        // Update state
        accumulatedYields = 0;
        totalRetained += retainedAmount;
        totalReverseBurned += reverseBurnAmount;
        lastBatchProcessTime = block.timestamp;

        // Retained amount stays in this contract for rebalancing operations
        // (Can be used later for liquidity rebalancing, growth initiatives, etc.)

        // Transfer reverse-burn amount to RevSplitter (via IBC bridge in production)
        // For testnet/development, this transfers to the RevSplitter address
        if (reverseBurnAmount > 0) {
            (bool success, ) = revSplitter.call{value: reverseBurnAmount}("");
            if (!success) revert TransferFailed();

            emit ReverseBurnInitiated(
                batchId,
                reverseBurnAmount,
                revSplitter,
                block.timestamp
            );
        }

        emit MonthlyBatchProcessed(
            batchId,
            totalToProcess,
            retainedAmount,
            reverseBurnAmount,
            block.timestamp
        );

        return (batchId, retainedAmount, reverseBurnAmount);
    }

    /**
     * @notice Updates the RevenueSplitter address (admin only)
     * @param _newRevSplitter The new RevenueSplitter address
     * @dev Only affects future batch processes
     */
    function setRevSplitter(address _newRevSplitter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_newRevSplitter == address(0)) revert ZeroAddress();
        
        address oldRevSplitter = revSplitter;
        revSplitter = _newRevSplitter;

        emit RevSplitterUpdated(oldRevSplitter, _newRevSplitter);
    }

    /**
     * @notice Emergency withdrawal function (admin only)
     * @param recipient The address to receive the funds
     * @param amount The amount to withdraw
     * @dev Should only be used in emergency situations
     */
    function emergencyWithdraw(
        address payable recipient,
        uint256 amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (address(this).balance < amount) revert TransferFailed();

        (bool success, ) = recipient.call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    /**
     * @notice Pauses batch processing (pauser role only)
     * @dev Emergency function to stop batch processing if issues are detected
     */
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /**
     * @notice Unpauses batch processing (pauser role only)
     * @dev Resumes normal batch processing operations
     */
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /**
     * @notice Returns the current balance of the treasury
     * @return The treasury's balance
     */
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /**
     * @notice Returns time until next batch can be processed
     * @return Time in seconds until next batch, 0 if ready
     */
    function timeUntilNextBatch() external view returns (uint256) {
        uint256 nextBatchTime = lastBatchProcessTime + BATCH_INTERVAL;
        if (block.timestamp >= nextBatchTime) {
            return 0;
        }
        return nextBatchTime - block.timestamp;
    }

    /**
     * @notice Checks if batch processing is ready
     * @return True if ready to process, false otherwise
     */
    function isBatchReady() external view returns (bool) {
        return block.timestamp >= lastBatchProcessTime + BATCH_INTERVAL && accumulatedYields > 0;
    }

    /**
     * @notice Returns treasury statistics
     * @return _accumulatedYields Current accumulated yields
     * @return _totalRetained Total amount retained over time
     * @return _totalReverseBurned Total amount sent for reverse-burn
     * @return _lastBatchProcessTime Timestamp of last batch
     * @return _balance Current treasury balance
     */
    function getTreasuryStats() external view returns (
        uint256 _accumulatedYields,
        uint256 _totalRetained,
        uint256 _totalReverseBurned,
        uint256 _lastBatchProcessTime,
        uint256 _balance
    ) {
        return (
            accumulatedYields,
            totalRetained,
            totalReverseBurned,
            lastBatchProcessTime,
            address(this).balance
        );
    }
}

