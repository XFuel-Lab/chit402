/**
 * One gateway process for the book-webhook and owner-key persistence tests.
 * SCENARIO=boot attempts createApp and writes RESULT_FILE, then exits.
 * Otherwise it seeds agents, listens on 127.0.0.1:0, and writes PORT_FILE.
 */
import fs from 'node:fs';
import http from 'node:http';

if (process.env.TEST_UMASK != null && process.env.TEST_UMASK !== '') {
  process.umask(Number(process.env.TEST_UMASK));
}

const { createApp } = await import('../../src/server.js');
const { initAIListener } = await import('../../src/ai-listener.js');

if (process.env.SCENARIO === 'boot') {
  let body;
  try {
    await initAIListener();
    await createApp();
    body = { booted: true, code: null, message: '' };
  } catch (err) {
    body = {
      booted: false,
      code: err && err.code ? err.code : null,
      message: err && err.message ? String(err.message) : '',
    };
  }
  fs.writeFileSync(process.env.RESULT_FILE, JSON.stringify(body));
  process.exit(body.booted ? 0 : 2);
}

await initAIListener();
const app = await createApp();
const seeded = [];
const count = Number(process.env.SEED_COUNT || 0);
const wallets = String(process.env.WALLET_ADDRESSES || '').split(',').filter(Boolean);
for (let i = 0; i < count; i++) {
  const row = app.locals.__test.agentRegistry.allocate({ taskId: `seed-${process.pid}-${i}` });
  if (wallets[i]) {
    const bound = app.locals.__test.agentRegistry.bindWallet(row.agent_id, { agentWallet: wallets[i] });
    if (!bound.ok) throw new Error('fixture wallet was not stored');
  }
  seeded.push({ agent_id: row.agent_id, session: row.session });
}
if (process.env.AGENTS_FILE) fs.writeFileSync(process.env.AGENTS_FILE, JSON.stringify(seeded));

const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
fs.writeFileSync(process.env.PORT_FILE, String(server.address().port));

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  try { app.locals.ownerStore?.close?.(); } catch { /* already closed */ }
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  process.exit(0);
}
process.on('SIGTERM', () => { shutdown(); });
process.on('SIGINT', () => { shutdown(); });
