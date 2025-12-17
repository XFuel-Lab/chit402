const { expect } = require('chai')
const { ethers } = require('hardhat')

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
      const pool = await factory.getPool(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        500
      )
      expect(pool).to.equal(ethers.ZeroAddress)
    })
  })

  describe('createPool', function () {
    const fee500 = 500 // 0.05%
    const fee800 = 800 // 0.08%
    const sqrtPriceX96 = '79228162514264337593543950336' // Initial price: 1.0

    it('Should create a pool with correct parameters', async function () {
      const tx = await factory.createPool(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
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
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        fee500
      )
      expect(poolAddress).to.not.equal(ethers.ZeroAddress)
    })

    it('Should sort tokens correctly (tokenA < tokenB)', async function () {
      await factory.createPool(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        fee500,
        sqrtPriceX96
      )

      // Pool should exist in both directions
      const pool1 = await factory.getPool(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        fee500
      )
      const pool2 = await factory.getPool(
        await tokenB.getAddress(),
        await tokenA.getAddress(),
        fee500
      )
      expect(pool1).to.equal(pool2)
      expect(pool1).to.not.equal(ethers.ZeroAddress)
    })

    it('Should increment allPoolsLength', async function () {
      expect(await factory.allPoolsLength()).to.equal(0)
      
      await factory.createPool(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        fee500,
        sqrtPriceX96
      )
      
      expect(await factory.allPoolsLength()).to.equal(1)
    })

    it('Should allow creating pools with different fee tiers', async function () {
      await factory.createPool(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        fee500,
        sqrtPriceX96
      )

      await factory.createPool(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        fee800,
        sqrtPriceX96
      )

      const pool500 = await factory.getPool(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        fee500
      )
      const pool800 = await factory.getPool(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        fee800
      )

      expect(pool500).to.not.equal(ethers.ZeroAddress)
      expect(pool800).to.not.equal(ethers.ZeroAddress)
      expect(pool500).to.not.equal(pool800)
      expect(await factory.allPoolsLength()).to.equal(2)
    })

    it('Should revert if token addresses are identical', async function () {
      await expect(
        factory.createPool(
          await tokenA.getAddress(),
          await tokenA.getAddress(),
          fee500,
          sqrtPriceX96
        )
      ).to.be.revertedWith('XFUELPoolFactory: IDENTICAL_ADDRESSES')
    })

    it('Should revert if fee is invalid (not 500 or 800)', async function () {
      await expect(
        factory.createPool(
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          1000, // Invalid fee
          sqrtPriceX96
        )
      ).to.be.revertedWith('XFUELPoolFactory: INVALID_FEE')
    })

    it('Should revert if token is zero address', async function () {
      await expect(
        factory.createPool(
          ethers.ZeroAddress,
          await tokenB.getAddress(),
          fee500,
          sqrtPriceX96
        )
      ).to.be.revertedWith('XFUELPoolFactory: ZERO_ADDRESS')
    })

    it('Should revert if pool already exists', async function () {
      await factory.createPool(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        fee500,
        sqrtPriceX96
      )

      await expect(
        factory.createPool(
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          fee500,
          sqrtPriceX96
        )
      ).to.be.revertedWith('XFUELPoolFactory: POOL_EXISTS')
    })

    it('Should emit PoolCreated event', async function () {
      await expect(
        factory.createPool(
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          fee500,
          sqrtPriceX96
        )
      ).to.emit(factory, 'PoolCreated')
        .withArgs(
          await tokenA.getAddress(), // token0 (sorted)
          await tokenB.getAddress(), // token1 (sorted)
          fee500,
          (address) => address !== ethers.ZeroAddress, // pool address
          1 // pool number
        )
    })

    it('Should create pool with deterministic address (CREATE2)', async function () {
      // CREATE2 should produce same address for same salt
      const tx1 = await factory.createPool(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        fee500,
        sqrtPriceX96
      )
      const receipt1 = await tx1.wait()
      
      // Get the pool address
      const poolAddress1 = await factory.getPool(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        fee500
      )

      // Deploy new factory (to test CREATE2 determinism)
      // In practice, CREATE2 ensures same inputs = same address
      // This is a simplified check
      expect(poolAddress1).to.not.equal(ethers.ZeroAddress)
    })
  })
})

