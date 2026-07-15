/**
 * TAO EVM Circuit — Hardhat Tests (Enhanced: 15 tests)
 *
 * Run: npx hardhat test circuits/tao-evm/test/TAOCircuit.test.cjs
 *
 * Covers:
 *   - Deployment & identity (2 tests)
 *   - Task submission lifecycle (4 tests)
 *   - Task settlement with ZK proof (3 tests)
 *   - AMM fee capture (2 tests)
 *   - Pricing oracle/admin fallback (2 tests)
 *   - Fee config, pause, multi-task stress (2 tests)
 */

const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('TAOCircuit', function () {
  let circuit, splitter;
  let admin, relayer, user, user2, bbb, lp, staker, treasury, stakePool;

  const CIRCUIT_ID = ethers.keccak256(ethers.toUtf8Bytes('TAO_EVM_CIRCUIT'));
  const MOCK_INPUT_HASH = ethers.keccak256(ethers.toUtf8Bytes('test-input'));
  const MOCK_OUTPUT_HASH = ethers.keccak256(ethers.toUtf8Bytes('test-output'));
  const MOCK_PROOF = '0x' + 'ab'.repeat(130);
  const MOCK_PUBLIC_VALUES = '0x' + 'cd'.repeat(64);
  const MOCK_NULLIFIER = ethers.keccak256(ethers.toUtf8Bytes('nullifier-tao-1'));

  beforeEach(async function () {
    [admin, relayer, user, user2, bbb, lp, staker, treasury, stakePool] = await ethers.getSigners();

    // Deploy CoreRevenueSplitter
    const SplitterFactory = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await SplitterFactory.deploy(
      admin.address, bbb.address, lp.address,
      staker.address, treasury.address, stakePool.address
    );
    await splitter.waitForDeployment();

    // Deploy TAOCircuit (no mailbox, no oracle, mock ZK)
    const CircuitFactory = await ethers.getContractFactory('TAOCircuit');
    circuit = await CircuitFactory.deploy(
      admin.address,
      await splitter.getAddress(),
      ethers.ZeroAddress,   // zkVerifier = mock
      ethers.ZeroAddress,   // mailbox = disabled
      ethers.ZeroAddress    // priceOracle = admin pricing
    );
    await circuit.waitForDeployment();

    // Grant RELAYER_ROLE to relayer
    const RELAYER_ROLE = await circuit.RELAYER_ROLE();
    await circuit.grantRole(RELAYER_ROLE, relayer.address);

    // Grant CIRCUIT_ROLE on splitter to the circuit
    const CIRCUIT_ROLE = await splitter.CIRCUIT_ROLE();
    await splitter.grantRole(CIRCUIT_ROLE, await circuit.getAddress());
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  DEPLOYMENT
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Deployment', function () {
    it('should deploy with correct circuit ID', async function () {
      expect(await circuit.CIRCUIT_ID()).to.equal(CIRCUIT_ID);
    });

    it('should have 0.5% default fee', async function () {
      expect(await circuit.feeBps()).to.equal(50);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  TASK SUBMISSION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Task Submission', function () {
    it('should submit a local task (no bridging)', async function () {
      const payment = ethers.parseEther('1.0');
      const tx = await circuit.connect(user).submitTask(
        0, // InferenceRequest
        0, // local (no bridge)
        MOCK_INPUT_HASH,
        1, // subnetId
        { value: payment }
      );
      const receipt = await tx.wait();

      const event = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'TaskRouted'; }
        catch { return false; }
      });
      expect(event).to.not.be.undefined;
    });

    it('should deduct 0.5% fee and forward to splitter', async function () {
      const payment = ethers.parseEther('10.0');
      const expectedFee = ethers.parseEther('0.05');

      const splitterBefore = await ethers.provider.getBalance(await splitter.getAddress());
      await circuit.connect(user).submitTask(0, 0, MOCK_INPUT_HASH, 0, { value: payment });
      const splitterAfter = await ethers.provider.getBalance(await splitter.getAddress());
      expect(splitterAfter - splitterBefore).to.equal(expectedFee);
    });

    it('should reject zero payment', async function () {
      await expect(
        circuit.connect(user).submitTask(0, 0, MOCK_INPUT_HASH, 0, { value: 0 })
      ).to.be.revertedWith('ZeroPayment');
    });

    it('should increment task count across multiple users', async function () {
      await circuit.connect(user).submitTask(0, 0, MOCK_INPUT_HASH, 0, { value: 1000 });
      await circuit.connect(user2).submitTask(1, 0, MOCK_INPUT_HASH, 0, { value: 1000 });
      await circuit.connect(user).submitTask(2, 0, MOCK_INPUT_HASH, 0, { value: 1000 });

      const [count] = await circuit.getStats();
      expect(count).to.equal(3n);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  TASK SETTLEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Task Settlement', function () {
    let taskId;

    beforeEach(async function () {
      const tx = await circuit.connect(user).submitTask(
        0, 0, MOCK_INPUT_HASH, 1,
        { value: ethers.parseEther('1.0') }
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'TaskRouted'; }
        catch { return false; }
      });
      const parsed = circuit.interface.parseLog(event);
      taskId = parsed.args.taskId;
    });

    it('should settle a task with mock proof', async function () {
      await circuit.connect(relayer).settleTask(
        taskId, MOCK_OUTPUT_HASH, MOCK_PROOF, MOCK_PUBLIC_VALUES, MOCK_NULLIFIER
      );

      const task = await circuit.getTask(taskId);
      expect(task.status).to.equal(3); // Settled
      expect(task.outputHash).to.equal(MOCK_OUTPUT_HASH);
    });

    it('should reject settlement from non-relayer', async function () {
      await expect(
        circuit.connect(user).settleTask(
          taskId, MOCK_OUTPUT_HASH, MOCK_PROOF, MOCK_PUBLIC_VALUES, MOCK_NULLIFIER
        )
      ).to.be.reverted;
    });

    it('should reject double settlement of same task', async function () {
      await circuit.connect(relayer).settleTask(
        taskId, MOCK_OUTPUT_HASH, MOCK_PROOF, MOCK_PUBLIC_VALUES, MOCK_NULLIFIER
      );

      const nullifier2 = ethers.keccak256(ethers.toUtf8Bytes('nullifier-tao-2'));
      await expect(
        circuit.connect(relayer).settleTask(
          taskId, MOCK_OUTPUT_HASH, MOCK_PROOF, MOCK_PUBLIC_VALUES, nullifier2
        )
      ).to.be.reverted; // InvalidTaskStatus
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  AMM FEE CAPTURE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('AMM Fee Capture', function () {
    it('should capture swap fees and forward to splitter', async function () {
      const feeAmount = ethers.parseEther('0.01');
      const splitterBefore = await ethers.provider.getBalance(await splitter.getAddress());

      await circuit.connect(admin).captureSwapFee(
        user.address,
        ethers.parseEther('2.0'),
        { value: feeAmount }
      );

      const splitterAfter = await ethers.provider.getBalance(await splitter.getAddress());
      expect(splitterAfter - splitterBefore).to.equal(feeAmount);
    });

    it('should accumulate multiple swap fees', async function () {
      for (let i = 0; i < 5; i++) {
        await circuit.connect(admin).captureSwapFee(
          user.address, ethers.parseEther('1.0'),
          { value: ethers.parseEther('0.01') }
        );
      }
      const [, , , swapFees] = await circuit.getStats();
      expect(swapFees).to.equal(ethers.parseEther('0.05'));
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  PRICING
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Pricing', function () {
    it('should use admin price when no oracle', async function () {
      await circuit.setAdminPrice(ethers.parseEther('500'));
      const [price, source] = await circuit.getPrice();
      expect(price).to.equal(ethers.parseEther('500'));
      expect(source).to.equal('admin');
    });

    it('should revert when no price available', async function () {
      await expect(circuit.getPrice()).to.be.revertedWith('NoPriceAvailable');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  FEE CONFIG & PAUSE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Fee Configuration', function () {
    it('should update fee within valid range', async function () {
      await circuit.setFee(75);
      expect(await circuit.feeBps()).to.equal(75);
    });

    it('should reject fee outside range', async function () {
      await expect(circuit.setFee(200)).to.be.revertedWithCustomError(circuit, 'InvalidFee');
      await expect(circuit.setFee(5)).to.be.revertedWithCustomError(circuit, 'InvalidFee');
    });
  });

  describe('Pause', function () {
    it('should prevent task submission when paused', async function () {
      await circuit.pause();
      await expect(
        circuit.connect(user).submitTask(0, 0, MOCK_INPUT_HASH, 0, { value: 1000 })
      ).to.be.revertedWithCustomError(circuit, 'EnforcedPause');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  MULTI-NET SIMULATION (STRESS)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Multi-Net Simulation', function () {
    it('should handle 10 concurrent tasks from multiple users', async function () {
      const tasks = [];
      for (let i = 0; i < 5; i++) {
        tasks.push(
          circuit.connect(user).submitTask(
            i % 4, 0, ethers.keccak256(ethers.toUtf8Bytes(`input-${i}`)), i,
            { value: ethers.parseEther('0.1') }
          )
        );
        tasks.push(
          circuit.connect(user2).submitTask(
            i % 4, 0, ethers.keccak256(ethers.toUtf8Bytes(`input-${i}-b`)), i,
            { value: ethers.parseEther('0.2') }
          )
        );
      }

      await Promise.all(tasks);

      const [count, volume] = await circuit.getStats();
      expect(count).to.equal(10n);
      expect(volume).to.equal(ethers.parseEther('1.5')); // 5*0.1 + 5*0.2
    });
  });
});
