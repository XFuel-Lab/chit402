// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./SubVault.sol";

/**
 * @title VaultFactory
 * @author xFuel Protocol (@XFuelLab)
 * @notice Factory contract for ZK bridge hybrid: deploys deterministic SubVault contracts using Create2.
 *         Each vault is uniquely identified by a salt derived from the user's persistence
 *         address and a nonce. Supports access control, pausable deposits, refunds, and
 *         UnwrapFromBurn (admin/ZK-triggered to unlock TFUEL when ibcTFUEL is burned on Persistence).
 * @dev Uses OpenZeppelin's AccessControl for role-based permissions and Pausable for
 *      emergency stops. The factory triggers unwrap operations on vaults via ZK bridge signals.
 */
contract VaultFactory is AccessControl, Pausable {
    /// @notice Role identifier for accounts that can pause deposits
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    
    /// @notice Role identifier for ZK bridge operators (can trigger unwrapFromBurn)
    bytes32 public constant ZK_BRIDGE_ROLE = keccak256("ZK_BRIDGE_ROLE");

    /// @notice Address of the RevenueSplitter contract (receives fees from deposits)
    address public revSplitter;

    /// @notice Mapping to track which vault addresses have been deployed
    mapping(address => bool) public isVault;

    /**
     * @notice Emitted when a new SubVault is created
     * @param vaultAddr The address of the newly deployed vault
     * @param salt The salt used for Create2 deployment
     * @param creator The address that initiated vault creation
     */
    event VaultCreated(address indexed vaultAddr, bytes32 indexed salt, address indexed creator);

    /**
     * @notice Emitted when the RevenueSplitter address is updated
     * @param oldRevSplitter The previous RevenueSplitter address
     * @param newRevSplitter The new RevenueSplitter address
     */
    event RevSplitterUpdated(address indexed oldRevSplitter, address indexed newRevSplitter);

    /**
     * @notice Emitted when a refund is initiated by admin
     * @param vault The vault from which funds are refunded
     * @param recipient The recipient of the refund
     * @param amount The amount refunded
     */
    event RefundInitiated(address indexed vault, address indexed recipient, uint256 amount);
    
    /**
     * @notice Emitted when UnwrapFromBurn is triggered (ZK bridge unlock)
     * @param vault The vault from which TFUEL is unlocked
     * @param burnTxHash The transaction hash from Persistence chain burn
     * @param recipient The recipient of unlocked TFUEL
     * @param amount The amount unlocked
     */
    event UnwrapFromBurnTriggered(
        address indexed vault,
        bytes32 indexed burnTxHash,
        address indexed recipient,
        uint256 amount
    );

    /**
     * @notice Error thrown when vault already exists at predicted address
     */
    error VaultAlreadyExists();

    /**
     * @notice Error thrown when attempting to refund from non-vault address
     */
    error NotAVault();

    /**
     * @notice Error thrown when zero address is provided where not allowed
     */
    error ZeroAddress();

    /**
     * @notice Constructor initializes the factory with admin and RevSplitter address
     * @param _admin The address that will have DEFAULT_ADMIN_ROLE, PAUSER_ROLE, and ZK_BRIDGE_ROLE
     * @param _revSplitter The address of the RevenueSplitter contract
     * @dev Grants DEFAULT_ADMIN_ROLE, PAUSER_ROLE, and ZK_BRIDGE_ROLE to the admin address
     */
    constructor(address _admin, address _revSplitter) {
        if (_admin == address(0) || _revSplitter == address(0)) {
            revert ZeroAddress();
        }

        revSplitter = _revSplitter;

        // Grant roles to admin
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(PAUSER_ROLE, _admin);
        _grantRole(ZK_BRIDGE_ROLE, _admin);
    }

    /**
     * @notice Creates a new SubVault using Create2 for deterministic deployment
     * @param salt The salt for Create2 deployment (typically keccak256(abi.encode(userAddress, nonce)))
     * @return vaultAddr The address of the newly created vault
     * @dev Reverts if contract is paused or if vault already exists at predicted address
     *      The salt should be unique per user to ensure unique vault addresses
     */
    function createVault(bytes32 salt) external whenNotPaused returns (address vaultAddr) {
        // Predict address first to check if vault already exists
        vaultAddr = predictAddress(salt);
        
        if (isVault[vaultAddr]) revert VaultAlreadyExists();

        // Deploy using Create2
        SubVault vault = new SubVault{salt: salt}(revSplitter);
        vaultAddr = address(vault);

        // Mark as deployed vault
        isVault[vaultAddr] = true;

        emit VaultCreated(vaultAddr, salt, msg.sender);
    }

    /**
     * @notice Predicts the address of a vault given a salt
     * @param salt The salt for Create2 deployment
     * @return The predicted address where the vault will be deployed
     * @dev Uses Create2 address calculation: keccak256(0xff ++ factory ++ salt ++ keccak256(bytecode))
     *      This allows users to know their vault address before deployment
     */
    function predictAddress(bytes32 salt) public view returns (address) {
        bytes memory bytecode = abi.encodePacked(
            type(SubVault).creationCode,
            abi.encode(revSplitter)
        );

        bytes32 hash = keccak256(
            abi.encodePacked(
                bytes1(0xff),
                address(this),
                salt,
                keccak256(bytecode)
            )
        );

        return address(uint160(uint256(hash)));
    }

    /**
     * @notice Generates a salt from user persistence address and nonce
     * @param userPersistenceAddress The user's persistence chain address (or any identifier)
     * @param nonce The nonce to ensure uniqueness (allows multiple vaults per user)
     * @return The generated salt for Create2 deployment
     * @dev This is a helper function. Users can also generate salts off-chain
     */
    function generateSalt(address userPersistenceAddress, uint256 nonce) 
        external 
        pure 
        returns (bytes32) 
    {
        return keccak256(abi.encode(userPersistenceAddress, nonce));
    }

    /**
     * @notice Updates the RevenueSplitter address (admin only)
     * @param _newRevSplitter The new RevenueSplitter address
     * @dev Only affects newly created vaults. Existing vaults maintain their original RevSplitter
     */
    function setRevSplitter(address _newRevSplitter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_newRevSplitter == address(0)) revert ZeroAddress();
        
        address oldRevSplitter = revSplitter;
        revSplitter = _newRevSplitter;

        emit RevSplitterUpdated(oldRevSplitter, _newRevSplitter);
    }

    /**
     * @notice Initiates a refund from a vault (admin only)
     * @param vault The vault address to refund from
     * @param recipient The address to receive the refund
     * @param amount The amount to refund
     * @dev Used for expired or stuck deposits. Only works on vaults deployed by this factory
     */
    function refundFromVault(
        address vault,
        address payable recipient,
        uint256 amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!isVault[vault]) revert NotAVault();
        
        SubVault(payable(vault)).refund(recipient, amount);

        emit RefundInitiated(vault, recipient, amount);
    }
    
    /**
     * @notice Triggers UnwrapFromBurn on a vault (admin/ZK bridge operator)
     * @param vault The vault address to unlock TFUEL from
     * @param burnTxHash The transaction hash from Persistence chain where ibcTFUEL was burned
     * @param recipient The original sender who should receive unlocked TFUEL
     * @param amount The amount of TFUEL to unlock
     * @dev Called by ZK bridge operator upon verified burn signal from Persistence chain
     *      Uses ZK_BRIDGE_ROLE for access control
     */
    function unwrapFromBurn(
        address vault,
        bytes32 burnTxHash,
        address payable recipient,
        uint256 amount
    ) external onlyRole(ZK_BRIDGE_ROLE) {
        if (!isVault[vault]) revert NotAVault();
        
        SubVault(payable(vault)).unwrapFromBurn(burnTxHash, recipient, amount);
        
        emit UnwrapFromBurnTriggered(vault, burnTxHash, recipient, amount);
    }

    /**
     * @notice Pauses vault creation (pauser role only)
     * @dev Emergency function to stop new vault creation if issues are detected
     */
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /**
     * @notice Unpauses vault creation (pauser role only)
     * @dev Resumes normal vault creation operations
     */
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /**
     * @notice Checks if an address is a vault deployed by this factory
     * @param _vault The address to check
     * @return True if the address is a vault, false otherwise
     */
    function isVaultDeployed(address _vault) external view returns (bool) {
        return isVault[_vault];
    }

    /**
     * @notice Returns the current RevenueSplitter address
     * @return The RevenueSplitter address
     */
    function getRevSplitter() external view returns (address) {
        return revSplitter;
    }
}

