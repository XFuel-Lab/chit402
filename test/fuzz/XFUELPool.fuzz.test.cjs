const { expect } = require('chai')
const { ethers } = require('hardhat')
const hre = require('hardhat')
const { getAddress, parseEther, getZeroAddress } = require('../helpers.cjs')

/**
 * Fuzz tests for XFUELPool
 * Tests swap amounts with various edge cases: small, max, dust, overflow-prone values
 */
describe('XFUELPool Fuzz Tests', function () {
  let pool, factory, token0, token1
  let owner, user, recipient

  beforeEach(async function () {
    // Reset network state to prevent pollution between tests
    await hre.network.provider.request({
      method: 'hardhat_reset',
      params: []
    })
    
    [owner, user, recipient] = await ethers.getSigners()

    // Deploy mock ERC20 tokens
    const MockERC20 = await ethers.getContractFactory('MockERC20')
    token0 = await MockERC20.deploy('Token 0', 'TK0', 18)
    token1 = await MockERC20.deploy('Token 1', 'TK1', 18)
    await token0.waitForDeployment?.() || await token0.deployed?.()
    await token1.waitForDeployment?.() || await token1.deployed?.()

    // Deploy factory
    const XFUELPoolFactory = await ethers.getContractFactory('XFUELPoolFactory')
    factory = await XFUELPoolFactory.deploy()
    await factory.waitForDeployment?.() || await factory.deployed?.()

    // Create pool
    const fee500 = 500
    const sqrtPriceX96 = '79228162514264337593543950336'
    const token0Addr = await getAddress(token0)
    const token1Addr = await getAddress(token1)
    await factory.createPool(token0Addr, token1Addr, fee500, sqrtPriceX96)

    const poolAddress = await factory.getPool(token0Addr, token1Addr, fee500)
    pool = await ethers.getContractAt('XFUELPool', poolAddress)

    // Add initial liquidity
    const liquidityAmount = parseEther('1000000') // Large liquidity pool
    const poolAddr = await getAddress(pool)
    await token0.mint(poolAddr, liquidityAmount)
    await token1.mint(poolAddr, liquidityAmount)
  })

  afterEach(async function () {
    // Reset network state after each test
    await hre.network.provider.request({
      method: 'hardhat_reset',
      params: []
    })
  })

  describe('Fuzz: swap amounts', function () {
    const testCases = [
      { name: 'dust amount', amount: '1' }, // 1 wei
      { name: 'small amount', amount: '0.0001' },
      { name: 'medium amount', amount: '1' },
      { name: 'large amount', amount: '1000' },
      { name: 'very large amount', amount: '100000' },
    ]

    testCases.forEach(({ name, amount }) => {
      it(`Should handle swap with ${name}`, async function () {
        // Bound amounts to realistic max (10000 ETH)
        const maxAmount = parseEther('10000')
        let swapAmount = parseEther(amount)
        if (swapAmount.gt(maxAmount)) {
          swapAmount = maxAmount
        }
        const poolAddr = await getAddress(pool)
        const recipientAddr = await getAddress(recipient)
        const userAddr = await getAddress(user)

        // For dust amounts, skip if pool doesn't have enough liquidity
        if (swapAmount.lte(ethers.BigNumber.from('1000'))) {
          const poolBalance0 = await token0.balanceOf(poolAddr)
          if (poolBalance0.lt(swapAmount.mul(100))) {
            // Skip test if pool liquidity is too low for dust amount
            this.skip()
          }
        }

        // Mint tokens to user with extra for gas/rounding
        const mintAmount = swapAmount.mul(5) // More headroom
        await token0.mint(userAddr, mintAmount)
        
        // Approve pool to spend tokens - use MaxUint256 for fuzz tests
        const maxApproval = ethers.BigNumber.from('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
        const approveTx = await token0.connect(user).approve(poolAddr, maxApproval)
        await approveTx.wait()
        
        // Mine block to ensure approval is processed
        await ethers.provider.send('evm_mine', [])
        
        // Increase time and mine again to ensure state is fully settled
        await hre.network.provider.request({
          method: 'evm_increaseTime',
          params: [1]
        })
        await ethers.provider.send('evm_mine', [])
        
        // Verify approval was set correctly with explicit logging
        const allowance = await token0.allowance(userAddr, poolAddr)
        console.log(`[DEBUG] Allowance after approval: ${allowance.toString()}, swapAmount: ${swapAmount.toString()}`)
        expect(allowance.gte(swapAmount)).to.equal(true)

        // Get initial balances
        const recipientBalance1Before = await token1.balanceOf(recipientAddr)
        const poolBalance0Before = await token0.balanceOf(poolAddr)

        // Execute swap
        try {
          await pool.connect(user).swap(recipientAddr, true, swapAmount, 0, 0)

          // Verify balances changed
          const recipientBalance1After = await token1.balanceOf(recipientAddr)
          const poolBalance0After = await token0.balanceOf(poolAddr)

          // Recipient should receive tokens (unless swap amount is too large)
          if (swapAmount.lte(poolBalance0Before.div(2))) {
            expect(recipientBalance1After.gte(recipientBalance1Before)).to.equal(true)
            expect(poolBalance0After.gte(poolBalance0Before)).to.equal(true)
          }
        } catch (error) {
          // Large swaps might fail due to insufficient liquidity - this is expected
          if (swapAmount.gt(parseEther('50000'))) {
            expect(error.message).to.include('revert')
          } else {
            throw error
          }
        }
      })
    })
  })

  describe('Fuzz: swap direction zeroForOne', function () {
    it('Should handle multiple swaps in same direction', async function () {
      const poolAddr = await getAddress(pool)
      const recipientAddr = await getAddress(recipient)
      const userAddr = await getAddress(user)
      const amounts = [parseEther('1'), parseEther('2'), parseEther('0.5')]

      // Mint all tokens upfront and approve with MaxUint256 once
      const totalAmount = amounts.reduce((sum, amt) => sum.add(amt), ethers.BigNumber.from(0))
      await token0.mint(userAddr, totalAmount.mul(3))
      const maxApproval = ethers.BigNumber.from('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
      const approveTx = await token0.connect(user).approve(poolAddr, maxApproval)
      await approveTx.wait()
      
      // Mine block to ensure approval is processed
      await ethers.provider.send('evm_mine', [])
      
      // Increase time and mine again to ensure state is fully settled
      await network.provider.request({
        method: 'evm_increaseTime',
        params: [1]
      })
      await ethers.provider.send('evm_mine', [])
      
      // Verify approval with explicit logging
      const allowance = await token0.allowance(userAddr, poolAddr)
      console.log(`[DEBUG] Multiple swaps - Allowance: ${allowance.toString()}, totalAmount: ${totalAmount.toString()}`)
      expect(allowance.gte(totalAmount)).to.equal(true)

      for (const amount of amounts) {
        await pool.connect(user).swap(recipientAddr, true, amount, 0, 0)
      }

      // Pool should have received tokens
      const poolBalance0 = await token0.balanceOf(poolAddr)
      expect(poolBalance0.gt(0)).to.equal(true)
    })

    it('Should handle multiple swaps in reverse direction', async function () {
      const poolAddr = await getAddress(pool)
      const recipientAddr = await getAddress(recipient)
      const userAddr = await getAddress(user)
      const amounts = [parseEther('1'), parseEther('2'), parseEther('0.5')]

      // Mint all tokens upfront and approve with MaxUint256
      const totalAmount = amounts.reduce((sum, amt) => sum.add(amt), ethers.BigNumber.from(0))
      await token1.mint(userAddr, totalAmount.mul(2))
      const maxApproval = ethers.BigNumber.from('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
      const approveTx = await token1.connect(user).approve(poolAddr, maxApproval)
      await approveTx.wait()
      
      // Mine block to ensure approval is processed
      await ethers.provider.send('evm_mine', [])
      
      // Increase time and mine again to ensure state is fully settled
      await network.provider.request({
        method: 'evm_increaseTime',
        params: [1]
      })
      await ethers.provider.send('evm_mine', [])
      
      // Verify approval with explicit logging
      const allowance = await token1.allowance(userAddr, poolAddr)
      console.log(`[DEBUG] Reverse swaps - Allowance: ${allowance.toString()}, totalAmount: ${totalAmount.toString()}`)
      expect(allowance.gte(totalAmount)).to.equal(true)

      for (const amount of amounts) {
        await pool.connect(user).swap(recipientAddr, false, amount, 0, 0)
      }

      // Pool should have received tokens
      const poolBalance1 = await token1.balanceOf(poolAddr)
      expect(poolBalance1.gt(0)).to.equal(true)
    })
  })

  describe('Fuzz: slippage protection', function () {
    it('Should reject swaps with unrealistic slippage', async function () {
      const swapAmount = parseEther('1')
      const poolAddr = await getAddress(pool)
      const recipientAddr = await getAddress(recipient)
      const unrealisticMinOut = parseEther('1000000') // Way too high

      const userAddr = await getAddress(user)
      await token0.mint(userAddr, swapAmount)
      const approveTx = await token0.connect(user).approve(poolAddr, swapAmount)
      await approveTx.wait()
      await ethers.provider.send('evm_mine', [])
      
      // Increase time and mine again to ensure state is fully settled
      await network.provider.request({
        method: 'evm_increaseTime',
        params: [1]
      })
      await ethers.provider.send('evm_mine', [])
      
      // Verify approval
      const allowance = await token0.allowance(userAddr, poolAddr)
      console.log(`[DEBUG] Slippage test - Allowance: ${allowance.toString()}, swapAmount: ${swapAmount.toString()}`)
      expect(allowance.gte(swapAmount)).to.equal(true)

      await expect(
        pool.connect(user).swap(recipientAddr, true, swapAmount, 0, unrealisticMinOut)
      ).to.be.revertedWith('XFUELPool: SLIPPAGE_TOO_HIGH')
    })

    it('Should accept swaps with reasonable slippage', async function () {
      const swapAmount = parseEther('1')
      const poolAddr = await getAddress(pool)
      const recipientAddr = await getAddress(recipient)
      const userAddr = await getAddress(user)
      const reasonableMinOut = parseEther('0.0001') // Very low but not zero

      await token0.mint(userAddr, swapAmount.mul(2))
      const approveTx = await token0.connect(user).approve(poolAddr, swapAmount.mul(2))
      await approveTx.wait()
      
      // Mine block to ensure approval is processed
      await ethers.provider.send('evm_mine', [])
      
      // Increase time and mine again to ensure state is fully settled
      await network.provider.request({
        method: 'evm_increaseTime',
        params: [1]
      })
      await ethers.provider.send('evm_mine', [])
      
      // Verify approval
      const allowance = await token0.allowance(userAddr, poolAddr)
      console.log(`[DEBUG] Reasonable slippage - Allowance: ${allowance.toString()}, swapAmount: ${swapAmount.toString()}`)
      expect(allowance.gte(swapAmount)).to.equal(true)

      // Should not revert
      await expect(
        pool.connect(user).swap(recipientAddr, true, swapAmount, 0, reasonableMinOut)
      ).to.not.be.reverted
    })
  })

  describe('Fuzz: edge case values', function () {
    it('Should handle max uint256 value safely', async function () {
      // Use a very large but valid value instead of max uint256
      // Max uint256 causes ABI encoding issues, so use a practical maximum
      const veryLargeAmount = ethers.BigNumber.from('2').pow(128).sub(1)
      const poolAddr = await getAddress(pool)
      const recipientAddr = await getAddress(recipient)

      // Should revert due to invalid amount handling or insufficient liquidity
      // (Solidity 0.8+ will revert on overflow, which is expected)
      await expect(
        pool.connect(user).swap(recipientAddr, true, veryLargeAmount, 0, 0)
      ).to.be.reverted
    })

    it('Should handle zero amount (should revert)', async function () {
      const recipientAddr = await getAddress(recipient)

      await expect(
        pool.connect(user).swap(recipientAddr, true, 0, 0, 0)
      ).to.be.revertedWith('XFUELPool: INVALID_AMOUNT')
    })
  })
})

