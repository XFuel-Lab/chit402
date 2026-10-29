/**
 * Boot a gateway on loopback for the persist tests.
 * PERSIST_ROLE=boot writes the boot result and exits.
 * PERSIST_ROLE=serve plants local register fixtures, listens, and stays up.
 */
import fs from 'node:fs';
import path from 'node:path';

if (process.env.PERSIST_UMASK) process.umask(parseInt(process.env.PERSIST_UMASK, 8));

const { createApp } = await import('../src/server.js');
const { initAIListener, getAIListener } = await import('../src/ai-listener.js');
const { buildReceipt } = await import('../src/receipt.js');
const { regTask } = await import('./persist-reg-task.mjs');

function writeResult(body) {
  const file = process.env.PERSIST_RESULT;
  const tmp = `${file}.writing`;
  fs.writeFileSync(tmp, JSON.stringify(body));
  fs.renameSync(tmp, file);
}

let server = null;
process.on('SIGTERM', () => {
  if (server) server.close(() => process.exit(0));
  else process.exit(0);
});

try {
  await initAIListener();
  const app = await createApp();
  const role = process.env.PERSIST_ROLE || 'serve';
  if (role === 'boot') {
    writeResult({ booted: true });
    process.exit(0);
  }
  const plantFile = process.env.PERSIST_PLANT;
  if (plantFile) {
    const plants = JSON.parse(fs.readFileSync(plantFile, 'utf8'));
    const listener = getAIListener();
    for (const spec of plants) {
      const task = regTask(spec);
      listener.activeTasks.set(task.taskId, task);
      await buildReceipt(task, { persistSignature: true, payerWallet: spec.address });
    }
  }
  server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  writeResult({ booted: true, port: server.address().port });
} catch (err) {
  writeResult({
    booted: false,
    code: err?.code || null,
    message: err?.message || null,
  });
  process.exit(2);
}
