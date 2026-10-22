/**
 * Fill and sign one public quarantine acknowledgement (chit402.quarantine_ack.v2).
 *
 * Reads the draft and the receipt-log journal. Writes nothing: the signed
 * document goes to stdout, notes go to stderr. It does not listen, does not
 * publish, does not anchor, and makes no request other than the issuer
 * signer's own GetPublicKey and Sign. Run from services/gateway with the
 * gateway environment loaded:
 *
 *   node scripts/sign-quarantine-ack.mjs \
 *     --draft ../../docs/log/quarantine-acks/epoch-2-size-11-cf9f998f.draft.json \
 *     --expect-kid IvFpmC-vPhkY_v0vidsrWVT9uzlE5XWKZgAEOeJTq1Q \
 *     --dry-run
 *
 * Drop --dry-run and add --confirm SIGN to sign. Signing requires
 * ISSUER_SIGNER=kms; the env key path is refused.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fillQuarantineAckFromJournal,
  jcs,
  quarantineAckDocumentHash,
  signQuarantineAck,
  validateQuarantineAckClaims,
} from '../src/quarantine-ack.js';

const gatewayDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

function fail(message) {
  console.error(`STOP: ${message}`);
  process.exit(1);
}

function journalPath() {
  const explicit = arg('--journal');
  if (explicit) return explicit;
  const logDir = process.env.RECEIPT_LOG_DIR
    || path.join(process.env.TASK_STORE_DIR || path.join(gatewayDir, '.data', 'tasks'), '..', 'receipt-log');
  return path.join(logDir, 'journal.jsonl');
}

const draftPath = arg('--draft');
const expectKid = arg('--expect-kid');
const dryRun = process.argv.includes('--dry-run');
if (!draftPath) fail('--draft is required');
if (!expectKid) fail('--expect-kid is required');

let draft;
try {
  draft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));
} catch (err) {
  fail(`draft unreadable: ${err.message}`);
}
const jPath = journalPath();
let journalText;
try {
  journalText = fs.readFileSync(jPath, 'utf8');
} catch (err) {
  fail(`journal unreadable at ${jPath}: ${err.code || err.message}`);
}

let signer = null;
if (!dryRun) {
  if (arg('--confirm') !== 'SIGN') {
    fail('signing needs --confirm SIGN (or use --dry-run)');
  }
  if (String(process.env.ISSUER_SIGNER || '').trim() !== 'kms') fail('ISSUER_SIGNER must be kms; the env key is not used here');
  const { initIssuerSigner } = await import('../src/issuer-signer.js');
  try {
    signer = await initIssuerSigner(process.env);
  } catch (err) {
    fail(`issuer signer init failed: ${err.code || err.message}`);
  }
  if (signer.kid !== expectKid) fail(`signer kid ${signer.kid} is not the expected kid`);
}

let claims;
try {
  claims = fillQuarantineAckFromJournal(draft, journalText, {
    nowSeconds: Math.floor(Date.now() / 1000),
    verifyKey: signer ? { ...signer.publicJwk, kid: signer.kid } : null,
  });
} catch (err) {
  fail(err.message);
}
const check = validateQuarantineAckClaims(claims);
if (!check.ok) fail(`claims invalid: ${check.errors.join('; ')}`);
if (claims.quarantined_head.kid !== expectKid) {
  console.error(`NOTE: the quarantined head was signed by kid ${claims.quarantined_head.kid}`);
}
const claimBytes = jcs(claims);
console.error(`journal: ${jPath}`);
console.error(`claims JCS sha256: ${(await import('node:crypto')).createHash('sha256').update(claimBytes, 'utf8').digest('hex')}`);

if (dryRun) {
  process.stdout.write(`${JSON.stringify(claims, null, 2)}\n`);
  console.error('DRY RUN: nothing was signed');
  process.exit(0);
}

const doc = await signQuarantineAck(claims, signer);
process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);
console.error(`document JCS sha256: ${quarantineAckDocumentHash(doc)}`);
console.error('SIGNED and self-verified. Nothing was written or published.');
