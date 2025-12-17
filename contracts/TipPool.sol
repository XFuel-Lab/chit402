// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title TipPool
 * @dev Tip pools with lottery functionality - winner takes most, creator gets cut
 */
contract TipPool {
    struct Pool {
        address creator;
        uint256 totalTips;
        uint256 startTime;
        uint256 endTime;
        address[] tippers;
        mapping(address => uint256) tipAmounts;
        address winner;
        bool ended;
        uint256 randomSeed; // For VRF (mock for now)
    }

    mapping(uint256 => Pool) public pools;
    uint256 public nextPoolId;
    
    // Fee configuration: 10% to creator, 90% to winner
    uint256 public constant CREATOR_CUT_BPS = 1000; // 10%
    uint256 public constant WINNER_CUT_BPS = 9000; // 90%
    
    event PoolCreated(uint256 indexed poolId, address indexed creator, uint256 duration);
    event TipAdded(uint256 indexed poolId, address indexed tipper, uint256 amount);
    event PoolEnded(uint256 indexed poolId, address indexed winner, uint256 prizeAmount, uint256 creatorCut);
    
    /**
     * @dev Create a new tip pool
     * @param duration Duration of the pool in seconds
     * @param creator Address of the pool creator
     */
    function createPool(uint256 duration, address creator) external payable {
        uint256 poolId = nextPoolId++;
        Pool storage pool = pools[poolId];
        
        pool.creator = creator;
        pool.startTime = block.timestamp;
        pool.endTime = block.timestamp + duration;
        pool.ended = false;
        
        emit PoolCreated(poolId, creator, duration);
    }
    
    /**
     * @dev Add a tip to a pool
     * @param poolId The pool ID to tip
     */
    function tipPool(uint256 poolId) external payable {
        require(msg.value > 0, "TipPool: tip must be greater than 0");
        Pool storage pool = pools[poolId];
        require(!pool.ended, "TipPool: pool has ended");
        require(block.timestamp < pool.endTime, "TipPool: pool has ended");
        
        if (pool.tipAmounts[msg.sender] == 0) {
            pool.tippers.push(msg.sender);
        }
        
        pool.tipAmounts[msg.sender] += msg.value;
        pool.totalTips += msg.value;
        
        emit TipAdded(poolId, msg.sender, msg.value);
    }
    
    /**
     * @dev End a pool and distribute winnings (called when pool duration ends)
     * @param poolId The pool ID to end
     */
    function endPool(uint256 poolId) external {
        Pool storage pool = pools[poolId];
        require(!pool.ended, "TipPool: pool already ended");
        require(block.timestamp >= pool.endTime, "TipPool: pool has not ended yet");
        require(pool.totalTips > 0, "TipPool: no tips to distribute");
        
        pool.ended = true;
        
        // Draw winner (mock VRF for now - uses block.timestamp + block.difficulty as seed)
        address winner = drawWinner(poolId);
        pool.winner = winner;
        
        // Calculate cuts
        uint256 creatorCut = (pool.totalTips * CREATOR_CUT_BPS) / 10000;
        uint256 winnerPrize = pool.totalTips - creatorCut;
        
        // Transfer winnings
        if (creatorCut > 0 && pool.creator != address(0)) {
            payable(pool.creator).transfer(creatorCut);
        }
        
        if (winnerPrize > 0 && winner != address(0)) {
            payable(winner).transfer(winnerPrize);
        }
        
        emit PoolEnded(poolId, winner, winnerPrize, creatorCut);
    }
    
    /**
     * @dev Draw a winner from the pool using weighted random selection
     * @param poolId The pool ID
     * @return winner The address of the winner
     */
    function drawWinner(uint256 poolId) public view returns (address) {
        Pool storage pool = pools[poolId];
        require(pool.tippers.length > 0, "TipPool: no tippers");
        
        if (pool.tippers.length == 1) {
            return pool.tippers[0];
        }
        
        // Mock VRF: use block data as seed (in production, use real VRF)
        // Note: block.prevrandao is available in Solidity 0.8.18+, using block.difficulty for compatibility
        uint256 random = uint256(keccak256(abi.encodePacked(block.timestamp, block.difficulty, block.number, poolId)));
        uint256 totalWeight = pool.totalTips;
        uint256 winningNumber = random % totalWeight;
        
        // Weighted selection based on tip amounts
        uint256 currentWeight = 0;
        for (uint256 i = 0; i < pool.tippers.length; i++) {
            currentWeight += pool.tipAmounts[pool.tippers[i]];
            if (winningNumber < currentWeight) {
                return pool.tippers[i];
            }
        }
        
        // Fallback to first tipper (shouldn't reach here)
        return pool.tippers[0];
    }
    
    /**
     * @dev Get pool information
     * @param poolId The pool ID
     * @return creator The creator address
     * @return totalTips Total tips in the pool
     * @return startTime Pool start time
     * @return endTime Pool end time
     * @return winner The winner address (address(0) if not drawn yet)
     * @return ended Whether the pool has ended
     */
    function getPoolInfo(uint256 poolId) external view returns (
        address creator,
        uint256 totalTips,
        uint256 startTime,
        uint256 endTime,
        address winner,
        bool ended
    ) {
        Pool storage pool = pools[poolId];
        return (
            pool.creator,
            pool.totalTips,
            pool.startTime,
            pool.endTime,
            pool.winner,
            pool.ended
        );
    }
    
    /**
     * @dev Get list of tippers for a pool
     * @param poolId The pool ID
     * @return Array of tipper addresses
     */
    function getPoolTippers(uint256 poolId) external view returns (address[] memory) {
        return pools[poolId].tippers;
    }
    
    /**
     * @dev Get tip amount for a specific user in a pool
     * @param poolId The pool ID
     * @param tipper The tipper address
     * @return The tip amount
     */
    function getTipAmount(uint256 poolId, address tipper) external view returns (uint256) {
        return pools[poolId].tipAmounts[tipper];
    }
}

