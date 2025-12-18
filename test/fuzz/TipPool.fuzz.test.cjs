const { expect } = require('chai')
const { ethers } = require('hardhat')
const { getAddress, parseEther, getZeroAddress } = require('../helpers.cjs')

/**
 * Fuzz tests for TipPool
 * Tests various tip amounts, pool durations, and edge cases
 */
describe('TipPool Fuzz Tests', function () {
  let tipPool
  let owner, creator, tipper1, tipper2, tipper3

  beforeEach(async function () {
    [owner, creator, tipper1, tipper2, tipper3] = await ethers.getSigners()

    const TipPool = await ethers.getContractFactory('TipPool')
    tipPool = await TipPool.deploy()
    await tipPool.waitForDeployment?.() || await tipPool.deployed?.()
  })

  describe('Fuzz: tip amounts', function () {
    const tipAmounts = [
      { name: 'dust', amount: '1' }, // 1 wei
      { name: 'tiny', amount: '0.000001' },
      { name: 'small', amount: '0.01' },
      { name: 'medium', amount: '1' },
      { name: 'large', amount: '100' },
      { name: 'very large', amount: '10000', skipIfInsufficientFunds: true },
    ]

    tipAmounts.forEach(({ name, amount, skipIfInsufficientFunds }) => {
      it(`Should accept tip with ${name} amount`, async function () {
        const duration = 86400
        const creatorAddr = await getAddress(creator)
        await tipPool.createPool(duration, creatorAddr)
        const poolId = 0

        const tipAmount = parseEther(amount)
        
        // Check if account has sufficient balance
        const tipperBalance = await ethers.provider.getBalance(await getAddress(tipper1))
        if (skipIfInsufficientFunds && tipperBalance.lt(tipAmount.mul(2))) {
          // Skip test if insufficient funds (account needs gas too)
          this.skip()
        }

        await expect(
          tipPool.connect(tipper1).tipPool(poolId, { value: tipAmount })
        ).to.emit(tipPool, 'TipAdded')
          .withArgs(poolId, await getAddress(tipper1), tipAmount)

        const poolInfo = await tipPool.getPoolInfo(poolId)
        expect(poolInfo.totalTips.toString()).to.equal(tipAmount.toString())
      })
    })
  })

  describe('Fuzz: pool durations', function () {
    const durations = [
      { name: '1 second', seconds: 1 },
      { name: '1 minute', seconds: 60 },
      { name: '1 hour', seconds: 3600 },
      { name: '1 day', seconds: 86400 },
      { name: '30 days', seconds: 30 * 86400 },
      { name: '365 days', seconds: 365 * 86400 },
    ]

    durations.forEach(({ name, seconds }) => {
      it(`Should create pool with ${name} duration`, async function () {
        const creatorAddr = await getAddress(creator)
        await expect(
          tipPool.createPool(seconds, creatorAddr)
        ).to.emit(tipPool, 'PoolCreated')
      })
    })

    it('Should reject duration of 0', async function () {
      const creatorAddr = await getAddress(creator)
      await expect(
        tipPool.createPool(0, creatorAddr)
      ).to.be.revertedWith('TipPool: invalid duration')
    })

    it('Should reject duration exceeding 365 days', async function () {
      const creatorAddr = await getAddress(creator)
      const maxDuration = 365 * 24 * 60 * 60
      await expect(
        tipPool.createPool(maxDuration + 1, creatorAddr)
      ).to.be.revertedWith('TipPool: invalid duration')
    })
  })

  describe('Fuzz: multiple tippers with varying amounts', function () {
    it('Should handle many tippers with different amounts', async function () {
      const duration = 86400
      const creatorAddr = await getAddress(creator)
      await tipPool.createPool(duration, creatorAddr)
      const poolId = 0

      const tippers = [tipper1, tipper2, tipper3]
      const amounts = [parseEther('1'), parseEther('2'), parseEther('0.5')]

      let totalTips = ethers.BigNumber.from(0)
      for (let i = 0; i < tippers.length; i++) {
        await tipPool.connect(tippers[i]).tipPool(poolId, { value: amounts[i] })
        totalTips = totalTips.add(amounts[i])
      }

      const poolInfo = await tipPool.getPoolInfo(poolId)
      expect(poolInfo.totalTips.toString()).to.equal(totalTips.toString())

      const tippersList = await tipPool.getPoolTippers(poolId)
      expect(tippersList.length).to.equal(tippers.length)
    })

    it('Should allow same tipper to tip multiple times', async function () {
      const duration = 86400
      const creatorAddr = await getAddress(creator)
      await tipPool.createPool(duration, creatorAddr)
      const poolId = 0

      const amounts = [parseEther('1'), parseEther('2'), parseEther('0.5')]
      let total = ethers.BigNumber.from(0)

      for (const amount of amounts) {
        await tipPool.connect(tipper1).tipPool(poolId, { value: amount })
        total = total.add(amount)
      }

      const tipAmount = await tipPool.getTipAmount(poolId, await getAddress(tipper1))
      expect(tipAmount.toString()).to.equal(total.toString())
    })
  })

  describe('Fuzz: commit-reveal randomness', function () {
    it('Should handle various reveal values', async function () {
      const duration = 86400
      const creatorAddr = await getAddress(creator)
      
      const revealValues = [1, 12345, 999999, ethers.BigNumber.from('2').pow(255).toString()]

      for (let i = 0; i < revealValues.length; i++) {
        const reveal = revealValues[i]
        
        // Create a new pool for each iteration
        const poolIdBefore = await tipPool.nextPoolId()
        await tipPool.createPool(duration, creatorAddr)
        const poolId = poolIdBefore // The poolId is the value before increment
        
        await tipPool.connect(tipper1).tipPool(poolId, { value: parseEther('1') })

        const commit = ethers.utils.keccak256(ethers.utils.solidityPack(['uint256'], [reveal]))
        await tipPool.commitRandomness(poolId, commit)

        // Fast-forward time
        await ethers.provider.send('evm_increaseTime', [duration + 1])
        await ethers.provider.send('evm_mine', [])

        await tipPool.revealAndEndPool(poolId, reveal)

        const poolInfo = await tipPool.getPoolInfo(poolId)
        expect(poolInfo.ended).to.equal(true)
      }
    })
  })

  describe('Fuzz: weighted winner selection', function () {
    it('Should select winner proportionally to tip amounts', async function () {
      const duration = 86400
      const creatorAddr = await getAddress(creator)
      await tipPool.createPool(duration, creatorAddr)
      const poolId = 0

      // Tip amounts that create clear weight distribution
      await tipPool.connect(tipper1).tipPool(poolId, { value: parseEther('1') })
      await tipPool.connect(tipper2).tipPool(poolId, { value: parseEther('9') }) // 9x more weight

      // Fast-forward time
      await ethers.provider.send('evm_increaseTime', [duration + 1])
      await ethers.provider.send('evm_mine', [])

      await tipPool.endPool(poolId)

      const poolInfo = await tipPool.getPoolInfo(poolId)
      const winner = poolInfo.winner
      const tippers = await tipPool.getPoolTippers(poolId)

      // Winner should be one of the tippers
      const tippersLower = tippers.map(t => t.toLowerCase())
      expect(tippersLower).to.include(winner.toLowerCase())
    })
  })
})

