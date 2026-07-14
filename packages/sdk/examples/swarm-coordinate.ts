/**
 * XFuel SDK — Swarm coordination quickstart.
 *
 * Forms and manages a multi-agent swarm end-to-end on the A2A circuit
 * (Almanak-style lifecycle, up to 18 members):
 *
 *   register ─► form (escrow pool) ─► join (×N) ─► settle-member (×N) ─► dissolve
 *
 * The escrow POOL is TFUEL-native on-chain. The compute each member RUNS can be
 * submitted separately as an M2M task settling in USDC/x402 or TFUEL — see
 * examples/a2a-swarm.ts and examples/pay-with-usdc.ts.
 *
 * ─── Run it ──────────────────────────────────────────────────────────────────
 *   # Offline: builds all calldata with no keys and no network.
 *   npx tsx examples/swarm-coordinate.ts
 *
 *   # With on-chain reads (getSwarm / isSwarmMember):
 *   THETA_RPC_URL=https://eth-rpc-api-testnet.thetatoken.org/rpc \
 *   A2A_CIRCUIT_ADDRESS=0xYourA2ACircuit \
 *   SWARM_ID=0x..32bytes.. \
 *   npx tsx examples/swarm-coordinate.ts
 *
 * Calldata ({ to, data, value }) is submitted via the server relayer or signed
 * with your own wallet out of band — this example never holds a key.
 *
 * Published-package users import from 'xfuel-sdk/onchain'.
 */
import { keccak256, toUtf8Bytes } from 'ethers';
import { XFuelOnChain } from '../src/onchain.js';

const {
  A2A_CIRCUIT_ADDRESS = '0x000000000000000000000000000000000000a2a0', // placeholder
  THETA_RPC_URL,
  SWARM_ID,
  MEMBER_ADDR = '0x1111111111111111111111111111111111111111',
} = process.env;

const b32 = (label: string) => keccak256(toUtf8Bytes(label));
const TFUEL = (n: number) => (BigInt(Math.round(n * 1e6)) * 10n ** 12n).toString(); // n TFUEL → wei

function show(label: string, c: { to: string; data: string; value?: string }) {
  console.log(`  ${label.padEnd(18)} to=${c.to} value=${c.value ?? '0'} data=${c.data.slice(0, 26)}…`);
}

async function main() {
  const chain = new XFuelOnChain({
    a2aCircuitAddress: A2A_CIRCUIT_ADDRESS,
    rpcUrl: THETA_RPC_URL, // only used for reads
  });

  const coordinatorId = b32('identity:coordinator');
  const memberId = b32('identity:member');
  const objective = b32('objective:distributed-inference-benchmark');
  const capability = b32('cap:llm-inference');
  const poolWei = TFUEL(2); // 2 TFUEL escrow pool

  console.log('XFuel Swarm coordination quickstart');
  console.log(`  a2aCircuit : ${A2A_CIRCUIT_ADDRESS}`);
  console.log(`  reads      : ${THETA_RPC_URL ? 'on (RPC set)' : 'off (offline calldata only)'}`);

  // 1) REGISTER — coordinator + each member register once (idempotent on-chain).
  console.log('\n=== 1. Register agents ===');
  show('registerAgent(co)', chain.encodeRegisterAgent(coordinatorId, 'https://coordinator.example/a2a', [capability]));
  show('registerAgent(m1)', chain.encodeRegisterAgent(memberId, 'https://member1.example/a2a', [capability]));

  // 2) FORM — coordinator opens the swarm and funds the TFUEL escrow pool.
  console.log('\n=== 2. Form swarm (fund escrow pool) ===');
  show('formSwarm', chain.encodeFormSwarm(objective, 18, poolWei));
  console.log('  → read the swarmId from the SwarmFormed event, then share it with members.');

  // A concrete swarmId is required for the remaining steps. Use SWARM_ID if the
  // swarm already exists on-chain; otherwise demo with a placeholder id.
  const swarmId = SWARM_ID ?? b32('swarm:demo-placeholder');

  // 3) JOIN — each member joins (must be registered + active; swarm not full).
  console.log('\n=== 3. Join swarm ===');
  show('joinSwarm', chain.encodeJoinSwarm(swarmId));

  // 4) SETTLE-MEMBER — pay a member from the pool with a ZK proof (relayer-gated).
  console.log('\n=== 4. Settle a member from the pool (relayer submits) ===');
  show(
    'settleSwarmAgent',
    chain.encodeSettleSwarmAgent(swarmId, MEMBER_ADDR, TFUEL(0.5), '0xdeadbeef', '0xc0ffee', b32('nullifier:m1')),
  );

  // 5) STATUS — read live swarm state (requires an RPC + a real swarmId).
  console.log('\n=== 5. Read swarm status ===');
  if (THETA_RPC_URL && SWARM_ID) {
    try {
      const s = await chain.getSwarm(swarmId);
      console.log(`  phase=${s.phase} members=${s.memberCount}/${s.maxMembers}`);
      console.log(`  pool=${s.escrowPool} settled=${s.settledAmount} remaining=${s.remainingEscrow}`);
      console.log(`  coordinator=${s.coordinator} exists=${s.exists}`);
      console.log(`  member ${MEMBER_ADDR} joined? ${await chain.isSwarmMember(swarmId, MEMBER_ADDR)}`);
    } catch (err) {
      console.log(`  · read skipped (${err instanceof Error ? err.message : String(err)})`);
    }
  } else {
    console.log('  · skipped — set THETA_RPC_URL + SWARM_ID to read live state.');
  }

  // 6) DISSOLVE — coordinator closes the swarm; remaining escrow refunds (−0.3%).
  console.log('\n=== 6. Dissolve (or force-dissolve after timeout) ===');
  show('dissolveSwarm', chain.encodeDissolveSwarm(swarmId));
  show('forceDissolve', chain.encodeForceDissolveSwarm(swarmId));

  console.log('\nDone. Escrow pool is TFUEL-native on-chain; the compute members run can settle in USDC/x402 or TFUEL.');
}

main().catch((err) => {
  console.error('\nExample failed:', err?.message ?? err);
  process.exit(1);
});
