import crypto from 'crypto';
import { computePaymentCommitment } from './payment-binding.js';

/**
 * Public verifiable-receipt builder + renderer.
 *
 * Turns a settled (or in-flight) listener task into a shareable, no-auth receipt:
 *   - a machine-readable JSON object (`buildReceipt`)
 *   - a clean standalone HTML page (`renderReceiptHtml`)
 *
 * PUBLIC-SAFE by design: it never exposes the raw proof bytes, private keys, or the
 * raw model output — only a hash commitment of the output, proof presence/nullifier,
 * payment rail/ref, and an INDEPENDENT re-derivation of the x402 payment-binding
 * commitment (so anyone can confirm "paid + proven" without trusting the server).
 *
 * Honest proof scope: the SP1 proof attests settlement metadata + a commitment to the
 * output hash — NOT that a black-box provider computed the model correctly. That is
 * stated on the receipt so we never overclaim (see docs/POSITIONING.md §2).
 */

const PROOF_SCOPE_NOTE =
  'The SP1 proof attests settlement metadata (correct fee split, payment binding) ' +
  'and a commitment to the output hash — anchored on-chain with a single-use ' +
  'nullifier. It does NOT attest that the provider computed the model correctly ' +
  '(that is Tier-2 proof-of-inference, roadmap).';

/** Block-explorer base per EVM network used in `payment_ref` ("<network>:<txHash>"). */
const EXPLORERS = {
  'base-sepolia': 'https://sepolia.basescan.org/tx/',
  base: 'https://basescan.org/tx/',
};

/**
 * Canonical, shareable proof link for a task: the public `/receipt/:taskId` page.
 * Absolute when a base URL is known, otherwise a root-relative path. This is the
 * single `verify_url` threaded consistently across every surface (M2M API,
 * OpenAI gateway, SDK, MCP) so an agent always gets one link it can share.
 */
export function buildVerifyUrl(baseUrl, taskId) {
  const base = baseUrl ? String(baseUrl).replace(/\/$/, '') : '';
  return `${base}/receipt/${taskId}`;
}

/**
 * Resolve the public base URL for building absolute links. Prefers an explicitly
 * configured canonical URL (PUBLIC_BASE_URL — correct behind a proxy/CDN), else
 * derives it from the request's protocol + host. Returns '' if neither is known.
 */
export function baseUrlFromReq(req, configuredBase) {
  if (configuredBase) return String(configuredBase).replace(/\/$/, '');
  const host = typeof req?.get === 'function' ? req.get('host') : null;
  return host ? `${req.protocol}://${host}` : '';
}

/** Build an explorer URL from a `payment_ref` like "base-sepolia:0xabc…", or null. */
export function explorerUrlForRef(paymentRef) {
  if (!paymentRef || typeof paymentRef !== 'string') return null;
  const idx = paymentRef.indexOf(':');
  if (idx < 0) return null;
  const network = paymentRef.slice(0, idx);
  const tx = paymentRef.slice(idx + 1);
  const base = EXPLORERS[network];
  if (!base || !/^0x[0-9a-fA-F]{6,}$/.test(tx)) return null;
  return base + tx;
}

/** Map task/proof state to a coarse ProofOutcome (mirrors /task-status). */
function proofOutcomeOf(task) {
  if (task.sp1Proof && !task.sp1Proof.error) return 'valid';
  if (task.sp1Proof?.error) return 'regenerable';
  if (task.status === 'failed') return 'invalid';
  return 'pending';
}

/**
 * Independently re-derive the x402 payment-binding commitment and compare it with
 * the one stored on the proof. This is the "binding verification" a third party can
 * trust: it recomputes keccak256(paymentRefHash, taskIdHash, rail, amount) locally.
 */
