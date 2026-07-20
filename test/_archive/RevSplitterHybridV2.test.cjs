const { expect } = require('chai')
const { ethers } = require('hardhat')
const hre = require('hardhat')
const { getAddress, parseUnits } = require('../helpers.cjs')

describe('RevSplitterHybridV2', function () {
  let revSplitter
  let bbbContract
  let veXFDistributor
  let treasury
  let axelarAdapter
  let governanceRecipient
  let owner, user1, user2

  const TREASURY_ADDR = '0x043d5231651379970d52a13CEfB4e80733DDb989'
  const LP_TREASURY_ADDR = 'persistence1q50x9h4nchk2uhhj5jre0jsqxrs9qmhvjwf8yj'

  // Helper to parse TFUEL (18 decimals)
  const parseTFUEL = (value) => ethers.parseEther(value.toString())

  beforeEach(async function () {
    await hre.network.provider.request({
      method: 'hardhat_reset',
      params: []
    })

    ;[owner, user1, user2, bbbContract, veXFDistributor, treasury, axelarAdapter, governanceRecipient] = await ethers.getSigners()

    // Deploy RevSplitterHybridV2
    const RevSplitterHybridV2 = await ethers.getContractFactory('RevSplitterHybridV2')
    revSplitter = await RevSplitterHybridV2.deploy(
      await getAddress(treasury),
      LP_TREASURY_ADDR,
      await getAddress(bbbContract),
      await getAddress(veXFDistributor),
      await getAddress(owner)
    )
    await (revSplitter.waitForDeployment?.() || revSplitter.deployed?.())
  })

  afterEach(async function () {
    await hre.network.provider.request({
      method: 'hardhat_reset',
      params: []
    })
  })

  describe('Deployment', function () {
    it('Should initialize with correct addresses', async function () {
      expect(await revSplitter.treasuryAddr()).to.equal(await getAddress(treasury))
      expect(await revSplitter.lpTreasuryAddr()).to.equal(LP_TREASURY_ADDR)
      expect(await revSplitter.bbbContract()).to.equal(await getAddress(bbbContract))
      expect(await revSplitter.veXFYieldsDistributor()).to.equal(await getAddress(veXFDistributor))
      expect(await revSplitter.owner()).to.equal(await getAddress(owner))
    })

    it('Should initialize with zero totals', async function () {
      expect(await revSplitter.totalRevenueCollected()).to.equal(0)
      expect(await revSplitter.totalBBBAllocated()).to.equal(0)
      expect(await revSplitter.totalLPFundingAllocated()).to.equal(0)
      expect(await revSplitter.totalVeXFYieldsAllocated()).to.equal(0)
      expect(await revSplitter.totalTreasuryAllocated()).to.equal(0)
      expect(await revSplitter.totalGovernanceDiverted()).to.equal(0)
    })

    it('Should initialize with governance hook disabled', async function () {
      const [diversionBps, recipient, active, purpose] = await revSplitter.getGovernanceHookConfig()
      expect(diversionBps).to.equal(0)
      expect(active).to.equal(false)
      expect(purpose).to.equal('')
    })

    it('Should revert if initialized with zero addresses', async function () {
      const RevSplitterHybridV2 = await ethers.getContractFactory('RevSplitterHybridV2')
      
      await expect(
        RevSplitterHybridV2.deploy(
          ethers.ZeroAddress,
          LP_TREASURY_ADDR,
          await getAddress(bbbContract),
          await getAddress(veXFDistributor),
          await getAddress(owner)
        )
      ).to.be.revertedWith('Invalid treasury')

      await expect(
        RevSplitterHybridV2.deploy(
          await getAddress(treasury),
          '',
          await getAddress(bbbContract),
          await getAddress(veXFDistributor),
          await getAddress(owner)
        )
      ).to.be.revertedWith('Invalid LP treasury address')

      await expect(
        RevSplitterHybridV2.deploy(
          await getAddress(treasury),
          LP_TREASURY_ADDR,
          ethers.ZeroAddress,
          await getAddress(veXFDistributor),
          await getAddress(owner)
        )
      ).to.be.revertedWith('Invalid BBB contract')

      await expect(
        RevSplitterHybridV2.deploy(
          await getAddress(treasury),
          LP_TREASURY_ADDR,
          await getAddress(bbbContract),
          ethers.ZeroAddress,
          await getAddress(owner)
        )
      ).to.be.revertedWith('Invalid veXF distributor')
    })
  })

  describe('TFUEL Auto-Split via receive()', function () {
    it('Should split TFUEL correctly (30/30/25/15) via direct transfer', async function () {
      const tfuelAmount = parseTFUEL('1000') // 1,000 TFUEL

      // Get balances before
      const bbbBalanceBefore = await ethers.provider.getBalance(await getAddress(bbbContract))
      const veXFBalanceBefore = await ethers.provider.getBalance(await getAddress(veXFDistributor))
      const treasuryBalanceBefore = await ethers.provider.getBalance(await getAddress(treasury))

      // Send TFUEL to contract (triggers receive())
      const tx = await user1.sendTransaction({
        to: await getAddress(revSplitter),
        value: tfuelAmount
      })
      const receipt = await tx.wait()

      // Check events
      const tfuelReceivedEvent = receipt.logs.find(log => {
        try {
          const parsed = revSplitter.interface.parseLog(log)
          return parsed && parsed.name === 'TFUELReceived'
        } catch {
          return false
        }
      })
      expect(tfuelReceivedEvent).to.not.be.undefined

      const revenueSplitEvent = receipt.logs.find(log => {
        try {
          const parsed = revSplitter.interface.parseLog(log)
          return parsed && parsed.name === 'RevenueSplit'
        } catch {
          return false
        }
      })
      expect(revenueSplitEvent).to.not.be.undefined

      // Check totals
      expect(await revSplitter.totalRevenueCollected()).to.equal(tfuelAmount)
      
      // 30% BBB = 300 TFUEL
      expect(await revSplitter.totalBBBAllocated()).to.equal(parseTFUEL('300'))
      const bbbBalanceAfter = await ethers.provider.getBalance(await getAddress(bbbContract))
      expect(bbbBalanceAfter - bbbBalanceBefore).to.equal(parseTFUEL('300'))
      
      // 30% LP Funding = 300 TFUEL (held in contract since no bridge adapter)
      expect(await revSplitter.totalLPFundingAllocated()).to.equal(parseTFUEL('300'))
      expect(await revSplitter.getPendingLPFunding()).to.equal(parseTFUEL('300'))
      
      // 25% veXF Yields = 250 TFUEL
      expect(await revSplitter.totalVeXFYieldsAllocated()).to.equal(parseTFUEL('250'))
      const veXFBalanceAfter = await ethers.provider.getBalance(await getAddress(veXFDistributor))
      expect(veXFBalanceAfter - veXFBalanceBefore).to.equal(parseTFUEL('250'))
      
      // 15% Treasury = 150 TFUEL
      expect(await revSplitter.totalTreasuryAllocated()).to.equal(parseTFUEL('150'))
      const treasuryBalanceAfter = await ethers.provider.getBalance(await getAddress(treasury))
      expect(treasuryBalanceAfter - treasuryBalanceBefore).to.equal(parseTFUEL('150'))
    })

    it('Should split TFUEL via explicit splitTFUELRevenue() call', async function () {
      const tfuelAmount = parseTFUEL('5000')

      const tx = await revSplitter.connect(user1).splitTFUELRevenue({ value: tfuelAmount })
      await tx.wait()

      expect(await revSplitter.totalRevenueCollected()).to.equal(tfuelAmount)
      expect(await revSplitter.totalBBBAllocated()).to.equal(parseTFUEL('1500')) // 30%
      expect(await revSplitter.totalLPFundingAllocated()).to.equal(parseTFUEL('1500')) // 30%
      expect(await revSplitter.totalVeXFYieldsAllocated()).to.equal(parseTFUEL('1250')) // 25%
      expect(await revSplitter.totalTreasuryAllocated()).to.equal(parseTFUEL('750')) // 15%
    })

    it('Should split TFUEL with Axelar bridge adapter', async function () {
      // Set Axelar bridge adapter
      await revSplitter.setAxelarBridgeAdapter(await getAddress(axelarAdapter))

      const tfuelAmount = parseTFUEL('1000')
      const axelarBalanceBefore = await ethers.provider.getBalance(await getAddress(axelarAdapter))

      await user1.sendTransaction({
        to: await getAddress(revSplitter),
        value: tfuelAmount
      })

      // LP funding should go to Axelar adapter
      const axelarBalanceAfter = await ethers.provider.getBalance(await getAddress(axelarAdapter))
      expect(axelarBalanceAfter - axelarBalanceBefore).to.equal(parseTFUEL('300'))
      
      // Contract should not hold LP funding
      expect(await revSplitter.getPendingLPFunding()).to.equal(0)
    })

    it('Should handle rounding correctly', async function () {
      const tfuelAmount = parseTFUEL('1') // 1 TFUEL (to test rounding)
      
      await user1.sendTransaction({
        to: await getAddress(revSplitter),
        value: tfuelAmount
      })

      // Total should equal original amount (remainder goes to veXF)
      const totalBBB = await revSplitter.totalBBBAllocated()
      const totalLP = await revSplitter.totalLPFundingAllocated()
      const totalVeXF = await revSplitter.totalVeXFYieldsAllocated()
      const totalTreasury = await revSplitter.totalTreasuryAllocated()
      
      const sum = totalBBB + totalLP + totalVeXF + totalTreasury
      expect(sum).to.equal(tfuelAmount)
    })

    it('Should handle multiple TFUEL deposits', async function () {
      await user1.sendTransaction({
        to: await getAddress(revSplitter),
        value: parseTFUEL('1000')
      })

      await user2.sendTransaction({
        to: await getAddress(revSplitter),
        value: parseTFUEL('2000')
      })

      expect(await revSplitter.totalRevenueCollected()).to.equal(parseTFUEL('3000'))
      expect(await revSplitter.totalBBBAllocated()).to.equal(parseTFUEL('900')) // 30% of 3000
    })

    it('Should revert if amount is zero', async function () {
      await expect(
        user1.sendTransaction({
          to: await getAddress(revSplitter),
          value: 0
        })
      ).to.be.revertedWith('Amount must be > 0')
    })
  })

  describe('Governance Hook', function () {
    it('Should configure governance hook correctly', async function () {
      const diversionBps = 500 // 5%
      const purpose = 'NFT Milestone Rewards Q1 2026'
      
      const tx = await revSplitter.configureGovernanceHook(
        diversionBps,
        await getAddress(governanceRecipient),
        true,
        purpose
      )
      const receipt = await tx.wait()

      // Check event
      const event = receipt.logs.find(log => {
        try {
          const parsed = revSplitter.interface.parseLog(log)
          return parsed && parsed.name === 'GovernanceHookConfigured'
        } catch {
          return false
        }
      })
      expect(event).to.not.be.undefined

      const [diversionBpsOut, recipient, active, purposeOut] = await revSplitter.getGovernanceHookConfig()
      expect(diversionBpsOut).to.equal(diversionBps)
      expect(recipient).to.equal(await getAddress(governanceRecipient))
      expect(active).to.equal(true)
      expect(purposeOut).to.equal(purpose)
    })

    it('Should apply governance diversion from LP slice (5%)', async function () {
      // Configure 5% diversion
      await revSplitter.configureGovernanceHook(
        500, // 5%
        await getAddress(governanceRecipient),
        true,
        'NFT wallet rewards on milestones'
      )

      const tfuelAmount = parseTFUEL('1000')
      const governanceBalanceBefore = await ethers.provider.getBalance(await getAddress(governanceRecipient))

      await user1.sendTransaction({
        to: await getAddress(revSplitter),
        value: tfuelAmount
      })

      // LP Funding = 30% of 1000 = 300 TFUEL
      // Governance gets 5% of 300 = 15 TFUEL
      // LP Funding gets 285 TFUEL
      const governanceBalanceAfter = await ethers.provider.getBalance(await getAddress(governanceRecipient))
      expect(governanceBalanceAfter - governanceBalanceBefore).to.equal(parseTFUEL('15'))
      
      expect(await revSplitter.totalGovernanceDiverted()).to.equal(parseTFUEL('15'))
      expect(await revSplitter.totalLPFundingAllocated()).to.equal(parseTFUEL('285'))
    })

    it('Should apply governance diversion from LP slice (10%)', async function () {
      // Configure 10% diversion (maximum)
      await revSplitter.configureGovernanceHook(
        1000, // 10%
        await getAddress(governanceRecipient),
        true,
        'Maximum diversion for special initiative'
      )

      const tfuelAmount = parseTFUEL('1000')
      const governanceBalanceBefore = await ethers.provider.getBalance(await getAddress(governanceRecipient))

      await user1.sendTransaction({
        to: await getAddress(revSplitter),
        value: tfuelAmount
      })

      // LP Funding = 30% of 1000 = 300 TFUEL
      // Governance gets 10% of 300 = 30 TFUEL
      // LP Funding gets 270 TFUEL
      const governanceBalanceAfter = await ethers.provider.getBalance(await getAddress(governanceRecipient))
      expect(governanceBalanceAfter - governanceBalanceBefore).to.equal(parseTFUEL('30'))
      
      expect(await revSplitter.totalGovernanceDiverted()).to.equal(parseTFUEL('30'))
      expect(await revSplitter.totalLPFundingAllocated()).to.equal(parseTFUEL('270'))
    })

    it('Should not apply diversion when hook is inactive', async function () {
      // Configure but leave inactive
      await revSplitter.configureGovernanceHook(
        500, // 5%
        await getAddress(governanceRecipient),
        false, // inactive
        'Inactive for now'
      )

      const tfuelAmount = parseTFUEL('1000')
      const governanceBalanceBefore = await ethers.provider.getBalance(await getAddress(governanceRecipient))

      await user1.sendTransaction({
        to: await getAddress(revSplitter),
        value: tfuelAmount
      })

      // No diversion should occur
      const governanceBalanceAfter = await ethers.provider.getBalance(await getAddress(governanceRecipient))
      expect(governanceBalanceAfter).to.equal(governanceBalanceBefore)
      
      expect(await revSplitter.totalGovernanceDiverted()).to.equal(0)
      expect(await revSplitter.totalLPFundingAllocated()).to.equal(parseTFUEL('300'))
    })

    it('Should revert if diversion exceeds maximum', async function () {
      await expect(
        revSplitter.configureGovernanceHook(
          1001, // 10.01% - exceeds max
          await getAddress(governanceRecipient),
          true,
          'Too high'
        )
      ).to.be.revertedWith('Diversion too high')
    })

    it('Should revert if diversion below minimum when active', async function () {
      await expect(
        revSplitter.configureGovernanceHook(
          499, // 4.99% - below min
          await getAddress(governanceRecipient),
          true,
          'Too low'
        )
      ).to.be.revertedWith('Diversion too low')
    })

    it('Should revert if recipient is zero when active', async function () {
      await expect(
        revSplitter.configureGovernanceHook(
          500,
          ethers.ZeroAddress,
          true,
          'Invalid recipient'
        )
      ).to.be.revertedWith('Invalid recipient')
    })

    it('Should revert if purpose is empty when active', async function () {
      await expect(
        revSplitter.configureGovernanceHook(
          500,
          await getAddress(governanceRecipient),
          true,
          '' // Empty purpose
        )
      ).to.be.revertedWith('Purpose required')
    })

    it('Should allow inactive hook with invalid recipient', async function () {
      // Should not revert when inactive, even with invalid recipient
      await revSplitter.configureGovernanceHook(
        500,
        ethers.ZeroAddress,
        false,
        ''
      )

      const [diversionBps, recipient, active, purpose] = await revSplitter.getGovernanceHookConfig()
      expect(diversionBps).to.equal(500)
      expect(active).to.equal(false)
    })

    it('Should allow toggling governance hook on and off', async function () {
      // Enable
      await revSplitter.configureGovernanceHook(
        500,
        await getAddress(governanceRecipient),
        true,
        'Enabled'
      )

      await user1.sendTransaction({
        to: await getAddress(revSplitter),
        value: parseTFUEL('1000')
      })

      expect(await revSplitter.totalGovernanceDiverted()).to.equal(parseTFUEL('15'))

      // Disable
      await revSplitter.configureGovernanceHook(
        500,
        await getAddress(governanceRecipient),
        false,
        ''
      )

      await user2.sendTransaction({
        to: await getAddress(revSplitter),
        value: parseTFUEL('1000')
      })

      // Total should still be 15 (no additional diversion)
      expect(await revSplitter.totalGovernanceDiverted()).to.equal(parseTFUEL('15'))
    })
  })

  describe('Milestones', function () {
    it('Should set milestone correctly', async function () {
      const milestoneId = 0
      const threshold = parseTFUEL('10000')
      const description = '10,000 TFUEL Milestone - NFT Rewards'

      const tx = await revSplitter.setMilestone(milestoneId, threshold, description)
      const receipt = await tx.wait()

      // Check event
      const event = receipt.logs.find(log => {
        try {
          const parsed = revSplitter.interface.parseLog(log)
          return parsed && parsed.name === 'MilestoneSet'
        } catch {
          return false
        }
      })
      expect(event).to.not.be.undefined

      const [thresholdOut, reached, descriptionOut] = await revSplitter.getMilestone(milestoneId)
      expect(thresholdOut).to.equal(threshold)
      expect(reached).to.equal(false)
      expect(descriptionOut).to.equal(description)
    })

    it('Should trigger milestone when threshold is reached', async function () {
      const milestoneId = 0
      const threshold = parseTFUEL('1000')
      await revSplitter.setMilestone(milestoneId, threshold, 'First 1K TFUEL')

      // Send exactly 1,000 TFUEL
      const tx = await user1.sendTransaction({
        to: await getAddress(revSplitter),
        value: threshold
      })
      const receipt = await tx.wait()

      // Check for MilestoneReached event
      const event = receipt.logs.find(log => {
        try {
          const parsed = revSplitter.interface.parseLog(log)
          return parsed && parsed.name === 'MilestoneReached'
        } catch {
          return false
        }
      })
      expect(event).to.not.be.undefined

      // Check milestone status
      const [thresholdOut, reached, descriptionOut] = await revSplitter.getMilestone(milestoneId)
      expect(reached).to.equal(true)
      expect(await revSplitter.currentMilestone()).to.equal(1)
    })

    it('Should trigger multiple milestones sequentially', async function () {
      // Set multiple milestones
      await revSplitter.setMilestone(0, parseTFUEL('500'), 'Milestone 1')
      await revSplitter.setMilestone(1, parseTFUEL('1000'), 'Milestone 2')
      await revSplitter.setMilestone(2, parseTFUEL('1500'), 'Milestone 3')

      // Send 600 TFUEL - should trigger milestone 0 only
      await user1.sendTransaction({
        to: await getAddress(revSplitter),
        value: parseTFUEL('600')
      })

      let [, reached0] = await revSplitter.getMilestone(0)
      let [, reached1] = await revSplitter.getMilestone(1)
      expect(reached0).to.equal(true)
      expect(reached1).to.equal(false)

      // Send 500 more TFUEL (total 1100) - should trigger milestone 1
      await user2.sendTransaction({
        to: await getAddress(revSplitter),
        value: parseTFUEL('500')
      })

      ;[, reached1] = await revSplitter.getMilestone(1)
      let [, reached2] = await revSplitter.getMilestone(2)
      expect(reached1).to.equal(true)
      expect(reached2).to.equal(false)

      // Send 500 more TFUEL (total 1600) - should trigger milestone 2
      await user1.sendTransaction({
        to: await getAddress(revSplitter),
        value: parseTFUEL('500')
      })

      ;[, reached2] = await revSplitter.getMilestone(2)
      expect(reached2).to.equal(true)
      expect(await revSplitter.currentMilestone()).to.equal(3)
    })

    it('Should not trigger milestone before threshold', async function () {
      await revSplitter.setMilestone(0, parseTFUEL('10000'), 'Milestone 1')

      await user1.sendTransaction({
        to: await getAddress(revSplitter),
        value: parseTFUEL('9999')
      })

      const [, reached] = await revSplitter.getMilestone(0)
      expect(reached).to.equal(false)
    })

    it('Should revert when setting milestone with zero threshold', async function () {
      await expect(
        revSplitter.setMilestone(0, 0, 'Invalid milestone')
      ).to.be.revertedWith('Threshold must be > 0')
    })

    it('Should revert when setting milestone with empty description', async function () {
      await expect(
        revSplitter.setMilestone(0, parseTFUEL('10000'), '')
      ).to.be.revertedWith('Description required')
    })
  })

  describe('calculateSplits', function () {
    it('Should calculate splits correctly without governance hook', async function () {
      const amount = parseTFUEL('1000')
      const [bbb, lpFunding, veXFYields, treasury, governanceDiverted] = 
        await revSplitter.calculateSplits(amount)

      expect(bbb).to.equal(parseTFUEL('300'))      // 30%
      expect(lpFunding).to.equal(parseTFUEL('300')) // 30%
      expect(veXFYields).to.equal(parseTFUEL('250')) // 25%
      expect(treasury).to.equal(parseTFUEL('150')) // 15%
      expect(governanceDiverted).to.equal(0)
    })

    it('Should calculate splits correctly with 5% governance diversion', async function () {
      await revSplitter.configureGovernanceHook(
        500,
        await getAddress(governanceRecipient),
        true,
        'Test'
      )

      const amount = parseTFUEL('1000')
      const [bbb, lpFunding, veXFYields, treasury, governanceDiverted] = 
        await revSplitter.calculateSplits(amount)

      expect(bbb).to.equal(parseTFUEL('300'))      // 30%
      expect(lpFunding).to.equal(parseTFUEL('285')) // 30% - 5% diversion
      expect(veXFYields).to.equal(parseTFUEL('250')) // 25%
      expect(treasury).to.equal(parseTFUEL('150')) // 15%
      expect(governanceDiverted).to.equal(parseTFUEL('15')) // 5% of LP slice
    })

    it('Should calculate splits correctly with 10% governance diversion', async function () {
      await revSplitter.configureGovernanceHook(
        1000,
        await getAddress(governanceRecipient),
        true,
        'Test'
      )

      const amount = parseTFUEL('1000')
      const [bbb, lpFunding, veXFYields, treasury, governanceDiverted] = 
        await revSplitter.calculateSplits(amount)

      expect(bbb).to.equal(parseTFUEL('300'))      // 30%
      expect(lpFunding).to.equal(parseTFUEL('270')) // 30% - 10% diversion
      expect(veXFYields).to.equal(parseTFUEL('250')) // 25%
      expect(treasury).to.equal(parseTFUEL('150')) // 15%
      expect(governanceDiverted).to.equal(parseTFUEL('30')) // 10% of LP slice
    })

    it('Should handle rounding in calculateSplits', async function () {
      const amount = parseTFUEL('1')
      const [bbb, lpFunding, veXFYields, treasury, governanceDiverted] = 
        await revSplitter.calculateSplits(amount)

      const sum = bbb + lpFunding + veXFYields + treasury + governanceDiverted
      expect(sum).to.equal(amount)
    })
  })

  describe('Admin Functions', function () {
    it('Should allow owner to update treasury', async function () {
      const tx = await revSplitter.setTreasury(await getAddress(user1))
      const receipt = await tx.wait()

      const event = receipt.logs.find(log => {
        try {
          const parsed = revSplitter.interface.parseLog(log)
          return parsed && parsed.name === 'TreasuryUpdated'
        } catch {
          return false
        }
      })
      expect(event).to.not.be.undefined

      expect(await revSplitter.treasuryAddr()).to.equal(await getAddress(user1))
    })

    it('Should allow owner to update BBB contract', async function () {
      const tx = await revSplitter.setBBBContract(await getAddress(user1))
      const receipt = await tx.wait()

      const event = receipt.logs.find(log => {
        try {
          const parsed = revSplitter.interface.parseLog(log)
          return parsed && parsed.name === 'BBBContractUpdated'
        } catch {
          return false
        }
      })
      expect(event).to.not.be.undefined

      expect(await revSplitter.bbbContract()).to.equal(await getAddress(user1))
    })

    it('Should allow owner to update veXF yields distributor', async function () {
      const tx = await revSplitter.setVeXFYieldsDistributor(await getAddress(user1))
      const receipt = await tx.wait()

      const event = receipt.logs.find(log => {
        try {
          const parsed = revSplitter.interface.parseLog(log)
          return parsed && parsed.name === 'VeXFYieldsDistributorUpdated'
        } catch {
          return false
        }
      })
      expect(event).to.not.be.undefined

      expect(await revSplitter.veXFYieldsDistributor()).to.equal(await getAddress(user1))
    })

    it('Should allow owner to update LP treasury address', async function () {
      const newAddr = 'persistence1newaddress1234567890'
      const tx = await revSplitter.setLPTreasury(newAddr)
      const receipt = await tx.wait()

      const event = receipt.logs.find(log => {
        try {
          const parsed = revSplitter.interface.parseLog(log)
          return parsed && parsed.name === 'LPTreasuryUpdated'
        } catch {
          return false
        }
      })
      expect(event).to.not.be.undefined

      expect(await revSplitter.lpTreasuryAddr()).to.equal(newAddr)
    })

    it('Should allow owner to update Axelar bridge adapter', async function () {
      const tx = await revSplitter.setAxelarBridgeAdapter(await getAddress(axelarAdapter))
      const receipt = await tx.wait()

      const event = receipt.logs.find(log => {
        try {
          const parsed = revSplitter.interface.parseLog(log)
          return parsed && parsed.name === 'AxelarBridgeAdapterUpdated'
        } catch {
          return false
        }
      })
      expect(event).to.not.be.undefined

      expect(await revSplitter.axelarBridgeAdapter()).to.equal(await getAddress(axelarAdapter))
    })

    it('Should revert if non-owner tries to update', async function () {
      await expect(
        revSplitter.connect(user1).setTreasury(await getAddress(user1))
      ).to.be.reverted

      await expect(
        revSplitter.connect(user1).setBBBContract(await getAddress(user1))
      ).to.be.reverted

      await expect(
        revSplitter.connect(user1).setVeXFYieldsDistributor(await getAddress(user1))
      ).to.be.reverted

      await expect(
        revSplitter.connect(user1).setLPTreasury('persistence1newaddr')
      ).to.be.reverted

      await expect(
        revSplitter.connect(user1).configureGovernanceHook(500, await getAddress(user1), true, 'Test')
      ).to.be.reverted

      await expect(
        revSplitter.connect(user1).setMilestone(0, parseTFUEL('10000'), 'Test')
      ).to.be.reverted
    })

    it('Should revert if setting zero address for required fields', async function () {
      await expect(
        revSplitter.setTreasury(ethers.ZeroAddress)
      ).to.be.revertedWith('Invalid address')

      await expect(
        revSplitter.setBBBContract(ethers.ZeroAddress)
      ).to.be.revertedWith('Invalid address')

      await expect(
        revSplitter.setVeXFYieldsDistributor(ethers.ZeroAddress)
      ).to.be.revertedWith('Invalid address')

      await expect(
        revSplitter.setLPTreasury('')
      ).to.be.revertedWith('Invalid address')
    })

    it('Should allow setting Axelar adapter to zero address', async function () {
      // Should not revert - zero address disables bridging
      await revSplitter.setAxelarBridgeAdapter(ethers.ZeroAddress)
      expect(await revSplitter.axelarBridgeAdapter()).to.equal(ethers.ZeroAddress)
    })
  })

  describe('Manual Bridge', function () {
    it('Should allow owner to manually bridge pending LP funding', async function () {
      // First, create some pending LP funding
      const tfuelAmount = parseTFUEL('1000')
      await user1.sendTransaction({
        to: await getAddress(revSplitter),
        value: tfuelAmount
      })

      // Should have 300 TFUEL pending
      expect(await revSplitter.getPendingLPFunding()).to.equal(parseTFUEL('300'))

      // Set bridge adapter
      await revSplitter.setAxelarBridgeAdapter(await getAddress(axelarAdapter))

      // Manually bridge
      const bridgeAmount = parseTFUEL('300')
      const axelarBalanceBefore = await ethers.provider.getBalance(await getAddress(axelarAdapter))
      
      const tx = await revSplitter.manualBridgeLPFunding(bridgeAmount)
      const receipt = await tx.wait()

      const event = receipt.logs.find(log => {
        try {
          const parsed = revSplitter.interface.parseLog(log)
          return parsed && parsed.name === 'LPFundingBridged'
        } catch {
          return false
        }
      })
      expect(event).to.not.be.undefined

      // Check funds transferred
      const axelarBalanceAfter = await ethers.provider.getBalance(await getAddress(axelarAdapter))
      expect(axelarBalanceAfter - axelarBalanceBefore).to.equal(bridgeAmount)
      expect(await revSplitter.getPendingLPFunding()).to.equal(0)
    })

    it('Should revert if bridge adapter not set', async function () {
      await expect(
        revSplitter.manualBridgeLPFunding(parseTFUEL('1000'))
      ).to.be.revertedWith('Bridge adapter not set')
    })

    it('Should revert if amount is zero', async function () {
      await revSplitter.setAxelarBridgeAdapter(await getAddress(axelarAdapter))
      
      await expect(
        revSplitter.manualBridgeLPFunding(0)
      ).to.be.revertedWith('Amount must be > 0')
    })

    it('Should revert if insufficient balance', async function () {
      await revSplitter.setAxelarBridgeAdapter(await getAddress(axelarAdapter))
      
      await expect(
        revSplitter.manualBridgeLPFunding(parseTFUEL('1000'))
      ).to.be.revertedWith('Insufficient balance')
    })

    it('Should revert if non-owner tries to bridge', async function () {
      await revSplitter.setAxelarBridgeAdapter(await getAddress(axelarAdapter))
      
      await expect(
        revSplitter.connect(user1).manualBridgeLPFunding(parseTFUEL('1000'))
      ).to.be.reverted
    })
  })

  describe('Emergency Withdraw', function () {
    it('Should allow owner to withdraw TFUEL', async function () {
      const amount = parseTFUEL('1000')
      
      // Send TFUEL to contract
      await user1.sendTransaction({
        to: await getAddress(revSplitter),
        value: amount
      })

      const ownerBalanceBefore = await ethers.provider.getBalance(await getAddress(owner))
      const contractBalance = await revSplitter.getPendingLPFunding()

      const tx = await revSplitter.emergencyWithdraw(ethers.ZeroAddress, contractBalance)
      const receipt = await tx.wait()

      const ownerBalanceAfter = await ethers.provider.getBalance(await getAddress(owner))
      
      // Owner balance should increase (minus gas costs)
      expect(ownerBalanceAfter).to.be.gt(ownerBalanceBefore)
    })

    it('Should revert if non-owner tries to withdraw', async function () {
      await expect(
        revSplitter.connect(user1).emergencyWithdraw(ethers.ZeroAddress, parseTFUEL('100'))
      ).to.be.reverted
    })
  })

  describe('Integration Tests', function () {
    it('Should handle complete flow with governance hook and milestones', async function () {
      // Set up milestones
      await revSplitter.setMilestone(0, parseTFUEL('500'), 'First 500 TFUEL')
      await revSplitter.setMilestone(1, parseTFUEL('1000'), 'First 1K TFUEL')

      // Configure governance hook
      await revSplitter.configureGovernanceHook(
        750, // 7.5%
        await getAddress(governanceRecipient),
        true,
        'NFT rewards for early believers'
      )

      // Set Axelar bridge
      await revSplitter.setAxelarBridgeAdapter(await getAddress(axelarAdapter))

      // Send 600 TFUEL
      await user1.sendTransaction({
        to: await getAddress(revSplitter),
        value: parseTFUEL('600')
      })

      // Check milestone 0 reached
      let [, reached0] = await revSplitter.getMilestone(0)
      expect(reached0).to.equal(true)

      // Check splits with governance hook
      // LP funding = 30% of 600 = 180 TFUEL
      // Governance = 7.5% of 180 = 13.5 TFUEL
      // LP funding after diversion = 166.5 TFUEL
      expect(await revSplitter.totalLPFundingAllocated()).to.equal(parseTFUEL('166.5'))
      expect(await revSplitter.totalGovernanceDiverted()).to.equal(parseTFUEL('13.5'))

      // Send another 500 TFUEL (total 1100)
      await user2.sendTransaction({
        to: await getAddress(revSplitter),
        value: parseTFUEL('500')
      })

      // Check milestone 1 reached
      let [, reached1] = await revSplitter.getMilestone(1)
      expect(reached1).to.equal(true)

      expect(await revSplitter.totalRevenueCollected()).to.equal(parseTFUEL('1100'))
    })

    it('Should handle fallback with data', async function () {
      const tfuelAmount = parseTFUEL('1000')
      
      // Send with data (triggers fallback)
      await owner.sendTransaction({
        to: await getAddress(revSplitter),
        value: tfuelAmount,
        data: '0x1234'
      })

      expect(await revSplitter.totalRevenueCollected()).to.equal(tfuelAmount)
    })
  })
})

