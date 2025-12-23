// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./ISwapRouter.sol";

/**
 * @title BuybackBurner
 * @dev Receives 25% revenue slice from RevenueSplitter, swaps for XF tokens, and burns them
 * UUPS upgradeable contract
 */
contract BuybackBurner is UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // Core contracts
    IERC20 public revenueToken;  // Revenue token (e.g., USDC)
    IERC20 public xfToken;         // XF token to buy and burn
    address public revenueSplitter; // RevenueSplitter that sends revenue

    // Swap router interface (can be DEX router or custom swap contract)
    // When set, automatically executes swaps. When zero, manual mode via recordBuyback()
    address public swapRouter;
    
    // Tracking
    uint256 public totalRevenueReceived;
    uint256 public totalXFBurned;
    uint256 public totalRevenueSwapped;

    // Events
    event RevenueReceived(address indexed token, uint256 amount);
    event BuybackExecuted(uint256 revenueAmount, uint256 xfAmount);
    event XFBurned(uint256 amount);
    event SwapRouterSet(address indexed router);
    event RevenueTokenSet(address indexed token);
    event XFTokenSet(address indexed token);
    event RevenueSplitterSet(address indexed splitter);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initialize the contract
     * @param _revenueToken Address of revenue token (e.g., USDC)
     * @param _xfToken Address of XF token
     * @param _swapRouter Address of swap router (can be zero for manual swaps)
     * @param _owner Address of contract owner
     */
    function initialize(
        address _revenueToken,
        address _xfToken,
        address _swapRouter,
        address _owner
    ) public initializer {
        require(_revenueToken != address(0), "BuybackBurner: invalid revenue token");
        require(_xfToken != address(0), "BuybackBurner: invalid XF token");
        require(_owner != address(0), "BuybackBurner: invalid owner");

        __Ownable_init(_owner);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        revenueToken = IERC20(_revenueToken);
        xfToken = IERC20(_xfToken);
        swapRouter = _swapRouter;
    }

    /**
     * @dev Receive revenue from RevenueSplitter and execute buyback + burn
     * This function is called by RevenueSplitter after approving revenue tokens
     * @param amount Amount of revenue tokens to receive
     */
    function receiveRevenue(uint256 amount) external nonReentrant {
        require(amount > 0, "BuybackBurner: amount must be greater than 0");
        require(msg.sender == revenueSplitter || msg.sender == owner(), "BuybackBurner: unauthorized");

        // Transfer revenue tokens from caller (RevenueSplitter has approved)
        revenueToken.safeTransferFrom(msg.sender, address(this), amount);

        totalRevenueReceived += amount;

        emit RevenueReceived(address(revenueToken), amount);

        // Execute buyback and burn
        _executeBuybackAndBurn(amount);
    }

    /**
     * @dev Execute buyback and burn (internal)
     * @param revenueAmount Amount of revenue tokens to swap
     */
    function _executeBuybackAndBurn(uint256 revenueAmount) internal {
        if (swapRouter == address(0)) {
            // No swap router set - hold revenue until manual swap via recordBuyback()
            // Revenue tokens are held in this contract until owner executes manual swap
            return;
        }

        // Approve swap router to spend revenue tokens
        // Using safeIncreaseAllowance for compatibility (forceApprove requires zero allowance first)
        revenueToken.safeIncreaseAllowance(swapRouter, revenueAmount);

        // Execute swap via router
        // Note: This uses ISwapRouter interface - actual router must implement this interface
        // Minimum output is set to 0 for now - in production, calculate from price oracle
        uint256 amountOutMin = 0; // TODO: Add slippage protection based on price oracle
        uint256 xfAmount = ISwapRouter(swapRouter).swap(
            address(revenueToken),
            address(xfToken),
            revenueAmount,
            amountOutMin,
            address(this) // Receive XF tokens to this contract for burning
        );

        // Update tracking
        totalRevenueSwapped += revenueAmount;
        totalXFBurned += xfAmount;

        emit BuybackExecuted(revenueAmount, xfAmount);

        // Burn XF tokens
        _burnXF(xfAmount);
    }

    /**
     * @dev Burn XF tokens
     * @param amount Amount of XF tokens to burn
     */
    function _burnXF(uint256 amount) internal {
        require(amount > 0, "BuybackBurner: burn amount must be greater than 0");
        
        // Transfer XF to this contract if not already here
        // Then burn by transferring to zero address or using burn function
        // If XF token has burn function, use it; otherwise transfer to zero address
        xfToken.safeTransfer(address(0), amount);

        emit XFBurned(amount);
    }

    /**
     * @dev Manual buyback and burn (owner only, for cases where automatic swap fails)
     * @param revenueAmount Amount of revenue tokens to use
     */
    function manualBuybackAndBurn(uint256 revenueAmount) external onlyOwner nonReentrant {
        require(revenueAmount > 0, "BuybackBurner: amount must be greater than 0");
        require(revenueToken.balanceOf(address(this)) >= revenueAmount, "BuybackBurner: insufficient balance");

        _executeBuybackAndBurn(revenueAmount);
    }

    /**
     * @dev Execute buyback with custom swap (owner only)
     * Allows owner to execute swap manually if automatic swap fails
     * @param xfAmount Amount of XF tokens received from swap (for tracking)
     */
    function recordBuyback(uint256 xfAmount) external onlyOwner {
        require(xfAmount > 0, "BuybackBurner: amount must be greater than 0");
        
        totalXFBurned += xfAmount;
        emit XFBurned(xfAmount);
    }

    /**
     * @dev Set swap router address
     * @param _swapRouter Address of swap router (must implement ISwapRouter interface, can be zero for manual mode)
     */
    function setSwapRouter(address _swapRouter) external onlyOwner {
        // Can be zero address to disable automatic swaps (manual mode)
        swapRouter = _swapRouter;
        emit SwapRouterSet(_swapRouter);
    }

    /**
     * @dev Set revenue token address
     * @param _revenueToken Address of revenue token
     */
    function setRevenueToken(address _revenueToken) external onlyOwner {
        require(_revenueToken != address(0), "BuybackBurner: invalid revenue token");
        revenueToken = IERC20(_revenueToken);
        emit RevenueTokenSet(_revenueToken);
    }

    /**
     * @dev Set XF token address
     * @param _xfToken Address of XF token
     */
    function setXFToken(address _xfToken) external onlyOwner {
        require(_xfToken != address(0), "BuybackBurner: invalid XF token");
        xfToken = IERC20(_xfToken);
        emit XFTokenSet(_xfToken);
    }

    /**
     * @dev Set RevenueSplitter address
     * @param _revenueSplitter Address of RevenueSplitter
     */
    function setRevenueSplitter(address _revenueSplitter) external onlyOwner {
        revenueSplitter = _revenueSplitter;
        emit RevenueSplitterSet(_revenueSplitter);
    }

    /**
     * @dev Emergency withdraw (owner only)
     * @param token Address of token to withdraw (zero address for native)
     * @param amount Amount to withdraw
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        if (token == address(0)) {
            (bool success, ) = payable(owner()).call{value: amount}("");
            require(success, "BuybackBurner: withdraw failed");
        } else {
            IERC20(token).safeTransfer(owner(), amount);
        }
    }

    /**
     * @dev Authorize upgrade (UUPS)
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}

