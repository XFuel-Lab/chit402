/**
 * pause-rounds.mjs — pause the live BelieverRound / AngelRound on Theta mainnet.
 *
 * The rounds are `Pausable`; `pause()` requires DEFAULT_ADMIN_ROLE (the deploy admin
 * EOA). This halts new commit()/commitWithLock() and is fully reversible (unpause()).
 * Existing commitments are untouched.
 *
 * ── Safety ───────────────────────────────────────────────────────────────────
 *   • Your key NEVER leaves your machine and is NEVER printed. Pass it via env only.
 *   • Dry run by default: prints signer, role check, and current state. NOTHING is sent.
 *   • Add --execute to actually send the pause() transactions.
 *   • The script refuses to send if the signer is not the admin / lacks the role,
 *     or if a round is already paused.
 *
 * ── Run ──────────────────────────────────────────────────────────────────────
 *   # 1) Dry run (safe — just reports):
 *   #    node believer/pause-rounds.mjs
 *   #
 *   # 2) Execute (sends the txs). Provide the admin key locally:
 *   #    PowerShell:  $env:ROUND_ADMIN_PK="0xYOURKEY"; node believer/pause-rounds.mjs --execute
 *   #    bash:        ROUND_ADMIN_PK=0xYOURKEY node believer/pause-rounds.mjs --execute
 *   #
 *   # To reverse later: node believer/pause-rounds.mjs --unpause --execute
 *
 * Env:
 *   ROUND_ADMIN_PK   admin private key (only needed with --execute). Stays local.
 *   THETA_RPC        override RPC (default: Theta mainnet 361).
 *   BELIEVER_ADDR / ANGEL_ADDR   override contract addresses.
 */
import { ethers } from 'ethers';
import { readFileSync } from 'fs';

// Minimal .env loader (no dependency): load .env.local then .env from cwd, without
// overwriting anything already in the environment. Values are trimmed + de-quoted.
function loadEnvFiles(files = ['.env.local', '.env']) {
  for (const f of files) {
    let text;
    try { text = readFileSync(f, 'utf8'); } catch { continue; }
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      if (key.startsWith('#') || process.env[key] !== undefined) continue;
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
}
loadEnvFiles();

// Accept several common var names for the admin key (yours is TREASURY_PRIVATE_KEY).
function resolveKey(preferAddr = null) {
  const names = ['ROUND_ADMIN_PK', 'ADMIN_PRIVATE_KEY', 'TREASURY_PRIVATE_KEY', 'PRIVATE_KEY', 'DEPLOYER_PRIVATE_KEY', 'RELAYER_PRIVATE_KEY'];
  const valid = [];
  for (const n of names) {
    const v = process.env[n];
    if (v && /^(0x)?[0-9a-fA-F]{64}$/.test(v.trim())) {
      const t = v.trim();
      valid.push({ key: t.startsWith('0x') ? t : '0x' + t, name: n });
    }
  }
  if (preferAddr) {
    for (const c of valid) {
      try { if (new ethers.Wallet(c.key).address.toLowerCase() === preferAddr.toLowerCase()) return c; } catch { /* skip */ }
    }
  }
  return valid[0] || { key: null, name: null };
}

const EXECUTE = process.argv.includes('--execute');
const UNPAUSE = process.argv.includes('--unpause');
const RPC = process.env.THETA_RPC || 'https://eth-rpc-api.thetatoken.org/rpc';
const BELIEVER = process.env.BELIEVER_ADDR || '0xeEC59184144904B1363beb4C88e5877BDFd25691';
const ANGEL = process.env.ANGEL_ADDR || '0x558FC765b5fA6e59A0cdea5F2Fb9F53d2C4Ce772';
const DEFAULT_ADMIN_ROLE = '0x' + '0'.repeat(64);

const ABI = [
  'function pause()',
  'function unpause()',
  'function paused() view returns (bool)',
  'function hasRole(bytes32,address) view returns (bool)',
];
const action = UNPAUSE ? 'unpause' : 'pause';

async function withRetry(fn, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) { if (i === tries - 1) throw e; await new Promise((r) => setTimeout(r, 1500)); }
  }
}

const provider = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: true });

const ADMIN_EXPECTED = '0x9D6fC5EEa264182783Da01Bcfc135E52bE7bF257';

