// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./XFUELPool.sol";

/**
 * @title XFUELPoolFactory
 * @dev Factory for creating TFUEL↔XPRT concentrated liquidity pools
 */
contract XFUELPoolFactory {
    mapping(address => mapping(address => mapping(uint24 => address))) public getPool;
    address[] public allPools;
    
    event PoolCreated(
        address indexed token0,
        address indexed token1,
        uint24 indexed fee,
        address pool,
        uint256
    );
    
    function createPool(
        address tokenA,
        address tokenB,
        uint24 fee,
        uint160 sqrtPriceX96
    ) external returns (address pool) {
        require(tokenA != tokenB, "XFUELPoolFactory: IDENTICAL_ADDRESSES");
        require(fee == 500 || fee == 800, "XFUELPoolFactory: INVALID_FEE");
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), "XFUELPoolFactory: ZERO_ADDRESS");
        require(getPool[token0][token1][fee] == address(0), "XFUELPoolFactory: POOL_EXISTS");
        
        bytes memory bytecode = type(XFUELPool).creationCode;
        bytes32 salt = keccak256(abi.encodePacked(token0, token1, fee));
        assembly {
            pool := create2(0, add(bytecode, 32), mload(bytecode), salt)
        }
        
        XFUELPool(pool).initialize(token0, token1, fee, sqrtPriceX96);
        
        getPool[token0][token1][fee] = pool;
        getPool[token1][token0][fee] = pool;
        allPools.push(pool);
        
        emit PoolCreated(token0, token1, fee, pool, allPools.length);
    }
    
    function allPoolsLength() external view returns (uint256) {
        return allPools.length;
    }
}

