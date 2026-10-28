#!/usr/bin/env node
/**
 * Offline mutant runner for post-settle holds.
 * No network and no secrets. Each mutant is one string edit, capped at 180s.
 * The file is restored after every mutant. A clean test run is KILLED when
 * the suite fails, and SURVIVED when it still passes.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GATEWAY = join(ROOT, 'services/gateway');
const TIMEOUT_MS = 180_000;
const gwTests = [
  'test/post-settle-hold.test.mjs',
  'test/post-settle-stamp-http.test.mjs',
  'test/settle-store-failure.test.mjs',
];

function gw(extra = []) {
  return { cwd: GATEWAY, args: ['--test', ...gwTests, ...extra] };
}

const mutants = [
  { id: 'G1', file: 'services/gateway/src/x402-flags.js', from: 'status: 202,\n      retryAfter: retrySeconds(decision.retryAfter, RESOLVABLE_RETRY_AFTER_SEC),', to: 'status: 402,\n      retryAfter: retrySeconds(decision.retryAfter, RESOLVABLE_RETRY_AFTER_SEC),', run: gw() },
  { id: 'G2', file: 'services/gateway/src/x402-flags.js', from: 'return { status: 409, retryAfter: null, refundOwed: true, fallback: false };', to: 'return { status: 202, retryAfter: null, refundOwed: true, fallback: false };', run: gw() },
  { id: 'G3', file: 'services/gateway/src/x402-flags.js', from: 'return { status: 409, retryAfter: null, refundOwed: true, fallback: false };', to: 'return { status: 409, retryAfter: 5, refundOwed: true, fallback: false };', run: gw() },
  { id: 'G4', file: 'services/gateway/src/x402-flags.js', from: 'status: 202,\n      retryAfter: retrySeconds(decision.retryAfter, RESOLVABLE_RETRY_AFTER_SEC),', to: 'status: 409,\n      retryAfter: retrySeconds(decision.retryAfter, RESOLVABLE_RETRY_AFTER_SEC),', run: gw() },
  { id: 'G5', file: 'services/gateway/src/x402-flags.js', from: 'retryAfter: retrySeconds(decision.retryAfter, RESOLVABLE_RETRY_AFTER_SEC),', to: 'retryAfter: null,', run: gw() },
  { id: 'G6', file: 'packages/sdk/src/index.ts', from: "hold.refund ? 'refund_owed' : 'payment_pending'", to: "'payment_rejected'", run: { cwd: join(ROOT, 'packages/sdk'), args: ['--experimental-vm-modules', 'node_modules/jest/bin/jest.js', '--testPathPattern', 'index.test', '--watchman=false'] } },
  { id: 'G7a', file: 'services/gateway/src/agent-registry.js', from: "...(stamp?.pending_id ? { pending_id: stamp.pending_id } : {}),", to: '', run: gw() },
  { id: 'G7b', file: 'services/gateway/src/foreign-x402-ingest.js', from: "...(stamp?.pending_id ? { pending_id: stamp.pending_id } : {}),", to: '', run: gw() },
  { id: 'G7c', file: 'services/gateway/src/board-posts.js', from: "...(stamp?.pending_id ? { pending_id: stamp.pending_id } : {}),", to: '', run: gw() },
  { id: 'G7d', file: 'services/gateway/src/board-jobs.js', from: "...(stamp?.pending_id ? { pending_id: stamp.pending_id } : {}),", to: '', run: gw() },
  { id: 'G8a', file: 'services/gateway/src/x402-flags.js', from: 'if (decision?.preSettle === true) {', to: 'if (false && decision?.preSettle === true) {', run: gw() },
  { id: 'G9', file: 'services/gateway/src/openai-gateway.js', from: 'sendOpenAiPaymentResult(res, inflightHoldDecision(extractPaymentNonce(req)));', to: "res.status(402).json({ error: { message: 'Payment could not be settled', type: 'payment_required', code: 'payment_in_flight' } });", run: gw() },
  { id: 'G10a', file: 'services/gateway/src/server.js', from: 'if (paid < BigInt(STAMP_FEE_UNITS) || !samePayee(decision.payTo, config.x402.payTo)) {\n          return terminalStampDecision(decision.paymentRef);', to: "if (paid < BigInt(STAMP_FEE_UNITS) || !samePayee(decision.payTo, config.x402.payTo)) {\n          return { ok: false, status: 402, error: 'stamp_underpaid', code: 'stamp_underpaid' };", run: gw() },
  { id: 'G10b', file: 'services/gateway/src/server.js', from: 'if (paid < BigInt(STAMP_FEE_UNITS) || !payeeOk) {\n          return terminalStampDecision(decision.paymentRef);', to: "if (paid < BigInt(STAMP_FEE_UNITS) || !payeeOk) {\n          return { ok: false, status: 402, error: 'stamp_underpaid', code: 'stamp_underpaid' };", run: gw() },
  { id: 'G11', file: 'packages/mcp/src/format.ts', from: 'Do not pay again.', to: 'Payment was rejected. Do not pay again.', run: { cwd: join(ROOT, 'packages/mcp'), args: ['--import', 'tsx', '--test', 'src/__tests__/format.test.ts', 'src/__tests__/hold-tools.test.ts'] } },
  { id: 'G12', file: 'services/gateway/src/x402-adapter.js', from: "const pending_id = crypto.randomBytes(16).toString('hex');", to: 'const pending_id = `pending-${Date.now().toString(36)}-${this.holdHandles.length}`;', run: gw() },
  { id: 'G13', file: 'services/gateway/src/receipt-shell.js', from: "const text = page === 'refund_owed' ? 'refund owed, do not pay again' : 'pending';", to: "const text = 'pending';", run: gw() },
  { id: 'X1', file: 'services/gateway/src/late-issue.js', from: "    ...extra,\n    holdClass: 'resolvable',", to: '    ...extra,', run: gw() },
  { id: 'X2', file: 'services/gateway/src/late-issue.js', from: "      verifyUrl: lateVerifyUrl(cfg, row.pending_id),\n      holdClass: 'terminal',", to: '      verifyUrl: lateVerifyUrl(cfg, row.pending_id),', run: gw() },
  { id: 'X3', file: 'services/gateway/src/openai-gateway.js', from: 'key: settleHoldKey(net, nonce),', to: 'key: `inflight:${nonce}`,', run: gw() },
  { id: 'X4', file: 'services/gateway/src/x402-settle.js', from: "  return {\n    kind: 'settled',\n    confirmed: true,\n    paymentRef: norm.key,", to: "  return refused(req, 'payment_replayed', { network: net, sub: 'extra_replay' });\n  return {\n    kind: 'settled',\n    confirmed: true,\n    paymentRef: norm.key,", run: gw() },
  { id: 'S3a', file: 'services/gateway/src/x402-settle.js', from: "      try { active.revertSubmitted(nonce, owner); } catch { /* store */ }\n      return releasedHold();", to: "      try { active.revertSubmitted(nonce, owner); } catch { /* store */ }\n      return refused(req, publicReason, { preSettle: true });", run: gw() },
  { id: 'S3b', file: 'services/gateway/src/x402-settle.js', from: "      try { active.release(nonce, owner); } catch { /* store */ }\n      return releasedHold();", to: "      try { active.release(nonce, owner); } catch { /* store */ }\n      return refused(req, publicReason, { preSettle: true });", run: gw() },
  { id: 'S3c', file: 'services/gateway/src/x402-settle.js', from: "      release();\n      return releasedHold();", to: "      release();\n      return refused(req, publicReason, { preSettle: true });", run: gw() },
  { id: 'S4a', file: 'services/gateway/src/board-jobs.js', from: "return terminalHold('payer_mismatch', settled.settlement?.paymentRef, { publicBaseUrl: deps.baseUrl || '' });", to: "return { ok: false, status: 403, error: 'payer_mismatch' };", run: gw() },
  { id: 'S4b', file: 'services/gateway/src/board-job-routes.js', from: "return terminalHold('payer_mismatch', decision.paymentRef, { publicBaseUrl: baseUrl || '' });", to: "return { ok: false, status: 403, error: 'payer_mismatch' };", run: gw() },
  { id: 'M3a', file: 'packages/mcp/src/board.ts', from: '  const held = describeHold(data);\n  if (held) return fail(held);\n', to: '', run: { cwd: join(ROOT, 'packages/mcp'), args: ['--import', 'tsx', '--test', 'src/__tests__/hold-tools.test.ts'] } },
  { id: 'M3b', file: 'packages/mcp/src/tools.ts', from: '  const held = describeHold(data);\n  if (held) return fail(held);\n', to: '', run: { cwd: join(ROOT, 'packages/mcp'), args: ['--import', 'tsx', '--test', 'src/__tests__/hold-tools.test.ts'] } },
  { id: 'S2', file: 'services/gateway/src/x402-settle.js', from: 'if (linked?.pending_id) {', to: 'if (false && linked?.pending_id) {', run: gw() },
  { id: 'S9', file: 'services/gateway/src/x402-settle.js', from: 'if (postSent) {', to: 'if (false && postSent) {', run: gw() },
  { id: 'M2', file: 'services/gateway/src/openai-gateway.js', from: 'const net = store?.get?.(nonce)?.network || network || \'\';', to: 'const net = network || store?.get?.(nonce)?.network || \'\';', run: gw() },
];

