const { expect } = require('chai')
const { ethers, upgrades } = require('hardhat')
const hre = require('hardhat')
const { getAddress, parseEther, parseUnits } = require('./helpers.cjs')

describe('RevenueSplitter', function () {
  let revenueSplitter, veXF, revenueToken, xfToken
  let owner, treasury, user1, user2
  let MockERC20

  beforeEach(async function () {
    await hre.network.provider.request({
      method: 'hardhat_reset',
      params: []
    })

    ;[owner, treasury, user1, user2] = await ethers.getSigners()

    // Deploy mock tokens
    MockERC20 = await ethers.getContractFactory('MockERC20')
    xfToken = await MockERC20.deploy('XFuel Token', 'XF', 18)
    await xfToken.waitForDeployment?.() || await xfToken.deployed?.()
    
    revenueToken = await MockERC20.deploy('USD Coin', 'USDC', 6)
    await revenueToken.waitForDeployment?.() || await revenueToken.deployed?.()

    // Deploy veXF
    const VeXF = await ethers.getContractFactory('veXF')
    veXF = await upgrades.deployProxy(VeXF, [
      await getAddress(xfToken),
      await getAddress(owner)
    ], { initializer: 'initialize' })
    await veXF.waitForDeployment?.() || await veXF.deployed?.()

    // Deploy RevenueSplitter
    const RevenueSplitter = await ethers.getContractFactory('RevenueSplitter')
    revenueSplitter = await upgrades.deployProxy(RevenueSplitter, [
      await getAddress(revenueToken),
      await getAddress(veXF),
      await getAddress(treasury),
      await getAddress(owner)
    ], { initializer: 'initialize' })
    await revenueSplitter.waitForDeployment?.() || await revenueSplitter.deployed?.()
  })

  afterEach(async function () {
    await hre.network.provider.request({
      method: 'hardhat_reset',
      params: []
    })
  })

  describe('Deployment', function () {
    it('Should initialize with correct addresses', async function () {
      expect(await revenueSplitter.revenueToken()).to.equal(await getAddress(revenueToken))
      expect(await revenueSplitter.veXFContract()).to.equal(await getAddress(veXF))
      expect(await revenueSplitter.treasury()).to.equal(await getAddress(treasury))
      expect(await revenueSplitter.owner()).to.equal(await getAddress(owner))
    })

    it('Should initialize with zero totals', async function () {
      expect(await revenueSplitter.totalRevenueCollected()).to.equal(0)
      expect(await revenueSplitter.totalYieldDistributed()).to.equal(0)
      expect(await revenueSplitter.totalBuybackBurned()).to.equal(0)
      expect(await revenueSplitter.totalRXFMinted()).to.equal(0)
      expect(await revenueSplitter.totalTreasurySent()).to.equal(0)
    })

    it('Should revert if initialized with zero addresses', async function () {
      const RevenueSplitter = await ethers.getContractFactory('RevenueSplitter')
      
      await expect(
        upgrades.deployProxy(RevenueSplitter, [
          ethers.ZeroAddress,
          await getAddress(veXF),
          await getAddress(treasury),
          await getAddress(owner)
        ], { initializer: 'initialize' })
      ).to.be.revertedWith('RevenueSplitter: invalid revenue token')

      await expect(
        upgrades.deployProxy(RevenueSplitter, [
          await getAddress(revenueToken),
          ethers.ZeroAddress,
          await getAddress(treasury),
          await getAddress(owner)
        ], { initializer: 'initialize' })
      ).to.be.revertedWith('RevenueSplitter: invalid veXF')

      await expect(
        upgrades.deployProxy(RevenueSplitter, [
          await getAddress(revenueToken),
          await getAddress(veXF),
          ethers.ZeroAddress,
          await getAddress(owner)
        ], { initializer: 'initialize' })
      ).to.be.revertedWith('RevenueSplitter: invalid treasury')
    })
  })

  describe('splitRevenue', function () {
    beforeEach(async function () {
      // Create a lock in veXF so there are holders
      const amount = parseEther('1000')
      const unlockTime = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
      await xfToken.mint(await getAddress(user1), amount)
      await xfToken.connect(user1).approve(await getAddress(veXF), amount)
      await veXF.connect(user1).createLock(amount, unlockTime)
    })

    it('Should split revenue correctly', async function () {
      const revenueAmount = parseUnits('1000', 6) // 1000 USDC
      await revenueToken.mint(await getAddress(user1), revenueAmount)
      await revenueToken.connect(user1).approve(await getAddress(revenueSplitter), revenueAmount)

      const treasuryBalanceBefore = await revenueToken.balanceOf(await getAddress(treasury))

      await expect(revenueSplitter.connect(user1).splitRevenue(revenueAmount))
        .to.emit(revenueSplitter, 'RevenueCollected')
        .to.emit(revenueSplitter, 'RevenueSplit')

      // Check totals
      expect(await revenueSplitter.totalRevenueCollected()).to.equal(revenueAmount)
      
      // 50% to veXF yield = 500 USDC
      expect(await revenueSplitter.totalYieldDistributed()).to.equal(parseUnits('500', 6))
      
      // 25% to buyback = 250 USDC (tracked but not sent)
      expect(await revenueSplitter.totalBuybackBurned()).to.equal(parseUnits('250', 6))
      
      // 15% to rXF = 150 USDC (tracked but not sent)
      expect(await revenueSplitter.totalRXFMinted()).to.equal(parseUnits('150', 6))
      
      // 10% to treasury = 100 USDC
      expect(await revenueSplitter.totalTreasurySent()).to.equal(parseUnits('100', 6))
      
      const treasuryBalanceAfter = await revenueToken.balanceOf(await getAddress(treasury))
      expect(treasuryBalanceAfter.sub ? treasuryBalanceAfter.sub(treasuryBalanceBefore) : (BigInt(treasuryBalanceAfter.toString()) - BigInt(treasuryBalanceBefore.toString())).toString()).to.equal(parseUnits('100', 6))
    })

    it('Should handle rounding correctly', async function () {
      const revenueAmount = parseUnits('1', 6) // 1 USDC (small amount to test rounding)
      await revenueToken.mint(await getAddress(user1), revenueAmount)
      await revenueToken.connect(user1).approve(await getAddress(revenueSplitter), revenueAmount)

      await revenueSplitter.connect(user1).splitRevenue(revenueAmount)

      // Total should equal original amount (remainder goes to treasury)
      const totalYield = await revenueSplitter.totalYieldDistributed()
      const totalBuyback = await revenueSplitter.totalBuybackBurned()
      const totalRXF = await revenueSplitter.totalRXFMinted()
      const totalTreasury = await revenueSplitter.totalTreasurySent()
      
      const sum = totalYield.add ? 
        totalYield.add(totalBuyback).add(totalRXF).add(totalTreasury) :
        (BigInt(totalYield.toString()) + BigInt(totalBuyback.toString()) + BigInt(totalRXF.toString()) + BigInt(totalTreasury.toString())).toString()
      
      expect(sum.toString()).to.equal(revenueAmount.toString())
    })

    it('Should revert if amount is zero', async function () {
      await expect(
        revenueSplitter.connect(user1).splitRevenue(0)
      ).to.be.revertedWith('RevenueSplitter: amount must be greater than 0')
    })

    it('Should revert if insufficient allowance', async function () {
      const revenueAmount = parseUnits('1000', 6)
      await revenueToken.mint(await getAddress(user1), revenueAmount)
      // Don't approve

      await expect(
        revenueSplitter.connect(user1).splitRevenue(revenueAmount)
      ).to.be.reverted
    })
  })

  describe('splitRevenueNative', function () {
    it('Should split native revenue to treasury', async function () {
      const amount = parseEther('1')
      const treasuryBalanceBefore = await ethers.provider.getBalance(await getAddress(treasury))

      await expect(
        revenueSplitter.connect(user1).splitRevenueNative({ value: amount })
      )
        .to.emit(revenueSplitter, 'RevenueCollected')
        .withArgs(ethers.ZeroAddress, amount, await getAddress(user1))

      const treasuryBalanceAfter = await ethers.provider.getBalance(await getAddress(treasury))
      const diff = treasuryBalanceAfter.sub ? 
        treasuryBalanceAfter.sub(treasuryBalanceBefore) :
        (BigInt(treasuryBalanceAfter.toString()) - BigInt(treasuryBalanceBefore.toString())).toString()
      
      expect(diff.toString()).to.equal(amount.toString())
      expect(await revenueSplitter.totalRevenueCollected()).to.equal(amount)
    })

    it('Should revert if amount is zero', async function () {
      await expect(
        revenueSplitter.connect(user1).splitRevenueNative({ value: 0 })
      ).to.be.revertedWith('RevenueSplitter: amount must be greater than 0')
    })
  })

  describe('calculateSplits', function () {
    it('Should calculate splits correctly', async function () {
      const amount = parseUnits('1000', 6)
      const [veXFYield, buybackBurn, rXFMint, treasuryAmount] = await revenueSplitter.calculateSplits(amount)

      expect(veXFYield.toString()).to.equal(parseUnits('500', 6).toString()) // 50%
      expect(buybackBurn.toString()).to.equal(parseUnits('250', 6).toString()) // 25%
      expect(rXFMint.toString()).to.equal(parseUnits('150', 6).toString()) // 15%
      expect(treasuryAmount.toString()).to.equal(parseUnits('100', 6).toString()) // 10%
    })

    it('Should handle rounding in calculateSplits', async function () {
      const amount = parseUnits('1', 6)
      const [veXFYield, buybackBurn, rXFMint, treasuryAmount] = await revenueSplitter.calculateSplits(amount)

      const sum = veXFYield.add ?
        veXFYield.add(buybackBurn).add(rXFMint).add(treasuryAmount) :
        (BigInt(veXFYield.toString()) + BigInt(buybackBurn.toString()) + BigInt(rXFMint.toString()) + BigInt(treasuryAmount.toString())).toString()
      
      expect(sum.toString()).to.equal(amount.toString())
    })
  })

  describe('Setters', function () {
    it('Should allow owner to set veXF', async function () {
      const newVeXF = await upgrades.deployProxy(
        await ethers.getContractFactory('veXF'),
        [await getAddress(xfToken), await getAddress(owner)],
        { initializer: 'initialize' }
      )
      await newVeXF.waitForDeployment?.() || await newVeXF.deployed?.()

      await expect(revenueSplitter.setVeXF(await getAddress(newVeXF)))
        .to.emit(revenueSplitter, 'VeXFSet')
        .withArgs(await getAddress(newVeXF))

      expect(await revenueSplitter.veXFContract()).to.equal(await getAddress(newVeXF))
    })

    it('Should allow owner to set treasury', async function () {
      await expect(revenueSplitter.setTreasury(await getAddress(user1)))
        .to.emit(revenueSplitter, 'TreasurySet')
        .withArgs(await getAddress(user1))

      expect(await revenueSplitter.treasury()).to.equal(await getAddress(user1))
    })

    it('Should allow owner to set buyback burner', async function () {
      await expect(revenueSplitter.setBuybackBurner(await getAddress(user1)))
        .to.emit(revenueSplitter, 'BuybackBurnerSet')
        .withArgs(await getAddress(user1))

      expect(await revenueSplitter.buybackBurner()).to.equal(await getAddress(user1))
    })

    it('Should allow owner to set rXF', async function () {
      await expect(revenueSplitter.setRXF(await getAddress(user1)))
        .to.emit(revenueSplitter, 'RXFSet')
        .withArgs(await getAddress(user1))

      expect(await revenueSplitter.rXFContract()).to.equal(await getAddress(user1))
    })

    it('Should allow owner to set revenue token', async function () {
      const newToken = await MockERC20.deploy('New Token', 'NEW', 18)
      await newToken.waitForDeployment?.() || await newToken.deployed?.()

      await expect(revenueSplitter.setRevenueToken(await getAddress(newToken)))
        .to.emit(revenueSplitter, 'RevenueTokenSet')
        .withArgs(await getAddress(newToken))

      expect(await revenueSplitter.revenueToken()).to.equal(await getAddress(newToken))
    })

    it('Should revert if non-owner tries to set', async function () {
      await expect(
        revenueSplitter.connect(user1).setVeXF(await getAddress(veXF))
      ).to.be.revertedWith('Ownable: caller is not the owner')

      await expect(
        revenueSplitter.connect(user1).setTreasury(await getAddress(user1))
      ).to.be.revertedWith('Ownable: caller is not the owner')
    })

    it('Should revert if setting zero address for required fields', async function () {
      await expect(
        revenueSplitter.setVeXF(ethers.ZeroAddress)
      ).to.be.revertedWith('RevenueSplitter: invalid veXF')

      await expect(
        revenueSplitter.setTreasury(ethers.ZeroAddress)
      ).to.be.revertedWith('RevenueSplitter: invalid treasury')

      await expect(
        revenueSplitter.setRevenueToken(ethers.ZeroAddress)
      ).to.be.revertedWith('RevenueSplitter: invalid revenue token')
    })
  })

  describe('emergencyWithdraw', function () {
    it('Should allow owner to withdraw tokens', async function () {
      const amount = parseUnits('1000', 6)
      await revenueToken.mint(await getAddress(revenueSplitter), amount)

      await revenueSplitter.emergencyWithdraw(await getAddress(revenueToken), amount)

      expect(await revenueToken.balanceOf(await getAddress(owner))).to.equal(amount)
    })

    it('Should allow owner to withdraw native tokens', async function () {
      const amount = parseEther('1')
      await owner.sendTransaction({
        to: await getAddress(revenueSplitter),
        value: amount
      })

      const ownerBalanceBefore = await ethers.provider.getBalance(await getAddress(owner))
      const tx = await revenueSplitter.emergencyWithdraw(ethers.ZeroAddress, amount)
      const receipt = await tx.wait()
      const gasUsed = receipt.gasUsed.mul ? receipt.gasUsed.mul(receipt.effectiveGasPrice) : (BigInt(receipt.gasUsed.toString()) * BigInt(receipt.effectiveGasPrice.toString())).toString()
      const ownerBalanceAfter = await ethers.provider.getBalance(await getAddress(owner))

      // Account for gas
      const diff = ownerBalanceAfter.sub ?
        ownerBalanceAfter.sub(ownerBalanceBefore).add(gasUsed) :
        (BigInt(ownerBalanceAfter.toString()) + BigInt(gasUsed.toString()) - BigInt(ownerBalanceBefore.toString())).toString()
      
      expect(diff.toString()).to.be.closeTo(amount.toString(), parseEther('0.01').toString())
    })

    it('Should revert if non-owner tries to withdraw', async function () {
      await expect(
        revenueSplitter.connect(user1).emergencyWithdraw(await getAddress(revenueToken), parseUnits('100', 6))
      ).to.be.revertedWith('Ownable: caller is not the owner')
    })
  })

  describe('Upgradeability', function () {
    it('Should allow owner to upgrade', async function () {
      const RevenueSplitter = await ethers.getContractFactory('RevenueSplitter')
      const revenueSplitter2 = await upgrades.upgradeProxy(await getAddress(revenueSplitter), RevenueSplitter)

      expect(await getAddress(revenueSplitter2)).to.equal(await getAddress(revenueSplitter))
    })

    it('Should preserve state after upgrade', async function () {
      // Set some state
      await revenueSplitter.setBuybackBurner(await getAddress(user1))
      
      const buybackBefore = await revenueSplitter.buybackBurner()

      const RevenueSplitter = await ethers.getContractFactory('RevenueSplitter')
      const revenueSplitter2 = await upgrades.upgradeProxy(await getAddress(revenueSplitter), RevenueSplitter)

      expect(await revenueSplitter2.buybackBurner()).to.equal(buybackBefore)
    })
  })
})

