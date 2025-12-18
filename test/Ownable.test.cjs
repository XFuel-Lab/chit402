const { expect } = require('chai')
const { ethers } = require('hardhat')
const { getAddress, getZeroAddress } = require('./helpers.cjs')

describe('Ownable', function () {
  let ownable
  let owner, newOwner, user

  beforeEach(async function () {
    [owner, newOwner, user] = await ethers.getSigners()

    // Deploy a contract that uses Ownable (using TipPool as example)
    const TipPool = await ethers.getContractFactory('TipPool')
    ownable = await TipPool.deploy()
    await ownable.waitForDeployment?.() || await ownable.deployed?.()
  })

  describe('Deployment', function () {
    it('Should set the correct owner', async function () {
      const ownerAddr = await getAddress(owner)
      expect((await ownable.owner()).toLowerCase()).to.equal(ownerAddr.toLowerCase())
    })
  })

  describe('transferOwnership', function () {
    it('Should allow owner to transfer ownership', async function () {
      const ownerAddr = await getAddress(owner)
      const newOwnerAddr = await getAddress(newOwner)

      await expect(
        ownable.connect(owner).transferOwnership(newOwnerAddr)
      ).to.emit(ownable, 'OwnershipTransferred')
        .withArgs(ownerAddr, newOwnerAddr)

      expect((await ownable.owner()).toLowerCase()).to.equal(newOwnerAddr.toLowerCase())
    })

    it('Should revert if called by non-owner', async function () {
      const newOwnerAddr = await getAddress(newOwner)
      await expect(
        ownable.connect(user).transferOwnership(newOwnerAddr)
      ).to.be.revertedWith('Ownable: caller is not the owner')
    })

    it('Should revert if new owner is zero address', async function () {
      await expect(
        ownable.connect(owner).transferOwnership(getZeroAddress())
      ).to.be.revertedWith('Ownable: new owner is the zero address')
    })

    it('Should allow new owner to transfer ownership again', async function () {
      const newOwnerAddr = await getAddress(newOwner)
      const userAddr = await getAddress(user)

      // First transfer
      await ownable.connect(owner).transferOwnership(newOwnerAddr)

      // Second transfer by new owner
      await expect(
        ownable.connect(newOwner).transferOwnership(userAddr)
      ).to.emit(ownable, 'OwnershipTransferred')
        .withArgs(newOwnerAddr, userAddr)

      expect((await ownable.owner()).toLowerCase()).to.equal(userAddr.toLowerCase())
    })
  })
})

