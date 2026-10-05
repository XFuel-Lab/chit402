/**
 * Issuer root config for payload v11.
 *
 * ISSUER_ROOT_ENABLED defaults off. While it is off, receipts stay payload
 * v10, refusals stay chit402.refusal.v1, and issuer history is unchanged.
 *
 * The gateway reads chain state only in assertIssuerRootStartup(), and only
 * when the flag is on and ISSUER_ROOT_STARTUP_CHECK is strict (the default
 * when enabled). Signing never calls an RPC.
 *
 * ISSUER_PRIVATE_KEY stays a base64 PEM in the process environment, which is
 * how AWS Secrets Manager injection already reaches issuer-key.js. The Safe
 * that writes the registry is not this key.
 */
import fs from 'fs';
import { Interface, getAddress, id, zeroPadValue, toBeHex } from 'ethers';
import { computeJwkThumbprint, getIssuerKid, getIssuerPublicKeyJwk, signJws } from './issuer-key.js';
import { legacyProofFromArtifact } from './legacy-receipt-merkle.js';

export const ISSUER_ROOT_PAYLOAD_VERSION = 11;
export const DEFAULT_ISSUER_ROOT_CHAIN_ID = 'eip155:84532';
export const ISSUER_ROOT_SCHEMA_VERSION = 1;
export const FREEZE_SCHEMA = 'chit402.freeze.v1';
export const FREEZE_JWT_TYP = 'chit402-freeze+jwt';
export const REFUSAL_SCHEMA_V2 = 'chit402.refusal.v2';
export const REFUSAL_PAYLOAD_VERSION_V2 = 3;

const ROOT_COMMITTED_ABI = 'event RootCommitted(uint64 indexed rootSeq, bytes32 rootHash, uint64 historyVersion, bytes32 historySnapshot)';
const ROOT_COMMITTED = new Interface([ROOT_COMMITTED_ABI]);
export const ROOT_COMMITTED_TOPIC = id('RootCommitted(uint64,bytes32,uint64,bytes32)');

const HEX_32 = /^0x[0-9a-f]{64}$/;

export class IssuancePausedError extends Error {
  constructor() {
    super('Issuance is paused for the legacy_receipts_pre_v11 cutover. Set ISSUER_ROOT_ENABLED=true with ISSUER_ROOT_SEQ, ISSUER_ROOT_HASH, and ISSUER_ROOT_REGISTRY after the genesis commit finalizes.');
    this.name = 'IssuancePausedError';
    this.code = 'issuer_root_cutover_pause';
  }
}

function blank(value) {
  return value == null || String(value).trim() === '';
}

function chainIdNumber(chainId) {
  if (chainId === 'eip155:84532') return 84532;
  if (chainId === 'eip155:8453') return 8453;
  return null;
}

function parseSeq(raw) {
  if (blank(raw)) return { seq: null, invalid: false };
  if (!/^\d+$/.test(String(raw).trim())) return { seq: null, invalid: true };
  const seq = Number(String(raw).trim());
  if (!Number.isSafeInteger(seq) || seq < 1) return { seq: null, invalid: true };
  return { seq, invalid: false };
}

function parseHash(raw) {
  if (blank(raw)) return { hash: null, invalid: false };
  const text = String(raw).trim().toLowerCase();
  const hex = text.startsWith('0x') ? text : `0x${text}`;
  if (!HEX_32.test(hex)) return { hash: null, invalid: true };
  return { hash: hex, invalid: false };
}

function parseRegistry(raw) {
  if (blank(raw)) return { registry: null, invalid: false };
  try {
    return { registry: getAddress(String(raw).trim()), invalid: false };
  } catch {
    return { registry: null, invalid: true };
  }
}

/**
 * Snapshot of the issuer-root environment. Safe to call on every sign.
 * Does not read the network.
 */
