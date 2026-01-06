// Test file for YieldOptimizer contract
// Run with: npx hardhat test test/YieldOptimizer.test.cjs

const { expect } = require('chai')
const { ethers } = require('hardhat')

describe('YieldOptimizer', function () {
  let yieldOptimizer
  let owner, addr1, addr2
  let mockToken1, mockToken2, mockToken3
  let mockOracle1, mockOracle2, mockOracle3

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners()

    // Deploy YieldOptimizer
    const YieldOptimizer = await ethers.getContractFactory('YieldOptimizer')
    yieldOptimizer = await YieldOptimizer.deploy()
    await yieldOptimizer.waitForDeployment()

    // Deploy mock ERC20 tokens
    const MockERC20 = await ethers.getContractFactory('MockERC20')
    mockToken1 = await MockERC20.deploy('stkTIA', 'stkTIA', 18)
    mockToken2 = await MockERC20.deploy('stkXPRT', 'stkXPRT', 18)
    mockToken3 = await MockERC20.deploy('stkATOM', 'stkATOM', 18)
    await mockToken1.waitForDeployment()
    await mockToken2.waitForDeployment()
    await mockToken3.waitForDeployment()

    // Deploy mock Chainlink oracles (simplified - in production use actual Chainlink contracts)
    const MockChainlinkOracle = await ethers.getContractFactory('MockChainlinkAggregator')
    mockOracle1 = await MockChainlinkOracle.deploy(8, 15000000000) // 15% APY in 8 decimals
    mockOracle2 = await MockChainlinkOracle.deploy(8, 18000000000) // 18% APY
    mockOracle3 = await MockChainlinkOracle.deploy(8, 12000000000) // 12% APY
    await mockOracle1.waitForDeployment()
    await mockOracle2.waitForDeployment()
    await mockOracle3.waitForDeployment()
  })

  describe('Deployment', function () {
    it('Should deploy with correct owner', async function () {
      expect(await yieldOptimizer.owner()).to.equal(owner.address)
    })

    it('Should start with no active LSTs', async function () {
      const [symbols, apys, tokens] = await yieldOptimizer.getAllYieldSources()
      expect(symbols.length).to.equal(0)
      expect(apys.length).to.equal(0)
      expect(tokens.length).to.equal(0)
    })
  })

  describe('Adding Yield Sources', function () {
    it('Should add a yield source successfully', async function () {
      await expect(
        yieldOptimizer.addYieldSource(
          'stkTIA',
          await mockToken1.getAddress(),
          await mockOracle1.getAddress(),
          ethers.parseEther('10000')
        )
      ).to.emit(yieldOptimizer, 'YieldSourceAdded')

      const [symbols, apys, tokens] = await yieldOptimizer.getAllYieldSources()
      expect(symbols.length).to.equal(1)
      expect(symbols[0]).to.equal('stkTIA')
    })

    it('Should not allow non-owner to add yield source', async function () {
      await expect(
        yieldOptimizer.connect(addr1).addYieldSource(
          'stkTIA',
          await mockToken1.getAddress(),
          await mockOracle1.getAddress(),
          ethers.parseEther('10000')
        )
      ).to.be.revertedWith('Ownable: caller is not the owner')
    })

    it('Should not add duplicate yield source', async function () {
      await yieldOptimizer.addYieldSource(
        'stkTIA',
        await mockToken1.getAddress(),
        await mockOracle1.getAddress(),
        ethers.parseEther('10000')
      )

      await expect(
        yieldOptimizer.addYieldSource(
          'stkTIA',
          await mockToken1.getAddress(),
          await mockOracle1.getAddress(),
          ethers.parseEther('10000')
        )
      ).to.be.revertedWith('YieldOptimizer: source already exists')
    })

    it('Should not add yield source with zero address token', async function () {
      await expect(
        yieldOptimizer.addYieldSource(
          'stkTIA',
          ethers.ZeroAddress,
          await mockOracle1.getAddress(),
          ethers.parseEther('10000')
        )
      ).to.be.revertedWith('YieldOptimizer: invalid token')
    })

    it('Should not add yield source with zero address oracle', async function () {
      await expect(
        yieldOptimizer.addYieldSource(
          'stkTIA',
          await mockToken1.getAddress(),
          ethers.ZeroAddress,
          ethers.parseEther('10000')
        )
      ).to.be.revertedWith('YieldOptimizer: invalid oracle')
    })
  })

  describe('Getting Best Yield Source', function () {
    beforeEach(async function () {
      // Add multiple yield sources
      await yieldOptimizer.addYieldSource(
        'stkTIA',
        await mockToken1.getAddress(),
        await mockOracle1.getAddress(),
        ethers.parseEther('10000')
      )
      await yieldOptimizer.addYieldSource(
        'stkXPRT',
        await mockToken2.getAddress(),
        await mockOracle2.getAddress(),
        ethers.parseEther('5000')
      )
      await yieldOptimizer.addYieldSource(
        'stkATOM',
        await mockToken3.getAddress(),
        await mockOracle3.getAddress(),
        ethers.parseEther('8000')
      )
    })

    it('Should return the yield source with highest APY', async function () {
      const [bestLST, bestAPY] = await yieldOptimizer.getBestYieldSource()
      expect(bestLST).to.equal('stkXPRT') // 18% APY is highest
      expect(bestAPY).to.be.gt(0)
    })

    it('Should get all yield sources', async function () {
      const [symbols, apys, tokens] = await yieldOptimizer.getAllYieldSources()
      expect(symbols.length).to.equal(3)
      expect(symbols).to.include('stkTIA')
      expect(symbols).to.include('stkXPRT')
      expect(symbols).to.include('stkATOM')
    })
  })

  describe('Updating Yield Sources', function () {
    beforeEach(async function () {
      await yieldOptimizer.addYieldSource(
        'stkTIA',
        await mockToken1.getAddress(),
        await mockOracle1.getAddress(),
        ethers.parseEther('10000')
      )
    })

    it('Should update yield source configuration', async function () {
      await expect(
        yieldOptimizer.updateYieldSource('stkTIA', ethers.parseEther('20000'))
      ).to.emit(yieldOptimizer, 'YieldSourceUpdated')
    })

    it('Should not update non-existent yield source', async function () {
      await expect(
        yieldOptimizer.updateYieldSource('stkNonExistent', ethers.parseEther('20000'))
      ).to.be.revertedWith('YieldOptimizer: source not active')
    })
  })

  describe('Removing Yield Sources', function () {
    beforeEach(async function () {
      await yieldOptimizer.addYieldSource(
        'stkTIA',
        await mockToken1.getAddress(),
        await mockOracle1.getAddress(),
        ethers.parseEther('10000')
      )
    })

    it('Should remove yield source', async function () {
      await expect(yieldOptimizer.removeYieldSource('stkTIA')).to.emit(
        yieldOptimizer,
        'YieldSourceRemoved'
      )

      const [symbols] = await yieldOptimizer.getAllYieldSources()
      expect(symbols.length).to.equal(0)
    })

    it('Should not remove non-existent yield source', async function () {
      await expect(yieldOptimizer.removeYieldSource('stkNonExistent')).to.be.revertedWith(
        'YieldOptimizer: source not active'
      )
    })
  })

  describe('Rebalancing Logic', function () {
    beforeEach(async function () {
      await yieldOptimizer.addYieldSource(
        'stkTIA',
        await mockToken1.getAddress(),
        await mockOracle1.getAddress(),
        ethers.parseEther('10000')
      )
      await yieldOptimizer.addYieldSource(
        'stkXPRT',
        await mockToken2.getAddress(),
        await mockOracle2.getAddress(),
        ethers.parseEther('5000')
      )
    })

    it('Should recommend rebalancing when APY difference is significant', async function () {
      const [shouldRebalance, targetLST, apyGain] = await yieldOptimizer.shouldRebalance('stkTIA')
      expect(shouldRebalance).to.be.true
      expect(targetLST).to.equal('stkXPRT')
      expect(apyGain).to.be.gt(0)
    })

    it('Should allow setting minimum APY difference for rebalance', async function () {
      await yieldOptimizer.setMinAPYDifferenceForRebalance(500) // 5%
      const minDiff = await yieldOptimizer.minAPYDifferenceForRebalance()
      expect(minDiff).to.equal(500)
    })

    it('Should not allow setting too high APY difference', async function () {
      await expect(yieldOptimizer.setMinAPYDifferenceForRebalance(1500)).to.be.revertedWith(
        'YieldOptimizer: difference too large'
      )
    })
  })

  describe('Getting APY', function () {
    beforeEach(async function () {
      await yieldOptimizer.addYieldSource(
        'stkTIA',
        await mockToken1.getAddress(),
        await mockOracle1.getAddress(),
        ethers.parseEther('10000')
      )
    })

    it('Should get APY for a specific LST', async function () {
      const [apy, isStale] = await yieldOptimizer.getAPY('stkTIA')
      expect(apy).to.be.gt(0)
      expect(isStale).to.be.false
    })

    it('Should not get APY for non-existent LST', async function () {
      await expect(yieldOptimizer.getAPY('stkNonExistent')).to.be.revertedWith(
        'YieldOptimizer: source not active'
      )
    })
  })
})

// Mock Chainlink Aggregator for testing
// This would be deployed separately in the test setup

