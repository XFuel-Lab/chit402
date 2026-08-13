/**
 * Do receipts verify, on both surfaces, against a live provider?
 *
 * `/v1` returned no signature at all until the surfaces were converged. The claim
 * now is stronger than "both are signed": the inline `/v1` receipt and the one at
 * `/receipt/:id` are built from the same task, so they must carry the *same*
 * signature — otherwise a verifier has to know which surface it is holding.
 */
import 'dotenv/config';
import crypto from 'node:crypto';

process.env.RECEIPT_SIGNING_SECRET ||= 'probe-secret';
const SECRET = process.env.RECEIPT_SIGNING_SECRET;

const { createApp } = await import('../../services/gateway/src/server.js');
const { canonicalSignedPayload } = await import('../../services/gateway/src/receipt.js');
const { initAIListener } = await import('../../services/gateway/src/ai-listener.js');

// /task-request routes through the listener; createApp alone does not start it.
await initAIListener();

const app = createApp();
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

const check = (label, receipt) => {
  if (!receipt?.signature) { console.log(`${label}: NO SIGNATURE`); return; }
  const expect = 'sha256=' + crypto.createHmac('sha256', SECRET)
    .update(canonicalSignedPayload(receipt)).digest('hex');
  const ok = expect === receipt.signature.value;
  console.log(`${label}: ${ok ? 'VERIFIES' : 'FAILS'}`);
  console.log(`   route: ${JSON.stringify(receipt.route)}`);
  if (!ok) {
    console.log(`   signature covers route.provider, delivered receipt has: ${receipt.route?.provider ?? '(absent)'}`);
  }
};

// /v1 surface
{
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'xfuel-demo' },
    body: JSON.stringify({ model: 'xfuel/auto', messages: [{ role: 'user', content: 'Say OK.' }], max_tokens: 16 }),
  });
  const payload = await res.json();
  const inline = payload.xfuel;
  if (!inline) console.log(`/v1 returned no receipt: HTTP ${res.status} ${JSON.stringify(payload).slice(0, 300)}`);
  check('/v1/chat/completions (inline)', inline);

  // Same task, other surface — the signatures must be byte-identical.
  if (inline?.task_id) {
    const fetched = await (await fetch(`${base}/receipt/${inline.task_id}?format=json`)).json();
    check('/v1 task via /receipt/:id', fetched);
    console.log(`   both surfaces agree on the signature: ${
      fetched?.signature?.value === inline?.signature?.value ? 'YES' : 'NO — two signatures for one task'}`);
    console.log(`   model attested: ${inline?.route?.model}`);
  }
}

// /task-request → /receipt/:id — the paid path, which uses the real signed receipt.
{
  const res = await fetch(`${base}/task-request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'xfuel-demo' },
    body: JSON.stringify({
      message_type: 'inference_request',
      chain_id: 'base',
      amount: '10000',
      sender: '0x0000000000000000000000000000000000000001',
      model_id: 'xfuel/auto',
      messages: [{ role: 'user', content: 'Say OK.' }],
      max_tokens: 32,
    }),
  });
  const body = await res.json();
  const id = body.task_id;
  if (!id) {
    console.log(`\n/task-request: no task_id (${JSON.stringify(body).slice(0, 220)})`);
  } else {
    // Wait for the listener to route and complete the task.
    let receipt;
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      receipt = await (await fetch(`${base}/receipt/${id}?format=json`)).json();
      if (receipt?.status === 'completed' || receipt?.signature) break;
    }
    console.log('');
    check('/task-request', receipt);

    // Tamper-evidence: the whole point of signing route.provider is that swapping
    // the named compute source must invalidate the signature.
    if (receipt?.signature) {
      const tampered = { ...receipt, route: { ...receipt.route, provider: 'some-other-provider' } };
      const expect = 'sha256=' + crypto.createHmac('sha256', SECRET)
        .update(canonicalSignedPayload(tampered)).digest('hex');
      console.log(`   tampering with route.provider is detected: ${expect === receipt.signature.value ? 'NO — signature still matches' : 'YES'}`);
      console.log(`   provider attested: ${receipt.route?.provider}`);
    }
  }
}

await new Promise((r) => server.close(r));
process.exit(0);
