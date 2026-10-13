/**
 * Offline retire or revoke of the live issuer key.
 *
 * Appends one history entry and signs it with the current key. It does not
 * edit a sealed entry and it does not listen. Two people confirm: the
 * operator and a different approver. Run from services/gateway:
 *
 *   ISSUER_PRIVATE_KEY=... \
 *   ISSUER_HISTORY_OPERATOR=alice \
 *   ISSUER_HISTORY_APPROVER=bob \
 *   node scripts/retire-issuer-key.mjs \
 *     --status revoked \
 *     --not-before 2026-10-13T00:00:00.000Z \
 *     --revoked-at 2026-10-13T00:00:00.000Z \
 *     --reason compromised \
 *     --confirm YES
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureIssuerHistoryStore, retireOrRevokeIssuerKey } from '../src/issuer-history.js';
import { initIssuerKey } from '../src/issuer-key.js';

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const operator = String(process.env.ISSUER_HISTORY_OPERATOR || '').trim();
const approver = String(process.env.ISSUER_HISTORY_APPROVER || '').trim();
if (!operator || !approver || operator === approver) {
  fail('ISSUER_HISTORY_OPERATOR and ISSUER_HISTORY_APPROVER must both be set and must differ');
}
if (arg('--confirm') !== 'YES') fail('--confirm YES is required');

const status = arg('--status');
if (status !== 'retired' && status !== 'revoked') fail('--status must be retired or revoked');
const notBefore = arg('--not-before');
if (!notBefore) fail('--not-before is required');
const revokedAt = arg('--revoked-at');
if (status === 'revoked' && !revokedAt) fail('--revoked-at is required to revoke');

const gatewayRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const taskDir = process.env.TASK_STORE_DIR || path.join(gatewayRoot, '.data', 'tasks');
const agentsDir = process.env.AGENTS_DIR || path.join(taskDir, '..', 'agents');
const persist = process.env.TASK_STORE_PERSIST !== 'false' && !!agentsDir;
configureIssuerHistoryStore({ dir: agentsDir, persist });

initIssuerKey();
const record = retireOrRevokeIssuerKey({
  status,
  not_before: notBefore,
  not_after: arg('--not-after'),
  revoked_at: revokedAt,
  reason: arg('--reason'),
  custody: arg('--custody') || `retired by ${operator}, approved by ${approver}`,
  kid: arg('--kid'),
});
const doc = JSON.parse(record.body);
console.log(JSON.stringify({
  version: record.version,
  head_hash: record.head_hash,
  entry_count: doc.entries.length,
  status: doc.entries[doc.entries.length - 1].status,
  operator,
  approver,
}));
