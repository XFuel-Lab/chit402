// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./Ownable.sol";
import "./ReentrancyGuard.sol";
import "./SafeERC20.sol";
import "./IERC20.sol";

/**
 * @title RevSplitterHybrid
 * @dev Multi-chain revenue splitter for @XFuelLab hybrid architecture
 * 
 * Treasury Addresses:
 * - InnovationTreasuryAddr: 0x043d5231651379970d52a13CEfB4e80733DDb989 (Theta - Innovation Treasury)
 * - LPTreasuryAddr: persistence1q50x9h4nchk2uhhj5jre0jsqxrs9qmhvjwf8yj (Persistence - LP Treasury)
 * 
 * Revenue Splits:
 * - 30% BBB (Buyback & Burn)
 * - 30% LP Funding (bridged to LPTreasury via Axelar)
 * - 25% veXF Yields Distributor
 * - 15% Innovation Treasury
 * 
 * Governance Hook:
 * - 5-10% can be diverted from LP slice for governance-approved initiatives
 */
contract RevSplitterHybrid is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Constants ============
    uint256 public constant BBB_BPS = 3000;                // 30% Buyback & Burn
    uint256 public constant LP_FUNDING_BPS = 3000;         // 30% LP Funding
    uint256 public constant VEXF_YIELDS_BPS = 2500;        // 25% veXF Yields
    uint256 public constant INNOVATION_TREASURY_BPS = 1500; // 15% Innovation Treasury
    uint256 public constant TOTAL_BPS = 10000;             // 100%
    
    // Governance hook limits (can divert 5-10% from LP slice)
    uint256 public constant MIN_GOVERNANCE_BPS = 500;      // 5%
    uint256 public constant MAX_GOVERNANCE_BPS = 1000;     // 10%

    // ============ State Variables ============
    
    // Theta addresses
    address public innovationTreasuryAddr;  // 0x043d5231651379970d52a13CEfB4e80733DDb989
    address public bbbContract;             // Buyback & Burn contract
    address public veXFYieldsDistributor;   // veXF yields distributor
    
    // Persistence/Cosmos address (stored as string for cross-chain)
    string public lpTreasuryAddr;           // persistence1q50x9h4nchk2uhhj5jre0jsqxrs9qmhvjwf8yj
    
    // Axelar bridge placeholder (for future integration)
    address public axelarBridgeAdapter;     // Adapter for Theta -> Persistence bridging
    
    // Governance hook
    uint256 public governanceDiversionBps;  // 0-1000 (0-10% from LP slice)
    address public governanceFundRecipient; // Where diverted funds go
    bool public governanceHookActive;       // Toggle for governance diversion
    
    // Revenue token (USDC or wrapped stablecoin)
    IERC20 public revenueToken;
    
    // Tracking
    uint256 public totalRevenueCollected;
    uint256 public totalBBBAllocated;
    uint256 public totalLPFundingAllocated;
    uint256 public totalVeXFYieldsAllocated;
    uint256 public totalInnovationTreasuryAllocated;
    uint256 public totalGovernanceDiverted;

    // ============ Events ============
    
    event RevenueCollected(
        address indexed token,
        uint256 amount,
        address indexed source
    );
    
    event RevenueSplit(
        uint256 bbbAmount,
        uint256 lpFundingAmount,
        uint256 veXFYieldsAmount,
        uint256 innovationTreasuryAmount,
        uint256 governanceDivertedAmount
    );
    
    event InnovationTreasuryUpdated(address indexed newAddress);
    event BBBContractUpdated(address indexed newAddress);
    event VeXFYieldsDistributorUpdated(address indexed newAddress);
    event LPTreasuryUpdated(string newAddress);
    event AxelarBridgeAdapterUpdated(address indexed newAddress);
    event RevenueTokenUpdated(address indexed newToken);
    
    event GovernanceHookConfigured(
        uint256 diversionBps,
        address recipient,
        bool active
    );
    
    event LPFundingBridged(
        uint256 amount,
        string destinationAddress
    );

    // ============ Constructor ============
    
    constructor(
        address _revenueToken,
        address _innovationTreasuryAddr,
        string memory _lpTreasuryAddr,
        address _bbbContract,
        address _veXFYieldsDistributor,
        address _owner
    ) Ownable(_owner) {
        require(_revenueToken != address(0), "Invalid revenue token");
        require(_innovationTreasuryAddr != address(0), "Invalid innovation treasury");
        require(bytes(_lpTreasuryAddr).length > 0, "Invalid LP treasury address");
        require(_bbbContract != address(0), "Invalid BBB contract");
        require(_veXFYieldsDistributor != address(0), "Invalid veXF distributor");
        
        revenueToken = IERC20(_revenueToken);
        innovationTreasuryAddr = _innovationTreasuryAddr;
        lpTreasuryAddr = _lpTreasuryAddr;
        bbbContract = _bbbContract;
        veXFYieldsDistributor = _veXFYieldsDistributor;
        
        // Governance hook disabled by default
        governanceHookActive = false;
        governanceDiversionBps = 0;
        
        emit RevenueTokenUpdated(_revenueToken);
        emit InnovationTreasuryUpdated(_innovationTreasuryAddr);
        emit LPTreasuryUpdated(_lpTreasuryAddr);
        emit BBBContractUpdated(_bbbContract);
        emit VeXFYieldsDistributorUpdated(_veXFYieldsDistributor);
    }

    // ============ Core Functions ============
    
    /**
     * @dev Split collected revenue according to tokenomics
     * @param amount Amount of revenue to split
     */
    function splitRevenue(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        
        // Transfer revenue from caller
        revenueToken.safeTransferFrom(msg.sender, address(this), amount);
        
        totalRevenueCollected += amount;
        emit RevenueCollected(address(revenueToken), amount, msg.sender);
        
        // Calculate base splits
        uint256 bbbAmount = (amount * BBB_BPS) / TOTAL_BPS;
        uint256 lpFundingAmount = (amount * LP_FUNDING_BPS) / TOTAL_BPS;
        uint256 veXFYieldsAmount = (amount * VEXF_YIELDS_BPS) / TOTAL_BPS;
        uint256 innovationTreasuryAmount = (amount * INNOVATION_TREASURY_BPS) / TOTAL_BPS;
        
        uint256 governanceDivertedAmount = 0;
        
        // Apply governance hook if active (diverts from LP slice)
        if (governanceHookActive && governanceDiversionBps > 0 && governanceFundRecipient != address(0)) {
            governanceDivertedAmount = (lpFundingAmount * governanceDiversionBps) / TOTAL_BPS;
            lpFundingAmount -= governanceDivertedAmount;
            
            // Send diverted funds to governance recipient
            revenueToken.safeTransfer(governanceFundRecipient, governanceDivertedAmount);
            totalGovernanceDiverted += governanceDivertedAmount;
        }
        
        // Handle rounding - add remainder to veXF yields
        uint256 totalSplit = bbbAmount + lpFundingAmount + veXFYieldsAmount + innovationTreasuryAmount + governanceDivertedAmount;
        if (totalSplit < amount) {
            veXFYieldsAmount += (amount - totalSplit);
        }
        
        // Distribute funds
        _distributeBBB(bbbAmount);
        _distributeLPFunding(lpFundingAmount);
        _distributeVeXFYields(veXFYieldsAmount);
        _distributeInnovationTreasury(innovationTreasuryAmount);
        
        // Update tracking
        totalBBBAllocated += bbbAmount;
        totalLPFundingAllocated += lpFundingAmount;
        totalVeXFYieldsAllocated += veXFYieldsAmount;
        totalInnovationTreasuryAllocated += innovationTreasuryAmount;
        
        emit RevenueSplit(
            bbbAmount,
            lpFundingAmount,
            veXFYieldsAmount,
            innovationTreasuryAmount,
            governanceDivertedAmount
        );
    }

    // ============ Internal Distribution Functions ============
    
    /**
     * @dev Distribute BBB allocation to buyback & burn contract
     */
    function _distributeBBB(uint256 amount) internal {
        if (amount > 0) {
            revenueToken.safeTransfer(bbbContract, amount);
        }
    }
    
    /**
     * @dev Distribute LP funding allocation (bridge to Persistence via Axelar)
     */
    function _distributeLPFunding(uint256 amount) internal {
        if (amount > 0) {
            if (axelarBridgeAdapter != address(0)) {
                // Bridge to Persistence via Axelar adapter
                revenueToken.safeTransfer(axelarBridgeAdapter, amount);
                emit LPFundingBridged(amount, lpTreasuryAddr);
            } else {
                // Placeholder: Hold in contract until bridge is set
                // Funds remain in contract and can be manually bridged
                emit LPFundingBridged(amount, lpTreasuryAddr);
            }
        }
    }
    
    /**
     * @dev Distribute veXF yields allocation
     */
    function _distributeVeXFYields(uint256 amount) internal {
        if (amount > 0) {
            revenueToken.safeTransfer(veXFYieldsDistributor, amount);
        }
    }
    
    /**
     * @dev Distribute innovation treasury allocation
     */
    function _distributeInnovationTreasury(uint256 amount) internal {
        if (amount > 0) {
            revenueToken.safeTransfer(innovationTreasuryAddr, amount);
        }
    }

    // ============ Admin Functions ============
    
    /**
     * @dev Update innovation treasury address
     */
    function setInnovationTreasury(address _newAddress) external onlyOwner {
        require(_newAddress != address(0), "Invalid address");
        innovationTreasuryAddr = _newAddress;
        emit InnovationTreasuryUpdated(_newAddress);
    }
    
    /**
     * @dev Update BBB contract address
     */
    function setBBBContract(address _newAddress) external onlyOwner {
        require(_newAddress != address(0), "Invalid address");
        bbbContract = _newAddress;
        emit BBBContractUpdated(_newAddress);
    }
    
    /**
     * @dev Update veXF yields distributor address
     */
    function setVeXFYieldsDistributor(address _newAddress) external onlyOwner {
        require(_newAddress != address(0), "Invalid address");
        veXFYieldsDistributor = _newAddress;
        emit VeXFYieldsDistributorUpdated(_newAddress);
    }
    
    /**
     * @dev Update LP treasury address (Persistence/Cosmos)
     */
    function setLPTreasury(string memory _newAddress) external onlyOwner {
        require(bytes(_newAddress).length > 0, "Invalid address");
        lpTreasuryAddr = _newAddress;
        emit LPTreasuryUpdated(_newAddress);
    }
    
    /**
     * @dev Update Axelar bridge adapter address
     */
    function setAxelarBridgeAdapter(address _newAddress) external onlyOwner {
        // Allow setting to zero address to disable bridging
        axelarBridgeAdapter = _newAddress;
        emit AxelarBridgeAdapterUpdated(_newAddress);
    }
    
    /**
     * @dev Update revenue token
     */
    function setRevenueToken(address _newToken) external onlyOwner {
        require(_newToken != address(0), "Invalid token");
        revenueToken = IERC20(_newToken);
        emit RevenueTokenUpdated(_newToken);
    }
    
    /**
     * @dev Configure governance hook
     * @param _diversionBps Diversion percentage in basis points (500-1000 = 5-10%)
     * @param _recipient Address to receive diverted funds
     * @param _active Whether the hook is active
     */
    function configureGovernanceHook(
        uint256 _diversionBps,
        address _recipient,
        bool _active
    ) external onlyOwner {
        require(_diversionBps <= MAX_GOVERNANCE_BPS, "Diversion too high");
        if (_active) {
            require(_diversionBps >= MIN_GOVERNANCE_BPS, "Diversion too low");
            require(_recipient != address(0), "Invalid recipient");
        }
        
        governanceDiversionBps = _diversionBps;
        governanceFundRecipient = _recipient;
        governanceHookActive = _active;
        
        emit GovernanceHookConfigured(_diversionBps, _recipient, _active);
    }

    // ============ View Functions ============
    
    /**
     * @dev Calculate revenue splits for a given amount
     * @param amount Amount to calculate splits for
     * @return bbb BBB allocation
     * @return lpFunding LP funding allocation (after governance diversion)
     * @return veXFYields veXF yields allocation
     * @return innovationTreasury Innovation treasury allocation
     * @return governanceDiverted Governance diverted amount
     */
    function calculateSplits(uint256 amount) external view returns (
        uint256 bbb,
        uint256 lpFunding,
        uint256 veXFYields,
        uint256 innovationTreasury,
        uint256 governanceDiverted
    ) {
        bbb = (amount * BBB_BPS) / TOTAL_BPS;
        lpFunding = (amount * LP_FUNDING_BPS) / TOTAL_BPS;
        veXFYields = (amount * VEXF_YIELDS_BPS) / TOTAL_BPS;
        innovationTreasury = (amount * INNOVATION_TREASURY_BPS) / TOTAL_BPS;
        
        // Apply governance hook
        if (governanceHookActive && governanceDiversionBps > 0) {
            governanceDiverted = (lpFunding * governanceDiversionBps) / TOTAL_BPS;
            lpFunding -= governanceDiverted;
        }
        
        // Handle rounding
        uint256 total = bbb + lpFunding + veXFYields + innovationTreasury + governanceDiverted;
        if (total < amount) {
            veXFYields += (amount - total);
        }
    }
    
    /**
     * @dev Get pending LP funding amount held in contract
     */
    function getPendingLPFunding() external view returns (uint256) {
        return revenueToken.balanceOf(address(this));
    }
    
    /**
     * @dev Get governance hook configuration
     */
    function getGovernanceHookConfig() external view returns (
        uint256 diversionBps,
        address recipient,
        bool active
    ) {
        return (governanceDiversionBps, governanceFundRecipient, governanceHookActive);
    }

    // ============ Emergency Functions ============
    
    /**
     * @dev Emergency withdraw (owner only)
     * @param token Token to withdraw (use address(0) for native)
     * @param amount Amount to withdraw
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        if (token == address(0)) {
            (bool success, ) = payable(owner).call{value: amount}("");
            require(success, "Native transfer failed");
        } else {
            IERC20(token).safeTransfer(owner, amount);
        }
    }
    
    /**
     * @dev Manually bridge pending LP funding
     * @param amount Amount to bridge
     */
    function manualBridgeLPFunding(uint256 amount) external onlyOwner {
        require(axelarBridgeAdapter != address(0), "Bridge adapter not set");
        require(amount > 0, "Amount must be > 0");
        
        revenueToken.safeTransfer(axelarBridgeAdapter, amount);
        emit LPFundingBridged(amount, lpTreasuryAddr);
    }
}

