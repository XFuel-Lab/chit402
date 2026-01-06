const { expect } = require('chai')
const { ethers, upgrades } = require('hardhat')
const { getAddress, parseEther } = require('./helpers.cjs')

describe('Compounding Loop & Security Tests', function () {
  this.timeout(60000) // Increase timeout for upgradeable contracts

  let revenueSplitter, veXF, governance, tokenDistribution
  let xfToken, revenueToken, rXF, buybackBurner
  let owner, treasury, user1, user2, user3

  const INITIAL_SUPPLY = parseEther('100000000') // 100M XF
  const REVENUE_AMOUNT = parseEther('10000') // 10k USDC

  beforeEach(async function () {
    ;[owner, treasury, user1, user2, user3] = await ethers.getSigners()

    // Deploy mock tokens
    const MockERC20 = await ethers.getContractFactory('MockERC20')
    xfToken = await MockERC20.deploy('XFuel', 'XF', 18)
    await (xfToken.waitForDeployment?.() || xfToken.deployed?.())
    // Mint initial supply
    await xfToken.mint(await getAddress(owner), INITIAL_SUPPLY)

    revenueToken = await MockERC20.deploy('USD Coin', 'USDC', 18)
    await (revenueToken.waitForDeployment?.() || revenueToken.deployed?.())
    // Mint revenue tokens
    await revenueToken.mint(await getAddress(owner), parseEther('1000000'))

    // Deploy veXF
    const VeXF = await ethers.getContractFactory('veXF')
    veXF = await upgrades.deployProxy(VeXF, [await getAddress(xfToken), await getAddress(owner)], {
      initializer: 'initialize',
      kind: 'uups',
    })
    await (veXF.waitForDeployment?.() || veXF.deployed?.())

    // Deploy rXF
    const RXF = await ethers.getContractFactory('rXF')
    rXF = await upgrades.deployProxy(RXF, [await getAddress(xfToken), await getAddress(owner)], {
      initializer: 'initialize',
      kind: 'uups',
    })
    await (rXF.waitForDeployment?.() || rXF.deployed?.())

    // Deploy BuybackBurner
    const BuybackBurner = await ethers.getContractFactory('BuybackBurner')
    buybackBurner = await upgrades.deployProxy(
      BuybackBurner,
      [await getAddress(xfToken), await getAddress(revenueToken), await getAddress(owner)],
      {
        initializer: 'initialize',
        kind: 'uups',
      }
    )
    await (buybackBurner.waitForDeployment?.() || buybackBurner.deployed?.())

    // Deploy RevenueSplitter
    const RevenueSplitter = await ethers.getContractFactory('RevenueSplitter')
    revenueSplitter = await upgrades.deployProxy(
      RevenueSplitter,
      [await getAddress(revenueToken), await getAddress(veXF), await getAddress(treasury), await getAddress(owner)],
      {
        initializer: 'initialize',
        kind: 'uups',
      }
    )
    await (revenueSplitter.waitForDeployment?.() || revenueSplitter.deployed?.())

    // Set contracts
    await revenueSplitter.setBuybackBurner(await getAddress(buybackBurner))
    await revenueSplitter.setRXF(await getAddress(rXF))
    await rXF.setMinter(await getAddress(revenueSplitter))

    // Deploy Governance
    const Governance = await ethers.getContractFactory('Governance')
    governance = await upgrades.deployProxy(Governance, [await getAddress(veXF), await getAddress(owner)], {
      initializer: 'initialize',
      kind: 'uups',
    })
    await (governance.waitForDeployment?.() || governance.deployed?.())

    // Deploy TokenDistribution
    const TokenDistribution = await ethers.getContractFactory('TokenDistribution')
    tokenDistribution = await upgrades.deployProxy(
      TokenDistribution,
      [await getAddress(xfToken), await getAddress(owner)],
      {
        initializer: 'initialize',
        kind: 'uups',
      }
    )
    await (tokenDistribution.waitForDeployment?.() || tokenDistribution.deployed?.())

    // Distribute tokens
    await xfToken.transfer(await getAddress(user1), parseEther('10000'))
    await xfToken.transfer(await getAddress(user2), parseEther('10000'))
    await xfToken.transfer(await getAddress(user3), parseEther('10000'))
    await revenueToken.transfer(await getAddress(user1), REVENUE_AMOUNT)
    await revenueToken.transfer(await getAddress(user2), REVENUE_AMOUNT)
  })

  describe('SafeMath Integration Tests (Solidity 0.8+ Built-in)', function () {
    it('Should calculate splits correctly with overflow protection', async function () {
      await revenueToken.connect(user1).approve(await getAddress(revenueSplitter), REVENUE_AMOUNT)
      await revenueSplitter.connect(user1).splitRevenue(REVENUE_AMOUNT)

      const totalCollected = await revenueSplitter.totalRevenueCollected()
      expect(totalCollected).to.equal(REVENUE_AMOUNT)

      const totalYield = await revenueSplitter.totalYieldDistributed()
      expect(totalYield).to.be.gt(0)
    })

    it('Should calculate veXF voting power with overflow protection', async function () {
      const lockAmount = parseEther('1000')
      const unlockTime = (await ethers.provider.getBlock('latest')).timestamp + 365 * 24 * 60 * 60

      await xfToken.connect(user1).approve(await getAddress(veXF), lockAmount)
      await veXF.connect(user1).createLock(lockAmount, unlockTime)

      const votingPower = await veXF.votingPower(await getAddress(user1))
      expect(votingPower).to.be.gt(lockAmount)
    })
  })

  describe('Governance Flash-Loan Protection', function () {
    it('Should prevent same-block voting', async function () {
      const lockAmount = parseEther('150000')
      const unlockTime = (await ethers.provider.getBlock('latest')).timestamp + 365 * 24 * 60 * 60

      await xfToken.connect(user1).approve(await getAddress(veXF), lockAmount)
      await veXF.connect(user1).createLock(lockAmount, unlockTime)

      await governance.connect(user1).propose('Test proposal')

      await expect(governance.connect(user1).castVote(1, true)).to.be.revertedWith(
        'Governance: voting not started'
      )
    })

    it('Should enforce minimum lock period', async function () {
      const lockAmount = parseEther('150000')
      const shortLockTime = (await ethers.provider.getBlock('latest')).timestamp + 3 * 24 * 60 * 60

      await xfToken.connect(user1).approve(await getAddress(veXF), lockAmount)
      await veXF.connect(user1).createLock(lockAmount, shortLockTime)

      await expect(governance.connect(user1).propose('Test')).to.be.revertedWith(
        'Governance: lock period too short for voting'
      )
    })
  })

  describe('Token Distribution Vesting', function () {
    it('Should create team vesting with 1 year cliff', async function () {
      const vestAmount = parseEther('1000000')
      await xfToken.transfer(await getAddress(tokenDistribution), vestAmount)
      await tokenDistribution.createTeamVesting(await getAddress(user1), vestAmount, 0)

      const scheduleCount = await tokenDistribution.getVestingScheduleCount(await getAddress(user1))
      expect(scheduleCount).to.equal(1)

      const schedule = await tokenDistribution.getVestingSchedule(await getAddress(user1), 0)
      expect(schedule.totalAmount).to.equal(vestAmount)
    })

    it('Should not release tokens during cliff', async function () {
      const vestAmount = parseEther('1000000')
      await xfToken.transfer(await getAddress(tokenDistribution), vestAmount)
      await tokenDistribution.createTeamVesting(await getAddress(user1), vestAmount, 0)

      await expect(tokenDistribution.release(await getAddress(user1), 0)).to.be.revertedWith(
        'TokenDistribution: no tokens to release'
      )
    })

    it('Should enforce allocation limits', async function () {
      const excessAmount = parseEther('15000001')
      await xfToken.transfer(await getAddress(tokenDistribution), excessAmount)

      await expect(
        tokenDistribution.createTeamVesting(await getAddress(user1), excessAmount, 0)
      ).to.be.revertedWith('TokenDistribution: team allocation exceeded')
    })
  })

  describe('Compounding Loop', function () {
    it('Should complete full compounding cycle', async function () {
      const lockAmount = parseEther('1000')
      const unlockTime = (await ethers.provider.getBlock('latest')).timestamp + 365 * 24 * 60 * 60

      // User locks XF for veXF
      await xfToken.connect(user1).approve(await getAddress(veXF), lockAmount)
      await veXF.connect(user1).createLock(lockAmount, unlockTime)

      const initialVotingPower = await veXF.votingPower(await getAddress(user1))
      expect(initialVotingPower).to.be.gt(0)

      // Generate revenue
      await revenueToken.connect(user1).approve(await getAddress(revenueSplitter), REVENUE_AMOUNT)
      await revenueSplitter.connect(user1).splitRevenue(REVENUE_AMOUNT)

      // Verify splits
      const totalYield = await revenueSplitter.totalYieldDistributed()
      const totalRXF = await revenueSplitter.totalRXFMinted()

      expect(totalYield).to.be.gt(0)
      expect(totalRXF).to.be.gt(0)

      // Verify rXF received
      const rXFBalance = await rXF.balanceOf(await getAddress(user1))
      expect(rXFBalance).to.equal(totalRXF)

      console.log('✅ Compounding loop verified successfully')
    })

    it('Should handle multiple users', async function () {
      const lockAmount = parseEther('1000')
      const unlockTime = (await ethers.provider.getBlock('latest')).timestamp + 365 * 24 * 60 * 60

      // Both users lock
      await xfToken.connect(user1).approve(await getAddress(veXF), lockAmount)
      await veXF.connect(user1).createLock(lockAmount, unlockTime)

      await xfToken.connect(user2).approve(await getAddress(veXF), lockAmount)
      await veXF.connect(user2).createLock(lockAmount, unlockTime)

      // Both generate revenue
      await revenueToken.connect(user1).approve(await getAddress(revenueSplitter), REVENUE_AMOUNT)
      await revenueSplitter.connect(user1).splitRevenue(REVENUE_AMOUNT)

      await revenueToken.connect(user2).approve(await getAddress(revenueSplitter), REVENUE_AMOUNT)
      await revenueSplitter.connect(user2).splitRevenue(REVENUE_AMOUNT)

      const totalCollected = await revenueSplitter.totalRevenueCollected()
      expect(totalCollected).to.equal(REVENUE_AMOUNT * 2n)

      console.log('✅ Multi-user compounding verified')
    })
  })
})
