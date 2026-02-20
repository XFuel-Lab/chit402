/**
 * Akash/DePIN Compute Circuit — Hardhat Tests (15 tests)
 *
 * Run: npx hardhat test circuits/akash/test/AkashCircuit.test.cjs
 *
 * Covers:
 *   - GPU spec catalog (2 tests)
 *   - Deployment creation & cancellation (3 tests)
 *   - Reverse auction bidding (4 tests)
 *   - Lease lifecycle: create, payments, complete (4 tests)
 *   - Edge cases: fee config, pause, stats (2 tests)
 */

const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('AkashCircuit', function () {
  let circuit, splitter;
  let admin, relayer, provider1, provider2, tenant, tenant2;
  let bbb, lp, staker, treasury, stakePool;

  const CIRCUIT_ID = ethers.keccak256(ethers.toUtf8Bytes('AKASH_DEPIN_CIRCUIT'));
  const MOCK_PROOF = '0x' + 'ab'.repeat(130);
  const MOCK_PUBLIC_VALUES = '0x' + 'cd'.repeat(64);
  const SDL_HASH = ethers.keccak256(ethers.toUtf8Bytes('sdl-gpu-h100-4x'));

  let specId;

  beforeEach(async function () {
    [admin, relayer, provider1, provider2, tenant, tenant2, bbb, lp, staker, treasury, stakePool] =
      await ethers.getSigners();

    // Deploy CoreRevenueSplitter
    const SplitterFactory = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await SplitterFactory.deploy(
      admin.address, bbb.address, lp.address,
      staker.address, treasury.address, stakePool.address
    );
    await splitter.waitForDeployment();

    // Deploy AkashCircuit
    const CircuitFactory = await ethers.getContractFactory('AkashCircuit');
    circuit = await CircuitFactory.deploy(
      admin.address,
      await splitter.getAddress(),
      ethers.ZeroAddress // zkVerifier = mock
    );
    await circuit.waitForDeployment();

    // Grant roles
    const RELAYER_ROLE = await circuit.RELAYER_ROLE();
    await circuit.grantRole(RELAYER_ROLE, relayer.address);

    const CIRCUIT_ROLE = await splitter.CIRCUIT_ROLE();
    await splitter.grantRole(CIRCUIT_ROLE, await circuit.getAddress());

    // Register a GPU spec
    const tx = await circuit.registerGPUSpec('nvidia', 'h100-80gb', 81920, ethers.parseEther('0.5'));
    const receipt = await tx.wait();
    const event = receipt.logs.find(l => {
      try { return circuit.interface.parseLog(l)?.name === 'GPUSpecRegistered'; }
      catch { return false; }
    });
    specId = circuit.interface.parseLog(event).args.specId;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  GPU SPEC CATALOG
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GPU Spec Catalog', function () {
    it('should register a GPU spec', async function () {
      const spec = await circuit.gpuSpecs(specId);
      expect(spec.vendor).to.equal('nvidia');
      expect(spec.model).to.equal('h100-80gb');
      expect(spec.vramMB).to.equal(81920n);
      expect(spec.available).to.be.true;
    });

    it('should register multiple GPU specs', async function () {
      await circuit.registerGPUSpec('nvidia', 'a100-80gb', 81920, ethers.parseEther('0.3'));
      await circuit.registerGPUSpec('amd', 'mi300x', 192000, ethers.parseEther('0.7'));

      expect(await circuit.specCount()).to.equal(3n);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  DEPLOYMENT CREATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Deployment Creation', function () {
    it('should create a GPU deployment with escrow', async function () {
      const maxPrice = ethers.parseEther('0.001');
      const duration = 1000n;
      const escrow = maxPrice * duration; // exact minimum

      const tx = await circuit.connect(tenant).createDeployment(
        specId, SDL_HASH, maxPrice, duration, { value: escrow }
      );
      const receipt = await tx.wait();

      const event = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'DeploymentCreated'; }
        catch { return false; }
      });
      expect(event).to.not.be.undefined;
      expect(await circuit.deploymentCount()).to.equal(1n);
    });

    it('should deduct 0.5% fee and forward to splitter', async function () {
      const escrow = ethers.parseEther('10.0');
      const expectedFee = ethers.parseEther('0.05');

      const splitterBefore = await ethers.provider.getBalance(await splitter.getAddress());

      await circuit.connect(tenant).createDeployment(
        specId, SDL_HASH, ethers.parseEther('0.001'), 100, { value: escrow }
      );

      const splitterAfter = await ethers.provider.getBalance(await splitter.getAddress());
      expect(splitterAfter - splitterBefore).to.equal(expectedFee);
    });

    it('should cancel deployment and refund escrow', async function () {
      const escrow = ethers.parseEther('5.0');
      const tx = await circuit.connect(tenant).createDeployment(
        specId, SDL_HASH, ethers.parseEther('0.001'), 100, { value: escrow }
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'DeploymentCreated'; }
        catch { return false; }
      });
      const deploymentId = circuit.interface.parseLog(event).args.deploymentId;

      const tenantBefore = await ethers.provider.getBalance(tenant.address);
      await circuit.connect(tenant).cancelDeployment(deploymentId);
      const tenantAfter = await ethers.provider.getBalance(tenant.address);

      // Tenant should receive refund (minus gas)
      expect(tenantAfter).to.be.gt(tenantBefore);

      const dep = await circuit.getDeployment(deploymentId);
      expect(dep.status).to.equal(5); // Cancelled
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  REVERSE AUCTION BIDDING
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Bidding (Reverse Auction)', function () {
    let deploymentId;

    beforeEach(async function () {
      const tx = await circuit.connect(tenant).createDeployment(
        specId, SDL_HASH,
        ethers.parseEther('0.01'), // maxPricePerBlock
        1000,                       // duration
        { value: ethers.parseEther('10.0') }
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'DeploymentCreated'; }
        catch { return false; }
      });
      deploymentId = circuit.interface.parseLog(event).args.deploymentId;
    });

    it('should place a bid with deposit', async function () {
      const tx = await circuit.connect(provider1).placeBid(
        deploymentId,
        ethers.parseEther('0.005'), // half the max price
        { value: ethers.parseEther('0.1') }
      );
      const receipt = await tx.wait();

      const event = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'BidPlaced'; }
        catch { return false; }
      });
      expect(event).to.not.be.undefined;
      expect(await circuit.getDeploymentBidCount(deploymentId)).to.equal(1n);
    });

    it('should reject bid above max price', async function () {
      await expect(
        circuit.connect(provider1).placeBid(
          deploymentId,
          ethers.parseEther('0.02'), // above max
          { value: ethers.parseEther('0.1') }
        )
      ).to.be.revertedWithCustomError(circuit, 'BidTooHigh');
    });

    it('should reject bid with insufficient deposit', async function () {
      await expect(
        circuit.connect(provider1).placeBid(
          deploymentId,
          ethers.parseEther('0.005'),
          { value: 100 } // below MIN_BID_DEPOSIT
        )
      ).to.be.revertedWithCustomError(circuit, 'BidDepositTooLow');
    });

    it('should allow provider to withdraw bid', async function () {
      const tx = await circuit.connect(provider1).placeBid(
        deploymentId,
        ethers.parseEther('0.005'),
        { value: ethers.parseEther('0.1') }
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'BidPlaced'; }
        catch { return false; }
      });
      const bidId = circuit.interface.parseLog(event).args.bidId;

      const provBefore = await ethers.provider.getBalance(provider1.address);
      await circuit.connect(provider1).withdrawBid(bidId);
      const provAfter = await ethers.provider.getBalance(provider1.address);

      // Provider should get deposit back
      expect(provAfter).to.be.gt(provBefore);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  LEASE LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Lease Lifecycle', function () {
    let deploymentId, bidId1, bidId2;

    beforeEach(async function () {
      // Create deployment
      const txDep = await circuit.connect(tenant).createDeployment(
        specId, SDL_HASH,
        ethers.parseEther('0.01'), 1000,
        { value: ethers.parseEther('10.0') }
      );
      const receiptDep = await txDep.wait();
      const depEvent = receiptDep.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'DeploymentCreated'; }
        catch { return false; }
      });
      deploymentId = circuit.interface.parseLog(depEvent).args.deploymentId;

      // Provider 1 bids 0.005 ETH/block
      const txBid1 = await circuit.connect(provider1).placeBid(
        deploymentId, ethers.parseEther('0.005'),
        { value: ethers.parseEther('0.1') }
      );
      const receiptBid1 = await txBid1.wait();
      const bid1Event = receiptBid1.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'BidPlaced'; }
        catch { return false; }
      });
      bidId1 = circuit.interface.parseLog(bid1Event).args.bidId;

      // Provider 2 bids 0.003 ETH/block (lower = better)
      const txBid2 = await circuit.connect(provider2).placeBid(
        deploymentId, ethers.parseEther('0.003'),
        { value: ethers.parseEther('0.1') }
      );
      const receiptBid2 = await txBid2.wait();
      const bid2Event = receiptBid2.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'BidPlaced'; }
        catch { return false; }
      });
      bidId2 = circuit.interface.parseLog(bid2Event).args.bidId;
    });

    it('should accept lowest bid and create lease', async function () {
      const tx = await circuit.connect(tenant).acceptBid(bidId2); // lower bid
      const receipt = await tx.wait();

      const event = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'BidAccepted'; }
        catch { return false; }
      });
      expect(event).to.not.be.undefined;

      const parsed = circuit.interface.parseLog(event);
      const leaseId = parsed.args.leaseId;

      const lease = await circuit.getLease(leaseId);
      expect(lease.provider).to.equal(provider2.address);
      expect(lease.active).to.be.true;
      expect(await circuit.activeLeaseCount()).to.equal(1n);
    });

    it('should return deposits to losing bidders on acceptance', async function () {
      const prov1Before = await ethers.provider.getBalance(provider1.address);
      await circuit.connect(tenant).acceptBid(bidId2); // provider2 wins
      const prov1After = await ethers.provider.getBalance(provider1.address);

      // Provider1's deposit should be returned
      expect(prov1After).to.be.gt(prov1Before);
    });

    it('should allow provider to claim lease payments', async function () {
      const tx = await circuit.connect(tenant).acceptBid(bidId2);
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'BidAccepted'; }
        catch { return false; }
      });
      const leaseId = circuit.interface.parseLog(event).args.leaseId;

      // Mine some blocks
      for (let i = 0; i < 10; i++) {
        await ethers.provider.send('evm_mine', []);
      }

      const prov2Before = await ethers.provider.getBalance(provider2.address);

      // Claim for 5 blocks
      await circuit.connect(provider2).claimLeasePayment(leaseId, 5);

      const prov2After = await ethers.provider.getBalance(provider2.address);
      expect(prov2After).to.be.gt(prov2Before);
    });

    it('should complete a lease with ZK proof and refund escrow', async function () {
      const tx = await circuit.connect(tenant).acceptBid(bidId2);
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => {
        try { return circuit.interface.parseLog(l)?.name === 'BidAccepted'; }
        catch { return false; }
      });
      const leaseId = circuit.interface.parseLog(event).args.leaseId;

      // Claim some payment first
      for (let i = 0; i < 5; i++) {
        await ethers.provider.send('evm_mine', []);
      }
      await circuit.connect(provider2).claimLeasePayment(leaseId, 3);

      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('akash-null-1'));
      const tenantBefore = await ethers.provider.getBalance(tenant.address);

      await circuit.connect(relayer).completeLease(
        leaseId, MOCK_PROOF, MOCK_PUBLIC_VALUES, nullifier
      );

      const lease = await circuit.getLease(leaseId);
      expect(lease.active).to.be.false;
      expect(await circuit.totalLeasesCompleted()).to.equal(1n);

      // Tenant should get remaining escrow refunded
      const tenantAfter = await ethers.provider.getBalance(tenant.address);
      expect(tenantAfter).to.be.gt(tenantBefore);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  EDGE CASES
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Pause', function () {
    it('should prevent deployments when paused', async function () {
      await circuit.pause();
      await expect(
        circuit.connect(tenant).createDeployment(
          specId, SDL_HASH, ethers.parseEther('0.01'), 100,
          { value: ethers.parseEther('1.0') }
        )
      ).to.be.revertedWithCustomError(circuit, 'EnforcedPause');
    });
  });

  describe('Stats', function () {
    it('should return initial stats', async function () {
      const [deps, bidCount, leases, active, completed, vol, fees] = await circuit.getStats();
      expect(deps).to.equal(0n);
      expect(bidCount).to.equal(0n);
      expect(leases).to.equal(0n);
    });
  });
});
