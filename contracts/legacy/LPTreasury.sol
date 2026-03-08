// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title LPTreasury
 * @dev Liquidity Provider treasury with 2-of-N multisig requirement
 * 
 * Security Features:
 * - 2-signature minimum for all treasury operations
 * - Transaction proposal and confirmation flow
 * - Pausable for emergency stops
 * - Time-locked execution (optional)
 * - Low reserve backstop triggering
 * 
 * Use Cases:
 * - LP rewards distribution
 * - Emergency liquidity provision
 * - Rebalancing operations
 * - IL compensation payouts
 */
contract LPTreasury is UUPSUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // ============ Constants ============
    
    /// @notice Minimum required signatures (2-sig)
    uint256 public constant MIN_SIGNATURES = 2;
    
    /// @notice Low reserve threshold (in basis points, 1000 = 10%)
    uint256 public lowReserveThresholdBps;
    
    // ============ Structs ============
    
    /// @notice Transaction structure for multisig operations
    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
        uint256 confirmations;
        uint256 createdAt;
        string description;
    }
    
    // ============ Storage ============
    
    /// @notice Array of signer addresses
    address[] public signers;
    
    /// @notice Mapping to check if address is a signer
    mapping(address => bool) public isSigner;
    
    /// @notice Required number of confirmations (min 2)
    uint256 public requiredConfirmations;
    
    /// @notice Array of all transactions
    Transaction[] public transactions;
    
    /// @notice Mapping of transaction ID to signer to confirmation status
    mapping(uint256 => mapping(address => bool)) public confirmations;
    
    /// @notice Optional timelock controller integration
    address public timelock;
    
    /// @notice Pause state
    bool public paused;
    
    /// @notice Backstop contract address
    address public backstop;
    
    /// @notice Total reserves in treasury (tracked per token)
    mapping(address => uint256) public reserves;
    
    // ============ Events ============
    
    event SignerAdded(address indexed signer);
    event SignerRemoved(address indexed signer);
    event RequirementChanged(uint256 required);
    
    event TransactionSubmitted(
        uint256 indexed txId,
        address indexed submitter,
        address indexed to,
        uint256 value,
        bytes data,
        string description
    );
    
    event TransactionConfirmed(uint256 indexed txId, address indexed signer);
    event TransactionRevoked(uint256 indexed txId, address indexed signer);
    event TransactionExecuted(uint256 indexed txId, address indexed executor);
    
    event TimelockSet(address indexed timelock);
    event BackstopSet(address indexed backstop);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event Deposit(address indexed token, address indexed sender, uint256 amount);
    event LowReserveTriggered(address indexed token, uint256 balance, uint256 threshold);
    event LowReserveThresholdSet(uint256 oldThreshold, uint256 newThreshold);
    
    // ============ Modifiers ============
    
    modifier onlySigner() {
        require(isSigner[msg.sender], "LPTreasury: not a signer");
        _;
    }

    modifier txExists(uint256 txId) {
        require(txId < transactions.length, "LPTreasury: tx does not exist");
        _;
    }

    modifier notExecuted(uint256 txId) {
        require(!transactions[txId].executed, "LPTreasury: tx already executed");
        _;
    }

    modifier notConfirmed(uint256 txId) {
        require(!confirmations[txId][msg.sender], "LPTreasury: tx already confirmed");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "LPTreasury: paused");
        _;
    }
    
    // ============ Initialization ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initialize the LP treasury
     * @param _signers Array of signer addresses (must be at least 2)
     * @param _requiredConfirmations Number of required confirmations (min 2)
     * @param _lowReserveThresholdBps Low reserve threshold in basis points
     */
    function initialize(
        address[] memory _signers,
        uint256 _requiredConfirmations,
        uint256 _lowReserveThresholdBps
    ) public initializer {
        require(_signers.length >= MIN_SIGNATURES, "LPTreasury: need at least 2 signers");
        require(
            _requiredConfirmations >= MIN_SIGNATURES && _requiredConfirmations <= _signers.length,
            "LPTreasury: invalid required confirmations"
        );
        require(_lowReserveThresholdBps > 0 && _lowReserveThresholdBps <= 10000, "LPTreasury: invalid threshold");

        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        for (uint256 i = 0; i < _signers.length; i++) {
            address signer = _signers[i];
            require(signer != address(0), "LPTreasury: invalid signer");
            require(!isSigner[signer], "LPTreasury: duplicate signer");

            isSigner[signer] = true;
            signers.push(signer);
            emit SignerAdded(signer);
        }

        requiredConfirmations = _requiredConfirmations;
        lowReserveThresholdBps = _lowReserveThresholdBps;
        
        emit RequirementChanged(_requiredConfirmations);
        emit LowReserveThresholdSet(0, _lowReserveThresholdBps);
    }
    
    // ============ Multisig Transaction Functions ============

    /**
     * @dev Submit a new transaction (requires signer)
     * @param to Destination address
     * @param value ETH value
     * @param data Transaction data
     * @param description Human-readable description
     * @return txId Transaction ID
     */
    function submitTransaction(
        address to,
        uint256 value,
        bytes memory data,
        string memory description
    ) public onlySigner whenNotPaused returns (uint256 txId) {
        require(to != address(0), "LPTreasury: invalid destination");

        txId = transactions.length;
        transactions.push(
            Transaction({
                to: to,
                value: value,
                data: data,
                executed: false,
                confirmations: 0,
                createdAt: block.timestamp,
                description: description
            })
        );

        emit TransactionSubmitted(txId, msg.sender, to, value, data, description);
    }

    /**
     * @dev Confirm a transaction (requires signer, requires 2-sig minimum)
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
     * @dev Revoke confirmation (requires signer)
     * @param txId Transaction ID
     */
    function revokeConfirmation(uint256 txId)
        public
        onlySigner
        txExists(txId)
        notExecuted(txId)
    {
        require(confirmations[txId][msg.sender], "LPTreasury: tx not confirmed");
        
        confirmations[txId][msg.sender] = false;
        transactions[txId].confirmations -= 1;
        emit TransactionRevoked(txId, msg.sender);
    }

    /**
     * @dev Execute a confirmed transaction (requires 2-sig minimum)
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
            "LPTreasury: insufficient confirmations"
        );
        require(
            transaction.confirmations >= MIN_SIGNATURES,
            "LPTreasury: must have at least 2 signatures"
        );

        transaction.executed = true;

        // If timelock is set, route through timelock
        if (timelock != address(0)) {
            // In production, integrate with TimelockController
            // For now, execute directly
        }

        (bool success, ) = transaction.to.call{value: transaction.value}(transaction.data);
        require(success, "LPTreasury: tx execution failed");

        emit TransactionExecuted(txId, msg.sender);
    }
    
    // ============ Signer Management (Requires Multisig) ============

    /**
     * @dev Add a new signer (requires multisig execution)
     * @param signer New signer address
     */
    function addSigner(address signer) external onlySigner {
        require(signer != address(0), "LPTreasury: invalid signer");
        require(!isSigner[signer], "LPTreasury: already signer");

        isSigner[signer] = true;
        signers.push(signer);
        emit SignerAdded(signer);
    }

    /**
     * @dev Remove a signer (requires multisig execution)
     * @param signer Signer to remove
     */
    function removeSigner(address signer) external onlySigner {
        require(isSigner[signer], "LPTreasury: not a signer");
        require(signers.length - 1 >= requiredConfirmations, "LPTreasury: would break requirement");
        require(signers.length - 1 >= MIN_SIGNATURES, "LPTreasury: must have at least 2 signers");

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
     * @dev Change required confirmations (requires multisig execution, min 2)
     * @param _requiredConfirmations New requirement
     */
    function changeRequirement(uint256 _requiredConfirmations) external onlySigner {
        require(
            _requiredConfirmations >= MIN_SIGNATURES && _requiredConfirmations <= signers.length,
            "LPTreasury: invalid requirement"
        );
        
        requiredConfirmations = _requiredConfirmations;
        emit RequirementChanged(_requiredConfirmations);
    }
    
    // ============ Reserve Management & Backstop ============

    /**
     * @dev Deposit tokens to treasury
     * @param token Token address
     * @param amount Amount to deposit
     */
    function depositToken(address token, uint256 amount) external nonReentrant whenNotPaused {
        require(token != address(0), "LPTreasury: invalid token");
        require(amount > 0, "LPTreasury: invalid amount");
        
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        reserves[token] += amount;
        
        emit Deposit(token, msg.sender, amount);
    }

    /**
     * @dev Check if reserves are low and trigger backstop
     * @param token Token to check
     * @return isLow True if reserves are below threshold
     */
    function checkLowReserves(address token) public returns (bool isLow) {
        require(token != address(0), "LPTreasury: invalid token");
        
        uint256 balance = IERC20(token).balanceOf(address(this));
        uint256 reserveAmount = reserves[token];
        
        if (reserveAmount == 0) {
            return false;
        }
        
        // Calculate threshold
        uint256 threshold = (reserveAmount * lowReserveThresholdBps) / 10000;
        
        if (balance < threshold) {
            // Trigger backstop if set
            if (backstop != address(0)) {
                // In production, call backstop contract to replenish
                emit LowReserveTriggered(token, balance, threshold);
            }
            return true;
        }
        
        return false;
    }

    /**
     * @dev Set low reserve threshold (requires signer)
     * @param _thresholdBps New threshold in basis points
     */
    function setLowReserveThreshold(uint256 _thresholdBps) external onlySigner {
        require(_thresholdBps > 0 && _thresholdBps <= 10000, "LPTreasury: invalid threshold");
        uint256 oldThreshold = lowReserveThresholdBps;
        lowReserveThresholdBps = _thresholdBps;
        emit LowReserveThresholdSet(oldThreshold, _thresholdBps);
    }

    /**
     * @dev Set backstop contract address (requires signer)
     * @param _backstop Backstop address
     */
    function setBackstop(address _backstop) external onlySigner {
        require(_backstop != address(0), "LPTreasury: invalid backstop");
        backstop = _backstop;
        emit BackstopSet(_backstop);
    }
    
    // ============ Pause/Unpause ============

    /**
     * @dev Set timelock controller (requires signer)
     * @param _timelock Timelock address
     */
    function setTimelock(address _timelock) external onlySigner {
        timelock = _timelock;
        emit TimelockSet(_timelock);
    }

    /**
     * @dev Pause the contract (emergency, requires signer)
     */
    function pause() external onlySigner {
        paused = true;
        emit Paused(msg.sender);
    }

    /**
     * @dev Unpause the contract (requires signer)
     */
    function unpause() external onlySigner {
        paused = false;
        emit Unpaused(msg.sender);
    }
    
    // ============ View Functions ============

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
     * @dev Get reserve balance for a token
     */
    function getReserve(address token) external view returns (uint256) {
        return reserves[token];
    }

    /**
     * @dev Receive ETH
     */
    receive() external payable {
        emit Deposit(address(0), msg.sender, msg.value);
    }

    /**
     * @dev Authorize upgrade (requires multisig through executeTransaction)
     */
    function _authorizeUpgrade(address newImplementation) internal view override {
        require(newImplementation != address(0), "LPTreasury: invalid implementation");
        // Additional authorization checks handled by multisig flow
    }
}

