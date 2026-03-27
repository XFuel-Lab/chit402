/**
 * Phase 1 — ZKMLCircuit + ZKVerifierZkGPT integration
 *
 * Verifies that when useZkGPT=true, ZKMLCircuit routes to ZKVerifierZkGPT
 * and the verifier is invoked (stub reverts with ZkGPTVerifierNotImplemented).
 *
 * Run: npx hardhat test test/phase1/ZKMLCircuitZkGPTIntegration.test.cjs
 */

const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('ZKMLCircuit + ZKVerifierZkGPT integration', function () {
  let splitter, zkVerifierZkGPT, circuit;
  let admin, prover, modelOwner, user;

  const WEIGHT_COMMITMENT = ethers.keccak256(ethers.toUtf8Bytes('model-weights-v1'));
  const ARCH_HASH = ethers.keccak256(ethers.toUtf8Bytes('transformer-arch-7b'));
  const INPUT_HASH = ethers.keccak256(ethers.toUtf8Bytes('encrypted-user-input'));
  const ZKGPT_PROOF = '0x' + 'ab'.repeat(100);
  const ZKGPT_PUBLIC_VALUES = '0x' + 'cd'.repeat(32);
  const NULLIFIER = ethers.keccak256(ethers.toUtf8Bytes('zkgpt-int-test-null'));

  beforeEach(async function () {
    [admin, prover, modelOwner, user,, bbb, lp, staker, treasury, stakePool] =
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

    const CircuitFactory = await ethers.getContractFactory('ZKMLCircuit');
    circuit = await CircuitFactory.deploy(
      admin.address,
      await splitter.getAddress(),
      ethers.ZeroAddress // SP1 verifier = mock (skip when useZkGPT false not used in this test)
    );
    await circuit.waitForDeployment();

    await circuit.setZKVerifierZkGPT(await zkVerifierZkGPT.getAddress());

    const CIRCUIT_ROLE = await splitter.CIRCUIT_ROLE();
    await splitter.grantRole(CIRCUIT_ROLE, await circuit.getAddress());

    const PROVER_ROLE = await circuit.PROVER_ROLE();
    await circuit.grantRole(PROVER_ROLE, prover.address);

    const regReceipt = await (await circuit.connect(modelOwner).registerModel(
      WEIGHT_COMMITMENT, ARCH_HASH, 'ZkGPTTestModel', ethers.parseEther('0.01'), false
    )).wait();
    const modelEvent = regReceipt.logs.find(l => {
      try { return circuit.interface.parseLog(l)?.name === 'PrivateModelRegistered'; }
      catch { return false; }
    });
    const modelId = circuit.interface.parseLog(modelEvent).args.modelId;
    await circuit.connect(modelOwner).authorizeProver(modelId, prover.address);

    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const txReq = await circuit.connect(user).requestInference(
      modelId, INPUT_HASH, deadline, { value: ethers.parseEther('1.0') }
    );
    const receiptReq = await txReq.wait();
    const reqEvent = receiptReq.logs.find(l => {
      try { return circuit.interface.parseLog(l)?.name === 'InferenceRequested'; }
      catch { return false; }
    });
    this.requestId = circuit.interface.parseLog(reqEvent).args.requestId;
  });

  it('should route verifyInference(useZkGPT=true) to ZKVerifierZkGPT (tx reverts with ProofFailed while stub reverts)', async function () {
    // ZKMLCircuit uses low-level call; verifier revert becomes require(ok) → "ProofFailed"
    await expect(
      circuit.connect(prover).verifyInference(
        this.requestId,
        ethers.keccak256(ethers.toUtf8Bytes('output-1')),
        WEIGHT_COMMITMENT,
        ZKGPT_PROOF,
        ZKGPT_PUBLIC_VALUES,
        NULLIFIER,
        true // useZkGPT
      )
    ).to.be.revertedWith('ProofFailed');
  });
});
