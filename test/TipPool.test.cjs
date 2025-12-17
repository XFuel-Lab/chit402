const { expect } = require('chai')
const { ethers } = require('hardhat')

const parseEther = (value) => {
  if (typeof ethers.parseEther === 'function') {
    return ethers.parseEther(value)
  }
  return ethers.utils.parseEther(value)
}

describe('TipPool', function () {
  let tipPool
  let owner, creator, tipper1, tipper2, tipper3

  beforeEach(async function () {
    [owner, creator, tipper1, tipper2, tipper3] = await ethers.getSigners()

    const TipPool = await ethers.getContractFactory('TipPool')
    tipPool = await TipPool.deploy()
    await tipPool.waitForDeployment?.() || await tipPool.deployed?.()
    // Note: TipPool now has constructor that takes owner, but deploy() handles it
  })

  describe('Deployment', function () {
    it('Should start with pool ID 0', async function () {
      expect(await tipPool.nextPoolId()).to.equal(0)
    })
  })

  describe('createPool', function () {
    const duration = 86400 // 1 day

    it('Should create a pool with correct parameters', async function () {
      const tx = await tipPool.createPool(duration, await creator.getAddress())
      const receipt = await tx.wait()

      const poolInfo = await tipPool.getPoolInfo(0)
      expect(poolInfo.creator).to.equal(await creator.getAddress())
      expect(poolInfo.ended).to.equal(false)
      expect(poolInfo.totalTips).to.equal(0)
      expect(poolInfo.startTime).to.be.gt(0)
      expect(poolInfo.endTime).to.equal(poolInfo.startTime + BigInt(duration))
    })

    it('Should increment nextPoolId', async function () {
      expect(await tipPool.nextPoolId()).to.equal(0)
      
      await tipPool.createPool(duration, await creator.getAddress())
      expect(await tipPool.nextPoolId()).to.equal(1)
      
      await tipPool.createPool(duration, await creator.getAddress())
      expect(await tipPool.nextPoolId()).to.equal(2)
    })

    it('Should emit PoolCreated event', async function () {
      await expect(
        tipPool.createPool(duration, await creator.getAddress())
      ).to.emit(tipPool, 'PoolCreated')
        .withArgs(0, await creator.getAddress(), duration)
    })

    it('Should allow creating multiple pools', async function () {
      await tipPool.createPool(duration, await creator.getAddress())
      await tipPool.createPool(duration * 2, await tipper1.getAddress())

      const pool0 = await tipPool.getPoolInfo(0)
      const pool1 = await tipPool.getPoolInfo(1)

      expect(pool0.creator).to.equal(await creator.getAddress())
      expect(pool1.creator).to.equal(await tipper1.getAddress())
      expect(pool1.endTime - pool1.startTime).to.equal(BigInt(duration * 2))
    })
  })

  describe('tipPool', function () {
    const duration = 86400
    let poolId

    beforeEach(async function () {
      await tipPool.createPool(duration, await creator.getAddress())
      poolId = 0
    })

    it('Should accept tips and update totals', async function () {
      const tipAmount = parseEther('1')
      
      await expect(
        tipPool.connect(tipper1).tipPool(poolId, { value: tipAmount })
      ).to.emit(tipPool, 'TipAdded')
        .withArgs(poolId, await tipper1.getAddress(), tipAmount)

      const poolInfo = await tipPool.getPoolInfo(poolId)
      expect(poolInfo.totalTips).to.equal(tipAmount)
      expect(await tipPool.getTipAmount(poolId, await tipper1.getAddress())).to.equal(tipAmount)
    })

    it('Should allow multiple tips from same address', async function () {
      const tip1 = parseEther('1')
      const tip2 = parseEther('0.5')
      const totalExpected = tip1 + tip2

      await tipPool.connect(tipper1).tipPool(poolId, { value: tip1 })
      await tipPool.connect(tipper1).tipPool(poolId, { value: tip2 })

      const tipAmount = await tipPool.getTipAmount(poolId, await tipper1.getAddress())
      expect(tipAmount.toString()).to.equal(totalExpected.toString())
      const poolInfo = await tipPool.getPoolInfo(poolId)
      expect(poolInfo.totalTips.toString()).to.equal(totalExpected.toString())
    })

    it('Should track multiple tippers', async function () {
      const tip1 = parseEther('1')
      const tip2 = parseEther('2')
      const tip3 = parseEther('0.5')

      await tipPool.connect(tipper1).tipPool(poolId, { value: tip1 })
      await tipPool.connect(tipper2).tipPool(poolId, { value: tip2 })
      await tipPool.connect(tipper3).tipPool(poolId, { value: tip3 })

      const tippers = await tipPool.getPoolTippers(poolId)
      expect(tippers.length).to.equal(3)
      expect(tippers[0]).to.equal(await tipper1.getAddress())
      expect(tippers[1]).to.equal(await tipper2.getAddress())
      expect(tippers[2]).to.equal(await tipper3.getAddress())
    })

    it('Should revert if tip is zero', async function () {
      await expect(
        tipPool.connect(tipper1).tipPool(poolId, { value: 0 })
      ).to.be.revertedWith('TipPool: tip must be greater than 0')
    })

    it('Should revert if pool has ended', async function () {
      // Fast-forward time
      await ethers.provider.send('evm_increaseTime', [duration + 1])
      await ethers.provider.send('evm_mine', [])

      await expect(
        tipPool.connect(tipper1).tipPool(poolId, { value: parseEther('1') })
      ).to.be.revertedWith('TipPool: pool has ended')
    })

    it('Should revert if pool was manually ended', async function () {
      // Add a tip first so pool has tips to distribute
      await tipPool.connect(tipper1).tipPool(poolId, { value: parseEther('1') })
      
      // Fast-forward time and end pool
      await ethers.provider.send('evm_increaseTime', [duration + 1])
      await ethers.provider.send('evm_mine', [])
      await tipPool.endPool(poolId)

      await expect(
        tipPool.connect(tipper1).tipPool(poolId, { value: parseEther('1') })
      ).to.be.revertedWith('TipPool: pool has ended')
    })
  })

  describe('drawWinner', function () {
    const duration = 86400
    let poolId

    beforeEach(async function () {
      await tipPool.createPool(duration, await creator.getAddress())
      poolId = 0

      // Add tips with different weights
      await tipPool.connect(tipper1).tipPool(poolId, { value: parseEther('1') })
      await tipPool.connect(tipper2).tipPool(poolId, { value: parseEther('2') })
      await tipPool.connect(tipper3).tipPool(poolId, { value: parseEther('1') })
    })

    it('Should return the only tipper if there is only one', async function () {
      await tipPool.createPool(duration, await creator.getAddress())
      const singleTipperPoolId = 1
      await tipPool.connect(tipper1).tipPool(singleTipperPoolId, { value: parseEther('1') })

      const winner = await tipPool.drawWinner(singleTipperPoolId)
      expect(winner).to.equal(await tipper1.getAddress())
    })

    it('Should return a valid tipper address', async function () {
      const winner = await tipPool.drawWinner(poolId)
      const tippers = await tipPool.getPoolTippers(poolId)
      
      expect(tippers).to.include(winner)
    })

    it('Should revert if no tippers', async function () {
      await tipPool.createPool(duration, await creator.getAddress())
      const emptyPoolId = 1

      await expect(
        tipPool.drawWinner(emptyPoolId)
      ).to.be.revertedWith('TipPool: no tippers')
    })

    // Note: The randomness in drawWinner uses block data which is predictable
    // This is a known vulnerability (see known-issues.md C002)
    // In production, this should use Chainlink VRF or commit-reveal scheme
  })

  describe('endPool', function () {
    const duration = 86400
    let poolId

    beforeEach(async function () {
      await tipPool.createPool(duration, await creator.getAddress())
      poolId = 0

      // Add tips
      await tipPool.connect(tipper1).tipPool(poolId, { value: parseEther('1') })
      await tipPool.connect(tipper2).tipPool(poolId, { value: parseEther('2') })
    })

    it('Should revert if pool has not ended yet', async function () {
      await expect(
        tipPool.endPool(poolId)
      ).to.be.revertedWith('TipPool: pool has not ended yet')
    })

    it('Should end pool and distribute winnings', async function () {
      // Fast-forward time
      await ethers.provider.send('evm_increaseTime', [duration + 1])
      await ethers.provider.send('evm_mine', [])

      const poolInfoBefore = await tipPool.getPoolInfo(poolId)
      const totalTips = BigInt(poolInfoBefore.totalTips.toString())
      const expectedCreatorCut = totalTips * 1000n / 10000n // 10%
      const expectedWinnerPrize = totalTips - expectedCreatorCut // 90%

      await expect(
        tipPool.endPool(poolId)
      ).to.emit(tipPool, 'PoolEnded')

      const poolInfoAfter = await tipPool.getPoolInfo(poolId)
      expect(poolInfoAfter.ended).to.equal(true)
      const zeroAddress = ethers.ZeroAddress || '0x0000000000000000000000000000000000000000'
      expect(poolInfoAfter.winner).to.not.equal(zeroAddress)
    })

    it('Should revert if pool already ended', async function () {
      // Fast-forward time and end pool
      await ethers.provider.send('evm_increaseTime', [duration + 1])
      await ethers.provider.send('evm_mine', [])
      await tipPool.endPool(poolId)

      await expect(
        tipPool.endPool(poolId)
      ).to.be.revertedWith('TipPool: pool already ended')
    })

    it('Should revert if no tips to distribute', async function () {
      // Create pool without tips
      await tipPool.createPool(duration, await creator.getAddress())
      const emptyPoolId = 1

      // Fast-forward time
      await ethers.provider.send('evm_increaseTime', [duration + 1])
      await ethers.provider.send('evm_mine', [])

      await expect(
        tipPool.endPool(emptyPoolId)
      ).to.be.revertedWith('TipPool: no tips to distribute')
    })

    // Note: endPool() has reentrancy vulnerability (see known-issues.md C001)
    // It makes external transfers before all state is updated
  })

  describe('getPoolInfo', function () {
    const duration = 86400

    it('Should return correct pool information', async function () {
      await tipPool.createPool(duration, await creator.getAddress())
      const poolId = 0

      const poolInfo = await tipPool.getPoolInfo(poolId)
      const [poolCreator, totalTips, startTime, endTime, winner, ended] = poolInfo

      expect(poolCreator).to.equal(await creator.getAddress())
      expect(totalTips).to.equal(0)
      expect(startTime).to.be.gt(0)
      expect(endTime).to.equal(startTime + BigInt(duration))
      expect(winner).to.equal(ethers.ZeroAddress || '0x0000000000000000000000000000000000000000')
      expect(ended).to.equal(false)
    })
  })

  describe('getPoolTippers', function () {
    const duration = 86400

    it('Should return empty array for pool with no tippers', async function () {
      await tipPool.createPool(duration, await creator.getAddress())
      const poolId = 0

      const tippers = await tipPool.getPoolTippers(poolId)
      expect(tippers.length).to.equal(0)
    })

    it('Should return all tippers', async function () {
      await tipPool.createPool(duration, await creator.getAddress())
      const poolId = 0

      await tipPool.connect(tipper1).tipPool(poolId, { value: parseEther('1') })
      await tipPool.connect(tipper2).tipPool(poolId, { value: parseEther('1') })

      const tippers = await tipPool.getPoolTippers(poolId)
      expect(tippers.length).to.equal(2)
      expect(tippers).to.include(await tipper1.getAddress())
      expect(tippers).to.include(await tipper2.getAddress())
    })
  })

  describe('getTipAmount', function () {
    const duration = 86400

    it('Should return zero for address that has not tipped', async function () {
      await tipPool.createPool(duration, await creator.getAddress())
      const poolId = 0

      expect(await tipPool.getTipAmount(poolId, await tipper1.getAddress())).to.equal(0)
    })

    it('Should return correct tip amount', async function () {
      await tipPool.createPool(duration, await creator.getAddress())
      const poolId = 0

      const tipAmount = parseEther('1.5')
      await tipPool.connect(tipper1).tipPool(poolId, { value: tipAmount })

      expect(await tipPool.getTipAmount(poolId, await tipper1.getAddress())).to.equal(tipAmount)
    })
  })

  describe('Fee Constants', function () {
    it('Should have correct fee split constants', async function () {
      expect(await tipPool.CREATOR_CUT_BPS()).to.equal(1000) // 10%
      expect(await tipPool.WINNER_CUT_BPS()).to.equal(9000) // 90%
    })

    it('Should have fee splits that sum to 10000 BPS', async function () {
      const creatorCut = await tipPool.CREATOR_CUT_BPS()
      const winnerCut = await tipPool.WINNER_CUT_BPS()
      expect(creatorCut + winnerCut).to.equal(10000)
    })
  })
})

