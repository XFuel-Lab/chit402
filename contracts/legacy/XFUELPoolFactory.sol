// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./XFUELPool.sol";

/**
 * @title XFUELPoolFactory
 * @dev Factory for creating TFUEL↔XPRT concentrated liquidity pools
 * // DROPPED: Dynamic fee tiers - Unnecessary complexity - fixed at 0.5%
 */
contract XFUELPoolFactory {
    // DROPPED: Fee tier mapping - Unnecessary complexity - fixed at 0.5%
    mapping(address => mapping(address => address)) public getPool;
    address[] public allPools;
    
    event PoolCreated(
        address indexed token0,
        address indexed token1,
        // DROPPED: fee parameter - Unnecessary complexity - fixed at 0.5%
        address pool,
        uint256
    );
    
    function createPool(
        address tokenA,
        address tokenB,
        // DROPPED: fee parameter - Unnecessary complexity - fixed at 0.5%
        uint160 sqrtPriceX96
    ) external returns (address pool) {
        require(tokenA != tokenB, "XFUELPoolFactory: IDENTICAL_ADDRESSES");
        // DROPPED: Fee validation - Unnecessary complexity - fixed at 0.5%
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), "XFUELPoolFactory: ZERO_ADDRESS");
        require(getPool[token0][token1] == address(0), "XFUELPoolFactory: POOL_EXISTS");
        
        bytes memory bytecode = type(XFUELPool).creationCode;
        bytes32 salt = keccak256(abi.encodePacked(token0, token1)); // DROPPED: fee from salt
        assembly {
            pool := create2(0, add(bytecode, 32), mload(bytecode), salt)
        }
        
        XFUELPool(pool).initialize(token0, token1, sqrtPriceX96); // DROPPED: fee parameter
        
        getPool[token0][token1] = pool;
        getPool[token1][token0] = pool;
        allPools.push(pool);
        
        emit PoolCreated(token0, token1, pool, allPools.length); // DROPPED: fee from event
    }
    
    function allPoolsLength() external view returns (uint256) {
        return allPools.length;
    }
}