export function readIssuerRootConfig() {
  const enabled = String(process.env.ISSUER_ROOT_ENABLED || '').trim() === 'true';
  const cutoverRaw = String(process.env.ISSUER_ROOT_CUTOVER || 'off').trim().toLowerCase();
  const cutover = cutoverRaw === 'pause' ? 'pause' : 'off';
  const chainExplicit = !blank(process.env.ISSUER_ROOT_CHAIN_ID);
  const chainId = chainExplicit
    ? String(process.env.ISSUER_ROOT_CHAIN_ID).trim()
    : DEFAULT_ISSUER_ROOT_CHAIN_ID;
  const chainNumeric = chainIdNumber(chainId);
  const registry = parseRegistry(process.env.ISSUER_ROOT_REGISTRY);
  const seq = parseSeq(process.env.ISSUER_ROOT_SEQ);
  const hash = parseHash(process.env.ISSUER_ROOT_HASH);
  const checkRaw = String(process.env.ISSUER_ROOT_STARTUP_CHECK || '').trim().toLowerCase();
  let startupCheck;
  if (!checkRaw) startupCheck = enabled ? 'strict' : 'skip';
  else if (checkRaw === 'strict' || checkRaw === 'skip') startupCheck = checkRaw;
  else startupCheck = 'invalid';
  const rpcUrl = String(
    process.env.ISSUER_ROOT_RPC_URL
    || process.env.BASE_RPC_URL
    || process.env.SETTLEMENT_RPC_URL
    || '',
  ).trim() || null;
  const keyConfigured = !blank(process.env.ISSUER_PRIVATE_KEY);
  const ready = enabled
    && chainNumeric != null
    && registry.registry != null
    && !registry.invalid
    && seq.seq != null
    && !seq.invalid
    && hash.hash != null
    && !hash.invalid
    && keyConfigured;
  return {
    enabled,
    cutover,
    chainId,
    chainIdExplicit: chainExplicit,
    chainNumeric,
    registry: registry.registry,
    registryInvalid: registry.invalid,
    seq: seq.seq,
    seqInvalid: seq.invalid,
    hash: hash.hash,
    hashInvalid: hash.invalid,
    startupCheck,
    rpcUrl,
    keyConfigured,
    freezeFile: blank(process.env.ISSUER_ROOT_FREEZE_FILE) ? null : String(process.env.ISSUER_ROOT_FREEZE_FILE).trim(),
    legacySetFile: blank(process.env.ISSUER_ROOT_LEGACY_SET) ? null : String(process.env.ISSUER_ROOT_LEGACY_SET).trim(),
    ready,
  };
}

/** v11 signing is on only when the flag and the finalized root config are both set. */
export function issuerRootActive() {
  return readIssuerRootConfig().ready;
}

/**
 * Pause holds while cutover mode is on and v11 is not ready.
 * v11 resumes once the flag, seq, hash, and registry are all set.
 */
export function isCutoverPaused() {
  const cfg = readIssuerRootConfig();
  return cfg.cutover === 'pause' && !cfg.ready;
}

export function assertIssuanceOpen() {
  const cfg = readIssuerRootConfig();
  if (cfg.cutover === 'pause' && !cfg.ready) throw new IssuancePausedError();
  if (cfg.enabled && !cfg.ready) {
    if (!cfg.keyConfigured) {
      throw new Error('ISSUER_ROOT_ENABLED refuses to issue when ISSUER_PRIVATE_KEY is unset');
    }
    throw new Error('ISSUER_ROOT_ENABLED requires a valid ISSUER_ROOT_CHAIN_ID, ISSUER_ROOT_REGISTRY, ISSUER_ROOT_SEQ (>= 1), and ISSUER_ROOT_HASH');
  }
}

/**
 * Signed issuer_root object. `kid` is the signing key's thumbprint.
 * @param {string} kid
 */
export function issuerRootClaim(kid) {
  const cfg = readIssuerRootConfig();
  if (!cfg.ready) {
    throw new Error('issuer_root config is incomplete');
  }
  return {
    v: ISSUER_ROOT_SCHEMA_VERSION,
    chain_id: cfg.chainId,
    registry: cfg.registry,
    root_seq: cfg.seq,
    root_hash: cfg.hash,
    kid,
  };
}

