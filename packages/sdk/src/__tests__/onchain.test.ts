import { describe, it, expect } from '@jest/globals';
import { Interface, Wallet, verifyTypedData, keccak256, toUtf8Bytes, solidityPacked } from 'ethers';
import {
  XFuelOnChain,
  A2A_CIRCUIT_ABI,
  ZK_VERIFIER_ABI,
  VE_GOVERNANCE_ABI,
  createEip3009Payer,
  verifyPaymentBinding,
  PAYMENT_RAIL_DISCRIMINANT,
  USDC_NETWORKS,
  modelIdFromSlug,
  shardLeaf,
  keccakMerkleRoot,
  computeModelCommitment,
  computeInferenceBinding,
  canonicalReceiptPayload,
  verifyReceiptSignature,
  receiptToValidationVerdict,
  encodeValidationResponse,
  encodeSubmitValidation,
  selectTier,
  normalizeRequestedTier,
} from '../onchain';
import { computeHmac } from 'ethers';
import { type X402Challenge, type PaymentBinding, type ProofResponse } from '../index';

const A2A = '0x000000000000000000000000000000000000a2a0';
const ZK = '0x000000000000000000000000000000000000d1d1';
const GOV = '0x0000000000000000000000000000000000009099';

const b32 = (n: string) => '0x' + n.padEnd(64, '0');

function make() {
  return new XFuelOnChain({
    a2aCircuitAddress: A2A,
    zkVerifierAddress: ZK,
    veGovernanceAddress: GOV,
  });
}

describe('XFuelOnChain calldata builders', () => {
  const iA2A = new Interface(A2A_CIRCUIT_ABI as unknown as string[]);
  const iZk = new Interface(ZK_VERIFIER_ABI as unknown as string[]);
  const iGov = new Interface(VE_GOVERNANCE_ABI as unknown as string[]);

  it('encodeSubmitBid sets escrow as value and encodes 3 args', () => {
    const c = make().encodeSubmitBid(b32('aa'), b32('bb'), 1893456000, '1000000000000000000');
    expect(c.to).toBe(A2A);
    expect(c.value).toBe('1000000000000000000');
    const decoded = iA2A.decodeFunctionData('submitBid', c.data);
    expect(decoded[0]).toBe(b32('aa'));
    expect(decoded[2]).toBe(1893456000n);
  });

  it('encodeSettleBid encodes 5 args (proof AND publicValues)', () => {
    const c = make().encodeSettleBid(b32('1'), b32('2'), '0xdead', '0xbeef', b32('3'));
    const decoded = iA2A.decodeFunctionData('settleBid', c.data);
    expect(decoded.length).toBe(5);
    expect(decoded[2]).toBe('0xdead');
    expect(decoded[3]).toBe('0xbeef');
  });

  it('encodeSettleBidFairExchange matches the server ABI', () => {
    const c = make().encodeSettleBidFairExchange(b32('1'), b32('2'), 27, b32('3'), b32('4'));
    const decoded = iA2A.decodeFunctionData('settleBidFairExchange', c.data);
    expect(Number(decoded[2])).toBe(27);
  });

  it('encodeFormSwarm carries escrow value', () => {
    const c = make().encodeFormSwarm(b32('ab'), 18, '500');
    expect(c.value).toBe('500');
    const decoded = iA2A.decodeFunctionData('formSwarm', c.data);
    expect(Number(decoded[1])).toBe(18);
  });

  it('encodeJoinSwarm targets the swarmId (no value)', () => {
    const c = make().encodeJoinSwarm(b32('5a'));
    expect(c.to).toBe(A2A);
    expect(c.value).toBeUndefined();
    const decoded = iA2A.decodeFunctionData('joinSwarm', c.data);
    expect(decoded[0]).toBe(b32('5a'));
  });

  it('encodeSettleSwarmAgent encodes agent + amount + proof (6 args)', () => {
    const c = make().encodeSettleSwarmAgent(b32('5a'), ZK, '250', '0xdead', '0xbeef', b32('11'));
    const decoded = iA2A.decodeFunctionData('settleSwarmAgent', c.data);
    expect(decoded.length).toBe(6);
    expect(String(decoded[1]).toLowerCase()).toBe(ZK);
    expect(decoded[2]).toBe(250n);
    expect(decoded[3]).toBe('0xdead');
  });

  it('encodeDissolveSwarm / encodeForceDissolveSwarm encode swarmId', () => {
    const d = make().encodeDissolveSwarm(b32('5a'));
    const f = make().encodeForceDissolveSwarm(b32('5a'));
    expect(iA2A.decodeFunctionData('dissolveSwarm', d.data)[0]).toBe(b32('5a'));
    expect(iA2A.decodeFunctionData('forceDissolveSwarm', f.data)[0]).toBe(b32('5a'));
  });

  it('swarm reads throw without a provider', async () => {
    await expect(make().getSwarm(b32('5a'))).rejects.toThrow('provider/rpcUrl required');
    await expect(make().isSwarmMember(b32('5a'), ZK)).rejects.toThrow('provider/rpcUrl required');
  });

  it('encodeRelayProofCrossChain encodes destDomain + fee value', () => {
    const c = make().encodeRelayProofCrossChain(b32('c1'), '0x01', '0x02', b32('be'), 964, '7');
    expect(c.to).toBe(ZK);
    expect(c.value).toBe('7');
    const decoded = iZk.decodeFunctionData('relayProofCrossChain', c.data);
    expect(Number(decoded[4])).toBe(964);
  });

  it('encodeVote encodes proposalId + support (no nullifier param)', () => {
    const c = make().encodeVote(42, true);
    expect(c.to).toBe(GOV);
    const decoded = iGov.decodeFunctionData('vote', c.data);
    expect(Number(decoded[0])).toBe(42);
    expect(decoded[1]).toBe(true);
  });

  it('encodeLock encodes amount + unlockTime', () => {
    const c = make().encodeLock('1000', 1893456000);
    const decoded = iGov.decodeFunctionData('lock', c.data);
    expect(decoded[0]).toBe(1000n);
  });

  it('throws a clear error when an address is missing', () => {
    const c = new XFuelOnChain({});
    expect(() => c.encodeVote(1, true)).toThrow(/veGovernance address not configured/);
  });
});

