const { expect } = require('chai')
const { ethers, upgrades } = require('hardhat')
const hre = require('hardhat')
const { getAddress, parseEther } = require('./helpers.cjs')

describe('veXF', function () {
  let veXF, xfToken
  let owner, user1, user2, revenueSplitter
  let MockERC20

  beforeEach(async function () {
    // Reset network state
    await hre.network.provider.request({
      method: 'hardhat_reset',
      params: []
    })

    ;[owner, user1, user2, revenueSplitter] = await ethers.getSigners()

    // Deploy mock XF token
    MockERC20 = await ethers.getContractFactory('MockERC20')
    xfToken = await MockERC20.deploy('XFuel Token', 'XF', 18)
    await (xfToken.waitForDeployment?.() || xfToken.deployed?.())

    // Deploy veXF as upgradeable
    const VeXF = await ethers.getContractFactory('veXF')
    veXF = await upgrades.deployProxy(VeXF, [
      await getAddress(xfToken),
      await getAddress(owner)
    ], { initializer: 'initialize' })
    await (veXF.waitForDeployment?.() || veXF.deployed?.())

    // Mint tokens to users
    const mintAmount = parseEther('10000')
    await xfToken.mint(await getAddress(user1), mintAmount)
    await xfToken.mint(await getAddress(user2), mintAmount)
  })

  afterEach(async function () {
    await hre.network.provider.request({
      method: 'hardhat_reset',
      params: []
    })
  })

  describe('Deployment', function () {
    it('Should initialize with correct XF token address', async function () {
      expect(await veXF.xfToken()).to.equal(await getAddress(xfToken))
    })

    it('Should set the correct owner', async function () {
      expect(await veXF.owner()).to.equal(await getAddress(owner))
    })

    it('Should initialize with zero total supply', async function () {
      expect(await veXF.totalSupply()).to.equal(0)
    })

    it('Should revert if initialized with zero address', async function () {
      const VeXF = await ethers.getContractFactory('veXF')
      await expect(
        upgrades.deployProxy(VeXF, [
          ethers.ZeroAddress,
          await getAddress(owner)
        ], { initializer: 'initialize' })
      ).to.be.revertedWith('veXF: invalid XF token')

      await expect(
        upgrades.deployProxy(VeXF, [
          await getAddress(xfToken),
          ethers.ZeroAddress
        ], { initializer: 'initialize' })
      ).to.be.revertedWith('veXF: invalid owner')
    })

    it('Should prevent double initialization', async function () {
      await expect(
        veXF.initialize(await getAddress(xfToken), await getAddress(owner))
      ).to.be.reverted // Custom error in OpenZeppelin v5
    })
  })

  describe('createLock', function () {
    it('Should create a new lock successfully', async function () {
      const amount = parseEther('1000')
      const unlockTime = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60 // 1 year

      await xfToken.connect(user1).approve(await getAddress(veXF), amount)
      
      const tx = await veXF.connect(user1).createLock(amount, unlockTime)
      const receipt = await tx.wait()
      
      // Check event was emitted
      const event = receipt.logs.find(log => {
        try {
          const parsed = veXF.interface.parseLog(log)
          return parsed && parsed.name === 'LockCreated'
        } catch {
          return false
        }
      })
      expect(event).to.not.be.undefined

      const lock = await veXF.locks(await getAddress(user1))
      expect(lock.amount).to.equal(amount)
      expect(lock.unlockTime).to.equal(unlockTime)
      expect(await xfToken.balanceOf(await getAddress(veXF))).to.equal(amount)
    })

    it('Should revert if amount is zero', async function () {
      const unlockTime = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
      await expect(
        veXF.connect(user1).createLock(0, unlockTime)
      ).to.be.revertedWith('veXF: amount must be greater than 0')
    })

    it('Should revert if unlock time is in the past', async function () {
      const amount = parseEther('1000')
      const unlockTime = Math.floor(Date.now() / 1000) - 1000
      await xfToken.connect(user1).approve(await getAddress(veXF), amount)
      
      await expect(
        veXF.connect(user1).createLock(amount, unlockTime)
      ).to.be.revertedWith('veXF: unlock time must be in future')
    })

    it('Should revert if lock duration is too short', async function () {
      const amount = parseEther('1000')
      const unlockTime = Math.floor(Date.now() / 1000) + 6 * 24 * 60 * 60 // 6 days
      await xfToken.connect(user1).approve(await getAddress(veXF), amount)
      
      await expect(
        veXF.connect(user1).createLock(amount, unlockTime)
      ).to.be.revertedWith('veXF: lock duration too short')
    })

    it('Should revert if lock duration is too long', async function () {
      const amount = parseEther('1000')
      const unlockTime = Math.floor(Date.now() / 1000) + 5 * 365 * 24 * 60 * 60 // 5 years
      await xfToken.connect(user1).approve(await getAddress(veXF), amount)
      
      await expect(
        veXF.connect(user1).createLock(amount, unlockTime)
      ).to.be.revertedWith('veXF: lock duration too long')
    })

    it('Should update veXF balance after creating lock', async function () {
      const amount = parseEther('1000')
      const unlockTime = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
      await xfToken.connect(user1).approve(await getAddress(veXF), amount)
      
      await veXF.connect(user1).createLock(amount, unlockTime)
      
      const balance = await veXF.balanceOf(await getAddress(user1))
      expect(balance).to.be.gt(0)
      expect(await veXF.totalSupply()).to.equal(balance)
    })

    it('Should allow extending existing lock', async function () {
      const amount = parseEther('1000')
      const unlockTime1 = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
      const unlockTime2 = Math.floor(Date.now() / 1000) + 2 * 365 * 24 * 60 * 60
      
      const totalAmount = amount * 2n
      await xfToken.connect(user1).approve(await getAddress(veXF), totalAmount)
      await veXF.connect(user1).createLock(amount, unlockTime1)
      
      await veXF.connect(user1).createLock(amount, unlockTime2)
      
      const lock = await veXF.locks(await getAddress(user1))
      expect(lock.amount).to.equal(totalAmount)
      expect(lock.unlockTime).to.equal(unlockTime2)
    })

    it('Should revert if new unlock time is not later', async function () {
      const amount = parseEther('1000')
      const unlockTime1 = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
      const unlockTime2 = Math.floor(Date.now() / 1000) + 180 * 24 * 60 * 60
      
      const totalAmount = amount * 2n
      await xfToken.connect(user1).approve(await getAddress(veXF), totalAmount)
      await veXF.connect(user1).createLock(amount, unlockTime1)
      
      await expect(
        veXF.connect(user1).createLock(amount, unlockTime2)
      ).to.be.revertedWith('veXF: new unlock time must be later')
    })
  })

  describe('increaseAmount', function () {
    beforeEach(async function () {
      const amount = parseEther('1000')
      const unlockTime = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
      await xfToken.connect(user1).approve(await getAddress(veXF), parseEther('10000'))
      await veXF.connect(user1).createLock(amount, unlockTime)
    })

    it('Should increase lock amount successfully', async function () {
      const additionalAmount = parseEther('500')
      
      const tx = await veXF.connect(user1).increaseAmount(additionalAmount)
      const receipt = await tx.wait()
      
      // Check event was emitted
      const event = receipt.logs.find(log => {
        try {
          const parsed = veXF.interface.parseLog(log)
          return parsed && parsed.name === 'LockIncreased'
        } catch {
          return false
        }
      })
      expect(event).to.not.be.undefined

      const lock = await veXF.locks(await getAddress(user1))
      expect(lock.amount).to.equal(parseEther('1500'))
    })

    it('Should revert if amount is zero', async function () {
      await expect(
        veXF.connect(user1).increaseAmount(0)
      ).to.be.revertedWith('veXF: amount must be greater than 0')
    })

    it('Should revert if no existing lock', async function () {
      const amount = parseEther('500')
      await xfToken.connect(user2).approve(await getAddress(veXF), amount)
      
      await expect(
        veXF.connect(user2).increaseAmount(amount)
      ).to.be.revertedWith('veXF: no existing lock')
    })

    it('Should revert if lock expired', async function () {
      // Create a lock that expires soon (minimum is 1 week, so use 8 days to be safe)
      const amount = parseEther('100')
      const unlockTime = Math.floor(Date.now() / 1000) + 8 * 24 * 60 * 60 // 8 days
      await xfToken.connect(user2).approve(await getAddress(veXF), amount)
      await veXF.connect(user2).createLock(amount, unlockTime)
      
      // Fast forward time past unlock
      await hre.network.provider.send('evm_increaseTime', [9 * 24 * 60 * 60])
      await hre.network.provider.send('evm_mine')
      
      await expect(
        veXF.connect(user2).increaseAmount(parseEther('50'))
      ).to.be.revertedWith('veXF: lock expired')
    })
  })

  describe('increaseUnlockTime', function () {
    beforeEach(async function () {
      const amount = parseEther('1000')
      const unlockTime = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
      await xfToken.connect(user1).approve(await getAddress(veXF), amount)
      await veXF.connect(user1).createLock(amount, unlockTime)
    })

    it('Should extend unlock time successfully', async function () {
      const newUnlockTime = Math.floor(Date.now() / 1000) + 2 * 365 * 24 * 60 * 60
      
      const tx = await veXF.connect(user1).increaseUnlockTime(newUnlockTime)
      const receipt = await tx.wait()
      
      // Check event was emitted
      const event = receipt.logs.find(log => {
        try {
          const parsed = veXF.interface.parseLog(log)
          return parsed && parsed.name === 'LockExtended'
        } catch {
          return false
        }
      })
      expect(event).to.not.be.undefined

      const lock = await veXF.locks(await getAddress(user1))
      expect(lock.unlockTime).to.equal(newUnlockTime)
    })

    it('Should revert if no existing lock', async function () {
      const newUnlockTime = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
      
      await expect(
        veXF.connect(user2).increaseUnlockTime(newUnlockTime)
      ).to.be.revertedWith('veXF: no existing lock')
    })

    it('Should revert if new unlock time is not later', async function () {
      const newUnlockTime = Math.floor(Date.now() / 1000) + 180 * 24 * 60 * 60
      
      await expect(
        veXF.connect(user1).increaseUnlockTime(newUnlockTime)
      ).to.be.revertedWith('veXF: new unlock time must be later')
    })

    it('Should revert if lock duration exceeds maximum', async function () {
      const newUnlockTime = Math.floor(Date.now() / 1000) + 5 * 365 * 24 * 60 * 60
      
      await expect(
        veXF.connect(user1).increaseUnlockTime(newUnlockTime)
      ).to.be.revertedWith('veXF: lock duration too long')
    })
  })

  describe('withdraw', function () {
    beforeEach(async function () {
      const amount = parseEther('1000')
      const unlockTime = Math.floor(Date.now() / 1000) + 8 * 24 * 60 * 60 // 8 days (minimum is 1 week)
      await xfToken.connect(user1).approve(await getAddress(veXF), amount)
      await veXF.connect(user1).createLock(amount, unlockTime)
    })

    it('Should withdraw successfully after lock expires', async function () {
      // Fast forward time past unlock
      await hre.network.provider.send('evm_increaseTime', [9 * 24 * 60 * 60])
      await hre.network.provider.send('evm_mine')
      
      const balanceBefore = await xfToken.balanceOf(await getAddress(user1))
      
      const tx = await veXF.connect(user1).withdraw()
      const receipt = await tx.wait()
      
      // Check event was emitted
      const event = receipt.logs.find(log => {
        try {
          const parsed = veXF.interface.parseLog(log)
          return parsed && parsed.name === 'Withdrawn'
        } catch {
          return false
        }
      })
      expect(event).to.not.be.undefined

      const balanceAfter = await xfToken.balanceOf(await getAddress(user1))
      const diff = balanceAfter - balanceBefore
      expect(diff).to.equal(parseEther('1000'))
      
      const lock = await veXF.locks(await getAddress(user1))
      expect(lock.amount).to.equal(0)
      expect(await veXF.balanceOf(await getAddress(user1))).to.equal(0)
    })

    it('Should revert if no lock to withdraw', async function () {
      await expect(
        veXF.connect(user2).withdraw()
      ).to.be.revertedWith('veXF: no lock to withdraw')
    })

    it('Should revert if lock not expired', async function () {
      await expect(
        veXF.connect(user1).withdraw()
      ).to.be.revertedWith('veXF: lock not expired')
    })
  })

  describe('votingPower and balanceOf', function () {
    it('Should calculate voting power with decay', async function () {
      const amount = parseEther('1000')
      const unlockTime = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
      await xfToken.connect(user1).approve(await getAddress(veXF), amount)
      await veXF.connect(user1).createLock(amount, unlockTime)
      
      const balance1 = await veXF.balanceOf(await getAddress(user1))
      const votingPower1 = await veXF.votingPower(await getAddress(user1))
      expect(balance1).to.equal(votingPower1)
      expect(balance1).to.be.gt(amount) // Should have multiplier
      
      // Fast forward 6 months
      await hre.network.provider.send('evm_increaseTime', [180 * 24 * 60 * 60])
      await hre.network.provider.send('evm_mine')
      
      const balance2 = await veXF.balanceOf(await getAddress(user1))
      expect(balance2).to.be.lt(balance1) // Should have decayed
    })

    it('Should return zero voting power for expired lock', async function () {
      const amount = parseEther('1000')
      const unlockTime = Math.floor(Date.now() / 1000) + 8 * 24 * 60 * 60 // 8 days
      await xfToken.connect(user1).approve(await getAddress(veXF), amount)
      await veXF.connect(user1).createLock(amount, unlockTime)
      
      // Fast forward past unlock
      await hre.network.provider.send('evm_increaseTime', [9 * 24 * 60 * 60])
      await hre.network.provider.send('evm_mine')
      
      expect(await veXF.balanceOf(await getAddress(user1))).to.equal(0)
      expect(await veXF.votingPower(await getAddress(user1))).to.equal(0)
    })
  })

  describe('distributeYield', function () {
    beforeEach(async function () {
      const amount = parseEther('1000')
      const unlockTime = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
      await xfToken.connect(user1).approve(await getAddress(veXF), amount)
      await veXF.connect(user1).createLock(amount, unlockTime)
    })

    it('Should distribute yield successfully', async function () {
      const yieldToken = await ethers.getContractFactory('MockERC20')
      const usdc = await yieldToken.deploy('USD Coin', 'USDC', 6)
      await (usdc.waitForDeployment?.() || usdc.deployed?.())
      
      const yieldAmount = parseEther('100')
      await usdc.mint(await getAddress(revenueSplitter), yieldAmount)
      await usdc.connect(revenueSplitter).approve(await getAddress(veXF), yieldAmount)
      
      const tx = await veXF.connect(revenueSplitter).distributeYield(await getAddress(usdc), yieldAmount)
      const receipt = await tx.wait()
      
      // Check event was emitted
      const event = receipt.logs.find(log => {
        try {
          const parsed = veXF.interface.parseLog(log)
          return parsed && parsed.name === 'YieldDistributed'
        } catch {
          return false
        }
      })
      expect(event).to.not.be.undefined

      expect(await veXF.totalYieldDistributed()).to.equal(yieldAmount)
    })

    it('Should revert if yield token is zero address', async function () {
      await expect(
        veXF.connect(revenueSplitter).distributeYield(ethers.ZeroAddress, parseEther('100'))
      ).to.be.revertedWith('veXF: invalid yield token')
    })

    it('Should revert if amount is zero', async function () {
      const yieldToken = await ethers.getContractFactory('MockERC20')
      const usdc = await yieldToken.deploy('USD Coin', 'USDC', 6)
      await (usdc.waitForDeployment?.() || usdc.deployed?.())
      
      await expect(
        veXF.connect(revenueSplitter).distributeYield(await getAddress(usdc), 0)
      ).to.be.revertedWith('veXF: amount must be greater than 0')
    })

    it('Should revert if no veXF holders', async function () {
      // Deploy new veXF with no locks
      const VeXF = await ethers.getContractFactory('veXF')
      const newVeXF = await upgrades.deployProxy(VeXF, [
        await getAddress(xfToken),
        await getAddress(owner)
      ], { initializer: 'initialize' })
      await (newVeXF.waitForDeployment?.() || newVeXF.deployed?.())
      
      const yieldToken = await ethers.getContractFactory('MockERC20')
      const usdc = await yieldToken.deploy('USD Coin', 'USDC', 6)
      await (usdc.waitForDeployment?.() || usdc.deployed?.())
      
      const yieldAmount = parseEther('100')
      await usdc.mint(await getAddress(revenueSplitter), yieldAmount)
      await usdc.connect(revenueSplitter).approve(await getAddress(newVeXF), yieldAmount)
      
      await expect(
        newVeXF.connect(revenueSplitter).distributeYield(await getAddress(usdc), yieldAmount)
      ).to.be.revertedWith('veXF: no veXF holders')
    })
  })

  describe('Upgradeability', function () {
    it('Should allow owner to upgrade', async function () {
      const VeXF = await ethers.getContractFactory('veXF')
      const veXF2 = await upgrades.upgradeProxy(await getAddress(veXF), VeXF)
      
      expect(await getAddress(veXF2)).to.equal(await getAddress(veXF))
    })

    it('Should preserve state after upgrade', async function () {
      const amount = parseEther('1000')
      const unlockTime = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
      await xfToken.connect(user1).approve(await getAddress(veXF), amount)
      await veXF.connect(user1).createLock(amount, unlockTime)
      
      const balanceBefore = await veXF.balanceOf(await getAddress(user1))
      
      const VeXF = await ethers.getContractFactory('veXF')
      const veXF2 = await upgrades.upgradeProxy(await getAddress(veXF), VeXF)
      
      const balanceAfter = await veXF2.balanceOf(await getAddress(user1))
      // Allow small difference due to time passing during upgrade
      const diff = balanceBefore > balanceAfter ? balanceBefore - balanceAfter : balanceAfter - balanceBefore
      expect(diff).to.be.lt(parseEther('0.0001')) // Very small difference acceptable
    })
  })

})

