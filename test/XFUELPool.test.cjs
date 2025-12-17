const { expect } = require('chai')
const { ethers } = require('hardhat')

const parseEther = (value) => {
  if (typeof ethers.parseEther === 'function') {
    return ethers.parseEther(value)
  }
  return ethers.utils.parseEther(value)
}

describe('XFUELPool', function () {
  let pool, factory, token0, token1
  let owner, user, recipient

  beforeEach(async function () {
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

    // Deploy pool (factory will deploy, but we'll test direct deployment for some tests)
    const XFUELPool = await ethers.getContractFactory('XFUELPool')
    pool = await XFUELPool.deploy()
    await pool.waitForDeployment?.() || await pool.deployed?.()
  })

  describe('Deployment', function () {
    it('Should set factory to deployer', async function () {
      expect(await pool.factory()).to.equal(await owner.getAddress())
    })
  })

  describe('initialize', function () {
    const fee500 = 500
    const sqrtPriceX96 = '79228162514264337593543950336' // Price 1.0

    beforeEach(async function () {
      // Set factory to our deployed factory for testing
      // Note: In production, factory deploys pool, so factory address is set
      // For testing, we'll use factory.createPool() which handles initialization
    })

    it('Should initialize pool with correct parameters', async function () {
      // Create pool via factory (proper way)
      await factory.createPool(
        await token0.getAddress(),
        await token1.getAddress(),
        fee500,
        sqrtPriceX96
      )

      const poolAddress = await factory.getPool(
        await token0.getAddress(),
        await token1.getAddress(),
        fee500
      )
      const poolInstance = await ethers.getContractAt('XFUELPool', poolAddress)

      expect(await poolInstance.token0()).to.equal(await token0.getAddress())
      expect(await poolInstance.token1()).to.equal(await token1.getAddress())
      expect(await poolInstance.fee()).to.equal(fee500)
      expect(await poolInstance.sqrtPriceX96()).to.equal(sqrtPriceX96)
    })

    it('Should revert if not called by factory', async function () {
      // Direct initialization should fail
      const XFUELPool = await ethers.getContractFactory('XFUELPool')
      const newPool = await XFUELPool.deploy()
      await newPool.waitForDeployment?.() || await newPool.deployed?.()

      await expect(
        newPool.initialize(
          await token0.getAddress(),
          await token1.getAddress(),
          fee500,
          sqrtPriceX96
        )
      ).to.be.revertedWith('XFUELPool: FORBIDDEN')
    })

    it('Should revert if fee is invalid', async function () {
      const XFUELPool = await ethers.getContractFactory('XFUELPool')
      const newPool = await XFUELPool.connect(factory.runner).deploy()
      await newPool.waitForDeployment?.() || await newPool.deployed?.()

      await expect(
        newPool.connect(factory.runner).initialize(
          await token0.getAddress(),
          await token1.getAddress(),
          1000, // Invalid fee
          sqrtPriceX96
        )
      ).to.be.revertedWith('XFUELPool: INVALID_FEE')
    })

    it('Should revert if already initialized', async function () {
      await factory.createPool(
        await token0.getAddress(),
        await token1.getAddress(),
        fee500,
        sqrtPriceX96
      )

      const poolAddress = await factory.getPool(
        await token0.getAddress(),
        await token1.getAddress(),
        fee500
      )
      const poolInstance = await ethers.getContractAt('XFUELPool', poolAddress)

      await expect(
        poolInstance.connect(factory.runner).initialize(
          await token0.getAddress(),
          await token1.getAddress(),
          fee500,
          sqrtPriceX96
        )
      ).to.be.revertedWith('XFUELPool: ALREADY_INITIALIZED')
    })
  })

  describe('setFeeRecipient', function () {
    const fee500 = 500
    const sqrtPriceX96 = '79228162514264337593543950336'

    beforeEach(async function () {
      await factory.createPool(
        await token0.getAddress(),
        await token1.getAddress(),
        fee500,
        sqrtPriceX96
      )
      const poolAddress = await factory.getPool(
        await token0.getAddress(),
        await token1.getAddress(),
        fee500
      )
      pool = await ethers.getContractAt('XFUELPool', poolAddress)
    })

    it('Should allow factory to set fee recipient', async function () {
      const newRecipient = await recipient.getAddress()
      await pool.connect(factory.runner).setFeeRecipient(newRecipient)
      expect(await pool.feeRecipient()).to.equal(newRecipient)
    })

    it('Should revert if not called by factory', async function () {
      await expect(
        pool.connect(user).setFeeRecipient(await recipient.getAddress())
      ).to.be.revertedWith('XFUELPool: FORBIDDEN')
    })
  })

  describe('swap', function () {
    const fee500 = 500
    const sqrtPriceX96 = '79228162514264337593543950336'

    beforeEach(async function () {
      await factory.createPool(
        await token0.getAddress(),
        await token1.getAddress(),
        fee500,
        sqrtPriceX96
      )
      const poolAddress = await factory.getPool(
        await token0.getAddress(),
        await token1.getAddress(),
        fee500
      )
      pool = await ethers.getContractAt('XFUELPool', poolAddress)

      // Mint tokens and provide liquidity
      const amount0 = parseEther('1000')
      const amount1 = parseEther('1000')
      await token0.mint(await user.getAddress(), amount0)
      await token1.mint(await user.getAddress(), amount1)
      await token0.mint(await pool.getAddress(), amount0)
      await token1.mint(await pool.getAddress(), amount1)
    })

    it('Should revert if amountSpecified is zero', async function () {
      await expect(
        pool.connect(user).swap(await recipient.getAddress(), true, 0, 0, 0)
      ).to.be.revertedWith('XFUELPool: INVALID_AMOUNT')
    })

    it('Should emit Swap event', async function () {
      const amount = parseEther('1')
      await token0.connect(user).approve(await pool.getAddress(), amount)

      await expect(
        pool.connect(user).swap(await recipient.getAddress(), true, amount, 0, 0)
      ).to.emit(pool, 'Swap')
    })
    
    it('Should revert if slippage too high', async function () {
      const amount = parseEther('1')
      const minAmountOut = parseEther('1000') // Unrealistically high
      await token0.connect(user).approve(await pool.getAddress(), amount)

      await expect(
        pool.connect(user).swap(await recipient.getAddress(), true, amount, 0, minAmountOut)
      ).to.be.revertedWith('XFUELPool: SLIPPAGE_TOO_HIGH')
    })

    // Note: The current swap implementation has a bug (see known-issues.md M-03)
    // When zeroForOne=false, it transfers amountOut instead of amountIn
    // These tests document current behavior, which should be fixed
  })

  describe('collectProtocolFees', function () {
    const fee500 = 500
    const sqrtPriceX96 = '79228162514264337593543950336'

    beforeEach(async function () {
      await factory.createPool(
        await token0.getAddress(),
        await token1.getAddress(),
        fee500,
        sqrtPriceX96
      )
      const poolAddress = await factory.getPool(
        await token0.getAddress(),
        await token1.getAddress(),
        fee500
      )
      pool = await ethers.getContractAt('XFUELPool', poolAddress)
      
      // Set fee recipient
      await pool.connect(factory.runner).setFeeRecipient(await recipient.getAddress())
    })

    it('Should return zero if no fees collected', async function () {
      const [amount0, amount1] = await pool.collectProtocolFees()
      expect(amount0).to.equal(0)
      expect(amount1).to.equal(0)
    })

    // Note: To fully test fee collection, we'd need to:
    // 1. Execute swaps that generate protocol fees
    // 2. Check protocolFees0 and protocolFees1 are incremented
    // 3. Call collectProtocolFees and verify transfers
    // This requires understanding how fees are calculated in swaps
  })
})

