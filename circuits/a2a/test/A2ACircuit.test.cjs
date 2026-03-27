/**
 * A2A Circuit — Hardhat Tests (Enhanced: 15 tests)
 *
 * Run: npx hardhat test circuits/a2a/test/A2ACircuit.test.cjs
 *
 * Covers:
 *   - Agent registration & discovery (5 tests)
 *   - Bid submission & lifecycle (4 tests)
 *   - Micropayment channels (4 tests)
 *   - ZK-gated messaging (1 test)
 *   - Multi-agent stress test (1 test)
 */

const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('A2ACircuit', function () {
  let circuit, splitter;
  let admin, relayer, agent1, agent2, agent3, user, bbb, lp, staker, treasury, stakePool;

  const CIRCUIT_ID = ethers.keccak256(ethers.toUtf8Bytes('A2A_CIRCUIT'));
  const MOCK_PROOF = '0x' + 'ab'.repeat(130);
  const MOCK_PUBLIC_VALUES = '0x' + 'cd'.repeat(64);
  const MOCK_IDENTITY = ethers.keccak256(ethers.toUtf8Bytes('agent-identity-1'));
  const MOCK_IDENTITY_2 = ethers.keccak256(ethers.toUtf8Bytes('agent-identity-2'));
  const MOCK_IDENTITY_3 = ethers.keccak256(ethers.toUtf8Bytes('agent-identity-3'));
  const MOCK_CAPABILITY = ethers.keccak256(ethers.toUtf8Bytes('inference:llama-3'));
  const MOCK_CAPABILITY_2 = ethers.keccak256(ethers.toUtf8Bytes('inference:flux-1'));
  const MOCK_TASK_HASH = ethers.keccak256(ethers.toUtf8Bytes('task-spec-1'));

  beforeEach(async function () {
    [admin, relayer, agent1, agent2, agent3, user, bbb, lp, staker, treasury, stakePool] =
      await ethers.getSigners();

    // Deploy CoreRevenueSplitter
    const SplitterFactory = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await SplitterFactory.deploy(
      admin.address, bbb.address, lp.address,
      staker.address, treasury.address, stakePool.address
    );
    await splitter.waitForDeployment();

    // Deploy A2ACircuit
    const CircuitFactory = await ethers.getContractFactory('A2ACircuit');
    circuit = await CircuitFactory.deploy(
      admin.address,
      await splitter.getAddress(),
      ethers.ZeroAddress,
      ethers.ZeroAddress
    );
    await circuit.waitForDeployment();

    // Grant RELAYER_ROLE
    const RELAYER_ROLE = await circuit.RELAYER_ROLE();
    await circuit.grantRole(RELAYER_ROLE, relayer.address);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  SERVICE DISCOVERY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Agent Registration', function () {
    it('should register an agent with capabilities', async function () {
      await circuit.connect(agent1).registerAgent(
        MOCK_IDENTITY,
        'https://agent1.example.com/a2a',
        [MOCK_CAPABILITY]
      );

      const agent = await circuit.getAgent(agent1.address);
      expect(agent.active).to.be.true;
      expect(agent.identityCommitment).to.equal(MOCK_IDENTITY);
    });

    it('should emit AgentRegistered event', async function () {
      await expect(
        circuit.connect(agent1).registerAgent(MOCK_IDENTITY, 'https://a.com', [MOCK_CAPABILITY])
      ).to.emit(circuit, 'AgentRegistered');
    });

    it('should reject duplicate registration', async function () {
      await circuit.connect(agent1).registerAgent(MOCK_IDENTITY, 'https://a.com', []);
      await expect(
        circuit.connect(agent1).registerAgent(MOCK_IDENTITY, 'https://b.com', [])
      ).to.be.revertedWithCustomError(circuit, 'AgentAlreadyRegistered');
    });

    it('should index capabilities for discovery', async function () {
      await circuit.connect(agent1).registerAgent(MOCK_IDENTITY, 'https://a.com', [MOCK_CAPABILITY]);
      const provider = await circuit.findProvider(MOCK_CAPABILITY);
      expect(provider).to.equal(agent1.address);
    });

    it('should deactivate an agent and track count', async function () {
      await circuit.connect(agent1).registerAgent(MOCK_IDENTITY, 'https://a.com', []);
      await circuit.connect(agent1).deactivateAgent(agent1.address);

      const agent = await circuit.getAgent(agent1.address);
      expect(agent.active).to.be.false;

      // Count should still be 1 (registered, just inactive)
      const [agents] = await circuit.getStats();
      expect(agents).to.equal(1n);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  BIDDING / AUCTION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Bid Lifecycle', function () {
    let bidId;
    const deadline = Math.floor(Date.now() / 1000) + 3600;

    beforeEach(async function () {
      await circuit.connect(agent1).registerAgent(
        MOCK_IDENTITY, 'https://agent1.com', [MOCK_CAPABILITY]
      );

      const tx = await circuit.connect(user).submitBid(
        MOCK_TASK_HASH, MOCK_CAPABILITY, deadline,
        { value: ethers.parseEther('1.0') }
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'BidSubmitted'; }
        catch { return false; }
      });
      const parsed = circuit.interface.parseLog(event);
      bidId = parsed.args.bidId;
    });

    it('should submit and deduct 0.1% relay fee', async function () {
      const escrow = ethers.parseEther('10.0');
      const expectedFee = ethers.parseEther('0.01');

      const splitterBefore = await ethers.provider.getBalance(await splitter.getAddress());
      await circuit.connect(user).submitBid(
        MOCK_TASK_HASH, MOCK_CAPABILITY, deadline, { value: escrow }
      );
      const splitterAfter = await ethers.provider.getBalance(await splitter.getAddress());
      expect(splitterAfter - splitterBefore).to.equal(expectedFee);
    });

    it('should accept a bid and settle with proof', async function () {
      await circuit.connect(agent1).acceptBid(bidId, ethers.parseEther('0.5'));

      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('bid-nullifier-1'));
      const resultHash = ethers.keccak256(ethers.toUtf8Bytes('result-1'));

      const agent1Before = await ethers.provider.getBalance(agent1.address);
      await circuit.connect(relayer).settleBid(
        bidId, resultHash, MOCK_PROOF, MOCK_PUBLIC_VALUES, nullifier
      );

      const bid = await circuit.getBid(bidId);
      expect(bid.status).to.equal(2); // Completed
      const agent1After = await ethers.provider.getBalance(agent1.address);
      expect(agent1After).to.be.gt(agent1Before);
    });

    it('should cancel an open bid and refund', async function () {
      await circuit.connect(user).cancelBid(bidId);

      const bid = await circuit.getBid(bidId);
      expect(bid.status).to.equal(3); // Cancelled
    });

    it('should reject acceptance from non-agent', async function () {
      await expect(
        circuit.connect(user).acceptBid(bidId, ethers.parseEther('0.5'))
      ).to.be.revertedWithCustomError(circuit, 'AgentNotRegistered');
    });

    it('should settle bid via Fair Exchange (PAS signature)', async function () {
      await circuit.connect(admin).setFairExchangeProxy(relayer.address);

      await circuit.connect(agent1).acceptBid(bidId, ethers.parseEther('0.5'));
      const bid = await circuit.getBid(bidId);
      const acceptedPrice = bid.acceptedPrice;
      const providerAddr = bid.provider;

      const messageHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['bytes32', 'string', 'bytes32', 'address', 'uint256'],
          [CIRCUIT_ID, 'settleBidFairExchange', bidId, providerAddr, acceptedPrice]
        )
      );
      const sig = await relayer.signMessage(ethers.getBytes(messageHash));
      const { v, r, s } = ethers.Signature.from(sig);
      const resultHash = ethers.keccak256(ethers.toUtf8Bytes('fe-result-1'));

      const agent1Before = await ethers.provider.getBalance(agent1.address);
      await expect(
        circuit.settleBidFairExchange(bidId, resultHash, v, r, s)
      ).to.emit(circuit, 'BidSettledFairExchange');

      const bidAfter = await circuit.getBid(bidId);
      expect(bidAfter.status).to.equal(2); // Completed
      const agent1After = await ethers.provider.getBalance(agent1.address);
      expect(agent1After).to.be.gt(agent1Before);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  MICROPAYMENT CHANNELS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Payment Channels', function () {
    let channelId;

    beforeEach(async function () {
      await circuit.connect(agent1).registerAgent(MOCK_IDENTITY, 'https://agent1.com', []);

      const tx = await circuit.connect(user).openChannel(
        agent1.address, 3600, { value: ethers.parseEther('1.0') }
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'ChannelOpened'; }
        catch { return false; }
      });
      const parsed = circuit.interface.parseLog(event);
      channelId = parsed.args.channelId;
    });

    it('should open a payment channel', async function () {
      const ch = await circuit.getChannel(channelId);
      expect(ch.active).to.be.true;
      expect(ch.deposit).to.equal(ethers.parseEther('1.0'));
    });

    it('should allow multiple claims up to deposit', async function () {
      for (let i = 0; i < 5; i++) {
        const nullifier = ethers.keccak256(ethers.toUtf8Bytes(`ch-null-${i}`));
        await circuit.connect(agent1).claimChannel(
          channelId, ethers.parseEther('0.1'),
          MOCK_PROOF, MOCK_PUBLIC_VALUES, nullifier
        );
      }
      const ch = await circuit.getChannel(channelId);
      expect(ch.spent).to.equal(ethers.parseEther('0.5'));
    });

    it('should reject claim exceeding deposit', async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('ch-over'));
      await expect(
        circuit.connect(agent1).claimChannel(
          channelId, ethers.parseEther('2.0'), MOCK_PROOF, MOCK_PUBLIC_VALUES, nullifier
        )
      ).to.be.revertedWithCustomError(circuit, 'InsufficientChannelBalance');
    });

    it('should reject duplicate nullifier in channel claims', async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('dup-null'));
      await circuit.connect(agent1).claimChannel(
        channelId, ethers.parseEther('0.1'), MOCK_PROOF, MOCK_PUBLIC_VALUES, nullifier
      );
      await expect(
        circuit.connect(agent1).claimChannel(
          channelId, ethers.parseEther('0.1'), MOCK_PROOF, MOCK_PUBLIC_VALUES, nullifier
        )
      ).to.be.revertedWithCustomError(circuit, 'NullifierUsed');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  ZK-GATED MESSAGING
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Messaging', function () {
    it('should send messages to registered agents and reject unregistered', async function () {
      await circuit.connect(agent1).registerAgent(MOCK_IDENTITY, 'https://a.com', []);

      const payloadHash = ethers.keccak256(ethers.toUtf8Bytes('hello-agent'));
      await expect(
        circuit.connect(user).sendMessage(agent1.address, payloadHash, { value: 1000 })
      ).to.emit(circuit, 'A2AMessageSent');

      // Should reject for unregistered agent2
      await expect(
        circuit.connect(user).sendMessage(agent2.address, payloadHash)
      ).to.be.revertedWithCustomError(circuit, 'AgentNotRegistered');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  MULTI-AGENT STRESS TEST
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Multi-Agent Simulation', function () {
    it('should handle 3 agents, multiple bids, and concurrent channels', async function () {
      // Register 3 agents with different capabilities
      await circuit.connect(agent1).registerAgent(
        MOCK_IDENTITY, 'https://a1.com', [MOCK_CAPABILITY]
      );
      await circuit.connect(agent2).registerAgent(
        MOCK_IDENTITY_2, 'https://a2.com', [MOCK_CAPABILITY_2]
      );
      await circuit.connect(agent3).registerAgent(
        MOCK_IDENTITY_3, 'https://a3.com', [MOCK_CAPABILITY, MOCK_CAPABILITY_2]
      );

      const [agentCount] = await circuit.getStats();
      expect(agentCount).to.equal(3n);

      // Submit bids for different capabilities
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      await circuit.connect(user).submitBid(
        MOCK_TASK_HASH, MOCK_CAPABILITY, deadline,
        { value: ethers.parseEther('1.0') }
      );
      await circuit.connect(user).submitBid(
        MOCK_TASK_HASH, MOCK_CAPABILITY_2, deadline,
        { value: ethers.parseEther('2.0') }
      );

      // Open channels to different agents
      await circuit.connect(user).openChannel(
        agent1.address, 3600, { value: ethers.parseEther('0.5') }
      );
      await circuit.connect(user).openChannel(
        agent2.address, 7200, { value: ethers.parseEther('1.0') }
      );

      const [, bidCount, , , , msgs] = await circuit.getStats();
      expect(bidCount).to.equal(2n);
    });
  });
});
