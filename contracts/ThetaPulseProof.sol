// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./veXF.sol";

/**
 * @title ThetaPulseProof
 * @dev Verify signed TPulse messages from Edge Nodes and grant permanent veXF multipliers
 * Edge Nodes sign messages containing earnings data, and this contract verifies the signatures
 * and grants multipliers based on proven earnings (up to 3x)
 */
contract ThetaPulseProof is UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    using MessageHashUtils for bytes32;
    using ECDSA for bytes32;

    // veXF contract
    veXF public veXFContract;

    // Authorized Edge Node signers (public keys of Edge Nodes)
    mapping(address => bool) public authorizedSigners;
    
    // Verified proofs mapping: user => nonce => verified
    mapping(address => mapping(uint256 => bool)) public verifiedProofs;
    
    // User earnings tracking (cumulative)
    mapping(address => uint256) public totalProvenEarnings;

    // Multiplier tiers based on earnings (in basis points)
    uint256 public constant TIER_1_EARNINGS = 10000 * 1e18; // 10k TFUEL = 1.5x multiplier
    uint256 public constant TIER_2_EARNINGS = 50000 * 1e18; // 50k TFUEL = 2x multiplier
    uint256 public constant TIER_3_EARNINGS = 100000 * 1e18; // 100k TFUEL = 3x multiplier
    
    uint256 public constant TIER_1_MULTIPLIER = 15000; // 1.5x (15000 basis points)
    uint256 public constant TIER_2_MULTIPLIER = 20000; // 2x (20000 basis points)
    uint256 public constant TIER_3_MULTIPLIER = 30000; // 3x (30000 basis points)

    // Events
    event ProofVerified(
        address indexed user,
        uint256 indexed nonce,
        uint256 earnings,
        uint256 totalEarnings,
        uint256 multiplierGranted
    );
    event SignerAuthorized(address indexed signer);
    event SignerRevoked(address indexed signer);
    event VeXFSet(address indexed veXF);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initialize the contract
     * @param _veXF Address of veXF contract
     * @param _owner Address of contract owner
     */
    function initialize(
        address _veXF,
        address _owner
    ) public initializer {
        require(_veXF != address(0), "ThetaPulseProof: invalid veXF");
        require(_owner != address(0), "ThetaPulseProof: invalid owner");
        
        __Ownable_init(_owner);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        
        veXFContract = veXF(_veXF);
    }

    /**
     * @dev Verify a TPulse message and grant multiplier based on proven earnings
     * @param user Address of the user who earned the revenue
     * @param earnings Amount of earnings (in wei, typically TFUEL)
     * @param nonce Unique nonce to prevent replay attacks
     * @param signature Signature from authorized Edge Node
     */
    function verifyProof(
        address user,
        uint256 earnings,
        uint256 nonce,
        bytes memory signature
    ) external nonReentrant {
        require(user != address(0), "ThetaPulseProof: invalid user");
        require(earnings > 0, "ThetaPulseProof: earnings must be > 0");
        require(!verifiedProofs[user][nonce], "ThetaPulseProof: proof already verified");

        // Create message hash: keccak256(abi.encodePacked(user, earnings, nonce, block.chainid))
        bytes32 messageHash = keccak256(abi.encodePacked(user, earnings, nonce, block.chainid));
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();

        // Recover signer from signature
        address signer = ethSignedMessageHash.recover(signature);
        require(authorizedSigners[signer], "ThetaPulseProof: unauthorized signer");

        // Mark proof as verified
        verifiedProofs[user][nonce] = true;

        // Update total proven earnings
        uint256 oldTotal = totalProvenEarnings[user];
        totalProvenEarnings[user] += earnings;
        uint256 newTotal = totalProvenEarnings[user];

        // Calculate and grant multiplier based on total earnings tier
        uint256 newMultiplier = _calculateMultiplier(newTotal);
        uint256 oldMultiplier = _calculateMultiplier(oldTotal);

        // Only update if multiplier increased
        if (newMultiplier > oldMultiplier) {
            veXFContract.setPermanentMultiplier(user, newMultiplier);
        }

        emit ProofVerified(user, nonce, earnings, newTotal, newMultiplier);
    }

    /**
     * @dev Calculate multiplier based on total proven earnings
     * @param totalEarnings Total proven earnings
     * @return Multiplier in basis points
     */
    function _calculateMultiplier(uint256 totalEarnings) internal pure returns (uint256) {
        if (totalEarnings >= TIER_3_EARNINGS) {
            return TIER_3_MULTIPLIER; // 3x
        } else if (totalEarnings >= TIER_2_EARNINGS) {
            return TIER_2_MULTIPLIER; // 2x
        } else if (totalEarnings >= TIER_1_EARNINGS) {
            return TIER_1_MULTIPLIER; // 1.5x
        }
        return 10000; // 1x (no bonus)
    }

    /**
     * @dev Get current multiplier for a user based on proven earnings
     * @param user Address to query
     * @return Multiplier in basis points
     */
    function getMultiplier(address user) external view returns (uint256) {
        return _calculateMultiplier(totalProvenEarnings[user]);
    }

    /**
     * @dev Authorize an Edge Node signer
     * @param signer Address of the Edge Node signer
     */
    function authorizeSigner(address signer) external onlyOwner {
        require(signer != address(0), "ThetaPulseProof: invalid signer");
        authorizedSigners[signer] = true;
        emit SignerAuthorized(signer);
    }

    /**
     * @dev Revoke an Edge Node signer
     * @param signer Address of the Edge Node signer to revoke
     */
    function revokeSigner(address signer) external onlyOwner {
        require(signer != address(0), "ThetaPulseProof: invalid signer");
        authorizedSigners[signer] = false;
        emit SignerRevoked(signer);
    }

    /**
     * @dev Set veXF contract address
     * @param _veXF Address of veXF contract
     */
    function setVeXF(address _veXF) external onlyOwner {
        require(_veXF != address(0), "ThetaPulseProof: invalid veXF");
        veXFContract = veXF(_veXF);
        emit VeXFSet(_veXF);
    }

    /**
     * @dev Authorize upgrade (UUPS)
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}

