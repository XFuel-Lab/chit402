/**
 * ThetaInferenceCircuit — Branch Coverage Tests
 * Targets all uncovered conditional paths to push branch coverage above 80%.
 */

const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('ThetaInferenceCircuit — Branch Coverage', function () {
  this.timeout(60000);

  let circuit, splitter;
  let admin, relayer, user, user2, bbb, lp, staker, treasury, stakePool;

  const MOCK_INPUT = ethers.keccak256(ethers.toUtf8Bytes('test-input'));
  const MOCK_OUTPUT = ethers.keccak256(ethers.toUtf8Bytes('test-output'));
  const MOCK_MODEL = ethers.keccak256(ethers.toUtf8Bytes('llama-3.1'));
  const MOCK_PROOF = '0x' + 'ab'.repeat(130);
  const MOCK_PUB_VALS = '0x' + 'cd'.repeat(64);

  const ServiceType = { LLM_INFERENCE: 0, IMAGE_GENERATION: 1 };
  const GpuTier = { BASIC: 0, PRO: 1, ELITE: 2 };

  async function deployCircuit(splitterAddr, verifierAddr) {
    const F = await ethers.getContractFactory('ThetaInferenceCircuit');
    const c = await F.deploy(admin.address, splitterAddr || ethers.ZeroAddress, verifierAddr || ethers.ZeroAddress);
    await c.waitForDeployment();
    return c;
  }

  beforeEach(async function () {
    [admin, relayer, user, user2, bbb, lp, staker, treasury, stakePool] =
      await ethers.getSigners();

    const SplitterF = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await SplitterF.deploy(
      admin.address, bbb.address, lp.address,
      staker.address, treasury.address, stakePool.address
    );
    await splitter.waitForDeployment();

    circuit = await deployCircuit(await splitter.getAddress(), ethers.ZeroAddress);

    const RELAYER_ROLE = ethers.keccak256(ethers.toUtf8Bytes('RELAYER_ROLE'));
    await circuit.grantRole(RELAYER_ROLE, admin.address);
  });

  async function registerLLMService() {
    const tx = await circuit.registerService(
      ServiceType.LLM_INFERENCE, 'test-model',
      ethers.parseEther('0.01'), 5000
    );
    const receipt = await tx.wait();
    const event = receipt.logs.find(
      l => l.fragment && l.fragment.name === 'ServiceRegistered'
    );
    return event.args[0];
  }

  async function registerPresetFor(serviceId) {
    const tx = await circuit.registerPreset(
      'Quick LLaMA', ServiceType.LLM_INFERENCE, 'llama-3.1-70b',
      GpuTier.BASIC, 'Hello'
    );
    const receipt = await tx.wait();
    const event = receipt.logs.find(
      l => l.fragment && l.fragment.name === 'PresetRegistered'
    );
    return event.args[0];
  }

  // ─── updatePreset: PresetNotFound ───────────────────────────────────────

  describe('updatePreset branches', function () {
    it('reverts with PresetNotFound for unknown preset', async function () {
      const fakePreset = ethers.keccak256(ethers.toUtf8Bytes('NONEXISTENT'));
      await expect(circuit.updatePreset(fakePreset, true)).to.be.reverted;
    });

    it('successfully deactivates a valid preset', async function () {
      await registerLLMService();
      const presetId = await registerPresetFor();
      await expect(circuit.updatePreset(presetId, false)).to.not.be.reverted;
    });
  });

  // ─── updateService: ServiceNotFound ─────────────────────────────────────

  describe('updateService branches', function () {
    it('reverts with ServiceNotFound for unknown service', async function () {
      const fakeSvc = ethers.keccak256(ethers.toUtf8Bytes('NONEXISTENT'));
      await expect(circuit.updateService(fakeSvc, ethers.parseEther('0.02'), true))
        .to.be.reverted;
    });
  });

  // ─── getEffectivePrice: ServiceNotFound ─────────────────────────────────

  describe('getEffectivePrice branches', function () {
    it('reverts with ServiceNotFound for unknown service', async function () {
      const fakeSvc = ethers.keccak256(ethers.toUtf8Bytes('NONEXISTENT'));
      await expect(circuit.getEffectivePrice(fakeSvc, GpuTier.BASIC)).to.be.reverted;
    });
  });

  // ─── submitPresetIntent: preset inactive / service inactive ─────────────

  describe('submitPresetIntent branches', function () {
    it('reverts when preset not found', async function () {
      const fakePreset = ethers.keccak256(ethers.toUtf8Bytes('FAKE'));
      const serviceId = await registerLLMService();
      await expect(
        circuit.connect(user).submitPresetIntent(fakePreset, GpuTier.BASIC, serviceId, MOCK_INPUT, {
          value: ethers.parseEther('0.01'),
        })
      ).to.be.reverted;
    });

    it('reverts when preset is not active', async function () {
      const serviceId = await registerLLMService();
      const presetId = await registerPresetFor(serviceId);
      await circuit.updatePreset(presetId, false);

      await expect(
        circuit.connect(user).submitPresetIntent(presetId, GpuTier.BASIC, serviceId, MOCK_INPUT, {
          value: ethers.parseEther('0.01'),
        })
      ).to.be.reverted;
    });

    it('reverts when underlying service is not active', async function () {
      const serviceId = await registerLLMService();
      const presetId = await registerPresetFor(serviceId);
      await circuit.updateService(serviceId, ethers.parseEther('0.01'), false);

      await expect(
        circuit.connect(user).submitPresetIntent(presetId, GpuTier.BASIC, serviceId, MOCK_INPUT, {
          value: ethers.parseEther('0.01'),
        })
      ).to.be.reverted;
    });

    it('reverts when payment insufficient', async function () {
      const serviceId = await registerLLMService();
      const presetId = await registerPresetFor(serviceId);

      await expect(
        circuit.connect(user).submitPresetIntent(presetId, GpuTier.BASIC, serviceId, MOCK_INPUT, {
          value: 1,
        })
      ).to.be.reverted;
    });
  });

  // ─── submitIntent: service not found / not active / insufficient ────────

  describe('submitIntent branches', function () {
    it('reverts when service not found', async function () {
      const fakeSvc = ethers.keccak256(ethers.toUtf8Bytes('FAKE'));
      await expect(
        circuit.connect(user).submitIntent(fakeSvc, MOCK_INPUT, {
          value: ethers.parseEther('0.01'),
        })
      ).to.be.reverted;
    });

    it('reverts when service not active', async function () {
      const serviceId = await registerLLMService();
      await circuit.updateService(serviceId, ethers.parseEther('0.01'), false);

      await expect(
        circuit.connect(user).submitIntent(serviceId, MOCK_INPUT, {
          value: ethers.parseEther('0.01'),
        })
      ).to.be.reverted;
    });

    it('reverts when payment insufficient', async function () {
      const serviceId = await registerLLMService();
      await expect(
        circuit.connect(user).submitIntent(serviceId, MOCK_INPUT, { value: 1 })
      ).to.be.reverted;
    });
  });

  // ─── completeIntent: invalid status ─────────────────────────────────────

  describe('completeIntent branches', function () {
    it('reverts when intent not found', async function () {
      const fakeId = ethers.keccak256(ethers.toUtf8Bytes('FAKE'));
      await expect(
        circuit.completeIntent(fakeId, MOCK_OUTPUT, MOCK_MODEL, 100)
      ).to.be.reverted;
    });

    it('reverts when intent already completed', async function () {
      const serviceId = await registerLLMService();
      const tx = await circuit.connect(user).submitIntent(
        serviceId, MOCK_INPUT, { value: ethers.parseEther('0.01') }
      );
      const receipt = await tx.wait();
      const iface = circuit.interface;
      const parsed = receipt.logs
        .map(l => { try { return iface.parseLog(l); } catch { return null; } })
        .find(p => p && p.name === 'InferenceIntentSubmitted');
      const intentId = parsed.args[1];

      await circuit.completeIntent(intentId, MOCK_OUTPUT, MOCK_MODEL, 100);
      await expect(
        circuit.completeIntent(intentId, MOCK_OUTPUT, MOCK_MODEL, 200)
      ).to.be.reverted;
    });
  });

  // ─── settleIntent: not found / not completed ────────────────────────────

  describe('settleIntent branches', function () {
    it('reverts when intent not found', async function () {
      const fakeId = ethers.keccak256(ethers.toUtf8Bytes('FAKE'));
      await expect(
        circuit.settleIntent(fakeId, MOCK_PROOF, MOCK_PUB_VALS, ethers.keccak256(ethers.toUtf8Bytes('null')))
      ).to.be.reverted;
    });

    it('reverts when intent not in Completed status', async function () {
      const serviceId = await registerLLMService();
      const tx = await circuit.connect(user).submitIntent(
        serviceId, MOCK_INPUT, { value: ethers.parseEther('0.01') }
      );
      const receipt = await tx.wait();
      const iface = circuit.interface;
      const parsed = receipt.logs
        .map(l => { try { return iface.parseLog(l); } catch { return null; } })
        .find(p => p && p.name === 'InferenceIntentSubmitted');
      const intentId = parsed.args[1];

      await expect(
        circuit.settleIntent(intentId, MOCK_PROOF, MOCK_PUB_VALS, ethers.keccak256(ethers.toUtf8Bytes('null')))
      ).to.be.reverted;
    });
  });

  // ─── failIntent: not found / zero payment ──────────────────────────────

  describe('failIntent branches', function () {
    it('reverts when intent not found', async function () {
      const fakeId = ethers.keccak256(ethers.toUtf8Bytes('FAKE'));
      await expect(circuit.failIntent(fakeId, 'test reason')).to.be.reverted;
    });
  });

  // ─── Fee forwarding: no splitter ────────────────────────────────────────

  describe('Fee forwarding branches', function () {
    it('succeeds when revenueSplitter is address(0)', async function () {
      const noSplitter = await deployCircuit(ethers.ZeroAddress, ethers.ZeroAddress);
      await noSplitter.registerService(
        ServiceType.LLM_INFERENCE, 'test-model',
        ethers.parseEther('0.01'), 5000
      );

      const svcTx = await noSplitter.registerService(
        ServiceType.IMAGE_GENERATION, 'img-model',
        ethers.parseEther('0.01'), 5000
      );
      const svcReceipt = await svcTx.wait();
      const svcId = svcReceipt.logs.find(
        l => l.fragment && l.fragment.name === 'ServiceRegistered'
      ).args[0];

      await expect(
        noSplitter.connect(user).submitIntent(svcId, MOCK_INPUT, {
          value: ethers.parseEther('0.01'),
        })
      ).to.not.be.reverted;
    });

    it('preset intent succeeds when revenueSplitter is address(0)', async function () {
      const noSplitter = await deployCircuit(ethers.ZeroAddress, ethers.ZeroAddress);

      const svcTx = await noSplitter.registerService(
        ServiceType.LLM_INFERENCE, 'test-model',
        ethers.parseEther('0.01'), 5000
      );
      const svcReceipt = await svcTx.wait();
      const svcId = svcReceipt.logs.find(
        l => l.fragment && l.fragment.name === 'ServiceRegistered'
      ).args[0];

      const presetTx = await noSplitter.registerPreset(
        'Quick Test', ServiceType.LLM_INFERENCE, 'llama',
        GpuTier.BASIC, 'test prompt'
      );
      const presetReceipt = await presetTx.wait();
      const presetId = presetReceipt.logs.find(
        l => l.fragment && l.fragment.name === 'PresetRegistered'
      ).args[0];

      await expect(
        noSplitter.connect(user).submitPresetIntent(
          presetId, GpuTier.BASIC, svcId, MOCK_INPUT,
          { value: ethers.parseEther('0.01') }
        )
      ).to.not.be.reverted;
    });
  });

  // ─── setFee boundary ────────────────────────────────────────────────────

  describe('setFee boundary', function () {
    it('reverts when fee below minimum', async function () {
      await expect(circuit.setFee(5)).to.be.reverted;
    });

    it('reverts when fee above maximum', async function () {
      await expect(circuit.setFee(200)).to.be.reverted;
    });

    it('accepts fee at exact boundaries', async function () {
      await expect(circuit.setFee(10)).to.not.be.reverted;
      await expect(circuit.setFee(100)).to.not.be.reverted;
    });
  });

  // ─── setGpuMultiplier boundary ──────────────────────────────────────────

  describe('setGpuMultiplier boundary', function () {
    it('reverts when multiplier below 5000 BPS', async function () {
      await expect(circuit.setGpuMultiplier(GpuTier.BASIC, 4999)).to.be.reverted;
    });

    it('reverts when multiplier above 200000 BPS', async function () {
      await expect(circuit.setGpuMultiplier(GpuTier.BASIC, 200001)).to.be.reverted;
    });

    it('accepts at exact boundaries', async function () {
      await expect(circuit.setGpuMultiplier(GpuTier.BASIC, 5000)).to.not.be.reverted;
      await expect(circuit.setGpuMultiplier(GpuTier.BASIC, 200000)).to.not.be.reverted;
    });
  });
});
