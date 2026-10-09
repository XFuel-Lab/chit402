#!/usr/bin/env node
/**
 * Re-verify a published 1F916 link specimen.
 *
 *   node scripts/verify-1f916-link.mjs <specimen.json>
 *   node scripts/verify-1f916-link.mjs https://www.chit402.com/specimens/1f916-link-1.json
 *
 * Prints one line per step, then VERDICT. Exit 0 only when every step passes.
 * A public receipt shell (schema chit402.receipt_shell.v1, or unsigned:true)
 * fails closed with public_receipt_is_unsigned_shell. No flag, environment
 * variable, or fetch fixture turns that shell into PASS or VERIFIED.
 * Node built-ins only.
 *
 * Hermetic runs: set CHIT_VERIFY_FETCH_FIXTURE to a JSON file
 * `{ "responses": { "<url>": <body> } }`. The longest matching URL prefix
 * is returned and a miss throws, so the process does not open a socket.
 *
 * Steps:
 *   fetch_receipt       GET the receipt JSON
 *   issuer_signature    ES256 against https://api.chit402.com/.well-known/jwks.json
 *   receipt_chain       signed book_chain (chit402.book_seq.v1) and its row hash
 *   on_chain_tx         Base USDC Transfer via a public RPC
 *   entry_fingerprint   published 1F916 identity-log hash for the claimed event
 */
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const JWKS_URL = 'https://api.chit402.com/.well-known/jwks.json';
const RECEIPT_ORIGIN = 'https://api.chit402.com';
const RECORD_ORIGIN = 'https://1f916.ai';
const SPECIMEN_ORIGIN = 'https://www.chit402.com';
const DEFAULT_RPC = 'https://mainnet.base.org';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';

const STEPS = [
  'fetch_receipt',
  'issuer_signature',
  'receipt_chain',
  'on_chain_tx',
  'entry_fingerprint',
];

/**
 * @param {string} status
 * @param {string} detail
 */
function step(status, detail) {
  return { status, detail };
}

function pass(detail) {
  return step('PASS', detail);
}

function fail(detail) {
  return step('FAIL', detail);
}

/**
 * @param {string} jwk
 */
function jwkThumbprint(jwk) {
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  return createHash('sha256').update(canonical).digest('base64url');
}

/**
 * Identity hash from services/gateway/src/book-seq.js bookRowHash.
 * book_id on the receipt is the book agent_id the hash was computed with.
 * @param {object} chain
 */
export function bookRowHash(chain) {
  const line = [
    chain?.book_id ?? '',
    chain?.seq ?? '',
    chain?.task_id ?? '',
    chain?.prev_hash || '',
    chain?.event || '',
  ].join('|');
  return createHash('sha256').update(String(line)).digest('hex');
}

/**
 * @param {string} jws
 * @param {object} jwk
 */
function verifyEs256(jws, jwk) {
  const parts = String(jws || '').split('.');
  if (parts.length !== 3) return { valid: false, reason: 'malformed_jws' };
  const [headerB64, payloadB64, signatureB64] = parts;
  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, reason: 'json_parse_error' };
  }
  if (header.alg !== 'ES256') return { valid: false, reason: `unsupported_alg:${header.alg}` };
  if (header.kid && jwk.kid && header.kid !== jwk.kid) {
    return { valid: false, reason: 'kid_mismatch' };
  }
  try {
    const key = createPublicKey({
      key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
      format: 'jwk',
    });
    const signature = Buffer.from(signatureB64, 'base64url');
    const valid = verify(
      'sha256',
      Buffer.from(`${headerB64}.${payloadB64}`),
      { key, dsaEncoding: 'ieee-p1363' },
      signature,
    );
    return valid ? { valid: true, payload, header } : { valid: false, reason: 'signature_invalid' };
  } catch (err) {
    return { valid: false, reason: `verification_error:${err.message}` };
  }
}

function same(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

function addr(value) {
  return String(value || '').toLowerCase();
}

/**
 * @param {string} url
 * @param {typeof fetch} fetchImpl
 */
async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url, {
    redirect: 'error',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    throw new Error(`http_${res.status}`);
  }
  return res.json();
}

function receiptUrl(id) {
  return `${RECEIPT_ORIGIN}/receipt/${id}?format=json`;
}

/**
 * Public GET /receipt/:id is an unsigned shell. Fail closed on the schema or
 * on unsigned:true, including when a caller stuffed a jws field onto it.
 * @param {unknown} receipt
 */
