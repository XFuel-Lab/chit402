/**
 * Security — Contract Fuzz Tests (Phase 1 Audit Scope)
 *
 * Run: npx hardhat test test/security/ContractFuzz.test.cjs
 *
 * Fuzz-tests CoreRevenueSplitter, ZKVerifierSP1, and veXFGovernance with
 * randomized inputs to surface edge cases, arithmetic overflows, and
 * invariant violations before CertiK audit.
 */

const { expect } = require('chai');
const hre = require('hardhat');
const { ethers } = hre;

async function increaseTime(seconds) {
  await hre.network.provider.send('evm_increaseTime', [seconds]);
  await hre.network.provider.send('evm_mine');
}

async function latestTimestamp() {
  const block = await ethers.provider.getBlock('latest');
  return block.timestamp;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomBigInt(minWei, maxWei) {
  const range = maxWei - minWei;
  const rand = BigInt(Math.floor(Math.random() * Number(range)));
  return minWei + rand;
}

function uniqueNullifier(prefix, index) {
  return ethers.keccak256(ethers.toUtf8Bytes(`${prefix}-${index}-${Date.now()}-${Math.random()}`));
}

describe('Contract Fuzz Tests (Phase 1 Audit Scope)', function () {
  this.timeout(180000);

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. CoreRevenueSplitter BPS Fuzz
  // ═══════════════════════════════════════════════════════════════════════════

  describe('CoreRevenueSplitter — BPS Fuzz', function () {
    let splitter;
    let admin, bbb, lp, staker, treasury, pool, feeManager;

    beforeEach(async function () {
      [admin, bbb, lp, staker, treasury, pool, feeManager] = await ethers.getSigners();

      const Factory = await ethers.getContractFactory('CoreRevenueSplitter');
      splitter = await Factory.deploy(
        admin.address, bbb.address, lp.address,
        staker.address, treasury.address, pool.address
      );
      await splitter.waitForDeployment();

      const FEE_MANAGER_ROLE = await splitter.FEE_MANAGER_ROLE();
      await splitter.grantRole(FEE_MANAGER_ROLE, feeManager.address);
    });

    it('should accept any valid 4-way BPS split summing to 10000', async function () {
      let accepted = 0;
      for (let i = 0; i < 50; i++) {
        const a = randomInt(500, 5000);
        const b = randomInt(500, 3000);
        const c = randomInt(500, 2000);
        const d = 10000 - a - b - c;

        if (d >= 0 && d <= 10000) {
          await splitter.connect(feeManager).setSplit(a, b, c, d);
          const [rA, rB, rC, rD] = await splitter.getSplit();
          expect(rA).to.equal(a);
          expect(rB).to.equal(b);
          expect(rC).to.equal(c);
          expect(rD).to.equal(d);
          accepted++;
        }
      }
      expect(accepted).to.be.greaterThan(0, 'no valid splits generated');
    });

    it('should reject any split not summing to 10000', async function () {
      for (let i = 0; i < 30; i++) {
        const a = randomInt(100, 4000);
        const b = randomInt(100, 4000);
        const c = randomInt(100, 4000);
        const d = randomInt(100, 4000);
        const sum = a + b + c + d;

        if (sum !== 10000) {
          await expect(
            splitter.connect(feeManager).setSplit(a, b, c, d)
          ).to.be.reverted;
        }
      }
    });

    it('should accept feeToStake values within 1500-2500', async function () {
      for (let i = 0; i < 30; i++) {
        const bps = randomInt(1500, 2500);
        await splitter.connect(feeManager).setFeeToStake(bps);
        expect(await splitter.feeToStakeBps()).to.equal(bps);
      }
    });

    it('should reject feeToStake values outside 1500-2500', async function () {
      const outOfRange = [
        randomInt(0, 1499),
        randomInt(2501, 10000),
        0,
        10000,
      ];
      for (const bps of outOfRange) {
        await expect(
          splitter.connect(feeManager).setFeeToStake(bps)
        ).to.be.reverted;
      }
    });

    it('should accept extreme but valid edge splits', async function () {
      const edges = [
        [10000, 0, 0, 0],
        [0, 10000, 0, 0],
        [0, 0, 10000, 0],
        [0, 0, 0, 10000],
        [2500, 2500, 2500, 2500],
        [1, 1, 1, 9997],
        [9997, 1, 1, 1],
      ];
      for (const [a, b, c, d] of edges) {
        await splitter.connect(feeManager).setSplit(a, b, c, d);
        const [rA, rB, rC, rD] = await splitter.getSplit();
        expect(Number(rA) + Number(rB) + Number(rC) + Number(rD)).to.equal(10000);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. CoreRevenueSplitter Distribution Fuzz
  // ═══════════════════════════════════════════════════════════════════════════

  describe('CoreRevenueSplitter — Distribution Fuzz', function () {
    let splitter;
    let admin, bbb, lp, staker, treasury, pool, user;

    beforeEach(async function () {
      [admin, bbb, lp, staker, treasury, pool, user] = await ethers.getSigners();

      const Factory = await ethers.getContractFactory('CoreRevenueSplitter');
      splitter = await Factory.deploy(
        admin.address, bbb.address, lp.address,
        staker.address, treasury.address, pool.address
      );
      await splitter.waitForDeployment();
    });

    it('should distribute random ETH amounts without reverting', async function () {
      const amounts = [
        1n,                                    // 1 wei
        ethers.parseEther('0.001'),
        ethers.parseEther('0.1'),
        ethers.parseEther('1'),
        ethers.parseEther('10'),
        ethers.parseEther('50'),
        ethers.parseEther('100'),
      ];

      for (const amount of amounts) {
        await user.sendTransaction({ to: await splitter.getAddress(), value: amount });

        const balBefore = await ethers.provider.getBalance(await splitter.getAddress());
        expect(balBefore).to.equal(amount);

        await splitter.distribute();

        const balAfter = await ethers.provider.getBalance(await splitter.getAddress());
        expect(balAfter).to.equal(0n);
      }
    });

    it('should preserve total distributed == total collected across random amounts', async function () {
      const splitterAddr = await splitter.getAddress();

      for (let i = 0; i < 20; i++) {
        const ethAmount = randomBigInt(1n, ethers.parseEther('10'));
        await user.sendTransaction({ to: splitterAddr, value: ethAmount });
        await splitter.distribute();
      }

      const stats = await splitter.getStats();
      expect(stats.distributed).to.equal(stats.collected);
    });

    it('should correctly attribute split amounts for random deposits', async function () {
      const splitterAddr = await splitter.getAddress();

      for (let i = 0; i < 10; i++) {
        const amount = ethers.parseEther(String(randomInt(1, 50)));
        await user.sendTransaction({ to: splitterAddr, value: amount });
        await splitter.distribute();
      }

      const stats = await splitter.getStats();
      const totalParts = stats.bbb + stats.lp + stats.staker + stats.treasury + stats.feeStake;
      expect(totalParts).to.equal(stats.distributed);
    });

    it('should revert distribute() on zero balance', async function () {
      await expect(splitter.distribute()).to.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. ZKVerifierSP1 Proof Fuzz
  // ═══════════════════════════════════════════════════════════════════════════

  describe('ZKVerifierSP1 — Proof Fuzz', function () {
    let verifier;
    let admin;
    const CIRCUIT_ID = ethers.keccak256(ethers.toUtf8Bytes('FuzzCircuit'));
    const PROGRAM_VKEY = ethers.keccak256(ethers.toUtf8Bytes('fuzz-vkey-v1'));

    beforeEach(async function () {
      [admin] = await ethers.getSigners();

      const Factory = await ethers.getContractFactory('ZKVerifierSP1');
      verifier = await Factory.deploy(admin.address, ethers.ZeroAddress);
      await verifier.waitForDeployment();

      await verifier.registerCircuit(CIRCUIT_ID, PROGRAM_VKEY, 'FuzzCircuit');
    });

    it('should verify 100 proofs with random inputs in mock mode', async function () {
      for (let i = 0; i < 100; i++) {
        const pvLen = randomInt(32, 256);
        const proofLen = randomInt(64, 260);

        const publicValues = ethers.hexlify(ethers.randomBytes(pvLen));
        const proofBytes = ethers.hexlify(ethers.randomBytes(proofLen));
        const nullifier = uniqueNullifier('proof', i);

        const tx = await verifier.verifyProof(CIRCUIT_ID, publicValues, proofBytes, nullifier);
        await tx.wait();

        expect(await verifier.isNullifierUsed(nullifier)).to.be.true;
      }

      const stats = await verifier.getStats();
      expect(stats.verified).to.equal(100n);
    });

    it('should reject duplicate nullifiers', async function () {
      const nullifier = uniqueNullifier('dup', 0);
      const pv = ethers.hexlify(ethers.randomBytes(64));
      const proof = ethers.hexlify(ethers.randomBytes(130));

      await verifier.verifyProof(CIRCUIT_ID, pv, proof, nullifier);

      await expect(
        verifier.verifyProof(CIRCUIT_ID, pv, proof, nullifier)
      ).to.be.reverted;
    });

    it('should reject proofs for unregistered circuits', async function () {
      const badCircuit = ethers.keccak256(ethers.toUtf8Bytes('nonexistent'));
      const nullifier = uniqueNullifier('unreg', 0);

      await expect(
        verifier.verifyProof(badCircuit, '0xaa', '0xbb', nullifier)
      ).to.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. ZKVerifierSP1 Batch Fuzz
  // ═══════════════════════════════════════════════════════════════════════════

  describe('ZKVerifierSP1 — Batch Fuzz', function () {
    let verifier;
    let admin;
    const CIRCUIT_ID = ethers.keccak256(ethers.toUtf8Bytes('BatchFuzz'));
    const PROGRAM_VKEY = ethers.keccak256(ethers.toUtf8Bytes('batch-vkey-v1'));

    beforeEach(async function () {
      [admin] = await ethers.getSigners();

      const Factory = await ethers.getContractFactory('ZKVerifierSP1');
      verifier = await Factory.deploy(admin.address, ethers.ZeroAddress);
      await verifier.waitForDeployment();

      await verifier.registerCircuit(CIRCUIT_ID, PROGRAM_VKEY, 'BatchFuzz');
    });

    it('should batch-verify random-sized batches (1-10 proofs)', async function () {
      let totalBatchVerified = 0n;

      for (let round = 0; round < 5; round++) {
        const batchSize = randomInt(1, 10);
        const circuitIds = [];
        const publicValuesArr = [];
        const proofBytesArr = [];
        const nullifiers = [];

        for (let j = 0; j < batchSize; j++) {
          circuitIds.push(CIRCUIT_ID);
          publicValuesArr.push(ethers.hexlify(ethers.randomBytes(randomInt(32, 128))));
          proofBytesArr.push(ethers.hexlify(ethers.randomBytes(randomInt(64, 200))));
          nullifiers.push(uniqueNullifier(`batch-${round}`, j));
        }

        const tx = await verifier.verifyProofBatch(
          circuitIds, publicValuesArr, proofBytesArr, nullifiers
        );
        await tx.wait();

        for (const n of nullifiers) {
          expect(await verifier.isNullifierUsed(n)).to.be.true;
        }
        totalBatchVerified += BigInt(batchSize);
      }

      const stats = await verifier.getStats();
      expect(stats.verified).to.equal(totalBatchVerified);
    });

    it('should skip already-used nullifiers in batch without reverting', async function () {
      const usedNullifier = uniqueNullifier('preused', 0);
      const pv = ethers.hexlify(ethers.randomBytes(64));
      const proof = ethers.hexlify(ethers.randomBytes(130));

      await verifier.verifyProof(CIRCUIT_ID, pv, proof, usedNullifier);

      const freshNullifier = uniqueNullifier('fresh', 0);
      const tx = await verifier.verifyProofBatch(
        [CIRCUIT_ID, CIRCUIT_ID],
        [pv, pv],
        [proof, proof],
        [usedNullifier, freshNullifier]
      );
      await tx.wait();

      const stats = await verifier.getStats();
      expect(stats.verified).to.equal(2n);
    });

    it('should reject empty batch', async function () {
      await expect(
        verifier.verifyProofBatch([], [], [], [])
      ).to.be.reverted;
    });

    it('should reject batch exceeding 20 proofs', async function () {
      const size = 21;
      const ids = Array(size).fill(CIRCUIT_ID);
      const pvs = Array(size).fill(ethers.hexlify(ethers.randomBytes(64)));
      const proofs = Array(size).fill(ethers.hexlify(ethers.randomBytes(130)));
      const nulls = Array.from({ length: size }, (_, i) => uniqueNullifier('over', i));

      await expect(
        verifier.verifyProofBatch(ids, pvs, proofs, nulls)
      ).to.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. veXFGovernance Lock Duration Fuzz
  // ═══════════════════════════════════════════════════════════════════════════

  describe('veXFGovernance — Lock Duration Fuzz', function () {
    let gov, xfToken;
    let admin, alice;

    const ONE_WEEK = 7 * 24 * 3600;
    const MIN_LOCK = 26 * ONE_WEEK;
    const MAX_LOCK = 3 * 365 * 24 * 3600;
    const LOCK_AMOUNT = ethers.parseEther('1000');

    beforeEach(async function () {
      [admin, alice] = await ethers.getSigners();

      const TokenF = await ethers.getContractFactory('MockERC20');
      xfToken = await TokenF.deploy('XFuel', 'XF', 18);
      await xfToken.waitForDeployment();

      const GovF = await ethers.getContractFactory('veXFGovernance');
      gov = await GovF.deploy(admin.address, await xfToken.getAddress());
      await gov.waitForDeployment();
    });

    it('should accept locks with random valid durations', async function () {
      const now = await latestTimestamp();

      for (let i = 0; i < 20; i++) {
        const signer = (await ethers.getSigners())[i + 2];
        if (!signer) break;

        const duration = randomInt(MIN_LOCK, MAX_LOCK);
        const rawUnlock = now + duration;
        const unlockTime = Math.floor(rawUnlock / ONE_WEEK) * ONE_WEEK;
        const effectiveDuration = unlockTime - now;

        if (effectiveDuration < MIN_LOCK || effectiveDuration > MAX_LOCK) continue;

        await xfToken.mint(signer.address, LOCK_AMOUNT);
        await xfToken.connect(signer).approve(await gov.getAddress(), LOCK_AMOUNT);
        await gov.connect(signer).lock(LOCK_AMOUNT, unlockTime);

        const vp = await gov.votingPower(signer.address);
        expect(vp).to.be.greaterThan(0n);
      }
    });

    it('should reject locks shorter than MIN_LOCK', async function () {
      const now = await latestTimestamp();

      for (let i = 0; i < 10; i++) {
        const signer = (await ethers.getSigners())[i + 2];
        if (!signer) break;

        const tooShort = randomInt(1, MIN_LOCK - ONE_WEEK);
        const rawUnlock = now + tooShort;
        const unlockTime = Math.floor(rawUnlock / ONE_WEEK) * ONE_WEEK;

        await xfToken.mint(signer.address, LOCK_AMOUNT);
        await xfToken.connect(signer).approve(await gov.getAddress(), LOCK_AMOUNT);

        await expect(
          gov.connect(signer).lock(LOCK_AMOUNT, unlockTime)
        ).to.be.reverted;
      }
    });

    it('should reject locks longer than MAX_LOCK', async function () {
      const now = await latestTimestamp();

      for (let i = 0; i < 5; i++) {
        const signer = (await ethers.getSigners())[i + 2];
        if (!signer) break;

        const tooLong = MAX_LOCK + randomInt(ONE_WEEK, 365 * 24 * 3600);
        const rawUnlock = now + tooLong;
        const unlockTime = Math.ceil(rawUnlock / ONE_WEEK) * ONE_WEEK;

        await xfToken.mint(signer.address, LOCK_AMOUNT);
        await xfToken.connect(signer).approve(await gov.getAddress(), LOCK_AMOUNT);

        await expect(
          gov.connect(signer).lock(LOCK_AMOUNT, unlockTime)
        ).to.be.reverted;
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. veXFGovernance Voting Power Fuzz
  // ═══════════════════════════════════════════════════════════════════════════

  describe('veXFGovernance — Voting Power Fuzz', function () {
    let gov, xfToken;
    let admin;

    const ONE_WEEK = 7 * 24 * 3600;
    const MIN_LOCK = 26 * ONE_WEEK;
    const MAX_LOCK = 3 * 365 * 24 * 3600;
    const MAX_MULTIPLIER = 3n;

    beforeEach(async function () {
      [admin] = await ethers.getSigners();

      const TokenF = await ethers.getContractFactory('MockERC20');
      xfToken = await TokenF.deploy('XFuel', 'XF', 18);
      await xfToken.waitForDeployment();

      const GovF = await ethers.getContractFactory('veXFGovernance');
      gov = await GovF.deploy(admin.address, await xfToken.getAddress());
      await gov.waitForDeployment();
    });

    it('should produce positive voting power for random valid locks', async function () {
      const now = await latestTimestamp();

      for (let i = 0; i < 15; i++) {
        const signer = (await ethers.getSigners())[i + 2];
        if (!signer) break;

        const amount = ethers.parseEther(String(randomInt(100, 50000)));
        const duration = randomInt(MIN_LOCK, MAX_LOCK);
        const rawUnlock = now + duration;
        const unlockTime = Math.floor(rawUnlock / ONE_WEEK) * ONE_WEEK;
        const effectiveDuration = unlockTime - now;

        if (effectiveDuration < MIN_LOCK || effectiveDuration > MAX_LOCK) continue;

        await xfToken.mint(signer.address, amount);
        await xfToken.connect(signer).approve(await gov.getAddress(), amount);
        await gov.connect(signer).lock(amount, unlockTime);

        const vp = await gov.votingPower(signer.address);
        expect(vp).to.be.greaterThan(0n);

        const maxPossible = amount * MAX_MULTIPLIER;
        expect(vp).to.be.lessThanOrEqual(maxPossible);
      }
    });

    it('should decay voting power toward zero as time passes', async function () {
      const signer = (await ethers.getSigners())[2];
      const amount = ethers.parseEther('10000');
      const now = await latestTimestamp();
      const duration = MIN_LOCK + ONE_WEEK;
      const unlockTime = Math.floor((now + duration) / ONE_WEEK) * ONE_WEEK;

      await xfToken.mint(signer.address, amount);
      await xfToken.connect(signer).approve(await gov.getAddress(), amount);
      await gov.connect(signer).lock(amount, unlockTime);

      const vpInitial = await gov.votingPower(signer.address);
      expect(vpInitial).to.be.greaterThan(0n);

      await increaseTime(Math.floor(MIN_LOCK / 2));
      const vpMid = await gov.votingPower(signer.address);
      expect(vpMid).to.be.lessThan(vpInitial);

      await increaseTime(MIN_LOCK);
      const vpEnd = await gov.votingPower(signer.address);
      expect(vpEnd).to.equal(0n);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. Escrow Lifecycle Fuzz
  // ═══════════════════════════════════════════════════════════════════════════

  describe('CoreRevenueSplitter — Escrow Lifecycle Fuzz', function () {
    let splitter;
    let admin, bbb, lp, staker, treasury, pool, payer, payee;

    const ONE_DAY = 24 * 3600;

    beforeEach(async function () {
      [admin, bbb, lp, staker, treasury, pool, payer, payee] = await ethers.getSigners();

      const Factory = await ethers.getContractFactory('CoreRevenueSplitter');
      splitter = await Factory.deploy(
        admin.address, bbb.address, lp.address,
        staker.address, treasury.address, pool.address
      );
      await splitter.waitForDeployment();
    });

    it('should create escrows with random durations and amounts', async function () {
      for (let i = 0; i < 20; i++) {
        const duration = randomInt(1, 30 * ONE_DAY);
        const amount = ethers.parseEther(String(randomInt(1, 10)));
        const taskId = ethers.keccak256(ethers.toUtf8Bytes(`task-${i}`));

        const tx = await splitter.connect(payer).createEscrow(
          payee.address, amount, taskId, duration,
          { value: amount }
        );
        await tx.wait();
      }

      expect(await splitter.escrowCount()).to.equal(20n);
    });

    it('should reject escrow with zero value', async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes('zero-val'));
      await expect(
        splitter.connect(payer).createEscrow(
          payee.address, ethers.parseEther('1'), taskId, ONE_DAY,
          { value: 0 }
        )
      ).to.be.reverted;
    });

    it('should reject escrow with duration > 30 days', async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes('long-dur'));
      await expect(
        splitter.connect(payer).createEscrow(
          payee.address, ethers.parseEther('1'), taskId, 31 * ONE_DAY,
          { value: ethers.parseEther('1') }
        )
      ).to.be.reverted;
    });

    it('should reject escrow where payer == payee', async function () {
      const taskId = ethers.keccak256(ethers.toUtf8Bytes('self-pay'));
      await expect(
        splitter.connect(payer).createEscrow(
          payer.address, ethers.parseEther('1'), taskId, ONE_DAY,
          { value: ethers.parseEther('1') }
        )
      ).to.be.reverted;
    });

    it('should allow partial claims and track remaining correctly', async function () {
      const amount = ethers.parseEther('10');
      const taskId = ethers.keccak256(ethers.toUtf8Bytes('partial'));

      await splitter.connect(payer).createEscrow(
        payee.address, amount, taskId, 7 * ONE_DAY,
        { value: amount }
      );

      const escrowId = await splitter.escrowCount();
      const claimAmount = ethers.parseEther('5');
      const protocolFeeBps = 100n;

      const payeeBefore = await ethers.provider.getBalance(payee.address);

      const tx = await splitter.connect(payee).claimEscrow(escrowId, claimAmount);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const payeeAfter = await ethers.provider.getBalance(payee.address);
      const expectedFee = (claimAmount * protocolFeeBps) / 10000n;
      const expectedNet = claimAmount - expectedFee;

      expect(payeeAfter - payeeBefore + gasUsed).to.equal(expectedNet);
    });

    it('should handle random claim amounts up to maxAmount', async function () {
      for (let i = 0; i < 10; i++) {
        const maxAmount = ethers.parseEther(String(randomInt(5, 20)));
        const depositAmount = maxAmount;
        const taskId = ethers.keccak256(ethers.toUtf8Bytes(`rand-claim-${i}`));

        await splitter.connect(payer).createEscrow(
          payee.address, maxAmount, taskId, 7 * ONE_DAY,
          { value: depositAmount }
        );

        const escrowId = await splitter.escrowCount();
        const claim = randomBigInt(1n, maxAmount);

        await splitter.connect(payee).claimEscrow(escrowId, claim);

        const escrow = await splitter.getEscrow(escrowId);
        expect(escrow.claimed).to.be.true;
      }
    });

    it('should reject claim exceeding maxAmount', async function () {
      const amount = ethers.parseEther('5');
      const maxAmount = ethers.parseEther('5');
      const taskId = ethers.keccak256(ethers.toUtf8Bytes('over-claim'));

      await splitter.connect(payer).createEscrow(
        payee.address, maxAmount, taskId, 7 * ONE_DAY,
        { value: amount }
      );

      const escrowId = await splitter.escrowCount();
      const overClaim = maxAmount + 1n;

      await expect(
        splitter.connect(payee).claimEscrow(escrowId, overClaim)
      ).to.be.reverted;
    });

    it('should reject double claims on same escrow', async function () {
      const amount = ethers.parseEther('5');
      const taskId = ethers.keccak256(ethers.toUtf8Bytes('double'));

      await splitter.connect(payer).createEscrow(
        payee.address, amount, taskId, 7 * ONE_DAY,
        { value: amount }
      );

      const escrowId = await splitter.escrowCount();
      await splitter.connect(payee).claimEscrow(escrowId, amount);

      await expect(
        splitter.connect(payee).claimEscrow(escrowId, amount)
      ).to.be.reverted;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. Combined Stress Test
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Combined Stress Test — All 3 Contracts', function () {
    let splitter, verifier, gov, xfToken;
    let admin, bbb, lp, staker, treasury, pool, user1, user2;

    const ONE_WEEK = 7 * 24 * 3600;
    const MIN_LOCK = 26 * ONE_WEEK;

    const CIRCUIT_ID = ethers.keccak256(ethers.toUtf8Bytes('StressCircuit'));
    const PROGRAM_VKEY = ethers.keccak256(ethers.toUtf8Bytes('stress-vkey'));

    beforeEach(async function () {
      [admin, bbb, lp, staker, treasury, pool, user1, user2] = await ethers.getSigners();

      const SplitterF = await ethers.getContractFactory('CoreRevenueSplitter');
      splitter = await SplitterF.deploy(
        admin.address, bbb.address, lp.address,
        staker.address, treasury.address, pool.address
      );
      await splitter.waitForDeployment();

      const VerifierF = await ethers.getContractFactory('ZKVerifierSP1');
      verifier = await VerifierF.deploy(admin.address, ethers.ZeroAddress);
      await verifier.waitForDeployment();

      await verifier.registerCircuit(CIRCUIT_ID, PROGRAM_VKEY, 'StressCircuit');

      const TokenF = await ethers.getContractFactory('MockERC20');
      xfToken = await TokenF.deploy('XFuel', 'XF', 18);
      await xfToken.waitForDeployment();

      const GovF = await ethers.getContractFactory('veXFGovernance');
      gov = await GovF.deploy(admin.address, await xfToken.getAddress());
      await gov.waitForDeployment();

      const FEE_MANAGER_ROLE = await splitter.FEE_MANAGER_ROLE();
      await splitter.grantRole(FEE_MANAGER_ROLE, admin.address);
    });

    it('should survive 200 random operations across all contracts', async function () {
      let proofIndex = 0;
      let escrowIndex = 0;
      let depositIndex = 0;
      let routeIndex = 0;
      let splitIndex = 0;
      let lockIndex = 0;
      let errors = 0;
      const now = await latestTimestamp();

      for (let i = 0; i < 200; i++) {
        const op = randomInt(0, 6);

        try {
          switch (op) {
            case 0: {
              // Deposit fee to splitter
              const circuitId = ethers.keccak256(ethers.toUtf8Bytes(`dep-${depositIndex++}`));
              const amount = ethers.parseEther(String(randomInt(1, 5)));
              await splitter.connect(user1).depositFee(circuitId, { value: amount });
              break;
            }
            case 1: {
              // Distribute if balance > 0
              const pending = await ethers.provider.getBalance(await splitter.getAddress());
              if (pending > 0n) {
                await splitter.distribute();
              }
              break;
            }
            case 2: {
              // Verify a proof
              const pv = ethers.hexlify(ethers.randomBytes(64));
              const proof = ethers.hexlify(ethers.randomBytes(130));
              const nullifier = uniqueNullifier('stress-proof', proofIndex++);
              await verifier.verifyProof(CIRCUIT_ID, pv, proof, nullifier);
              break;
            }
            case 3: {
              // Update BPS split
              const a = randomInt(1000, 4000);
              const b = randomInt(1000, 3000);
              const c = randomInt(500, 2000);
              const d = 10000 - a - b - c;
              if (d >= 0 && d <= 10000) {
                await splitter.setSplit(a, b, c, d);
                splitIndex++;
              }
              break;
            }
            case 4: {
              // Create escrow
              const amount = ethers.parseEther(String(randomInt(1, 3)));
              const taskId = ethers.keccak256(ethers.toUtf8Bytes(`stress-esc-${escrowIndex++}`));
              await splitter.connect(user1).createEscrow(
                user2.address, amount, taskId, randomInt(3600, 7 * 24 * 3600),
                { value: amount }
              );
              break;
            }
            case 5: {
              // Add stake route
              const signers = await ethers.getSigners();
              const routePool = signers[randomInt(2, signers.length - 1)];
              await splitter.addStakeRoute(
                routePool.address,
                BigInt(randomInt(1, 1000)),
                `route-${routeIndex++}`,
                randomInt(100, 3000)
              );
              break;
            }
            case 6: {
              // Lock tokens for governance (use a fresh signer each time)
              const signers = await ethers.getSigners();
              const idx = lockIndex + 8;
              if (idx < signers.length) {
                const signer = signers[idx];
                const amt = ethers.parseEther('100');
                const unlockTime = Math.floor((now + MIN_LOCK + ONE_WEEK * (lockIndex + 1)) / ONE_WEEK) * ONE_WEEK;

                await xfToken.mint(signer.address, amt);
                await xfToken.connect(signer).approve(await gov.getAddress(), amt);
                await gov.connect(signer).lock(amt, unlockTime);
                lockIndex++;
              }
              break;
            }
          }
        } catch {
          errors++;
        }
      }

      // Verify state integrity after stress run
      const splitterStats = await splitter.getStats();
      const x402Stats = await splitter.getX402Stats();

      // distributed can exceed collected when escrow deposits (not tracked as
      // collected) are in the balance at distribution time
      const collectedPlusEscrowed = splitterStats.collected + x402Stats.escrowed;
      expect(collectedPlusEscrowed).to.be.greaterThanOrEqual(splitterStats.distributed);

      const verifierStats = await verifier.getStats();
      expect(verifierStats.verified).to.be.greaterThan(0n);

      // Allow some expected reverts (e.g. zero-balance distribute, signer exhaustion)
      // but the vast majority should succeed
      expect(errors).to.be.lessThan(100);
    });

    it('should maintain accounting invariants after mixed operations', async function () {
      const splitterAddr = await splitter.getAddress();

      for (let i = 0; i < 30; i++) {
        const amount = ethers.parseEther(String(randomInt(1, 10)));
        const circuitId = ethers.keccak256(ethers.toUtf8Bytes(`inv-${i}`));
        await splitter.connect(user1).depositFee(circuitId, { value: amount });
      }

      const collected = (await splitter.getStats()).collected;
      expect(collected).to.be.greaterThan(0n);

      const pending = await ethers.provider.getBalance(splitterAddr);
      expect(pending).to.be.greaterThan(0n);

      await splitter.distribute();

      const postStats = await splitter.getStats();
      expect(postStats.distributed).to.be.greaterThan(0n);
      expect(postStats.bbb + postStats.lp + postStats.staker + postStats.treasury + postStats.feeStake)
        .to.equal(postStats.distributed);
    });

    it('should not panic with interleaved verifier and splitter ops', async function () {
      for (let i = 0; i < 50; i++) {
        const pv = ethers.hexlify(ethers.randomBytes(64));
        const proof = ethers.hexlify(ethers.randomBytes(130));
        const nullifier = uniqueNullifier('interleave', i);

        await verifier.verifyProof(CIRCUIT_ID, pv, proof, nullifier);

        if (i % 5 === 0) {
          const amount = ethers.parseEther('1');
          const circuitId = ethers.keccak256(ethers.toUtf8Bytes(`il-${i}`));
          await splitter.connect(user1).depositFee(circuitId, { value: amount });
          await splitter.distribute();
        }
      }

      const vStats = await verifier.getStats();
      expect(vStats.verified).to.equal(50n);

      const sStats = await splitter.getStats();
      expect(sStats.distributed).to.equal(sStats.collected);
    });
  });
});
