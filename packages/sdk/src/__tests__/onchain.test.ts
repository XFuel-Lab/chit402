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
} from '../onchain';
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
