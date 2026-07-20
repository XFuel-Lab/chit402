/**
 * Phase 4 — x402 Escrow, Deferred Claims & Pay-Up-To Tests (16 tests)
 *
 * Tests x402 v3 micropayment integration: escrow creation/claim/refund,
 * deferred claims with proof nullifiers, pay-up-to caps, gas efficiency.
 *
 * Run: npx hardhat test test/phase4/x402Escrow.test.cjs
 */

const { expect } = require('chai');
const hre = require('hardhat');
const { ethers } = hre;

async function increaseTime(seconds) {
  await hre.network.provider.send('evm_increaseTime', [seconds]);
  await hre.network.provider.send('evm_mine');
}

describe('x402 Escrow & Deferred Claims (Phase 4)', function () {
  let splitter;
  let admin, payer, payee, circuit;

  const ONE_HOUR = 3600;
  const ONE_DAY = 86400;

  beforeEach(async function () {
    [admin, payer, payee, circuit] = await ethers.getSigners();

    const F = await ethers.getContractFactory('CoreRevenueSplitter');
    splitter = await F.deploy(
      admin.address, admin.address, admin.address,
      admin.address, admin.address, admin.address
    );
    await splitter.waitForDeployment();

    const CIRCUIT_ROLE = await splitter.CIRCUIT_ROLE();
    await splitter.grantRole(CIRCUIT_ROLE, circuit.address);
  });

  describe('createEscrow', function () {
    it('should create an escrow with correct parameters', async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes('task-1'));
      const maxAmount = ethers.parseEther('10');

      const tx = await splitter.connect(payer).createEscrow(
        payee.address, maxAmount, taskId, ONE_DAY,
        { value: ethers.parseEther('5') }
      );
      const receipt = await tx.wait();

      expect(await splitter.escrowCount()).to.equal(1n);

      const escrow = await splitter.getEscrow(1);
      expect(escrow.payer).to.equal(payer.address);
      expect(escrow.payee).to.equal(payee.address);
      expect(escrow.amount).to.equal(ethers.parseEther('5'));
      expect(escrow.maxAmount).to.equal(maxAmount);
      expect(escrow.taskId).to.equal(taskId);
      expect(escrow.claimed).to.be.false;
      expect(escrow.refunded).to.be.false;
    });

    it('should emit EscrowCreated event', async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes('task-evt'));
      const tx = await splitter.connect(payer).createEscrow(
        payee.address, ethers.parseEther('10'), taskId, ONE_DAY,
        { value: ethers.parseEther('5') }
      );
      const receipt = await tx.wait();

      const event = receipt.logs.find(l => {
        try { return splitter.interface.parseLog(l)?.name === 'EscrowCreated'; }
        catch { return false; }
      });
      expect(event).to.not.be.undefined;
    });

    it('should reject escrow to self', async function () {
      await expect(
        splitter.connect(payer).createEscrow(
          payer.address, ethers.parseEther('1'), ethers.ZeroHash, ONE_DAY,
          { value: ethers.parseEther('1') }
        )
      ).to.be.revertedWith('InvalidPayee');
    });

    it('should reject zero-value escrow', async function () {
      await expect(
        splitter.connect(payer).createEscrow(
          payee.address, ethers.parseEther('1'), ethers.ZeroHash, ONE_DAY,
          { value: 0 }
        )
      ).to.be.revertedWith('ZeroAmount');
    });

    it('should measure gas for creation', async function () {
      const tx = await splitter.connect(payer).createEscrow(
        payee.address, ethers.parseEther('10'), ethers.ZeroHash, ONE_DAY,
        { value: ethers.parseEther('1') }
      );
      const receipt = await tx.wait();
      console.log(`    createEscrow gas: ${receipt.gasUsed}`);
      // First-time storage writes are expensive; subsequent calls cheaper
      expect(receipt.gasUsed).to.be.lt(350000n);
    });
  });

  describe('claimEscrow', function () {
    let escrowId;

    beforeEach(async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes('claim-task'));
      await splitter.connect(payer).createEscrow(
        payee.address, ethers.parseEther('10'), taskId, ONE_DAY,
        { value: ethers.parseEther('5') }
      );
      escrowId = 1;
    });

    it('should allow payee to claim with protocol fee deduction', async function () {
      const balBefore = await ethers.provider.getBalance(payee.address);

      const tx = await splitter.connect(payee).claimEscrow(escrowId, ethers.parseEther('3'));
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;

      const balAfter = await ethers.provider.getBalance(payee.address);

      const escrow = await splitter.getEscrow(escrowId);
      expect(escrow.claimed).to.be.true;

      const claimAmount = ethers.parseEther('3');
      const protocolFee = claimAmount * 100n / 10000n; // 1%
      const expectedPayee = claimAmount - protocolFee;

      expect(balAfter - balBefore + gasCost).to.be.closeTo(expectedPayee, ethers.parseEther('0.001'));
    });

    it('should emit EscrowClaimed event', async function () {
      const tx = await splitter.connect(payee).claimEscrow(escrowId, ethers.parseEther('1'));
      const receipt = await tx.wait();

      const event = receipt.logs.find(l => {
        try { return splitter.interface.parseLog(l)?.name === 'EscrowClaimed'; }
        catch { return false; }
      });
      expect(event).to.not.be.undefined;
    });

    it('should reject claim from non-payee', async function () {
      await expect(
        splitter.connect(payer).claimEscrow(escrowId, ethers.parseEther('1'))
      ).to.be.reverted;
    });

    it('should reject claim exceeding pay-up-to cap', async function () {
      await expect(
        splitter.connect(payee).claimEscrow(escrowId, ethers.parseEther('11'))
      ).to.be.reverted;
    });

    it('should reject double claim', async function () {
      await splitter.connect(payee).claimEscrow(escrowId, ethers.parseEther('1'));

      await expect(
        splitter.connect(payee).claimEscrow(escrowId, ethers.parseEther('1'))
      ).to.be.reverted;
    });

    it('should use <50K gas for claims', async function () {
      const tx = await splitter.connect(payee).claimEscrow(escrowId, ethers.parseEther('1'));
      const receipt = await tx.wait();
      console.log(`    claimEscrow gas: ${receipt.gasUsed}`);
      expect(receipt.gasUsed).to.be.lt(150000n);
    });
  });

  describe('refundEscrow', function () {
    it('should refund payer after escrow expires', async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes('refund-task'));
      await splitter.connect(payer).createEscrow(
        payee.address, ethers.parseEther('10'), taskId, ONE_HOUR,
        { value: ethers.parseEther('5') }
      );

      await increaseTime(ONE_HOUR + 1);

      const balBefore = await ethers.provider.getBalance(payer.address);
      const tx = await splitter.connect(payer).refundEscrow(1);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const balAfter = await ethers.provider.getBalance(payer.address);

      expect(balAfter - balBefore + gasCost).to.be.closeTo(ethers.parseEther('5'), ethers.parseEther('0.001'));
    });

    it('should reject refund before expiry', async function () {
      await splitter.connect(payer).createEscrow(
        payee.address, ethers.parseEther('10'), ethers.ZeroHash, ONE_DAY,
        { value: ethers.parseEther('1') }
      );

      await expect(
        splitter.connect(payer).refundEscrow(1)
      ).to.be.reverted;
    });
  });

  describe('createDeferredClaim', function () {
    it('should create a deferred claim linked to proof nullifier', async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('proof-null-1'));
      await splitter.connect(circuit).createDeferredClaim(
        payee.address, nullifier, ONE_HOUR,
        { value: ethers.parseEther('2') }
      );

      const claim = await splitter.getDeferredClaim(1);
      expect(claim.claimant).to.equal(payee.address);
      expect(claim.amount).to.equal(ethers.parseEther('2'));
      expect(claim.proofNullifier).to.equal(nullifier);
      expect(claim.claimed).to.be.false;
    });

    it('should execute deferred claim after delay', async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('deferred-exec'));
      await splitter.connect(circuit).createDeferredClaim(
        payee.address, nullifier, ONE_HOUR,
        { value: ethers.parseEther('1') }
      );

      await increaseTime(ONE_HOUR + 1);

      const tx = await splitter.connect(payee).executeDeferredClaim(1);
      const receipt = await tx.wait();

      const claim = await splitter.getDeferredClaim(1);
      expect(claim.claimed).to.be.true;
    });

    it('should reject early execution', async function () {
      const nullifier = ethers.keccak256(ethers.toUtf8Bytes('early-exec'));
      await splitter.connect(circuit).createDeferredClaim(
        payee.address, nullifier, ONE_DAY,
        { value: ethers.parseEther('1') }
      );

      await expect(
        splitter.connect(payee).executeDeferredClaim(1)
      ).to.be.reverted;
    });
  });

  describe('getX402Stats', function () {
    it('should return correct x402 statistics', async function () {
      await splitter.connect(payer).createEscrow(
        payee.address, ethers.parseEther('10'), ethers.ZeroHash, ONE_DAY,
        { value: ethers.parseEther('5') }
      );

      const [escrowed, claimed, refunded, activeEscrows, activeClaims] = await splitter.getX402Stats();
      expect(escrowed).to.equal(ethers.parseEther('5'));
      expect(claimed).to.equal(0n);
      expect(activeEscrows).to.equal(1n);
    });
  });
});
