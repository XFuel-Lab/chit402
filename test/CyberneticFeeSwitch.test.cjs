const { expect } = require('chai')
const { ethers, upgrades } = require('hardhat')
const hre = require('hardhat')
const { getAddress, parseEther } = require('./helpers.cjs')

describe('CyberneticFeeSwitch', function () {
  let feeSwitch, veXF, xfToken
  let owner, user1, user2, governanceUser
  let MockERC20

  beforeEach(async function () {
    await hre.network.provider.request({
      method: 'hardhat_reset',
      params: []
    })

    ;[owner, user1, user2, governanceUser] = await ethers.getSigners()

    // Deploy mock XF token
    MockERC20 = await ethers.getContractFactory('MockERC20')
    xfToken = await MockERC20.deploy('XFuel Token', 'XF', 18)
    await xfToken.waitForDeployment?.() || await xfToken.deployed?.()

    // Deploy veXF
    const VeXF = await ethers.getContractFactory('veXF')
    veXF = await upgrades.deployProxy(VeXF, [
      await getAddress(xfToken),
      await getAddress(owner)
    ], { initializer: 'initialize' })
    await veXF.waitForDeployment?.() || await veXF.deployed?.()

    // Deploy CyberneticFeeSwitch
    const CyberneticFeeSwitch = await ethers.getContractFactory('CyberneticFeeSwitch')
    feeSwitch = await upgrades.deployProxy(CyberneticFeeSwitch, [
      await getAddress(veXF),
      await getAddress(owner)
    ], { initializer: 'initialize' })
    await feeSwitch.waitForDeployment?.() || await feeSwitch.deployed?.()
  })

  afterEach(async function () {
    await hre.network.provider.request({
      method: 'hardhat_reset',
      params: []
    })
  })

  describe('Deployment', function () {
    it('Should initialize with correct addresses', async function () {
      expect(await feeSwitch.veXFContract()).to.equal(await getAddress(veXF))
      expect(await feeSwitch.owner()).to.equal(await getAddress(owner))
    })

    it('Should initialize with Growth mode', async function () {
      expect(await feeSwitch.currentMode()).to.equal(0) // Growth = 0
      expect(await feeSwitch.currentFeeBps()).to.equal(await feeSwitch.GROWTH_MODE_FEE_BPS())
      expect(await feeSwitch.feesEnabled()).to.equal(true)
    })

    it('Should initialize with default minVeXF', async function () {
      expect(await feeSwitch.minVeXFForFeeChange()).to.equal(parseEther('1000'))
    })

    it('Should revert if initialized with zero address', async function () {
      const CyberneticFeeSwitch = await ethers.getContractFactory('CyberneticFeeSwitch')
      
      await expect(
        upgrades.deployProxy(CyberneticFeeSwitch, [
          ethers.ZeroAddress,
          await getAddress(owner)
        ], { initializer: 'initialize' })
      ).to.be.revertedWith('CyberneticFeeSwitch: invalid veXF')

      await expect(
        upgrades.deployProxy(CyberneticFeeSwitch, [
          await getAddress(veXF),
          ethers.ZeroAddress
        ], { initializer: 'initialize' })
      ).to.be.revertedWith('CyberneticFeeSwitch: invalid owner')
    })
  })

  describe('setFeesEnabled', function () {
    it('Should allow owner to enable/disable fees', async function () {
      let tx = await feeSwitch.setFeesEnabled(false)
      let receipt = await tx.wait()
      
      // Check event was emitted
      let event = receipt.logs.find(log => {
        try {
          const parsed = feeSwitch.interface.parseLog(log)
          return parsed && parsed.name === 'FeesEnabled'
        } catch {
          return false
        }
      })
      expect(event).to.not.be.undefined

      expect(await feeSwitch.feesEnabled()).to.equal(false)

      tx = await feeSwitch.setFeesEnabled(true)
      receipt = await tx.wait()
      
      event = receipt.logs.find(log => {
        try {
          const parsed = feeSwitch.interface.parseLog(log)
          return parsed && parsed.name === 'FeesEnabled'
        } catch {
          return false
        }
      })
      expect(event).to.not.be.undefined

      expect(await feeSwitch.feesEnabled()).to.equal(true)
    })

    it('Should allow governance user with min veXF to enable/disable fees', async function () {
      // Create lock for governance user with enough veXF (use 3.9 years to avoid max duration edge case)
      const amount = parseEther('2000')
      const unlockTime = Math.floor(Date.now() / 1000) + Math.floor(3.9 * 365 * 24 * 60 * 60)
      await xfToken.mint(await getAddress(governanceUser), amount)
      await xfToken.connect(governanceUser).approve(await getAddress(veXF), amount)
      await veXF.connect(governanceUser).createLock(amount, unlockTime)
      
      // Wait a bit for the lock to be processed
      await hre.network.provider.send('evm_mine')

      const tx = await feeSwitch.connect(governanceUser).setFeesEnabled(false)
      const receipt = await tx.wait()
      
      // Check event was emitted
      const event = receipt.logs.find(log => {
        try {
          const parsed = feeSwitch.interface.parseLog(log)
          return parsed && parsed.name === 'FeesEnabled'
        } catch {
          return false
        }
      })
      expect(event).to.not.be.undefined

      expect(await feeSwitch.feesEnabled()).to.equal(false)
    })

    it('Should revert if user without min veXF tries to enable/disable', async function () {
      // Create lock with insufficient veXF
      const amount = parseEther('100')
      const unlockTime = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
      await xfToken.mint(await getAddress(user1), amount)
      await xfToken.connect(user1).approve(await getAddress(veXF), amount)
      await veXF.connect(user1).createLock(amount, unlockTime)

      await expect(
        feeSwitch.connect(user1).setFeesEnabled(false)
      ).to.be.revertedWith('CyberneticFeeSwitch: unauthorized')
    })
  })

  describe('setFeeMode', function () {
    it('Should allow owner to change fee mode', async function () {
      const tx = await feeSwitch.setFeeMode(1) // Extraction mode
      const receipt = await tx.wait()
      
      // Check events were emitted
      const feeModeChangedEvent = receipt.logs.find(log => {
        try {
          const parsed = feeSwitch.interface.parseLog(log)
          return parsed && parsed.name === 'FeeModeChanged'
        } catch {
          return false
        }
      })
      const feeChangedEvent = receipt.logs.find(log => {
        try {
          const parsed = feeSwitch.interface.parseLog(log)
          return parsed && parsed.name === 'FeeChanged'
        } catch {
          return false
        }
      })
      expect(feeModeChangedEvent).to.not.be.undefined
      expect(feeChangedEvent).to.not.be.undefined

      expect(await feeSwitch.currentMode()).to.equal(1) // Extraction = 1
      expect(await feeSwitch.currentFeeBps()).to.equal(await feeSwitch.EXTRACTION_MODE_FEE_BPS())
    })

    it('Should set correct fee for Growth mode', async function () {
      await feeSwitch.setFeeMode(0) // Growth
      expect(await feeSwitch.currentFeeBps()).to.equal(await feeSwitch.GROWTH_MODE_FEE_BPS())
    })

    it('Should set correct fee for Extraction mode', async function () {
      await feeSwitch.setFeeMode(1) // Extraction
      expect(await feeSwitch.currentFeeBps()).to.equal(await feeSwitch.EXTRACTION_MODE_FEE_BPS())
    })

    it('Should enforce cooldown period', async function () {
      await feeSwitch.setFeeMode(1)
      
      // Try to change immediately
      await expect(
        feeSwitch.setFeeMode(0)
      ).to.be.revertedWith('CyberneticFeeSwitch: cooldown active')

      // Fast forward past cooldown
      await hre.network.provider.send('evm_increaseTime', [7 * 24 * 60 * 60 + 1])
      await hre.network.provider.send('evm_mine')

      await feeSwitch.setFeeMode(0)
      expect(await feeSwitch.currentMode()).to.equal(0)
    })

    it('Should allow governance user with min veXF to change fee mode', async function () {
      // Create lock for governance user (use 3.9 years to avoid max duration edge case)
      const amount = parseEther('2000')
      const unlockTime = Math.floor(Date.now() / 1000) + Math.floor(3.9 * 365 * 24 * 60 * 60)
      await xfToken.mint(await getAddress(governanceUser), amount)
      await xfToken.connect(governanceUser).approve(await getAddress(veXF), amount)
      await veXF.connect(governanceUser).createLock(amount, unlockTime)
      
      // Wait a bit for the lock to be processed
      await hre.network.provider.send('evm_mine')

      await feeSwitch.connect(governanceUser).setFeeMode(1)
      expect(await feeSwitch.currentMode()).to.equal(1)
    })

    it('Should revert if user without min veXF tries to change mode', async function () {
      await expect(
        feeSwitch.connect(user1).setFeeMode(1)
      ).to.be.revertedWith('CyberneticFeeSwitch: unauthorized')
    })
  })

  describe('setCustomFee', function () {
    it('Should allow owner to set custom fee', async function () {
      const customFee = 50 // 0.5%
      
      const tx = await feeSwitch.setCustomFee(customFee)
      const receipt = await tx.wait()
      
      // Check event was emitted
      const event = receipt.logs.find(log => {
        try {
          const parsed = feeSwitch.interface.parseLog(log)
          return parsed && parsed.name === 'FeeChanged'
        } catch {
          return false
        }
      })
      expect(event).to.not.be.undefined

      expect(await feeSwitch.currentFeeBps()).to.equal(customFee)
    })

    it('Should revert if fee exceeds maximum', async function () {
      const maxFee = await feeSwitch.MAX_FEE_BPS()
      
      await expect(
        feeSwitch.setCustomFee(maxFee + 1n)
      ).to.be.revertedWith('CyberneticFeeSwitch: fee too high')
    })

    it('Should revert if fee is zero', async function () {
      await expect(
        feeSwitch.setCustomFee(0)
      ).to.be.revertedWith('CyberneticFeeSwitch: fee must be greater than 0')
    })

    it('Should revert if non-owner tries to set custom fee', async function () {
      await expect(
        feeSwitch.connect(user1).setCustomFee(50)
      ).to.be.reverted // Custom error in OpenZeppelin v5
    })
  })

  describe('IFeeAdapter interface', function () {
    it('Should return correct fee multiplier', async function () {
      expect(await feeSwitch.getFeeMultiplier()).to.equal(await feeSwitch.GROWTH_MODE_FEE_BPS())
      
      await feeSwitch.setFeeMode(1)
      expect(await feeSwitch.getFeeMultiplier()).to.equal(await feeSwitch.EXTRACTION_MODE_FEE_BPS())
      
      await feeSwitch.setFeesEnabled(false)
      expect(await feeSwitch.getFeeMultiplier()).to.equal(0)
    })

    it('Should return correct fees enabled status', async function () {
      expect(await feeSwitch.isFeesEnabled()).to.equal(true)
      
      await feeSwitch.setFeesEnabled(false)
      expect(await feeSwitch.isFeesEnabled()).to.equal(false)
    })

    it('Should calculate effective fee correctly', async function () {
      const baseFee = 1000 // 10%
      const expectedFee = (baseFee * 10) / 10000 // 0.1% of 10% = 0.01%
      
      const effectiveFee = await feeSwitch.getEffectiveFee(baseFee)
      expect(effectiveFee.toString()).to.equal(expectedFee.toString())
      
      await feeSwitch.setFeesEnabled(false)
      expect(await feeSwitch.getEffectiveFee(baseFee)).to.equal(0)
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

      const tx = await feeSwitch.setVeXF(await getAddress(newVeXF))
      const receipt = await tx.wait()
      
      // Check event was emitted
      const event = receipt.logs.find(log => {
        try {
          const parsed = feeSwitch.interface.parseLog(log)
          return parsed && parsed.name === 'VeXFSet'
        } catch {
          return false
        }
      })
      expect(event).to.not.be.undefined

      expect(await feeSwitch.veXFContract()).to.equal(await getAddress(newVeXF))
    })

    it('Should allow owner to set minVeXF', async function () {
      const newMin = parseEther('2000')
      
      const tx = await feeSwitch.setMinVeXF(newMin)
      const receipt = await tx.wait()
      
      // Check event was emitted
      const event = receipt.logs.find(log => {
        try {
          const parsed = feeSwitch.interface.parseLog(log)
          return parsed && parsed.name === 'MinVeXFChanged'
        } catch {
          return false
        }
      })
      expect(event).to.not.be.undefined

      expect(await feeSwitch.minVeXFForFeeChange()).to.equal(newMin)
    })

    it('Should revert if non-owner tries to set', async function () {
      await expect(
        feeSwitch.connect(user1).setVeXF(await getAddress(veXF))
      ).to.be.reverted // Custom error in OpenZeppelin v5

      await expect(
        feeSwitch.connect(user1).setMinVeXF(parseEther('2000'))
      ).to.be.reverted // Custom error in OpenZeppelin v5
    })

    it('Should revert if setting zero address for veXF', async function () {
      await expect(
        feeSwitch.setVeXF(ethers.ZeroAddress)
      ).to.be.revertedWith('CyberneticFeeSwitch: invalid veXF')
    })
  })

  describe('View functions', function () {
    it('Should return correct fee mode', async function () {
      expect(await feeSwitch.getFeeMode()).to.equal(0) // Growth
      
      await feeSwitch.setFeeMode(1)
      expect(await feeSwitch.getFeeMode()).to.equal(1) // Extraction
    })

    it('Should return correct current fee BPS', async function () {
      expect(await feeSwitch.getCurrentFeeBps()).to.equal(await feeSwitch.GROWTH_MODE_FEE_BPS())
      
      await feeSwitch.setFeeMode(1)
      expect(await feeSwitch.getCurrentFeeBps()).to.equal(await feeSwitch.EXTRACTION_MODE_FEE_BPS())
    })

    it('Should return correct cooldown status', async function () {
      expect(await feeSwitch.isCooldownActive()).to.equal(false)
      
      await feeSwitch.setFeeMode(1)
      expect(await feeSwitch.isCooldownActive()).to.equal(true)
      
      // Fast forward past cooldown
      await hre.network.provider.send('evm_increaseTime', [7 * 24 * 60 * 60 + 1])
      await hre.network.provider.send('evm_mine')
      
      expect(await feeSwitch.isCooldownActive()).to.equal(false)
    })

    it('Should return correct cooldown time remaining', async function () {
      expect(await feeSwitch.getCooldownTimeRemaining()).to.equal(0)
      
      await feeSwitch.setFeeMode(1)
      const timeRemaining = await feeSwitch.getCooldownTimeRemaining()
      expect(timeRemaining).to.be.gt(0)
      expect(timeRemaining).to.be.lte(7 * 24 * 60 * 60)
      
      // Fast forward past cooldown
      await hre.network.provider.send('evm_increaseTime', [7 * 24 * 60 * 60 + 1])
      await hre.network.provider.send('evm_mine')
      
      expect(await feeSwitch.getCooldownTimeRemaining()).to.equal(0)
    })
  })

  describe('Upgradeability', function () {
    it('Should allow owner to upgrade', async function () {
      const CyberneticFeeSwitch = await ethers.getContractFactory('CyberneticFeeSwitch')
      const feeSwitch2 = await upgrades.upgradeProxy(await getAddress(feeSwitch), CyberneticFeeSwitch)

      expect(await getAddress(feeSwitch2)).to.equal(await getAddress(feeSwitch))
    })

    it('Should preserve state after upgrade', async function () {
      // Set some state
      await feeSwitch.setFeeMode(1)
      await feeSwitch.setMinVeXF(parseEther('2000'))
      
      const modeBefore = await feeSwitch.currentMode()
      const minVeXFBefore = await feeSwitch.minVeXFForFeeChange()

      const CyberneticFeeSwitch = await ethers.getContractFactory('CyberneticFeeSwitch')
      const feeSwitch2 = await upgrades.upgradeProxy(await getAddress(feeSwitch), CyberneticFeeSwitch)

      expect(await feeSwitch2.currentMode()).to.equal(modeBefore)
      expect(await feeSwitch2.minVeXFForFeeChange()).to.equal(minVeXFBefore)
    })
  })
})