function isPublicReceiptShell(receipt) {
  if (!receipt || typeof receipt !== 'object') return false;
  if (receipt.schema === 'chit402.receipt_shell.v1') return true;
  if (receipt.unsigned === true) return true;
  return false;
}

/**
 * Test hook for a hermetic CLI. Unset in production runs.
 * @returns {typeof fetch|null}
 */
function fetchFromFixtureEnv() {
  const file = process.env.CHIT_VERIFY_FETCH_FIXTURE;
  if (!file) return null;
  const fixture = JSON.parse(readFileSync(file, 'utf8'));
  const responses = fixture && fixture.responses && typeof fixture.responses === 'object'
    ? fixture.responses
    : {};
  const keys = Object.keys(responses).sort((a, b) => b.length - a.length);
  return async (url) => {
    const target = String(url);
    const key = keys.find((candidate) => target === candidate || target.startsWith(candidate));
    if (!key) throw new Error(`fixture_miss:${target}`);
    const body = responses[key];
    return {
      ok: true,
      status: 200,
      json: async () => body,
    };
  };
}

/**
 * @param {object} specimen
 */
function pendingSpecimen(specimen) {
  return specimen?.chit_receipt_id == null || specimen?.chit_receipt_id === '';
}

/**
 * Read payer, payee, amount, and tx from an issuer JWS.
 * Native chat receipts use payment.* and caller_binding.
 * Foreign payout stamps use chit402.foreign_payout.v1.
 * @param {object} claims
 * @param {object} receipt
 */
function settlementFromIssuerClaims(claims, receipt) {
  const outer = receipt.payment || {};
  if (claims?.schema === 'chit402.foreign_payout.v1') {
    const payee = outer.payee || outer.payTo;
    const payer = outer.payer || receipt.caller_binding?.payer_wallet;
    const txOk = same(claims.payment_ref, outer.ref)
      && same(claims.tx, String(outer.ref || '').replace(/^base:/, ''))
      && same(claims.amount, outer.gross_amount)
      && addr(claims.payer) === addr(payer)
      && addr(claims.payee) === addr(payee)
      && same(claims.task_id, receipt.task_id);
    if (!txOk) return { ok: false, reason: 'signed claims differ from the outer receipt' };
    if (!String(claims.payment_ref || '').startsWith(`${claims.chain}:`)) {
      return { ok: false, reason: 'chain_mismatch' };
    }
    return {
      ok: true,
      fingerprint: claims.agent_record_entry?.fingerprint || null,
      settlement: {
        ref: claims.payment_ref,
        gross_amount: claims.amount,
        payee: claims.payee,
        asset: claims.asset || USDC_BASE,
        payer: claims.payer,
      },
    };
  }
  const payerOk = same(claims?.caller_binding?.payer_wallet, receipt.caller_binding?.payer_wallet);
  const paymentOk = same(claims?.payment?.ref, outer.ref)
    && same(claims?.payment?.gross_amount, outer.gross_amount)
    && addr(claims?.payment?.asset) === addr(outer.asset)
    && addr(claims?.payment?.payee) === addr(outer.payee)
    && same(claims?.task_id, receipt.task_id);
  if (!payerOk || !paymentOk) {
    return { ok: false, reason: 'signed claims differ from the outer receipt' };
  }
  return {
    ok: true,
    fingerprint: claims?.agent_record_entry?.fingerprint || null,
    settlement: {
      ref: claims.payment.ref,
      gross_amount: claims.payment.gross_amount,
      payee: claims.payment.payee,
      asset: claims.payment.asset,
      payer: claims.caller_binding?.payer_wallet,
    },
  };
}

function canonicalReceiptUrl(specimen) {
  const id = specimen?.chit_receipt_id;
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/.test(id)) {
    return null;
  }
  const jsonUrl = receiptUrl(id);
  const bareUrl = `${RECEIPT_ORIGIN}/receipt/${id}`;
  const given = specimen.chit_verify_url;
  // The stamp prints verify_url with no query. Fetch still asks for JSON.
  if (given != null && given !== jsonUrl && given !== bareUrl) return null;
  return jsonUrl;
}

/**
 * @param {object} jwks
 * @param {string} kid
 */
function keyForKid(jwks, kid) {
  const keys = Array.isArray(jwks?.keys) ? jwks.keys : [];
  const jwk = keys.find((key) => key && key.kid === kid && key.kty === 'EC' && key.crv === 'P-256');
  if (!jwk) return { error: `kid_not_in_jwks:${kid}` };
  if (jwkThumbprint(jwk) !== kid) return { error: 'thumbprint_mismatch' };
  return { jwk };
}