/**
 * issuer_root.kid == JWS kid == thumbprint(issuer_jwk).
 * No-op when the flag is off and the claim is absent.
 */
export function bindIssuerRoot(claims, kid, jwk) {
  const active = issuerRootActive();
  const claim = claims?.issuer_root;
  if (!active) {
    if (claim) throw new Error('issuer_root is set while ISSUER_ROOT_ENABLED is off');
    return;
  }
  if (!claim || typeof claim !== 'object') throw new Error('issuer_root missing from signed claims');
  const thumb = computeJwkThumbprint(jwk);
  if (claim.kid !== kid || kid !== thumb || claim.kid !== thumb) {
    throw new Error('issuer_root.kid must equal the JWS kid and the issuer_jwk thumbprint');
  }
}

function configError(cfg) {
  if (!cfg.enabled) return null;
  if (cfg.startupCheck === 'invalid') return 'ISSUER_ROOT_STARTUP_CHECK must be strict or skip';
  if (cfg.chainNumeric == null) {
    return 'ISSUER_ROOT_CHAIN_ID must be eip155:84532 (default) or eip155:8453 when set explicitly';
  }
  if (cfg.registryInvalid || !cfg.registry) return 'ISSUER_ROOT_REGISTRY must be a 20-byte address';
  if (cfg.seqInvalid || cfg.seq == null) return 'ISSUER_ROOT_SEQ must be an integer >= 1';
  if (cfg.hashInvalid || !cfg.hash) return 'ISSUER_ROOT_HASH must be 32 bytes';
  if (!process.env.ISSUER_PRIVATE_KEY || !String(process.env.ISSUER_PRIVATE_KEY).trim()) {
    return 'ISSUER_ROOT_ENABLED refuses to start when ISSUER_PRIVATE_KEY is unset. An ephemeral issuer key cannot sign v11 receipts.';
  }
  return null;
}

