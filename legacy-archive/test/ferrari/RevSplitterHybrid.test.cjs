const { expect } = require('chai')
const { ethers } = require('hardhat')
const hre = require('hardhat')
const { getAddress, parseUnits } = require('./helpers.cjs')

describe('RevSplitterHybrid', function () {
  let revSplitter
  let revenueToken
  let bbbContract
  let veXFDistributor
  let innovationTreasury
  let axelarAdapter
  let governanceRecipient
  let owner, user1, user2

  const INNOVATION_TREASURY_ADDR = '0x043d5231651379970d52a13CEfB4e80733DDb989'
  const LP_TREASURY_ADDR = 'persistence1q50x9h4nchk2uhhj5jre0jsqxrs9qmhvjwf8yj'

  beforeEach(async function () {
    await hre.network.provider.request({
      method: 'hardhat_reset',
      params: []
    })

    ;[owner, user1, user2, bbbContract, veXFDistributor, innovationTreasury, axelarAdapter, governanceRecipient] = await ethers.getSigners()

    // Deploy mock revenue token (USDC with 6 decimals)
    const MockERC20 = await ethers.getContractFactory('MockERC20')
    revenueToken = await MockERC20.deploy('USD Coin', 'USDC', 6)
    await (revenueToken.waitForDeployment?.() || revenueToken.deployed?.())

    // Deploy RevSplitterHybrid
    const RevSplitterHybrid = await ethers.getContractFactory('RevSplitterHybrid')
    revSplitter = await RevSplitterHybrid.deploy(
      await getAddress(revenueToken),
      await getAddress(innovationTreasury),
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
      expect(await revSplitter.revenueToken()).to.equal(await getAddress(revenueToken))
      expect(await revSplitter.innovationTreasuryAddr()).to.equal(await getAddress(innovationTreasury))
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
      expect(await revSplitter.totalInnovationTreasuryAllocated()).to.equal(0)
      expect(await revSplitter.totalGovernanceDiverted()).to.equal(0)
    })

    it('Should initialize with governance hook disabled', async function () {
      const [diversionBps, recipient, active] = await revSplitter.getGovernanceHookConfig()
      expect(diversionBps).to.equal(0)
      expect(active).to.equal(false)
    })

    it('Should revert if initialized with zero addresses', async function () {
      const RevSplitterHybrid = await ethers.getContractFactory('RevSplitterHybrid')
      
      await expect(
        RevSplitterHybrid.deploy(
          ethers.ZeroAddress,
          await getAddress(innovationTreasury),
          LP_TREASURY_ADDR,
          await getAddress(bbbContract),
          await getAddress(veXFDistributor),
          await getAddress(owner)
        )
      ).to.be.revertedWith('Invalid revenue token')

      await expect(
        RevSplitterHybrid.deploy(
          await getAddress(revenueToken),
          ethers.ZeroAddress,
          LP_TREASURY_ADDR,
          await getAddress(bbbContract),
          await getAddress(veXFDistributor),
          await getAddress(owner)
        )
      ).to.be.revertedWith('Invalid innovation treasury')

      await expect(
        RevSplitterHybrid.deploy(
          await getAddress(revenueToken),
          await getAddress(innovationTreasury),
          '',
          await getAddress(bbbContract),
          await getAddress(veXFDistributor),
          await getAddress(owner)
        )
      ).to.be.revertedWith('Invalid LP treasury address')
    })
  })

  describe('splitRevenue', function () {
    it('Should split revenue correctly (30/30/25/15)', async function () {
      const revenueAmount = parseUnits('10000', 6) // 10000 USDC

      // Mint tokens and approve
      await revenueToken.mint(await getAddress(user1), revenueAmount)
      await revenueToken.connect(user1).approve(await getAddress(revSplitter), revenueAmount)

      // Get balances before
      const bbbBalanceBefore = await revenueToken.balanceOf(await getAddress(bbbContract))
      const veXFBalanceBefore = await revenueToken.balanceOf(await getAddress(veXFDistributor))
      const innovationBalanceBefore = await revenueToken.balanceOf(await getAddress(innovationTreasury))

      // Split revenue
      const tx = await revSplitter.connect(user1).splitRevenue(revenueAmount)
      const receipt = await tx.wait()

      // Check events
      const revenueCollectedEvent = receipt.logs.find(log => {
        try {
          const parsed = revSplitter.interface.parseLog(log)
          return parsed && parsed.name === 'RevenueCollected'
        } catch {
          return false
        }
      })
      expect(revenueCollectedEvent).to.not.be.undefined

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
      expect(await revSplitter.totalRevenueCollected()).to.equal(revenueAmount)
      
      // 30% BBB = 3000 USDC
      expect(await revSplitter.totalBBBAllocated()).to.equal(parseUnits('3000', 6))
      const bbbBalanceAfter = await revenueToken.balanceOf(await getAddress(bbbContract))
      expect(bbbBalanceAfter - bbbBalanceBefore).to.equal(parseUnits('3000', 6))
      
      // 30% LP Funding = 3000 USDC (held in contract since no bridge adapter)
      expect(await revSplitter.totalLPFundingAllocated()).to.equal(parseUnits('3000', 6))
      expect(await revSplitter.getPendingLPFunding()).to.equal(parseUnits('3000', 6))
      
      // 25% veXF Yields = 2500 USDC
      expect(await revSplitter.totalVeXFYieldsAllocated()).to.equal(parseUnits('2500', 6))
      const veXFBalanceAfter = await revenueToken.balanceOf(await getAddress(veXFDistributor))
      expect(veXFBalanceAfter - veXFBalanceBefore).to.equal(parseUnits('2500', 6))
      
      // 15% Innovation Treasury = 1500 USDC
      expect(await revSplitter.totalInnovationTreasuryAllocated()).to.equal(parseUnits('1500', 6))
      const innovationBalanceAfter = await revenueToken.balanceOf(await getAddress(innovationTreasury))
      expect(innovationBalanceAfter - innovationBalanceBefore).to.equal(parseUnits('1500', 6))
    })

    it('Should split revenue with Axelar bridge adapter', async function () {
      // Set Axelar bridge adapter
      await revSplitter.setAxelarBridgeAdapter(await getAddress(axelarAdapter))

      const revenueAmount = parseUnits('10000', 6)
      await revenueToken.mint(await getAddress(user1), revenueAmount)
      await revenueToken.connect(user1).approve(await getAddress(revSplitter), revenueAmount)

      const axelarBalanceBefore = await revenueToken.balanceOf(await getAddress(axelarAdapter))

      await revSplitter.connect(user1).splitRevenue(revenueAmount)

      // LP funding should go to Axelar adapter
      const axelarBalanceAfter = await revenueToken.balanceOf(await getAddress(axelarAdapter))
      expect(axelarBalanceAfter - axelarBalanceBefore).to.equal(parseUnits('3000', 6))
      
      // Contract should not hold LP funding
      expect(await revSplitter.getPendingLPFunding()).to.equal(0)
    })

    it('Should handle rounding correctly', async function () {
      const revenueAmount = parseUnits('1', 6) // 1 USDC (to test rounding)
      await revenueToken.mint(await getAddress(user1), revenueAmount)
      await revenueToken.connect(user1).approve(await getAddress(revSplitter), revenueAmount)

      await revSplitter.connect(user1).splitRevenue(revenueAmount)

      // Total should equal original amount (remainder goes to veXF)
      const totalBBB = await revSplitter.totalBBBAllocated()
      const totalLP = await revSplitter.totalLPFundingAllocated()
      const totalVeXF = await revSplitter.totalVeXFYieldsAllocated()
      const totalInnovation = await revSplitter.totalInnovationTreasuryAllocated()
      
      const sum = totalBBB + totalLP + totalVeXF + totalInnovation
      expect(sum).to.equal(revenueAmount)
    })

    it('Should revert if amount is zero', async function () {
      await expect(
        revSplitter.connect(user1).splitRevenue(0)
      ).to.be.revertedWith('Amount must be > 0')
    })

    it('Should revert if insufficient allowance', async function () {
      const revenueAmount = parseUnits('1000', 6)
      await revenueToken.mint(await getAddress(user1), revenueAmount)
      // Don't approve

      await expect(
        revSplitter.connect(user1).splitRevenue(revenueAmount)
      ).to.be.reverted
    })
  })

  describe('Governance Hook', function () {
    it('Should configure governance hook correctly', async function () {
      const diversionBps = 500 // 5%
      const tx = await revSplitter.configureGovernanceHook(
        diversionBps,
        await getAddress(governanceRecipient),
        true
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

      const [diversionBpsOut, recipient, active] = await revSplitter.getGovernanceHookConfig()
      expect(diversionBpsOut).to.equal(diversionBps)
      expect(recipient).to.equal(await getAddress(governanceRecipient))
      expect(active).to.equal(true)
    })

    it('Should apply governance diversion from LP slice (5%)', async function () {
      // Configure 5% diversion
      await revSplitter.configureGovernanceHook(
        500, // 5%
        await getAddress(governanceRecipient),
        true
      )

      const revenueAmount = parseUnits('10000', 6)
      await revenueToken.mint(await getAddress(user1), revenueAmount)
      await revenueToken.connect(user1).approve(await getAddress(revSplitter), revenueAmount)

      const governanceBalanceBefore = await revenueToken.balanceOf(await getAddress(governanceRecipient))

      await revSplitter.connect(user1).splitRevenue(revenueAmount)

      // LP Funding = 30% of 10000 = 3000 USDC
      // Governance gets 5% of 3000 = 150 USDC
      // LP Funding gets 2850 USDC
      const governanceBalanceAfter = await revenueToken.balanceOf(await getAddress(governanceRecipient))
      expect(governanceBalanceAfter - governanceBalanceBefore).to.equal(parseUnits('150', 6))
      
      expect(await revSplitter.totalGovernanceDiverted()).to.equal(parseUnits('150', 6))
      expect(await revSplitter.totalLPFundingAllocated()).to.equal(parseUnits('2850', 6))
    })

    it('Should apply governance diversion from LP slice (10%)', async function () {
      // Configure 10% diversion (maximum)
      await revSplitter.configureGovernanceHook(
        1000, // 10%
        await getAddress(governanceRecipient),
        true
      )

      const revenueAmount = parseUnits('10000', 6)
      await revenueToken.mint(await getAddress(user1), revenueAmount)
      await revenueToken.connect(user1).approve(await getAddress(revSplitter), revenueAmount)

      const governanceBalanceBefore = await revenueToken.balanceOf(await getAddress(governanceRecipient))

      await revSplitter.connect(user1).splitRevenue(revenueAmount)

      // LP Funding = 30% of 10000 = 3000 USDC
      // Governance gets 10% of 3000 = 300 USDC
      // LP Funding gets 2700 USDC
      const governanceBalanceAfter = await revenueToken.balanceOf(await getAddress(governanceRecipient))
      expect(governanceBalanceAfter - governanceBalanceBefore).to.equal(parseUnits('300', 6))
      
      expect(await revSplitter.totalGovernanceDiverted()).to.equal(parseUnits('300', 6))
      expect(await revSplitter.totalLPFundingAllocated()).to.equal(parseUnits('2700', 6))
    })

    it('Should not apply diversion when hook is inactive', async function () {
      // Configure but leave inactive
      await revSplitter.configureGovernanceHook(
        500, // 5%
        await getAddress(governanceRecipient),
        false // inactive
      )

      const revenueAmount = parseUnits('10000', 6)
      await revenueToken.mint(await getAddress(user1), revenueAmount)
      await revenueToken.connect(user1).approve(await getAddress(revSplitter), revenueAmount)

      const governanceBalanceBefore = await revenueToken.balanceOf(await getAddress(governanceRecipient))

      await revSplitter.connect(user1).splitRevenue(revenueAmount)

      // No diversion should occur
      const governanceBalanceAfter = await revenueToken.balanceOf(await getAddress(governanceRecipient))
      expect(governanceBalanceAfter).to.equal(governanceBalanceBefore)
      
      expect(await revSplitter.totalGovernanceDiverted()).to.equal(0)
      expect(await revSplitter.totalLPFundingAllocated()).to.equal(parseUnits('3000', 6))
    })

    it('Should revert if diversion exceeds maximum', async function () {
      await expect(
        revSplitter.configureGovernanceHook(
          1001, // 10.01% - exceeds max
          await getAddress(governanceRecipient),
          true
        )
      ).to.be.revertedWith('Diversion too high')
    })

    it('Should revert if diversion below minimum when active', async function () {
      await expect(
        revSplitter.configureGovernanceHook(
          499, // 4.99% - below min
          await getAddress(governanceRecipient),
          true
        )
      ).to.be.revertedWith('Diversion too low')
    })

    it('Should revert if recipient is zero when active', async function () {
      await expect(
        revSplitter.configureGovernanceHook(
          500,
          ethers.ZeroAddress,
          true
        )
      ).to.be.revertedWith('Invalid recipient')
    })

    it('Should allow inactive hook with invalid recipient', async function () {
      // Should not revert when inactive, even with invalid recipient
      await revSplitter.configureGovernanceHook(
        500,
        ethers.ZeroAddress,
        false
      )

      const [diversionBps, recipient, active] = await revSplitter.getGovernanceHookConfig()
      expect(diversionBps).to.equal(500)
      expect(active).to.equal(false)
    })
  })

  describe('calculateSplits', function () {
    it('Should calculate splits correctly without governance hook', async function () {
      const amount = parseUnits('10000', 6)
      const [bbb, lpFunding, veXFYields, innovationTreasury, governanceDiverted] = 
        await revSplitter.calculateSplits(amount)

      expect(bbb).to.equal(parseUnits('3000', 6))      // 30%
      expect(lpFunding).to.equal(parseUnits('3000', 6)) // 30%
      expect(veXFYields).to.equal(parseUnits('2500', 6)) // 25%
      expect(innovationTreasury).to.equal(parseUnits('1500', 6)) // 15%
      expect(governanceDiverted).to.equal(0)
    })

    it('Should calculate splits correctly with 5% governance diversion', async function () {
      await revSplitter.configureGovernanceHook(
        500,
        await getAddress(governanceRecipient),
        true
      )

      const amount = parseUnits('10000', 6)
      const [bbb, lpFunding, veXFYields, innovationTreasury, governanceDiverted] = 
        await revSplitter.calculateSplits(amount)

      expect(bbb).to.equal(parseUnits('3000', 6))      // 30%
      expect(lpFunding).to.equal(parseUnits('2850', 6)) // 30% - 5% diversion
      expect(veXFYields).to.equal(parseUnits('2500', 6)) // 25%
      expect(innovationTreasury).to.equal(parseUnits('1500', 6)) // 15%
      expect(governanceDiverted).to.equal(parseUnits('150', 6)) // 5% of LP slice
    })

    it('Should calculate splits correctly with 10% governance diversion', async function () {
      await revSplitter.configureGovernanceHook(
        1000,
        await getAddress(governanceRecipient),
        true
      )

      const amount = parseUnits('10000', 6)
      const [bbb, lpFunding, veXFYields, innovationTreasury, governanceDiverted] = 
        await revSplitter.calculateSplits(amount)

      expect(bbb).to.equal(parseUnits('3000', 6))      // 30%
      expect(lpFunding).to.equal(parseUnits('2700', 6)) // 30% - 10% diversion
      expect(veXFYields).to.equal(parseUnits('2500', 6)) // 25%
      expect(innovationTreasury).to.equal(parseUnits('1500', 6)) // 15%
      expect(governanceDiverted).to.equal(parseUnits('300', 6)) // 10% of LP slice
    })

    it('Should handle rounding in calculateSplits', async function () {
      const amount = parseUnits('1', 6)
      const [bbb, lpFunding, veXFYields, innovationTreasury, governanceDiverted] = 
        await revSplitter.calculateSplits(amount)

      const sum = bbb + lpFunding + veXFYields + innovationTreasury + governanceDiverted
      expect(sum).to.equal(amount)
    })
  })

  describe('Admin Functions', function () {
    it('Should allow owner to update innovation treasury', async function () {
      const tx = await revSplitter.setInnovationTreasury(await getAddress(user1))
      const receipt = await tx.wait()

      const event = receipt.logs.find(log => {
        try {
          const parsed = revSplitter.interface.parseLog(log)
          return parsed && parsed.name === 'InnovationTreasuryUpdated'
        } catch {
          return false
        }
      })
      expect(event).to.not.be.undefined

      expect(await revSplitter.innovationTreasuryAddr()).to.equal(await getAddress(user1))
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

    it('Should allow owner to update revenue token', async function () {
      const MockERC20 = await ethers.getContractFactory('MockERC20')
      const newToken = await MockERC20.deploy('New Token', 'NEW', 18)
      await (newToken.waitForDeployment?.() || newToken.deployed?.())

      const tx = await revSplitter.setRevenueToken(await getAddress(newToken))
      const receipt = await tx.wait()

      const event = receipt.logs.find(log => {
        try {
          const parsed = revSplitter.interface.parseLog(log)
          return parsed && parsed.name === 'RevenueTokenUpdated'
        } catch {
          return false
        }
      })
      expect(event).to.not.be.undefined

      expect(await revSplitter.revenueToken()).to.equal(await getAddress(newToken))
    })

    it('Should revert if non-owner tries to update', async function () {
      await expect(
        revSplitter.connect(user1).setInnovationTreasury(await getAddress(user1))
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
        revSplitter.connect(user1).configureGovernanceHook(500, await getAddress(user1), true)
      ).to.be.reverted
    })

    it('Should revert if setting zero address for required fields', async function () {
      await expect(
        revSplitter.setInnovationTreasury(ethers.ZeroAddress)
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

      await expect(
        revSplitter.setRevenueToken(ethers.ZeroAddress)
      ).to.be.revertedWith('Invalid token')
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
      const revenueAmount = parseUnits('10000', 6)
      await revenueToken.mint(await getAddress(user1), revenueAmount)
      await revenueToken.connect(user1).approve(await getAddress(revSplitter), revenueAmount)
      await revSplitter.connect(user1).splitRevenue(revenueAmount)

      // Should have 3000 USDC pending
      expect(await revSplitter.getPendingLPFunding()).to.equal(parseUnits('3000', 6))

      // Set bridge adapter
      await revSplitter.setAxelarBridgeAdapter(await getAddress(axelarAdapter))

      // Manually bridge
      const bridgeAmount = parseUnits('3000', 6)
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
      expect(await revenueToken.balanceOf(await getAddress(axelarAdapter))).to.equal(bridgeAmount)
      expect(await revSplitter.getPendingLPFunding()).to.equal(0)
    })

    it('Should revert if bridge adapter not set', async function () {
      await expect(
        revSplitter.manualBridgeLPFunding(parseUnits('1000', 6))
      ).to.be.revertedWith('Bridge adapter not set')
    })

    it('Should revert if amount is zero', async function () {
      await revSplitter.setAxelarBridgeAdapter(await getAddress(axelarAdapter))
      
      await expect(
        revSplitter.manualBridgeLPFunding(0)
      ).to.be.revertedWith('Amount must be > 0')
    })

    it('Should revert if non-owner tries to bridge', async function () {
      await revSplitter.setAxelarBridgeAdapter(await getAddress(axelarAdapter))
      
      await expect(
        revSplitter.connect(user1).manualBridgeLPFunding(parseUnits('1000', 6))
      ).to.be.reverted
    })
  })

  describe('Emergency Withdraw', function () {
    it('Should allow owner to withdraw tokens', async function () {
      const amount = parseUnits('1000', 6)
      await revenueToken.mint(await getAddress(revSplitter), amount)

      await revSplitter.emergencyWithdraw(await getAddress(revenueToken), amount)

      expect(await revenueToken.balanceOf(await getAddress(owner))).to.equal(amount)
    })

    it('Should revert if non-owner tries to withdraw', async function () {
      await expect(
        revSplitter.connect(user1).emergencyWithdraw(await getAddress(revenueToken), parseUnits('100', 6))
      ).to.be.reverted
    })
  })
})