/**
 * @param {object} specimen
 * @param {{ fetchImpl?: typeof fetch, rpcUrl?: string }} [opts]
 */
export async function verifyLink(specimen, opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const rpcUrl = opts.rpcUrl || process.env.BASE_RPC_URL || DEFAULT_RPC;
  /** @type {Record<string, {status: string, detail: string}>} */
  const steps = {};

  const url = canonicalReceiptUrl(specimen);
  let receipt = null;
  if (pendingSpecimen(specimen)) {
    steps.fetch_receipt = fail('pending_first_stamp');
  } else if (!url) {
    steps.fetch_receipt = fail('chit_receipt_id or chit_verify_url is not the public receipt URL');
  } else {
    try {
      receipt = await getJson(url, fetchImpl);
      const verifyUrl = String(receipt?.verify_url || '');
      if (isPublicReceiptShell(receipt)) {
        // Since #519 the public route returns an unsigned shell. The issuer JWS,
        // book chain and payment ref are owner-view only, so this tool cannot
        // check them from the public URL. Fail closed. A fake jws field, unsigned:false
        // on the shell schema, or any caller option still fails. Nothing here
        // prints PASS or VERIFIED for the receipt.
        steps.fetch_receipt = fail('public_receipt_is_unsigned_shell (issuer JWS is owner-view only)');
        receipt = null;
      } else if (!verifyUrl.endsWith(`/receipt/${specimen.chit_receipt_id}`)) {
        steps.fetch_receipt = fail('verify_url does not end with chit_receipt_id');
      } else {
        steps.fetch_receipt = pass(url);
      }
    } catch (err) {
      steps.fetch_receipt = fail(err.message || 'fetch_failed');
    }
  }

  let jwks = null;
  /** Signed settlement the on-chain step checks. */
  let settlement = null;
  /** Fingerprint bound inside the issuer JWS, when the stamp included one. */
  let signedFingerprint = null;
  const jwksUri = receipt?.verification?.jwks_uri;
  if (!receipt || steps.fetch_receipt.status !== 'PASS') {
    steps.issuer_signature = fail('receipt_unavailable');
    steps.receipt_chain = fail('receipt_unavailable');
    steps.on_chain_tx = fail('receipt_unavailable');
  } else if (!receipt.issuer_signature?.jws) {
    steps.issuer_signature = fail('issuer_signature_missing');
    steps.receipt_chain = fail('issuer_signature_failed');
    steps.on_chain_tx = fail('issuer_signature_failed');
  } else if (jwksUri != null && jwksUri !== JWKS_URL) {
    steps.issuer_signature = fail(`jwks_uri must be ${JWKS_URL}`);
    steps.receipt_chain = fail('issuer_signature_failed');
    steps.on_chain_tx = fail('issuer_signature_failed');
  } else {
    try {
      jwks = await getJson(JWKS_URL, fetchImpl);
    } catch (err) {
      const detail = `jwks_fetch:${err.message || 'failed'}`;
      steps.issuer_signature = fail(detail);
      steps.receipt_chain = fail(detail);
      steps.on_chain_tx = fail(detail);
    }
  }

  if (jwks && !steps.issuer_signature) {
    const kid = receipt.issuer_signature?.kid;
    const found = keyForKid(jwks, kid);
    if (found.error) {
      steps.issuer_signature = fail(found.error);
    } else {
      const checked = verifyEs256(receipt.issuer_signature?.jws, found.jwk);
      if (!checked.valid) {
        steps.issuer_signature = fail(checked.reason);
      } else {
        const bound = settlementFromIssuerClaims(checked.payload, receipt);
        if (!bound.ok) {
          steps.issuer_signature = fail(bound.reason);
        } else {
          settlement = bound.settlement;
          signedFingerprint = bound.fingerprint;
          steps.issuer_signature = pass(`kid ${kid} iss ${checked.payload.iss || 'chit402'}`);
        }
      }
    }
  }

  if (jwks && receipt && !steps.receipt_chain) {
    const chain = receipt.book_chain;
    const kid = chain?.issuer_signature?.kid;
    const found = keyForKid(jwks, kid);
    if (!chain || found.error) {
      steps.receipt_chain = fail(found.error || 'book_chain_missing');
    } else {
      const checked = verifyEs256(chain.issuer_signature?.jws, found.jwk);
      if (!checked.valid) {
        steps.receipt_chain = fail(checked.reason);
      } else {
        const claims = checked.payload;
        const fields = ['schema', 'payload_version', 'book_id', 'task_id', 'seq', 'prev_hash', 'row_hash', 'event', 'act', 'replay_of', 'payment_ref'];
        const mismatch = fields.find((field) => !same(claims[field], chain[field]));
        const recomputed = bookRowHash(chain);
        const seq = Number(chain.seq);
        const headOk = seq === 1 ? chain.prev_hash == null : /^[0-9a-f]{64}$/.test(String(chain.prev_hash || ''));
        const refOk = settlement && same(claims.payment_ref, settlement.ref);
        if (mismatch) {
          steps.receipt_chain = fail(`claim_mismatch:${mismatch}`);
        } else if (recomputed !== claims.row_hash) {
          steps.receipt_chain = fail('row_hash_mismatch');
        } else if (!headOk) {
          steps.receipt_chain = fail('prev_hash_not_a_chain_link');
        } else if (receipt.book_seq != null && !same(receipt.book_seq, chain.seq)) {
          steps.receipt_chain = fail('book_seq_mismatch');
        } else if (!refOk) {
          steps.receipt_chain = fail(settlement ? 'payment_ref_mismatch' : 'issuer_signature_failed');
        } else {
          const prev = chain.prev_hash == null ? 'null' : chain.prev_hash;
          steps.receipt_chain = pass(`seq ${chain.seq} prev_hash ${prev} row_hash ${chain.row_hash}`);
        }
      }
    }
  }

  if (receipt && !steps.on_chain_tx) {
    if (!settlement) {
      steps.on_chain_tx = fail('issuer_signature_failed');
    } else if (specimen?.payout_tx && !same(`base:${specimen.payout_tx}`, settlement.ref)) {
      steps.on_chain_tx = fail('payout_tx_mismatch');
    } else {
      steps.on_chain_tx = await checkBaseTransfer(settlement, rpcUrl, fetchImpl);
    }
  }

  steps.entry_fingerprint = await checkFingerprint(specimen, fetchImpl, signedFingerprint);

  const verdict = STEPS.every((name) => steps[name]?.status === 'PASS') ? 'PASS' : 'FAIL';
  return { steps, verdict };
}

