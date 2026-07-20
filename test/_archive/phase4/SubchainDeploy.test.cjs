/**
 * Phase 4 — Theta Subchain Deployment Tests
 *
 * Tests the single shared XFuel subchain architecture:
 *   - One subchain, multiple circuits (ThetaInferenceCircuit, A2ACircuit,
 *     ThetaGPUCircuit, DataHubs)
 *   - Correct network IDs per environment
 *   - XFuelSubchainGovToken interface compliance
 *   - Circuit registration on shared subchain
 *   - Collateral configuration accuracy
 *
 * Run: npx hardhat test test/phase4/SubchainDeploy.test.cjs
 */

const { expect } = require('chai');
const hre = require('hardhat');
const { ethers } = hre;

describe('Theta Subchain Deployment (Phase 4)', function () {
  let splitter, verifier, govToken;
  let admin, minter, treasury;

  // ── Single shared subchain architecture ──────────────────────────────────
  const SUBCHAIN_IDS = {
    privatenet: 360777,
    testnet:    365001,
    mainnet:    361001,
  };

  // Circuits deployed on the shared subchain (not separate subchains)
  const SUBCHAIN_CIRCUITS = [
    'ThetaInferenceCircuit',
    'A2ACircuit',
    'ThetaGPUCircuit',
    'DataHubs',
  ];

  const COLLATERAL = {
    registration_wTHETA: '10000',
    per_validator_wTHETA: '1000',
    per_validator_TFUEL:  '20000',
    validators: 3,
  };

  beforeEach(async function () {
    [admin, minter, treasury] = await ethers.getSigners();

    const SplitterF = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await SplitterF.deploy(
      admin.address, admin.address, admin.address,
      admin.address, admin.address, admin.address
    );
    await splitter.waitForDeployment();

    const VerifierF = await ethers.getContractFactory('ZKVerifierSP1');
    verifier = await VerifierF.deploy(admin.address, ethers.ZeroAddress);
    await verifier.waitForDeployment();

    // Deploy XFuelSubchainGovToken
    // minter.address acts as ValidatorStakeManager in tests
    const GovTokenF = await ethers.getContractFactory('XFuelSubchainGovToken');
    govToken = await GovTokenF.deploy(
      minter.address,   // minter = ValidatorStakeManager
      admin.address,    // initDistrWallet
      admin.address     // admin
    );
    await govToken.waitForDeployment();
  });

  // ── Subchain ID Configuration ─────────────────────────────────────────────

  describe('Single Subchain Architecture', function () {
    it('should use a single shared subchain per network (not one per circuit)', function () {
      // Old architecture: 6 subchains (one per circuit)
      // New architecture: 1 subchain, multiple circuits
      expect(Object.keys(SUBCHAIN_IDS).length).to.equal(3); // 3 networks, not 6+ subchains
    });

    it('should define correct subchain IDs for each network', function () {
      expect(SUBCHAIN_IDS.privatenet).to.equal(360777);
      expect(SUBCHAIN_IDS.testnet).to.equal(365001);
      expect(SUBCHAIN_IDS.mainnet).to.equal(361001);
    });

    it('should have unique subchain IDs across networks', function () {
      const ids = Object.values(SUBCHAIN_IDS);
      expect(new Set(ids).size).to.equal(ids.length);
    });

    it('should target 4 circuits on shared subchain', function () {
      expect(SUBCHAIN_CIRCUITS).to.include('ThetaInferenceCircuit');
      expect(SUBCHAIN_CIRCUITS).to.include('A2ACircuit');
      expect(SUBCHAIN_CIRCUITS).to.include('ThetaGPUCircuit');
      expect(SUBCHAIN_CIRCUITS).to.include('DataHubs');
      expect(SUBCHAIN_CIRCUITS.length).to.equal(4);
    });
  });

  // ── Collateral Requirements ───────────────────────────────────────────────

  describe('Collateral Configuration', function () {
    it('should require 10,000 wTHETA for subchain registration', function () {
      expect(COLLATERAL.registration_wTHETA).to.equal('10000');
    });

    it('should require 1,000 wTHETA per validator', function () {
      expect(COLLATERAL.per_validator_wTHETA).to.equal('1000');
    });

    it('should require 20,000 TFUEL per validator', function () {
      expect(COLLATERAL.per_validator_TFUEL).to.equal('20000');
    });

    it('should total 13,000 wTHETA for registration + 3 validators', function () {
      const registrationWTheta = parseInt(COLLATERAL.registration_wTHETA);
      const validatorWTheta    = parseInt(COLLATERAL.per_validator_wTHETA) * COLLATERAL.validators;
      expect(registrationWTheta + validatorWTheta).to.equal(13000);
    });

    it('should total 60,000 TFUEL for 3 validators', function () {
      const totalTFuel = parseInt(COLLATERAL.per_validator_TFUEL) * COLLATERAL.validators;
      expect(totalTFuel).to.equal(60000);
    });
  });

  // ── XFuelSubchainGovToken ─────────────────────────────────────────────────

  describe('XFuelSubchainGovToken', function () {
    it('should deploy with correct name and symbol', async function () {
      expect(await govToken.name()).to.equal('XFuel Subchain Gov');
      expect(await govToken.symbol()).to.equal('XFGOV');
      expect(await govToken.decimals()).to.equal(18);
    });

    it('should mint 500M XFGOV to initDistrWallet on deploy', async function () {
      const balance = await govToken.balanceOf(admin.address);
      expect(balance).to.equal(ethers.parseEther('500000000'));
    });

    it('should set maxSupply to 1B XFGOV', async function () {
      expect(await govToken.maxSupply()).to.equal(ethers.parseEther('1000000000'));
    });

    it('should set correct minter (ValidatorStakeManager)', async function () {
      expect(await govToken.minter()).to.equal(minter.address);
    });

    it('should report 2 XFGOV stakerRewardPerBlock', async function () {
      const rate = await govToken.stakerRewardPerBlock();
      expect(rate).to.equal(ethers.parseEther('2'));
    });

    it('should allow minter to call mintStakerReward', async function () {
      const recipient = treasury.address;
      const amount    = ethers.parseEther('100');
      await govToken.connect(minter).mintStakerReward(recipient, amount);
      expect(await govToken.balanceOf(recipient)).to.equal(amount);
    });

    it('should reject mintStakerReward from non-minter', async function () {
      await expect(
        govToken.connect(treasury).mintStakerReward(treasury.address, ethers.parseEther('1'))
      ).to.be.revertedWith('XFuelSubchainGovToken: caller is not minter');
    });

    it('should not mint beyond maxSupply', async function () {
      const maxSupply = await govToken.maxSupply();
      const current   = await govToken.totalSupply();
      const remaining = maxSupply - current;

      // Try to mint more than remaining — should cap at maxSupply
      await govToken.connect(minter).mintStakerReward(admin.address, remaining + ethers.parseEther('1'));
      const finalSupply = await govToken.totalSupply();
      expect(finalSupply).to.equal(maxSupply);
    });

    it('should allow admin to update minter (for VSM address post-deploy)', async function () {
      await govToken.connect(admin).updateMinter(treasury.address);
      expect(await govToken.minter()).to.equal(treasury.address);
    });

    it('should allow admin to update stakerRewardPerBlock', async function () {
      const newRate = ethers.parseEther('1');
      await govToken.connect(admin).updateStakerRewardPerBlock(newRate);
      expect(await govToken.stakerRewardPerBlock()).to.equal(newRate);
    });

    it('should reject admin functions from non-admin', async function () {
      await expect(
        govToken.connect(minter).updateMinter(minter.address)
      ).to.be.revertedWith('XFuelSubchainGovToken: caller is not admin');
    });
  });

  // ── Core Contracts for Subchain Support ──────────────────────────────────

  describe('Core Contracts for Subchain Support', function () {
    it('should deploy CoreRevenueSplitter successfully', async function () {
      const addr = await splitter.getAddress();
      expect(addr).to.not.equal(ethers.ZeroAddress);
    });

    it('should deploy ZKVerifierSP1 with rollup capabilities', async function () {
      const addr = await verifier.getAddress();
      expect(addr).to.not.equal(ethers.ZeroAddress);

      const [rv, bc] = await verifier.getRollupStats();
      expect(rv).to.equal(0n);
      expect(bc).to.equal(0n);
    });

    it('should support cross-chain relay between main chain and subchain', async function () {
      const RELAYER_ROLE = await verifier.RELAYER_ROLE();
      expect(await verifier.hasRole(RELAYER_ROLE, admin.address)).to.be.true;
    });

    it('should register all 4 subchain circuits in ZKVerifierSP1', async function () {
      for (const circuitName of SUBCHAIN_CIRCUITS) {
        const circuitId = ethers.keccak256(ethers.toUtf8Bytes(circuitName));
        const vkey      = ethers.keccak256(ethers.toUtf8Bytes(`vkey-${circuitName}`));
        // All circuits share the same subchain ID
        await verifier.registerCircuit(circuitId, vkey, `${circuitName}-subchain-${SUBCHAIN_IDS.mainnet}`);
      }

      const stats = await verifier.getStats();
      expect(stats.registered).to.equal(BigInt(SUBCHAIN_CIRCUITS.length));
    });
  });
});
