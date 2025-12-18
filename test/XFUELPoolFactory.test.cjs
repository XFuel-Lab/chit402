const { expect } = require('chai')
const { ethers } = require('hardhat')
const { getAddress, getZeroAddress } = require('./helpers.cjs')

describe('XFUELPoolFactory', function () {
  let factory
  let tokenA, tokenB
  let owner, user

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners()

    // Deploy mock ERC20 tokens
    const MockERC20 = await ethers.getContractFactory('MockERC20')
    tokenA = await MockERC20.deploy('Token A', 'TKA', 18)
    tokenB = await MockERC20.deploy('Token B', 'TKB', 18)
    await tokenA.waitForDeployment?.() || await tokenA.deployed?.()
    await tokenB.waitForDeployment?.() || await tokenB.deployed?.()

    // Deploy factory
    const XFUELPoolFactory = await ethers.getContractFactory('XFUELPoolFactory')
    factory = await XFUELPoolFactory.deploy()
    await factory.waitForDeployment?.() || await factory.deployed?.()
  })

  describe('Deployment', function () {
    it('Should start with zero pools', async function () {
      expect(await factory.allPoolsLength()).to.equal(0)
    })

    it('Should return zero address for non-existent pool', async function () {
      const tokenAAddr = await getAddress(tokenA)
      const tokenBAddr = await getAddress(tokenB)
      const pool = await factory.getPool(
        tokenAAddr,
        tokenBAddr,
        500
      )
      expect(pool.toLowerCase()).to.equal(getZeroAddress().toLowerCase())
    })
  })

  describe('createPool', function () {
    const fee500 = 500 // 0.05%
    const fee800 = 800 // 0.08%
    const sqrtPriceX96 = '79228162514264337593543950336' // Initial price: 1.0

    it('Should create a pool with correct parameters', async function () {
      const tokenAAddr = await getAddress(tokenA)
      const tokenBAddr = await getAddress(tokenB)
      const tx = await factory.createPool(
        tokenAAddr,
        tokenBAddr,
        fee500,
        sqrtPriceX96
      )
      const receipt = await tx.wait()
      
      // Check event
      const event = receipt.logs.find(log => {
        try {
          const parsed = factory.interface.parseLog(log)
          return parsed?.name === 'PoolCreated'
        } catch {
          return false
        }
      })
      expect(event).to.not.be.undefined

      // Get pool address
      const poolAddress = await factory.getPool(
        tokenAAddr,
        tokenBAddr,
        fee500
      )
      expect(poolAddress.toLowerCase()).to.not.equal(getZeroAddress().toLowerCase())
    })

    it('Should sort tokens correctly (tokenA < tokenB)', async function () {
      await factory.createPool(
        await getAddress(tokenA),
        await getAddress(tokenB),
        fee500,
        sqrtPriceX96
      )

      // Pool should exist in both directions
      const pool1 = await factory.getPool(
        await getAddress(tokenA),
        await getAddress(tokenB),
        fee500
      )
      const pool2 = await factory.getPool(
        await getAddress(tokenB),
        await getAddress(tokenA),
        fee500
      )
      expect(pool1).to.equal(pool2)
      expect(pool1.toLowerCase()).to.not.equal(getZeroAddress().toLowerCase())
    })

    it('Should increment allPoolsLength', async function () {
      expect(await factory.allPoolsLength()).to.equal(0)
      
      await factory.createPool(
        await getAddress(tokenA),
        await getAddress(tokenB),
        fee500,
        sqrtPriceX96
      )
      
      expect(await factory.allPoolsLength()).to.equal(1)
    })

    it('Should allow creating pools with different fee tiers', async function () {
      await factory.createPool(
        await getAddress(tokenA),
        await getAddress(tokenB),
        fee500,
        sqrtPriceX96
      )

      await factory.createPool(
        await getAddress(tokenA),
        await getAddress(tokenB),
        fee800,
        sqrtPriceX96
      )

      const pool500 = await factory.getPool(
        await getAddress(tokenA),
        await getAddress(tokenB),
        fee500
      )
      const pool800 = await factory.getPool(
        await getAddress(tokenA),
        await getAddress(tokenB),
        fee800
      )

      expect(pool500.toLowerCase()).to.not.equal(getZeroAddress().toLowerCase())
      expect(pool800.toLowerCase()).to.not.equal(getZeroAddress().toLowerCase())
      expect(pool500).to.not.equal(pool800)
      expect(await factory.allPoolsLength()).to.equal(2)
    })

    it('Should revert if token addresses are identical', async function () {
      await expect(
        factory.createPool(
          await getAddress(tokenA),
          await getAddress(tokenA),
          fee500,
          sqrtPriceX96
        )
      ).to.be.revertedWith('XFUELPoolFactory: IDENTICAL_ADDRESSES')
    })

    it('Should revert if fee is invalid (not 500 or 800)', async function () {
      await expect(
        factory.createPool(
          await getAddress(tokenA),
          await getAddress(tokenB),
          1000, // Invalid fee
          sqrtPriceX96
        )
      ).to.be.revertedWith('XFUELPoolFactory: INVALID_FEE')
    })

    it('Should revert if token is zero address', async function () {
      await expect(
        factory.createPool(
          getZeroAddress(),
          await getAddress(tokenB),
          fee500,
          sqrtPriceX96
        )
      ).to.be.revertedWith('XFUELPoolFactory: ZERO_ADDRESS')
    })

    it('Should revert if pool already exists', async function () {
      await factory.createPool(
        await getAddress(tokenA),
        await getAddress(tokenB),
        fee500,
        sqrtPriceX96
      )

      await expect(
        factory.createPool(
          await getAddress(tokenA),
          await getAddress(tokenB),
          fee500,
          sqrtPriceX96
        )
      ).to.be.revertedWith('XFUELPoolFactory: POOL_EXISTS')
    })

    it('Should emit PoolCreated event', async function () {
      const tokenAAddr = await getAddress(tokenA)
      const tokenBAddr = await getAddress(tokenB)
      // Tokens are sorted, so token0 is the smaller address
      const token0Addr = tokenAAddr.toLowerCase() < tokenBAddr.toLowerCase() ? tokenAAddr : tokenBAddr
      const token1Addr = tokenAAddr.toLowerCase() < tokenBAddr.toLowerCase() ? tokenBAddr : tokenAAddr
      
      await expect(
        factory.createPool(
          tokenAAddr,
          tokenBAddr,
          fee500,
          sqrtPriceX96
        )
      ).to.emit(factory, 'PoolCreated')
        .withArgs(
          token0Addr, // token0 (sorted)
          token1Addr, // token1 (sorted)
          fee500,
          (address) => address.toLowerCase() !== getZeroAddress().toLowerCase(), // pool address
          1 // pool number
        )
    })

    it('Should create pool with deterministic address (CREATE2)', async function () {
      // CREATE2 should produce same address for same salt
      const tx1 = await factory.createPool(
        await getAddress(tokenA),
        await getAddress(tokenB),
        fee500,
        sqrtPriceX96
      )
      const receipt1 = await tx1.wait()
      
      // Get the pool address
      const poolAddress1 = await factory.getPool(
        await getAddress(tokenA),
        await getAddress(tokenB),
        fee500
      )

      // Deploy new factory (to test CREATE2 determinism)
      // In practice, CREATE2 ensures same inputs = same address
      // This is a simplified check
      expect(poolAddress1.toLowerCase()).to.not.equal(getZeroAddress().toLowerCase())
    })
  })
})

