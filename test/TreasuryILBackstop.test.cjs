const { expect } = require('chai')
const { ethers } = require('hardhat')

const parseUnits = (value, decimals) => {
  if (typeof ethers.parseUnits === 'function') {
    return ethers.parseUnits(value, decimals)
  }
  return ethers.utils.parseUnits(value, decimals)
}

describe('TreasuryILBackstop', function () {
  let backstop, treasuryToken
  let owner, pool, lp, depositor

  beforeEach(async function () {
    [owner, pool, lp, depositor] = await ethers.getSigners()

    // Deploy mock USDC (6 decimals)
    const MockERC20 = await ethers.getContractFactory('MockERC20')
    treasuryToken = await MockERC20.deploy('USD Coin', 'USDC', 6)
    await treasuryToken.waitForDeployment?.() || await treasuryToken.deployed?.()

    // Deploy backstop
    const TreasuryILBackstop = await ethers.getContractFactory('TreasuryILBackstop')
    backstop = await TreasuryILBackstop.deploy(await treasuryToken.getAddress())
    await backstop.waitForDeployment?.() || await backstop.deployed?.()

    // Set pool address
    await backstop.connect(owner).setPool(await pool.getAddress())
  })

  describe('Deployment', function () {
    it('Should set correct treasury token', async function () {
      expect(await backstop.treasuryToken()).to.equal(await treasuryToken.getAddress())
    })

    it('Should set correct IL threshold', async function () {
      expect(await backstop.IL_THRESHOLD_BPS()).to.equal(800) // 8%
    })

    it('Should initialize with zero coverage provided', async function () {
      expect(await backstop.totalCoverageProvided()).to.equal(0)
    })
  })

  describe('calculateIL', function () {
    it('Should return 0 if current value >= initial value (no loss)', async function () {
      const initialValue = parseUnits('1000', 6)
      const currentValue = parseUnits('1100', 6) // 10% gain
      const ilBps = await backstop.calculateIL(initialValue, currentValue)
      expect(ilBps).to.equal(0)
    })

    it('Should return 0 if current value equals initial value', async function () {
      const initialValue = parseUnits('1000', 6)
      const currentValue = parseUnits('1000', 6)
      const ilBps = await backstop.calculateIL(initialValue, currentValue)
      expect(ilBps).to.equal(0)
    })

    it('Should calculate IL correctly for 5% loss', async function () {
      const initialValue = parseUnits('1000', 6)
      const currentValue = parseUnits('950', 6) // 5% loss
      const ilBps = await backstop.calculateIL(initialValue, currentValue)
      // IL = (1000 - 950) / 1000 * 10000 = 500 BPS = 5%
      expect(ilBps).to.equal(500)
    })

    it('Should calculate IL correctly for 10% loss', async function () {
      const initialValue = parseUnits('1000', 6)
      const currentValue = parseUnits('900', 6) // 10% loss
      const ilBps = await backstop.calculateIL(initialValue, currentValue)
      // IL = (1000 - 900) / 1000 * 10000 = 1000 BPS = 10%
      expect(ilBps).to.equal(1000)
    })

    it('Should calculate IL correctly for 15% loss', async function () {
      const initialValue = parseUnits('1000', 6)
      const currentValue = parseUnits('850', 6) // 15% loss
      const ilBps = await backstop.calculateIL(initialValue, currentValue)
      // IL = (1000 - 850) / 1000 * 10000 = 1500 BPS = 15%
      expect(ilBps).to.equal(1500)
    })
  })

  describe('provideCoverage', function () {
    beforeEach(async function () {
      // Deposit treasury funds
      const depositAmount = parseUnits('10000', 6)
      await treasuryToken.mint(await depositor.getAddress(), depositAmount)
      await treasuryToken.connect(depositor).approve(await backstop.getAddress(), depositAmount)
      await backstop.connect(depositor).depositTreasury(depositAmount)
    })

    it('Should not provide coverage if IL <= 8%', async function () {
      const initialValue = parseUnits('1000', 6)
      const currentValue = parseUnits('930', 6) // 7% loss
      
      const balanceBefore = await treasuryToken.balanceOf(await lp.getAddress())
      await backstop.connect(pool).provideCoverage(
        await lp.getAddress(),
        initialValue,
        currentValue
      )
      const balanceAfter = await treasuryToken.balanceOf(await lp.getAddress())
      
      expect(balanceAfter).to.equal(balanceBefore)
      expect(await backstop.totalCoverageProvided()).to.equal(0)
    })

    it('Should provide coverage if IL > 8%', async function () {
      const initialValue = parseUnits('1000', 6)
      const currentValue = parseUnits('900', 6) // 10% loss
      // Excess loss = 10% - 8% = 2%
      // Coverage = 1000 * 2% = 20 USDC
      
      const coverageAmount = initialValue * 200n / 10000n // 2% excess
      
      await expect(
        backstop.connect(pool).provideCoverage(
          await lp.getAddress(),
          initialValue,
          currentValue
        )
      ).to.emit(backstop, 'ILCoverageProvided')
        .withArgs(
          await lp.getAddress(),
          1000, // 10% IL in BPS
          coverageAmount
        )
      
      expect(await treasuryToken.balanceOf(await lp.getAddress())).to.equal(coverageAmount)
      expect(await backstop.totalCoverageProvided()).to.equal(coverageAmount)
    })

    it('Should calculate coverage correctly for 15% loss', async function () {
      const initialValue = parseUnits('1000', 6)
      const currentValue = parseUnits('850', 6) // 15% loss
      // Excess loss = 15% - 8% = 7%
      // Coverage = 1000 * 7% = 70 USDC
      
      const coverageAmount = initialValue * 700n / 10000n
      
      await backstop.connect(pool).provideCoverage(
        await lp.getAddress(),
        initialValue,
        currentValue
      )
      
      expect(await treasuryToken.balanceOf(await lp.getAddress())).to.equal(coverageAmount)
    })

    it('Should revert if called by non-pool address', async function () {
      await expect(
        backstop.connect(lp).provideCoverage(
          await lp.getAddress(),
          parseUnits('1000', 6),
          parseUnits('900', 6)
        )
      ).to.be.revertedWith('TreasuryILBackstop: UNAUTHORIZED')
    })

    it('Should revert if insufficient treasury balance', async function () {
      const initialValue = parseUnits('100000', 6) // Large initial value
      const currentValue = parseUnits('90000', 6) // 10% loss
      // Would require large coverage, but treasury only has 10000
      
      await expect(
        backstop.connect(pool).provideCoverage(
          await lp.getAddress(),
          initialValue,
          currentValue
        )
      ).to.be.revertedWith('TreasuryILBackstop: INSUFFICIENT_TREASURY')
    })

    it('Should update totalCoverageProvided correctly', async function () {
      const initialValue = parseUnits('1000', 6)
      const currentValue = parseUnits('900', 6)
      
      await backstop.connect(pool).provideCoverage(
        await lp.getAddress(),
        initialValue,
        currentValue
      )
      
      const firstCoverage = await backstop.totalCoverageProvided()
      
      // Provide coverage again
      await backstop.connect(pool).provideCoverage(
        await lp.getAddress(),
        initialValue,
        currentValue
      )
      
      const secondCoverage = await backstop.totalCoverageProvided()
      expect(secondCoverage).to.equal(firstCoverage * 2n)
    })
  })

  describe('depositTreasury', function () {
    it('Should allow depositing treasury funds', async function () {
      const amount = parseUnits('1000', 6)
      await treasuryToken.mint(await depositor.getAddress(), amount)
      await treasuryToken.connect(depositor).approve(await backstop.getAddress(), amount)
      
      await expect(
        backstop.connect(depositor).depositTreasury(amount)
      ).to.emit(backstop, 'TreasuryDeposit')
        .withArgs(await depositor.getAddress(), amount)
      
      expect(await treasuryToken.balanceOf(await backstop.getAddress())).to.equal(amount)
    })

    it('Should revert if amount is zero', async function () {
      await expect(
        backstop.connect(depositor).depositTreasury(0)
      ).to.be.revertedWith('TreasuryILBackstop: INVALID_AMOUNT')
    })
  })

  describe('setPool', function () {
    it('Should allow owner to set pool address', async function () {
      const newPool = ethers.Wallet.createRandom().address
      await backstop.connect(owner).setPool(newPool)
      expect(await backstop.pool()).to.equal(newPool)
    })

    it('Should revert if non-owner tries to set pool', async function () {
      const newPool = ethers.Wallet.createRandom().address
      await expect(
        backstop.connect(lp).setPool(newPool)
      ).to.be.revertedWith('Ownable: caller is not the owner')
    })
  })

  describe('emergencyWithdraw', function () {
    beforeEach(async function () {
      const amount = parseUnits('1000', 6)
      await treasuryToken.mint(await depositor.getAddress(), amount)
      await treasuryToken.connect(depositor).approve(await backstop.getAddress(), amount)
      await backstop.connect(depositor).depositTreasury(amount)
    })

    it('Should allow owner to withdraw funds', async function () {
      const amount = parseUnits('500', 6)
      const ownerBalanceBefore = await treasuryToken.balanceOf(await owner.getAddress())
      
      await backstop.connect(owner).emergencyWithdraw(amount)
      
      const ownerBalanceAfter = await treasuryToken.balanceOf(await owner.getAddress())
      expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(amount)
    })

    it('Should revert if non-owner tries to withdraw', async function () {
      await expect(
        backstop.connect(lp).emergencyWithdraw(parseUnits('100', 6))
      ).to.be.revertedWith('Ownable: caller is not the owner')
    })
  })
})

