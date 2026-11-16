/**
 * Base Sepolia dry run. Builds the anchor transaction and prints it.
 * Does not sign with a live key and does not send.
 *
 * Exit text: needs_owner_tap
 */
import { buildAnchorCalldata } from '../../services/chit-sealer/calldata.js';

const MISSING = [
  'CHITANCHOR_ADDRESS from the deploy pack',
  'testnet KMS key ARN (ECC_SECG_P256K1, separate account)',
  'a funded payer wallet',
  'two RPC URLs',
];

const placeholder = `0x${'11'.repeat(20)}`;

const built = buildAnchorCalldata({
  chainId: 84532n,
  contract: process.env.CHITANCHOR_ADDRESS || placeholder,
  epoch: 1,
  hourStart: 1_700_006_400,
  size: 128,
  root: '11'.repeat(32),
  stateRoot: '22'.repeat(32),
  proof: [],
});

const tx = {
  chainId: 84532,
  to: process.env.CHITANCHOR_ADDRESS || placeholder,
  data: `0x${built.calldata}`,
  value: '0',
};

process.stdout.write(`${JSON.stringify({ tx, domain: built.domain }, null, 2)}\n`);
process.stdout.write('needs_owner_tap\n');
for (const item of MISSING) process.stdout.write(`missing: ${item}\n`);
process.exit(2);
