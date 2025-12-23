// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IERC20.sol";
import "./XFUELPool.sol";
import "./XFUELRouter.sol";
import "./Ownable.sol";
import "./ReentrancyGuard.sol";
import "./SafeERC20.sol";

/**
 * @title LPRebalancer
 * @dev Auto-rebalance logic for single-sided LP deposits
 * Monitors pool ratio and swaps excess tokens when skew exceeds threshold
 */
contract LPRebalancer is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    XFUELRouter public router;
    uint256 public rebalanceThresholdBps; // Default 1000 = 10% (60/40 split)
    uint256 public minRebalanceAmount; // Minimum amount to trigger rebalance
    address public treasury; // Treasury address to fund rebalances
    bool public rebalanceEnabled;

    // Rebalance history
    struct RebalanceRecord {
        address pool;
        uint256 timestamp;
        uint256 ratioBefore;
        uint256 ratioAfter;
        uint256 swapAmount;
        bool zeroForOne;
    }

    RebalanceRecord[] public rebalanceHistory;
    mapping(address => uint256) public lastRebalanceTime;
    mapping(address => uint256) public rebalanceCooldown; // Cooldown per pool in seconds

    // Events
    event RebalanceExecuted(
        address indexed pool,
        uint256 ratioBefore,
        uint256 ratioAfter,
        uint256 swapAmount,
        bool zeroForOne
    );
    event RebalanceThresholdSet(uint256 oldThreshold, uint256 newThreshold);
    event RebalanceEnabled(bool enabled);
    event TreasurySet(address indexed treasury);
    event MinRebalanceAmountSet(uint256 oldAmount, uint256 newAmount);
    event RebalanceCooldownSet(address indexed pool, uint256 cooldown);

    constructor(
        address _router,
        address _treasury,
        uint256 _rebalanceThresholdBps
    ) Ownable(msg.sender) {
        require(_router != address(0), "LPRebalancer: invalid router");
        require(_treasury != address(0), "LPRebalancer: invalid treasury");
        require(_rebalanceThresholdBps > 0 && _rebalanceThresholdBps <= 5000, "LPRebalancer: invalid threshold");

        router = XFUELRouter(_router);
        treasury = _treasury;
        rebalanceThresholdBps = _rebalanceThresholdBps; // Default 10% (1000 bps)
        minRebalanceAmount = 1e18; // 1 token (adjust decimals as needed)
        rebalanceEnabled = true;
        rebalanceCooldown[address(0)] = 3600; // Default 1 hour cooldown
    }

    /**
     * @dev Get current pool ratio in basis points (token0/total)
     * @param pool Pool address
     * @return ratioBps Ratio in basis points (5000 = 50/50, 6000 = 60/40)
     */
    function getPoolRatio(address pool) public view returns (uint256 ratioBps) {
        XFUELPool poolContract = XFUELPool(pool);
        IERC20 token0 = poolContract.token0();
        IERC20 token1 = poolContract.token1();

        uint256 balance0 = token0.balanceOf(pool);
        uint256 balance1 = token1.balanceOf(pool);

        if (balance0 == 0 && balance1 == 0) {
            return 5000; // 50/50 if pool is empty
        }

        // Calculate ratio as token0 percentage (in basis points)
        // Use equivalent value - simplified assumption: 1:1 ratio
        // In production, use price oracle for accurate calculation
        uint256 total = balance0 + balance1;
        ratioBps = (balance0 * 10000) / total;

        return ratioBps;
    }

    /**
     * @dev Calculate skew percentage from ideal 50/50 ratio
     * @param pool Pool address
     * @return skewBps Skew in basis points (0 = balanced, 1000 = 10% skew)
     */
    function calculateSkew(address pool) public view returns (uint256 skewBps) {
        uint256 ratioBps = getPoolRatio(pool);
        
        // Ideal ratio is 5000 (50/50)
        if (ratioBps >= 5000) {
            skewBps = ratioBps - 5000; // Skew towards token0
        } else {
            skewBps = 5000 - ratioBps; // Skew towards token1
        }

        return skewBps;
    }

    /**
     * @dev Check if pool needs rebalancing
     * @param pool Pool address
     * @return needsRebalance True if skew exceeds threshold
     * @return zeroForOne True if swapping token0 for token1
     * @return swapAmount Amount to swap (0 if no rebalance needed)
     */
    function checkRebalanceNeeded(address pool) 
        public 
        view 
        returns (
            bool needsRebalance,
            bool zeroForOne,
            uint256 swapAmount
        ) 
    {
        if (!rebalanceEnabled) {
            return (false, false, 0);
        }

        // Check cooldown
        if (lastRebalanceTime[pool] > 0) {
            uint256 cooldown = rebalanceCooldown[pool] > 0 
                ? rebalanceCooldown[pool] 
                : rebalanceCooldown[address(0)];
            
            if (block.timestamp < lastRebalanceTime[pool] + cooldown) {
                return (false, false, 0);
            }
        }

        uint256 skewBps = calculateSkew(pool);
        
        if (skewBps <= rebalanceThresholdBps) {
            return (false, false, 0);
        }

        XFUELPool poolContract = XFUELPool(pool);
        IERC20 token0 = poolContract.token0();
        IERC20 token1 = poolContract.token1();

        uint256 balance0 = token0.balanceOf(pool);
        uint256 balance1 = token1.balanceOf(pool);

        uint256 ratioBps = getPoolRatio(pool);
        
        // Determine swap direction
        zeroForOne = ratioBps > 5000; // If token0 > 50%, swap token0 for token1

        // Calculate swap amount to bring ratio closer to 50/50
        // Target: reduce excess by half of the excess amount
        uint256 excessBps = skewBps - rebalanceThresholdBps;
        uint256 targetRatioBps = 5000 + (excessBps / 2); // Move halfway to balanced

        if (zeroForOne) {
            // Swap token0 for token1
            // amount0_to_swap = balance0 * (ratioBps - targetRatioBps) / ratioBps
            swapAmount = (balance0 * (ratioBps - targetRatioBps)) / ratioBps;
        } else {
            // Swap token1 for token0
            swapAmount = (balance1 * (5000 - ratioBps) * 2) / (10000 - ratioBps);
        }

        // Ensure swap amount meets minimum
        if (swapAmount < minRebalanceAmount) {
            return (false, false, 0);
        }

        return (true, zeroForOne, swapAmount);
    }

    /**
     * @dev Execute rebalance for a pool
     * @param pool Pool address to rebalance
     * @return success True if rebalance was executed
     */
    function rebalance(address pool) external nonReentrant returns (bool success) {
        require(rebalanceEnabled, "LPRebalancer: rebalancing disabled");
        require(pool != address(0), "LPRebalancer: invalid pool");

        (bool needsRebalance, bool zeroForOne, uint256 swapAmount) = checkRebalanceNeeded(pool);
        
        if (!needsRebalance) {
            return false;
        }

        XFUELPool poolContract = XFUELPool(pool);
        IERC20 token0 = poolContract.token0();
        IERC20 token1 = poolContract.token1();
        IERC20 swapToken = zeroForOne ? token0 : token1;

        // Record ratio before rebalance
        uint256 ratioBefore = getPoolRatio(pool);

        // Transfer tokens from treasury to this contract for swapping
        // In production, treasury should approve this contract
        if (treasury != address(0)) {
            uint256 balance = swapToken.balanceOf(treasury);
            if (balance < swapAmount) {
                // Use what's available, or skip if insufficient
                if (balance < minRebalanceAmount) {
                    return false;
                }
                swapAmount = balance;
            }
            
            // Transfer from treasury
            swapToken.safeTransferFrom(treasury, address(this), swapAmount);
        } else {
            // Try to use contract's own balance
            uint256 balance = swapToken.balanceOf(address(this));
            if (balance < swapAmount) {
                if (balance < minRebalanceAmount) {
                    return false;
                }
                swapAmount = balance;
            }
        }

        // Approve router to spend tokens
        swapToken.safeApprove(address(router), swapAmount);

        // Execute swap via router
        try router.swap(
            pool,
            zeroForOne,
            int256(swapAmount),
            address(this), // Recipient receives the swapped tokens
            0 // minAmountOut - set to 0 for simplicity, adjust in production
        ) returns (int256, int256) {
            // Swap succeeded
            uint256 ratioAfter = getPoolRatio(pool);

            // Record rebalance (transaction hash available in receipt when mined)
            rebalanceHistory.push(RebalanceRecord({
                pool: pool,
                timestamp: block.timestamp,
                ratioBefore: ratioBefore,
                ratioAfter: ratioAfter,
                swapAmount: swapAmount,
                zeroForOne: zeroForOne
            }));

            lastRebalanceTime[pool] = block.timestamp;

            // Emit event (actual tx hash will be in transaction receipt)
            emit RebalanceExecuted(
                pool,
                ratioBefore,
                ratioAfter,
                swapAmount,
                zeroForOne
            );

            // Reset approval
            swapToken.safeApprove(address(router), 0);

            return true;
        } catch {
            // Swap failed, reset approval
            swapToken.safeApprove(address(router), 0);
            return false;
        }
    }

    /**
     * @dev Set rebalance threshold in basis points
     * @param _thresholdBps New threshold (e.g., 1000 = 10%)
     */
    function setRebalanceThreshold(uint256 _thresholdBps) external onlyOwner {
        require(_thresholdBps > 0 && _thresholdBps <= 5000, "LPRebalancer: invalid threshold");
        uint256 oldThreshold = rebalanceThresholdBps;
        rebalanceThresholdBps = _thresholdBps;
        emit RebalanceThresholdSet(oldThreshold, _thresholdBps);
    }

    /**
     * @dev Enable/disable rebalancing
     * @param _enabled True to enable
     */
    function setRebalanceEnabled(bool _enabled) external onlyOwner {
        rebalanceEnabled = _enabled;
        emit RebalanceEnabled(_enabled);
    }

    /**
     * @dev Set treasury address
     * @param _treasury New treasury address
     */
    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "LPRebalancer: invalid treasury");
        treasury = _treasury;
        emit TreasurySet(_treasury);
    }

    /**
     * @dev Set minimum rebalance amount
     * @param _minAmount New minimum amount
     */
    function setMinRebalanceAmount(uint256 _minAmount) external onlyOwner {
        uint256 oldAmount = minRebalanceAmount;
        minRebalanceAmount = _minAmount;
        emit MinRebalanceAmountSet(oldAmount, _minAmount);
    }

    /**
     * @dev Set rebalance cooldown for a pool
     * @param pool Pool address (address(0) for default)
     * @param _cooldown Cooldown in seconds
     */
    function setRebalanceCooldown(address pool, uint256 _cooldown) external onlyOwner {
        rebalanceCooldown[pool] = _cooldown;
        emit RebalanceCooldownSet(pool, _cooldown);
    }

    /**
     * @dev Get rebalance history count
     * @return count Number of rebalances executed
     */
    function getRebalanceHistoryCount() external view returns (uint256) {
        return rebalanceHistory.length;
    }

    /**
     * @dev Get rebalance record by index
     * @param index Record index
     * @return record Rebalance record
     */
    function getRebalanceRecord(uint256 index) external view returns (RebalanceRecord memory) {
        require(index < rebalanceHistory.length, "LPRebalancer: invalid index");
        return rebalanceHistory[index];
    }
}

