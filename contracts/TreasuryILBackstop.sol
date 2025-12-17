// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IERC20.sol";
import "./Ownable.sol";

/**
 * @title TreasuryILBackstop
 * @dev Covers impermanent loss >8% for liquidity providers
 */
contract TreasuryILBackstop is Ownable {
    IERC20 public treasuryToken; // USDC or stablecoin
    address public pool;
    uint256 public constant IL_THRESHOLD_BPS = 800; // 8% = 800 basis points
    uint256 public totalCoverageProvided;
    
    event ILCoverageProvided(
        address indexed lp,
        uint256 lossAmount,
        uint256 coverageAmount
    );
    
    event TreasuryDeposit(address indexed depositor, uint256 amount);
    
    constructor(address _treasuryToken) Ownable(msg.sender) {
        treasuryToken = IERC20(_treasuryToken);
    }
    
    function setPool(address _pool) external onlyOwner {
        pool = _pool;
    }
    
    /**
     * @dev Calculate impermanent loss percentage
     * @param initialValue Initial LP position value
     * @param currentValue Current LP position value
     * @return ilBps Impermanent loss in basis points (10000 = 100%)
     */
    function calculateIL(uint256 initialValue, uint256 currentValue) public pure returns (uint256 ilBps) {
        if (currentValue >= initialValue) {
            return 0; // No loss
        }
        uint256 loss = initialValue - currentValue;
        ilBps = (loss * 10000) / initialValue;
    }
    
    /**
     * @dev Provide IL coverage if loss exceeds 8%
     * @param lpAddress The liquidity provider address
     * @param initialValue Initial LP position value in stablecoin terms
     * @param currentValue Current LP position value in stablecoin terms
     */
    function provideCoverage(
        address lpAddress,
        uint256 initialValue,
        uint256 currentValue
    ) external {
        require(msg.sender == pool, "TreasuryILBackstop: UNAUTHORIZED");
        
        uint256 ilBps = calculateIL(initialValue, currentValue);
        
        if (ilBps > IL_THRESHOLD_BPS) {
            uint256 excessLoss = ilBps - IL_THRESHOLD_BPS;
            uint256 coverageAmount = (initialValue * excessLoss) / 10000;
            
            require(
                treasuryToken.balanceOf(address(this)) >= coverageAmount,
                "TreasuryILBackstop: INSUFFICIENT_TREASURY"
            );
            
            treasuryToken.transfer(lpAddress, coverageAmount);
            totalCoverageProvided += coverageAmount;
            
            emit ILCoverageProvided(lpAddress, ilBps, coverageAmount);
        }
    }
    
    /**
     * @dev Deposit treasury funds
     */
    function depositTreasury(uint256 amount) external {
        require(amount > 0, "TreasuryILBackstop: INVALID_AMOUNT");
        treasuryToken.transferFrom(msg.sender, address(this), amount);
        emit TreasuryDeposit(msg.sender, amount);
    }
    
    /**
     * @dev Emergency withdrawal (owner only)
     */
    function emergencyWithdraw(uint256 amount) external onlyOwner {
        treasuryToken.transfer(owner, amount);
    }
}

