// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./veXF.sol";
import "./rXF.sol";
import "./BuybackBurner.sol";

/**
 * @title RevenueSplitter
 * @dev Collects protocol revenue and distributes according to tokenomics:
 * Phase 1: 90% to veXF holders (yield) + 10% to Treasury
 * Phase 2: 50% veXF yield, 25% buyback/burn, 15% rXF, 10% Treasury
 * UUPS upgradeable contract
 */
contract RevenueSplitter is UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // Revenue split constants (in basis points)
    // Phase 2: 50% veXF yield, 25% buyback/burn, 15% rXF, 10% Treasury
    uint256 public constant VEXF_YIELD_BPS = 5000;      // 50% to veXF yield (Phase 2)
    uint256 public constant BUYBACK_BURN_BPS = 2500;    // 25% to buyback/burn (Phase 2)
    uint256 public constant RXF_MINT_BPS = 1500;        // 15% to rXF mint (Phase 2)
    uint256 public constant TREASURY_BPS = 1000;        // 10% to Treasury
    uint256 public constant TOTAL_BPS = 10000;          // 100%

    // Contract addresses
    veXF public veXFContract;
    address public treasury;
    BuybackBurner public buybackBurner;  // Phase 2: BuybackBurner contract
    rXF public rXFContract;              // Phase 2: rXF contract

    // Revenue token (e.g., USDC)
    IERC20 public revenueToken;

    // Tracking
    uint256 public totalRevenueCollected;
    uint256 public totalYieldDistributed;
    uint256 public totalBuybackBurned;
    uint256 public totalRXFMinted;
    uint256 public totalTreasurySent;

    // Mainnet Beta Testing Safety Limits
    uint256 public maxSwapAmount;            // Max per swap (default: 1,000 TFUEL)
    uint256 public totalUserLimit;           // Max total per user (default: 5,000 TFUEL)
    mapping(address => uint256) public userTotalSwapped;
    bool public paused;                      // Emergency pause switch

    // Events
    event RevenueCollected(
        address indexed token,
        uint256 amount,
        address indexed source
    );
    event RevenueSplit(
        uint256 veXFYield,
        uint256 buybackBurn,
        uint256 rXFMint,
        uint256 treasury
    );
    event VeXFSet(address indexed veXF);
    event TreasurySet(address indexed treasury);
    event BuybackBurnerSet(address indexed buybackBurner);
    event RXFSet(address indexed rXF);
    event RevenueTokenSet(address indexed token);
    event SwapLimitUpdated(uint256 maxSwapAmount, uint256 totalUserLimit);
    event PauseToggled(bool paused);
    event UserSwapRecorded(address indexed user, uint256 amount, uint256 totalSwapped);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initialize the contract (replaces constructor for upgradeable contracts)
     * @param _revenueToken Address of revenue token (e.g., USDC)
     * @param _veXF Address of veXF contract
     * @param _treasury Address of treasury
     * @param _owner Address of contract owner
     */
    function initialize(
        address _revenueToken,
        address _veXF,
        address _treasury,
        address _owner
    ) public initializer {
        require(_revenueToken != address(0), "RevenueSplitter: invalid revenue token");
        require(_veXF != address(0), "RevenueSplitter: invalid veXF");
        require(_treasury != address(0), "RevenueSplitter: invalid treasury");
        require(_owner != address(0), "RevenueSplitter: invalid owner");

        __Ownable_init(_owner);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        revenueToken = IERC20(_revenueToken);
        veXFContract = veXF(_veXF);
        treasury = _treasury;

        // Initialize mainnet beta testing limits
        maxSwapAmount = 1000 * 1e18;      // 1,000 TFUEL per swap
        totalUserLimit = 5000 * 1e18;     // 5,000 TFUEL total per user
        paused = false;

        emit RevenueTokenSet(_revenueToken);
        emit VeXFSet(_veXF);
        emit TreasurySet(_treasury);
    }

    /**
     * @dev Collect and split protocol revenue
     * @param amount Amount of revenue tokens to split
     */
    function splitRevenue(uint256 amount) external nonReentrant {
        require(!paused, "RevenueSplitter: contract is paused");
        require(amount > 0, "RevenueSplitter: amount must be greater than 0");
        require(amount <= maxSwapAmount, "RevenueSplitter: amount exceeds max swap limit");
        
        // Track by msg.sender for proper per-caller limits (beta safety)
        address user = msg.sender;
        require(userTotalSwapped[user] + amount <= totalUserLimit, "RevenueSplitter: user total limit exceeded");

        // Update user's total swapped amount
        userTotalSwapped[user] += amount;
        emit UserSwapRecorded(user, amount, userTotalSwapped[user]);

        // Transfer revenue from caller
        revenueToken.safeTransferFrom(msg.sender, address(this), amount);

        totalRevenueCollected += amount;

        emit RevenueCollected(address(revenueToken), amount, msg.sender);

        // Calculate splits (Phase 2: 50% veXF yield, 25% buyback, 15% rXF, 10% treasury)
        uint256 veXFYieldAmount = (amount * VEXF_YIELD_BPS) / TOTAL_BPS;
        uint256 buybackBurnAmount = (amount * BUYBACK_BURN_BPS) / TOTAL_BPS;
        uint256 rXFMintAmount = (amount * RXF_MINT_BPS) / TOTAL_BPS;
        uint256 treasuryAmount = (amount * TREASURY_BPS) / TOTAL_BPS;

        // Verify total matches (handle rounding)
        uint256 totalSplit = veXFYieldAmount + buybackBurnAmount + rXFMintAmount + treasuryAmount;
        if (totalSplit < amount) {
            // Add remainder to veXF yield (Phase 2)
            veXFYieldAmount += (amount - totalSplit);
        }

        // Distribute to veXF yield (50% in Phase 2)
        if (veXFYieldAmount > 0) {
            revenueToken.safeIncreaseAllowance(address(veXFContract), veXFYieldAmount);
            veXFContract.distributeYield(address(revenueToken), veXFYieldAmount);
            totalYieldDistributed += veXFYieldAmount;
        }

        // Phase 2: Buyback/burn (25% in Phase 2)
        // Transfer revenue to BuybackBurner and trigger buyback
        if (buybackBurnAmount > 0) {
            require(address(buybackBurner) != address(0), "RevenueSplitter: buybackBurner not set");
            revenueToken.safeIncreaseAllowance(address(buybackBurner), buybackBurnAmount);
            buybackBurner.receiveRevenue(buybackBurnAmount);
            totalBuybackBurned += buybackBurnAmount;
        }

        // Phase 2: rXF mint (15% in Phase 2)
        // Mint rXF tokens 1:1 with revenue amount (same decimals assumed)
        // Mint to the caller who triggered the revenue split
        if (rXFMintAmount > 0) {
            require(address(rXFContract) != address(0), "RevenueSplitter: rXF not set");
            // Mint rXF 1:1 with revenue amount (in same token units)
            // Using default redemption period (365 days) and no priority flag
            rXFContract.mint(msg.sender, rXFMintAmount, 0, false);
            totalRXFMinted += rXFMintAmount;
        }

        // Send to Treasury (10%)
        if (treasuryAmount > 0) {
            revenueToken.safeTransfer(treasury, treasuryAmount);
            totalTreasurySent += treasuryAmount;
        }

        emit RevenueSplit(veXFYieldAmount, buybackBurnAmount, rXFMintAmount, treasuryAmount);
    }

    /**
     * @dev Collect and split revenue from native token (TFUEL)
     * Note: For Phase 2, splits according to 50% veXF, 25% buyback, 15% rXF, 10% treasury
     * In production, swap TFUEL to USDC first, then split
     */
    function splitRevenueNative() external payable nonReentrant {
        require(!paused, "RevenueSplitter: contract is paused");
        require(msg.value > 0, "RevenueSplitter: amount must be greater than 0");
        require(msg.value <= maxSwapAmount, "RevenueSplitter: amount exceeds max swap limit");
        
        // Track by msg.sender for proper per-caller limits (beta safety)
        address user = msg.sender;
        require(userTotalSwapped[user] + msg.value <= totalUserLimit, "RevenueSplitter: user total limit exceeded");

        // Update user's total swapped amount
        userTotalSwapped[user] += msg.value;
        emit UserSwapRecorded(user, msg.value, userTotalSwapped[user]);

        totalRevenueCollected += msg.value;

        emit RevenueCollected(address(0), msg.value, msg.sender);

        // Phase 1: For native token, split according to 90/10 rule
        // Calculate splits (90% veXF, 10% treasury)
        uint256 veXFAmount = (msg.value * VEXF_YIELD_BPS) / TOTAL_BPS;
        uint256 treasuryAmount = (msg.value * TREASURY_BPS) / TOTAL_BPS;
        
        // Handle rounding
        if (veXFAmount + treasuryAmount < msg.value) {
            veXFAmount += (msg.value - veXFAmount - treasuryAmount);
        }

        // Send 90% to treasury (for now, as placeholder - in production, swap to revenue token first)
        // TODO: In production, swap TFUEL to revenue token, then distribute to veXF
        // For Phase 1, we send all to treasury as a placeholder until swap mechanism is implemented
        (bool success, ) = payable(treasury).call{value: msg.value}("");
        require(success, "RevenueSplitter: treasury transfer failed");
    }

    /**
     * @dev Set veXF contract address
     */
    function setVeXF(address _veXF) external onlyOwner {
        require(_veXF != address(0), "RevenueSplitter: invalid veXF");
        veXFContract = veXF(_veXF);
        emit VeXFSet(_veXF);
    }

    /**
     * @dev Set Treasury address
     */
    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "RevenueSplitter: invalid treasury");
        treasury = _treasury;
        emit TreasurySet(_treasury);
    }

    /**
     * @dev Set BuybackBurner address (Phase 2)
     */
    function setBuybackBurner(address _buybackBurner) external onlyOwner {
        require(_buybackBurner != address(0), "RevenueSplitter: invalid buyback burner");
        buybackBurner = BuybackBurner(_buybackBurner);
        emit BuybackBurnerSet(_buybackBurner);
    }

    /**
     * @dev Set rXF contract address (Phase 2)
     */
    function setRXF(address _rXF) external onlyOwner {
        require(_rXF != address(0), "RevenueSplitter: invalid rXF");
        rXFContract = rXF(_rXF);
        emit RXFSet(_rXF);
    }

    /**
     * @dev Set revenue token address
     */
    function setRevenueToken(address _revenueToken) external onlyOwner {
        require(_revenueToken != address(0), "RevenueSplitter: invalid revenue token");
        revenueToken = IERC20(_revenueToken);
        emit RevenueTokenSet(_revenueToken);
    }

    /**
     * @dev Update swap limits (owner only)
     * @param _maxSwapAmount New max per swap (in wei)
     * @param _totalUserLimit New total limit per user (in wei)
     */
    function updateSwapLimits(uint256 _maxSwapAmount, uint256 _totalUserLimit) external onlyOwner {
        require(_maxSwapAmount > 0, "RevenueSplitter: max swap amount must be greater than 0");
        require(_totalUserLimit >= _maxSwapAmount, "RevenueSplitter: total limit must be >= max swap");
        
        maxSwapAmount = _maxSwapAmount;
        totalUserLimit = _totalUserLimit;
        
        emit SwapLimitUpdated(_maxSwapAmount, _totalUserLimit);
    }

    /**
     * @dev Toggle pause state (owner only) - emergency kill switch
     * @param _paused New pause state
     */
    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PauseToggled(_paused);
    }

    /**
     * @dev Reset user's swap total (owner only) - for exceptions
     * @param user Address of user to reset
     */
    function resetUserSwapTotal(address user) external onlyOwner {
        userTotalSwapped[user] = 0;
    }

    /**
     * @dev Initialize beta limits (for upgrades - only if not already set)
     * Can be called by owner after upgrade to set initial limits
     */
    function initializeBetaLimits() external onlyOwner {
        // Only initialize if not already set (allows safe re-initialization on upgrade)
        if (maxSwapAmount == 0) {
            maxSwapAmount = 1000 * 1e18;      // 1,000 TFUEL per swap
            totalUserLimit = 5000 * 1e18;     // 5,000 TFUEL total per user
            paused = false;
            emit SwapLimitUpdated(maxSwapAmount, totalUserLimit);
        }
    }

    /**
     * @dev Get current split amounts for a given revenue amount
     * @param amount Revenue amount to calculate splits for
     * @return veXFYield Yield amount for veXF
     * @return buybackBurn Buyback/burn amount
     * @return rXFMint rXF mint amount
     * @return treasuryAmount Treasury amount
     */
    function calculateSplits(uint256 amount) external pure returns (
        uint256 veXFYield,
        uint256 buybackBurn,
        uint256 rXFMint,
        uint256 treasuryAmount
    ) {
        veXFYield = (amount * VEXF_YIELD_BPS) / TOTAL_BPS;
        buybackBurn = (amount * BUYBACK_BURN_BPS) / TOTAL_BPS;
        rXFMint = (amount * RXF_MINT_BPS) / TOTAL_BPS;
        treasuryAmount = (amount * TREASURY_BPS) / TOTAL_BPS;

        // Handle rounding (Phase 2: remainder goes to veXF yield)
        uint256 total = veXFYield + buybackBurn + rXFMint + treasuryAmount;
        if (total < amount) {
            veXFYield += (amount - total);
        }
    }

    /**
     * @dev Emergency withdraw (owner only)
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        if (token == address(0)) {
            (bool success, ) = payable(owner()).call{value: amount}("");
            require(success, "RevenueSplitter: withdraw failed");
        } else {
            IERC20(token).safeTransfer(owner(), amount);
        }
    }

    /**
     * @dev Authorize upgrade (UUPS)
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
