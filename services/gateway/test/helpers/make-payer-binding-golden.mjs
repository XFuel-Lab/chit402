/**
 * B1 golden for the payer-binding byte-identity test. Runs one receipt
 * through a local gateway with RECEIPT_PAYER_BINDING_EIP712 unset and prints
 * the bytes B1 compares: the holder JWS, the public receipt surfaces, the
 * owner view body, the book row and the journal. Uses only APIs main has,
 * so the same file produced test/fixtures/payer-binding-b1-main.json on main.
 *
 *   node test/helpers/make-payer-binding-golden.mjs <out.json>
 *
 * Offline: synthetic issuer key with a deterministic stub signer for JWS
 * inputs, a local server on 127.0.0.1, fixed clock and genesis bytes, fixed
 * test wallets. The server port is replaced with PORT in every string.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Wallet } from 'ethers';
import { syntheticIssuerKey, syntheticIssuerKeyEnv } from '../../../../packages/verify/test/fixtures/slot-typing/synthetic-key.mjs';
import { stubSigner } from './fixed-head-scenario.mjs';

const target = process.argv[2];
if (!target) throw new Error('usage: make-payer-binding-golden.mjs <out.json>');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'payer-binding-golden-'));
const agentsDir = path.join(root, 'agents');
const logDir = path.join(root, 'log');
fs.mkdirSync(agentsDir);
fs.mkdirSync(logDir);
process.env.NODE_ENV = 'test';
process.env.DOTENV_CONFIG_QUIET = 'true';
process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'false';
process.env.RECEIPT_SIGNING_SECRET = 'payer-binding-golden-secret';
process.env.ISSUER_PRIVATE_KEY = syntheticIssuerKeyEnv();
const KEY = syntheticIssuerKey();
process.env.ISSUER_KID = KEY.kid;
process.env.AGENTS_DIR = agentsDir;
process.env.OWNER_VIEW_DB = path.join(root, 'owner-view.sqlite');
process.env.OWNER_VIEW_AUDIENCES = '127.0.0.1';
process.env.OWNER_VIEW_NOT_FOUND_BUDGET_MS = '8';
// Fixed base URL so the JWS jku does not carry the random port.
process.env.PUBLIC_BASE_URL = 'http://golden.invalid';
delete process.env.RECEIPT_PAYER_BINDING_EIP712;
delete process.env.RECEIPT_PAYER_BINDING_DIR;
delete process.env.RECEIPT_FIXED_HEAD_EIP712;
delete process.env.RECEIPT_LOG_DIR;
delete process.env.RECEIPT_ANCHOR_PRIVATE_KEY;

const { _setIssuerSignerForTest } = await import('../../src/issuer-signer.js');
_setIssuerSignerForTest(stubSigner({ kid: KEY.kid, publicJwk: KEY.publicJwk, privateKey: KEY.privateKey }));
const { getReceiptMerkleTree } = await import('../../src/receipt-merkle.js');
const { createApp } = await import('../../src/server.js');
const { initAIListener, getAIListener } = await import('../../src/ai-listener.js');

// Fixed test wallets (not real keys).
const payer = new Wallet(`0x${'a1'.repeat(32)}`);
const agentWallet = new Wallet(`0x${'a2'.repeat(32)}`);
const payTo = new Wallet(`0x${'a3'.repeat(32)}`).address;
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TASK = 'xfuel-pb-golden';

await initAIListener();
const app = await createApp();
const tree = getReceiptMerkleTree();
tree.dir = logDir;
tree.allowFreshGenesis = true;
tree._now = () => new Date('2026-10-20T09:00:00.000Z');
tree.genesisLeaf = () => ({
  task_id: 'genesis',
  bytes: Buffer.from('{"schema":"chit402.tree_genesis.v1","payload_version":1,"verifier_binary_build_digest":null}'),
  kind: 'genesis',
});
app.locals.__test.agentRegistry.byId.set(4, { agent_id: 4, agentWallet: agentWallet.address, session: 'sess-golden' });
getAIListener().activeTasks.set(TASK, {
  taskId: TASK,
  status: 'completed',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  intent: {
    type: 'inference_request',
    amount: '2000',
    paymentRail: 'usdc',
    paymentRef: `base:0x${'e1'.repeat(32)}`,
    model: 'hidden-model-golden',
  },
  meta: { payerWallet: payer.address, agentId: 4, provider: 'hidden-provider', payTo, paymentAsset: BASE_USDC },
  outputHash: `0x${'cd'.repeat(32)}`,
});

const server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
const norm = (text) => String(text).split(`127.0.0.1:${port}`).join('127.0.0.1:PORT');
const get = async (url, headers = {}) => norm(await (await fetch(`${base}${url}`, { headers })).text());

async function settleJournal() {
  const file = path.join(logDir, 'journal.jsonl');
  let last = -1;
  for (let i = 0; i < 50; i += 1) {
    const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
    if (size === last && size > 0) return;
    last = size;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

async function ownerBody() {
  const issued = await (await fetch(`${base}/v1/receipts/owner/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scope: { receipt_ids: [TASK] } }),
  })).json();
  const signature = await payer.signTypedData(issued.typed_data.domain, issued.typed_data.types, issued.typed_data.message);
  const session = await (await fetch(`${base}/v1/receipts/owner/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ challenge: issued.challenge, signature, signer: payer.address, kind: 'evm' }),
  })).json();
  const res = await fetch(`${base}/v1/receipts/${TASK}/owner`, { headers: { authorization: `Bearer ${session.token}` } });
  return { status: res.status, body: norm(await res.text()) };
}

const out = {};
try {
  await get(`/receipt/${TASK}?format=json`);
  const appended = await app.locals.__test.usageSettled.append({
    task_id: TASK,
    payment: { rail: 'usdc', collected: true, ref: `base:0x${'e1'.repeat(32)}`, gross_amount: '2000' },
    route: { model: 'hidden-model-golden' },
  }, { payer: payer.address, agentId: 4 });
  if (!appended.ok) throw new Error(`append failed: ${appended.reason}`);
  await settleJournal();
  const task = getAIListener().activeTasks.get(TASK);
  out.holder_jws = norm(task.issuerSignature?.jws || task.issuer_signature?.jws || '');
  out.row_hash = appended.entry.book_chain?.row_hash || appended.entry.row_hash || null;
  out.public = {
    html: await get(`/receipt/${TASK}`),
    json: await get(`/receipt/${TASK}?format=json`),
    auditor: await get(`/receipt/${TASK}?format=auditor`),
    accept_json: await get(`/receipt/${TASK}`, { accept: 'application/json' }),
    preimage: await get(`/receipt/${TASK}/preimage`),
    preimage_raw: await get(`/receipt/${TASK}/preimage?raw=1`),
    owner_no_session: await get(`/v1/receipts/${TASK}/owner`),
  };
  out.owner = await ownerBody();
  out.journal = fs.readFileSync(path.join(logDir, 'journal.jsonl'), 'utf8');
  out.agents_dir_files = fs.readdirSync(agentsDir).sort();
  out.log_dir_files = fs.readdirSync(logDir).sort();
} finally {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  try { getAIListener().stopListening(); } catch { /* not started */ }
  try { app.locals.ownerStore?.close?.(); } catch { /* closed */ }
  fs.rmSync(root, { recursive: true, force: true });
}
fs.writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);
process.exit(0);
