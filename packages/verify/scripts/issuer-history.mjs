#!/usr/bin/env node
/**
 * Issuer-history helper for the 0.5.0 signing ceremony. No network.
 *
 *   node scripts/issuer-history.mjs signing-input <doc.json> <kid>
 *       Prints the compact JWS signing input. The header is the issuer-history
 *       JWS header (alg, typ, kid). The payload is JCS (sorted keys, no
 *       insignificant whitespace) of the signed claims: schema, payload_version,
 *       entry_count, head_hash, version, seq, and contracts when the document
 *       carries them. issuer_signature is not part of the claims.
 *   node scripts/issuer-history.mjs assemble <doc.json> <kid> <signature-b64url> <out.json>
 *       Writes the document with issuer_signature set, and prints its sha256.
 *   node scripts/issuer-history.mjs check [doc.json]
 *       Publish check. Exits 1 unless the document is a production-signed
 *       contracts-bearing snapshot whose version and seq are past the bundled
 *       snapshot, every contract has an integer genesisHourStart and a
 *       post-hardening code hash, and the file is not a live extension that
 *       adds contracts. The bundled snapshot fails this check until the
 *       ceremony replaces it. Dummy test keys are not the production key.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = new URL('..', import.meta.url);
const historyMod = require('../dist/issuer-history.js');
const decide = require('../dist/v13/core/decide.js');
const windows = require('../dist/version-windows.js');

const PROD_KID = windows.VERSION_WINDOWS_PRODUCTION_KID;
const POST_HARDENING_RUNTIME_HASHES = decide.POST_HARDENING_RUNTIME_HASHES;
const TYP = 'chit402-issuer-history+jwt';

function jcs(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(jcs).join(',')}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${jcs(value[k])}`).join(',')}}`;
}

function b64json(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function unsigned(doc) {
  const copy = { ...doc };
  delete copy.issuer_signature;
  return copy;
}

function claimsFrom(doc) {
  const body = unsigned(doc);
  const entries = Array.isArray(body.entries) ? body.entries : [];
  const head = entries.length ? entries[entries.length - 1].entry_hash : body.head_hash;
  const claims = {
    schema: body.schema,
    payload_version: body.payload_version ?? 1,
    entry_count: entries.length,
    head_hash: head,
  };
  if (body.version != null) claims.version = body.version;
  if (body.seq != null) claims.seq = body.seq;
  if (Object.prototype.hasOwnProperty.call(body, 'contracts')) claims.contracts = body.contracts;
  return claims;
}

function signingInput(doc, kid) {
  const header = { alg: 'ES256', typ: TYP, kid };
  const payload = jcs(claimsFrom(doc));
  return `${b64json(header)}.${Buffer.from(payload, 'utf8').toString('base64url')}`;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readJson(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    fail(`issuer-history unreadable: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    fail('issuer-history unreadable');
  }
  return null;
}

function signedPayload(doc) {
  const jws = doc?.issuer_signature?.jws;
  if (typeof jws !== 'string') return null;
  const part = jws.split('.')[1];
  if (!part) return null;
  try {
    const parsed = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function headerKid(doc) {
  const jws = doc?.issuer_signature?.jws;
  if (typeof jws === 'string') {
    const part = jws.split('.')[0];
    try {
      const header = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
      if (header && typeof header.kid === 'string' && header.kid) return header.kid;
    } catch {
      /* fall through to the outer kid */
    }
  }
  return typeof doc?.issuer_signature?.kid === 'string' ? doc.issuer_signature.kid : null;
}

function signedContractList(doc) {
  const payload = signedPayload(doc);
  if (!payload || !Object.prototype.hasOwnProperty.call(payload, 'contracts')) return undefined;
  return payload.contracts;
}

function signedPayloadHasContracts(doc) {
  const payload = signedPayload(doc);
  return !!(payload && Object.prototype.hasOwnProperty.call(payload, 'contracts'));
}

