const { expect } = require('chai')
const { ethers } = require('hardhat')

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
    await router.waitForDeployment()
  })

  describe('swapAndStake', function () {
    it('should swap 1 TFUEL and emit SwapAndStake event', async function () {
      // 1 TFUEL = 1e18 wei
      const tfuelAmount = ethers.parseEther('1')
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
          expect(parsedEvent.args[0]).to.equal(await user.getAddress()) // user
          expect(parsedEvent.args[1]).to.equal(tfuelAmount) // tfuelAmount
          expect(parsedEvent.args[2]).to.equal(ethers.parseEther('0.95')) // stakedAmount (95% of 1 TFUEL)
          expect(parsedEvent.args[3]).to.equal(stakeTarget) // stakeTarget
        }
      }
    })
  })
})

