const { expect } = require('chai')
const assert = require('assert')
const { ethers } = require('hardhat')

// Helper to support both ethers v5 (utils.parseEther) and v6 (parseEther)
const parseEther = (value) => {
  if (typeof ethers.parseEther === 'function') {
    return ethers.parseEther(value)
  }
  return ethers.utils.parseEther(value)
}

describe('MockXFUELRouter', function () {
  let router
  let owner
  let user

  beforeEach(async function () {
    // Get signers
    ;[owner, user] = await ethers.getSigners()

    // Deploy the mock router contract
    const MockXFUELRouterFactory = await ethers.getContractFactory('MockXFUELRouter')
    router = await MockXFUELRouterFactory.deploy()

    // Support both ethers v5 (deployed) and v6 (waitForDeployment)
    if (typeof router.waitForDeployment === 'function') {
      await router.waitForDeployment()
    } else if (typeof router.deployed === 'function') {
      await router.deployed()
    }
  })

  describe('swapAndStake', function () {
    it('should swap 1 TFUEL and emit SwapAndStake event', async function () {
      // 1 TFUEL = 1e18 wei
      const tfuelAmount = parseEther('1')
      const stakeTarget = 'pSTAKE BTC'

      // Call swapAndStake and wait for the transaction
      const tx = await router.connect(user).swapAndStake(tfuelAmount, stakeTarget)
      const receipt = await tx.wait()

      // Check that the event was emitted
      expect(receipt).to.not.be.null
      expect(receipt).to.not.be.undefined
      
      if (receipt) {
        const event = receipt.logs.find(
          (log) => {
            try {
              const parsed = router.interface.parseLog(log)
              return parsed?.name === 'SwapAndStake'
            } catch {
              return false
            }
          }
        )

        expect(event).to.not.be.undefined

        if (event) {
          const parsedEvent = router.interface.parseLog(event)

          // Use Node's assert to avoid hardhat-chai-matchers address/Bignumber helpers,
          // which are version-sensitive across ethers v5/v6.
          const [userArg, tfuelArg, stakedArg, stakeTargetArg] = parsedEvent.args
          assert.strictEqual(userArg, await user.getAddress()) // user
          assert.strictEqual(tfuelArg.toString(), tfuelAmount.toString()) // tfuelAmount
          assert.strictEqual(stakedArg.toString(), parseEther('0.95').toString()) // stakedAmount
          assert.strictEqual(stakeTargetArg, stakeTarget) // stakeTarget
        }
      }
    })
  })
})

