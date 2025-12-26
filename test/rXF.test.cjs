const { expect } = require('chai')
const { ethers, upgrades } = require('hardhat')
const hre = require('hardhat')
const { getAddress, parseEther } = require('./helpers.cjs')

describe('rXF', function () {
  let rXF, xfToken, veXF, revenueSplitter
  let owner, user1, user2, minter
  let MockERC20

  beforeEach(async function () {
    // Reset network state
    await hre.network.provider.request({
      method: 'hardhat_reset',
      params: []
    })

    ;[owner, user1, user2, minter] = await ethers.getSigners()
    revenueSplitter = minter // Use minter as revenueSplitter for testing

    // Deploy mock XF token
    MockERC20 = await ethers.getContractFactory('MockERC20')
    xfToken = await MockERC20.deploy('XFuel Token', 'XF', 18)
    await (xfToken.waitForDeployment?.() || xfToken.deployed?.())

    // Deploy veXF
    const VeXF = await ethers.getContractFactory('veXF')
    veXF = await upgrades.deployProxy(VeXF, [
      await getAddress(xfToken),
      await getAddress(owner)
    ], { initializer: 'initialize' })
    await (veXF.waitForDeployment?.() || veXF.deployed?.())

    // Deploy rXF
    const RXF = await ethers.getContractFactory('rXF')
    rXF = await upgrades.deployProxy(RXF, [
      await getAddress(xfToken),
      await getAddress(veXF),
      await getAddress(revenueSplitter),
      await getAddress(owner)
    ], { initializer: 'initialize' })
    await (rXF.waitForDeployment?.() || rXF.deployed?.())

    // Mint XF tokens for redemption testing
    await xfToken.mint(await getAddress(rXF), parseEther('1000000'))
  })

  afterEach(async function () {
    await hre.network.provider.request({
      method: 'hardhat_reset',
      params: []
    })
  })

  describe('Deployment', function () {
    it('Should initialize with correct addresses', async function () {
      expect(await rXF.xfToken()).to.equal(await getAddress(xfToken))
      expect(await rXF.veXFContract()).to.equal(await getAddress(veXF))
      expect(await rXF.revenueSplitter()).to.equal(await getAddress(revenueSplitter))
      expect(await rXF.owner()).to.equal(await getAddress(owner))
    })

    it('Should initialize with correct name and symbol', async function () {
      expect(await rXF.name()).to.equal('Revenue XF')
      expect(await rXF.symbol()).to.equal('rXF')
      expect(await rXF.decimals()).to.equal(18)
    })

    it('Should initialize with zero total supply', async function () {
      expect(await rXF.totalSupply()).to.equal(0)
    })

    it('Should set revenueSplitter as minter', async function () {
      expect(await rXF.minters(await getAddress(revenueSplitter))).to.be.true
    })

    it('Should revert if initialized with zero addresses', async function () {
      const RXF = await ethers.getContractFactory('rXF')
      
      await expect(
        upgrades.deployProxy(RXF, [
          ethers.ZeroAddress,
          await getAddress(veXF),
          await getAddress(revenueSplitter),
          await getAddress(owner)
        ], { initializer: 'initialize' })
      ).to.be.revertedWith('rXF: invalid XF token')

      await expect(
        upgrades.deployProxy(RXF, [
          await getAddress(xfToken),
          ethers.ZeroAddress,
          await getAddress(revenueSplitter),
          await getAddress(owner)
        ], { initializer: 'initialize' })
      ).to.be.revertedWith('rXF: invalid veXF')

      await expect(
        upgrades.deployProxy(RXF, [
          await getAddress(xfToken),
          await getAddress(veXF),
          ethers.ZeroAddress,
          await getAddress(owner)
        ], { initializer: 'initialize' })
      ).to.be.revertedWith('rXF: invalid revenue splitter')
    })

    it('Should prevent double initialization', async function () {
      await expect(
        rXF.initialize(
          await getAddress(xfToken),
          await getAddress(veXF),
          await getAddress(revenueSplitter),
          await getAddress(owner)
        )
      ).to.be.reverted
    })
  })

  describe('Minting', function () {
    it('Should mint rXF tokens to user', async function () {
      const amount = parseEther('1000')
      const redemptionPeriod = 0 // Use default
      const hasPriorityFlag = false

      await rXF.connect(minter).mint(
        await getAddress(user1),
        amount,
        redemptionPeriod,
        hasPriorityFlag
      )

      expect(await rXF.balanceOf(await getAddress(user1))).to.equal(amount)
      expect(await rXF.totalSupply()).to.equal(amount)

      const receipt = await rXF.getReceipt(await getAddress(user1))
      expect(receipt.amount).to.equal(amount)
      expect(receipt.hasPriorityFlag).to.equal(false)
    })

    it('Should use default redemption period when 0 is provided', async function () {
      const amount = parseEther('1000')
      await rXF.connect(minter).mint(
        await getAddress(user1),
        amount,
        0, // Default period
        false
      )

      const receipt = await rXF.getReceipt(await getAddress(user1))
      expect(receipt.redemptionPeriod).to.equal(365 * 24 * 60 * 60) // 365 days
    })

    it('Should use custom redemption period when provided', async function () {
      const amount = parseEther('1000')
      const customPeriod = 180 * 24 * 60 * 60 // 180 days
      await rXF.connect(minter).mint(
        await getAddress(user1),
        amount,
        customPeriod,
        false
      )

      const receipt = await rXF.getReceipt(await getAddress(user1))
      expect(receipt.redemptionPeriod).to.equal(customPeriod)
    })

    it('Should set priority flag when provided', async function () {
      const amount = parseEther('1000')
      await rXF.connect(minter).mint(
        await getAddress(user1),
        amount,
        0,
        true // Priority flag
      )

      const receipt = await rXF.getReceipt(await getAddress(user1))
      expect(receipt.hasPriorityFlag).to.equal(true)
      expect(await rXF.hasPriorityFlag(await getAddress(user1))).to.equal(true)
    })

    it('Should accumulate amounts when minting to same user', async function () {
      const amount1 = parseEther('1000')
      const amount2 = parseEther('500')

      await rXF.connect(minter).mint(
        await getAddress(user1),
        amount1,
        0,
        false
      )

      await rXF.connect(minter).mint(
        await getAddress(user1),
        amount2,
        0,
        false
      )

      expect(await rXF.balanceOf(await getAddress(user1))).to.equal(amount1 + amount2)
      const receipt = await rXF.getReceipt(await getAddress(user1))
      expect(receipt.amount).to.equal(amount1 + amount2)
    })

    it('Should revert if minting to zero address', async function () {
      await expect(
        rXF.connect(minter).mint(
          ethers.ZeroAddress,
          parseEther('1000'),
          0,
          false
        )
      ).to.be.revertedWith('rXF: mint to zero address')
    })

    it('Should revert if amount is zero', async function () {
      await expect(
        rXF.connect(minter).mint(
          await getAddress(user1),
          0,
          0,
          false
        )
      ).to.be.revertedWith('rXF: amount must be greater than 0')
    })

    it('Should revert if redemption period is too short', async function () {
      await expect(
        rXF.connect(minter).mint(
          await getAddress(user1),
          parseEther('1000'),
          29 * 24 * 60 * 60, // 29 days
          false
        )
      ).to.be.revertedWith('rXF: redemption period too short')
    })

    it('Should revert if redemption period is too long', async function () {
      await expect(
        rXF.connect(minter).mint(
          await getAddress(user1),
          parseEther('1000'),
          5 * 365 * 24 * 60 * 60, // 5 years
          false
        )
      ).to.be.revertedWith('rXF: redemption period too long')
    })

    it('Should revert if not authorized to mint', async function () {
      await expect(
        rXF.connect(user1).mint(
          await getAddress(user2),
          parseEther('1000'),
          0,
          false
        )
      ).to.be.revertedWith('rXF: not authorized to mint')
    })

    it('Should allow owner to mint', async function () {
      const amount = parseEther('1000')
      await rXF.connect(owner).mint(
        await getAddress(user1),
        amount,
        0,
        false
      )

      expect(await rXF.balanceOf(await getAddress(user1))).to.equal(amount)
    })
  })

  describe('Admin Mint Batch', function () {
    it('Should mint to multiple recipients', async function () {
      const recipients = [
        await getAddress(user1),
        await getAddress(user2)
      ]
      const amounts = [
        parseEther('1000'),
        parseEther('2000')
      ]
      const periods = [0, 0]
      const flags = [false, true]

      await rXF.connect(owner).adminMintBatch(
        recipients,
        amounts,
        periods,
        flags
      )

      expect(await rXF.balanceOf(await getAddress(user1))).to.equal(amounts[0])
      expect(await rXF.balanceOf(await getAddress(user2))).to.equal(amounts[1])
      expect(await rXF.hasPriorityFlag(await getAddress(user2))).to.equal(true)
    })

    it('Should revert if array lengths mismatch', async function () {
      await expect(
        rXF.connect(owner).adminMintBatch(
          [await getAddress(user1)],
          [parseEther('1000'), parseEther('2000')],
          [0],
          [false]
        )
      ).to.be.revertedWith('rXF: array length mismatch')
    })
  })

  describe('Soulbound (No Transfers)', function () {
    beforeEach(async function () {
      // Mint some rXF to user1
      await rXF.connect(minter).mint(
        await getAddress(user1),
        parseEther('1000'),
        0,
        false
      )
    })

    it('Should revert on transfer', async function () {
      await expect(
        rXF.connect(user1).transfer(
          await getAddress(user2),
          parseEther('100')
        )
      ).to.be.revertedWith('rXF: soulbound token - transfers not allowed')
    })

    it('Should revert on transferFrom', async function () {
      await expect(
        rXF.connect(user2).transferFrom(
          await getAddress(user1),
          await getAddress(user2),
          parseEther('100')
        )
      ).to.be.revertedWith('rXF: soulbound token - transfers not allowed')
    })

    it('Should revert on approve', async function () {
      await expect(
        rXF.connect(user1).approve(
          await getAddress(user2),
          parseEther('100')
        )
      ).to.be.revertedWith('rXF: soulbound token - approvals not allowed')
    })

    it('Should return 0 for allowance', async function () {
      expect(await rXF.allowance(
        await getAddress(user1),
        await getAddress(user2)
      )).to.equal(0)
    })
  })

  describe('Redemption', function () {
    beforeEach(async function () {
      // Mint rXF with 365 day redemption period
      await rXF.connect(minter).mint(
        await getAddress(user1),
        parseEther('1000'),
        0, // Default 365 days
        false
      )
    })

    it('Should revert if redemption period has not elapsed', async function () {
      await expect(
        rXF.connect(user1).redeem(parseEther('100'))
      ).to.be.revertedWith('rXF: redemption period not elapsed')
    })

    it('Should allow redemption after period elapses', async function () {
      // Fast forward time by 365 days + 1 day
      await hre.network.provider.send('evm_increaseTime', [366 * 24 * 60 * 60])
      await hre.network.provider.send('evm_mine')

      const redeemAmount = parseEther('500')
      const xfBalanceBefore = await xfToken.balanceOf(await getAddress(user1))

      await rXF.connect(user1).redeem(redeemAmount)

      const xfBalanceAfter = await xfToken.balanceOf(await getAddress(user1))
      expect(xfBalanceAfter - xfBalanceBefore).to.equal(redeemAmount)
      expect(await rXF.balanceOf(await getAddress(user1))).to.equal(parseEther('500'))
    })

    it('Should redeem 1:1 with XF tokens', async function () {
      await hre.network.provider.send('evm_increaseTime', [366 * 24 * 60 * 60])
      await hre.network.provider.send('evm_mine')

      const redeemAmount = parseEther('1000')
      const xfBalanceBefore = await xfToken.balanceOf(await getAddress(user1))

      await rXF.connect(user1).redeem(redeemAmount)

      const xfBalanceAfter = await xfToken.balanceOf(await getAddress(user1))
      expect(xfBalanceAfter - xfBalanceBefore).to.equal(redeemAmount)
    })

    it('Should update receipt after partial redemption', async function () {
      await hre.network.provider.send('evm_increaseTime', [366 * 24 * 60 * 60])
      await hre.network.provider.send('evm_mine')

      await rXF.connect(user1).redeem(parseEther('300'))

      const receipt = await rXF.getReceipt(await getAddress(user1))
      expect(receipt.amount).to.equal(parseEther('700'))
    })

    it('Should delete receipt after full redemption', async function () {
      await hre.network.provider.send('evm_increaseTime', [366 * 24 * 60 * 60])
      await hre.network.provider.send('evm_mine')

      await rXF.connect(user1).redeem(parseEther('1000'))

      const receipt = await rXF.getReceipt(await getAddress(user1))
      expect(receipt.amount).to.equal(0)
      expect(await rXF.balanceOf(await getAddress(user1))).to.equal(0)
    })

    it('Should revert if amount exceeds balance', async function () {
      await hre.network.provider.send('evm_increaseTime', [366 * 24 * 60 * 60])
      await hre.network.provider.send('evm_mine')

      await expect(
        rXF.connect(user1).redeem(parseEther('2000'))
      ).to.be.revertedWith('rXF: amount exceeds receipt')
    })

    it('Should revert if no receipt exists', async function () {
      await hre.network.provider.send('evm_increaseTime', [366 * 24 * 60 * 60])
      await hre.network.provider.send('evm_mine')

      await expect(
        rXF.connect(user2).redeem(parseEther('100'))
      ).to.be.revertedWith('rXF: no receipt')
    })

    it('Should work with custom redemption period', async function () {
      // Mint with 180 day period
      await rXF.connect(minter).mint(
        await getAddress(user2),
        parseEther('500'),
        180 * 24 * 60 * 60,
        false
      )

      // Fast forward 180 days + 1 day
      await hre.network.provider.send('evm_increaseTime', [181 * 24 * 60 * 60])
      await hre.network.provider.send('evm_mine')

      await rXF.connect(user2).redeem(parseEther('500'))
      expect(await rXF.balanceOf(await getAddress(user2))).to.equal(0)
    })
  })

  describe('Voting Boost', function () {
    beforeEach(async function () {
      // Create veXF lock for user1
      const lockAmount = parseEther('1000')
      const unlockTime = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
      await xfToken.mint(await getAddress(user1), lockAmount)
      await xfToken.connect(user1).approve(await getAddress(veXF), lockAmount)
      await veXF.connect(user1).createLock(lockAmount, unlockTime)

      // Mint rXF to user1
      await rXF.connect(minter).mint(
        await getAddress(user1),
        parseEther('100'),
        0,
        false
      )
    })

    it('Should calculate voting boost correctly (4× rXF balance)', async function () {
      const rXFBalance = await rXF.balanceOf(await getAddress(user1))
      const votingBoost = await rXF.getVotingBoost(await getAddress(user1))
      expect(votingBoost).to.equal(rXFBalance * 4n)
    })

    it('Should calculate boosted voting power (veXF + 4× rXF)', async function () {
      const veXFPower = await veXF.votingPower(await getAddress(user1))
      const rXFBalance = await rXF.balanceOf(await getAddress(user1))
      const boostedPower = await rXF.getBoostedVotingPower(await getAddress(user1))

      expect(boostedPower).to.equal(veXFPower + (rXFBalance * 4n))
    })

    it('Should return 0 boost for user with no rXF', async function () {
      const votingBoost = await rXF.getVotingBoost(await getAddress(user2))
      expect(votingBoost).to.equal(0)
    })
  })

  describe('canRedeem', function () {
    beforeEach(async function () {
      await rXF.connect(minter).mint(
        await getAddress(user1),
        parseEther('1000'),
        0,
        false
      )
    })

    it('Should return false before redemption period', async function () {
      const [canRedeem, amount, timeRemaining] = await rXF.canRedeem(await getAddress(user1))
      expect(canRedeem).to.be.false
      expect(amount).to.equal(parseEther('1000'))
      expect(timeRemaining).to.be.gt(0)
    })

    it('Should return true after redemption period', async function () {
      await hre.network.provider.send('evm_increaseTime', [366 * 24 * 60 * 60])
      await hre.network.provider.send('evm_mine')

      const [canRedeem, amount, timeRemaining] = await rXF.canRedeem(await getAddress(user1))
      expect(canRedeem).to.be.true
      expect(amount).to.equal(parseEther('1000'))
      expect(timeRemaining).to.equal(0)
    })

    it('Should return false for user with no receipt', async function () {
      const [canRedeem, amount, timeRemaining] = await rXF.canRedeem(await getAddress(user2))
      expect(canRedeem).to.be.false
      expect(amount).to.equal(0)
      expect(timeRemaining).to.equal(0)
    })
  })

  describe('Admin Functions', function () {
    it('Should set custom redemption period', async function () {
      const customPeriod = 180 * 24 * 60 * 60
      await rXF.connect(owner).setCustomRedemptionPeriod(
        await getAddress(user1),
        customPeriod
      )

      expect(await rXF.customRedemptionPeriods(await getAddress(user1))).to.equal(customPeriod)
    })

    it('Should set priority flag', async function () {
      await rXF.connect(owner).setPriorityFlag(await getAddress(user1), true)
      expect(await rXF.hasPriorityFlag(await getAddress(user1))).to.be.true

      await rXF.connect(owner).setPriorityFlag(await getAddress(user1), false)
      expect(await rXF.hasPriorityFlag(await getAddress(user1))).to.be.false
    })

    it('Should add and remove minters', async function () {
      await rXF.connect(owner).addMinter(await getAddress(user1))
      expect(await rXF.minters(await getAddress(user1))).to.be.true

      await rXF.connect(owner).removeMinter(await getAddress(user1))
      expect(await rXF.minters(await getAddress(user1))).to.be.false
    })

    it('Should update contract addresses', async function () {
      const newVeXF = await upgrades.deployProxy(
        await ethers.getContractFactory('veXF'),
        [await getAddress(xfToken), await getAddress(owner)],
        { initializer: 'initialize' }
      )
      await (newVeXF.waitForDeployment?.() || newVeXF.deployed?.())

      await rXF.connect(owner).setVeXF(await getAddress(newVeXF))
      expect(await rXF.veXFContract()).to.equal(await getAddress(newVeXF))
    })

    it('Should revert admin functions if not owner', async function () {
      await expect(
        rXF.connect(user1).setCustomRedemptionPeriod(await getAddress(user2), 180 * 24 * 60 * 60)
      ).to.be.reverted

      await expect(
        rXF.connect(user1).setPriorityFlag(await getAddress(user2), true)
      ).to.be.reverted

      await expect(
        rXF.connect(user1).addMinter(await getAddress(user2))
      ).to.be.reverted
    })
  })

  describe('UUPS Upgradeability', function () {
    it('Should allow owner to upgrade', async function () {
      const RXF = await ethers.getContractFactory('rXF')
      const rXF2 = await upgrades.upgradeProxy(
        await getAddress(rXF),
        RXF
      )
      await (rXF2.waitForDeployment?.() || rXF2.deployed?.())

      // Verify state is preserved
      expect(await rXF2.name()).to.equal('Revenue XF')
      expect(await rXF2.symbol()).to.equal('rXF')
    })

    it('Should revert upgrade if not owner', async function () {
      const RXF = await ethers.getContractFactory('rXF')
      await expect(
        upgrades.upgradeProxy(
          await getAddress(rXF),
          RXF.connect(user1)
        )
      ).to.be.reverted
    })
  })
})