function entryPrefixExtended(base, doc) {
  const left = Array.isArray(base?.entries) ? base.entries : [];
  const right = Array.isArray(doc?.entries) ? doc.entries : [];
  if (right.length <= left.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (!left[i] || !left[i].entry_hash || !right[i] || right[i].entry_hash !== left[i].entry_hash) return false;
  }
  return true;
}

function isJsonInteger(value) {
  return typeof value === 'number' && Number.isInteger(value) && !Object.is(value, -0) && value >= 0;
}

function postHardening(codeHash) {
  const hash = String(codeHash || '').toLowerCase();
  return POST_HARDENING_RUNTIME_HASHES.some((item) => item.toLowerCase() === hash);
}

function loadBundled() {
  return readJson(new URL('issuer-history.snapshot.json', here));
}

function productionKeys(bundled) {
  return (bundled.entries || [])
    .filter((entry) => entry && entry.kid === PROD_KID && entry.jwk)
    .map((entry) => ({ ...entry.jwk, kid: entry.kid }));
}

function checkDocument(doc, bundled) {
  if (entryPrefixExtended(bundled, doc) && signedPayloadHasContracts(doc)) {
    fail('a live extension adds contracts');
  }
  const list = signedContractList(doc);
  if (!Array.isArray(list) || list.length === 0) fail('issuer-history contracts[] is missing');
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || !isJsonInteger(item.genesisHourStart)) {
      fail('issuer-history genesisHourStart is not an integer');
    }
  }
  const payload = signedPayload(doc);
  const parsed = decide.contractsFromPayload(payload);
  if (!parsed.ok) fail(`issuer-history contracts[]: ${parsed.reason}`);
  for (const pin of parsed.pins) {
    if (!postHardening(pin.codeHash)) fail('issuer-history code hash is not a post-hardening runtime');
  }
  const bundledVersion = Number(bundled.version);
  const bundledSeq = Number(bundled.seq);
  const version = doc.version;
  const seq = doc.seq;
  if (!Number.isInteger(version) || !Number.isInteger(seq) || !(version > bundledVersion && seq > bundledSeq)) {
    fail('issuer-history version/seq did not increase');
  }
  const kid = headerKid(doc);
  if (kid !== PROD_KID) fail('issuer-history kid is not the production issuer key');
  const verified = historyMod.verifyIssuerHistoryDocument(doc, {
    trustedKids: [PROD_KID],
    jwks: { keys: productionKeys(bundled) },
  });
  if (!verified.valid) fail('issuer-history snapshot is test-signed');
  console.log(`issuer-history ok: production-signed, ${parsed.pins.length} contracts, version ${version} seq ${seq}`);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'signing-input') {
  const [file, kid] = args;
  if (!file || !kid) fail('usage: issuer-history.mjs signing-input <doc.json> <kid>');
  process.stdout.write(signingInput(readJson(file), kid));
} else if (cmd === 'assemble') {
  const [file, kid, sig, out] = args;
  if (!file || !kid || !sig || !out) fail('usage: issuer-history.mjs assemble <doc.json> <kid> <signature-b64url> <out.json>');
  const doc = unsigned(readJson(file));
  if (!/^[A-Za-z0-9_-]{86}$/.test(sig)) fail('signature must be 64 bytes base64url');
  const entry = (doc.entries || []).find((item) => item && item.kid === kid);
  doc.issuer_signature = {
    alg: 'ES256',
    typ: TYP,
    payload_version: doc.payload_version ?? 1,
    jws: `${signingInput(doc, kid)}.${sig}`,
    kid,
  };
  if (entry?.jwk) doc.issuer_signature.issuer_jwk = entry.jwk;
  const bytes = `${JSON.stringify(doc, null, 1)}\n`;
  writeFileSync(out, bytes);
  console.log(createHash('sha256').update(bytes).digest('hex'));
} else if (cmd === 'check') {
  const file = args[0] || new URL('issuer-history.snapshot.json', here);
  checkDocument(readJson(file), loadBundled());
} else {
  console.error('usage: issuer-history.mjs signing-input|assemble|check ...');
  process.exit(2);
}
