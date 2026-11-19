/**
 * One command for the local loop. Exit code is the verifier's code.
 * Testnet dummy data. No Sepolia send.
 */
import { runOnce } from './loop.mjs';

const result = await runOnce();
process.stdout.write(`${JSON.stringify({
  exit: result.verdict.exit,
  reason: result.verdict.reason,
  message: result.verdict.message,
  elapsedMs: result.elapsedMs,
  hourStart: result.hourStart,
  contract: result.contract,
  label: 'local',
})}\n`);
process.exit(result.verdict.exit);