describe('createEip3009Payer (USDC on Base)', () => {
  const PAY_TO = '0x000000000000000000000000000000000000cafe';
  const challenge: X402Challenge = {
    x402Version: 1,
    accepts: [
      {
        scheme: 'exact',
        network: 'base',
        asset: 'USDC',
        maxAmountRequired: '50000',
        resource: '/x402/task/abc',
        payTo: PAY_TO,
        extra: { taskId: 'abc', nonce: 'challenge-nonce-1' },
      },
    ],
  };

  const TYPES = {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  };

  it('signs a valid EIP-712 authorization that recovers to the wallet', async () => {
    const wallet = Wallet.createRandom();
    const payer = createEip3009Payer(wallet);

    const { header, nonce } = await payer(challenge);
    // The X-PAYMENT-NONCE binds to the x402 challenge nonce, not the EIP-3009 one.
    expect(nonce).toBe('challenge-nonce-1');

    const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
    const auth = decoded.authorization;
    expect(auth.type).toBe('eip3009-transferWithAuthorization');
    expect(auth.domain.chainId).toBe(USDC_NETWORKS.base.chainId);
    expect(auth.domain.verifyingContract).toBe(USDC_NETWORKS.base.usdc);
    expect(auth.message.to).toBe(PAY_TO);
    expect(auth.message.value).toBe('50000');
    expect(auth.message.from.toLowerCase()).toBe(wallet.address.toLowerCase());

    // The signature must recover to the signing wallet.
    const recovered = verifyTypedData(auth.domain, TYPES, auth.message, auth.signature);
    expect(recovered.toLowerCase()).toBe(wallet.address.toLowerCase());
  });

  it('rejects a non-EVM / unknown network without explicit overrides', async () => {
    const payer = createEip3009Payer(Wallet.createRandom());
    const solChallenge: X402Challenge = {
      x402Version: 1,
      accepts: [{ ...challenge.accepts[0], network: 'solana' }],
    };
    await expect(payer(solChallenge)).rejects.toThrow(/unsupported network/);
  });

  it('throws when constructed without a valid signer', () => {
    expect(() => createEip3009Payer({} as any)).toThrow(/requires an ethers v6 Signer/);
  });
});

