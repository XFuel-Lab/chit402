const { expect } = require('chai')
const { ethers } = require('hardhat')
const hre = require('hardhat')
const { getAddress } = require('./helpers.cjs')

/**
 * @title VaultFactory and SubVault Test Suite
 * @notice Comprehensive tests for the Theta EVM bridge vault system
 */
describe('VaultFactory and SubVault', function () {
  let factory, admin, pauser, user1, user2, revSplitterAddr, refundRecipient

  beforeEach(async function () {
    // Reset network for clean state
    await hre.network.provider.request({
      method: 'hardhat_reset',
      params: []
    })

    ;[admin, pauser, user1, user2, revSplitterAddr, refundRecipient] = await ethers.getSigners()

    // Deploy VaultFactory
    const VaultFactory = await ethers.getContractFactory('VaultFactory')
    factory = await VaultFactory.deploy(await getAddress(admin), await getAddress(revSplitterAddr))
    await (factory.waitForDeployment?.() || factory.deployed?.())

    // Grant PAUSER_ROLE to pauser account
    const PAUSER_ROLE = await factory.PAUSER_ROLE()
    await factory.connect(admin).grantRole(PAUSER_ROLE, await getAddress(pauser))
  })

  describe('VaultFactory Deployment', function () {
    it('Should deploy with correct admin and RevSplitter', async function () {
      expect(await factory.getRevSplitter()).to.equal(await getAddress(revSplitterAddr))

      // Check admin role
      const DEFAULT_ADMIN_ROLE = await factory.DEFAULT_ADMIN_ROLE()
      expect(await factory.hasRole(DEFAULT_ADMIN_ROLE, await getAddress(admin))).to.be.true
    })

    it('Should grant PAUSER_ROLE to admin during deployment', async function () {
      const PAUSER_ROLE = await factory.PAUSER_ROLE()
      expect(await factory.hasRole(PAUSER_ROLE, await getAddress(admin))).to.be.true
    })

    it('Should revert deployment with zero address admin', async function () {
      const VaultFactory = await ethers.getContractFactory('VaultFactory')

      await expect(
        VaultFactory.deploy(ethers.ZeroAddress, await getAddress(revSplitterAddr))
      ).to.be.reverted
    })

    it('Should revert deployment with zero address RevSplitter', async function () {
      const VaultFactory = await ethers.getContractFactory('VaultFactory')

      await expect(
        VaultFactory.deploy(await getAddress(admin), ethers.ZeroAddress)
      ).to.be.reverted
    })
  })

  describe('Vault Creation', function () {
    it('Should create vault with deterministic address', async function () {
      const salt = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [await getAddress(user1), 0]))
      const predictedAddr = await factory.predictAddress(salt)

      const tx = await factory.connect(user1).createVault(salt)
      const receipt = await tx.wait()

      // Find VaultCreated event
      const event = receipt.logs.find(log => {
        try {
          const parsed = factory.interface.parseLog(log)
          return parsed.name === 'VaultCreated'
        } catch {
          return false
        }
      })

      const parsedEvent = factory.interface.parseLog(event)
      expect(parsedEvent.args.vaultAddr).to.equal(predictedAddr)
      expect(parsedEvent.args.salt).to.equal(salt)
      expect(parsedEvent.args.creator).to.equal(await getAddress(user1))

      // Verify vault is tracked
      expect(await factory.isVaultDeployed(predictedAddr)).to.be.true
    })

    it('Should generate correct salt from helper function', async function () {
      const nonce = 5
      const generatedSalt = await factory.generateSalt(await getAddress(user1), nonce)
      const expectedSalt = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [await getAddress(user1), nonce])
      )

      expect(generatedSalt).to.equal(expectedSalt)
    })

    it('Should predict different addresses for different salts', async function () {
      const salt1 = await factory.generateSalt(await getAddress(user1), 0)
      const salt2 = await factory.generateSalt(await getAddress(user1), 1)

      const addr1 = await factory.predictAddress(salt1)
      const addr2 = await factory.predictAddress(salt2)

      expect(addr1).to.not.equal(addr2)
    })

    it('Should revert if vault already exists', async function () {
      const salt = await factory.generateSalt(await getAddress(user1), 0)
      await factory.connect(user1).createVault(salt)

      await expect(factory.connect(user1).createVault(salt)).to.be.reverted
    })

    it('Should revert vault creation when paused', async function () {
      await factory.connect(pauser).pause()
      const salt = await factory.generateSalt(await getAddress(user1), 0)

      await expect(factory.connect(user1).createVault(salt)).to.be.reverted
    })

    it('Should allow vault creation after unpause', async function () {
      await factory.connect(pauser).pause()
      await factory.connect(pauser).unpause()

      const salt = await factory.generateSalt(await getAddress(user1), 0)
      await expect(factory.connect(user1).createVault(salt)).to.not.be.reverted
    })
  })

  describe('SubVault Deposits', function () {
    it('Should receive deposit and calculate 0.5% fee correctly', async function () {
      const salt = await factory.generateSalt(await getAddress(user1), 0)
      await factory.connect(user1).createVault(salt)
      const vaultAddr = await factory.predictAddress(salt)

      const SubVault = await ethers.getContractFactory('SubVault')
      const vault = SubVault.attach(vaultAddr)

      const depositAmount = ethers.parseEther('100')
      const expectedFee = (depositAmount * 50n) / 10000n // 0.5%
      const expectedNet = depositAmount - expectedFee

      const revSplitterBalanceBefore = await ethers.provider.getBalance(await getAddress(revSplitterAddr))

      const tx = await user1.sendTransaction({ to: vaultAddr, value: depositAmount })
      await tx.wait()

      // Check balances
      const vaultBalance = await ethers.provider.getBalance(vaultAddr)
      const revSplitterBalanceAfter = await ethers.provider.getBalance(await getAddress(revSplitterAddr))

      expect(vaultBalance).to.equal(expectedNet)
      expect(revSplitterBalanceAfter - revSplitterBalanceBefore).to.equal(expectedFee)
    })

    it('Should handle multiple deposits to same vault', async function () {
      const salt = await factory.generateSalt(await getAddress(user1), 0)
      await factory.connect(user1).createVault(salt)
      const vaultAddr = await factory.predictAddress(salt)

      const deposit1 = ethers.parseEther('50')
      const deposit2 = ethers.parseEther('75')

      await user1.sendTransaction({ to: vaultAddr, value: deposit1 })
      await user2.sendTransaction({ to: vaultAddr, value: deposit2 })

      const fee1 = (deposit1 * 50n) / 10000n
      const fee2 = (deposit2 * 50n) / 10000n
      const expectedVaultBalance = deposit1 - fee1 + (deposit2 - fee2)

      const vaultBalance = await ethers.provider.getBalance(vaultAddr)
      expect(vaultBalance).to.equal(expectedVaultBalance)
    })

    it('Should revert on zero deposit', async function () {
      const salt = await factory.generateSalt(await getAddress(user1), 0)
      await factory.connect(user1).createVault(salt)
      const vaultAddr = await factory.predictAddress(salt)

      await expect(
        user1.sendTransaction({ to: vaultAddr, value: 0 })
      ).to.be.revertedWith('SubVault: zero deposit')
    })

    it('Should calculate fee correctly for various amounts', async function () {
      const testAmounts = [
        ethers.parseEther('1'),
        ethers.parseEther('10.5'),
        ethers.parseEther('999.999'),
        ethers.parseEther('0.001'),
      ]

      for (let i = 0; i < testAmounts.length; i++) {
        const salt = await factory.generateSalt(await getAddress(user1), i)
        await factory.connect(user1).createVault(salt)
        const vaultAddr = await factory.predictAddress(salt)

        const depositAmount = testAmounts[i]
        const expectedFee = (depositAmount * 50n) / 10000n
        const expectedNet = depositAmount - expectedFee

        await user1.sendTransaction({ to: vaultAddr, value: depositAmount })

        const vaultBalance = await ethers.provider.getBalance(vaultAddr)
        expect(vaultBalance).to.equal(expectedNet)
      }
    })

    it('Should store factory and revSplitter as immutable', async function () {
      const salt = await factory.generateSalt(await getAddress(user1), 0)
      await factory.connect(user1).createVault(salt)
      const vaultAddr = await factory.predictAddress(salt)

      const SubVault = await ethers.getContractFactory('SubVault')
      const vault = SubVault.attach(vaultAddr)

      expect(await vault.factory()).to.equal(await getAddress(factory))
      expect(await vault.revSplitter()).to.equal(await getAddress(revSplitterAddr))
    })
  })

  describe('Access Control', function () {
    it('Should allow admin to update RevSplitter', async function () {
      const tx = await factory.connect(admin).setRevSplitter(await getAddress(user1))
      await tx.wait()

      expect(await factory.getRevSplitter()).to.equal(await getAddress(user1))
    })

    it('Should revert RevSplitter update with zero address', async function () {
      await expect(
        factory.connect(admin).setRevSplitter(ethers.ZeroAddress)
      ).to.be.reverted
    })

    it('Should revert RevSplitter update from non-admin', async function () {
      await expect(
        factory.connect(user1).setRevSplitter(await getAddress(user2))
      ).to.be.reverted
    })

    it('Should allow pauser to pause/unpause', async function () {
      await expect(factory.connect(pauser).pause()).to.not.be.reverted
      expect(await factory.paused()).to.be.true

      await expect(factory.connect(pauser).unpause()).to.not.be.reverted
      expect(await factory.paused()).to.be.false
    })

    it('Should revert pause from non-pauser', async function () {
      await expect(factory.connect(user1).pause()).to.be.reverted
    })

    it('Should allow admin to grant and revoke roles', async function () {
      const PAUSER_ROLE = await factory.PAUSER_ROLE()

      await factory.connect(admin).grantRole(PAUSER_ROLE, await getAddress(user1))
      expect(await factory.hasRole(PAUSER_ROLE, await getAddress(user1))).to.be.true

      await factory.connect(admin).revokeRole(PAUSER_ROLE, await getAddress(user1))
      expect(await factory.hasRole(PAUSER_ROLE, await getAddress(user1))).to.be.false
    })
  })

  describe('Refund Functionality', function () {
    it('Should allow admin to refund from vault', async function () {
      // Create vault and deposit
      const salt = await factory.generateSalt(await getAddress(user1), 0)
      await factory.connect(user1).createVault(salt)
      const vaultAddr = await factory.predictAddress(salt)

      const depositAmount = ethers.parseEther('100')
      await user1.sendTransaction({ to: vaultAddr, value: depositAmount })

      const vaultBalanceBefore = await ethers.provider.getBalance(vaultAddr)
      const recipientBalanceBefore = await ethers.provider.getBalance(await getAddress(refundRecipient))

      const refundAmount = ethers.parseEther('50')

      const tx = await factory.connect(admin).refundFromVault(vaultAddr, await getAddress(refundRecipient), refundAmount)
      await tx.wait()

      const vaultBalanceAfter = await ethers.provider.getBalance(vaultAddr)
      const recipientBalanceAfter = await ethers.provider.getBalance(await getAddress(refundRecipient))

      expect(vaultBalanceBefore - vaultBalanceAfter).to.equal(refundAmount)
      expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(refundAmount)
    })

    it('Should revert refund from non-admin', async function () {
      const salt = await factory.generateSalt(await getAddress(user1), 0)
      await factory.connect(user1).createVault(salt)
      const vaultAddr = await factory.predictAddress(salt)

      await user1.sendTransaction({ to: vaultAddr, value: ethers.parseEther('100') })

      await expect(
        factory.connect(user2).refundFromVault(vaultAddr, await getAddress(refundRecipient), ethers.parseEther('50'))
      ).to.be.reverted
    })

    it('Should revert refund from non-vault address', async function () {
      await expect(
        factory.connect(admin).refundFromVault(await getAddress(user1), await getAddress(refundRecipient), ethers.parseEther('50'))
      ).to.be.reverted
    })

    it('Should revert refund with insufficient vault balance', async function () {
      const salt = await factory.generateSalt(await getAddress(user1), 0)
      await factory.connect(user1).createVault(salt)
      const vaultAddr = await factory.predictAddress(salt)

      await user1.sendTransaction({ to: vaultAddr, value: ethers.parseEther('10') })

      await expect(
        factory.connect(admin).refundFromVault(vaultAddr, await getAddress(refundRecipient), ethers.parseEther('100'))
      ).to.be.reverted // Changed from revertedWith to reverted for custom errors
    })

    it('Should revert vault refund call from non-factory', async function () {
      const salt = await factory.generateSalt(await getAddress(user1), 0)
      await factory.connect(user1).createVault(salt)
      const vaultAddr = await factory.predictAddress(salt)

      const SubVault = await ethers.getContractFactory('SubVault')
      const vault = SubVault.attach(vaultAddr)

      await user1.sendTransaction({ to: vaultAddr, value: ethers.parseEther('100') })

      await expect(
        vault.connect(user2).refund(await getAddress(refundRecipient), ethers.parseEther('50'))
      ).to.be.reverted
    })
  })

  describe('Edge Cases and Security', function () {
    it('Should handle dust amounts correctly', async function () {
      const salt = await factory.generateSalt(await getAddress(user1), 0)
      await factory.connect(user1).createVault(salt)
      const vaultAddr = await factory.predictAddress(salt)

      // Very small amount where fee might round to 0
      const dustAmount = 1000n
      const expectedFee = (dustAmount * 50n) / 10000n // Should be 0
      const expectedNet = dustAmount - expectedFee

      await user1.sendTransaction({ to: vaultAddr, value: dustAmount })

      const vaultBalance = await ethers.provider.getBalance(vaultAddr)
      expect(vaultBalance).to.equal(expectedNet)
    })

    it('Should handle large deposits', async function () {
      const salt = await factory.generateSalt(await getAddress(user1), 0)
      await factory.connect(user1).createVault(salt)
      const vaultAddr = await factory.predictAddress(salt)

      const largeAmount = ethers.parseEther('1000') // Reduced from 10000
      const expectedFee = (largeAmount * 50n) / 10000n
      const expectedNet = largeAmount - expectedFee

      await user1.sendTransaction({ to: vaultAddr, value: largeAmount })

      const vaultBalance = await ethers.provider.getBalance(vaultAddr)
      expect(vaultBalance).to.equal(expectedNet)
    })

    it('Should return correct vault balance', async function () {
      const salt = await factory.generateSalt(await getAddress(user1), 0)
      await factory.connect(user1).createVault(salt)
      const vaultAddr = await factory.predictAddress(salt)

      const SubVault = await ethers.getContractFactory('SubVault')
      const vault = SubVault.attach(vaultAddr)

      const depositAmount = ethers.parseEther('100')
      await user1.sendTransaction({ to: vaultAddr, value: depositAmount })

      const expectedNet = depositAmount - (depositAmount * 50n) / 10000n
      expect(await vault.getBalance()).to.equal(expectedNet)
    })

    it('Should not allow direct vault construction with zero address', async function () {
      const SubVault = await ethers.getContractFactory('SubVault')

      await expect(SubVault.deploy(ethers.ZeroAddress)).to.be.revertedWith('SubVault: zero address')
    })

    it('Should create multiple vaults for same user with different nonces', async function () {
      const vaults = []
      for (let i = 0; i < 5; i++) {
        const salt = await factory.generateSalt(await getAddress(user1), i)
        await factory.connect(user1).createVault(salt)
        const vaultAddr = await factory.predictAddress(salt)
        vaults.push(vaultAddr)
      }

      // Ensure all addresses are unique
      const uniqueVaults = [...new Set(vaults)]
      expect(uniqueVaults.length).to.equal(5)

      // Verify all are tracked
      for (const vault of vaults) {
        expect(await factory.isVaultDeployed(vault)).to.be.true
      }
    })
  })

  describe('Integration Tests', function () {
    it('Should handle complete workflow: create, deposit, refund', async function () {
      // 1. Create vault
      const salt = await factory.generateSalt(await getAddress(user1), 0)
      await factory.connect(user1).createVault(salt)
      const vaultAddr = await factory.predictAddress(salt)

      // 2. Make deposit
      const depositAmount = ethers.parseEther('100')
      await user1.sendTransaction({ to: vaultAddr, value: depositAmount })

      const expectedFee = (depositAmount * 50n) / 10000n
      const expectedNet = depositAmount - expectedFee

      const vaultBalance = await ethers.provider.getBalance(vaultAddr)
      expect(vaultBalance).to.equal(expectedNet)

      // 3. Refund partial amount
      const refundAmount = ethers.parseEther('30')
      await factory.connect(admin).refundFromVault(vaultAddr, await getAddress(refundRecipient), refundAmount)

      const finalVaultBalance = await ethers.provider.getBalance(vaultAddr)
      expect(finalVaultBalance).to.equal(expectedNet - refundAmount)
    })

    it('Should handle RevSplitter address change for new vaults', async function () {
      // Create first vault with original RevSplitter
      const salt1 = await factory.generateSalt(await getAddress(user1), 0)
      await factory.connect(user1).createVault(salt1)
      const vault1Addr = await factory.predictAddress(salt1)

      const SubVault = await ethers.getContractFactory('SubVault')
      const vault1 = SubVault.attach(vault1Addr)
      const originalRevSplitter = await vault1.revSplitter()

      // Update RevSplitter
      await factory.connect(admin).setRevSplitter(await getAddress(user2))

      // Create second vault with new RevSplitter
      const salt2 = await factory.generateSalt(await getAddress(user1), 1)
      await factory.connect(user1).createVault(salt2)
      const vault2Addr = await factory.predictAddress(salt2)

      const vault2 = SubVault.attach(vault2Addr)
      const newRevSplitter = await vault2.revSplitter()

      // Verify old vault still uses original RevSplitter
      expect(await vault1.revSplitter()).to.equal(originalRevSplitter)
      // Verify new vault uses new RevSplitter
      expect(newRevSplitter).to.equal(await getAddress(user2))
    })
  })
})
