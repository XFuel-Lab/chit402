/**
 * XFuel SDK — Agent-to-Agent (A2A) + swarm quickstart.
 *
 * Walks the full A2A lifecycle an orchestrator agent uses to delegate work:
 *
 *   1. DISCOVER   — capability_query (zero escrow) to find provider agents
 *   2. BID        — compute_bid with TFUEL escrow (A2A on-chain rail)
 *   3. DELEGATE   — submit the actual compute as an M2M task, settling in
 *                   USDC/x402 OR TFUEL (selectable — demonstrates both rails)
 *   4. SWARM      — build formSwarm / joinSwarm / registerAgent calldata
 *                   (pure SDK; no keys, no network — runs offline)
 *   5. SETTLE     — Fair Exchange (PAS signature) on delivery
 *
 * ─── Two payment surfaces (both shown) ───────────────────────────────────────
 *   • A2A escrow (steps 2 & 5) is TFUEL-native on-chain via A2ACircuit.
 *   • The delegated COMPUTE (step 3) is an M2M task and can settle in USDC via
 *     x402 (default) or TFUEL. Toggle with XFUEL_PAYMENT_RAIL=usdc|tfuel.
 *
 * ─── Run it ──────────────────────────────────────────────────────────────────
 *   # Offline (steps 4 + payer signing always work with no backend):
 *   npx tsx examples/a2a-swarm.ts
 *
 *   # Full flow against a running XFuel API (steps 1-3,5 need the backend):
 *   XFUEL_API_URL=http://localhost:3002 \
 *   XFUEL_SENDER=0xYourAgent \
 *   XFUEL_PAYMENT_RAIL=usdc \                 # or tfuel
 *   A2A_CIRCUIT_ADDRESS=0xYourA2ACircuit \    # for real swarm calldata targets
 *   npx tsx examples/a2a-swarm.ts
 *
 *   Network steps degrade gracefully: if the API is unreachable they log and skip,
 *   so the SDK-only parts (calldata + payer) always demonstrate cleanly.
 *
 * Published-package users import from 'xfuel-sdk' / 'xfuel-sdk/onchain'.
 */
import { sha256, toUtf8Bytes, keccak256 } from 'ethers';
import {
  XFuelClient,
  ChainId,
  MessageType,
  createMockPayer,
  type X402Payer,
} from '../src/index.js';
import { XFuelOnChain } from '../src/onchain.js';

const {
  XFUEL_API_URL = 'https://api-testnet.xfuel.app', // hosted testnet demo; override with http://localhost:3002 for local dev
  XFUEL_API_KEY,
  XFUEL_SENDER = '0x000000000000000000000000000000000000dEaD',
  XFUEL_MODEL = 'xfuel/auto',
  XFUEL_PAYMENT_RAIL = 'usdc', // usdc | tfuel — rail for the delegated compute task
  XFUEL_PAYER_PK, // set to sign real USDC EIP-3009 on Base (else mock payer)
  A2A_CIRCUIT_ADDRESS = '0x000000000000000000000000000000000000a2a0', // placeholder
} = process.env;

const ESCROW_WEI = '500000000000000000'; // 0.5 TFUEL A2A escrow
const b32 = (label: string) => keccak256(toUtf8Bytes(label)); // 32-byte id from a label

/** Build the agent-side payer for the delegated compute (EIP-3009 if a key is set). */
async function buildPayer(): Promise<X402Payer> {
  if (!XFUEL_PAYER_PK) return createMockPayer();
  const { Wallet } = await import('ethers');
  const { createEip3009Payer } = await import('../src/onchain.js');
  return createEip3009Payer(new Wallet(XFUEL_PAYER_PK));
}

/** Run an async phase, logging cleanly and never aborting the whole script. */
async function phase<T>(title: string, fn: () => Promise<T>): Promise<T | undefined> {
  console.log(`\n=== ${title} ===`);
  try {
    return await fn();
  } catch (err: unknown) {
    const raw = err instanceof Error ? err.message : String(err);
    console.log(`  · skipped (${raw || 'XFuel API unreachable — start the backend to run this step'})`);
    return undefined;
  }
}

