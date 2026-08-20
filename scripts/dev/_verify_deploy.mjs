/**
 * Post-deploy verification against a running gateway.
 *
 * Every other probe in this folder boots its own in-process server, which means
 * none of them can tell you whether the *deployed* host has the code. This one
 * only speaks HTTP, so it works against Lightsail, localhost, or anything else.
 *
 * It checks the fingerprints of the 2026-08-12/13 correctness work specifically,
 * because the failure mode being guarded against is a deploy that looks fine —
 * `/health` returns 200 and chat completions come back — while still serving
 * mocks, unsigned receipts, and underpriced agent work.
 *
 *   node scripts/dev/_verify_deploy.mjs https://api.xfuel.app
 *   node scripts/dev/_verify_deploy.mjs http://127.0.0.1:3002 my-api-key
 *
 * Exits non-zero if any check fails, so it can gate a deploy script.
 */

const base = (process.argv[2] || 'http://127.0.0.1:3002').replace(/\/$/, '');
const key = process.argv[3] || 'xfuel-demo';

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};

async function json(path, init) {
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* leave null; callers report status */ }
  return { res, body, text };
}

const post = (path, payload) => json(path, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': key },
  body: JSON.stringify(payload),
});

/** ~4 chars per token, so this is roughly the measured median agent prompt. */
const bigPrompt = [{ role: 'user', content: 'x'.repeat(68_000 * 4) }];
const tools = [{
  type: 'function',
  function: { name: 'noop', description: 'does nothing', parameters: { type: 'object', properties: {} } },
}];

console.log(`\nVerifying ${base}\n${'─'.repeat(60)}`);

// ── 1. Is this even the new build? ───────────────────────────────────────────
// The `proofs` block is the cheapest unambiguous marker: it did not exist before
// 2026-08-12, so its absence means the deploy did not take.
{
  const { res, body } = await json('/health');
  record('health responds', res.ok, res.ok ? null : `HTTP ${res.status}`);
  record(
    'new build deployed (/health carries a proofs block)',
    !!body?.proofs,
    body?.proofs ? `tier2=${body.proofs.tier2_sp1?.status ?? 'n/a'}` : 'no proofs block — the host is running pre-2026-08-12 code',
  );
  // Pre-existing fingerprint from RUNTIME_STATE.md: catches a revived legacy process.
  const split = body?.fee_config?.revenue_split?.model;
  record(
    'not the legacy process (revenue_split is v2)',
    split === 'usdc-base-splits-v2',
    `revenue_split.model = ${JSON.stringify(split)}`,
  );
  // Checked before any receipt is fetched, because an unset signing secret makes
  // every later signature check fail for one boring reason.
  record(
    'receipt signing is configured',
    body?.receipts?.tier1_signed !== false,
    body?.receipts?.warning || 'RECEIPT_SIGNING_SECRET appears set',
  );
}

// ── 2. Does the quote price the model that will serve? ───────────────────────
// The bug this catches: `xfuel/auto` matched no rate-card row, so agent work was
// quoted on the cheap default row and ran ~4.7x below its own COGS.
{
  const agent = await post('/task-quote', { model_id: 'xfuel/auto', messages: bigPrompt, max_tokens: 247, tools });
  const simple = await post('/task-quote', { model_id: 'xfuel/auto', messages: bigPrompt, max_tokens: 247 });

  const pricing = agent.body?.rails?.usdc?.pricing;
  record(
    'the quote names the model it priced',
    !!pricing?.priced_model,
    pricing
      ? `requested=${pricing.requested_model} priced=${pricing.priced_model}`
      : `no pricing block (HTTP ${agent.res.status})`,
  );

  const agentAmount = Number(agent.body?.rails?.usdc?.amount);
  const simpleAmount = Number(simple.body?.rails?.usdc?.amount);
  // Agent work resolves to a reasoning model in a dearer rate row. If the two are
  // equal, the alias is being priced verbatim again and the dear route is underwater.
  record(
    'agent work is priced above a short completion',
    Number.isFinite(agentAmount) && agentAmount > simpleAmount,
    `agent=${agentAmount} simple=${simpleAmount} base units`,
  );
  record(
    'the agent quote clears measured GLM-5.2 COGS (~96,290 units)',
    agentAmount > 96_290,
    `agent quote = ${agentAmount}`,
  );

  // The bug this catches: on 2026-08-15 `X402_COST_PLUS=true` moved every
  // advertised price and no charged one, so the gateway published $1.54/$4.84 per
  // million while billing $3.00/$9.00. Both surfaces were individually plausible;
  // only comparing them shows it. A spot-check found it in production, which is
  // the wrong place to find it.
  const { body: manifest } = await json('/.well-known/x402');
  const advertised = manifest?.pricing?.basis ?? null;
  const charged = pricing?.basis ?? null;
  const agrees = advertised === 'cost_plus'
    ? charged === 'cost_plus'
    : ['metered', 'model_price'].includes(charged);
  record(
    'the advertised pricing model is the one the quote uses',
    !!advertised && !!charged && agrees,
    `/.well-known/x402 says ${JSON.stringify(advertised)}, /task-quote priced as ${JSON.stringify(charged)}`,
  );
}