describe('verifyPaymentBinding / verifyProof', () => {
  const TASK_ID = 'task-abc-123';
  const PAYMENT_REF = 'base:0xdeadbeef';
  const AMOUNT = '1000000';

  // Build a binding exactly the way the backend does (payment-binding.js parity).
  function buildBinding(overrides: Partial<PaymentBinding> = {}): PaymentBinding {
    const paymentRefHash = keccak256(toUtf8Bytes(PAYMENT_REF));
    const taskIdHash = keccak256(toUtf8Bytes(TASK_ID));
    const commitment = keccak256(
      solidityPacked(
        ['bytes32', 'bytes32', 'uint8', 'uint256'],
        [paymentRefHash, taskIdHash, PAYMENT_RAIL_DISCRIMINANT.usdc, BigInt(AMOUNT)],
      ),
    );
    return {
      version: 2,
      rail: 'usdc',
      commitment,
      payment_ref_hash: paymentRefHash,
      amount: AMOUNT,
      in_proof: false,
      ...overrides,
    };
  }

  function makeProof(overrides: Partial<ProofResponse> = {}): ProofResponse {
    return {
      task_id: TASK_ID,
      status: 'settled',
      proof_outcome: 'valid',
      payment_binding: buildBinding(),
      sp1_proof: {
        proof: '0xproofbytes',
        publicInputs: '0xpublic',
        nullifier: '0x' + '11'.padEnd(64, '0'),
        provingTimeMs: 1234,
      },
      fee: { gross_amount: '1000000', fee_amount: '0', net_amount: '1000000' },
      ...overrides,
    } as ProofResponse;
  }

  it('verifyPaymentBinding recomputes a matching commitment', () => {
    const r = verifyPaymentBinding(buildBinding(), { paymentRef: PAYMENT_REF, taskId: TASK_ID });
    expect(r.checked).toBe(true);
    expect(r.valid).toBe(true);
    expect(r.paymentRefHashMatches).toBe(true);
    expect(r.recomputedCommitment).toBe(r.expectedCommitment);
  });

  it('verifyPaymentBinding flags a tampered commitment', () => {
    const r = verifyPaymentBinding(buildBinding({ amount: '999' }), {
      paymentRef: PAYMENT_REF,
      taskId: TASK_ID,
    });
    expect(r.valid).toBe(false);
  });

  it('verifyPaymentBinding detects a payment_ref mismatch', () => {
    const r = verifyPaymentBinding(buildBinding(), {
      paymentRef: 'base:0xwrong',
      taskId: TASK_ID,
    });
    expect(r.paymentRefHashMatches).toBe(false);
    expect(r.valid).toBe(false);
  });

  it('verifyPaymentBinding returns unchecked for a null binding', () => {
    const r = verifyPaymentBinding(null, { taskId: TASK_ID });
    expect(r.checked).toBe(false);
    expect(r.valid).toBeNull();
  });

  it('verifyProof passes for a valid proof + valid binding', async () => {
    const r = await make().verifyProof(makeProof(), { paymentRef: PAYMENT_REF });
    expect(r.ok).toBe(true);
    expect(r.checks.hasProof).toBe(true);
    expect(r.checks.proofOutcomeValid).toBe(true);
    expect(r.checks.paymentBinding.valid).toBe(true);
    expect(r.reasons).toHaveLength(0);
  });

  it('verifyProof fails when no proof is present', async () => {
    const r = await make().verifyProof(makeProof({ sp1_proof: null }));
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/no proof/i);
  });

  it('verifyProof fails on a bad binding', async () => {
    const r = await make().verifyProof(makeProof({ payment_binding: buildBinding({ amount: '5' }) }), {
      paymentRef: PAYMENT_REF,
    });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/binding/i);
  });

  it('verifyProof records a soft reason when checkNullifier lacks a provider', async () => {
    const r = await make().verifyProof(makeProof(), { paymentRef: PAYMENT_REF, checkNullifier: true });
    // No provider on `make()`, so the on-chain check is skipped but ok still holds.
    expect(r.checks.nullifier.checkedOnChain).toBe(false);
    expect(r.ok).toBe(true);
    expect(r.reasons.join(' ')).toMatch(/provider\/zkVerifier/i);
  });
});

