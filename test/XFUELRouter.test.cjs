const { expect } = require('chai')
const { ethers } = require('hardhat')

// Helper to support both ethers v5 and v6
const parseEther = (value) => {
  if (typeof ethers.parseEther === 'function') {
    return ethers.parseEther(value)
  }
  return ethers.utils.parseEther(value)
}

describe('XFUELRouter', function () {
  let router, factory, backstop, xfuelToken, usdcToken
  let owner, treasury, veXFContract, user
  let mockPool

  beforeEach(async function () {
    [owner, treasury, veXFContract, user] = await ethers.getSigners()

    // Deploy mock ERC20 tokens
    const MockERC20 = await ethers.getContractFactory('MockERC20')
    xfuelToken = await MockERC20.deploy('XFuel Token', 'XF', 18)
    usdcToken = await MockERC20.deploy('USD Coin', 'USDC', 6)
    await xfuelToken.waitForDeployment?.() || await xfuelToken.deployed?.()
    await usdcToken.waitForDeployment?.() || await usdcToken.deployed?.()

    // Deploy dependencies
    const XFUELPoolFactory = await ethers.getContractFactory('XFUELPoolFactory')
    factory = await XFUELPoolFactory.deploy()
    await factory.waitForDeployment?.() || await factory.deployed?.()

    const TreasuryILBackstop = await ethers.getContractFactory('TreasuryILBackstop')
    backstop = await TreasuryILBackstop.deploy(await usdcToken.getAddress())
    await backstop.waitForDeployment?.() || await backstop.deployed?.()

    // Deploy router
    const XFUELRouter = await ethers.getContractFactory('XFUELRouter')
    router = await XFUELRouter.deploy(
      await factory.getAddress(),
      await backstop.getAddress(),
      await xfuelToken.getAddress(),
      await usdcToken.getAddress(),
      await treasury.getAddress(),
      await veXFContract.getAddress()
    )
    await router.waitForDeployment?.() || await router.deployed?.()

    // Create a mock pool for testing
    const MockPool = await ethers.getContractFactory('XFUELPool')
    mockPool = await MockPool.deploy()
    await mockPool.waitForDeployment?.() || await mockPool.deployed?.()
  })

  describe('Deployment', function () {
    it('Should set the correct factory address', async function () {
      expect(await router.factory()).to.equal(await factory.getAddress())
    })

    it('Should set the correct backstop address', async function () {
      expect(await router.backstop()).to.equal(await backstop.getAddress())
    })

    it('Should set the correct token addresses', async function () {
      expect(await router.xfuelToken()).to.equal(await xfuelToken.getAddress())
      expect(await router.usdcToken()).to.equal(await usdcToken.getAddress())
    })

    it('Should set the correct treasury and veXF addresses', async function () {
      expect(await router.treasury()).to.equal(await treasury.getAddress())
      expect(await router.veXFContract()).to.equal(await veXFContract.getAddress())
    })

    it('Should initialize with zero fee totals', async function () {
      expect(await router.totalFeesCollected()).to.equal(0)
      expect(await router.totalXFuelBurned()).to.equal(0)
      expect(await router.totalUSDCToVeXF()).to.equal(0)
    })
  })

  describe('swapAndStake', function () {
    it('Should emit SwapAndStake event with correct parameters', async function () {
      const amount = parseEther('1')
      const targetLST = 'stkXPRT'
      const minAmountOut = parseEther('0.9') // 90% minimum

      await expect(
        router.connect(user).swapAndStake(amount, targetLST, minAmountOut, { value: amount })
      ).to.emit(router, 'SwapAndStake')
        .withArgs(
          await user.getAddress(),
          amount,
          amount * 95n / 100n, // 95% of input (5% fee)
          targetLST
        )
    })

    it('Should revert if amount is zero', async function () {
      await expect(
        router.connect(user).swapAndStake(0, 'stkXPRT', 0, { value: 0 })
      ).to.be.revertedWith('XFUELRouter: amount must be greater than 0')
    })

    it('Should revert if msg.value does not match amount', async function () {
      const amount = parseEther('1')
      await expect(
        router.connect(user).swapAndStake(amount, 'stkXPRT', 0, { value: parseEther('0.5') })
      ).to.be.revertedWith('XFUELRouter: TFUEL amount must match msg.value')
    })

    it('Should revert if targetLST is empty', async function () {
      const amount = parseEther('1')
      await expect(
        router.connect(user).swapAndStake(amount, '', 0, { value: amount })
      ).to.be.revertedWith('XFUELRouter: stake target cannot be empty')
    })
    
    it('Should revert if slippage too high', async function () {
      const amount = parseEther('1')
      const minAmountOut = parseEther('1') // 100% minimum (impossible)
      await expect(
        router.connect(user).swapAndStake(amount, 'stkXPRT', minAmountOut, { value: amount })
      ).to.be.revertedWith('XFUELRouter: SLIPPAGE_TOO_HIGH')
    })

    it('Should return correct staked amount (95% of input)', async function () {
      const amount = parseEther('1')
      const minAmountOut = parseEther('0.9')
      const expectedStaked = amount * 95n / 100n
      
      const tx = await router.connect(user).swapAndStake(amount, 'stkXPRT', minAmountOut, { value: amount })
      const receipt = await tx.wait()
      const event = receipt.logs.find(log => {
        try {
          const parsed = router.interface.parseLog(log)
          return parsed?.name === 'SwapAndStake'
        } catch {
          return false
        }
      })
      const parsedEvent = router.interface.parseLog(event)
      expect(parsedEvent.args.stakedAmount.toString()).to.equal(expectedStaked.toString())
    })
  })

  describe('Owner Functions', function () {
    it('Should allow owner to set veXF contract', async function () {
      const newVeXF = ethers.Wallet.createRandom().address
      await router.connect(owner).setVeXFContract(newVeXF)
      expect(await router.veXFContract()).to.equal(newVeXF)
    })

    it('Should allow owner to set treasury', async function () {
      const newTreasury = ethers.Wallet.createRandom().address
      await router.connect(owner).setTreasury(newTreasury)
      expect(await router.treasury()).to.equal(newTreasury)
    })

    it('Should revert if non-owner tries to set veXF contract', async function () {
      const newVeXF = ethers.Wallet.createRandom().address
      await expect(
        router.connect(user).setVeXFContract(newVeXF)
      ).to.be.revertedWith('Ownable: caller is not the owner')
    })

    it('Should revert if non-owner tries to set treasury', async function () {
      const newTreasury = ethers.Wallet.createRandom().address
      await expect(
        router.connect(user).setTreasury(newTreasury)
      ).to.be.revertedWith('Ownable: caller is not the owner')
    })
  })

  describe('Fee Constants', function () {
    it('Should have correct fee split constants', async function () {
      expect(await router.BUYBACK_BPS()).to.equal(6000) // 60%
      expect(await router.VEXF_YIELD_BPS()).to.equal(2500) // 25%
      expect(await router.TREASURY_BPS()).to.equal(1500) // 15%
    })

    it('Should have fee splits that sum to 10000 BPS', async function () {
      const buyback = await router.BUYBACK_BPS()
      const vexf = await router.VEXF_YIELD_BPS()
      const treasury = await router.TREASURY_BPS()
      expect(buyback + vexf + treasury).to.equal(10000)
    })
  })

  // Note: collectAndDistributeFees() requires a fully deployed and initialized pool
  // This would be better tested in integration tests with actual pool instances
  describe('collectAndDistributeFees', function () {
    // This test would require a mock pool that implements collectProtocolFees()
    // For now, we note this needs integration testing
    it('Should handle zero fees gracefully', async function () {
      // This would need a pool contract that returns (0, 0) from collectProtocolFees
      // Placeholder for integration test
    })
  })
})