async function main() {
  const client = new XFuelClient({ baseUrl: XFUEL_API_URL, apiKey: XFUEL_API_KEY });
  const taskPayload = 'Summarize the latest ZK research in 3 bullets.';
  const payloadHash = sha256(toUtf8Bytes(taskPayload));
  const identity = b32(`identity:${XFUEL_SENDER}`);

  console.log('XFuel A2A + Swarm quickstart');
  console.log(`  orchestrator : ${XFUEL_SENDER}`);
  console.log(`  API          : ${XFUEL_API_URL}`);
  console.log(`  compute rail : ${XFUEL_PAYMENT_RAIL}`);

  // 1) DISCOVER — capability_query carries zero escrow.
  await phase('1. Discover provider agents (capability_query)', async () => {
    const res = await client.sendA2AMessage({
      message_type: MessageType.CAPABILITY_QUERY,
      sender_chain: ChainId.THETA,
      recipient_chain: ChainId.THETA,
      payload_hash: b32('cap:llm-inference'),
      ttl: 600,
      sender_address: XFUEL_SENDER,
      sender_identity: identity,
    });
    console.log(`  query message_id: ${res.message_id} (status=${res.status})`);
  });

  // 2) BID — compute_bid with TFUEL escrow (A2A on-chain rail). 0.1% relay fee.
  const bid = await phase('2. Post a compute_bid with TFUEL escrow', async () => {
    const res = await client.sendA2AMessage({
      message_type: MessageType.COMPUTE_BID,
      sender_chain: ChainId.THETA,
      recipient_chain: ChainId.THETA,
      payload_hash: payloadHash,
      escrow_amount: ESCROW_WEI,
      ttl: 3600,
      sender_address: XFUEL_SENDER,
      sender_identity: identity,
    });
    console.log(`  bid message_id: ${res.message_id}  escrow=${res.escrow_amount} wei  relay_fee=${res.relay_fee}`);
    const status = await client.getA2AStatus(res.message_id);
    console.log(`  bid status: ${status.status}`);
    return res;
  });

  // 3) DELEGATE — run the actual compute as an M2M task (USDC/x402 or TFUEL).
  await phase(`3. Delegate the compute as an M2M task (rail=${XFUEL_PAYMENT_RAIL})`, async () => {
    const input_hash = keccak256(toUtf8Bytes(taskPayload));
    if (XFUEL_PAYMENT_RAIL === 'tfuel') {
      const task = await client.submitInference(XFUEL_MODEL, XFUEL_SENDER, '1000000', {
        chain_id: ChainId.THETA,
        input_hash,
        payment: { rail: 'tfuel' },
      });
      console.log(`  task_id=${task.task_id}  rail=${task.payment_rail ?? 'tfuel'}`);
    } else {
      const payer = await buildPayer();
      const task = await client.submitInference(XFUEL_MODEL, XFUEL_SENDER, '1000000', {
        chain_id: ChainId.THETA,
        input_hash,
        payment: { rail: 'usdc', network: 'base', maxAmount: '50000' },
        payer,
      });
      console.log(`  task_id=${task.task_id}  rail=${task.payment_rail ?? 'usdc'}  ref=${task.payment_ref ?? '(pending)'}`);
    }
  });

  // 4) SWARM — build on-chain calldata (no keys, no network; always runs).
  await phase('4. Build swarm + agent calldata (offline, no keys)', async () => {
    const chain = new XFuelOnChain({ a2aCircuitAddress: A2A_CIRCUIT_ADDRESS });
    const objective = b32('objective:multi-agent-research');
    const capability = b32('cap:llm-inference');
    const deadline = Math.floor(Date.now() / 1000) + 3600;

    const register = chain.encodeRegisterAgent(identity, 'https://agent.example/a2a', [capability]);
    const form = chain.encodeFormSwarm(objective, 18, ESCROW_WEI); // up to 18 members
    const submitBid = chain.encodeSubmitBid(payloadHash, capability, deadline, ESCROW_WEI);

    const show = (label: string, c: { to: string; data: string; value?: string }) =>
      console.log(`  ${label}: to=${c.to} value=${c.value ?? '0'} data=${c.data.slice(0, 26)}…`);
    show('registerAgent', register);
    show('formSwarm    ', form);
    show('submitBid    ', submitBid);
    console.log('  → submit via the server relayer or sign the calldata with your own wallet.');
  });

  // 5) SETTLE — Fair Exchange (PAS signature over the delivered result).
  await phase('5. Settle a bid via Fair Exchange (PAS)', async () => {
    // In production, v/r/s come from the provider's PAS signature over result_hash.
    const resultHash = sha256(toUtf8Bytes('RESULT: 3 bullets ...'));
    const out = await client.settleWithFairExchange({
      bid_id: bid?.message_id ? b32(bid.message_id) : b32('bid:demo'),
      result_hash: resultHash,
      v: 27,
      r: b32('r'),
      s: b32('s'),
    });
    console.log(`  settle status: ${out.status}${out.tx_hash ? ` tx=${out.tx_hash}` : ''}`);
    if (out.status === 'calldata') console.log(`  calldata → ${out.contract} (submit with your signer)`);
  });

  console.log('\nDone. A2A escrow is TFUEL-native on-chain; the delegated compute settles in USDC/x402 or TFUEL.');
}

main().catch((err) => {
  console.error('\nExample failed:', err?.message ?? err);
  process.exit(1);
});