/**
 * @param {object} payment signed payment claims
 * @param {string} rpcUrl
 * @param {typeof fetch} fetchImpl
 */
async function checkBaseTransfer(settlement, rpcUrl, fetchImpl) {
  const ref = String(settlement?.ref || '');
  const match = /^base:(0x[0-9a-fA-F]{64})$/.exec(ref);
  if (!match) return fail(`payment.ref is not a Base tx: ${ref}`);
  const txHash = match[1];
  let rpc;
  try {
    rpc = new URL(rpcUrl);
  } catch {
    return fail('rpc_url_invalid');
  }
  if (rpc.protocol !== 'https:') return fail('rpc_url_must_be_https');

  let body;
  try {
    const res = await fetchImpl(rpcUrl, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getTransactionReceipt',
        params: [txHash],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return fail(`rpc_http_${res.status}`);
    body = await res.json();
  } catch (err) {
    return fail(`rpc:${err.message || 'failed'}`);
  }
  if (body?.error) return fail(`rpc:${body.error.message || 'error'}`);
  const tx = body?.result;
  if (!tx) return fail('tx_not_found');
  if (tx.status !== '0x1') return fail(`tx_status:${tx.status}`);

  const payer = addr(settlement.payer);
  const payee = addr(settlement.payee);
  const asset = addr(settlement.asset);
  if (asset !== USDC_BASE) return fail(`asset_mismatch:${settlement.asset}`);
  let expected;
  try {
    expected = BigInt(String(settlement.gross_amount));
  } catch {
    return fail('gross_amount_invalid');
  }
  if (expected <= 0n) return fail('gross_amount_invalid');

  let moved = 0n;
  for (const log of tx.logs || []) {
    if (addr(log.address) !== USDC_BASE) continue;
    const topics = log.topics || [];
    if (addr(topics[0]) !== TRANSFER_TOPIC || topics.length < 3) continue;
    const from = `0x${String(topics[1]).slice(-40)}`.toLowerCase();
    const to = `0x${String(topics[2]).slice(-40)}`.toLowerCase();
    if (from !== payer || to !== payee) continue;
    moved += BigInt(log.data || '0x0');
  }
  if (moved < expected) {
    return fail(`transfer ${moved} < gross_amount ${expected}`);
  }
  return pass(`${txHash} USDC ${expected} payer ${settlement.payer} payee ${settlement.payee}`);
}

/**
 * @param {object} specimen
 * @param {typeof fetch} fetchImpl
 */
async function checkFingerprint(specimen, fetchImpl, signedFingerprint = null) {
  const link = specimen?.agent_record_entry;
  const entry = specimen?.entry;
  if (!link || typeof link !== 'object') return fail('fingerprint_absent');
  if (link.registry !== '1f916' || entry?.registry !== '1f916') return fail('registry_must_be_1f916');
  if (link.signed !== false) return fail('agent_record_entry.signed must be false');
  if (link.fingerprint_alg !== '1f916-entry-hash') {
    return fail(`unsupported fingerprint_alg:${link.fingerprint_alg}`);
  }
  const fingerprint = link.fingerprint;
  if (fingerprint == null || fingerprint === '') return fail('fingerprint_absent');
  if (typeof fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(fingerprint)) {
    return fail('fingerprint_malformed');
  }
  const handle = entry?.handle;
  const eventId = Number(entry?.event_id);
  if (typeof handle !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(handle)) {
    return fail('entry.handle_invalid');
  }
  if (!Number.isInteger(eventId) || eventId < 1) return fail('entry.event_id_invalid');
  if (entry.log !== 'identity_events') return fail('entry.log must be identity_events');

  let found = null;
  let since = null;
  const seen = new Set();
  try {
    for (let page = 0; page < 20 && !found; page += 1) {
      const recordUrl = new URL(`/api/record/${encodeURIComponent(handle)}`, RECORD_ORIGIN);
      if (since != null) recordUrl.searchParams.set('events_since', String(since));
      const body = await getJson(recordUrl, fetchImpl);
      const events = Array.isArray(body?.events) ? body.events : [];
      found = events.find((row) => Number(row?.id) === eventId) || null;
      if (found || !body?.events_has_more) break;
      const cursor = body.next_events_since ?? events[events.length - 1]?.id ?? null;
      if (cursor == null || seen.has(String(cursor))) break;
      seen.add(String(cursor));
      since = cursor;
    }
  } catch (err) {
    return fail(`record_fetch:${err.message || 'failed'}`);
  }
  if (!found) return fail(`entry_not_found:${handle} event ${eventId}`);
  if (entry.kind != null && found.kind !== entry.kind) {
    return fail(`kind_mismatch:${found.kind}`);
  }
  const published = String(found.hash || '').toLowerCase();
  if (published !== fingerprint) {
    return fail(`fingerprint_mismatch event ${eventId} published ${published} claimed ${fingerprint}`);
  }
  if (signedFingerprint && String(signedFingerprint).toLowerCase() !== published) {
    return fail(`fingerprint_mismatch event ${eventId} jws ${signedFingerprint} published ${published}`);
  }
  return pass(`event ${eventId} ${fingerprint}`);
}

/**
 * @param {{ steps: Record<string, {status: string, detail: string}>, verdict: string }} result
 */
export function formatReport(result) {
  const lines = STEPS.map((name) => {
    const row = result.steps[name] || { status: 'FAIL', detail: 'missing' };
    return `${row.status} ${name.padEnd(20)} ${row.detail}`;
  });
  lines.push(`VERDICT ${result.verdict}`);
  return lines.join('\n');
}

/**
 * @param {string} target file path or https://www.chit402.com/specimens/*.json
 * @param {typeof fetch} [fetchImpl]
 */
export async function loadSpecimen(target, fetchImpl = fetch) {
  if (/^https:\/\//i.test(target)) {
    const url = new URL(target);
    if (url.origin !== SPECIMEN_ORIGIN || !url.pathname.startsWith('/specimens/') || !url.pathname.endsWith('.json') || url.search || url.username) {
      throw new Error('specimen URL must be https://www.chit402.com/specimens/*.json');
    }
    return getJson(url, fetchImpl);
  }
  return JSON.parse(readFileSync(target, 'utf8'));
}

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('usage: node scripts/verify-1f916-link.mjs <specimen.json | https://www.chit402.com/specimens/1f916-link-1.json>');
    process.exit(2);
  }
  let specimen;
  try {
    specimen = await loadSpecimen(target);
  } catch (err) {
    console.log(`FAIL specimen            ${err.message || 'unreadable'}`);
    console.log('VERDICT FAIL');
    process.exit(1);
  }
  const fetchImpl = fetchFromFixtureEnv();
  const result = await verifyLink(specimen, fetchImpl ? { fetchImpl } : {});
  console.log(formatReport(result));
  process.exit(result.verdict === 'PASS' ? 0 : 1);
}

const invoked = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invoked) {
  main().catch((err) => {
    console.log(`FAIL specimen            ${err.message || 'failed'}`);
    console.log('VERDICT FAIL');
    process.exit(1);
  });
}
