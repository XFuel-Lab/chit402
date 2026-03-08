// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IChainlinkAggregator.sol";
import "./Ownable.sol";
import "./ReentrancyGuard.sol";

/**
 * @title YieldOptimizer
 * @dev Optimizes yield allocation using Chainlink oracle data for LST yields
 * Integrates with XFUELRouter to route swaps to highest-yielding protocols
 */
contract YieldOptimizer is Ownable, ReentrancyGuard {
    
    struct YieldSource {
        string name; // e.g., "stkTIA", "stkXPRT", "stkATOM"
        address token; // LST token address
        address chainlinkOracle; // Chainlink oracle for this yield source
        uint256 cachedAPY; // Cached APY in basis points (e.g., 1500 = 15%)
        uint256 lastUpdate; // Last update timestamp
        bool active; // Whether this source is active
        uint256 minLiquidity; // Minimum liquidity required to route here
    }
    
    // Mapping from LST symbol to yield source
    mapping(string => YieldSource) public yieldSources;
    
    // Array of active LST symbols for iteration
    string[] public activeLSTs;
    
    // Oracle staleness threshold (24 hours default)
    uint256 public constant MAX_ORACLE_DELAY = 24 hours;
    
    // Minimum APY difference to trigger rebalancing (100 bps = 1%)
    uint256 public minAPYDifferenceForRebalance = 100;
    
    // Events
    event YieldSourceAdded(string indexed lstSymbol, address token, address oracle);
    event YieldSourceUpdated(string indexed lstSymbol, uint256 newAPY, uint256 timestamp);
    event YieldSourceRemoved(string indexed lstSymbol);
    event APYUpdatedFromOracle(string indexed lstSymbol, uint256 apy, uint256 timestamp);
    event BestYieldSourceSelected(string indexed lstSymbol, uint256 apy);
    
    constructor() Ownable(msg.sender) {}
    
    /**
     * @dev Add a new yield source with Chainlink oracle
     * @param lstSymbol Symbol of the LST (e.g., "stkTIA")
     * @param token Address of the LST token
     * @param chainlinkOracle Address of Chainlink oracle for yield data
     * @param minLiquidity Minimum liquidity required for this source
     */
    function addYieldSource(
        string calldata lstSymbol,
        address token,
        address chainlinkOracle,
        uint256 minLiquidity
    ) external onlyOwner {
        require(token != address(0), "YieldOptimizer: invalid token");
        require(chainlinkOracle != address(0), "YieldOptimizer: invalid oracle");
        require(bytes(lstSymbol).length > 0, "YieldOptimizer: empty symbol");
        require(!yieldSources[lstSymbol].active, "YieldOptimizer: source already exists");
        
        yieldSources[lstSymbol] = YieldSource({
            name: lstSymbol,
            token: token,
            chainlinkOracle: chainlinkOracle,
            cachedAPY: 0,
            lastUpdate: block.timestamp,
            active: true,
            minLiquidity: minLiquidity
        });
        
        activeLSTs.push(lstSymbol);
        
        // Initialize APY from oracle
        _updateAPYFromOracle(lstSymbol);
        
        emit YieldSourceAdded(lstSymbol, token, chainlinkOracle);
    }
    
    /**
     * @dev Update yield source configuration
     * @param lstSymbol Symbol of the LST
     * @param minLiquidity New minimum liquidity requirement
     */
    function updateYieldSource(
        string calldata lstSymbol,
        uint256 minLiquidity
    ) external onlyOwner {
        require(yieldSources[lstSymbol].active, "YieldOptimizer: source not active");
        
        yieldSources[lstSymbol].minLiquidity = minLiquidity;
        
        emit YieldSourceUpdated(lstSymbol, yieldSources[lstSymbol].cachedAPY, block.timestamp);
    }
    
    /**
     * @dev Remove a yield source
     * @param lstSymbol Symbol of the LST to remove
     */
    function removeYieldSource(string calldata lstSymbol) external onlyOwner {
        require(yieldSources[lstSymbol].active, "YieldOptimizer: source not active");
        
        yieldSources[lstSymbol].active = false;
        
        // Remove from active array
        for (uint256 i = 0; i < activeLSTs.length; i++) {
            if (keccak256(bytes(activeLSTs[i])) == keccak256(bytes(lstSymbol))) {
                activeLSTs[i] = activeLSTs[activeLSTs.length - 1];
                activeLSTs.pop();
                break;
            }
        }
        
        emit YieldSourceRemoved(lstSymbol);
    }
    
    /**
     * @dev Update APY from Chainlink oracle for a specific LST
     * @param lstSymbol Symbol of the LST to update
     */
    function updateAPYFromOracle(string calldata lstSymbol) external nonReentrant {
        require(yieldSources[lstSymbol].active, "YieldOptimizer: source not active");
        _updateAPYFromOracle(lstSymbol);
    }
    
    /**
     * @dev Internal function to update APY from Chainlink oracle
     * @param lstSymbol Symbol of the LST to update
     */
    function _updateAPYFromOracle(string memory lstSymbol) internal {
        YieldSource storage source = yieldSources[lstSymbol];
        
        IChainlinkAggregator oracle = IChainlinkAggregator(source.chainlinkOracle);
        
        try oracle.latestRoundData() returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            // Verify oracle data is fresh
            require(updatedAt > 0, "YieldOptimizer: invalid oracle timestamp");
            require(block.timestamp - updatedAt <= MAX_ORACLE_DELAY, "YieldOptimizer: stale oracle data");
            require(answeredInRound >= roundId, "YieldOptimizer: stale oracle round");
            require(answer > 0, "YieldOptimizer: invalid oracle answer");
            
            // Convert answer to APY in basis points
            // Assuming oracle returns APY in 8 decimals (e.g., 1500000000 = 15%)
            uint256 apy = uint256(answer) / 1e6; // Convert to basis points
            
            source.cachedAPY = apy;
            source.lastUpdate = block.timestamp;
            
            emit APYUpdatedFromOracle(lstSymbol, apy, block.timestamp);
        } catch Error(string memory reason) {
            // If oracle call fails, keep cached value
            revert(string(abi.encodePacked("YieldOptimizer: oracle error - ", reason)));
        } catch {
            revert("YieldOptimizer: oracle call failed");
        }
    }
    
    /**
     * @dev Get the best yield source based on current APYs
     * @return bestLST Symbol of the LST with highest yield
     * @return bestAPY The APY of the best source (in basis points)
     */
    function getBestYieldSource() external view returns (string memory bestLST, uint256 bestAPY) {
        require(activeLSTs.length > 0, "YieldOptimizer: no active sources");
        
        bestAPY = 0;
        bestLST = "";
        
        for (uint256 i = 0; i < activeLSTs.length; i++) {
            string memory lstSymbol = activeLSTs[i];
            YieldSource memory source = yieldSources[lstSymbol];
            
            if (source.active && source.cachedAPY > bestAPY) {
                // Verify oracle data isn't too stale
                if (block.timestamp - source.lastUpdate <= MAX_ORACLE_DELAY) {
                    bestAPY = source.cachedAPY;
                    bestLST = lstSymbol;
                }
            }
        }
        
        require(bytes(bestLST).length > 0, "YieldOptimizer: no valid source found");
        
        return (bestLST, bestAPY);
    }
    
    /**
     * @dev Get APY for a specific LST
     * @param lstSymbol Symbol of the LST
     * @return apy Current APY in basis points
     * @return isStale Whether the oracle data is stale
     */
    function getAPY(string calldata lstSymbol) external view returns (uint256 apy, bool isStale) {
        YieldSource memory source = yieldSources[lstSymbol];
        require(source.active, "YieldOptimizer: source not active");
        
        apy = source.cachedAPY;
        isStale = (block.timestamp - source.lastUpdate) > MAX_ORACLE_DELAY;
        
        return (apy, isStale);
    }
    
    /**
     * @dev Get all active yield sources with their APYs
     * @return symbols Array of LST symbols
     * @return apys Array of corresponding APYs
     * @return tokens Array of corresponding token addresses
     */
    function getAllYieldSources() 
        external 
        view 
        returns (
            string[] memory symbols,
            uint256[] memory apys,
            address[] memory tokens
        ) 
    {
        uint256 count = activeLSTs.length;
        symbols = new string[](count);
        apys = new uint256[](count);
        tokens = new address[](count);
        
        for (uint256 i = 0; i < count; i++) {
            string memory lstSymbol = activeLSTs[i];
            YieldSource memory source = yieldSources[lstSymbol];
            
            symbols[i] = lstSymbol;
            apys[i] = source.cachedAPY;
            tokens[i] = source.token;
        }
        
        return (symbols, apys, tokens);
    }
    
    /**
     * @dev Check if rebalancing to a different LST would be beneficial
     * @param currentLST Current LST symbol
     * @return shouldRebalanceFlag Whether rebalancing is recommended
     * @return targetLST Recommended target LST (if shouldRebalanceFlag is true)
     * @return apyGain Expected APY gain in basis points
     */
    function shouldRebalance(string calldata currentLST) 
        external 
        view 
        returns (
            bool shouldRebalanceFlag,
            string memory targetLST,
            uint256 apyGain
        ) 
    {
        require(yieldSources[currentLST].active, "YieldOptimizer: current source not active");
        
        uint256 currentAPY = yieldSources[currentLST].cachedAPY;
        uint256 bestAPY = 0;
        targetLST = "";
        
        for (uint256 i = 0; i < activeLSTs.length; i++) {
            string memory lstSymbol = activeLSTs[i];
            YieldSource memory source = yieldSources[lstSymbol];
            
            if (source.active && source.cachedAPY > bestAPY) {
                // Verify oracle data isn't too stale
                if (block.timestamp - source.lastUpdate <= MAX_ORACLE_DELAY) {
                    bestAPY = source.cachedAPY;
                    targetLST = lstSymbol;
                }
            }
        }
        
        if (bestAPY > currentAPY + minAPYDifferenceForRebalance) {
            shouldRebalanceFlag = true;
            apyGain = bestAPY - currentAPY;
        } else {
            shouldRebalanceFlag = false;
            apyGain = 0;
        }
        
        return (shouldRebalanceFlag, targetLST, apyGain);
    }
    
    /**
     * @dev Set minimum APY difference for rebalancing
     * @param _minAPYDifference Minimum APY difference in basis points
     */
    function setMinAPYDifferenceForRebalance(uint256 _minAPYDifference) external onlyOwner {
        require(_minAPYDifference <= 1000, "YieldOptimizer: difference too large"); // Max 10%
        minAPYDifferenceForRebalance = _minAPYDifference;
    }
    
    /**
     * @dev Batch update all active yield sources from their oracles
     */
    function updateAllAPYs() external nonReentrant {
        require(activeLSTs.length > 0, "YieldOptimizer: no active sources");
        
        for (uint256 i = 0; i < activeLSTs.length; i++) {
            string memory lstSymbol = activeLSTs[i];
            if (yieldSources[lstSymbol].active) {
                try this.updateAPYFromOracle(lstSymbol) {
                    // Success, continue
                } catch {
                    // Skip failed oracle updates
                    continue;
                }
            }
        }
    }
}

