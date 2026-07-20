/**
 * Track 4.2 — TDROP Payment Option for Compute
 *
 * Tests:
 *   MockTDROP (ERC-20 test token)
 *
 *   ThetaInferenceCircuit — TDROP payment:
 *     1.  tdropToken is zero by default (TDROP disabled)
 *     2.  submitIntentWithTDROP reverts when tdropToken not set
 *     3.  setTdropConfig sets token, discount, rate
 *     4.  setTdropConfig emits TdropConfigUpdated
 *     5.  setTdropConfig reverts on discount > MAX_TDROP_DISCOUNT (50%)
 *     6.  setTdropConfig reverts on zero rate
 *     7.  quoteTdrop returns correct amounts (1:1 rate, 20% discount)
 *     8.  quoteTdrop reverts when tdropToken not set
 *     9.  submitIntentWithTDROP pulls correct TDROP from caller
 *    10.  submitIntentWithTDROP emits TdropIntentSubmitted + InferenceIntentSubmitted
 *    11.  submitIntentWithTDROP stores intent with correct serviceType
 *    12.  submitIntentWithTDROP reverts if caller has insufficient allowance
 *    13.  submitIntentWithTDROP forwards TDROP fee to splitter via receiveERC20Fee
 *    14.  totalTdropCollected increments correctly
 *    15.  TFUEL submitIntent still works alongside TDROP
 *    16.  Higher rate (2:1 TDROP per TFUEL) doubles TDROP required
 *    17.  Zero discount → full fee in TDROP with no discount
 *
 *   CoreRevenueSplitter — receiveERC20Fee():
 *    18.  receiveERC20Fee pulls ERC-20 from caller into contract
 *    19.  erc20Balances tracks amount per token
 *    20.  circuitErc20Fees tracks per circuit per token
 *    21.  totalErc20Collected tracks lifetime total per token
 *    22.  receiveERC20Fee emits ERC20FeeReceived
 *    23.  receiveERC20Fee with THETA_NATIVE tag increments thetaNativeFeesSinceReset
 *    24.  receiveERC20Fee reverts on zero amount
 *    25.  receiveERC20Fee reverts on zero token
 *    26.  getERC20Balance returns correct balance
 *    27.  getCircuitERC20Fees returns correct per-circuit amount
 *
 *   A2ACircuit — submitBidWithTDROP():
 *    28.  submitBidWithTDROP pulls escrow TDROP from requester
 *    29.  paymentToken field is set to tdropToken address
 *    30.  relay fee deducted in TDROP, netEscrow stored correctly
 *    31.  emits BidSubmitted event
 *    32.  existing TFUEL submitBid still works (backward compat)
 *    33.  submitBidWithTDROP reverts on zero token
 *    34.  submitBidWithTDROP reverts on zero escrow
 *    35.  submitBidWithTDROP reverts on past deadline
 *
 * Run: npx hardhat test test/track4/TDROPPayment.test.cjs
 */

'use strict';

