const { expect } = require('chai')
const { ethers, upgrades } = require('hardhat')
const hre = require('hardhat')
const { getAddress, parseEther, parseUnits } = require('./helpers.cjs')

describe('Phase 2 Integration', function () {
  let revenueSplitter, veXF, rXF, buybackBurner
  let xfToken, revenueToken
  let owner, user1, user2, treasury
  let MockERC20

  beforeEach(async function () {
    await hre.network.provider.request({
      method: 'hardhat_reset',
      params: []
    })

    ;[owner, user1, user2, treasury] = await ethers.getSigners()

    // Deploy mock tokens
    MockERC20 = await ethers.getContractFactory('MockERC20')
    xfToken = await MockERC20.deploy('XFuel Token', 'XF', 18)
    await (xfToken.waitForDeployment?.() || xfToken.deployed?.())

    revenueToken = await MockERC20.deploy('USD Coin', 'USDC', 6)
    await (revenueToken.waitForDeployment?.() || revenueToken.deployed?.())

    // Deploy Phase 1 contracts
    const VeXF = await ethers.getContractFactory('veXF')
    veXF = await upgrades.deployProxy(VeXF, [
      await getAddress(xfToken),
      await getAddress(owner)
    ], { initializer: 'initialize' })
    await (veXF.waitForDeployment?.() || veXF.deployed?.())

    const RevenueSplitter = await ethers.getContractFactory('RevenueSplitter')
    revenueSplitter = await upgrades.deployProxy(RevenueSplitter, [
      await getAddress(revenueToken),
      await getAddress(veXF),
      await getAddress(treasury),
      await getAddress(owner)
    ], { initializer: 'initialize' })
    await (revenueSplitter.waitForDeployment?.() || revenueSplitter.deployed?.())

    // Deploy Phase 2 contracts
    const RXF = await ethers.getContractFactory('rXF')
    rXF = await upgrades.deployProxy(RXF, [
      await getAddress(xfToken),
      await getAddress(veXF),
      await getAddress(revenueSplitter),
      await getAddress(owner)
    ], { initializer: 'initialize' })
    await (rXF.waitForDeployment?.() || rXF.deployed?.())

    const BuybackBurner = await ethers.getContractFactory('BuybackBurner')
    buybackBurner = await upgrades.deployProxy(BuybackBurner, [
      await getAddress(revenueToken),
      await getAddress(xfToken),
      ethers.ZeroAddress, // No swap router
      await getAddress(owner)
    ], { initializer: 'initialize' })
    await (buybackBurner.waitForDeployment?.() || buybackBurner.deployed?.())

    // Configure Phase 2 in RevenueSplitter
    await revenueSplitter.setRXF(await getAddress(rXF))
    await revenueSplitter.setBuybackBurner(await getAddress(buybackBurner))
    await buybackBurner.setRevenueSplitter(await getAddress(revenueSplitter))

    // Mint XF tokens for redemption
    await xfToken.mint(await getAddress(rXF), parseEther('1000000'))

    // Mint revenue tokens to users
    await revenueToken.mint(await getAddress(user1), parseUnits('1000000', 6))
    await revenueToken.mint(await getAddress(user2), parseUnits('1000000', 6))

    // Create veXF locks so yield can be distributed
    const lockAmount = parseEther('1000')
    const unlockTime = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
    await xfToken.mint(await getAddress(user1), lockAmount)
    await xfToken.mint(await getAddress(user2), lockAmount)
    await xfToken.connect(user1).approve(await getAddress(veXF), lockAmount)
    await xfToken.connect(user2).approve(await getAddress(veXF), lockAmount)
    await veXF.connect(user1).createLock(lockAmount, unlockTime)
    await veXF.connect(user2).createLock(lockAmount, unlockTime)
  })

  afterEach(async function () {
    await hre.network.provider.request({
      method: 'hardhat_reset',
      params: []
    })
  })

  describe('Revenue Split with Phase 2', function () {
    it('Should split revenue correctly with Phase 2 contracts', async function () {
      const revenueAmount = parseUnits('10000', 6) // 10,000 USDC

      // Approve and split revenue
      await revenueToken.connect(user1).approve(
        await getAddress(revenueSplitter),
        revenueAmount
      )
      await revenueSplitter.connect(user1).splitRevenue(revenueAmount)

      // Check splits (50% veXF, 25% buyback, 15% rXF, 10% treasury)
      const veXFYield = (revenueAmount * 5000n) / 10000n
      const buybackAmount = (revenueAmount * 2500n) / 10000n
      const rXFMintAmount = (revenueAmount * 1500n) / 10000n
      const treasuryAmount = (revenueAmount * 1000n) / 10000n

      // Check rXF was minted to user1
      expect(await rXF.balanceOf(await getAddress(user1))).to.equal(rXFMintAmount)

      // Check BuybackBurner received revenue
      expect(await revenueToken.balanceOf(await getAddress(buybackBurner))).to.equal(buybackAmount)

      // Check treasury received
      expect(await revenueToken.balanceOf(await getAddress(treasury))).to.equal(treasuryAmount)

      // Check tracking
      expect(await revenueSplitter.totalRXFMinted()).to.equal(rXFMintAmount)
      expect(await revenueSplitter.totalBuybackBurned()).to.equal(buybackAmount)
    })

    it('Should mint rXF with correct receipt data', async function () {
      const revenueAmount = parseUnits('10000', 6)
      const rXFMintAmount = (revenueAmount * 1500n) / 10000n

      await revenueToken.connect(user1).approve(
        await getAddress(revenueSplitter),
        revenueAmount
      )
      await revenueSplitter.connect(user1).splitRevenue(revenueAmount)

      const receipt = await rXF.getReceipt(await getAddress(user1))
      expect(receipt.amount).to.equal(rXFMintAmount)
      expect(receipt.redemptionPeriod).to.equal(365 * 24 * 60 * 60) // Default 365 days
      expect(receipt.hasPriorityFlag).to.equal(false)
    })

    it('Should accumulate rXF when multiple revenue splits occur', async function () {
      const revenueAmount1 = parseUnits('10000', 6)
      const revenueAmount2 = parseUnits('5000', 6)

      await revenueToken.connect(user1).approve(
        await getAddress(revenueSplitter),
        revenueAmount1 + revenueAmount2
      )

      await revenueSplitter.connect(user1).splitRevenue(revenueAmount1)
      await revenueSplitter.connect(user1).splitRevenue(revenueAmount2)

      const totalRXFMint = ((revenueAmount1 + revenueAmount2) * 1500n) / 10000n
      expect(await rXF.balanceOf(await getAddress(user1))).to.equal(totalRXFMint)
    })

    it('Should handle revenue split for multiple users', async function () {
      const revenueAmount1 = parseUnits('10000', 6)
      const revenueAmount2 = parseUnits('8000', 6)

      await revenueToken.connect(user1).approve(
        await getAddress(revenueSplitter),
        revenueAmount1
      )
      await revenueToken.connect(user2).approve(
        await getAddress(revenueSplitter),
        revenueAmount2
      )

      await revenueSplitter.connect(user1).splitRevenue(revenueAmount1)
      await revenueSplitter.connect(user2).splitRevenue(revenueAmount2)

      const rXF1 = (revenueAmount1 * 1500n) / 10000n
      const rXF2 = (revenueAmount2 * 1500n) / 10000n

      expect(await rXF.balanceOf(await getAddress(user1))).to.equal(rXF1)
      expect(await rXF.balanceOf(await getAddress(user2))).to.equal(rXF2)
    })
  })

  describe('Voting Boost Integration', function () {
    beforeEach(async function () {
      // user1 already has a lock from main beforeEach, just mint rXF via revenue split
      const revenueAmount = parseUnits('10000', 6)
      await revenueToken.connect(user1).approve(
        await getAddress(revenueSplitter),
        revenueAmount
      )
      await revenueSplitter.connect(user1).splitRevenue(revenueAmount)
    })

    it('Should calculate boosted voting power correctly', async function () {
      const veXFPower = await veXF.votingPower(await getAddress(user1))
      const rXFBalance = await rXF.balanceOf(await getAddress(user1))
      const boostedPower = await rXF.getBoostedVotingPower(await getAddress(user1))

      expect(boostedPower).to.equal(veXFPower + (rXFBalance * 4n))
      expect(boostedPower).to.be.gt(veXFPower) // Should be greater than veXF alone
    })

    it('Should provide 4× voting boost from rXF', async function () {
      const rXFBalance = await rXF.balanceOf(await getAddress(user1))
      const votingBoost = await rXF.getVotingBoost(await getAddress(user1))

      expect(votingBoost).to.equal(rXFBalance * 4n)
    })
  })

  describe('BuybackBurner Integration', function () {
    it('Should receive 25% of revenue', async function () {
      const revenueAmount = parseUnits('10000', 6)
      const buybackAmount = (revenueAmount * 2500n) / 10000n

      await revenueToken.connect(user1).approve(
        await getAddress(revenueSplitter),
        revenueAmount
      )
      await revenueSplitter.connect(user1).splitRevenue(revenueAmount)

      expect(await revenueToken.balanceOf(await getAddress(buybackBurner))).to.equal(buybackAmount)
      expect(await buybackBurner.totalRevenueReceived()).to.equal(buybackAmount)
    })

    it('Should allow manual buyback recording', async function () {
      const revenueAmount = parseUnits('10000', 6)
      const buybackAmount = (revenueAmount * 2500n) / 10000n

      await revenueToken.connect(user1).approve(
        await getAddress(revenueSplitter),
        revenueAmount
      )
      await revenueSplitter.connect(user1).splitRevenue(revenueAmount)

      // Owner records buyback (simulating swap)
      const xfBought = parseEther('1000')
      await buybackBurner.connect(owner).recordBuyback(xfBought)

      expect(await buybackBurner.totalXFBurned()).to.equal(xfBought)
    })
  })

  describe('End-to-End Flow', function () {
    it('Should complete full revenue flow: split → mint rXF → redeem', async function () {
      // 1. User splits revenue
      const revenueAmount = parseUnits('10000', 6)
      await revenueToken.connect(user1).approve(
        await getAddress(revenueSplitter),
        revenueAmount
      )
      await revenueSplitter.connect(user1).splitRevenue(revenueAmount)

      const rXFAmount = (revenueAmount * 1500n) / 10000n
      expect(await rXF.balanceOf(await getAddress(user1))).to.equal(rXFAmount)

      // 2. Fast forward 365 days + 1 day
      await hre.network.provider.send('evm_increaseTime', [366 * 24 * 60 * 60])
      await hre.network.provider.send('evm_mine')

      // 3. User redeems rXF for XF
      const xfBalanceBefore = await xfToken.balanceOf(await getAddress(user1))
      await rXF.connect(user1).redeem(rXFAmount)
      const xfBalanceAfter = await xfToken.balanceOf(await getAddress(user1))

      expect(xfBalanceAfter - xfBalanceBefore).to.equal(rXFAmount)
      expect(await rXF.balanceOf(await getAddress(user1))).to.equal(0)
    })
  })

  describe('Phase 2 Configuration', function () {
    it('Should allow updating Phase 2 contracts in RevenueSplitter', async function () {
      // Deploy new rXF contract
      const RXF = await ethers.getContractFactory('rXF')
      const newRXF = await upgrades.deployProxy(RXF, [
        await getAddress(xfToken),
        await getAddress(veXF),
        await getAddress(revenueSplitter),
        await getAddress(owner)
      ], { initializer: 'initialize' })
      await (newRXF.waitForDeployment?.() || newRXF.deployed?.())

      await revenueSplitter.setRXF(await getAddress(newRXF))
      expect(await revenueSplitter.rXFContract()).to.equal(await getAddress(newRXF))
    })

    it('Should allow updating BuybackBurner in RevenueSplitter', async function () {
      const BuybackBurner = await ethers.getContractFactory('BuybackBurner')
      const newBuybackBurner = await upgrades.deployProxy(BuybackBurner, [
        await getAddress(revenueToken),
        await getAddress(xfToken),
        ethers.ZeroAddress,
        await getAddress(owner)
      ], { initializer: 'initialize' })
      await (newBuybackBurner.waitForDeployment?.() || newBuybackBurner.deployed?.())

      await revenueSplitter.setBuybackBurner(await getAddress(newBuybackBurner))
      expect(await revenueSplitter.buybackBurner()).to.equal(await getAddress(newBuybackBurner))
    })
  })
})

