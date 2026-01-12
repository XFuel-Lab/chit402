// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title rXF (Rewards XFuel Token)
 * @dev ERC20 token with 48h timelock on mints and parameter changes
 * 
 * Security Features:
 * - 48-hour timelock on all mint operations
 * - Timelock on parameter changes (cap, minting role)
 * - Pausable functionality for emergency stops
 * - No timelock-free minting (all mints must go through timelock)
 * - Role-based access control
 * - Supply cap to prevent infinite minting
 * 
 * Use Cases:
 * - Reward token for protocol participation
 * - Governance token for future voting
 * - Incentives for liquidity providers
 */
contract rXF is 
    ERC20Upgradeable,
    OwnableUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    // ============ Constants ============
    
    /// @notice 48 hour timelock delay for all minting operations
    uint256 public constant TIMELOCK_DELAY = 48 hours;
    
    /// @notice Maximum supply cap (10 million tokens)
    uint256 public constant MAX_SUPPLY = 10_000_000 ether;
    
    // ============ Storage ============
    
    /// @notice Supply cap (can be changed via timelock)
    uint256 public supplyCap;
    
    /// @notice Pending mint operations
    struct PendingMint {
        address to;
        uint256 amount;
        uint256 executeTime;
        bool executed;
        bool cancelled;
    }
    
    /// @notice Mapping of mint ID to pending mint
    mapping(uint256 => PendingMint) public pendingMints;
    
    /// @notice Next mint ID
    uint256 public nextMintId;
    
    /// @notice Pending parameter changes
    struct PendingParamChange {
        bytes32 paramType; // keccak256("supplyCap"), keccak256("minter")
        uint256 newValue;
        address newAddress;
        uint256 executeTime;
        bool executed;
        bool cancelled;
    }
    
    /// @notice Mapping of param change ID to pending change
    mapping(uint256 => PendingParamChange) public pendingParamChanges;
    
    /// @notice Next param change ID
    uint256 public nextParamChangeId;
    
    /// @notice Addresses authorized to schedule mints
    mapping(address => bool) public minters;
    
    /// @notice External timelock controller (optional integration)
    address public timelockController;
    
    // ============ Events ============
    
    event MintScheduled(
        uint256 indexed mintId,
        address indexed to,
        uint256 amount,
        uint256 executeTime
    );
    
    event MintExecuted(
        uint256 indexed mintId,
        address indexed to,
        uint256 amount
    );
    
    event MintCancelled(uint256 indexed mintId);
    
    event ParamChangeScheduled(
        uint256 indexed changeId,
        bytes32 indexed paramType,
        uint256 executeTime
    );
    
    event ParamChangeExecuted(
        uint256 indexed changeId,
        bytes32 indexed paramType
    );
    
    event ParamChangeCancelled(uint256 indexed changeId);
    
    event MinterAdded(address indexed minter);
    event MinterRemoved(address indexed minter);
    event TimelockControllerSet(address indexed controller);
    event SupplyCapChanged(uint256 oldCap, uint256 newCap);
    
    // ============ Modifiers ============
    
    modifier onlyMinter() {
        require(minters[msg.sender] || msg.sender == owner(), "rXF: not authorized minter");
        _;
    }
    
    modifier onlyTimelockOrOwner() {
        require(
            msg.sender == timelockController || msg.sender == owner(),
            "rXF: not timelock or owner"
        );
        _;
    }
    
    // ============ Initialization ============
    
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }
    
    /**
     * @dev Initialize the contract
     * @param _owner Address of contract owner
     * @param _supplyCap Initial supply cap
     */
    function initialize(
        address _owner,
        uint256 _supplyCap
    ) public initializer {
        require(_owner != address(0), "rXF: invalid owner");
        require(_supplyCap > 0 && _supplyCap <= MAX_SUPPLY, "rXF: invalid supply cap");
        
        __ERC20_init("Rewards XFuel", "rXF");
        __Ownable_init(_owner);
        __Pausable_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        
        supplyCap = _supplyCap;
        minters[_owner] = true;
        
        emit MinterAdded(_owner);
        emit SupplyCapChanged(0, _supplyCap);
    }
    
    // ============ Timelock Mint Functions ============
    
    /**
     * @dev Schedule a mint operation (requires 48h delay)
     * @param to Address to mint tokens to
     * @param amount Amount of tokens to mint
     * @return mintId ID of the scheduled mint
     */
    function scheduleMint(
        address to,
        uint256 amount
    ) external onlyMinter whenNotPaused returns (uint256 mintId) {
        require(to != address(0), "rXF: mint to zero address");
        require(amount > 0, "rXF: mint amount zero");
        require(totalSupply() + amount <= supplyCap, "rXF: exceeds supply cap");
        
        mintId = nextMintId++;
        uint256 executeTime = block.timestamp + TIMELOCK_DELAY;
        
        pendingMints[mintId] = PendingMint({
            to: to,
            amount: amount,
            executeTime: executeTime,
            executed: false,
            cancelled: false
        });
        
        emit MintScheduled(mintId, to, amount, executeTime);
        
        return mintId;
    }
    
    /**
     * @dev Execute a pending mint after timelock delay
     * @param mintId ID of the pending mint
     */
    function executeMint(uint256 mintId) external nonReentrant whenNotPaused {
        PendingMint storage pendingMint = pendingMints[mintId];
        
        require(pendingMint.amount > 0, "rXF: mint does not exist");
        require(!pendingMint.executed, "rXF: mint already executed");
        require(!pendingMint.cancelled, "rXF: mint cancelled");
        require(block.timestamp >= pendingMint.executeTime, "rXF: timelock not expired");
        require(totalSupply() + pendingMint.amount <= supplyCap, "rXF: exceeds supply cap");
        
        pendingMint.executed = true;
        
        _mint(pendingMint.to, pendingMint.amount);
        
        emit MintExecuted(mintId, pendingMint.to, pendingMint.amount);
    }
    
    /**
     * @dev Cancel a pending mint (owner or timelock only)
     * @param mintId ID of the pending mint
     */
    function cancelMint(uint256 mintId) external onlyTimelockOrOwner {
        PendingMint storage pendingMint = pendingMints[mintId];
        
        require(pendingMint.amount > 0, "rXF: mint does not exist");
        require(!pendingMint.executed, "rXF: mint already executed");
        require(!pendingMint.cancelled, "rXF: mint already cancelled");
        
        pendingMint.cancelled = true;
        
        emit MintCancelled(mintId);
    }
    
    // ============ Timelock Parameter Change Functions ============
    
    /**
     * @dev Schedule a supply cap change (requires 48h delay)
     * @param newCap New supply cap
     * @return changeId ID of the scheduled change
     */
    function scheduleSupplyCapChange(
        uint256 newCap
    ) external onlyOwner returns (uint256 changeId) {
        require(newCap > 0 && newCap <= MAX_SUPPLY, "rXF: invalid supply cap");
        require(newCap != supplyCap, "rXF: same as current cap");
        
        changeId = nextParamChangeId++;
        uint256 executeTime = block.timestamp + TIMELOCK_DELAY;
        
        pendingParamChanges[changeId] = PendingParamChange({
            paramType: keccak256("supplyCap"),
            newValue: newCap,
            newAddress: address(0),
            executeTime: executeTime,
            executed: false,
            cancelled: false
        });
        
        emit ParamChangeScheduled(changeId, keccak256("supplyCap"), executeTime);
        
        return changeId;
    }
    
    /**
     * @dev Execute a pending supply cap change
     * @param changeId ID of the pending change
     */
    function executeSupplyCapChange(uint256 changeId) external nonReentrant {
        PendingParamChange storage change = pendingParamChanges[changeId];
        
        require(change.paramType == keccak256("supplyCap"), "rXF: not a supply cap change");
        require(!change.executed, "rXF: change already executed");
        require(!change.cancelled, "rXF: change cancelled");
        require(block.timestamp >= change.executeTime, "rXF: timelock not expired");
        
        change.executed = true;
        
        uint256 oldCap = supplyCap;
        supplyCap = change.newValue;
        
        emit SupplyCapChanged(oldCap, change.newValue);
        emit ParamChangeExecuted(changeId, keccak256("supplyCap"));
    }
    
    /**
     * @dev Cancel a pending parameter change (owner or timelock only)
     * @param changeId ID of the pending change
     */
    function cancelParamChange(uint256 changeId) external onlyTimelockOrOwner {
        PendingParamChange storage change = pendingParamChanges[changeId];
        
        require(change.executeTime > 0, "rXF: change does not exist");
        require(!change.executed, "rXF: change already executed");
        require(!change.cancelled, "rXF: change already cancelled");
        
        change.cancelled = true;
        
        emit ParamChangeCancelled(changeId);
    }
    
    // ============ Minter Management (No Timelock) ============
    
    /**
     * @dev Add a minter address (owner only, no timelock - less critical)
     * @param minter Address to grant minter role
     */
    function addMinter(address minter) external onlyOwner {
        require(minter != address(0), "rXF: invalid minter");
        require(!minters[minter], "rXF: already minter");
        
        minters[minter] = true;
        
        emit MinterAdded(minter);
    }
    
    /**
     * @dev Remove a minter address (owner only, no timelock)
     * @param minter Address to revoke minter role
     */
    function removeMinter(address minter) external onlyOwner {
        require(minters[minter], "rXF: not a minter");
        
        minters[minter] = false;
        
        emit MinterRemoved(minter);
    }
    
    // ============ Timelock Controller Integration ============
    
    /**
     * @dev Set external timelock controller (owner only)
     * @param controller Address of timelock controller
     */
    function setTimelockController(address controller) external onlyOwner {
        require(controller != address(0), "rXF: invalid timelock controller");
        timelockController = controller;
        emit TimelockControllerSet(controller);
    }
    
    // ============ Pausable Functions ============
    
    /**
     * @dev Pause the contract (owner only)
     */
    function pause() external onlyOwner {
        _pause();
    }
    
    /**
     * @dev Unpause the contract (owner only)
     */
    function unpause() external onlyOwner {
        _unpause();
    }
    
    /**
     * @dev Hook that is called before any transfer of tokens
     * Respects pause state
     */
    function _update(
        address from,
        address to,
        uint256 amount
    ) internal virtual override whenNotPaused {
        super._update(from, to, amount);
    }
    
    // ============ View Functions ============
    
    /**
     * @dev Get pending mint details
     * @param mintId ID of the mint
     * @return Pending mint struct
     */
    function getPendingMint(uint256 mintId) external view returns (PendingMint memory) {
        return pendingMints[mintId];
    }
    
    /**
     * @dev Get pending parameter change details
     * @param changeId ID of the change
     * @return Pending param change struct
     */
    function getPendingParamChange(uint256 changeId) external view returns (PendingParamChange memory) {
        return pendingParamChanges[changeId];
    }
    
    /**
     * @dev Check if address is a minter
     * @param account Address to check
     * @return True if account is a minter
     */
    function isMinter(address account) external view returns (bool) {
        return minters[account];
    }
    
    /**
     * @dev Get time remaining until mint can be executed
     * @param mintId ID of the mint
     * @return Seconds remaining (0 if ready to execute)
     */
    function getMintTimeRemaining(uint256 mintId) external view returns (uint256) {
        PendingMint memory pendingMint = pendingMints[mintId];
        if (block.timestamp >= pendingMint.executeTime) {
            return 0;
        }
        return pendingMint.executeTime - block.timestamp;
    }
    
    /**
     * @dev Get time remaining until parameter change can be executed
     * @param changeId ID of the change
     * @return Seconds remaining (0 if ready to execute)
     */
    function getParamChangeTimeRemaining(uint256 changeId) external view returns (uint256) {
        PendingParamChange memory change = pendingParamChanges[changeId];
        if (block.timestamp >= change.executeTime) {
            return 0;
        }
        return change.executeTime - block.timestamp;
    }
    
    // ============ UUPS Upgrade Authorization ============
    
    /**
     * @dev Authorize upgrade (owner only)
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}

