// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./Ownable.sol";
import "./ReentrancyGuard.sol";
import "./SafeERC20.sol";
import "./IERC20.sol";

/**
 * @title RevSplitterHybridV2
 * @dev Multi-chain revenue splitter for @XFuelLab hybrid tokenomics (TFUEL auto-split)
 * 
 * On TFUEL receive, auto-split:
 * - 30% BBB (Buyback/Burn XFUEL)
 * - 30% LP Funding (bridge to Persistence as ibcTFUEL for pool seeding via Axelar)
 * - 25% veXF Yields Distributor
 * - 15% Treasury
 * 
 * Governance Hook (veXF-voted params):
 * - 5-10% opt-in diversion from LP slice for governance-approved initiatives
 * - Example: NFT wallet rewards on revenue milestones
 * 
 * Treasury Address: 0x043d5231651379970d52a13CEfB4e80733DDb989 (Theta - Innovation Treasury)
 * LP Treasury: persistence1q50x9h4nchk2uhhj5jre0jsqxrs9qmhvjwf8yj (Persistence/IBC)
 */
contract RevSplitterHybridV2 is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Constants ============
    uint256 public constant BBB_BPS = 3000;                // 30% Buyback & Burn
    uint256 public constant LP_FUNDING_BPS = 3000;         // 30% LP Funding
    uint256 public constant VEXF_YIELDS_BPS = 2500;        // 25% veXF Yields
    uint256 public constant TREASURY_BPS = 1500;           // 15% Treasury
    uint256 public constant TOTAL_BPS = 10000;             // 100%
    
    // Governance hook limits (can divert 5-10% from LP slice)
    uint256 public constant MIN_GOVERNANCE_BPS = 500;      // 5%
    uint256 public constant MAX_GOVERNANCE_BPS = 1000;     // 10%

    // ============ State Variables ============
    
    // Theta addresses
    address public treasuryAddr;            // Innovation Treasury (receives TFUEL)
    address public bbbContract;             // Buyback & Burn contract (receives TFUEL)
    address public veXFYieldsDistributor;   // veXF yields distributor (receives TFUEL)
    
    // Persistence/Cosmos address (stored as string for cross-chain)
    string public lpTreasuryAddr;           // Persistence bech32 address for IBC transfers
    
    // Axelar bridge adapter (for TFUEL -> ibcTFUEL bridging to Persistence)
    address public axelarBridgeAdapter;     // Adapter contract (receives TFUEL, bridges as ibcTFUEL)
    
    // Governance hook configuration
    uint256 public governanceDiversionBps;  // 0-1000 (0-10% from LP slice)
    address public governanceFundRecipient; // Address receiving diverted funds
    bool public governanceHookActive;       // Toggle for governance diversion
    string public governanceHookPurpose;    // Purpose/description (e.g., "NFT Milestone Rewards Q1 2026")
    
    // Tracking (in wei - TFUEL units)
    uint256 public totalRevenueCollected;
    uint256 public totalBBBAllocated;
    uint256 public totalLPFundingAllocated;
    uint256 public totalVeXFYieldsAllocated;
    uint256 public totalTreasuryAllocated;
    uint256 public totalGovernanceDiverted;
    
    // Milestone tracking for governance hooks
    uint256 public currentMilestone;        // Current milestone number
    mapping(uint256 => uint256) public milestoneThresholds; // Milestone ID -> TFUEL threshold
    mapping(uint256 => bool) public milestoneReached;       // Milestone ID -> reached status
    mapping(uint256 => string) public milestoneDescriptions; // Milestone ID -> description

    // ============ Events ============
    
    event TFUELReceived(
        uint256 amount,
        address indexed sender
    );
    
    event RevenueSplit(
        uint256 bbbAmount,
        uint256 lpFundingAmount,
        uint256 veXFYieldsAmount,
        uint256 treasuryAmount,
        uint256 governanceDivertedAmount
    );
    
    event TreasuryUpdated(address indexed newAddress);
    event BBBContractUpdated(address indexed newAddress);
    event VeXFYieldsDistributorUpdated(address indexed newAddress);
    event LPTreasuryUpdated(string newAddress);
    event AxelarBridgeAdapterUpdated(address indexed newAddress);
    
    event GovernanceHookConfigured(
        uint256 diversionBps,
        address recipient,
        bool active,
        string purpose
    );
    
    event LPFundingBridged(
        uint256 amount,
        string destinationAddress,
        address bridgeAdapter
    );
    
    event MilestoneSet(
        uint256 indexed milestoneId,
        uint256 threshold,
        string description
    );
    
    event MilestoneReached(
        uint256 indexed milestoneId,
        uint256 totalRevenue,
        string description
    );

    // ============ Constructor ============
    
    constructor(
        address _treasuryAddr,
        string memory _lpTreasuryAddr,
        address _bbbContract,
        address _veXFYieldsDistributor,
        address _owner
    ) Ownable(_owner) {
        require(_treasuryAddr != address(0), "Invalid treasury");
        require(bytes(_lpTreasuryAddr).length > 0, "Invalid LP treasury address");
        require(_bbbContract != address(0), "Invalid BBB contract");
        require(_veXFYieldsDistributor != address(0), "Invalid veXF distributor");
        
        treasuryAddr = _treasuryAddr;
        lpTreasuryAddr = _lpTreasuryAddr;
        bbbContract = _bbbContract;
        veXFYieldsDistributor = _veXFYieldsDistributor;
        
        // Governance hook disabled by default
        governanceHookActive = false;
        governanceDiversionBps = 0;
        
        emit TreasuryUpdated(_treasuryAddr);
        emit LPTreasuryUpdated(_lpTreasuryAddr);
        emit BBBContractUpdated(_bbbContract);
        emit VeXFYieldsDistributorUpdated(_veXFYieldsDistributor);
    }

    // ============ Core Functions ============
    
    /**
     * @dev Receive TFUEL and auto-split according to tokenomics
     * Payable fallback to handle direct TFUEL transfers
     */
    receive() external payable nonReentrant {
        _splitTFUELRevenue(msg.value, msg.sender);
    }
    
    /**
     * @dev Fallback function to handle TFUEL transfers with data
     */
    fallback() external payable nonReentrant {
        _splitTFUELRevenue(msg.value, msg.sender);
    }
    
    /**
     * @dev Explicit function to split TFUEL revenue (can be called directly)
     */
    function splitTFUELRevenue() external payable nonReentrant {
        _splitTFUELRevenue(msg.value, msg.sender);
    }
    
    /**
     * @dev Internal function to split TFUEL revenue
     * @param amount Amount of TFUEL to split
     * @param sender Original sender address
     */
    function _splitTFUELRevenue(uint256 amount, address sender) internal {
        require(amount > 0, "Amount must be > 0");
        
        totalRevenueCollected += amount;
        emit TFUELReceived(amount, sender);
        
        // Calculate base splits
        uint256 bbbAmount = (amount * BBB_BPS) / TOTAL_BPS;
        uint256 lpFundingAmount = (amount * LP_FUNDING_BPS) / TOTAL_BPS;
        uint256 veXFYieldsAmount = (amount * VEXF_YIELDS_BPS) / TOTAL_BPS;
        uint256 treasuryAmount = (amount * TREASURY_BPS) / TOTAL_BPS;
        
        uint256 governanceDivertedAmount = 0;
        
        // Apply governance hook if active (diverts from LP slice)
        if (governanceHookActive && governanceDiversionBps > 0 && governanceFundRecipient != address(0)) {
            governanceDivertedAmount = (lpFundingAmount * governanceDiversionBps) / TOTAL_BPS;
            lpFundingAmount -= governanceDivertedAmount;
        }
        
        // Handle rounding - add remainder to veXF yields
        uint256 totalSplit = bbbAmount + lpFundingAmount + veXFYieldsAmount + treasuryAmount + governanceDivertedAmount;
        if (totalSplit < amount) {
            veXFYieldsAmount += (amount - totalSplit);
        }
        
        // Distribute funds
        _distributeBBB(bbbAmount);
        _distributeLPFunding(lpFundingAmount);
        _distributeVeXFYields(veXFYieldsAmount);
        _distributeTreasury(treasuryAmount);
        
        // Send governance diversion if active
        if (governanceDivertedAmount > 0) {
            _distributeGovernanceFunds(governanceDivertedAmount);
        }
        
        // Update tracking
        totalBBBAllocated += bbbAmount;
        totalLPFundingAllocated += lpFundingAmount;
        totalVeXFYieldsAllocated += veXFYieldsAmount;
        totalTreasuryAllocated += treasuryAmount;
        totalGovernanceDiverted += governanceDivertedAmount;
        
        emit RevenueSplit(
            bbbAmount,
            lpFundingAmount,
            veXFYieldsAmount,
            treasuryAmount,
            governanceDivertedAmount
        );
        
        // Check for milestone achievements
        _checkMilestones();
    }

    // ============ Internal Distribution Functions ============
    
    /**
     * @dev Distribute BBB allocation to buyback & burn contract (TFUEL)
     */
    function _distributeBBB(uint256 amount) internal {
        if (amount > 0) {
            (bool success, ) = payable(bbbContract).call{value: amount}("");
            require(success, "BBB transfer failed");
        }
    }
    
    /**
     * @dev Distribute LP funding allocation (bridge to Persistence via Axelar)
     * Sends TFUEL to Axelar adapter which converts to ibcTFUEL and bridges
     */
    function _distributeLPFunding(uint256 amount) internal {
        if (amount > 0) {
            if (axelarBridgeAdapter != address(0)) {
                // Bridge to Persistence via Axelar adapter
                (bool success, ) = payable(axelarBridgeAdapter).call{value: amount}("");
                require(success, "Axelar bridge transfer failed");
                emit LPFundingBridged(amount, lpTreasuryAddr, axelarBridgeAdapter);
            } else {
                // Placeholder: Hold in contract until bridge is set
                // Funds remain in contract and can be manually bridged via manualBridgeLPFunding()
                emit LPFundingBridged(amount, lpTreasuryAddr, address(0));
            }
        }
    }
    
    /**
     * @dev Distribute veXF yields allocation (TFUEL)
     */
    function _distributeVeXFYields(uint256 amount) internal {
        if (amount > 0) {
            (bool success, ) = payable(veXFYieldsDistributor).call{value: amount}("");
            require(success, "veXF yields transfer failed");
        }
    }
    
    /**
     * @dev Distribute treasury allocation (TFUEL)
     */
    function _distributeTreasury(uint256 amount) internal {
        if (amount > 0) {
            (bool success, ) = payable(treasuryAddr).call{value: amount}("");
            require(success, "Treasury transfer failed");
        }
    }
    
    /**
     * @dev Distribute governance-diverted funds (TFUEL)
     */
    function _distributeGovernanceFunds(uint256 amount) internal {
        if (amount > 0) {
            (bool success, ) = payable(governanceFundRecipient).call{value: amount}("");
            require(success, "Governance transfer failed");
        }
    }

    // ============ Governance Hook Functions ============
    
    /**
     * @dev Configure governance hook (veXF-voted parameters)
     * @param _diversionBps Diversion percentage in basis points (500-1000 = 5-10%)
     * @param _recipient Address to receive diverted funds
     * @param _active Whether the hook is active
     * @param _purpose Description/purpose of the diversion (e.g., "NFT Milestone Rewards Q1 2026")
     */
    function configureGovernanceHook(
        uint256 _diversionBps,
        address _recipient,
        bool _active,
        string memory _purpose
    ) external onlyOwner {
        require(_diversionBps <= MAX_GOVERNANCE_BPS, "Diversion too high");
        if (_active) {
            require(_diversionBps >= MIN_GOVERNANCE_BPS, "Diversion too low");
            require(_recipient != address(0), "Invalid recipient");
            require(bytes(_purpose).length > 0, "Purpose required");
        }
        
        governanceDiversionBps = _diversionBps;
        governanceFundRecipient = _recipient;
        governanceHookActive = _active;
        governanceHookPurpose = _purpose;
        
        emit GovernanceHookConfigured(_diversionBps, _recipient, _active, _purpose);
    }
    
    /**
     * @dev Set milestone threshold for governance hooks
     * Example: Milestone 1 = 10,000 TFUEL, trigger NFT rewards
     * @param milestoneId Milestone identifier (0, 1, 2, ...)
     * @param threshold Revenue threshold in wei (TFUEL)
     * @param description Milestone description
     */
    function setMilestone(
        uint256 milestoneId,
        uint256 threshold,
        string memory description
    ) external onlyOwner {
        require(threshold > 0, "Threshold must be > 0");
        require(bytes(description).length > 0, "Description required");
        
        milestoneThresholds[milestoneId] = threshold;
        milestoneDescriptions[milestoneId] = description;
        milestoneReached[milestoneId] = false; // Reset if re-setting
        
        emit MilestoneSet(milestoneId, threshold, description);
    }
    
    /**
     * @dev Check if any milestones have been reached
     */
    function _checkMilestones() internal {
        // Check current milestone and next few milestones
        for (uint256 i = currentMilestone; i < currentMilestone + 10; i++) {
            if (milestoneThresholds[i] > 0 && !milestoneReached[i]) {
                if (totalRevenueCollected >= milestoneThresholds[i]) {
                    milestoneReached[i] = true;
                    currentMilestone = i + 1;
                    emit MilestoneReached(i, totalRevenueCollected, milestoneDescriptions[i]);
                } else {
                    // Stop checking once we find an unmet milestone
                    break;
                }
            }
        }
    }

    // ============ Admin Functions ============
    
    /**
     * @dev Update treasury address
     */
    function setTreasury(address _newAddress) external onlyOwner {
        require(_newAddress != address(0), "Invalid address");
        treasuryAddr = _newAddress;
        emit TreasuryUpdated(_newAddress);
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
     * @dev Update LP treasury address (Persistence/Cosmos bech32 address)
     */
    function setLPTreasury(string memory _newAddress) external onlyOwner {
        require(bytes(_newAddress).length > 0, "Invalid address");
        lpTreasuryAddr = _newAddress;
        emit LPTreasuryUpdated(_newAddress);
    }
    
    /**
     * @dev Update Axelar bridge adapter address
     * @param _newAddress New adapter address (can be zero to disable auto-bridging)
     */
    function setAxelarBridgeAdapter(address _newAddress) external onlyOwner {
        // Allow setting to zero address to disable bridging (manual mode)
        axelarBridgeAdapter = _newAddress;
        emit AxelarBridgeAdapterUpdated(_newAddress);
    }

    // ============ View Functions ============
    
    /**
     * @dev Calculate revenue splits for a given TFUEL amount
     * @param amount Amount to calculate splits for (in wei)
     * @return bbb BBB allocation
     * @return lpFunding LP funding allocation (after governance diversion)
     * @return veXFYields veXF yields allocation
     * @return treasury Treasury allocation
     * @return governanceDiverted Governance diverted amount
     */
    function calculateSplits(uint256 amount) external view returns (
        uint256 bbb,
        uint256 lpFunding,
        uint256 veXFYields,
        uint256 treasury,
        uint256 governanceDiverted
    ) {
        bbb = (amount * BBB_BPS) / TOTAL_BPS;
        lpFunding = (amount * LP_FUNDING_BPS) / TOTAL_BPS;
        veXFYields = (amount * VEXF_YIELDS_BPS) / TOTAL_BPS;
        treasury = (amount * TREASURY_BPS) / TOTAL_BPS;
        
        // Apply governance hook
        if (governanceHookActive && governanceDiversionBps > 0) {
            governanceDiverted = (lpFunding * governanceDiversionBps) / TOTAL_BPS;
            lpFunding -= governanceDiverted;
        }
        
        // Handle rounding
        uint256 total = bbb + lpFunding + veXFYields + treasury + governanceDiverted;
        if (total < amount) {
            veXFYields += (amount - total);
        }
    }
    
    /**
     * @dev Get pending LP funding amount held in contract (TFUEL)
     */
    function getPendingLPFunding() external view returns (uint256) {
        return address(this).balance;
    }
    
    /**
     * @dev Get governance hook configuration
     */
    function getGovernanceHookConfig() external view returns (
        uint256 diversionBps,
        address recipient,
        bool active,
        string memory purpose
    ) {
        return (governanceDiversionBps, governanceFundRecipient, governanceHookActive, governanceHookPurpose);
    }
    
    /**
     * @dev Get milestone information
     * @param milestoneId Milestone identifier
     */
    function getMilestone(uint256 milestoneId) external view returns (
        uint256 threshold,
        bool reached,
        string memory description
    ) {
        return (
            milestoneThresholds[milestoneId],
            milestoneReached[milestoneId],
            milestoneDescriptions[milestoneId]
        );
    }

    // ============ Emergency Functions ============
    
    /**
     * @dev Emergency withdraw (owner only)
     * @param token Token to withdraw (use address(0) for TFUEL)
     * @param amount Amount to withdraw
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        if (token == address(0)) {
            (bool success, ) = payable(owner).call{value: amount}("");
            require(success, "TFUEL transfer failed");
        } else {
            IERC20(token).safeTransfer(owner, amount);
        }
    }
    
    /**
     * @dev Manually bridge pending LP funding
     * Used when Axelar adapter is set after funds have accumulated
     * @param amount Amount to bridge (in wei)
     */
    function manualBridgeLPFunding(uint256 amount) external onlyOwner {
        require(axelarBridgeAdapter != address(0), "Bridge adapter not set");
        require(amount > 0, "Amount must be > 0");
        require(address(this).balance >= amount, "Insufficient balance");
        
        (bool success, ) = payable(axelarBridgeAdapter).call{value: amount}("");
        require(success, "Bridge transfer failed");
        
        emit LPFundingBridged(amount, lpTreasuryAddr, axelarBridgeAdapter);
    }
}



