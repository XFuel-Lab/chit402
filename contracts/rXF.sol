// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./veXF.sol";

/**
 * @title rXF
 * @dev Soulbound revenue-backed receipt token
 * - Minted by RevenueSplitter (15% slice)
 * - Soulbound (revert on transfer)
 * - 4× veXF voting boost
 * - Priority flag for future spin-outs
 * - Redeem 1:1 XF after 365 days (or custom 12-month for investors)
 * - Admin mint for Early Strategic Believers at TGE
 * UUPS upgradeable contract
 */
contract rXF is UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // Token metadata
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;

    // Core contracts
    IERC20 public xfToken;              // XF token for redemption
    veXF public veXFContract;           // veXF contract for voting boost
    address public revenueSplitter;      // RevenueSplitter that mints rXF

    // Voting boost multiplier (4× = 400%)
    uint256 public constant VOTING_BOOST_MULTIPLIER = 4;

    // Redemption settings
    uint256 public constant DEFAULT_REDEMPTION_PERIOD = 365 days;
    mapping(address => uint256) public customRedemptionPeriods; // Custom periods for investors
    mapping(address => Receipt) public receipts; // User receipt data

    // Receipt structure
    struct Receipt {
        uint256 amount;           // Amount of rXF
        uint256 mintTime;         // Timestamp when minted
        uint256 redemptionPeriod; // Custom redemption period (0 = default)
        bool hasPriorityFlag;     // Priority flag for spin-outs
    }

    // Total supply tracking
    uint256 public totalSupply;

    // Balance tracking (soulbound - no transfers)
    mapping(address => uint256) private _balances;

    // Minter role (RevenueSplitter)
    mapping(address => bool) public minters;

    // Events
    event Minted(
        address indexed to,
        uint256 amount,
        uint256 redemptionPeriod,
        bool hasPriorityFlag
    );
    event Redeemed(
        address indexed user,
        uint256 rXFAmount,
        uint256 xfAmount
    );
    event MinterAdded(address indexed minter);
    event MinterRemoved(address indexed minter);
    event CustomRedemptionPeriodSet(address indexed user, uint256 period);
    event PriorityFlagSet(address indexed user, bool hasPriority);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initialize the contract
     * @param _xfToken Address of XF token contract
     * @param _veXF Address of veXF contract
     * @param _revenueSplitter Address of RevenueSplitter contract
     * @param _owner Address of contract owner
     */
    function initialize(
        address _xfToken,
        address _veXF,
        address _revenueSplitter,
        address _owner
    ) public initializer {
        require(_xfToken != address(0), "rXF: invalid XF token");
        require(_veXF != address(0), "rXF: invalid veXF");
        require(_revenueSplitter != address(0), "rXF: invalid revenue splitter");
        require(_owner != address(0), "rXF: invalid owner");

        __Ownable_init(_owner);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        name = "Revenue XF";
        symbol = "rXF";
        xfToken = IERC20(_xfToken);
        veXFContract = veXF(_veXF);
        revenueSplitter = _revenueSplitter;
        minters[_revenueSplitter] = true;
    }

    /**
     * @dev Mint rXF tokens (called by RevenueSplitter or admin)
     * @param to Address to mint to
     * @param amount Amount of rXF to mint
     * @param redemptionPeriod Custom redemption period (0 = default 365 days)
     * @param priorityFlag Whether recipient has priority flag
     */
    function mint(
        address to,
        uint256 amount,
        uint256 redemptionPeriod,
        bool priorityFlag
    ) external {
        require(minters[msg.sender] || msg.sender == owner(), "rXF: not authorized to mint");
        require(to != address(0), "rXF: mint to zero address");
        require(amount > 0, "rXF: amount must be greater than 0");

        // Use default period if 0 provided
        uint256 period = redemptionPeriod == 0 ? DEFAULT_REDEMPTION_PERIOD : redemptionPeriod;
        require(period >= 30 days, "rXF: redemption period too short");
        require(period <= 4 * 365 days, "rXF: redemption period too long");

        // Update or create receipt
        Receipt storage receipt = receipts[to];
        if (receipt.amount == 0) {
            // New receipt
            receipt.amount = amount;
            receipt.mintTime = block.timestamp;
            receipt.redemptionPeriod = period;
            receipt.hasPriorityFlag = priorityFlag;
        } else {
            // Add to existing receipt (use earliest mint time and shortest period)
            receipt.amount += amount;
            if (block.timestamp < receipt.mintTime) {
                receipt.mintTime = block.timestamp;
            }
            if (period < receipt.redemptionPeriod) {
                receipt.redemptionPeriod = period;
            }
            if (priorityFlag) {
                receipt.hasPriorityFlag = true;
            }
        }

        // Update balances
        _balances[to] += amount;
        totalSupply += amount;

        emit Minted(to, amount, period, priorityFlag);
    }

    /**
     * @dev Admin mint for Early Strategic Believers at TGE
     * @param recipients Array of recipient addresses
     * @param amounts Array of amounts to mint
     * @param redemptionPeriods Array of redemption periods (0 = default)
     * @param priorityFlags Array of priority flags
     */
    function adminMintBatch(
        address[] calldata recipients,
        uint256[] calldata amounts,
        uint256[] calldata redemptionPeriods,
        bool[] calldata priorityFlags
    ) external onlyOwner {
        require(
            recipients.length == amounts.length &&
            recipients.length == redemptionPeriods.length &&
            recipients.length == priorityFlags.length,
            "rXF: array length mismatch"
        );

        for (uint256 i = 0; i < recipients.length; i++) {
            this.mint(recipients[i], amounts[i], redemptionPeriods[i], priorityFlags[i]);
        }
    }

    /**
     * @dev Redeem rXF for XF tokens (1:1 ratio after redemption period)
     * @param amount Amount of rXF to redeem
     */
    function redeem(uint256 amount) external nonReentrant {
        require(amount > 0, "rXF: amount must be greater than 0");
        require(_balances[msg.sender] >= amount, "rXF: insufficient balance");

        Receipt storage receipt = receipts[msg.sender];
        require(receipt.amount > 0, "rXF: no receipt");
        require(amount <= receipt.amount, "rXF: amount exceeds receipt");

        // Check if redemption period has passed
        uint256 redemptionTime = receipt.mintTime + receipt.redemptionPeriod;
        require(block.timestamp >= redemptionTime, "rXF: redemption period not elapsed");

        // Update receipt
        receipt.amount -= amount;
        if (receipt.amount == 0) {
            delete receipts[msg.sender];
        }

        // Update balances
        _balances[msg.sender] -= amount;
        totalSupply -= amount;

        // Transfer XF tokens (1:1 ratio)
        xfToken.safeTransfer(msg.sender, amount);

        emit Redeemed(msg.sender, amount, amount);
    }

    /**
     * @dev Get boosted voting power (veXF voting power + 4× rXF balance)
     * @param account Address to check
     * @return Boosted voting power
     */
    function getBoostedVotingPower(address account) external view returns (uint256) {
        uint256 veXFPower = veXFContract.votingPower(account);
        uint256 rXFBalance = _balances[account];
        uint256 rXFBoost = rXFBalance * VOTING_BOOST_MULTIPLIER;
        return veXFPower + rXFBoost;
    }

    /**
     * @dev Get rXF voting boost amount (4× balance)
     * @param account Address to check
     * @return Voting boost amount
     */
    function getVotingBoost(address account) external view returns (uint256) {
        return (_balances[account] * VOTING_BOOST_MULTIPLIER);
    }

    /**
     * @dev Check if user has priority flag
     * @param account Address to check
     * @return Whether user has priority flag
     */
    function hasPriorityFlag(address account) external view returns (bool) {
        return receipts[account].hasPriorityFlag;
    }

    /**
     * @dev Check if user can redeem
     * @param account Address to check
     * @return Whether user can redeem
     * @return Amount that can be redeemed
     * @return Time until redemption available (0 if available)
     */
    function canRedeem(address account) external view returns (bool, uint256, uint256) {
        Receipt memory receipt = receipts[account];
        if (receipt.amount == 0) {
            return (false, 0, 0);
        }

        uint256 redemptionTime = receipt.mintTime + receipt.redemptionPeriod;
        if (block.timestamp >= redemptionTime) {
            return (true, receipt.amount, 0);
        } else {
            return (false, receipt.amount, redemptionTime - block.timestamp);
        }
    }

    /**
     * @dev Set custom redemption period for an investor
     * @param investor Address of investor
     * @param period Custom redemption period in seconds
     */
    function setCustomRedemptionPeriod(address investor, uint256 period) external onlyOwner {
        require(investor != address(0), "rXF: invalid investor");
        require(period >= 30 days, "rXF: redemption period too short");
        require(period <= 4 * 365 days, "rXF: redemption period too long");

        customRedemptionPeriods[investor] = period;
        if (receipts[investor].amount > 0) {
            receipts[investor].redemptionPeriod = period;
        }

        emit CustomRedemptionPeriodSet(investor, period);
    }

    /**
     * @dev Set priority flag for a user
     * @param user Address of user
     * @param hasPriority Whether user has priority flag
     */
    function setPriorityFlag(address user, bool hasPriority) external onlyOwner {
        require(user != address(0), "rXF: invalid user");
        receipts[user].hasPriorityFlag = hasPriority;
        emit PriorityFlagSet(user, hasPriority);
    }

    /**
     * @dev Add a minter address (e.g., RevenueSplitter)
     * @param minter Address to add as minter
     */
    function addMinter(address minter) external onlyOwner {
        require(minter != address(0), "rXF: invalid minter");
        minters[minter] = true;
        emit MinterAdded(minter);
    }

    /**
     * @dev Remove a minter address
     * @param minter Address to remove as minter
     */
    function removeMinter(address minter) external onlyOwner {
        minters[minter] = false;
        emit MinterRemoved(minter);
    }

    /**
     * @dev Set veXF contract address
     */
    function setVeXF(address _veXF) external onlyOwner {
        require(_veXF != address(0), "rXF: invalid veXF");
        veXFContract = veXF(_veXF);
    }

    /**
     * @dev Set XF token address
     */
    function setXFToken(address _xfToken) external onlyOwner {
        require(_xfToken != address(0), "rXF: invalid XF token");
        xfToken = IERC20(_xfToken);
    }

    /**
     * @dev Set RevenueSplitter address
     */
    function setRevenueSplitter(address _revenueSplitter) external onlyOwner {
        require(_revenueSplitter != address(0), "rXF: invalid revenue splitter");
        revenueSplitter = _revenueSplitter;
    }

    // ERC20-like view functions (soulbound - no transfers)

    /**
     * @dev Get balance of an address
     * @param account Address to check
     * @return Balance
     */
    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    /**
     * @dev Get receipt information for an address
     * @param account Address to check
     * @return Receipt information
     */
    function getReceipt(address account) external view returns (Receipt memory) {
        return receipts[account];
    }

    // Soulbound: Override transfer functions to revert

    /**
     * @dev Revert on transfer (soulbound token)
     */
    function transfer(address, uint256) external pure returns (bool) {
        revert("rXF: soulbound token - transfers not allowed");
    }

    /**
     * @dev Revert on transferFrom (soulbound token)
     */
    function transferFrom(address, address, uint256) external pure returns (bool) {
        revert("rXF: soulbound token - transfers not allowed");
    }

    /**
     * @dev Revert on approve (soulbound token - no approvals needed)
     */
    function approve(address, uint256) external pure returns (bool) {
        revert("rXF: soulbound token - approvals not allowed");
    }

    /**
     * @dev Always return 0 for allowance (soulbound token)
     */
    function allowance(address, address) external pure returns (uint256) {
        return 0;
    }

    /**
     * @dev Authorize upgrade (UUPS)
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}