// Diagnostic: which stored key (if any) can pause? Checks address match AND on-chain
// DEFAULT_ADMIN_ROLE (a deploy may grant admin to more than one wallet). Addresses only.
async function auditKeys() {
  const names = ['ROUND_ADMIN_PK', 'ADMIN_PRIVATE_KEY', 'TREASURY_PRIVATE_KEY', 'PRIVATE_KEY', 'DEPLOYER_PRIVATE_KEY', 'RELAYER_PRIVATE_KEY'];
  const roleCheck = new ethers.Contract(BELIEVER, ['function hasRole(bytes32,address) view returns (bool)'], provider);
  console.log('Key audit (which stored key can pause?):');
  let found = false;
  for (const n of names) {
    const v = process.env[n];
    if (!v || !/^(0x)?[0-9a-fA-F]{64}$/.test(v.trim())) continue;
    found = true;
    try {
      const t = v.trim();
      const addr = new ethers.Wallet(t.startsWith('0x') ? t : '0x' + t).address;
      const nameMatch = addr.toLowerCase() === ADMIN_EXPECTED.toLowerCase();
      let onChainAdmin = false;
      try { onChainAdmin = await withRetry(() => roleCheck.hasRole(DEFAULT_ADMIN_ROLE, addr)); } catch { /* rpc */ }
      console.log(`   ${n.padEnd(22)} → ${addr}  ${onChainAdmin ? '✓ HAS ADMIN ROLE' : (nameMatch ? '✓ is admin addr' : '')}`);
    } catch { console.log(`   ${n.padEnd(22)} → (invalid key)`); }
  }
  if (!found) console.log('   (no valid private keys found in env / .env.local)');
  console.log('');
}
await auditKeys();

const { key, name } = resolveKey(ADMIN_EXPECTED);

let signer = null;
if (key) {
  signer = new ethers.Wallet(key, provider);
  const match = signer.address.toLowerCase() === ADMIN_EXPECTED.toLowerCase();
  console.log(`Key source: ${name} (from env/.env.local — never printed/committed)`);
  console.log(`Signer address: ${signer.address}  ${match ? '✓ matches round admin' : '✗ does NOT match round admin ' + ADMIN_EXPECTED}`);
  if (!match) {
    console.log('  → This wallet is not the round admin, so pause() will be skipped.');
    console.log('  → You need the key for ' + ADMIN_EXPECTED + ' (your rounds\u2019 deploy/admin wallet).');
  }
} else if (EXECUTE) {
  console.error('✗ --execute needs an admin key. Set one of ROUND_ADMIN_PK / TREASURY_PRIVATE_KEY / ADMIN_PRIVATE_KEY');
  console.error('  in .env.local (repo root) or the shell. Value = the private key for ' + ADMIN_EXPECTED + '.');
  process.exit(1);
}
if (!EXECUTE) console.log('\nDRY RUN (no --execute) — reporting only, nothing will be sent.\n');
else console.log('');

for (const [label, addr] of [['BelieverRound', BELIEVER], ['AngelRound', ANGEL]]) {
  console.log(`── ${label} ${addr}`);
  const read = new ethers.Contract(addr, ABI, provider);
  const paused = await withRetry(() => read.paused());
  console.log(`   currently paused: ${paused}`);

  const target = action === 'pause';
  if (signer) {
    const isAdmin = await withRetry(() => read.hasRole(DEFAULT_ADMIN_ROLE, signer.address));
    console.log(`   signer is admin: ${isAdmin}`);
    if (!isAdmin) { console.log(`   ✗ not admin on this contract — skipping.`); continue; }
    if (paused === target) { console.log(`   already ${action}d — skipping.`); continue; }
    if (!EXECUTE) { console.log(`   would send: ${action}()  (add --execute to send)`); continue; }
    const c = new ethers.Contract(addr, ABI, signer);
    console.log(`   sending ${action}() ...`);
    const tx = await c[action]();
    console.log(`   tx: ${tx.hash}`);
    const rcpt = await tx.wait();
    const now = await read.paused();
    console.log(`   ✓ mined in block ${rcpt.blockNumber} — paused is now: ${now}`);
  } else {
    console.log(`   would send: ${action}()  (data ${target ? '0x8456cb59' : '0x3f4ba83a'}) — provide admin key to execute`);
  }
}
console.log('\nDone.');
