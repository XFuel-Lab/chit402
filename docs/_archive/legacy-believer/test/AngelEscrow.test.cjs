/**
 * AngelEscrow — Hardhat tests
 *
 * Run: npx hardhat test believer/test/AngelEscrow.test.cjs
 */
const { expect } = require('chai');
const hre = require('hardhat');
const { ethers } = hre;

describe('AngelEscrow', function () {
  let escrow;
  let signer1, signer2, outsider, recipient, treasury;

  const AUDIT = 0;
  const SUBCHAIN = 1;
  const DEVOPS = 2;

  const AUDIT_CAP = ethers.parseEther('1000');
  const SUBCHAIN_CAP = ethers.parseEther('2000');
  const DEVOPS_CAP = ethers.parseEther('3000');

  beforeEach(async function () {
    [signer1, signer2, outsider, recipient, treasury] = await ethers.getSigners();

    const F = await ethers.getContractFactory('AngelEscrow');
    escrow = await F.deploy(
      [signer1.address, signer2.address],
      2,
      treasury.address,
      [AUDIT_CAP, SUBCHAIN_CAP, DEVOPS_CAP]
    );
    await escrow.waitForDeployment();
  });

  describe('Deployment', function () {
    it('sets immutable signer and bucket configuration', async function () {
      expect(await escrow.VERSION()).to.equal('1.0.0');
      expect(await escrow.threshold()).to.equal(2n);
      expect(await escrow.treasury()).to.equal(treasury.address);
      expect(await escrow.signerCount()).to.equal(2n);
      expect(await escrow.bucketCaps(AUDIT)).to.equal(AUDIT_CAP);
      expect(await escrow.bucketCaps(SUBCHAIN)).to.equal(SUBCHAIN_CAP);
      expect(await escrow.bucketCaps(DEVOPS)).to.equal(DEVOPS_CAP);
      expect(await escrow.outstandingObligations()).to.equal(AUDIT_CAP + SUBCHAIN_CAP + DEVOPS_CAP);
    });

    it('disables role mutation after deployment', async function () {
      const role = await escrow.SIGNER_ROLE();
      await expect(escrow.grantRole(role, outsider.address)).to.be.revertedWithCustomError(escrow, 'RoleMutationDisabled');
      await expect(escrow.revokeRole(role, signer1.address)).to.be.revertedWithCustomError(escrow, 'RoleMutationDisabled');
      await expect(escrow.connect(signer1).renounceRole(role, signer1.address)).to.be.revertedWithCustomError(
        escrow,
        'RoleMutationDisabled'
      );
    });
  });

  describe('Deposits', function () {
    it('tracks totalRaised and balance through receive()', async function () {
      const amount = ethers.parseEther('5');
      await signer1.sendTransaction({ to: await escrow.getAddress(), value: amount });

      expect(await escrow.totalRaised()).to.equal(amount);
      expect(await escrow.getBalance()).to.equal(amount);
    });

    it('tracks totalRaised and balance through deposit()', async function () {
      const amount = ethers.parseEther('7');
      await escrow.connect(outsider).deposit({ value: amount });

      expect(await escrow.totalRaised()).to.equal(amount);
      expect(await escrow.getBalance()).to.equal(amount);
    });
  });

  describe('Multisig approvals', function () {
    it('requires threshold approvals to change a bucket cap', async function () {
      const newCap = ethers.parseEther('1500');

      await expect(escrow.connect(signer1).setBucketCap(AUDIT, newCap))
        .to.emit(escrow, 'ActionApproved')
        .withArgs(await actionHashSetBucketCap(escrow, AUDIT, newCap), signer1.address, 1n, 2n);

      expect(await escrow.bucketCaps(AUDIT)).to.equal(AUDIT_CAP);

      await expect(escrow.connect(signer2).setBucketCap(AUDIT, newCap))
        .to.emit(escrow, 'BucketCapUpdated')
        .withArgs(AUDIT, AUDIT_CAP, newCap, await actionHashSetBucketCap(escrow, AUDIT, newCap));

      expect(await escrow.bucketCaps(AUDIT)).to.equal(newCap);
    });

    it('rejects duplicate approval for the same action hash by the same signer', async function () {
      const newCap = ethers.parseEther('1200');

      await escrow.connect(signer1).setBucketCap(AUDIT, newCap);
      await expect(escrow.connect(signer1).setBucketCap(AUDIT, newCap)).to.be.revertedWithCustomError(
        escrow,
        'ActionAlreadyApproved'
      );
    });

    it('blocks non-signers from privileged actions', async function () {
      await expect(escrow.connect(outsider).pause()).to.be.revertedWithCustomError(escrow, 'NotSigner');
    });

    it('uses multisig flow for pause and unpause', async function () {
      await escrow.connect(signer1).pause();
      expect(await escrow.paused()).to.equal(false);

      await escrow.connect(signer2).pause();
      expect(await escrow.paused()).to.equal(true);

      await escrow.connect(signer1).unpause();
      expect(await escrow.paused()).to.equal(true);

      await escrow.connect(signer2).unpause();
      expect(await escrow.paused()).to.equal(false);
    });
  });

  describe('Bucket releases and excess refunds', function () {
    beforeEach(async function () {
      await escrow.connect(outsider).deposit({ value: ethers.parseEther('10') });
    });

    it('releases TFUEL from a bucket after threshold approval', async function () {
      const releaseAmount = ethers.parseEther('4');

      await escrow.connect(signer1).releaseFromBucket(AUDIT, recipient.address, releaseAmount);

      const before = await ethers.provider.getBalance(recipient.address);
      await escrow.connect(signer2).releaseFromBucket(AUDIT, recipient.address, releaseAmount);
      const after = await ethers.provider.getBalance(recipient.address);

      expect(after - before).to.equal(releaseAmount);
      expect(await escrow.releasedFromBucket(AUDIT)).to.equal(releaseAmount);
      expect(await escrow.outstandingObligations()).to.equal(
        AUDIT_CAP + SUBCHAIN_CAP + DEVOPS_CAP - releaseAmount
      );
    });

    it('refunds all excess native balance above outstanding obligations to treasury', async function () {
      await escrow.connect(signer1).setBucketCap(AUDIT, ethers.parseEther('1'));
      await escrow.connect(signer2).setBucketCap(AUDIT, ethers.parseEther('1'));

      await escrow.connect(signer1).setBucketCap(SUBCHAIN, ethers.parseEther('2'));
      await escrow.connect(signer2).setBucketCap(SUBCHAIN, ethers.parseEther('2'));

      await escrow.connect(signer1).setBucketCap(DEVOPS, ethers.parseEther('3'));
      await escrow.connect(signer2).setBucketCap(DEVOPS, ethers.parseEther('3'));

      expect(await escrow.outstandingObligations()).to.equal(ethers.parseEther('6'));
      expect(await escrow.getBalance()).to.equal(ethers.parseEther('10'));

      await escrow.connect(signer1).refundExcessToTreasury();

      const before = await ethers.provider.getBalance(treasury.address);
      const tx = await escrow.connect(signer2).refundExcessToTreasury();
      await tx.wait();
      const after = await ethers.provider.getBalance(treasury.address);

      expect(after - before).to.equal(ethers.parseEther('4'));
      expect(await escrow.getBalance()).to.equal(ethers.parseEther('6'));
    });

    it('reverts refund when no excess exists', async function () {
      await expect(escrow.connect(signer1).refundExcessToTreasury()).to.be.revertedWithCustomError(
        escrow,
        'NoExcessAvailable'
      );
    });
  });
});

async function actionHashSetBucketCap(escrow, bucket, newCap) {
  const chainId = (await ethers.provider.getNetwork()).chainId;
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'uint256', 'bytes32', 'uint8', 'uint256'],
      [await escrow.getAddress(), chainId, ethers.keccak256(ethers.toUtf8Bytes('SET_BUCKET_CAP')), bucket, newCap]
    )
  );
}
