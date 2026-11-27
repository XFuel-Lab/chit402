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

function isJsonInteger(value) {
  return typeof value === 'number' && Number.isInteger(value) && !Object.is(value, -0) && value >= 0;
}

/** Filled at the signing ceremony with the first finalized Anchored hourStart. */
const PINNED_GENESIS = null;
const MAINNET_CHAIN_ID = 8453;
const MAINNET_ADDRESS = '0xc16010f028a00a3addb37609c38d010ec1df93b1';
const MAINNET_CODEHASH = '0xbaad531853ab89c65eeddee489d0290f41a623f785ded9855e80aefee9fb087f';
const MAINNET_PREDECESSOR = '0x0000000000000000000000000000000000000000';
const MAINNET_CHECKPOINT = '0x7a8d6426e1057535a5442ba526ec9f317a9d9026';

function jwkThumbprint(jwk) {
  return createHash('sha256').update(JSON.stringify({
    crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y,
  })).digest('base64url');
}

function loadSealedV2() {
  return readJson(new URL('issuer-history.v2.snapshot.json', here));
}

function productionKey(sealed) {
  for (const entry of sealed.entries || []) {
    if (entry?.jwk && jwkThumbprint(entry.jwk) === PROD_KID) return { ...entry.jwk, kid: PROD_KID };
  }
  return null;
}

function entriesCover(base, doc) {
  const left = Array.isArray(base?.entries) ? base.entries : [];
  const right = Array.isArray(doc?.entries) ? doc.entries : [];
  if (!left.length || right.length < left.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (!left[i]?.entry_hash || right[i]?.entry_hash !== left[i].entry_hash) return false;
  }
  return true;
}

function sameJson(left, right) {
  try {
    return jcs(left) === jcs(right);
  } catch {
    return false;
  }
}

function checkDocument(doc, sealed, { expectGenesis, testSigner }) {
  if (!entriesCover(sealed, doc)) fail('issuer-history entries do not extend the sealed snapshot');
  const payload = signedPayload(doc);
  const list = payload && Object.prototype.hasOwnProperty.call(payload, 'contracts') ? payload.contracts : undefined;
  if (!Array.isArray(list) || list.length === 0) fail('issuer-history contracts[] is missing');
  if (!Object.prototype.hasOwnProperty.call(doc, 'contracts') || !sameJson(doc.contracts, list)) {
    fail('issuer-history contracts[] does not match the signed payload');
  }
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || !isJsonInteger(item.genesisHourStart)) {
      fail('issuer-history genesisHourStart is not an integer');
    }
  }
  const parsed = decide.contractsFromPayload(payload);
  if (!parsed.ok) fail(`issuer-history contracts[]: ${parsed.reason}`);
  for (const pin of parsed.pins) {
    if (pin.codeHash !== MAINNET_CODEHASH) fail('issuer-history code hash is not the mainnet runtime');
  }
  if (parsed.pins.length !== 1) fail('issuer-history contracts[] must be the one mainnet anchor');
  const pin = parsed.pins[0];
  if (pin.chainId !== MAINNET_CHAIN_ID) fail('issuer-history chainId is not 8453');
  if (pin.address !== MAINNET_ADDRESS) fail('issuer-history address is not the mainnet anchor');
  if (pin.predecessor !== MAINNET_PREDECESSOR) fail('issuer-history predecessor is not the zero address');
  if (pin.checkpoint !== MAINNET_CHECKPOINT) fail('issuer-history checkpoint is not the pinned checkpoint');
  if (pin.retireHourStart !== null) fail('issuer-history retireHourStart is not null');
  const versions = pin.checkpointVersions ?? [1];
  if (versions.length !== 1 || versions[0] !== 1) fail('issuer-history checkpointVersions is not [1]');
  if (!isJsonInteger(expectGenesis)) fail('issuer-history genesisHourStart is not set');
  if (pin.genesisHourStart !== expectGenesis) fail('issuer-history genesisHourStart does not match the expected hour');
  const sealedVersion = Number(sealed.version);
  const sealedSeq = Number(sealed.seq);
  const version = doc.version;
  const seq = doc.seq;
  if (!Number.isInteger(version) || !Number.isInteger(seq) || !(version > sealedVersion && seq > sealedSeq)) {
    fail('issuer-history version/seq did not increase');
  }
  if (Number(payload.version) !== version || Number(payload.seq) !== seq) {
    fail('issuer-history version/seq did not increase');
  }
  if (testSigner) {
    const kid = headerKid(doc);
    const embedded = doc.issuer_signature?.issuer_jwk;
    if (!kid || !embedded) fail('issuer-history snapshot is test-signed');
    const verified = historyMod.verifyIssuerHistoryDocument(doc, {
      trustedKids: [kid],
      jwks: { keys: [{ ...embedded, kid }] },
    });
    if (!verified.valid) fail('issuer-history snapshot is test-signed');
  } else {
    const key = productionKey(sealed);
    if (!key) fail('issuer-history snapshot is test-signed');
    const kid = headerKid(doc);
    if (kid !== PROD_KID) fail('issuer-history kid is not the production issuer key');
    const verified = historyMod.verifyIssuerHistoryDocument(doc, {
      trustedKids: [PROD_KID],
      jwks: { keys: [key] },
    });
    if (!verified.valid) fail('issuer-history snapshot is test-signed');
  }
  console.log(`issuer-history ok: ${parsed.pins.length} contract, version ${version} seq ${seq}`);
}

function parseCheckArgs(argv) {
  let file = null;
  let genesis = null;
  let testSigner = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--expect-genesis') {
      genesis = argv[i + 1];
      i += 1;
      if (genesis == null) fail('issuer-history genesisHourStart is not set');
    } else if (arg === '--test-signer') {
      testSigner = true;
    } else if (!arg.startsWith('-')) {
      file = arg;
    } else {
      fail(`unknown argument ${arg}`);
    }
  }
  const expectGenesis = genesis == null ? PINNED_GENESIS : Number(genesis);
  return { file, expectGenesis, testSigner };
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
  const head = Array.isArray(doc.entries) && doc.entries.length ? doc.entries[doc.entries.length - 1].entry_hash : null;
  if (doc.head_hash != null && doc.head_hash !== head) fail('issuer-history head_hash does not match the last entry');
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
  const parsedArgs = parseCheckArgs(args);
  const file = parsedArgs.file || new URL('issuer-history.snapshot.json', here);
  checkDocument(readJson(file), loadSealedV2(), parsedArgs);
} else {
  console.error('usage: issuer-history.mjs signing-input|assemble|check ...');
  process.exit(2);
}
