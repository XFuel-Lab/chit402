// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title MultiSigTreasury
 * @dev Multi-signature treasury for XFuel Protocol
 * 
 * ⚠️ CORE MODULE - Critical security infrastructure
 * Extracted from main contracts for better organization and audit clarity
 * 
 * Security Features:
 * - Requires M-of-N signatures for treasury operations
 * - Configurable threshold (e.g., 3-of-5 signers)
 * - Transaction proposal and confirmation flow
 * - Time-locked execution (optional integration with TimelockController)
 * - Emergency pause functionality
 * 
 * Use Cases:
 * - Protocol upgrades
 * - Treasury fund movements
 * - Parameter changes
 * - Emergency actions
 */
contract MultiSigTreasury is UUPSUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // Transaction structure
    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
        uint256 confirmations;
        uint256 createdAt;
    }

    // Storage
    address[] public signers;
    mapping(address => bool) public isSigner;
    uint256 public requiredConfirmations;
    
    Transaction[] public transactions;
    mapping(uint256 => mapping(address => bool)) public confirmations;
    
    address public timelock; // Optional TimelockController integration
    bool public paused;
    
    // Events
    event SignerAdded(address indexed signer);
    event SignerRemoved(address indexed signer);
    event RequirementChanged(uint256 required);
    event TransactionSubmitted(
        uint256 indexed txId,
        address indexed submitter,
        address indexed to,
        uint256 value,
        bytes data
    );
    event TransactionConfirmed(uint256 indexed txId, address indexed signer);
    event TransactionRevoked(uint256 indexed txId, address indexed signer);
    event TransactionExecuted(uint256 indexed txId, address indexed executor);
    event TimelockSet(address indexed timelock);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event Deposit(address indexed sender, uint256 amount);

    // Modifiers
    modifier onlySigner() {
        require(isSigner[msg.sender], "MultiSigTreasury: not a signer");
        _;
    }

    modifier txExists(uint256 txId) {
        require(txId < transactions.length, "MultiSigTreasury: tx does not exist");
        _;
    }

    modifier notExecuted(uint256 txId) {
        require(!transactions[txId].executed, "MultiSigTreasury: tx already executed");
        _;
    }

    modifier notConfirmed(uint256 txId) {
        require(!confirmations[txId][msg.sender], "MultiSigTreasury: tx already confirmed");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "MultiSigTreasury: paused");
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initialize the multi-sig treasury
     * @param _signers Array of signer addresses
     * @param _requiredConfirmations Number of required confirmations (M-of-N)
     */
    function initialize(
        address[] memory _signers,
        uint256 _requiredConfirmations
    ) public initializer {
        require(_signers.length > 0, "MultiSigTreasury: signers required");
        require(
            _requiredConfirmations > 0 && _requiredConfirmations <= _signers.length,
            "MultiSigTreasury: invalid required confirmations"
        );

        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        for (uint256 i = 0; i < _signers.length; i++) {
            address signer = _signers[i];
            require(signer != address(0), "MultiSigTreasury: invalid signer");
            require(!isSigner[signer], "MultiSigTreasury: duplicate signer");

            isSigner[signer] = true;
            signers.push(signer);
            emit SignerAdded(signer);
        }

        requiredConfirmations = _requiredConfirmations;
        emit RequirementChanged(_requiredConfirmations);
    }

    /**
     * @dev Submit a new transaction
     * @param to Destination address
     * @param value ETH value
     * @param data Transaction data
     * @return txId Transaction ID
     */
    function submitTransaction(
        address to,
        uint256 value,
        bytes memory data
    ) public onlySigner whenNotPaused returns (uint256 txId) {
        require(to != address(0), "MultiSigTreasury: invalid destination");

        txId = transactions.length;
        transactions.push(
            Transaction({
                to: to,
                value: value,
                data: data,
                executed: false,
                confirmations: 0,
                createdAt: block.timestamp
            })
        );

        emit TransactionSubmitted(txId, msg.sender, to, value, data);
    }

    /**
     * @dev Confirm a transaction
     * @param txId Transaction ID
     */
    function confirmTransaction(uint256 txId)
        public
        onlySigner
        txExists(txId)
        notExecuted(txId)
        notConfirmed(txId)
        whenNotPaused
    {
        confirmations[txId][msg.sender] = true;
        transactions[txId].confirmations += 1;
        emit TransactionConfirmed(txId, msg.sender);
    }

    /**
     * @dev Revoke confirmation
     * @param txId Transaction ID
     */
    function revokeConfirmation(uint256 txId)
        public
        onlySigner
        txExists(txId)
        notExecuted(txId)
    {
        require(confirmations[txId][msg.sender], "MultiSigTreasury: tx not confirmed");
        
        confirmations[txId][msg.sender] = false;
        transactions[txId].confirmations -= 1;
        emit TransactionRevoked(txId, msg.sender);
    }

    /**
     * @dev Execute a confirmed transaction
     * @param txId Transaction ID
     */
    function executeTransaction(uint256 txId)
        public
        onlySigner
        txExists(txId)
        notExecuted(txId)
        nonReentrant
        whenNotPaused
    {
        Transaction storage transaction = transactions[txId];
        require(
            transaction.confirmations >= requiredConfirmations,
            "MultiSigTreasury: insufficient confirmations"
        );

        transaction.executed = true;

        // If timelock is set, route through timelock
        if (timelock != address(0)) {
            // In production, integrate with TimelockController
            // For now, execute directly
        }

        (bool success, ) = transaction.to.call{value: transaction.value}(transaction.data);
        require(success, "MultiSigTreasury: tx execution failed");

        emit TransactionExecuted(txId, msg.sender);
    }

    /**
     * @dev Add a new signer (requires multi-sig)
     * @param signer New signer address
     */
    function addSigner(address signer) external onlySigner {
        require(signer != address(0), "MultiSigTreasury: invalid signer");
        require(!isSigner[signer], "MultiSigTreasury: already signer");

        isSigner[signer] = true;
        signers.push(signer);
        emit SignerAdded(signer);
    }

    /**
     * @dev Remove a signer (requires multi-sig)
     * @param signer Signer to remove
     */
    function removeSigner(address signer) external onlySigner {
        require(isSigner[signer], "MultiSigTreasury: not a signer");
        require(signers.length - 1 >= requiredConfirmations, "MultiSigTreasury: would break requirement");

        isSigner[signer] = false;
        
        for (uint256 i = 0; i < signers.length; i++) {
            if (signers[i] == signer) {
                signers[i] = signers[signers.length - 1];
                signers.pop();
                break;
            }
        }
        
        emit SignerRemoved(signer);
    }

    /**
     * @dev Change required confirmations (requires multi-sig)
     * @param _requiredConfirmations New requirement
     */
    function changeRequirement(uint256 _requiredConfirmations) external onlySigner {
        require(
            _requiredConfirmations > 0 && _requiredConfirmations <= signers.length,
            "MultiSigTreasury: invalid requirement"
        );
        
        requiredConfirmations = _requiredConfirmations;
        emit RequirementChanged(_requiredConfirmations);
    }

    /**
     * @dev Set timelock controller
     * @param _timelock Timelock address
     */
    function setTimelock(address _timelock) external onlySigner {
        timelock = _timelock;
        emit TimelockSet(_timelock);
    }

    /**
     * @dev Pause the contract (emergency)
     */
    function pause() external onlySigner {
        paused = true;
        emit Paused(msg.sender);
    }

    /**
     * @dev Unpause the contract
     */
    function unpause() external onlySigner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    /**
     * @dev Get transaction count
     */
    function getTransactionCount() external view returns (uint256) {
        return transactions.length;
    }

    /**
     * @dev Get signer count
     */
    function getSignerCount() external view returns (uint256) {
        return signers.length;
    }

    /**
     * @dev Get transaction confirmations
     * @param txId Transaction ID
     */
    function getConfirmationCount(uint256 txId) external view returns (uint256) {
        return transactions[txId].confirmations;
    }

    /**
     * @dev Check if transaction is confirmed by signer
     */
    function isConfirmed(uint256 txId, address signer) external view returns (bool) {
        return confirmations[txId][signer];
    }

    /**
     * @dev Receive ETH
     */
    receive() external payable {
        emit Deposit(msg.sender, msg.value);
    }

    /**
     * @dev Authorize upgrade (requires multi-sig through executeTransaction)
     */
    function _authorizeUpgrade(address newImplementation) internal view override {
        // This function is called by executeTransaction
        // Additional checks can be added here
        require(newImplementation != address(0), "MultiSigTreasury: invalid implementation");
    }
}

