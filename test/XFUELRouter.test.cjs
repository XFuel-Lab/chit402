const { expect } = require('chai')
const { ethers } = require('hardhat')
const hre = require('hardhat')
const { getAddress, parseEther, getZeroAddress } = require('./helpers.cjs')

describe('XFUELRouter', function () {
  let router, factory, backstop, xfuelToken, usdcToken
  let owner, treasury, veXFContract, user
  let mockPool

  beforeEach(async function () {
    // Reset network state to prevent pollution between tests
    await hre.network.provider.request({
      method: 'hardhat_reset',
      params: []
    })
    
    ;[owner, treasury, veXFContract, user] = await ethers.getSigners()

    // Deploy mock ERC20 tokens
    const MockERC20 = await ethers.getContractFactory('MockERC20')
    xfuelToken = await MockERC20.deploy('XFuel Token', 'XF', 18)
    usdcToken = await MockERC20.deploy('USD Coin', 'USDC', 6)
    await (xfuelToken.waitForDeployment?.() || xfuelToken.deployed?.())
    await (usdcToken.waitForDeployment?.() || usdcToken.deployed?.())

    // Deploy dependencies
    const XFUELPoolFactory = await ethers.getContractFactory('XFUELPoolFactory')
    factory = await XFUELPoolFactory.deploy()
    await (factory.waitForDeployment?.() || factory.deployed?.())

    const TreasuryILBackstop = await ethers.getContractFactory('TreasuryILBackstop')
    backstop = await TreasuryILBackstop.deploy(await getAddress(usdcToken))
    await (backstop.waitForDeployment?.() || backstop.deployed?.())

    // Deploy router
    const XFUELRouter = await ethers.getContractFactory('XFUELRouter')
    router = await XFUELRouter.deploy(
      await getAddress(factory),
      await getAddress(backstop),
      await getAddress(xfuelToken),
      await getAddress(usdcToken),
      await getAddress(treasury),
      await getAddress(veXFContract)
    )
    await (router.waitForDeployment?.() || router.deployed?.())

    // Create a mock pool for testing
    const MockPool = await ethers.getContractFactory('XFUELPool')
    mockPool = await MockPool.deploy()
    await (mockPool.waitForDeployment?.() || mockPool.deployed?.())
  })

  afterEach(async function () {
    // Reset network state after each test
    await hre.network.provider.request({
      method: 'hardhat_reset',
      params: []
    })
  })

  describe('Deployment', function () {
    it('Should set the correct factory address', async function () {
      const factoryAddr = await getAddress(factory)
      expect((await router.factory()).toLowerCase()).to.equal(factoryAddr.toLowerCase())
    })

    it('Should set the correct backstop address', async function () {
      const backstopAddr = await getAddress(backstop)
      expect((await router.backstop()).toLowerCase()).to.equal(backstopAddr.toLowerCase())
    })

    it('Should set the correct token addresses', async function () {
      const xfuelAddr = await getAddress(xfuelToken)
      const usdcAddr = await getAddress(usdcToken)
      expect((await router.xfuelToken()).toLowerCase()).to.equal(xfuelAddr.toLowerCase())
      expect((await router.usdcToken()).toLowerCase()).to.equal(usdcAddr.toLowerCase())
    })

    it('Should set the correct treasury and veXF addresses', async function () {
      const treasuryAddr = await getAddress(treasury)
      const veXFAddr = await getAddress(veXFContract)
      expect((await router.treasury()).toLowerCase()).to.equal(treasuryAddr.toLowerCase())
      expect((await router.veXFContract()).toLowerCase()).to.equal(veXFAddr.toLowerCase())
    })

    it('Should initialize with zero fee totals', async function () {
      expect(await router.totalFeesCollected()).to.equal(0)
      expect(await router.totalXFuelBurned()).to.equal(0)
      expect(await router.totalUSDCToVeXF()).to.equal(0)
    })
  })

  describe('swapAndStake', function () {
    it('Should emit SwapAndStake event with correct parameters', async function () {
      const amount = parseEther('1')
      const targetLST = 'stkXPRT'
      const minAmountOut = parseEther('0.9') // 90% minimum

      const userAddr = await getAddress(user)
      const expectedStaked = amount.mul(95).div(100) // 95% of input (5% fee)
      await expect(
        router.connect(user).swapAndStake(amount, targetLST, minAmountOut, { value: amount })
      ).to.emit(router, 'SwapAndStake')
        .withArgs(
          userAddr,
          amount,
          expectedStaked,
          targetLST
        )
    })

    it('Should revert if amount is zero', async function () {
      await expect(
        router.connect(user).swapAndStake(0, 'stkXPRT', 0, { value: 0 })
      ).to.be.revertedWith('XFUELRouter: amount must be greater than 0')
    })

    it('Should revert if msg.value does not match amount', async function () {
      const amount = parseEther('1')
      await expect(
        router.connect(user).swapAndStake(amount, 'stkXPRT', 0, { value: parseEther('0.5') })
      ).to.be.revertedWith('XFUELRouter: TFUEL amount must match msg.value')
    })

    it('Should revert if targetLST is empty', async function () {
      const amount = parseEther('1')
      await expect(
        router.connect(user).swapAndStake(amount, '', 0, { value: amount })
      ).to.be.revertedWith('XFUELRouter: stake target cannot be empty')
    })
    
    it('Should revert if slippage too high', async function () {
      const amount = parseEther('1')
      const minAmountOut = parseEther('1') // 100% minimum (impossible)
      await expect(
        router.connect(user).swapAndStake(amount, 'stkXPRT', minAmountOut, { value: amount })
      ).to.be.revertedWith('XFUELRouter: SLIPPAGE_TOO_HIGH')
    })

    it('Should return correct staked amount (95% of input)', async function () {
      const amount = parseEther('1')
      const minAmountOut = parseEther('0.9')
      const expectedStaked = amount.mul(95).div(100)
      
      const tx = await router.connect(user).swapAndStake(amount, 'stkXPRT', minAmountOut, { value: amount })
      const receipt = await tx.wait()
      const event = receipt.logs.find(log => {
        try {
          const parsed = router.interface.parseLog(log)
          return parsed?.name === 'SwapAndStake'
        } catch {
          return false
        }
      })
      const parsedEvent = router.interface.parseLog(event)
      expect(parsedEvent.args.stakedAmount.toString()).to.equal(expectedStaked.toString())
    })
  })

  describe('Owner Functions', function () {
    it('Should allow owner to set veXF contract', async function () {
      const newVeXF = ethers.Wallet.createRandom().address
      await router.connect(owner).setVeXFContract(newVeXF)
      expect((await router.veXFContract()).toLowerCase()).to.equal(newVeXF.toLowerCase())
    })

    it('Should allow owner to set treasury', async function () {
      const newTreasury = ethers.Wallet.createRandom().address
      await router.connect(owner).setTreasury(newTreasury)
      expect((await router.treasury()).toLowerCase()).to.equal(newTreasury.toLowerCase())
    })

    it('Should revert if non-owner tries to set veXF contract', async function () {
      const newVeXF = ethers.Wallet.createRandom().address
      await expect(
        router.connect(user).setVeXFContract(newVeXF)
      ).to.be.revertedWith('Ownable: caller is not the owner')
    })

    it('Should revert if non-owner tries to set treasury', async function () {
      const newTreasury = ethers.Wallet.createRandom().address
      await expect(
        router.connect(user).setTreasury(newTreasury)
      ).to.be.revertedWith('Ownable: caller is not the owner')
    })
  })

  describe('Fee Constants', function () {
    it('Should have correct fee split constants', async function () {
      expect(await router.BUYBACK_BPS()).to.equal(6000) // 60%
      expect(await router.VEXF_YIELD_BPS()).to.equal(2500) // 25%
      expect(await router.TREASURY_BPS()).to.equal(1500) // 15%
    })

    it('Should have fee splits that sum to 10000 BPS', async function () {
      const buyback = await router.BUYBACK_BPS()
      const vexf = await router.VEXF_YIELD_BPS()
      const treasury = await router.TREASURY_BPS()
      expect(buyback.add(vexf).add(treasury)).to.equal(10000)
    })
  })

  describe('collectAndDistributeFees', function () {
    let pool, token0, token1

    beforeEach(async function () {
      // Deploy tokens
      const MockERC20 = await ethers.getContractFactory('MockERC20')
      token0 = await MockERC20.deploy('Token 0', 'TK0', 18)
      token1 = await MockERC20.deploy('Token 1', 'TK1', 18)
      await (token0.waitForDeployment?.() || token0.deployed?.())
      await (token1.waitForDeployment?.() || token1.deployed?.())

      // Deploy factory and create pool
      const XFUELPoolFactory = await ethers.getContractFactory('XFUELPoolFactory')
      const factoryContract = await XFUELPoolFactory.deploy()
      await (factoryContract.waitForDeployment?.() || factoryContract.deployed?.())

      const sqrtPriceX96 = '79228162514264337593543950336'
      await factoryContract.createPool(
        await getAddress(token0),
        await getAddress(token1),
        500,
        sqrtPriceX96
      )

      const poolAddress = await factoryContract.getPool(
        await getAddress(token0),
        await getAddress(token1),
        500
      )
      pool = await ethers.getContractAt('XFUELPool', poolAddress)

      // Set router as fee recipient
      const factoryAddr = await getAddress(factoryContract)
      await ethers.provider.send('hardhat_impersonateAccount', [factoryAddr])
      await ethers.provider.send('hardhat_setBalance', [factoryAddr, '0x1000000000000000000'])
      const factorySigner = await ethers.getSigner(factoryAddr)
      await pool.connect(factorySigner).setFeeRecipient(await getAddress(router))
    })

    it('Should handle zero fees gracefully', async function () {
      // No fees accumulated yet
      await router.collectAndDistributeFees(await getAddress(pool))
      
      expect(await router.totalFeesCollected()).to.equal(0)
      expect(await router.totalXFuelBurned()).to.equal(0)
      expect(await router.totalUSDCToVeXF()).to.equal(0)
    })

    it('Should revert if pool is zero address', async function () {
      await expect(
        router.collectAndDistributeFees(getZeroAddress())
      ).to.be.reverted
    })
  })

  describe('swap', function () {
    let pool, token0, token1

    beforeEach(async function () {
      // Deploy tokens
      const MockERC20 = await ethers.getContractFactory('MockERC20')
      token0 = await MockERC20.deploy('Token 0', 'TK0', 18)
      token1 = await MockERC20.deploy('Token 1', 'TK1', 18)
      await (token0.waitForDeployment?.() || token0.deployed?.())
      await (token1.waitForDeployment?.() || token1.deployed?.())

      // Deploy factory and create pool
      const XFUELPoolFactory = await ethers.getContractFactory('XFUELPoolFactory')
      const factoryContract = await XFUELPoolFactory.deploy()
      await (factoryContract.waitForDeployment?.() || factoryContract.deployed?.())

      const sqrtPriceX96 = '79228162514264337593543950336'
      await factoryContract.createPool(
        await getAddress(token0),
        await getAddress(token1),
        500,
        sqrtPriceX96
      )

      const poolAddress = await factoryContract.getPool(
        await getAddress(token0),
        await getAddress(token1),
        500
      )
      pool = await ethers.getContractAt('XFUELPool', poolAddress)

      // Add liquidity to pool
      const liquidityAmount = parseEther('1000')
      const poolAddr = await getAddress(pool)
      await token0.mint(poolAddr, liquidityAmount)
      await token1.mint(poolAddr, liquidityAmount)
    })

    it('Should execute swap through router', async function () {
      const swapAmount = parseEther('1')
      const poolAddr = await getAddress(pool)
      const recipientAddr = await getAddress(user)
      const routerAddr = await getAddress(router)
      const userAddr = await getAddress(user)
      
      // Mint tokens to user with extra for gas/rounding
      await token0.mint(userAddr, swapAmount.mul(2))
      // Approve router to transfer tokens from user
      const approveTx = await token0.connect(user).approve(routerAddr, swapAmount.mul(2))
      await approveTx.wait()
      
      // Mine block to ensure approval is processed
      await ethers.provider.send('evm_mine', [])
      
      // Increase time and mine again to ensure state is fully settled
      await hre.network.provider.request({
        method: 'evm_increaseTime',
        params: [1]
      })
      await ethers.provider.send('evm_mine', [])
      
      // Verify approval with explicit logging
      const allowance = await token0.allowance(userAddr, routerAddr)
      console.log(`[DEBUG] Router swap test - Allowance: ${allowance.toString()}, swapAmount: ${swapAmount.toString()}`)
      expect(allowance.gte(swapAmount)).to.equal(true)

      const recipientBalance1Before = await token1.balanceOf(recipientAddr)

      await router.connect(user).swap(
        poolAddr,
        true, // zeroForOne
        swapAmount,
        recipientAddr,
        0 // minAmountOut
      )

      const recipientBalance1After = await token1.balanceOf(recipientAddr)
      expect(recipientBalance1After.gt(recipientBalance1Before)).to.equal(true)
    })

    it('Should revert if pool is zero address', async function () {
      await expect(
        router.connect(user).swap(
          getZeroAddress(),
          true,
          parseEther('1'),
          await getAddress(user),
          0
        )
      ).to.be.reverted
    })

    it('Should revert if recipient is zero address', async function () {
      const swapAmount = parseEther('1')
      const poolAddr = await getAddress(pool)
      const routerAddr = await getAddress(router)
      const userAddr = await getAddress(user)
      await token0.mint(userAddr, swapAmount)
      const approveTx = await token0.connect(user).approve(routerAddr, swapAmount)
      await approveTx.wait()
      await ethers.provider.send('evm_mine', [])
      
      // Increase time and mine again to ensure state is fully settled
      await hre.network.provider.request({
        method: 'evm_increaseTime',
        params: [1]
      })
      await ethers.provider.send('evm_mine', [])
      
      // Verify approval
      const allowance = await token0.allowance(userAddr, routerAddr)
      console.log(`[DEBUG] Router zero address test - Allowance: ${allowance.toString()}, swapAmount: ${swapAmount.toString()}`)
      expect(allowance.gte(swapAmount)).to.equal(true)

      await expect(
        router.connect(user).swap(
          poolAddr,
          true,
          swapAmount,
          getZeroAddress(),
          0
        )
      ).to.be.reverted
    })
  })
})