describe('PoMA — model commitment helpers', () => {
  it('modelIdFromSlug is keccak256 of the lowercased utf8 slug (case-insensitive)', () => {
    const expected = keccak256(toUtf8Bytes('llama-3-70b:q4_k_m'));
    expect(modelIdFromSlug('llama-3-70b:q4_k_m')).toBe(expected);
    expect(modelIdFromSlug('  LLaMA-3-70B:Q4_K_M ')).toBe(expected);
  });

  it('shardLeaf is domain-separated (0x00 prefix)', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const expected = keccak256(new Uint8Array([0x00, 1, 2, 3, 4]));
    expect(shardLeaf(bytes)).toBe(expected);
    // hex input resolves to the same leaf
    expect(shardLeaf('0x01020304')).toBe(expected);
  });

  it('single-shard commitment equals its leaf', () => {
    const shard = new Uint8Array([9, 9, 9]);
    const { commitment, shardCount, scheme } = computeModelCommitment({ shards: [shard], slug: 's:q' });
    expect(commitment).toBe(shardLeaf(shard));
    expect(shardCount).toBe(1);
    expect(scheme).toBe(0);
  });

  it('two-shard commitment is the domain-separated (0x01) parent of the two leaves', () => {
    const a = new Uint8Array([1]);
    const b = new Uint8Array([2]);
    const la = shardLeaf(a);
    const lb = shardLeaf(b);
    const root = computeModelCommitment({ shards: [a, b], slug: 'm:q' }).commitment;
    expect(root).toBe(keccakMerkleRoot([la, lb]));
    // parent = keccak(0x01 || la || lb) — order matters
    expect(root).not.toBe(keccakMerkleRoot([lb, la]));
  });

  it('odd tail is promoted (3 shards)', () => {
    const leaves = [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])].map(shardLeaf);
    // level1 = [ parent(l0,l1), l2 ]; root = parent(level1[0], level1[1])
    expect(keccakMerkleRoot(leaves)).toBe(computeModelCommitment({
      shards: [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])],
      slug: 'x:q',
    }).commitment);
  });

  it('empty leaves → zero root', () => {
    expect(keccakMerkleRoot([])).toBe('0x' + '0'.repeat(64));
  });

  it('computeModelCommitment throws on empty shards', () => {
    expect(() => computeModelCommitment({ shards: [], slug: 's:q' })).toThrow(/at least one shard/);
  });
});

describe('PBR — payment-bound receipt helpers', () => {
  const MODEL = b32('c0ffee');
  const OUTPUT = b32('0117');

  it('computeInferenceBinding is deterministic and superset of payment-only', () => {
    const a = computeInferenceBinding({
      paymentRef: 'base:0xabc', taskId: 'task-1', rail: 'usdc', amount: '1000000',
      modelCommitment: MODEL, outputHash: OUTPUT,
    });
    const b = computeInferenceBinding({
      paymentRef: 'base:0xabc', taskId: 'task-1', rail: 'usdc', amount: '1000000',
      modelCommitment: MODEL, outputHash: OUTPUT,
    });
    expect(a).toBe(b);
    // changing the model commitment changes the binding (downgrade would break it)
    const c = computeInferenceBinding({
      paymentRef: 'base:0xabc', taskId: 'task-1', rail: 'usdc', amount: '1000000',
      modelCommitment: b32('dead'), outputHash: OUTPUT,
    });
    expect(c).not.toBe(a);
  });

  it('rail name and discriminant produce the same binding', () => {
    const byName = computeInferenceBinding({ paymentRef: 'base:0x1', taskId: 't', rail: 'usdc', amount: '5', modelCommitment: MODEL, outputHash: OUTPUT });
    const byNum = computeInferenceBinding({ paymentRef: 'base:0x1', taskId: 't', rail: 1, amount: '5', modelCommitment: MODEL, outputHash: OUTPUT });
    expect(byName).toBe(byNum);
  });

  it('verifyReceiptSignature validates a well-formed signature and detects tampering', () => {
    const secret = 'test-receipt-secret';
    const receipt: Record<string, unknown> = {
      task_id: 'task-xyz',
      payment: { rail: 'usdc', ref: 'base:0xabc', net_amount: '995000', fee_amount: '5000' },
      route: { model: 'llama-3-70b:q4_k_m', model_commitment: { commitment: MODEL } },
      output: { hash: OUTPUT },
      binding: { expected_commitment: b32('99') },
    };
    const value = 'sha256=' + computeHmac('sha256', toUtf8BytesLocal(secret), toUtf8BytesLocal(canonicalReceiptPayload(receipt))).slice(2);
    receipt.signature = { alg: 'HMAC-SHA256', value };

    expect(verifyReceiptSignature(receipt, secret).valid).toBe(true);

    // tamper the net_amount → signature must fail
    (receipt.payment as { net_amount: string }).net_amount = '1';
    expect(verifyReceiptSignature(receipt, secret).valid).toBe(false);
  });

  it('verifyReceiptSignature returns checked:false when no signature present', () => {
    const res = verifyReceiptSignature({ task_id: 'x' }, 'secret');
    expect(res.checked).toBe(false);
    expect(res.valid).toBeNull();
  });
});

