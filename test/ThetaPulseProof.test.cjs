const { expect } = require('chai')
const { ethers, upgrades } = require('hardhat')
const hre = require('hardhat')
const { getAddress, parseEther } = require('./helpers.cjs')

describe('ThetaPulseProof', function () {
  let pulseProof, veXF, xfToken
  let owner, user1, edgeNode1, edgeNode2, unauthorized
  let MockERC20

  beforeEach(async function () {
    // Reset network state
    await hre.network.provider.request({
      method: 'hardhat_reset',
      params: []
    })

    ;[owner, user1, edgeNode1, edgeNode2, unauthorized] = await ethers.getSigners()

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

    // Deploy ThetaPulseProof
    const ThetaPulseProof = await ethers.getContractFactory('ThetaPulseProof')
    pulseProof = await upgrades.deployProxy(ThetaPulseProof, [
      await getAddress(veXF),
      await getAddress(owner)
    ], { initializer: 'initialize' })
    await (pulseProof.waitForDeployment?.() || pulseProof.deployed?.())

    // Set ThetaPulseProof in veXF
    await veXF.setPulseProofContract(await getAddress(pulseProof))

    // Authorize edge nodes
    await pulseProof.authorizeSigner(await getAddress(edgeNode1))
    await pulseProof.authorizeSigner(await getAddress(edgeNode2))
  })

  afterEach(async function () {
    await hre.network.provider.request({
      method: 'hardhat_reset',
      params: []
    })
  })

  describe('Deployment', function () {
    it('Should initialize with correct veXF address', async function () {
      expect(await pulseProof.veXFContract()).to.equal(await getAddress(veXF))
    })

    it('Should set the correct owner', async function () {
      expect(await pulseProof.owner()).to.equal(await getAddress(owner))
    })

    it('Should revert if initialized with zero address', async function () {
      const ThetaPulseProof = await ethers.getContractFactory('ThetaPulseProof')
      await expect(
        upgrades.deployProxy(ThetaPulseProof, [
          ethers.ZeroAddress,
          await getAddress(owner)
        ], { initializer: 'initialize' })
      ).to.be.revertedWith('ThetaPulseProof: invalid veXF')

      await expect(
        upgrades.deployProxy(ThetaPulseProof, [
          await getAddress(veXF),
          ethers.ZeroAddress
        ], { initializer: 'initialize' })
      ).to.be.revertedWith('ThetaPulseProof: invalid owner')
    })
  })

  describe('Signer Management', function () {
    it('Should authorize a signer', async function () {
      const newSigner = await ethers.getSigner(await ethers.Wallet.createRandom().getAddress())
      await pulseProof.authorizeSigner(await getAddress(newSigner))
      
      expect(await pulseProof.authorizedSigners(await getAddress(newSigner))).to.be.true
    })

    it('Should revoke a signer', async function () {
      expect(await pulseProof.authorizedSigners(await getAddress(edgeNode1))).to.be.true
      
      await pulseProof.revokeSigner(await getAddress(edgeNode1))
      
      expect(await pulseProof.authorizedSigners(await getAddress(edgeNode1))).to.be.false
    })

    it('Should revert if non-owner tries to authorize signer', async function () {
      const newSigner = await ethers.getSigner(await ethers.Wallet.createRandom().getAddress())
      await expect(
        pulseProof.connect(unauthorized).authorizeSigner(await getAddress(newSigner))
      ).to.be.reverted // OpenZeppelin Ownable will revert with custom error
    })
  })

  describe('Proof Verification', function () {
    let nonce = 0

    // Helper to create a signature
    async function createSignature(signer, user, earnings, nonceValue) {
      const network = await ethers.provider.getNetwork()
      const chainId = network.chainId
      
      // Create message hash matching contract's implementation
      const messageHash = ethers.keccak256(
        ethers.solidityPacked(
          ['address', 'uint256', 'uint256', 'uint256'],
          [user, earnings, nonceValue, chainId]
        )
      )
      
      // Convert to Ethereum signed message hash (matches contract's toEthSignedMessageHash)
      // toEthSignedMessageHash adds "\x19Ethereum Signed Message:\n32" + hash, then hashes
      // signMessage does the same, so we can use it directly on the hash bytes
      const messageHashBytes = ethers.getBytes(messageHash)
      
      // signMessage will add the Ethereum message prefix and sign
      // This matches what toEthSignedMessageHash expects
      return await signer.signMessage(messageHashBytes)
    }

    it('Should verify a valid proof and grant 1.5x multiplier for Tier 1 earnings', async function () {
      const user = await getAddress(user1)
      const earnings = parseEther('15000') // 15k TFUEL (above Tier 1 threshold)
      const currentNonce = nonce++
      
      // Create signature
      const signature = await createSignature(edgeNode1, user, earnings, currentNonce)
      
      // Verify proof
      const tx = await pulseProof.verifyProof(user, earnings, currentNonce, signature)
      const receipt = await tx.wait()
      
      // Check event
      const event = receipt.logs.find(log => {
        try {
          const parsed = pulseProof.interface.parseLog(log)
          return parsed && parsed.name === 'ProofVerified'
        } catch {
          return false
        }
      })
      expect(event).to.not.be.undefined
      
      // Check total proven earnings
      expect(await pulseProof.totalProvenEarnings(user)).to.equal(earnings)
      
      // Check multiplier (15000 basis points = 1.5x)
      expect(await pulseProof.getMultiplier(user)).to.equal(15000)
      expect(await veXF.getPermanentMultiplier(user)).to.equal(15000)
    })

    it('Should grant 2x multiplier for Tier 2 earnings', async function () {
      const user = await getAddress(user1)
      const earnings = parseEther('60000') // 60k TFUEL (above Tier 2 threshold)
      const currentNonce = nonce++
      
      const signature = await createSignature(edgeNode1, user, earnings, currentNonce)
      
      await pulseProof.verifyProof(user, earnings, currentNonce, signature)
      
      expect(await pulseProof.getMultiplier(user)).to.equal(20000) // 2x
      expect(await veXF.getPermanentMultiplier(user)).to.equal(20000)
    })

    it('Should grant 3x multiplier for Tier 3 earnings', async function () {
      const user = await getAddress(user1)
      const earnings = parseEther('150000') // 150k TFUEL (above Tier 3 threshold)
      const currentNonce = nonce++
      
      const signature = await createSignature(edgeNode1, user, earnings, currentNonce)
      
      await pulseProof.verifyProof(user, earnings, currentNonce, signature)
      
      expect(await pulseProof.getMultiplier(user)).to.equal(30000) // 3x
      expect(await veXF.getPermanentMultiplier(user)).to.equal(30000)
    })

    it('Should accumulate earnings across multiple proofs', async function () {
      const user = await getAddress(user1)
      
      // First proof: 20k earnings (should get 1.5x)
      const earnings1 = parseEther('20000')
      const nonce1 = nonce++
      const signature1 = await createSignature(edgeNode1, user, earnings1, nonce1)
      await pulseProof.verifyProof(user, earnings1, nonce1, signature1)
      
      expect(await pulseProof.totalProvenEarnings(user)).to.equal(earnings1)
      expect(await pulseProof.getMultiplier(user)).to.equal(15000) // 1.5x
      
      // Second proof: 40k more earnings (total 60k, should get 2x)
      const earnings2 = parseEther('40000')
      const nonce2 = nonce++
      const signature2 = await createSignature(edgeNode1, user, earnings2, nonce2)
      await pulseProof.verifyProof(user, earnings2, nonce2, signature2)
      
      expect(await pulseProof.totalProvenEarnings(user)).to.equal(earnings1 + earnings2)
      expect(await pulseProof.getMultiplier(user)).to.equal(20000) // 2x (upgraded)
    })

    it('Should prevent replay attacks with same nonce', async function () {
      const user = await getAddress(user1)
      const earnings = parseEther('10000')
      const currentNonce = nonce++
      
      const signature = await createSignature(edgeNode1, user, earnings, currentNonce)
      
      // First verification should succeed
      await pulseProof.verifyProof(user, earnings, currentNonce, signature)
      
      // Second verification with same nonce should fail
      await expect(
        pulseProof.verifyProof(user, earnings, currentNonce, signature)
      ).to.be.revertedWith('ThetaPulseProof: proof already verified')
    })

    it('Should revert with unauthorized signer', async function () {
      const user = await getAddress(user1)
      const earnings = parseEther('10000')
      const currentNonce = nonce++
      
      // Create signature with unauthorized signer
      const signature = await createSignature(unauthorized, user, earnings, currentNonce)
      
      await expect(
        pulseProof.verifyProof(user, earnings, currentNonce, signature)
      ).to.be.revertedWith('ThetaPulseProof: unauthorized signer')
    })

    it('Should revert with invalid signature', async function () {
      const user = await getAddress(user1)
      const earnings = parseEther('10000')
      const currentNonce = nonce++
      
      // Invalid signature (random bytes)
      const invalidSignature = '0x' + '00'.repeat(65)
      
      await expect(
        pulseProof.verifyProof(user, earnings, currentNonce, invalidSignature)
      ).to.be.reverted
    })

    it('Should revert with zero earnings', async function () {
      const user = await getAddress(user1)
      const earnings = 0
      const currentNonce = nonce++
      
      const signature = await createSignature(edgeNode1, user, earnings, currentNonce)
      
      await expect(
        pulseProof.verifyProof(user, earnings, currentNonce, signature)
      ).to.be.revertedWith('ThetaPulseProof: earnings must be > 0')
    })

    it('Should revert with zero address user', async function () {
      const user = ethers.ZeroAddress
      const earnings = parseEther('10000')
      const currentNonce = nonce++
      
      const signature = await createSignature(edgeNode1, user, earnings, currentNonce)
      
      await expect(
        pulseProof.verifyProof(user, earnings, currentNonce, signature)
      ).to.be.revertedWith('ThetaPulseProof: invalid user')
    })

    it('Should allow different edge nodes to sign proofs', async function () {
      const user = await getAddress(user1)
      const earnings1 = parseEther('10000')
      const earnings2 = parseEther('20000')
      const nonce1 = nonce++
      const nonce2 = nonce++
      
      // Sign with different edge nodes
      const signature1 = await createSignature(edgeNode1, user, earnings1, nonce1)
      const signature2 = await createSignature(edgeNode2, user, earnings2, nonce2)
      
      await pulseProof.verifyProof(user, earnings1, nonce1, signature1)
      await pulseProof.verifyProof(user, earnings2, nonce2, signature2)
      
      expect(await pulseProof.totalProvenEarnings(user)).to.equal(earnings1 + earnings2)
    })
  })

  describe('Multiplier Calculation', function () {
    it('Should return 1x multiplier for earnings below Tier 1', async function () {
      const user = await getAddress(user1)
      expect(await pulseProof.getMultiplier(user)).to.equal(10000) // 1x (no bonus)
    })

    it('Should calculate multipliers correctly for different earnings tiers', async function () {
      const user = await getAddress(user1)
      const network = await ethers.provider.getNetwork()
      const chainId = network.chainId
      
      // Helper to create signature
      const createSig = async (signer, earnings, nonceValue) => {
        const messageHash = ethers.keccak256(
          ethers.solidityPacked(
            ['address', 'uint256', 'uint256', 'uint256'],
            [user, earnings, nonceValue, chainId]
          )
        )
        const messageHashBytes = ethers.getBytes(messageHash)
        const ethSignedMessageHash = ethers.hashMessage(messageHashBytes)
        return await signer.signMessage(messageHashBytes)
      }
      
      let nonce = 0
      
      // Below Tier 1
      expect(await pulseProof.getMultiplier(user)).to.equal(10000)
      
      // Tier 1 (10k)
      const earnings1 = parseEther('10000')
      const sig1 = await createSig(edgeNode1, earnings1, nonce++)
      await pulseProof.verifyProof(user, earnings1, nonce - 1, sig1)
      expect(await pulseProof.getMultiplier(user)).to.equal(15000) // 1.5x
      
      // Tier 2 (50k)
      const earnings2 = parseEther('40000') // Total becomes 50k
      const sig2 = await createSig(edgeNode1, earnings2, nonce++)
      await pulseProof.verifyProof(user, earnings2, nonce - 1, sig2)
      expect(await pulseProof.getMultiplier(user)).to.equal(20000) // 2x
      
      // Tier 3 (100k)
      const earnings3 = parseEther('50000') // Total becomes 100k
      const sig3 = await createSig(edgeNode1, earnings3, nonce++)
      await pulseProof.verifyProof(user, earnings3, nonce - 1, sig3)
      expect(await pulseProof.getMultiplier(user)).to.equal(30000) // 3x
    })
  })

  describe('Integration with veXF', function () {
    it('Should set multiplier in veXF when proof is verified', async function () {
      const user = await getAddress(user1)
      const earnings = parseEther('15000')
      const network = await ethers.provider.getNetwork()
      const chainId = network.chainId
      const nonce = 0
      
      // Create signature
      const messageHash = ethers.keccak256(
        ethers.solidityPacked(
          ['address', 'uint256', 'uint256', 'uint256'],
          [user, earnings, nonce, chainId]
        )
      )
      const messageHashBytes = ethers.getBytes(messageHash)
      const ethSignedMessageHash = ethers.hashMessage(messageHashBytes)
      const signature = await edgeNode1.signMessage(messageHashBytes)
      
      // Verify proof
      await pulseProof.verifyProof(user, earnings, nonce, signature)
      
      // Check multiplier was set in veXF
      expect(await veXF.getPermanentMultiplier(user)).to.equal(15000) // 1.5x
    })

    it('Should update veXF multiplier when tier increases', async function () {
      const user = await getAddress(user1)
      const network = await ethers.provider.getNetwork()
      const chainId = network.chainId
      
      // Helper to create signature
      const createSig = async (signer, earnings, nonceValue) => {
        const messageHash = ethers.keccak256(
          ethers.solidityPacked(
            ['address', 'uint256', 'uint256', 'uint256'],
            [user, earnings, nonceValue, chainId]
          )
        )
        const messageHashBytes = ethers.getBytes(messageHash)
        return await signer.signMessage(messageHashBytes)
      }
      
      let nonce = 0
      
      // Start with Tier 1
      const earnings1 = parseEther('15000')
      const sig1 = await createSig(edgeNode1, earnings1, nonce++)
      await pulseProof.verifyProof(user, earnings1, nonce - 1, sig1)
      expect(await veXF.getPermanentMultiplier(user)).to.equal(15000) // 1.5x
      
      // Upgrade to Tier 2
      const earnings2 = parseEther('40000') // Total becomes 55k
      const sig2 = await createSig(edgeNode1, earnings2, nonce++)
      await pulseProof.verifyProof(user, earnings2, nonce - 1, sig2)
      expect(await veXF.getPermanentMultiplier(user)).to.equal(20000) // 2x (upgraded)
    })
  })

  describe('Upgradeability', function () {
    it('Should allow owner to upgrade', async function () {
      const ThetaPulseProof = await ethers.getContractFactory('ThetaPulseProof')
      const pulseProof2 = await upgrades.upgradeProxy(await getAddress(pulseProof), ThetaPulseProof)
      
      expect(await getAddress(pulseProof2)).to.equal(await getAddress(pulseProof))
    })
  })
})

