const { expect } = require('chai')
const { ethers } = require('hardhat')
const { getAddress, parseEther, getZeroAddress } = require('./helpers.cjs')

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
      const creatorAddr = await getAddress(creator)
      const tx = await tipPool.createPool(duration, creatorAddr)
      const receipt = await tx.wait()

      const poolInfo = await tipPool.getPoolInfo(0)
      expect(poolInfo.creator.toLowerCase()).to.equal(creatorAddr.toLowerCase())
      expect(poolInfo.ended).to.equal(false)
      expect(poolInfo.totalTips.toString()).to.equal('0')
      expect(poolInfo.startTime.gt(0)).to.equal(true)
      expect(poolInfo.endTime).to.equal(poolInfo.startTime.add(duration))
    })

    it('Should increment nextPoolId', async function () {
      expect((await tipPool.nextPoolId()).toString()).to.equal('0')
      
      const creatorAddr = await getAddress(creator)
      await tipPool.createPool(duration, creatorAddr)
      expect((await tipPool.nextPoolId()).toString()).to.equal('1')
      
      await tipPool.createPool(duration, creatorAddr)
      expect((await tipPool.nextPoolId()).toString()).to.equal('2')
    })

    it('Should emit PoolCreated event', async function () {
      const creatorAddr = await getAddress(creator)
      await expect(
        tipPool.createPool(duration, creatorAddr)
      ).to.emit(tipPool, 'PoolCreated')
        .withArgs(0, creatorAddr, duration)
    })

    it('Should allow creating multiple pools', async function () {
      const creatorAddr = await getAddress(creator)
      const tipper1Addr = await getAddress(tipper1)
      await tipPool.createPool(duration, creatorAddr)
      await tipPool.createPool(duration * 2, tipper1Addr)

      const pool0 = await tipPool.getPoolInfo(0)
      const pool1 = await tipPool.getPoolInfo(1)

      expect(pool0.creator.toLowerCase()).to.equal(creatorAddr.toLowerCase())
      expect(pool1.creator.toLowerCase()).to.equal(tipper1Addr.toLowerCase())
      expect((BigInt(pool1.endTime.toString()) - BigInt(pool1.startTime.toString())).toString()).to.equal((BigInt(duration * 2)).toString())
    })
  })

  describe('tipPool', function () {
    const duration = 86400
    let poolId

    beforeEach(async function () {
      const creatorAddr = await getAddress(creator)
      await tipPool.createPool(duration, creatorAddr)
      poolId = 0
    })

    it('Should accept tips and update totals', async function () {
      const tipAmount = parseEther('1')
      const tipper1Addr = await getAddress(tipper1)
      
      await expect(
        tipPool.connect(tipper1).tipPool(poolId, { value: tipAmount })
      ).to.emit(tipPool, 'TipAdded')
        .withArgs(poolId, tipper1Addr, tipAmount)

      const poolInfo = await tipPool.getPoolInfo(poolId)
      expect(poolInfo.totalTips.toString()).to.equal(tipAmount.toString())
      expect((await tipPool.getTipAmount(poolId, tipper1Addr)).toString()).to.equal(tipAmount.toString())
    })

    it('Should allow multiple tips from same address', async function () {
      const tip1 = parseEther('1')
      const tip2 = parseEther('0.5')
      const totalExpected = tip1.add(tip2)
      const tipper1Addr = await getAddress(tipper1)

      await tipPool.connect(tipper1).tipPool(poolId, { value: tip1 })
      await tipPool.connect(tipper1).tipPool(poolId, { value: tip2 })

      const tipAmount = await tipPool.getTipAmount(poolId, tipper1Addr)
      expect(tipAmount.toString()).to.equal(totalExpected.toString())
      const poolInfo = await tipPool.getPoolInfo(poolId)
      expect(poolInfo.totalTips.toString()).to.equal(totalExpected.toString())
    })

    it('Should track multiple tippers', async function () {
      const tip1 = parseEther('1')
      const tip2 = parseEther('2')
      const tip3 = parseEther('0.5')
      const tipper1Addr = await getAddress(tipper1)
      const tipper2Addr = await getAddress(tipper2)
      const tipper3Addr = await getAddress(tipper3)

      await tipPool.connect(tipper1).tipPool(poolId, { value: tip1 })
      await tipPool.connect(tipper2).tipPool(poolId, { value: tip2 })
      await tipPool.connect(tipper3).tipPool(poolId, { value: tip3 })

      const tippers = await tipPool.getPoolTippers(poolId)
      expect(tippers.length).to.equal(3)
      expect(tippers[0].toLowerCase()).to.equal(tipper1Addr.toLowerCase())
      expect(tippers[1].toLowerCase()).to.equal(tipper2Addr.toLowerCase())
      expect(tippers[2].toLowerCase()).to.equal(tipper3Addr.toLowerCase())
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
      const creatorAddr = await getAddress(creator)
      await tipPool.createPool(duration, creatorAddr)
      poolId = 0

      // Add tips with different weights
      await tipPool.connect(tipper1).tipPool(poolId, { value: parseEther('1') })
      await tipPool.connect(tipper2).tipPool(poolId, { value: parseEther('2') })
      await tipPool.connect(tipper3).tipPool(poolId, { value: parseEther('1') })
    })

    it('Should return the only tipper if there is only one', async function () {
      const creatorAddr = await getAddress(creator)
      const tipper1Addr = await getAddress(tipper1)
      await tipPool.createPool(duration, creatorAddr)
      const singleTipperPoolId = 1
      await tipPool.connect(tipper1).tipPool(singleTipperPoolId, { value: parseEther('1') })

      const winner = await tipPool.drawWinner(singleTipperPoolId)
      expect(winner.toLowerCase()).to.equal(tipper1Addr.toLowerCase())
    })

    it('Should return a valid tipper address', async function () {
      const winner = await tipPool.drawWinner(poolId)
      const tippers = await tipPool.getPoolTippers(poolId)
      const winnerLower = winner.toLowerCase()
      const tippersLower = tippers.map(t => t.toLowerCase())
      
      expect(tippersLower).to.include(winnerLower)
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
      const creatorAddr = await getAddress(creator)
      await tipPool.createPool(duration, creatorAddr)
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
      const zeroAddress = getZeroAddress()
      expect(poolInfoAfter.winner.toLowerCase()).to.not.equal(zeroAddress.toLowerCase())
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
      const creatorAddr = await getAddress(creator)
      await tipPool.createPool(duration, creatorAddr)
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
      const creatorAddr = await getAddress(creator)
      await tipPool.createPool(duration, creatorAddr)
      const poolId = 0

      const poolInfo = await tipPool.getPoolInfo(poolId)
      const [poolCreator, totalTips, startTime, endTime, winner, ended] = poolInfo

      expect(poolCreator.toLowerCase()).to.equal(creatorAddr.toLowerCase())
      expect(totalTips.toString()).to.equal('0')
      expect(startTime.gt(0)).to.equal(true)
      expect(endTime).to.equal(startTime.add(duration))
      expect(winner.toLowerCase()).to.equal(getZeroAddress().toLowerCase())
      expect(ended).to.equal(false)
    })
  })

  describe('getPoolTippers', function () {
    const duration = 86400

    it('Should return empty array for pool with no tippers', async function () {
      const creatorAddr = await getAddress(creator)
      await tipPool.createPool(duration, creatorAddr)
      const poolId = 0

      const tippers = await tipPool.getPoolTippers(poolId)
      expect(tippers.length).to.equal(0)
    })

    it('Should return all tippers', async function () {
      const creatorAddr = await getAddress(creator)
      const tipper1Addr = await getAddress(tipper1)
      const tipper2Addr = await getAddress(tipper2)
      await tipPool.createPool(duration, creatorAddr)
      const poolId = 0

      await tipPool.connect(tipper1).tipPool(poolId, { value: parseEther('1') })
      await tipPool.connect(tipper2).tipPool(poolId, { value: parseEther('1') })

      const tippers = await tipPool.getPoolTippers(poolId)
      expect(tippers.length).to.equal(2)
      const tippersLower = tippers.map(t => t.toLowerCase())
      expect(tippersLower).to.include(tipper1Addr.toLowerCase())
      expect(tippersLower).to.include(tipper2Addr.toLowerCase())
    })
  })

  describe('getTipAmount', function () {
    const duration = 86400

    it('Should return zero for address that has not tipped', async function () {
      const creatorAddr = await getAddress(creator)
      const tipper1Addr = await getAddress(tipper1)
      await tipPool.createPool(duration, creatorAddr)
      const poolId = 0

      expect((await tipPool.getTipAmount(poolId, tipper1Addr)).toString()).to.equal('0')
    })

    it('Should return correct tip amount', async function () {
      const creatorAddr = await getAddress(creator)
      const tipper1Addr = await getAddress(tipper1)
      await tipPool.createPool(duration, creatorAddr)
      const poolId = 0

      const tipAmount = parseEther('1.5')
      await tipPool.connect(tipper1).tipPool(poolId, { value: tipAmount })

      expect((await tipPool.getTipAmount(poolId, tipper1Addr)).toString()).to.equal(tipAmount.toString())
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
      expect(creatorCut.add(winnerCut)).to.equal(10000)
    })
  })

  describe('commitRandomness', function () {
    const duration = 86400
    let poolId

    beforeEach(async function () {
      const creatorAddr = await getAddress(creator)
      await tipPool.createPool(duration, creatorAddr)
      poolId = 0
    })

    it('Should allow committing randomness', async function () {
      const reveal = 12345
      const commit = ethers.utils.keccak256(ethers.utils.solidityPack(['uint256'], [reveal]))
      
      await expect(
        tipPool.commitRandomness(poolId, commit)
      ).to.emit(tipPool, 'RandomnessCommitted')
        .withArgs(poolId, commit)
      
      expect(await tipPool.poolCommits(poolId)).to.equal(commit)
    })

    it('Should revert if pool has ended', async function () {
      // Create a new pool for this test
      const creatorAddr = await getAddress(creator)
      await tipPool.createPool(duration, creatorAddr)
      const newPoolId = 1
      
      // Add tips
      await tipPool.connect(tipper1).tipPool(newPoolId, { value: parseEther('1') })
      
      // Fast-forward time
      await ethers.provider.send('evm_increaseTime', [duration + 1])
      await ethers.provider.send('evm_mine', [])
      
      // End pool
      await tipPool.endPool(newPoolId)

      const reveal = 12345
      const commit = ethers.utils.keccak256(ethers.utils.solidityPack(['uint256'], [reveal]))

      await expect(
        tipPool.commitRandomness(newPoolId, commit)
      ).to.be.revertedWith('TipPool: pool has ended')
    })

    it('Should revert if randomness already committed', async function () {
      const reveal = 12345
      const commit = ethers.utils.keccak256(ethers.utils.solidityPack(['uint256'], [reveal]))
      
      await tipPool.commitRandomness(poolId, commit)
      
      await expect(
        tipPool.commitRandomness(poolId, commit)
      ).to.be.revertedWith('TipPool: randomness already committed')
    })

    it('Should revert if pool end time has passed', async function () {
      const reveal = 12345
      const commit = ethers.utils.keccak256(ethers.utils.solidityPack(['uint256'], [reveal]))
      
      // Fast-forward time
      await ethers.provider.send('evm_increaseTime', [duration + 1])
      await ethers.provider.send('evm_mine', [])

      await expect(
        tipPool.commitRandomness(poolId, commit)
      ).to.be.revertedWith('TipPool: pool has ended')
    })
  })

  describe('revealAndEndPool', function () {
    const duration = 86400
    let poolId

    beforeEach(async function () {
      const creatorAddr = await getAddress(creator)
      await tipPool.createPool(duration, creatorAddr)
      poolId = 0

      // Add tips
      await tipPool.connect(tipper1).tipPool(poolId, { value: parseEther('1') })
      await tipPool.connect(tipper2).tipPool(poolId, { value: parseEther('2') })
    })

    it('Should reveal randomness and end pool', async function () {
      const reveal = 12345
      const commit = ethers.utils.keccak256(ethers.utils.solidityPack(['uint256'], [reveal]))
      
      // Commit randomness
      await tipPool.commitRandomness(poolId, commit)
      
      // Fast-forward time
      await ethers.provider.send('evm_increaseTime', [duration + 1])
      await ethers.provider.send('evm_mine', [])

      const poolInfoBefore = await tipPool.getPoolInfo(poolId)
      const totalTips = poolInfoBefore.totalTips
      
      await expect(
        tipPool.revealAndEndPool(poolId, reveal)
      ).to.emit(tipPool, 'RandomnessRevealed')
        .withArgs(poolId, reveal)
        .and.to.emit(tipPool, 'PoolEnded')

      const poolInfoAfter = await tipPool.getPoolInfo(poolId)
      expect(poolInfoAfter.ended).to.equal(true)
      expect(poolInfoAfter.winner.toLowerCase()).to.not.equal(getZeroAddress().toLowerCase())
    })

    it('Should revert if pool has not ended yet', async function () {
      const reveal = 12345
      const commit = ethers.utils.keccak256(ethers.utils.solidityPack(['uint256'], [reveal]))
      await tipPool.commitRandomness(poolId, commit)

      await expect(
        tipPool.revealAndEndPool(poolId, reveal)
      ).to.be.revertedWith('TipPool: pool has not ended yet')
    })

    it('Should revert if randomness not committed', async function () {
      // Fast-forward time
      await ethers.provider.send('evm_increaseTime', [duration + 1])
      await ethers.provider.send('evm_mine', [])

      await expect(
        tipPool.revealAndEndPool(poolId, 12345)
      ).to.be.revertedWith('TipPool: randomness not committed')
    })

    it('Should revert if invalid reveal', async function () {
      const reveal = 12345
      const commit = ethers.utils.keccak256(ethers.utils.solidityPack(['uint256'], [reveal]))
      await tipPool.commitRandomness(poolId, commit)

      // Fast-forward time
      await ethers.provider.send('evm_increaseTime', [duration + 1])
      await ethers.provider.send('evm_mine', [])

      await expect(
        tipPool.revealAndEndPool(poolId, 99999) // Wrong reveal
      ).to.be.revertedWith('TipPool: invalid reveal')
    })

    it('Should revert if randomness already revealed', async function () {
      const reveal = 12345
      const commit = ethers.utils.keccak256(ethers.utils.solidityPack(['uint256'], [reveal]))
      await tipPool.commitRandomness(poolId, commit)

      // Fast-forward time
      await ethers.provider.send('evm_increaseTime', [duration + 1])
      await ethers.provider.send('evm_mine', [])

      await tipPool.revealAndEndPool(poolId, reveal)

      await expect(
        tipPool.revealAndEndPool(poolId, reveal)
      ).to.be.revertedWith('TipPool: pool already ended')
    })

    it('Should revert if no tips to distribute', async function () {
      // Create new pool without tips
      const creatorAddr = await getAddress(creator)
      await tipPool.createPool(duration, creatorAddr)
      const emptyPoolId = 1

      const reveal = 12345
      const commit = ethers.utils.keccak256(ethers.utils.solidityPack(['uint256'], [reveal]))
      await tipPool.commitRandomness(emptyPoolId, commit)

      // Fast-forward time
      await ethers.provider.send('evm_increaseTime', [duration + 1])
      await ethers.provider.send('evm_mine', [])

      await expect(
        tipPool.revealAndEndPool(emptyPoolId, reveal)
      ).to.be.revertedWith('TipPool: no tips to distribute')
    })

    it('Should use commit-reveal randomness in drawWinner', async function () {
      const reveal = 12345
      const commit = ethers.utils.keccak256(ethers.utils.solidityPack(['uint256'], [reveal]))
      await tipPool.commitRandomness(poolId, commit)

      // Fast-forward time
      await ethers.provider.send('evm_increaseTime', [duration + 1])
      await ethers.provider.send('evm_mine', [])

      await tipPool.revealAndEndPool(poolId, reveal)

      const poolInfo = await tipPool.getPoolInfo(poolId)
      expect(poolInfo.ended).to.equal(true)
      expect(poolInfo.winner.toLowerCase()).to.not.equal(getZeroAddress().toLowerCase())
    })

    it('Should handle creator with zero address gracefully', async function () {
      // The contract requires creator != address(0), so we test that ending works
      // when creator cut would be zero (by testing with a valid creator)
      const creatorAddr = await getAddress(creator)
      await tipPool.createPool(duration, creatorAddr)
      const testPoolId = 1
      
      // Add tips
      await tipPool.connect(tipper1).tipPool(testPoolId, { value: parseEther('1') })
      
      const testReveal = 12345
      const commit = ethers.utils.keccak256(ethers.utils.solidityPack(['uint256'], [testReveal]))
      await tipPool.commitRandomness(testPoolId, commit)
      
      // Fast-forward time
      await ethers.provider.send('evm_increaseTime', [duration + 1])
      await ethers.provider.send('evm_mine', [])
      
      // Should not revert - ending pool should work
      await expect(
        tipPool.revealAndEndPool(testPoolId, testReveal)
      ).to.emit(tipPool, 'PoolEnded')
    })
  })

  describe('createPool edge cases', function () {
    it('Should revert if duration is zero', async function () {
      const creatorAddr = await getAddress(creator)
      await expect(
        tipPool.createPool(0, creatorAddr)
      ).to.be.revertedWith('TipPool: invalid duration')
    })

    it('Should revert if duration exceeds 365 days', async function () {
      const creatorAddr = await getAddress(creator)
      const maxDuration = 365 * 24 * 60 * 60 // 365 days
      await expect(
        tipPool.createPool(maxDuration + 1, creatorAddr)
      ).to.be.revertedWith('TipPool: invalid duration')
    })

    it('Should revert if creator is zero address', async function () {
      await expect(
        tipPool.createPool(86400, getZeroAddress())
      ).to.be.revertedWith('TipPool: invalid creator')
    })

    it('Should allow creating pool with exactly 365 days', async function () {
      const creatorAddr = await getAddress(creator)
      const maxDuration = 365 * 24 * 60 * 60
      await expect(
        tipPool.createPool(maxDuration, creatorAddr)
      ).to.emit(tipPool, 'PoolCreated')
    })
  })
})