const { expect } = require('chai');
const { ethers } = require('hardhat');
const { futureDeadline } = require('../../helpers.cjs');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function b32(str) { return ethers.keccak256(ethers.toUtf8Bytes(str)); }

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('Track 4.2 — TDROP Payment Option for Compute', function () {
  this.timeout(120000);

  let MockTDROP;
  let admin, relayer, user1, user2, bbb, get_, staker, treasury, stakePool;
  let tdrop;

  before(async function () {
    [admin, relayer, user1, user2, bbb, get_, staker, treasury, stakePool] = await ethers.getSigners();

    // Deploy a minimal ERC-20 mock for TDROP
    const MockERC20 = await ethers.getContractFactory('MockERC20');
    tdrop = await MockERC20.deploy('TDROP', 'TDROP', 18);
    await tdrop.waitForDeployment();

    // Mint tokens to test users
    await tdrop.mint(user1.address, ethers.parseEther('10000'));
    await tdrop.mint(user2.address, ethers.parseEther('10000'));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  //  ThetaInferenceCircuit
  // ─────────────────────────────────────────────────────────────────────────────
  describe('ThetaInferenceCircuit — TDROP payment', function () {
    let circuit, splitter;
    let llmServiceId;
    const PRICE = ethers.parseEther('1'); // 1 TFUEL

    before(async function () {
      const Splitter = await ethers.getContractFactory('CoreRevenueSplitter');
      splitter = await Splitter.deploy(
        admin.address, bbb.address, get_.address,
        staker.address, treasury.address, stakePool.address
      );
      await splitter.waitForDeployment();

      const Circuit = await ethers.getContractFactory('ThetaInferenceCircuit');
      circuit = await Circuit.deploy(admin.address, splitter.target, ethers.ZeroAddress);
      await circuit.waitForDeployment();

      await circuit.connect(admin).grantRole(await circuit.RELAYER_ROLE(), relayer.address);

      // Register an LLM service
      const tx = await circuit.connect(admin).registerService(
        0, // LLM_INFERENCE
        'llama-3.1-8b',
        PRICE,
        5000
      );
      const receipt = await tx.wait();
      const ev = receipt.logs.find(l => l.fragment?.name === 'ServiceRegistered');
      llmServiceId = ev.args.serviceId;
    });

    it('1. tdropToken is zero by default', async function () {
      const addr = await circuit.tdropToken();
      expect(addr).to.equal(ethers.ZeroAddress);
    });

    it('2. submitIntentWithTDROP reverts when tdropToken not set', async function () {
      await expect(
        circuit.connect(user1).submitIntentWithTDROP(llmServiceId, b32('input'))
      ).to.be.revertedWithCustomError(circuit, 'TdropNotEnabled');
    });

    it('3. setTdropConfig sets token, discount, rate', async function () {
      await circuit.connect(admin).setTdropConfig(tdrop.target, 2000, ethers.parseEther('1'));
      expect(await circuit.tdropToken()).to.equal(tdrop.target);
      expect(await circuit.tdropDiscountBps()).to.equal(2000);
      expect(await circuit.tdropPerTfuel()).to.equal(ethers.parseEther('1'));
    });

    it('4. setTdropConfig emits TdropConfigUpdated', async function () {
      const tx = await circuit.connect(admin).setTdropConfig(tdrop.target, 2000, ethers.parseEther('1'));
      await expect(tx).to.emit(circuit, 'TdropConfigUpdated')
        .withArgs(tdrop.target, 2000, ethers.parseEther('1'));
    });

    it('5. setTdropConfig reverts on discount > MAX_TDROP_DISCOUNT (50%)', async function () {
      await expect(
        circuit.connect(admin).setTdropConfig(tdrop.target, 5001, ethers.parseEther('1'))
      ).to.be.revertedWithCustomError(circuit, 'InvalidTdropDiscount');
    });

    it('6. setTdropConfig reverts on zero rate', async function () {
      await expect(
        circuit.connect(admin).setTdropConfig(tdrop.target, 2000, 0)
      ).to.be.revertedWith('ZeroRate');
    });

    it('7. quoteTdrop returns correct amounts at 1:1, 20% discount', async function () {
      // PRICE = 1 TFUEL, rate = 1:1, discount = 20%
      // tdropTotal = 1e18 (1 TDROP = 1 TFUEL at 1:1 rate)
      // feeBase = 1e18 * 50 / 10000 = 0.005 TDROP
      // tdropFee = feeBase * (10000 - 2000) / 10000 = 0.004 TDROP
      // tdropPayment = 1e18 - 0.005e18 = 0.995 TDROP
      // tdropRequired = 0.995 + 0.004 = 0.999 TDROP
      const [tdropRequired, tdropFee, tdropPayment, discount] = await circuit.quoteTdrop(llmServiceId);

      const tdropTotal    = PRICE; // 1:1
      const feeBase       = tdropTotal * 50n / 10000n;
      const expectedFee   = feeBase * (10000n - 2000n) / 10000n;
      const expectedPay   = tdropTotal - feeBase;
      const expectedReq   = expectedPay + expectedFee;

      expect(tdropFee).to.equal(expectedFee);
      expect(tdropPayment).to.equal(expectedPay);
      expect(tdropRequired).to.equal(expectedReq);
      expect(discount).to.equal(2000);
    });

    it('8. quoteTdrop reverts when tdropToken not set', async function () {
      // Temporarily disable TDROP
      await circuit.connect(admin).setTdropConfig(ethers.ZeroAddress, 2000, ethers.parseEther('1')).catch(() => {});
      // Actually setTdropConfig(zero,…) is allowed — just disables payments
      await circuit.connect(admin).setTdropConfig(ethers.ZeroAddress, 2000, ethers.parseEther('1'));
      await expect(circuit.quoteTdrop(llmServiceId)).to.be.revertedWithCustomError(circuit, 'TdropNotEnabled');
      // Re-enable
      await circuit.connect(admin).setTdropConfig(tdrop.target, 2000, ethers.parseEther('1'));
    });

    it('9. submitIntentWithTDROP pulls correct TDROP from caller', async function () {
      const [tdropRequired] = await circuit.quoteTdrop(llmServiceId);
      await tdrop.connect(user1).approve(circuit.target, tdropRequired);

      const before = await tdrop.balanceOf(user1.address);
      await circuit.connect(user1).submitIntentWithTDROP(llmServiceId, b32('input-9'));
      const after = await tdrop.balanceOf(user1.address);

      expect(before - after).to.equal(tdropRequired);
    });

    it('10. submitIntentWithTDROP emits both events', async function () {
      const [tdropRequired, tdropFee] = await circuit.quoteTdrop(llmServiceId);
      await tdrop.connect(user1).approve(circuit.target, tdropRequired);

      const tx = await circuit.connect(user1).submitIntentWithTDROP(llmServiceId, b32('input-10'));

      await expect(tx).to.emit(circuit, 'TdropIntentSubmitted');
      await expect(tx).to.emit(circuit, 'InferenceIntentSubmitted');
    });

    it('11. submitIntentWithTDROP stores intent with correct serviceType', async function () {
      const [tdropRequired] = await circuit.quoteTdrop(llmServiceId);
      await tdrop.connect(user1).approve(circuit.target, tdropRequired);

      const tx = await circuit.connect(user1).submitIntentWithTDROP(llmServiceId, b32('input-11'));
      const receipt = await tx.wait();
      const ev = receipt.logs.find(l => l.fragment?.name === 'TdropIntentSubmitted');
      const intentId = ev.args.intentId;

      const intent = await circuit.getIntent(intentId);
      expect(intent.serviceType).to.equal(0n); // LLM_INFERENCE
      expect(intent.requester).to.equal(user1.address);
    });

    it('12. submitIntentWithTDROP reverts if allowance insufficient', async function () {
      // Zero approval — OZ ERC-20 reverts with its own error; the intent is rejected
      await tdrop.connect(user2).approve(circuit.target, 0);
      await expect(
        circuit.connect(user2).submitIntentWithTDROP(llmServiceId, b32('input-12'))
      ).to.be.reverted;
    });

    it('13. TDROP fee is received by splitter via receiveERC20Fee', async function () {
      const [tdropRequired, tdropFee] = await circuit.quoteTdrop(llmServiceId);
      await tdrop.connect(user1).approve(circuit.target, tdropRequired);

      const before = await splitter.getERC20Balance(tdrop.target);
      await circuit.connect(user1).submitIntentWithTDROP(llmServiceId, b32('input-13'));
      const after = await splitter.getERC20Balance(tdrop.target);

      expect(after - before).to.equal(tdropFee);
    });

    it('14. totalTdropCollected increments correctly', async function () {
      const [tdropRequired] = await circuit.quoteTdrop(llmServiceId);
      await tdrop.connect(user1).approve(circuit.target, tdropRequired);

      const before = await circuit.totalTdropCollected();
      await circuit.connect(user1).submitIntentWithTDROP(llmServiceId, b32('input-14'));
      const after = await circuit.totalTdropCollected();

      expect(after - before).to.equal(tdropRequired);
    });

    it('15. TFUEL submitIntent still works alongside TDROP', async function () {
      const tx = await circuit.connect(user1).submitIntent(llmServiceId, b32('input-15'), { value: PRICE });
      await expect(tx).to.emit(circuit, 'InferenceIntentSubmitted');
    });

    it('16. 2:1 rate doubles TDROP required', async function () {
      await circuit.connect(admin).setTdropConfig(tdrop.target, 2000, ethers.parseEther('2'));
      const [tdropRequired] = await circuit.quoteTdrop(llmServiceId);
      // 2x PRICE at 2:1 rate → tdropTotal = 2 TDROP for 1 TFUEL service
      const expectedTotal = PRICE * 2n * 50n / 10000n; // feeBase at 2x
      const feeBase = PRICE * 2n * 50n / 10000n;
      const tdropFee = feeBase * 8000n / 10000n;
      const tdropPayment = PRICE * 2n - feeBase;
      expect(tdropRequired).to.equal(tdropPayment + tdropFee);
      // Reset back to 1:1
      await circuit.connect(admin).setTdropConfig(tdrop.target, 2000, ethers.parseEther('1'));
    });

    it('17. Zero discount → full fee in TDROP, no discount', async function () {
      await circuit.connect(admin).setTdropConfig(tdrop.target, 0, ethers.parseEther('1'));
      const [tdropRequired, tdropFee] = await circuit.quoteTdrop(llmServiceId);
      const expectedFee = PRICE * 50n / 10000n;
      expect(tdropFee).to.equal(expectedFee);
      // Reset
      await circuit.connect(admin).setTdropConfig(tdrop.target, 2000, ethers.parseEther('1'));
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  //  CoreRevenueSplitter — receiveERC20Fee
  // ─────────────────────────────────────────────────────────────────────────────
  describe('CoreRevenueSplitter — receiveERC20Fee()', function () {
    let splitter2;
    const CIRCUIT_ID = b32('TEST_CIRCUIT');
    const FEE_AMOUNT = ethers.parseEther('0.5');

    before(async function () {
      const Splitter = await ethers.getContractFactory('CoreRevenueSplitter');
      splitter2 = await Splitter.deploy(
        admin.address, bbb.address, get_.address,
        staker.address, treasury.address, stakePool.address
      );
      await splitter2.waitForDeployment();

      // Approve splitter to pull TDROP from user1
      await tdrop.connect(user1).approve(splitter2.target, ethers.parseEther('1000'));
    });

    it('18. receiveERC20Fee pulls ERC-20 from caller', async function () {
      const before = await tdrop.balanceOf(splitter2.target);
      await splitter2.connect(user1).receiveERC20Fee(CIRCUIT_ID, tdrop.target, FEE_AMOUNT, 1);
      const after = await tdrop.balanceOf(splitter2.target);
      expect(after - before).to.equal(FEE_AMOUNT);
    });

    it('19. erc20Balances tracks amount per token', async function () {
      const bal = await splitter2.getERC20Balance(tdrop.target);
      expect(bal).to.be.gte(FEE_AMOUNT);
    });

    it('20. circuitErc20Fees tracks per circuit per token', async function () {
      const fees = await splitter2.getCircuitERC20Fees(CIRCUIT_ID, tdrop.target);
      expect(fees).to.be.gte(FEE_AMOUNT);
    });

    it('21. totalErc20Collected tracks lifetime total', async function () {
      const total = await splitter2.totalErc20Collected(tdrop.target);
      expect(total).to.be.gte(FEE_AMOUNT);
    });

    it('22. receiveERC20Fee emits ERC20FeeReceived', async function () {
      await tdrop.connect(user1).approve(splitter2.target, ethers.parseEther('1000'));
      const tx = await splitter2.connect(user1).receiveERC20Fee(CIRCUIT_ID, tdrop.target, FEE_AMOUNT, 1);
      await expect(tx).to.emit(splitter2, 'ERC20FeeReceived')
        .withArgs(CIRCUIT_ID, tdrop.target, user1.address, FEE_AMOUNT, 1, await ethers.provider.getBlock('latest').then(b => b.timestamp));
    });

    it('23. THETA_NATIVE tag increments thetaNativeFeesSinceReset', async function () {
      await tdrop.connect(user1).approve(splitter2.target, ethers.parseEther('1000'));
      const before = await splitter2.thetaNativeFeesSinceReset();
      await splitter2.connect(user1).receiveERC20Fee(CIRCUIT_ID, tdrop.target, FEE_AMOUNT, 1);
      const after = await splitter2.thetaNativeFeesSinceReset();
      expect(after - before).to.equal(FEE_AMOUNT);
    });

    it('24. receiveERC20Fee reverts on zero amount', async function () {
      await expect(
        splitter2.connect(user1).receiveERC20Fee(CIRCUIT_ID, tdrop.target, 0, 1)
      ).to.be.revertedWith('ZeroAmount');
    });

    it('25. receiveERC20Fee reverts on zero token', async function () {
      await expect(
        splitter2.connect(user1).receiveERC20Fee(CIRCUIT_ID, ethers.ZeroAddress, FEE_AMOUNT, 1)
      ).to.be.revertedWith('ZeroToken');
    });

    it('26. getERC20Balance returns correct balance', async function () {
      const contractBal = await tdrop.balanceOf(splitter2.target);
      const tracked = await splitter2.getERC20Balance(tdrop.target);
      expect(tracked).to.equal(contractBal);
    });

    it('27. getCircuitERC20Fees returns correct per-circuit amount', async function () {
      const otherCircuit = b32('OTHER_CIRCUIT');
      await tdrop.connect(user1).approve(splitter2.target, FEE_AMOUNT);
      await splitter2.connect(user1).receiveERC20Fee(otherCircuit, tdrop.target, FEE_AMOUNT, 1);

      const other = await splitter2.getCircuitERC20Fees(otherCircuit, tdrop.target);
      const original = await splitter2.getCircuitERC20Fees(CIRCUIT_ID, tdrop.target);
      expect(other).to.equal(FEE_AMOUNT); // exactly one call
      expect(original).to.be.gt(FEE_AMOUNT); // multiple calls above
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  //  A2ACircuit — submitBidWithTDROP
  // ─────────────────────────────────────────────────────────────────────────────
  describe('A2ACircuit — submitBidWithTDROP()', function () {
    let a2a, splitter3;
    const ESCROW = ethers.parseEther('100');
    const nextDeadline = async () => Number(await futureDeadline(ethers.provider));

    before(async function () {
      const Splitter = await ethers.getContractFactory('CoreRevenueSplitter');
      splitter3 = await Splitter.deploy(
        admin.address, bbb.address, get_.address,
        staker.address, treasury.address, stakePool.address
      );
      await splitter3.waitForDeployment();

      const A2A = await ethers.getContractFactory('A2ACircuit');
      a2a = await A2A.deploy(
        admin.address, splitter3.target, ethers.ZeroAddress, tdrop.target
      );
      await a2a.waitForDeployment();
    });

    it('28. submitBidWithTDROP pulls escrow TDROP from requester', async function () {
      await tdrop.connect(user1).approve(a2a.target, ESCROW);
      const before = await tdrop.balanceOf(user1.address);
      await a2a.connect(user1).submitBidWithTDROP(
        tdrop.target, ESCROW, b32('task-28'), b32('cap-28'), await nextDeadline()
      );
      const after = await tdrop.balanceOf(user1.address);
      expect(before - after).to.equal(ESCROW);
    });

    it('29. paymentToken field is set to tdropToken address', async function () {
      await tdrop.connect(user1).approve(a2a.target, ESCROW);
      const tx = await a2a.connect(user1).submitBidWithTDROP(
        tdrop.target, ESCROW, b32('task-29'), b32('cap-29'), await nextDeadline()
      );
      const receipt = await tx.wait();
      const ev = receipt.logs.find(l => l.fragment?.name === 'BidSubmitted');
      const bidId = ev.args.bidId;
      const bid = await a2a.getBid(bidId);
      expect(bid.paymentToken).to.equal(tdrop.target);
    });

    it('30. relay fee deducted in TDROP, netEscrow stored correctly', async function () {
      await tdrop.connect(user1).approve(a2a.target, ESCROW);
      const relayFeeBps = await a2a.relayFeeBps();
      const expectedRelay = ESCROW * relayFeeBps / 10000n;
      const expectedNet = ESCROW - expectedRelay;

      const tx = await a2a.connect(user1).submitBidWithTDROP(
        tdrop.target, ESCROW, b32('task-30'), b32('cap-30'), await nextDeadline()
      );
      const receipt = await tx.wait();
      const ev = receipt.logs.find(l => l.fragment?.name === 'BidSubmitted');
      const bidId = ev.args.bidId;
      const bid = await a2a.getBid(bidId);
      expect(bid.escrowAmount).to.equal(expectedNet);
    });

    it('31. emits BidSubmitted event', async function () {
      await tdrop.connect(user1).approve(a2a.target, ESCROW);
      const tx = await a2a.connect(user1).submitBidWithTDROP(
        tdrop.target, ESCROW, b32('task-31'), b32('cap-31'), await nextDeadline()
      );
      await expect(tx).to.emit(a2a, 'BidSubmitted');
    });

    it('32. TFUEL submitBid still works (backward compat)', async function () {
      const tx = await a2a.connect(user1).submitBid(
        b32('task-32'), b32('cap-32'), await nextDeadline(),
        { value: ethers.parseEther('0.01') }
      );
      const receipt = await tx.wait();
      const ev = receipt.logs.find(l => l.fragment?.name === 'BidSubmitted');
      const bidId = ev.args.bidId;
      const bid = await a2a.getBid(bidId);
      expect(bid.paymentToken).to.equal(ethers.ZeroAddress);
    });

    it('33. submitBidWithTDROP reverts on zero token address', async function () {
      await expect(
        a2a.connect(user1).submitBidWithTDROP(
          ethers.ZeroAddress, ESCROW, b32('task-33'), b32('cap-33'), await nextDeadline()
        )
      ).to.be.revertedWith('ZeroToken');
    });

    it('34. submitBidWithTDROP reverts on zero escrow', async function () {
      await expect(
        a2a.connect(user1).submitBidWithTDROP(
          tdrop.target, 0, b32('task-34'), b32('cap-34'), await nextDeadline()
        )
      ).to.be.revertedWith('ZeroEscrow');
    });

    it('35. submitBidWithTDROP reverts on past deadline', async function () {
      const b = await ethers.provider.getBlock('latest');
      const pastDeadline = Number(b.timestamp) - 1;
      await tdrop.connect(user1).approve(a2a.target, ESCROW);
      await expect(
        a2a.connect(user1).submitBidWithTDROP(
          tdrop.target, ESCROW, b32('task-35'), b32('cap-35'), pastDeadline
        )
      ).to.be.revertedWith('PastDeadline');
    });
  });
});