function verifyBinding(task) {
  const binding = task.sp1Proof?.paymentBinding;
  if (!binding) return null;

  const rail = task.intent?.paymentRail || binding.rail;
  const paymentRef = task.intent?.paymentRef || null;
  const amount = binding.amount ?? task.netAmount ?? task.intent?.amount ?? '0';

  let recomputed = null;
  try {
    ({ commitment: recomputed } = computePaymentCommitment({
      paymentRef, taskId: task.taskId, rail, amount,
    }));
  } catch {
    recomputed = null;
  }

  const expected = binding.commitment || null;
  return {
    present: true,
    in_proof: !!binding.in_proof,
    rail: binding.rail || rail || null,
    amount: String(amount),
    expected_commitment: expected,
    recomputed_commitment: recomputed,
    matches: !!(expected && recomputed && expected.toLowerCase() === recomputed.toLowerCase()),
  };
}

/** SHA-256 of the returned output (server-computed convenience commitment), or null. */
function outputHashOf(task) {
  // Prefer an explicitly stored commitment if the pipeline provides one.
  const explicit = task.outputHash || task.meta?.outputHash || task.sp1Proof?.outputHash;
  if (explicit) return { value: explicit, kind: 'committed' };
  if (task.result == null) return null;
  const serialized = typeof task.result === 'string' ? task.result : JSON.stringify(task.result);
  const digest = '0x' + crypto.createHash('sha256').update(serialized).digest('hex');
  return { value: digest, kind: 'sha256_of_output' };
}

/**
 * Build the public receipt JSON for a task.
 * @param {object} task     Listener task (from aiListener.activeTasks).
 * @param {object} [opts]   { baseUrl }
 */
export function buildReceipt(task, { baseUrl = '' } = {}) {
  const outcome = proofOutcomeOf(task);
  const feeBps = task.feeBps || 50;
  const paymentRail = task.intent?.paymentRail || 'tfuel';
  const paymentRef = task.intent?.paymentRef || null;
  const output = outputHashOf(task);
  const base = baseUrl ? baseUrl.replace(/\/$/, '') : '';

  return {
    task_id: task.taskId,
    status: task.status,
    proof_outcome: outcome,
    verify_url: buildVerifyUrl(base, task.taskId),
    created_at: task.createdAt || null,
    updated_at: task.updatedAt || null,
    route: {
      message_type: task.intent?.type || null,
      model: task.intent?.model || task.intent?.modelId || null,
      provider: task.meta?.provider || task.routedTo || null,
      chain_id: task.meta?.chain || task.intent?.chainId || null,
    },
    payment: {
      rail: paymentRail,
      ref: paymentRef,
      explorer_url: explorerUrlForRef(paymentRef),
      gross_amount: task.intent?.amount || '0',
      fee_amount: task.feeAmount || '0',
      net_amount: task.netAmount || '0',
      fee_bps: feeBps,
    },
    proof: {
      system: task.intent?.proofSystem || 'sp1',
      outcome,
      has_proof: !!task.sp1Proof?.proof,
      nullifier: task.sp1Proof?.nullifier || null,
      proving_time_ms: task.sp1Proof?.provingTimeMs || null,
      attests: PROOF_SCOPE_NOTE,
    },
    binding: verifyBinding(task),
    output: output ? { hash: output.value, kind: output.kind } : null,
    links: base
      ? {
          self: `${base}/receipt/${task.taskId}`,
          json: `${base}/receipt/${task.taskId}?format=json`,
          status: `${base}/task-status?task_id=${task.taskId}`,
          proof: `${base}/prove-result?task_id=${task.taskId}`,
        }
      : {
          self: `/receipt/${task.taskId}`,
          json: `/receipt/${task.taskId}?format=json`,
          status: `/task-status?task_id=${task.taskId}`,
          proof: `/prove-result?task_id=${task.taskId}`,
        },
  };
}

// ─── HTML rendering ──────────────────────────────────────────────────────────

