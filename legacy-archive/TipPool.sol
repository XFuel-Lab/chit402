// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ReentrancyGuard.sol";
import "./Ownable.sol";

/**
 * @title TipPool
 * @dev Tip pools with lottery functionality - winner takes most, creator gets cut
 */
contract TipPool is ReentrancyGuard, Ownable {
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
    
    // Commit-reveal scheme for secure randomness
    mapping(uint256 => bytes32) public poolCommits; // poolId => commit hash
    mapping(uint256 => uint256) public poolReveals; // poolId => reveal value
    mapping(uint256 => bool) public poolRevealed; // poolId => whether revealed
    
    event PoolCreated(uint256 indexed poolId, address indexed creator, uint256 duration);
    event TipAdded(uint256 indexed poolId, address indexed tipper, uint256 amount);
    event PoolEnded(uint256 indexed poolId, address indexed winner, uint256 prizeAmount, uint256 creatorCut);
    event RandomnessCommitted(uint256 indexed poolId, bytes32 commit);
    event RandomnessRevealed(uint256 indexed poolId, uint256 reveal);
    
    constructor() Ownable(msg.sender) {}
    
    /**
     * @dev Create a new tip pool
     * @param duration Duration of the pool in seconds
     * @param creator Address of the pool creator
     */
    function createPool(uint256 duration, address creator) external payable {
        require(duration > 0 && duration <= 365 days, "TipPool: invalid duration");
        require(creator != address(0), "TipPool: invalid creator");
        
        uint256 poolId = nextPoolId++;
        Pool storage pool = pools[poolId];
        
        pool.creator = creator;
        pool.startTime = block.timestamp;
        pool.endTime = block.timestamp + duration;
        pool.ended = false;
        
        emit PoolCreated(poolId, creator, duration);
    }
    
    /**
     * @dev Commit randomness for a pool (must be called before pool ends)
     * @param poolId The pool ID
     * @param commit Hash of the reveal value (keccak256(reveal))
     */
    function commitRandomness(uint256 poolId, bytes32 commit) external {
        Pool storage pool = pools[poolId];
        require(!pool.ended, "TipPool: pool has ended");
        require(block.timestamp < pool.endTime, "TipPool: pool has ended");
        require(poolCommits[poolId] == bytes32(0), "TipPool: randomness already committed");
        
        poolCommits[poolId] = commit;
        emit RandomnessCommitted(poolId, commit);
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
     * @dev Reveal randomness and end a pool (called when pool duration ends)
     * @param poolId The pool ID to end
     * @param reveal The reveal value that was committed
     */
    function revealAndEndPool(uint256 poolId, uint256 reveal) external nonReentrant {
        Pool storage pool = pools[poolId];
        require(!pool.ended, "TipPool: pool already ended");
        require(block.timestamp >= pool.endTime, "TipPool: pool has not ended yet");
        require(pool.totalTips > 0, "TipPool: no tips to distribute");
        
        // Verify commit-reveal
        bytes32 commit = poolCommits[poolId];
        require(commit != bytes32(0), "TipPool: randomness not committed");
        require(keccak256(abi.encodePacked(reveal)) == commit, "TipPool: invalid reveal");
        require(!poolRevealed[poolId], "TipPool: randomness already revealed");
        
        poolRevealed[poolId] = true;
        poolReveals[poolId] = reveal;
        pool.ended = true;
        
        emit RandomnessRevealed(poolId, reveal);
        
        // Draw winner using secure randomness
        address winner = drawWinner(poolId);
        pool.winner = winner;
        
        // Calculate cuts
        uint256 creatorCut = (pool.totalTips * CREATOR_CUT_BPS) / 10000;
        uint256 winnerPrize = pool.totalTips - creatorCut;
        
        // Transfer winnings (state updated first, then external calls)
        if (creatorCut > 0 && pool.creator != address(0)) {
            (bool success, ) = payable(pool.creator).call{value: creatorCut}("");
            require(success, "TipPool: creator transfer failed");
        }
        
        if (winnerPrize > 0 && winner != address(0)) {
            (bool success, ) = payable(winner).call{value: winnerPrize}("");
            require(success, "TipPool: winner transfer failed");
        }
        
        emit PoolEnded(poolId, winner, winnerPrize, creatorCut);
    }
    
    /**
     * @dev End a pool without commit-reveal (fallback for backwards compatibility)
     * @param poolId The pool ID to end
     * @notice This uses block.prevrandao for randomness (less secure, but available if commit-reveal not used)
     */
    function endPool(uint256 poolId) external nonReentrant {
        Pool storage pool = pools[poolId];
        require(!pool.ended, "TipPool: pool already ended");
        require(block.timestamp >= pool.endTime, "TipPool: pool has not ended yet");
        require(pool.totalTips > 0, "TipPool: no tips to distribute");
        
        pool.ended = true;
        
        // Use block.prevrandao if available (Solidity 0.8.18+), otherwise fallback
        uint256 randomSeed;
        if (block.prevrandao != 0) {
            randomSeed = uint256(keccak256(abi.encodePacked(block.prevrandao, block.timestamp, poolId)));
        } else {
            // Fallback for older chains
            randomSeed = uint256(keccak256(abi.encodePacked(block.timestamp, block.difficulty, block.number, poolId)));
        }
        pool.randomSeed = randomSeed;
        
        // Draw winner
        address winner = drawWinner(poolId);
        pool.winner = winner;
        
        // Calculate cuts
        uint256 creatorCut = (pool.totalTips * CREATOR_CUT_BPS) / 10000;
        uint256 winnerPrize = pool.totalTips - creatorCut;
        
        // Transfer winnings (state updated first, then external calls)
        if (creatorCut > 0 && pool.creator != address(0)) {
            (bool success, ) = payable(pool.creator).call{value: creatorCut}("");
            require(success, "TipPool: creator transfer failed");
        }
        
        if (winnerPrize > 0 && winner != address(0)) {
            (bool success, ) = payable(winner).call{value: winnerPrize}("");
            require(success, "TipPool: winner transfer failed");
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
        
        uint256 random;
        
        // Use commit-reveal randomness if available
        if (poolRevealed[poolId] && poolReveals[poolId] != 0) {
            random = uint256(keccak256(abi.encodePacked(poolReveals[poolId], block.timestamp, poolId)));
        } else if (pool.randomSeed != 0) {
            // Use stored random seed from endPool
            random = pool.randomSeed;
        } else {
            // Fallback: use block.prevrandao if available
            if (block.prevrandao != 0) {
                random = uint256(keccak256(abi.encodePacked(block.prevrandao, block.timestamp, poolId)));
            } else {
                // Last resort fallback (less secure)
                random = uint256(keccak256(abi.encodePacked(block.timestamp, block.difficulty, block.number, poolId)));
            }
        }
        
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