function apply(mutant) {
  const abs = join(ROOT, mutant.file);
  const original = readFileSync(abs, 'utf8');
  if (!original.includes(mutant.from)) return { original, applied: false };
  writeFileSync(abs, original.replace(mutant.from, mutant.to));
  return { original, applied: true };
}

function execute(mutant) {
  const env = { ...process.env, NODE_ENV: 'test', HUB_CATALOG_OFFLINE: 'true' };
  const res = spawnSync(process.execPath, mutant.run.args, {
    cwd: mutant.run.cwd,
    env,
    timeout: TIMEOUT_MS,
    encoding: 'utf8',
  });
  if (res.error && res.error.code === 'ETIMEDOUT') return 'TIMEOUT';
  if (res.signal === 'SIGTERM') return 'TIMEOUT';
  return res.status === 0 ? 'SURVIVED' : 'KILLED';
}

const only = process.argv.slice(2);
const selected = only.length ? mutants.filter((m) => only.includes(m.id)) : mutants;
const results = [];
for (const mutant of selected) {
  const { original, applied } = apply(mutant);
  let result = 'APPLY-FAILED';
  try {
    if (applied) result = execute(mutant);
  } finally {
    if (applied) writeFileSync(join(ROOT, mutant.file), original);
  }
  results.push({ id: mutant.id, result });
  process.stdout.write(`${mutant.id}\t${result}\n`);
}
const bad = results.filter((row) => row.result !== 'KILLED');
process.exit(bad.length ? 1 : 0);
