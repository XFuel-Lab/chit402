// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title CommunityEngagementDistributor
 * @author XFuel Protocol
 * @notice Merkle-based claims for the Community Engagement Rewards bucket (15% / 150M XF cap in policy).
 *         Operators publish per-season roots (e.g. quarterly snapshots). Lifetime XF out cannot exceed `maxLifetimeXF`.
 *
 *         Leaf format (OpenZeppelin-style double hash): keccak256(bytes.concat(keccak256(abi.encode(account, amount)))).
 *
 *         Fee-matching and milestone lotteries are orchestrated off-chain → roots on-chain; see docs/COMMUNITY_ENGAGEMENT_REWARDS.md.
 */
contract CommunityEngagementDistributor is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    IERC20 public immutable xfToken;
    uint256 public immutable maxLifetimeXF;

    uint256 public nextSeasonId;
    uint256 public totalClaimedAllTime;

    mapping(uint256 => bytes32) public seasonRoot;
    mapping(uint256 => mapping(address => bool)) public seasonClaimed;

    event SeasonPublished(uint256 indexed seasonId, bytes32 root);
    event Claimed(uint256 indexed seasonId, address indexed account, uint256 amount);
    event Funded(address indexed from, uint256 amount);

    error InvalidSeason();
    error AlreadyClaimed();
    error InvalidProof();
    error ExceedsLifetimeCap();
    error ZeroAmount();

    constructor(address _admin, IERC20 _xfToken, uint256 _maxLifetimeXF) {
        require(_admin != address(0), "ZeroAdmin");
        require(address(_xfToken) != address(0), "ZeroToken");
        require(_maxLifetimeXF > 0, "ZeroCap");

        xfToken = _xfToken;
        maxLifetimeXF = _maxLifetimeXF;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(OPERATOR_ROLE, _admin);
    }

    /// @notice Pull XF from caller into this contract for claims.
    function fund(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        xfToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount);
    }

    /// @notice Register a new Merkle root for a distribution season (snapshot).
    function publishSeason(bytes32 root) external onlyRole(OPERATOR_ROLE) returns (uint256 seasonId) {
        require(root != bytes32(0), "ZeroRoot");
        seasonId = nextSeasonId++;
        seasonRoot[seasonId] = root;
        emit SeasonPublished(seasonId, root);
    }

    /**
     * @param seasonId Published season.
     * @param amount XF amount (wei) allocated to msg.sender in the tree.
     * @param proof Merkle proof for leaf keccak256(bytes.concat(keccak256(abi.encode(msg.sender, amount)))).
     */
    function claim(uint256 seasonId, uint256 amount, bytes32[] calldata proof) external nonReentrant {
        if (seasonRoot[seasonId] == bytes32(0)) revert InvalidSeason();
        if (seasonClaimed[seasonId][msg.sender]) revert AlreadyClaimed();
        if (amount == 0) revert ZeroAmount();
        if (totalClaimedAllTime + amount > maxLifetimeXF) revert ExceedsLifetimeCap();

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, amount))));
        if (!MerkleProof.verify(proof, seasonRoot[seasonId], leaf)) revert InvalidProof();

        seasonClaimed[seasonId][msg.sender] = true;
        totalClaimedAllTime += amount;

        xfToken.safeTransfer(msg.sender, amount);
        emit Claimed(seasonId, msg.sender, amount);
    }
}