function esc(v) {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function shortHash(h, head = 10, tail = 8) {
  if (!h || typeof h !== 'string') return '—';
  if (h.length <= head + tail + 1) return h;
  return `${h.slice(0, head)}…${h.slice(-tail)}`;
}

function row(label, valueHtml) {
  return `<div class="row"><span class="k">${esc(label)}</span><span class="v">${valueHtml}</span></div>`;
}

function badge(outcome, bindingMatches) {
  if (outcome === 'valid') {
    const bind = bindingMatches === false ? ' · binding mismatch' : bindingMatches ? ' · binding verified' : '';
    return `<span class="badge ok">Proven${esc(bind)}</span>`;
  }
  if (outcome === 'pending') return '<span class="badge pending">Proof pending</span>';
  if (outcome === 'regenerable') return '<span class="badge warn">Regenerable</span>';
  return '<span class="badge bad">Invalid</span>';
}

/** Render a clean, standalone, shareable HTML receipt page. */
export function renderReceiptHtml(receipt) {
  const p = receipt.payment;
  const pr = receipt.proof;
  const b = receipt.binding;
  const title = `XFuel receipt · ${shortHash(receipt.task_id, 12, 6)}`;
  const desc = `${pr.outcome === 'valid' ? 'Proven' : pr.outcome} · ${p.rail.toUpperCase()} · net ${esc(p.net_amount)} · fee ${esc(p.fee_bps)}bps`;

  const refHtml = p.ref
    ? (p.explorer_url
        ? `<a href="${esc(p.explorer_url)}" target="_blank" rel="noopener">${esc(shortHash(p.ref, 16, 8))} ↗</a>`
        : `<code>${esc(shortHash(p.ref, 16, 8))}</code>`)
    : '<span class="muted">—</span>';

  const bindingBlock = b
    ? `<section class="card">
        <h2>Payment binding <span class="scope">independent re-derivation</span></h2>
        ${row('In proof', b.in_proof ? '<span class="badge ok">yes</span>' : '<span class="badge pending">server-attested</span>')}
        ${row('Rail / amount', `${esc((b.rail || '').toUpperCase())} · ${esc(b.amount)}`)}
        ${row('Expected commitment', `<code>${esc(shortHash(b.expected_commitment, 12, 10))}</code>`)}
        ${row('Recomputed commitment', `<code>${esc(shortHash(b.recomputed_commitment, 12, 10))}</code>`)}
        ${row('Match', b.matches ? '<span class="badge ok">✓ matches</span>' : '<span class="badge bad">✗ mismatch</span>')}
      </section>`
    : `<section class="card">
        <h2>Payment binding</h2>
        <p class="muted">No x402 payment binding on this task (TFUEL-rail or binding disabled).</p>
      </section>`;

  const outputRow = receipt.output
    ? row(receipt.output.kind === 'committed' ? 'Output commitment' : 'Output hash (SHA-256)', `<code>${esc(shortHash(receipt.output.hash, 12, 10))}</code>`)
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:type" content="website" />
<meta name="robots" content="noindex" />
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0b0e14; color: #e6e9ef; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 32px 20px 64px; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
  .brand { font-weight: 700; letter-spacing: .3px; font-size: 18px; }
  .brand span { color: #6ea8fe; }
  h1 { font-size: 15px; font-weight: 600; margin: 0 0 4px; color: #aab2c0; }
  .taskid { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; color: #cfd6e4; word-break: break-all; }
  .card { background: #131824; border: 1px solid #222a3a; border-radius: 12px; padding: 18px 20px; margin: 14px 0; }
  .card h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .6px; color: #8b95a7; margin: 0 0 12px; font-weight: 600; }
  .scope { text-transform: none; letter-spacing: 0; font-weight: 400; color: #6b7488; font-size: 11px; margin-left: 6px; }
  .row { display: flex; justify-content: space-between; gap: 16px; padding: 6px 0; border-top: 1px solid #1b2231; }
  .row:first-of-type { border-top: 0; }
  .k { color: #8b95a7; }
  .v { text-align: right; word-break: break-word; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; background: #0e1420; padding: 2px 6px; border-radius: 6px; color: #cbd3e1; }
  a { color: #6ea8fe; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .muted { color: #6b7488; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .badge.ok { background: #10331f; color: #6ee7a8; border: 1px solid #1d5a37; }
  .badge.pending { background: #2a2410; color: #f3d27a; border: 1px solid #5a4d1d; }
  .badge.warn { background: #33260f; color: #f0b866; border: 1px solid #5a411d; }
  .badge.bad { background: #331414; color: #f08c8c; border: 1px solid #5a1d1d; }
  .scopebox { font-size: 12.5px; color: #8b95a7; border-left: 2px solid #2a3346; padding: 4px 0 4px 12px; margin-top: 6px; }
  footer { margin-top: 28px; font-size: 12px; color: #6b7488; text-align: center; }
  footer a { color: #7a869c; }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="brand">XFuel<span>·</span>receipt</div>
      <div>${badge(pr.outcome, b ? b.matches : undefined)}</div>
    </header>

    <h1>Task</h1>
    <div class="taskid">${esc(receipt.task_id)}</div>

    <section class="card">
      <h2>Route</h2>
      ${row('Status', esc(receipt.status))}
      ${row('Type', esc(receipt.route.message_type) || '<span class="muted">—</span>')}
      ${row('Model', esc(receipt.route.model) || '<span class="muted">—</span>')}
      ${row('Provider', esc(receipt.route.provider) || '<span class="muted">—</span>')}
      ${row('Chain', esc(receipt.route.chain_id) || '<span class="muted">—</span>')}
      ${outputRow}
    </section>

    <section class="card">
      <h2>Payment</h2>
      ${row('Rail', `<span class="badge ${p.rail === 'usdc' ? 'ok' : 'pending'}">${esc(p.rail.toUpperCase())}</span>`)}
      ${row('Settlement ref', refHtml)}
      ${row('Gross', esc(p.gross_amount))}
      ${row('Fee', `${esc(p.fee_amount)} <span class="muted">(${esc(p.fee_bps)} bps)</span>`)}
      ${row('Net', esc(p.net_amount))}
    </section>

    <section class="card">
      <h2>Proof</h2>
      ${row('System', esc((pr.system || 'sp1').toUpperCase()))}
      ${row('Outcome', esc(pr.outcome))}
      ${row('Proof present', pr.has_proof ? 'yes' : '<span class="muted">not yet</span>')}
      ${row('Nullifier', pr.nullifier ? `<code>${esc(shortHash(pr.nullifier, 12, 10))}</code>` : '<span class="muted">—</span>')}
      ${row('Proving time', pr.proving_time_ms != null ? `${esc(pr.proving_time_ms)} ms` : '<span class="muted">—</span>')}
      <div class="scopebox">${esc(pr.attests)}</div>
    </section>

    ${bindingBlock}

    <footer>
      Machine-readable: <a href="${esc(receipt.links.json)}">JSON</a> ·
      <a href="${esc(receipt.links.proof)}">proof</a> ·
      <a href="${esc(receipt.links.status)}">status</a><br />
      Verifiable settlement for AI compute — route any model, prove every dollar.
    </footer>
  </div>
</body>
</html>`;
}

/** Minimal standalone HTML for an unknown/expired task id. */
export function renderReceiptNotFound(taskId) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>XFuel receipt · not found</title>
<meta name="robots" content="noindex" />
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #0b0e14; color: #e6e9ef; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .wrap { max-width: 560px; margin: 0 auto; padding: 80px 20px; text-align: center; }
  .brand { font-weight: 700; font-size: 18px; margin-bottom: 24px; }
  .brand span { color: #6ea8fe; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #0e1420; padding: 2px 6px; border-radius: 6px; color: #cbd3e1; word-break: break-all; }
  .muted { color: #8b95a7; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="brand">XFuel<span>·</span>receipt</div>
    <h1>Receipt not found</h1>
    <p class="muted">No task with id <code>${esc(taskId)}</code> is known to this node.
    Receipts are held in memory for the task's lifetime.</p>
  </div>
</body>
</html>`;
}

export default { buildReceipt, renderReceiptHtml, renderReceiptNotFound, explorerUrlForRef, buildVerifyUrl, baseUrlFromReq };
