const { expect } = require('chai')
const { ethers } = require('hardhat')
const { getAddress, parseUnits } = require('./helpers.cjs')

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
    backstop = await TreasuryILBackstop.deploy(await getAddress(treasuryToken))
    await backstop.waitForDeployment?.() || await backstop.deployed?.()

    // Set pool address
    await backstop.connect(owner).setPool(await getAddress(pool))
  })

  describe('Deployment', function () {
    it('Should set correct treasury token', async function () {
      const tokenAddr = await getAddress(treasuryToken)
      expect((await backstop.treasuryToken()).toLowerCase()).to.equal(tokenAddr.toLowerCase())
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
      const depositorAddr = await getAddress(depositor)
      const backstopAddr = await getAddress(backstop)
      await treasuryToken.mint(depositorAddr, depositAmount)
      await treasuryToken.connect(depositor).approve(backstopAddr, depositAmount)
      await backstop.connect(depositor).depositTreasury(depositAmount)
    })

    it('Should not provide coverage if IL <= 8%', async function () {
      const initialValue = parseUnits('1000', 6)
      const currentValue = parseUnits('930', 6) // 7% loss
      
      const lpAddr = await getAddress(lp)
      const balanceBefore = await treasuryToken.balanceOf(lpAddr)
      await backstop.connect(pool).provideCoverage(
        lpAddr,
        initialValue,
        currentValue
      )
      const balanceAfter = await treasuryToken.balanceOf(lpAddr)
      
      expect(balanceAfter).to.equal(balanceBefore)
      expect(await backstop.totalCoverageProvided()).to.equal(0)
    })

    it('Should provide coverage if IL > 8%', async function () {
      const initialValue = parseUnits('1000', 6)
      const currentValue = parseUnits('900', 6) // 10% loss
      // Excess loss = 10% - 8% = 2%
      // Coverage = 1000 * 2% = 20 USDC
      
      const coverageAmount = initialValue.mul(200).div(10000) // 2% excess
      
      await expect(
        backstop.connect(pool).provideCoverage(
          await getAddress(lp),
          initialValue,
          currentValue
        )
      ).to.emit(backstop, 'ILCoverageProvided')
        .withArgs(
          await getAddress(lp),
          1000, // 10% IL in BPS
          coverageAmount
        )
      
      expect(await treasuryToken.balanceOf(await getAddress(lp))).to.equal(coverageAmount)
      expect(await backstop.totalCoverageProvided()).to.equal(coverageAmount)
    })

    it('Should calculate coverage correctly for 15% loss', async function () {
      const initialValue = parseUnits('1000', 6)
      const currentValue = parseUnits('850', 6) // 15% loss
      // Excess loss = 15% - 8% = 7%
      // Coverage = 1000 * 7% = 70 USDC
      
      const coverageAmount = initialValue.mul(700).div(10000)
      
      const lpAddr = await getAddress(lp)
      await backstop.connect(pool).provideCoverage(
        lpAddr,
        initialValue,
        currentValue
      )
      
      expect(await treasuryToken.balanceOf(lpAddr)).to.equal(coverageAmount)
    })

    it('Should revert if called by non-pool address', async function () {
      await expect(
        backstop.connect(lp).provideCoverage(
          await getAddress(lp),
          parseUnits('1000', 6),
          parseUnits('900', 6)
        )
      ).to.be.revertedWith('TreasuryILBackstop: UNAUTHORIZED')
    })

    it('Should revert if insufficient treasury balance', async function () {
      // Treasury has 10000 USDC, but we need more than that
      // For 10% loss on 1000000, excess is 2% = 20000 USDC (exceeds treasury)
      const initialValue = parseUnits('1000000', 6) // Very large initial value
      const currentValue = parseUnits('900000', 6) // 10% loss
      // Excess loss = 10% - 8% = 2%
      // Coverage = 1000000 * 2% = 20000 USDC (exceeds treasury of 10000)
      
      await expect(
        backstop.connect(pool).provideCoverage(
          await getAddress(lp),
          initialValue,
          currentValue
        )
      ).to.be.revertedWith('TreasuryILBackstop: INSUFFICIENT_TREASURY')
    })

    it('Should update totalCoverageProvided correctly', async function () {
      const initialValue = parseUnits('1000', 6)
      const currentValue = parseUnits('900', 6)
      
      const lpAddr = await getAddress(lp)
      await backstop.connect(pool).provideCoverage(
        lpAddr,
        initialValue,
        currentValue
      )
      
      const firstCoverage = await backstop.totalCoverageProvided()
      
      // Provide coverage again
      await backstop.connect(pool).provideCoverage(
        lpAddr,
        initialValue,
        currentValue
      )
      
      const secondCoverage = await backstop.totalCoverageProvided()
      expect(secondCoverage).to.equal(firstCoverage.mul(2))
    })
  })

  describe('depositTreasury', function () {
    it('Should allow depositing treasury funds', async function () {
      const amount = parseUnits('1000', 6)
      const depositorAddr = await getAddress(depositor)
      const backstopAddr = await getAddress(backstop)
      await treasuryToken.mint(depositorAddr, amount)
      await treasuryToken.connect(depositor).approve(backstopAddr, amount)
      
      await expect(
        backstop.connect(depositor).depositTreasury(amount)
      ).to.emit(backstop, 'TreasuryDeposit')
        .withArgs(depositorAddr, amount)
      
      expect(await treasuryToken.balanceOf(backstopAddr)).to.equal(amount)
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
      const depositorAddr = await getAddress(depositor)
      const backstopAddr = await getAddress(backstop)
      await treasuryToken.mint(depositorAddr, amount)
      await treasuryToken.connect(depositor).approve(backstopAddr, amount)
      await backstop.connect(depositor).depositTreasury(amount)
    })

    it('Should allow owner to withdraw funds', async function () {
      const amount = parseUnits('500', 6)
      const ownerAddr = await getAddress(owner)
      const ownerBalanceBefore = await treasuryToken.balanceOf(ownerAddr)
      
      await backstop.connect(owner).emergencyWithdraw(amount)
      
      const ownerBalanceAfter = await treasuryToken.balanceOf(ownerAddr)
      expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(amount)
    })

    it('Should revert if non-owner tries to withdraw', async function () {
      await expect(
        backstop.connect(lp).emergencyWithdraw(parseUnits('100', 6))
      ).to.be.revertedWith('Ownable: caller is not the owner')
    })
  })
})

