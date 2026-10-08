/**
 * One step of the durable owner-store restart test.
 * Each invocation is a fresh process against OWNER_VIEW_DB.
 */
import fs from 'node:fs';
import http from 'node:http';
import { Wallet } from 'ethers';

const step = process.argv[2];
const wallet = new Wallet(process.env.HOUSE_KEY);
process.env.HOUSE_PAYER_WALLETS = wallet.address;
process.env.HUB_CATALOG_OFFLINE = 'true';
process.env.X402_ENABLED = 'false';
process.env.RECEIPT_SIGNING_SECRET = process.env.RECEIPT_SIGNING_SECRET || 'owner-store-restart';

const { createApp } = await import('../../src/server.js');
const app = createApp();
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

function request(method, pathname, { headers = {}, body = null } = {}) {
  const payload = body == null ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      method,
      path: pathname,
      headers: {
        ...(payload ? {
          'content-type': 'application/json',
          'content-length': String(payload.length),
        } : {}),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { json = null; }
        resolve({ status: res.statusCode, text, json });
      });
    });
    req.on('error', reject);
    if (payload) req.end(payload);
    else req.end();
  });
}

try {
  if (step === 'open') {
    const issued = await request('POST', '/v1/receipts/owner/challenge', {
      body: { scope: { house: true } },
    });
    if (issued.status !== 200) throw new Error(`challenge ${issued.status} ${issued.text}`);
    const typed = issued.json.typed_data;
    const signature = await wallet.signTypedData(typed.domain, typed.types, typed.message);
    const opened = await request('POST', '/v1/receipts/owner/session', {
      body: {
        challenge: issued.json.challenge,
        signature,
        signer: wallet.address,
        kind: 'evm',
      },
    });
    if (opened.status !== 200) throw new Error(`session ${opened.status} ${opened.text}`);
    fs.writeFileSync(process.env.STATE_FILE, JSON.stringify({
      challenge: issued.json.challenge,
      signature,
      signer: wallet.address,
      token: opened.json.token,
    }));
    fs.writeFileSync(process.env.RESULT_FILE, 'opened');
  } else if (step === 'replay') {
    const state = JSON.parse(fs.readFileSync(process.env.STATE_FILE, 'utf8'));
    const replay = await request('POST', '/v1/receipts/owner/session', {
      body: {
        challenge: state.challenge,
        signature: state.signature,
        signer: state.signer,
        kind: 'evm',
      },
    });
    fs.writeFileSync(process.env.RESULT_FILE, String(replay.status));
  } else if (step === 'hold') {
    const state = JSON.parse(fs.readFileSync(process.env.STATE_FILE, 'utf8'));
    const held = await request('GET', '/v1/house/metrics', {
      headers: { authorization: `Bearer ${state.token}` },
    });
    fs.writeFileSync(process.env.RESULT_FILE, String(held.status));
  } else {
    throw new Error(`unknown step ${step}`);
  }
} finally {
  try { app.locals.ownerStore?.close?.(); } catch { /* process exit still drops the handle */ }
  await new Promise((resolve) => server.close(resolve));
}