// ── 3. Is the receipt signed, and does it attest real compute? ───────────────
{
  const { res, body } = await post('/v1/chat/completions', {
    model: 'xfuel/auto',
    messages: [{ role: 'user', content: 'Reply with the single word: PONG' }],
    max_tokens: 512,
  });

  if (!res.ok) {
    record('/v1 chat completion serves', false, `HTTP ${res.status} ${JSON.stringify(body)?.slice(0, 300)}`);
  } else {
    record('/v1 chat completion serves', true, `model=${body.model}`);

    const receipt = body.xfuel;
    record(
      '/v1 receipt is signed',
      !!receipt?.signature?.value,
      receipt?.signature
        ? `${receipt.signature.alg} payload v${receipt.signature.payload_version}`
        : 'no signature — an unverifiable receipt that looks authoritative',
    );
    record(
      'the receipt names a real provider, not a mock',
      !!receipt?.route?.provider && !/mock/i.test(receipt.route.provider),
      `route.provider = ${receipt?.route?.provider}`,
    );

    // The inline receipt and the canonical one must be the same bytes, or "verify
    // your receipt" means two different things depending on where you read it.
    if (receipt?.task_id) {
      const canonical = await json(`/receipt/${receipt.task_id}?format=json`);
      record(
        'inline and canonical receipts sign identically',
        !!canonical.body?.signature?.value
          && canonical.body.signature.value === receipt.signature?.value,
        `inline=${receipt.signature?.value?.slice(0, 24)}… canonical=${canonical.body?.signature?.value?.slice(0, 24)}…`,
      );
    }
  }
}

// ── 4. Does the paid path reach real compute? ───────────────────────────────
// Only meaningful when x402 is off or the key is exempt; a 402 here is not a
// failure, it means payment is required and this probe cannot pay.
{
  const { res, body } = await post('/task-request', {
    message_type: 'inference_request',
    chain_id: 'base',
    amount: '1000000',
    sender: '0x0000000000000000000000000000000000000001',
    model_id: 'xfuel/auto',
    messages: [{ role: 'user', content: 'Reply with the single word: PONG' }],
    max_tokens: 512,
  });

  if (res.status === 402) {
    console.log('SKIP  paid path (402 — x402 is enabled and this probe cannot pay)');
  } else if (!body?.task_id) {
    record('paid task is accepted', false, `HTTP ${res.status} ${JSON.stringify(body)?.slice(0, 300)}`);
  } else {
    let status = null;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      status = (await json(`/task-status?task_id=${body.task_id}`)).body;
      if (['completed', 'failed', 'fee_collected'].includes(status?.status)) break;
    }
    record(
      'paid task serves real compute',
      !!status && status.status !== 'failed' && !status.result?.mock,
      `status=${status?.status} provider=${status?.result?.provider ?? 'n/a'}`
        + (status?.error ? ` error=${status.error.code}: ${status.error.message}` : ''),
    );
  }
}

// ── Summary ─────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
console.log('─'.repeat(60));
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log(`\nFailed:\n${failed.map((f) => `  - ${f.name}`).join('\n')}`);
  process.exitCode = 1;
}