async function rpcCall(url, method, params, fetchImpl) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`issuer root rpc http ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(body.error.message || 'issuer root rpc error');
  return body.result;
}

/**
 * One read of the finalized RootCommitted log for the configured seq.
 * Called only from startup. Signing does not call this.
 */
export async function assertFinalizedCommit(cfg, fetchImpl) {
  if (!cfg.rpcUrl) {
    throw new Error('ISSUER_ROOT_STARTUP_CHECK=strict needs ISSUER_ROOT_RPC_URL, BASE_RPC_URL, or SETTLEMENT_RPC_URL');
  }
  const chainHex = await rpcCall(cfg.rpcUrl, 'eth_chainId', [], fetchImpl);
  const chainNum = Number(chainHex);
  if (chainNum !== cfg.chainNumeric) {
    throw new Error(`issuer root rpc chain ${chainNum} does not match ${cfg.chainId}`);
  }
  const topic1 = zeroPadValue(toBeHex(cfg.seq), 32);
  const logs = await rpcCall(cfg.rpcUrl, 'eth_getLogs', [{
    address: cfg.registry,
    topics: [ROOT_COMMITTED_TOPIC, topic1],
    fromBlock: '0x0',
    toBlock: 'finalized',
  }], fetchImpl);
  if (!Array.isArray(logs) || logs.length !== 1) {
    throw new Error(`issuer root seq ${cfg.seq} is not a single finalized RootCommitted log`);
  }
  const parsed = ROOT_COMMITTED.parseLog({ topics: logs[0].topics, data: logs[0].data });
  const got = String(parsed.args.rootHash).toLowerCase();
  if (got !== cfg.hash) {
    throw new Error(`issuer root hash mismatch at seq ${cfg.seq}`);
  }
}

/**
 * Startup gate. No-op when the flag is off.
 * strict (default when enabled) reads the chain once.
 * skip does not read the chain. Either way, an unset issuer key refuses to start.
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 */
export async function assertIssuerRootStartup({ fetchImpl = globalThis.fetch } = {}) {
  const cfg = readIssuerRootConfig();
  if (!cfg.enabled) return { checked: false, reason: 'disabled' };
  const problem = configError(cfg);
  if (problem) throw new Error(problem);
  if (cfg.startupCheck === 'skip') return { checked: false, reason: 'skip' };
  await assertFinalizedCommit(cfg, fetchImpl);
  return { checked: true, reason: 'finalized', seq: cfg.seq };
}

function readJsonFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  return JSON.parse(text);
}

function sameUniverse(left, right) {
  const a = String(left || '').toLowerCase().replace(/^0x/, '');
  const b = String(right || '').toLowerCase().replace(/^0x/, '');
  return a.length > 0 && a === b;
}

function freezeRecordOk(row) {
  if (!row || typeof row !== 'object') return false;
  const id = String(row.universe_id || '').toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(id)) return false;
  if (typeof row.universe_hash !== 'string' || !HEX_32.test(row.universe_hash.toLowerCase())) return false;
  if (!Number.isInteger(row.enumerated_count) || row.enumerated_count < 0) return false;
  const head = row.freeze_head;
  if (!head || typeof head.chain_id !== 'string' || !head.chain_id) return false;
  if (!Number.isInteger(head.frozenBlock) || head.frozenBlock < 0) return false;
  if (typeof head.blockhash !== 'string' || !HEX_32.test(head.blockhash.toLowerCase())) return false;
  if (typeof row.tx_hash !== 'string' || !HEX_32.test(row.tx_hash.toLowerCase())) return false;
  return true;
}

/**
 * Signed chit402.freeze.v1, or null when the flag is off, the file is
 * missing, or the universe id is unknown. The facts come from the static
 * file. issuer_root comes from this process's config. No RPC.
 * @param {string} universeId
 */
export function freezeDocumentFor(universeId) {
  if (!issuerRootActive()) return null;
  const cfg = readIssuerRootConfig();
  if (!cfg.freezeFile) return null;
  let parsed;
  try {
    parsed = readJsonFile(cfg.freezeFile);
  } catch {
    return null;
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.freezes;
  if (!Array.isArray(list)) return null;
  const row = list.find((item) => sameUniverse(item?.universe_id, universeId));
  if (!row || !freezeRecordOk(row)) return null;
  const kid = getIssuerKid();
  const jwk = getIssuerPublicKeyJwk();
  const claims = {
    schema: FREEZE_SCHEMA,
    universe_id: String(row.universe_id).toLowerCase().replace(/^0x/, ''),
    universe_hash: row.universe_hash.toLowerCase(),
    enumerated_count: row.enumerated_count,
    freeze_head: {
      chain_id: row.freeze_head.chain_id,
      frozenBlock: row.freeze_head.frozenBlock,
      blockhash: row.freeze_head.blockhash.toLowerCase(),
    },
    issuer_root: issuerRootClaim(kid),
    tx_hash: row.tx_hash.toLowerCase(),
  };
  const { jws, kid: signedKid } = signJws(claims, { typ: FREEZE_JWT_TYP });
  bindIssuerRoot(claims, signedKid, jwk);
  return {
    ...claims,
    issuer_signature: {
      alg: 'ES256',
      typ: FREEZE_JWT_TYP,
      jws,
      kid: signedKid,
      issuer_jwk: jwk,
    },
  };
}

/**
 * Merkle inclusion proof for a frozen pre-v11 receipt, or null when the
 * flag is off or the id is not in the artifact. Does not sign.
 * @param {string} taskId
 */
export function legacyProofForReceipt(taskId) {
  if (!issuerRootActive()) return null;
  const cfg = readIssuerRootConfig();
  if (!cfg.legacySetFile) return null;
  let artifact;
  try {
    artifact = readJsonFile(cfg.legacySetFile);
  } catch {
    return null;
  }
  return legacyProofFromArtifact(artifact, taskId);
}
