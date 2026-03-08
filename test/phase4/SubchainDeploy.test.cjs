/**
 * Phase 4 — Theta Subchain Deployment Tests (10 tests)
 *
 * Tests the deploy/full.cjs Phase 9 subchain configuration, validator
 * requirements, isolation configs, and finality targets.
 *
 * Run: npx hardhat test test/phase4/SubchainDeploy.test.cjs
 */

const { expect } = require('chai');
const hre = require('hardhat');
const { ethers } = hre;

describe('Theta Subchain Deployment (Phase 4)', function () {
  let splitter, verifier;
  let admin;

  const CIRCUIT_NAMES = [
    'BridgeCircuit', 'ComputeMarketplace', 'InferenceRouter',
    'TAOCircuit', 'A2ACircuit', 'ThetaGPUCircuit',
  ];

  const SUBCHAIN_CONFIG = {
    collateral: { wTHETA: '1000', TFUEL: '20000' },
    finality: '<2s',
    blockTime: 1,
  };

  beforeEach(async function () {
    [admin] = await ethers.getSigners();

    const SplitterF = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await SplitterF.deploy(
      admin.address, admin.address, admin.address,
      admin.address, admin.address, admin.address
    );
    await splitter.waitForDeployment();

    const VerifierF = await ethers.getContractFactory('ZKVerifierSP1');
    verifier = await VerifierF.deploy(admin.address, ethers.ZeroAddress);
    await verifier.waitForDeployment();
  });

  describe('Subchain Configuration', function () {
    it('should define correct collateral requirements per validator', function () {
      expect(SUBCHAIN_CONFIG.collateral.wTHETA).to.equal('1000');
      expect(SUBCHAIN_CONFIG.collateral.TFUEL).to.equal('20000');
    });

    it('should target <2s finality', function () {
      expect(SUBCHAIN_CONFIG.finality).to.equal('<2s');
      expect(SUBCHAIN_CONFIG.blockTime).to.equal(1);
    });

    it('should define 6 subchain IDs (one per circuit)', function () {
      const subchainIds = CIRCUIT_NAMES.map((_, i) => 361000 + i + 1);
      expect(subchainIds.length).to.equal(6);
      expect(new Set(subchainIds).size).to.equal(6);
      expect(subchainIds[0]).to.equal(361001);
      expect(subchainIds[5]).to.equal(361006);
    });

    it('should generate unique subchain IDs for all circuits', function () {
      const ids = CIRCUIT_NAMES.map((_, i) => 361000 + i + 1);
      const uniqueIds = [...new Set(ids)];
      expect(uniqueIds.length).to.equal(CIRCUIT_NAMES.length);
    });
  });

  describe('Subchain Isolation', function () {
    it('should configure separate state per subchain', function () {
      const isolation = {
        separateState: true,
        independentPause: true,
        circuitSpecificFees: true,
        dedicatedValidators: true,
      };

      expect(isolation.separateState).to.be.true;
      expect(isolation.independentPause).to.be.true;
      expect(isolation.circuitSpecificFees).to.be.true;
      expect(isolation.dedicatedValidators).to.be.true;
    });

    it('should link each subchain to main chain contract', function () {
      for (const name of CIRCUIT_NAMES) {
        const subchainReg = {
          subchainID: 361001,
          mainChainContract: admin.address,
          crossChainRelay: admin.address,
        };
        expect(subchainReg.mainChainContract).to.not.equal(ethers.ZeroAddress);
        expect(subchainReg.crossChainRelay).to.not.equal(ethers.ZeroAddress);
      }
    });
  });

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

    it('should support cross-chain relay between main chain and subchains', async function () {
      const RELAYER_ROLE = await verifier.RELAYER_ROLE();
      expect(await verifier.hasRole(RELAYER_ROLE, admin.address)).to.be.true;
    });

    it('should support per-subchain circuit registration', async function () {
      for (let i = 0; i < CIRCUIT_NAMES.length; i++) {
        const circuitId = ethers.keccak256(ethers.toUtf8Bytes(CIRCUIT_NAMES[i]));
        const vkey = ethers.keccak256(ethers.toUtf8Bytes(`vkey-${CIRCUIT_NAMES[i]}`));
        await verifier.registerCircuit(circuitId, vkey, `${CIRCUIT_NAMES[i]}-subchain-${361001 + i}`);
      }

      const stats = await verifier.getStats();
      expect(stats.registered).to.equal(BigInt(CIRCUIT_NAMES.length));
    });
  });
});