// local helper mirrors ethers.toUtf8Bytes without adding a duplicate top-level import
function toUtf8BytesLocal(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe('ERC-8004 validation verdict', () => {
  const REQ = '0x' + '11'.repeat(32);
  const settledReceipt = () => ({
    task_id: 'task-erc-1',
    proof_outcome: 'valid',
    proof: { tier: 'settlement' },
    binding: { covers: ['payment', 'settlement'], matches: true },
    output: { hash: '0x' + 'cd'.repeat(32) },
    verify_url: 'https://api.xfuel.app/receipt/task-erc-1',
  });

  it('passes a settled, matching receipt with score 100', () => {
    const v = receiptToValidationVerdict(settledReceipt(), { requestHash: REQ, agentId: 42 });
    expect(v.eligible).toBe(true);
    expect(v.response).toBe(100);
    expect(v.tag).toBe('xfuel:settlement');
    expect(v.agent_id).toBe('42');
    expect(v.response_uri).toBe('https://api.xfuel.app/receipt/task-erc-1');
    expect(v.response_hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('tags PBR when the binding covers inference', () => {
    const r = settledReceipt();
    r.binding.covers = ['payment', 'settlement', 'model', 'inference'];
    const v = receiptToValidationVerdict(r, { requestHash: REQ, agentId: 1 });
    expect(v.tag).toBe('xfuel:settlement+pbr');
  });

  it('fails (0) on a binding mismatch', () => {
    const r = settledReceipt();
    r.binding.matches = false;
    const v = receiptToValidationVerdict(r, { requestHash: REQ, agentId: 1 });
    expect(v.response).toBe(0);
    expect(v.tag).toBe('xfuel:binding-mismatch');
  });

  it('is ineligible when no output was delivered', () => {
    const r = { ...settledReceipt(), output: null, proof_outcome: 'pending' };
    const v = receiptToValidationVerdict(r as never, { requestHash: REQ, agentId: 1 });
    expect(v.eligible).toBe(false);
    expect(v.tag).toBe('xfuel:pending');
  });

  it('rejects a bad requestHash / agentId', () => {
    expect(() => receiptToValidationVerdict(settledReceipt(), { requestHash: '0xabc', agentId: 1 })).toThrow(/requestHash/);
    expect(() => receiptToValidationVerdict(settledReceipt(), { requestHash: REQ, agentId: 'x' as never })).toThrow(/agentId/);
  });

  it('encodes registry + adapter calldata (distinct selectors)', () => {
    const v = receiptToValidationVerdict(settledReceipt(), { requestHash: REQ, agentId: 7 });
    const respData = encodeValidationResponse(v);
    const submitData = encodeSubmitValidation(v);
    expect(respData).toMatch(/^0x[0-9a-f]+$/);
    expect(submitData).toMatch(/^0x[0-9a-f]+$/);
    expect(respData.slice(0, 10)).not.toBe(submitData.slice(0, 10));
  });
});

describe('tier selection (SDK mirror of the gateway)', () => {
  const policy = {
    enabled: true,
    tier2Min: '10000',
    tier3Min: '1000000',
    defaultMechanism: 'tee' as const,
    available: { settlement: true, tee: true, 'zk-spotcheck': true, 'zk-full': false },
  };
  const task = (amount: number, proofTier?: string) => ({ intent: { amount: String(amount), proofTier } });

  it('applies value-at-risk floors', () => {
    expect(selectTier(task(5000), policy).tier).toBe('signed');
    expect(selectTier(task(50_000), policy).tier).toBe('settlement');
    const hi = selectTier(task(2_000_000), policy);
    expect(hi.tier).toBe('inference');
    expect(hi.mechanism).toBe('tee');
  });

  it('lets a request raise but not lower the tier', () => {
    expect(selectTier(task(5000, 'tee'), policy).tier).toBe('inference');
    expect(selectTier(task(2_000_000, 'signed'), policy).tier).toBe('inference');
  });

  it('degrades an unavailable mechanism with a reason', () => {
    const r = selectTier(task(2_000_000, 'zk-full'), policy);
    expect(r.mechanism).toBe('zk-spotcheck');
    expect(r.degraded).toBe(true);
  });

  it('disabled engine → legacy tier', () => {
    expect(selectTier(task(2_000_000), { enabled: false, available: { settlement: true } }).tier).toBe('settlement');
  });

  it('normalizeRequestedTier maps aliases', () => {
    expect(normalizeRequestedTier('t3b')).toEqual({ tier: 'inference', mechanism: 'zk-spotcheck' });
    expect(normalizeRequestedTier('bogus')).toBeNull();
  });
});
