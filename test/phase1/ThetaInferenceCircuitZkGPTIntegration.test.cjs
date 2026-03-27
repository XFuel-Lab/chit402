/**
 * Phase 1 — ThetaInferenceCircuit + ZKVerifierZkGPT integration
 *
 * Verifies that when useZkGPT=true, ThetaInferenceCircuit routes to ZKVerifierZkGPT
 * and the verifier is invoked (stub reverts → ProofFailed).
 *
 * Run: npx hardhat test test/phase1/ThetaInferenceCircuitZkGPTIntegration.test.cjs
 */

const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('ThetaInferenceCircuit + ZKVerifierZkGPT integration', function () {
  let splitter, zkVerifierZkGPT, circuit;
  let admin, relayer, user;

  const ServiceType = { LLM_INFERENCE: 0 };
  const MOCK_INPUT = ethers.keccak256(ethers.toUtf8Bytes('llm-prompt-hash'));
  const MOCK_OUTPUT = ethers.keccak256(ethers.toUtf8Bytes('llm-response-hash'));
  const MOCK_MODEL = ethers.keccak256(ethers.toUtf8Bytes('llama-3.1-70b-v1'));
  const ZKGPT_PROOF = '0x' + 'ab'.repeat(100);
  const ZKGPT_PUBLIC_VALUES = '0x' + 'cd'.repeat(32);
  const NULLIFIER = ethers.keccak256(ethers.toUtf8Bytes('theta-zkgpt-int-null'));

  beforeEach(async function () {
    [admin, relayer, user,, bbb, lp, staker, treasury, stakePool] =
      await ethers.getSigners();

    const SplitterFactory = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await SplitterFactory.deploy(
      admin.address, bbb.address, lp.address,
      staker.address, treasury.address, stakePool.address
    );
    await splitter.waitForDeployment();

    const ZkGPTFactory = await ethers.getContractFactory('ZKVerifierZkGPT');
    zkVerifierZkGPT = await ZkGPTFactory.deploy(admin.address);
    await zkVerifierZkGPT.waitForDeployment();

    const CircuitFactory = await ethers.getContractFactory('ThetaInferenceCircuit');
    circuit = await CircuitFactory.deploy(
      admin.address,
      await splitter.getAddress(),
      ethers.ZeroAddress
    );
    await circuit.waitForDeployment();
    await circuit.setZKVerifierZkGPT(await zkVerifierZkGPT.getAddress());

    const CIRCUIT_ROLE = await splitter.CIRCUIT_ROLE();
    await splitter.grantRole(CIRCUIT_ROLE, await circuit.getAddress());
    const RELAYER_ROLE = await circuit.RELAYER_ROLE();
    await circuit.grantRole(RELAYER_ROLE, relayer.address);

    await circuit.registerService(
      ServiceType.LLM_INFERENCE, 'llama-3.1-70b',
      ethers.parseEther('0.01'), 5000
    );
    const serviceId = await circuit.serviceIds(0);
    const tx = await circuit.connect(user).submitIntent(
      serviceId, MOCK_INPUT, { value: ethers.parseEther('1.0') }
    );
    const receipt = await tx.wait();
    const event = receipt.logs.find(l => {
      try { return circuit.interface.parseLog(l)?.name === 'InferenceIntentSubmitted'; }
      catch { return false; }
    });
    this.intentId = circuit.interface.parseLog(event).args.intentId;
    await circuit.connect(relayer).completeIntent(
      this.intentId, MOCK_OUTPUT, MOCK_MODEL, 1200
    );
  });

  it('should route settleIntent(useZkGPT=true) to ZKVerifierZkGPT (tx reverts with ProofFailed while stub)', async function () {
    await expect(
      circuit.connect(relayer).settleIntent(
        this.intentId,
        ZKGPT_PROOF,
        ZKGPT_PUBLIC_VALUES,
        NULLIFIER,
        true // useZkGPT
      )
    ).to.be.revertedWith('ProofFailed');
  });
});
