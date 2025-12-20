// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title veXF
 * @dev Vote-escrowed XF token (Curve-style) with UUPS upgradeability
 * Users lock XF tokens for a period (1-4 years) to receive veXF voting power
 * veXF balance decays linearly over time until unlock
 * Non-transferable voting power
 * Receives yield distribution from protocol revenue
 */
contract veXF is UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // XF token contract
    IERC20 public xfToken;

    // Lock duration constants (in seconds)
    uint256 public constant MIN_LOCK_DURATION = 1 weeks; // Minimum 1 week
    uint256 public constant MAX_LOCK_DURATION = 4 * 365 days; // Maximum 4 years
    uint256 public constant MAX_MULTIPLIER = 4; // 4x multiplier for max lock

    // Lock structure
    struct Lock {
        uint256 amount;        // Amount of XF locked
        uint256 unlockTime;    // Timestamp when lock expires
        uint256 lockTime;      // Timestamp when lock was created/extended
    }

    // User locks
    mapping(address => Lock) public locks;

    // Total veXF supply (sum of all voting power)
    uint256 public totalSupply;

    // User veXF balances (decaying voting power) - calculated on-demand
    mapping(address => uint256) private _cachedBalance;

    // Yield tracking
    mapping(address => uint256) public yieldEarned;
    uint256 public totalYieldDistributed;

    // Permanent multipliers (from ThetaPulseProof, in basis points, default 10000 = 1x)
    mapping(address => uint256) public permanentMultipliers;
    
    // Authorized address that can set permanent multipliers (ThetaPulseProof contract)
    address public multiplierSetter;

    // Events
    event LockCreated(
        address indexed user,
        uint256 amount,
        uint256 unlockTime,
        uint256 veXFAmount
    );
    event LockIncreased(
        address indexed user,
        uint256 additionalAmount,
        uint256 newTotalAmount
    );
    event LockExtended(
        address indexed user,
        uint256 newUnlockTime,
        uint256 newVeXFAmount
    );
    event Withdrawn(
        address indexed user,
        uint256 amount
    );
    event YieldDistributed(
        address indexed yieldToken,
        uint256 amount
    );
    event PermanentMultiplierSet(
        address indexed user,
        uint256 multiplier
    );
    event MultiplierSetterSet(
        address indexed setter
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initialize the contract (replaces constructor for upgradeable contracts)
     * @param _xfToken Address of XF token contract
     * @param _owner Address of contract owner
     */
    function initialize(
        address _xfToken,
        address _owner
    ) public initializer {
        require(_xfToken != address(0), "veXF: invalid XF token");
        require(_owner != address(0), "veXF: invalid owner");
        
        __Ownable_init(_owner);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        
        xfToken = IERC20(_xfToken);
    }

    /**
     * @dev Create a new lock or add to existing lock
     * @param amount Amount of XF to lock
     * @param unlockTime Timestamp when lock expires (must be in future, max 4 years)
     */
    function createLock(uint256 amount, uint256 unlockTime) external nonReentrant {
        require(amount > 0, "veXF: amount must be greater than 0");
        require(unlockTime > block.timestamp, "veXF: unlock time must be in future");
        
        uint256 lockDuration = unlockTime - block.timestamp;
        require(lockDuration >= MIN_LOCK_DURATION, "veXF: lock duration too short");
        require(lockDuration <= MAX_LOCK_DURATION, "veXF: lock duration too long");

        Lock storage userLock = locks[msg.sender];
        
        if (userLock.amount == 0) {
            // New lock
            userLock.amount = amount;
            userLock.unlockTime = unlockTime;
            userLock.lockTime = block.timestamp;
        } else {
            // Extend existing lock or increase amount
            require(unlockTime > userLock.unlockTime, "veXF: new unlock time must be later");
            userLock.amount += amount;
            userLock.unlockTime = unlockTime;
            // Keep original lockTime for decay calculation
        }

        // Transfer XF tokens from user
        xfToken.safeTransferFrom(msg.sender, address(this), amount);

        // Update veXF balance
        _updateBalance(msg.sender);

        emit LockCreated(msg.sender, userLock.amount, unlockTime, _calculateBalance(msg.sender));
    }

    /**
     * @dev Increase the amount of XF in an existing lock
     * @param amount Additional amount of XF to lock
     */
    function increaseAmount(uint256 amount) external nonReentrant {
        require(amount > 0, "veXF: amount must be greater than 0");
        
        Lock storage userLock = locks[msg.sender];
        require(userLock.amount > 0, "veXF: no existing lock");
        require(userLock.unlockTime > block.timestamp, "veXF: lock expired");

        // Transfer XF tokens from user
        xfToken.safeTransferFrom(msg.sender, address(this), amount);

        // Update lock amount
        userLock.amount += amount;

        // Update veXF balance
        _updateBalance(msg.sender);

        emit LockIncreased(msg.sender, amount, userLock.amount);
    }

    /**
     * @dev Extend the unlock time of an existing lock
     * @param unlockTime New unlock time (must be later than current)
     */
    function increaseUnlockTime(uint256 unlockTime) external nonReentrant {
        Lock storage userLock = locks[msg.sender];
        require(userLock.amount > 0, "veXF: no existing lock");
        require(unlockTime > userLock.unlockTime, "veXF: new unlock time must be later");
        
        uint256 lockDuration = unlockTime - block.timestamp;
        require(lockDuration <= MAX_LOCK_DURATION, "veXF: lock duration too long");

        // Update unlock time
        userLock.unlockTime = unlockTime;

        // Update veXF balance
        _updateBalance(msg.sender);

        emit LockExtended(msg.sender, unlockTime, _calculateBalance(msg.sender));
    }

    /**
     * @dev Withdraw XF tokens after lock expires
     */
    function withdraw() external nonReentrant {
        Lock storage userLock = locks[msg.sender];
        require(userLock.amount > 0, "veXF: no lock to withdraw");
        require(block.timestamp >= userLock.unlockTime, "veXF: lock not expired");

        uint256 amount = userLock.amount;

        // Clear lock
        delete locks[msg.sender];

        // Update veXF balance (will be 0 after withdrawal)
        _updateBalance(msg.sender);

        // Transfer XF tokens back to user
        xfToken.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @dev Get current voting power for an address (with decay)
     * @param account Address to check
     * @return Current veXF balance
     */
    function votingPower(address account) external view returns (uint256) {
        return _calculateBalance(account);
    }

    /**
     * @dev Set permanent multiplier for a user (called by ThetaPulseProof)
     * @param user Address of the user
     * @param multiplier Multiplier in basis points (10000 = 1x, 15000 = 1.5x, etc.)
     */
    function setPermanentMultiplier(address user, uint256 multiplier) external {
        require(msg.sender == multiplierSetter, "veXF: unauthorized");
        require(user != address(0), "veXF: invalid user");
        require(multiplier >= 10000, "veXF: multiplier must be >= 1x");
        
        permanentMultipliers[user] = multiplier;
        
        // Update balance if user has a lock
        if (locks[user].amount > 0) {
            _updateBalance(user);
        }
        
        emit PermanentMultiplierSet(user, multiplier);
    }

    /**
     * @dev Set the authorized address that can set permanent multipliers
     * @param _setter Address of the authorized setter (ThetaPulseProof contract)
     */
    function setMultiplierSetter(address _setter) external onlyOwner {
        require(_setter != address(0), "veXF: invalid setter");
        multiplierSetter = _setter;
        emit MultiplierSetterSet(_setter);
    }

    /**
     * @dev Distribute yield to veXF holders (called by RevenueSplitter)
     * @param yieldToken Address of yield token (e.g., USDC)
     * @param amount Amount of yield tokens to distribute
     */
    function distributeYield(address yieldToken, uint256 amount) external nonReentrant {
        require(yieldToken != address(0), "veXF: invalid yield token");
        require(amount > 0, "veXF: amount must be greater than 0");
        require(totalSupply > 0, "veXF: no veXF holders");

        // Transfer yield tokens from caller
        IERC20(yieldToken).safeTransferFrom(msg.sender, address(this), amount);

        // Distribute proportionally to all veXF holders
        // Note: In production, you might want to use a more efficient distribution mechanism
        // For Phase 1, we'll track total yield distributed
        totalYieldDistributed += amount;

        emit YieldDistributed(yieldToken, amount);
    }

    /**
     * @dev Claim yield for a specific user (simplified - in production, use claimable mapping)
     * @param yieldToken Address of yield token to claim
     * @param user Address to claim yield for
     */
    function claimYield(address yieldToken, address user) external nonReentrant {
        require(yieldToken != address(0), "veXF: invalid yield token");
        require(_calculateBalance(user) > 0, "veXF: no veXF balance");
        
        // Simplified yield claim - in production, implement proper accounting
        // For Phase 1, this is a placeholder
        uint256 claimable = _calculateClaimableYield(user);
        if (claimable > 0) {
            yieldEarned[user] += claimable;
            // In production, transfer actual yield tokens
            // IERC20(yieldToken).safeTransfer(user, claimable);
        }
    }

    /**
     * @dev Update veXF balance for an address (accounts for decay)
     * @param account Address to update
     */
    function _updateBalance(address account) internal {
        uint256 oldBalance = _cachedBalance[account];
        uint256 newBalance = _calculateBalance(account);

        if (newBalance > oldBalance) {
            totalSupply += (newBalance - oldBalance);
        } else if (newBalance < oldBalance) {
            totalSupply -= (oldBalance - newBalance);
        }

        _cachedBalance[account] = newBalance;
    }

    /**
     * @dev Calculate current veXF balance for an address (with linear decay)
     * @param account Address to calculate for
     * @return Current veXF balance
     */
    function _calculateBalance(address account) internal view returns (uint256) {
        Lock memory userLock = locks[account];
        
        if (userLock.amount == 0 || block.timestamp >= userLock.unlockTime) {
            return 0;
        }

        // Calculate time remaining in lock
        uint256 timeRemaining = userLock.unlockTime - block.timestamp;
        uint256 lockDuration = userLock.unlockTime - userLock.lockTime;

        // Calculate multiplier based on lock duration (linear from 1x to 4x)
        // multiplier = 1 + (3 * timeRemaining / lockDuration)
        // This gives 4x at max lock, decaying to 1x at unlock
        uint256 timeBasedMultiplier = 1e18 + (3e18 * timeRemaining) / lockDuration;

        // Apply permanent multiplier from ThetaPulseProof (in basis points, default 10000 = 1x)
        uint256 permanentMultiplier = permanentMultipliers[account];
        if (permanentMultiplier == 0) {
            permanentMultiplier = 10000; // Default 1x if not set
        }
        
        // Combine multipliers: timeBasedMultiplier (in 1e18) * permanentMultiplier (in basis points) / 10000
        uint256 combinedMultiplier = (timeBasedMultiplier * permanentMultiplier) / 10000;

        // veXF = XF * combinedMultiplier / 1e18
        return (userLock.amount * combinedMultiplier) / 1e18;
    }

    /**
     * @dev Calculate claimable yield for a user (simplified)
     * @param user Address to calculate for
     * @return Claimable yield amount
     */
    function _calculateClaimableYield(address user) internal view returns (uint256) {
        uint256 userBalance = _calculateBalance(user);
        if (totalSupply == 0 || userBalance == 0) {
            return 0;
        }
        // Simplified: proportional to veXF balance
        // In production, implement proper yield tracking
        return 0;
    }

    /**
     * @dev Get lock information for an address
     * @param account Address to query
     * @return lock Lock structure
     */
    function getLock(address account) external view returns (Lock memory lock) {
        return locks[account];
    }

    /**
     * @dev Get current veXF balance for an address (public view)
     * @param account Address to query
     * @return Current veXF balance
     */
    function balanceOf(address account) public view returns (uint256) {
        return _calculateBalance(account);
    }

    /**
     * @dev Authorize upgrade (UUPS)
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
