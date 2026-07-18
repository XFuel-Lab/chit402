/**
 * Core Layer — ModelRegistry Hardhat Tests (Verified Inference Phase 1 — PoMA)
 *
 * Run: npx hardhat test core-layer/test/ModelRegistry.test.cjs
 *
 * Covers: registration + 1-based versioning, immutability/append-only, global commitment
 * uniqueness, retire (commitment stays readable), verifyCommitment/lookup, roles, pause.
 *
 * Note: .to.be.reverted is used instead of .revertedWithCustomError — hardhat-chai-matchers@1.x
 * is not compatible with ethers v6 for custom-error matching (see ZKVerifierSP1.test.cjs).
 */

const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('ModelRegistry', function () {
  let registry;
  let admin, registrar, user;

  const MODEL_ID = ethers.keccak256(ethers.toUtf8Bytes('llama-3-70b@q4_k_m'));
  const MODEL_ID_2 = ethers.keccak256(ethers.toUtf8Bytes('tinyllama-1.1b@fp16'));
  const COMMIT_A = ethers.keccak256(ethers.toUtf8Bytes('weights-A'));
  const COMMIT_B = ethers.keccak256(ethers.toUtf8Bytes('weights-B'));
  const COMMIT_C = ethers.keccak256(ethers.toUtf8Bytes('weights-C'));

  // CommitmentScheme enum
  const KECCAK_MERKLE = 0;
  const MLE_POLY = 1;

  async function register(modelId, commitment, opts = {}) {
    return registry.registerModel(
      modelId,
      commitment,
      opts.scheme ?? KECCAK_MERKLE,
      opts.arch ?? 'llama-3',
      opts.quant ?? 'q4_k_m',
      opts.uri ?? 'ipfs://manifest'
    );
  }

  beforeEach(async function () {
    [admin, registrar, user] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory('ModelRegistry');
    registry = await Factory.deploy(admin.address);
    await registry.waitForDeployment();
  });

  describe('Deployment', function () {
    it('grants admin all roles', async function () {
      expect(await registry.hasRole(await registry.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
      expect(await registry.hasRole(await registry.REGISTRAR_ROLE(), admin.address)).to.be.true;
      expect(await registry.hasRole(await registry.OPERATOR_ROLE(), admin.address)).to.be.true;
    });

    it('reverts on zero admin', async function () {
      const Factory = await ethers.getContractFactory('ModelRegistry');
      await expect(Factory.deploy(ethers.ZeroAddress)).to.be.reverted;
    });

    it('starts with zero stats', async function () {
      expect(await registry.modelCount()).to.equal(0n);
      expect(await registry.totalVersions()).to.equal(0n);
      expect(await registry.latestVersion(MODEL_ID)).to.equal(0n);
    });
  });

  describe('Registration & versioning', function () {
    it('registers version 1 (1-based) and emits event', async function () {
      await expect(register(MODEL_ID, COMMIT_A))
        .to.emit(registry, 'ModelRegistered')
        .withArgs(MODEL_ID, 1n, COMMIT_A, KECCAK_MERKLE, admin.address);

      expect(await registry.latestVersion(MODEL_ID)).to.equal(1n);
      expect(await registry.versionCount(MODEL_ID)).to.equal(1n);
      expect(await registry.modelCount()).to.equal(1n);
      expect(await registry.totalVersions()).to.equal(1n);
    });

    it('appends incrementing versions for the same model', async function () {
      await register(MODEL_ID, COMMIT_A);
      await register(MODEL_ID, COMMIT_B, { quant: 'q5_k_m' });
      expect(await registry.latestVersion(MODEL_ID)).to.equal(2n);
      expect(await registry.versionCount(MODEL_ID)).to.equal(2n);
      // modelCount counts distinct models, not versions
      expect(await registry.modelCount()).to.equal(1n);
      expect(await registry.totalVersions()).to.equal(2n);
    });

    it('tracks distinct models independently', async function () {
      await register(MODEL_ID, COMMIT_A);
      await register(MODEL_ID_2, COMMIT_B);
      expect(await registry.modelCount()).to.equal(2n);
      expect(await registry.latestVersion(MODEL_ID)).to.equal(1n);
      expect(await registry.latestVersion(MODEL_ID_2)).to.equal(1n);
    });

    it('stores immutable version data', async function () {
      await register(MODEL_ID, COMMIT_A, { scheme: MLE_POLY, arch: 'llama-3', quant: 'q4_k_m', uri: 'ipfs://x' });
      const v = await registry.getModel(MODEL_ID, 1);
      expect(v.commitment).to.equal(COMMIT_A);
      expect(v.scheme).to.equal(BigInt(MLE_POLY));
      expect(v.arch).to.equal('llama-3');
      expect(v.quant).to.equal('q4_k_m');
      expect(v.metadataURI).to.equal('ipfs://x');
      expect(v.registrar).to.equal(admin.address);
      expect(v.registeredAt).to.be.gt(0n);
    });

    it('getLatestModel returns the newest version', async function () {
      await register(MODEL_ID, COMMIT_A);
      await register(MODEL_ID, COMMIT_B);
      const v = await registry.getLatestModel(MODEL_ID);
      expect(v.commitment).to.equal(COMMIT_B);
    });

    it('rejects zero commitment', async function () {
      await expect(register(MODEL_ID, ethers.ZeroHash)).to.be.reverted;
    });

    it('rejects duplicate commitment globally (across models)', async function () {
      await register(MODEL_ID, COMMIT_A);
      await expect(register(MODEL_ID_2, COMMIT_A)).to.be.reverted;
    });
  });

  describe('Verification & lookup', function () {
    beforeEach(async function () {
      await register(MODEL_ID, COMMIT_A);
      await register(MODEL_ID, COMMIT_B);
    });

    it('verifyCommitment true for matching active version', async function () {
      expect(await registry.verifyCommitment(MODEL_ID, 1, COMMIT_A)).to.be.true;
      expect(await registry.verifyCommitment(MODEL_ID, 2, COMMIT_B)).to.be.true;
    });

    it('verifyCommitment false for mismatch / wrong version (downgrade detection)', async function () {
      expect(await registry.verifyCommitment(MODEL_ID, 1, COMMIT_B)).to.be.false;
      expect(await registry.verifyCommitment(MODEL_ID, 2, COMMIT_A)).to.be.false;
      expect(await registry.verifyCommitment(MODEL_ID, 99, COMMIT_A)).to.be.false;
    });

    it('lookupCommitment resolves (modelId, version)', async function () {
      const [mId, ver] = await registry.lookupCommitment(COMMIT_B);
      expect(mId).to.equal(MODEL_ID);
      expect(ver).to.equal(2n);
    });

    it('lookupCommitment returns zero for unknown commitment', async function () {
      const [mId, ver] = await registry.lookupCommitment(COMMIT_C);
      expect(mId).to.equal(ethers.ZeroHash);
      expect(ver).to.equal(0n);
    });

    it('isActive reflects registered/retired state', async function () {
      expect(await registry.isActive(MODEL_ID, 1)).to.be.true;
      expect(await registry.isActive(MODEL_ID, 0)).to.be.false;
      expect(await registry.isActive(MODEL_ID, 99)).to.be.false;
    });
  });

  describe('Retire', function () {
    beforeEach(async function () {
      await register(MODEL_ID, COMMIT_A);
    });

    it('retires a version, commitment stays readable, verify goes false', async function () {
      await expect(registry.retireVersion(MODEL_ID, 1))
        .to.emit(registry, 'ModelVersionRetired')
        .withArgs(MODEL_ID, 1n);

      expect(await registry.isActive(MODEL_ID, 1)).to.be.false;
      // commitment still readable (historical receipts remain resolvable)
      const v = await registry.getModel(MODEL_ID, 1);
      expect(v.commitment).to.equal(COMMIT_A);
      const [mId] = await registry.lookupCommitment(COMMIT_A);
      expect(mId).to.equal(MODEL_ID);
      // but verifyCommitment (active-only) now false
      expect(await registry.verifyCommitment(MODEL_ID, 1, COMMIT_A)).to.be.false;
    });

    it('reverts retiring twice', async function () {
      await registry.retireVersion(MODEL_ID, 1);
      await expect(registry.retireVersion(MODEL_ID, 1)).to.be.reverted;
    });

    it('reverts retiring unknown model/version', async function () {
      await expect(registry.retireVersion(MODEL_ID_2, 1)).to.be.reverted;
      await expect(registry.retireVersion(MODEL_ID, 99)).to.be.reverted;
    });
  });

  describe('Access control', function () {
    it('non-registrar cannot register', async function () {
      await expect(
        registry.connect(user).registerModel(MODEL_ID, COMMIT_A, KECCAK_MERKLE, 'a', 'q', 'u')
      ).to.be.reverted;
    });

    it('granted registrar can register', async function () {
      await registry.grantRole(await registry.REGISTRAR_ROLE(), registrar.address);
      await expect(
        registry.connect(registrar).registerModel(MODEL_ID, COMMIT_A, KECCAK_MERKLE, 'a', 'q', 'u')
      ).to.emit(registry, 'ModelRegistered');
    });

    it('non-registrar cannot retire', async function () {
      await register(MODEL_ID, COMMIT_A);
      await expect(registry.connect(user).retireVersion(MODEL_ID, 1)).to.be.reverted;
    });
  });

  describe('Pause', function () {
    it('blocks registration while paused, allows after unpause', async function () {
      await registry.pause();
      await expect(register(MODEL_ID, COMMIT_A)).to.be.reverted;
      await registry.unpause();
      await expect(register(MODEL_ID, COMMIT_A)).to.emit(registry, 'ModelRegistered');
    });

    it('only operator can pause', async function () {
      await expect(registry.connect(user).pause()).to.be.reverted;
    });

    it('reads still work while paused', async function () {
      await register(MODEL_ID, COMMIT_A);
      await registry.pause();
      expect(await registry.verifyCommitment(MODEL_ID, 1, COMMIT_A)).to.be.true;
    });
  });

  describe('Unknown reads', function () {
    it('getModel reverts for unknown model', async function () {
      await expect(registry.getModel(MODEL_ID, 1)).to.be.reverted;
    });

    it('getLatestModel reverts for unknown model', async function () {
      await expect(registry.getLatestModel(MODEL_ID)).to.be.reverted;
    });
  });
});
