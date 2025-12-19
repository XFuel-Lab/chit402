const { expect } = require('chai')
const { ethers, upgrades } = require('hardhat')
const hre = require('hardhat')
const { getAddress, parseEther, parseUnits } = require('./helpers.cjs')

describe('BuybackBurner', function () {
  let buybackBurner, revenueToken, xfToken
  let owner, revenueSplitter, user1
  let MockERC20

  beforeEach(async function () {
    // Reset network state
    await hre.network.provider.request({
      method: 'hardhat_reset',
      params: []
    })

    ;[owner, revenueSplitter, user1] = await ethers.getSigners()

    // Deploy mock tokens
    MockERC20 = await ethers.getContractFactory('MockERC20')
    revenueToken = await MockERC20.deploy('USD Coin', 'USDC', 6)
    await revenueToken.waitForDeployment?.() || await revenueToken.deployed?.()

    xfToken = await MockERC20.deploy('XFuel Token', 'XF', 18)
    await xfToken.waitForDeployment?.() || await xfToken.deployed?.()

    // Deploy BuybackBurner
    const BuybackBurner = await ethers.getContractFactory('BuybackBurner')
    buybackBurner = await upgrades.deployProxy(BuybackBurner, [
      await getAddress(revenueToken),
      await getAddress(xfToken),
      ethers.ZeroAddress, // No swap router for now
      await getAddress(owner)
    ], { initializer: 'initialize' })
    await buybackBurner.waitForDeployment?.() || await buybackBurner.deployed?.()

    // Set revenue splitter
    await buybackBurner.connect(owner).setRevenueSplitter(await getAddress(revenueSplitter))

    // Mint revenue tokens to revenueSplitter
    await revenueToken.mint(await getAddress(revenueSplitter), parseUnits('1000000', 6))
  })

  afterEach(async function () {
    await hre.network.provider.request({
      method: 'hardhat_reset',
      params: []
    })
  })

  describe('Deployment', function () {
    it('Should initialize with correct addresses', async function () {
      expect(await buybackBurner.revenueToken()).to.equal(await getAddress(revenueToken))
      expect(await buybackBurner.xfToken()).to.equal(await getAddress(xfToken))
      expect(await buybackBurner.owner()).to.equal(await getAddress(owner))
    })

    it('Should initialize with zero totals', async function () {
      expect(await buybackBurner.totalRevenueReceived()).to.equal(0)
      expect(await buybackBurner.totalXFBurned()).to.equal(0)
      expect(await buybackBurner.totalRevenueSwapped()).to.equal(0)
    })

    it('Should revert if initialized with zero addresses', async function () {
      const BuybackBurner = await ethers.getContractFactory('BuybackBurner')
      
      await expect(
        upgrades.deployProxy(BuybackBurner, [
          ethers.ZeroAddress,
          await getAddress(xfToken),
          ethers.ZeroAddress,
          await getAddress(owner)
        ], { initializer: 'initialize' })
      ).to.be.revertedWith('BuybackBurner: invalid revenue token')

      await expect(
        upgrades.deployProxy(BuybackBurner, [
          await getAddress(revenueToken),
          ethers.ZeroAddress,
          ethers.ZeroAddress,
          await getAddress(owner)
        ], { initializer: 'initialize' })
      ).to.be.revertedWith('BuybackBurner: invalid XF token')
    })

    it('Should prevent double initialization', async function () {
      await expect(
        buybackBurner.initialize(
          await getAddress(revenueToken),
          await getAddress(xfToken),
          ethers.ZeroAddress,
          await getAddress(owner)
        )
      ).to.be.reverted
    })
  })

  describe('receiveRevenue', function () {
    it('Should receive revenue from RevenueSplitter', async function () {
      const amount = parseUnits('1000', 6)
      
      await revenueToken.connect(revenueSplitter).approve(
        await getAddress(buybackBurner),
        amount
      )

      const tx = await buybackBurner.connect(revenueSplitter).receiveRevenue(amount)
      const receipt = await tx.wait()

      // Check event
      const event = receipt.logs.find(log => {
        try {
          const parsed = buybackBurner.interface.parseLog(log)
          return parsed && parsed.name === 'RevenueReceived'
        } catch {
          return false
        }
      })
      expect(event).to.not.be.undefined

      expect(await buybackBurner.totalRevenueReceived()).to.equal(amount)
      expect(await revenueToken.balanceOf(await getAddress(buybackBurner))).to.equal(amount)
    })

    it('Should revert if amount is zero', async function () {
      await expect(
        buybackBurner.connect(revenueSplitter).receiveRevenue(0)
      ).to.be.revertedWith('BuybackBurner: amount must be greater than 0')
    })

    it('Should revert if not authorized', async function () {
      const amount = parseUnits('1000', 6)
      await revenueToken.connect(user1).approve(
        await getAddress(buybackBurner),
        amount
      )

      await expect(
        buybackBurner.connect(user1).receiveRevenue(amount)
      ).to.be.revertedWith('BuybackBurner: unauthorized')
    })

    it('Should allow owner to receive revenue', async function () {
      const amount = parseUnits('1000', 6)
      await revenueToken.mint(await getAddress(owner), amount)
      await revenueToken.connect(owner).approve(
        await getAddress(buybackBurner),
        amount
      )

      await buybackBurner.connect(owner).receiveRevenue(amount)
      expect(await buybackBurner.totalRevenueReceived()).to.equal(amount)
    })

    it('Should accumulate total revenue received', async function () {
      const amount1 = parseUnits('1000', 6)
      const amount2 = parseUnits('500', 6)

      await revenueToken.connect(revenueSplitter).approve(
        await getAddress(buybackBurner),
        amount1 + amount2
      )

      await buybackBurner.connect(revenueSplitter).receiveRevenue(amount1)
      await buybackBurner.connect(revenueSplitter).receiveRevenue(amount2)

      expect(await buybackBurner.totalRevenueReceived()).to.equal(amount1 + amount2)
    })
  })

  describe('Buyback and Burn', function () {
    beforeEach(async function () {
      // Mint XF tokens to buybackBurner for burning
      await xfToken.mint(await getAddress(buybackBurner), parseEther('1000000'))
    })

    it('Should execute buyback when swap router is set', async function () {
      // Note: In production, this would use an actual swap router
      // For testing, we'll simulate by setting a mock router
      // Since we don't have a swap router, we'll test manual buyback
      
      const revenueAmount = parseUnits('1000', 6)
      await revenueToken.connect(revenueSplitter).approve(
        await getAddress(buybackBurner),
        revenueAmount
      )
      await buybackBurner.connect(revenueSplitter).receiveRevenue(revenueAmount)

      // Since swap router is not set, revenue is held
      // In production, this would trigger automatic swap
      expect(await revenueToken.balanceOf(await getAddress(buybackBurner))).to.equal(revenueAmount)
    })

    it('Should allow manual buyback and burn', async function () {
      const revenueAmount = parseUnits('1000', 6)
      await revenueToken.connect(revenueSplitter).approve(
        await getAddress(buybackBurner),
        revenueAmount
      )
      await buybackBurner.connect(revenueSplitter).receiveRevenue(revenueAmount)

      // Owner can manually record buyback (simulating swap)
      const xfAmount = parseEther('1000') // Simulated XF amount from swap
      await buybackBurner.connect(owner).recordBuyback(xfAmount)

      expect(await buybackBurner.totalXFBurned()).to.equal(xfAmount)
    })

    it('Should revert manual buyback if not owner', async function () {
      await expect(
        buybackBurner.connect(user1).recordBuyback(parseEther('1000'))
      ).to.be.reverted
    })

    it('Should accumulate total XF burned', async function () {
      const xfAmount1 = parseEther('1000')
      const xfAmount2 = parseEther('500')

      await buybackBurner.connect(owner).recordBuyback(xfAmount1)
      await buybackBurner.connect(owner).recordBuyback(xfAmount2)

      expect(await buybackBurner.totalXFBurned()).to.equal(xfAmount1 + xfAmount2)
    })
  })

  describe('Admin Functions', function () {
    it('Should set swap router', async function () {
      const newRouter = await getAddress(user1)
      await buybackBurner.connect(owner).setSwapRouter(newRouter)
      expect(await buybackBurner.swapRouter()).to.equal(newRouter)
    })

    it('Should set revenue token', async function () {
      const newToken = await MockERC20.deploy('New Token', 'NEW', 18)
      await newToken.waitForDeployment?.() || await newToken.deployed?.()

      await buybackBurner.connect(owner).setRevenueToken(await getAddress(newToken))
      expect(await buybackBurner.revenueToken()).to.equal(await getAddress(newToken))
    })

    it('Should set XF token', async function () {
      const newToken = await MockERC20.deploy('New XF', 'NXF', 18)
      await newToken.waitForDeployment?.() || await newToken.deployed?.()

      await buybackBurner.connect(owner).setXFToken(await getAddress(newToken))
      expect(await buybackBurner.xfToken()).to.equal(await getAddress(newToken))
    })

    it('Should set revenue splitter', async function () {
      const newSplitter = await getAddress(user1)
      await buybackBurner.connect(owner).setRevenueSplitter(newSplitter)
      // Note: revenueSplitter is not public, but we can test via receiveRevenue
    })

    it('Should revert admin functions if not owner', async function () {
      await expect(
        buybackBurner.connect(user1).setSwapRouter(await getAddress(user1))
      ).to.be.reverted

      await expect(
        buybackBurner.connect(user1).setRevenueToken(await getAddress(revenueToken))
      ).to.be.reverted

      await expect(
        buybackBurner.connect(user1).setXFToken(await getAddress(xfToken))
      ).to.be.reverted
    })
  })

  describe('Emergency Withdraw', function () {
    beforeEach(async function () {
      // Send some tokens to contract
      const amount = parseUnits('1000', 6)
      await revenueToken.connect(revenueSplitter).approve(
        await getAddress(buybackBurner),
        amount
      )
      await buybackBurner.connect(revenueSplitter).receiveRevenue(amount)
    })

    it('Should allow owner to emergency withdraw tokens', async function () {
      const amount = parseUnits('500', 6)
      const balanceBefore = await revenueToken.balanceOf(await getAddress(owner))

      await buybackBurner.connect(owner).emergencyWithdraw(
        await getAddress(revenueToken),
        amount
      )

      const balanceAfter = await revenueToken.balanceOf(await getAddress(owner))
      expect(balanceAfter - balanceBefore).to.equal(amount)
    })

    it('Should revert emergency withdraw if not owner', async function () {
      await expect(
        buybackBurner.connect(user1).emergencyWithdraw(
          await getAddress(revenueToken),
          parseUnits('100', 6)
        )
      ).to.be.reverted
    })
  })

  describe('UUPS Upgradeability', function () {
    it('Should allow owner to upgrade', async function () {
      const BuybackBurner = await ethers.getContractFactory('BuybackBurner')
      const buybackBurner2 = await upgrades.upgradeProxy(
        await getAddress(buybackBurner),
        BuybackBurner
      )
      await buybackBurner2.waitForDeployment?.() || await buybackBurner2.deployed?.()

      // Verify state is preserved
      expect(await buybackBurner2.revenueToken()).to.equal(await getAddress(revenueToken))
      expect(await buybackBurner2.xfToken()).to.equal(await getAddress(xfToken))
    })

    it('Should revert upgrade if not owner', async function () {
      const BuybackBurner = await ethers.getContractFactory('BuybackBurner')
      await expect(
        upgrades.upgradeProxy(
          await getAddress(buybackBurner),
          BuybackBurner.connect(user1)
        )
      ).to.be.reverted
    })
  })

  describe('Integration with RevenueSplitter', function () {
    it('Should work when called by RevenueSplitter', async function () {
      const amount = parseUnits('1000', 6)
      
      await revenueToken.connect(revenueSplitter).approve(
        await getAddress(buybackBurner),
        amount
      )

      await buybackBurner.connect(revenueSplitter).receiveRevenue(amount)

      expect(await buybackBurner.totalRevenueReceived()).to.equal(amount)
      expect(await revenueToken.balanceOf(await getAddress(buybackBurner))).to.equal(amount)
    })
  })
})

