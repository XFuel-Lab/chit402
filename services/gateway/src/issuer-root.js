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
import { fileURLToPath } from 'url';
import { Interface, getAddress, zeroPadValue, toBeHex } from 'ethers';
import logger from './logger.js';
import { computeJwkThumbprint, getIssuerKid, getIssuerPublicKeyJwk, signJws } from './issuer-key.js';
import {
  LEGACY_SET_SCHEMA,
  legacyProofFromArtifact,
  legacyRootHex,
  legacyUniverseId,
  sortPayloadHashes,
} from './legacy-receipt-merkle.js';

const ARTIFACT_PATH = fileURLToPath(new URL('../abi/ChitIssuerRoot.json', import.meta.url));
const CHIT_ISSUER_ROOT_ARTIFACT = JSON.parse(fs.readFileSync(ARTIFACT_PATH, 'utf8'));
if (!Array.isArray(CHIT_ISSUER_ROOT_ARTIFACT.abi)) {
  throw new Error('ChitIssuerRoot artifact is missing abi');
}
const CHIT_ISSUER_ROOT = new Interface(CHIT_ISSUER_ROOT_ARTIFACT.abi);

/** Topic hash of every event in the artifact. Not a hand-written signature. */
export const EVENT_TOPICS = Object.fromEntries(
  CHIT_ISSUER_ROOT.fragments
    .filter((fragment) => fragment.type === 'event')
    .map((fragment) => [fragment.name, fragment.topicHash]),
);
for (const name of ['RootCommitted', 'Frozen', 'GenesisSeeded', 'KeyActivated', 'KeyRetired', 'KeyRevoked', 'KeyStandby', 'Superseded']) {
  if (!EVENT_TOPICS[name]) throw new Error(`ChitIssuerRoot artifact has no event ${name}`);
}

export const ISSUER_ROOT_PAYLOAD_VERSION = 11;
export const DEFAULT_ISSUER_ROOT_CHAIN_ID = 'eip155:84532';
export const ISSUER_ROOT_SCHEMA_VERSION = 1;
export const FREEZE_SCHEMA = 'chit402.freeze.v1';
export const FREEZE_JWT_TYP = 'chit402-freeze+jwt';
export const SKIP_ACK = 'I_UNDERSTAND';
export const SKIP_LOG = 'ISSUER_ROOT_STARTUP_CHECK=skip: chain finality was NOT checked. ISSUER_ROOT_ALLOW_SKIP=I_UNDERSTAND is set. Do not use this on a host that issues receipts.';
export const REFUSAL_SCHEMA_V2 = 'chit402.refusal.v2';
export const REFUSAL_PAYLOAD_VERSION_V2 = 3;

export const ROOT_COMMITTED_TOPIC = EVENT_TOPICS.RootCommitted;
export const FROZEN_TOPIC = EVENT_TOPICS.Frozen;
export const GENESIS_SEEDED_TOPIC = EVENT_TOPICS.GenesisSeeded;
export const KEY_ACTIVATED_TOPIC = EVENT_TOPICS.KeyActivated;

/** Facts from the startup Frozen-log check. Request handlers do not read the chain. */
const startupState = {
  verified: false,
  skipped: false,
  freezes: new Map(),
  legacyFrozen: null,
};

export function _resetIssuerRootStartupState() {
  startupState.verified = false;
  startupState.skipped = false;
  startupState.freezes = new Map();
  startupState.legacyFrozen = null;
}

const HEX_32 = /^0x[0-9a-f]{64}$/;

export class IssuancePausedError extends Error {
  constructor() {
    super('Issuance is paused. v11 starts only after a strict startup check, with the legacy snapshot Merkle root and count equal to the Frozen log for legacy_receipts_pre_v11. skip does not sign.');
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
  const rpcUrl2 = String(process.env.ISSUER_ROOT_RPC_URL_2 || '').trim() || null;
  const rpcUrls = [rpcUrl, rpcUrl2].filter((url, index, all) => url && all.indexOf(url) === index);
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
    rpcUrl2,
    rpcUrls,
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
 * A written legacy_receipts_pre_v11 artifact. Missing, unreadable, or the
 * wrong schema means the snapshot does not exist yet.
 */
export function legacySnapshotReady() {
  const file = readIssuerRootConfig().legacySetFile;
  if (!file || !fs.existsSync(file)) return false;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed?.schema === LEGACY_SET_SCHEMA
      && typeof parsed.universe_id === 'string'
      && parsed.universe_id.length > 0
      && Number.isInteger(parsed.enumerated_count)
      && parsed.enumerated_count >= 0;
  } catch {
    return false;
  }
}

/**
 * Recompute the legacy Merkle root and count from the artifact leaves.
 * The file's own root field is not trusted.
 */
export function recomputeLegacyCommitment(parsed) {
  if (!parsed || parsed.schema !== LEGACY_SET_SCHEMA) return null;
  const universeId = String(parsed.universe_id || '').toLowerCase().replace(/^0x/, '');
  if (universeId !== legacyUniverseId()) return null;
  const hashes = (Array.isArray(parsed.leaves) ? parsed.leaves : []).map((leaf) => leaf?.payload_hash);
  let sorted;
  try {
    sorted = sortPayloadHashes(hashes);
  } catch {
    return null;
  }
  return { universeId, root: legacyRootHex(sorted), count: sorted.length };
}

/**
 * The on-disk legacy set matches the Frozen log captured at strict startup.
 * skip never matches. A file whose leaves do not hash to that log stays paused.
 */
export function legacyFreezeMatches() {
  const cfg = readIssuerRootConfig();
  if (cfg.startupCheck === 'skip' || startupState.skipped || !startupState.verified) return false;
  if (cfg.chainNumeric === 8453 && cfg.startupCheck !== 'strict') return false;
  const chain = startupState.legacyFrozen;
  if (!chain || !cfg.legacySetFile) return false;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(cfg.legacySetFile, 'utf8'));
  } catch {
    return false;
  }
  const local = recomputeLegacyCommitment(parsed);
  if (!local) return false;
  return local.root === chain.universeHash
    && local.count === chain.enumeratedCount
    && local.universeId === chain.universeId;
}

/**
 * Explicit pause, a missing legacy snapshot, skip, or a snapshot that does
 * not match the Frozen log. A partial root config does not resume as v10.
 */
export function isCutoverPaused() {
  const cfg = readIssuerRootConfig();
  if (cfg.cutover === 'pause' && !cfg.ready) return true;
  if (!cfg.enabled || !cfg.ready) return false;
  if (!legacySnapshotReady()) return true;
  if (cfg.startupCheck === 'skip' || startupState.skipped) return true;
  if (!legacyFreezeMatches()) return true;
  return false;
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
  if (cfg.enabled && cfg.ready && !legacySnapshotReady()) throw new IssuancePausedError();
  if (cfg.enabled && cfg.ready && (cfg.startupCheck === 'skip' || startupState.skipped)) {
    throw new IssuancePausedError();
  }
  if (cfg.enabled && cfg.ready && !legacyFreezeMatches()) throw new IssuancePausedError();
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

function hexQty(value) {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  return Number.NaN;
}

function normHash(value) {
  const text = String(value || '').trim().toLowerCase();
  const hex = text.startsWith('0x') ? text : `0x${text}`;
  return HEX_32.test(hex) ? hex : null;
}

/**
 * Finalized block plus the RootCommitted log, from one RPC.
 * The log query uses the block number, not the tag, so both RPCs are
 * asked for the same height.
 */
async function readFinalizedCommit(url, cfg, fetchImpl) {
  const chainNum = hexQty(await rpcCall(url, 'eth_chainId', [], fetchImpl));
  if (chainNum !== cfg.chainNumeric) {
    throw new Error(`issuer root rpc chain ${chainNum} does not match ${cfg.chainId}`);
  }
  const block = await rpcCall(url, 'eth_getBlockByNumber', ['finalized', false], fetchImpl);
  const blockNumber = hexQty(block?.number);
  const blockHash = normHash(block?.hash);
  if (!Number.isInteger(blockNumber) || blockNumber < 0 || !blockHash) {
    throw new Error('issuer root rpc returned no finalized block');
  }
  const topic1 = zeroPadValue(toBeHex(cfg.seq), 32);
  const logs = await rpcCall(url, 'eth_getLogs', [{
    address: cfg.registry,
    topics: [ROOT_COMMITTED_TOPIC, topic1],
    fromBlock: '0x0',
    toBlock: toBeHex(blockNumber),
  }], fetchImpl);
  if (!Array.isArray(logs) || logs.length !== 1) {
    throw new Error(`issuer root seq ${cfg.seq} is not a single finalized RootCommitted log`);
  }
  const log = logs[0];
  const parsed = CHIT_ISSUER_ROOT.parseLog({ topics: log.topics, data: log.data });
  const rootHash = normHash(parsed.args.rootHash);
  const logBlock = hexQty(log.blockNumber);
  if (!rootHash || !Number.isInteger(logBlock)) {
    throw new Error('issuer root log is missing rootHash or blockNumber');
  }
  if (logBlock > blockNumber) {
    throw new Error('issuer root log is after the finalized block');
  }
  return { blockNumber, blockHash, rootHash, logBlock, data: String(log.data).toLowerCase() };
}

/**
 * Two RPCs must agree on the finalized block and on the commit log.
 * Called only from startup. Signing does not call this.
 */
export async function assertFinalizedCommit(cfg, fetchImpl) {
  if (!cfg.rpcUrls || cfg.rpcUrls.length < 2) {
    throw new Error('ISSUER_ROOT_STARTUP_CHECK=strict needs two independent RPCs: ISSUER_ROOT_RPC_URL and ISSUER_ROOT_RPC_URL_2');
  }
  const reads = [];
  for (const url of cfg.rpcUrls) {
    reads.push(await readFinalizedCommit(url, cfg, fetchImpl));
  }
  const [left, right] = reads;
  if (left.blockNumber !== right.blockNumber || left.blockHash !== right.blockHash) {
    throw new Error('issuer root RPCs disagree on the finalized block');
  }
  if (left.rootHash !== right.rootHash || left.logBlock !== right.logBlock || left.data !== right.data) {
    throw new Error('issuer root RPCs disagree on the RootCommitted log');
  }
  if (left.rootHash !== cfg.hash) {
    throw new Error(`issuer root hash mismatch at seq ${cfg.seq}`);
  }
  return left;
}

function loadFreezeRecords(file) {
  if (!file) return [];
  let parsed;
  try {
    parsed = readJsonFile(file);
  } catch {
    return null;
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.freezes;
  if (!Array.isArray(list)) return null;
  return list;
}

/**
 * Frozen log at the agreed finalized height. blockhash is the hash of the
 * log's own block, which is what freeze_head.blockhash must equal.
 */
async function readFrozen(url, cfg, record, toBlock, fetchImpl) {
  const universeHex = `0x${String(record.universe_id).toLowerCase().replace(/^0x/, '')}`;
  const logs = await rpcCall(url, 'eth_getLogs', [{
    address: cfg.registry,
    topics: [FROZEN_TOPIC, zeroPadValue(universeHex, 32)],
    fromBlock: '0x0',
    toBlock,
  }], fetchImpl);
  if (!Array.isArray(logs) || logs.length !== 1) {
    throw new Error(`freeze ${universeHex} is not a single finalized Frozen log`);
  }
  const log = logs[0];
  const parsed = CHIT_ISSUER_ROOT.parseLog({ topics: log.topics, data: log.data });
  const universeHash = normHash(parsed.args.universeHash);
  const enumeratedCount = hexQty(parsed.args.enumeratedCount);
  const frozenBlock = hexQty(parsed.args.frozenBlock);
  const logBlock = hexQty(log.blockNumber);
  if (!universeHash || !Number.isInteger(enumeratedCount) || !Number.isInteger(frozenBlock) || !Number.isInteger(logBlock)) {
    throw new Error('Frozen log is missing universeHash, enumeratedCount, or frozenBlock');
  }
  if (logBlock !== frozenBlock) {
    throw new Error('Frozen log block does not equal frozenBlock');
  }
  const block = await rpcCall(url, 'eth_getBlockByNumber', [toBeHex(frozenBlock), false], fetchImpl);
  const blockhash = normHash(block?.hash);
  if (!blockhash || hexQty(block?.number) !== frozenBlock) {
    throw new Error('freeze block hash is missing');
  }
  return { universeHash, enumeratedCount, frozenBlock, blockhash, data: String(log.data).toLowerCase() };
}

function freezeFactsMatch(record, chain) {
  return normHash(record.universe_hash) === chain.universeHash
    && record.enumerated_count === chain.enumeratedCount
    && record.freeze_head.frozenBlock === chain.frozenBlock
    && normHash(record.freeze_head.blockhash) === chain.blockhash
    && record.freeze_head.chain_id === readIssuerRootConfig().chainId;
}

async function assertFreezeFile(cfg, finalized, fetchImpl) {
  startupState.freezes = new Map();
  if (!cfg.freezeFile) return;
  const records = loadFreezeRecords(cfg.freezeFile);
  if (records == null) throw new Error('ISSUER_ROOT_FREEZE_FILE is not a freeze list');
  const toBlock = toBeHex(finalized.blockNumber);
  for (const record of records) {
    if (!freezeRecordOk(record)) throw new Error('ISSUER_ROOT_FREEZE_FILE has a malformed freeze');
    const reads = [];
    for (const url of cfg.rpcUrls) {
      reads.push(await readFrozen(url, cfg, record, toBlock, fetchImpl));
    }
    const [left, right] = reads;
    if (left.universeHash !== right.universeHash
      || left.enumeratedCount !== right.enumeratedCount
      || left.frozenBlock !== right.frozenBlock
      || left.blockhash !== right.blockhash
      || left.data !== right.data) {
      throw new Error('issuer root RPCs disagree on a Frozen log');
    }
    if (!freezeFactsMatch(record, left)) {
      throw new Error(`freeze ${record.universe_id} does not match the Frozen log`);
    }
    const id = String(record.universe_id).toLowerCase().replace(/^0x/, '');
    startupState.freezes.set(id, left);
  }
}

/**
 * Frozen log for legacy_receipts_pre_v11. A missing log leaves issuance
 * paused. A disagreement between the two RPCs refuses to start.
 */
async function captureLegacyFrozen(cfg, finalized, fetchImpl) {
  startupState.legacyFrozen = null;
  const record = { universe_id: legacyUniverseId() };
  const toBlock = toBeHex(finalized.blockNumber);
  let left;
  let right;
  try {
    left = await readFrozen(cfg.rpcUrls[0], cfg, record, toBlock, fetchImpl);
    right = await readFrozen(cfg.rpcUrls[1], cfg, record, toBlock, fetchImpl);
  } catch (err) {
    if (/not a single finalized Frozen log/.test(String(err?.message || ''))) return;
    throw err;
  }
  if (left.universeHash !== right.universeHash
    || left.enumeratedCount !== right.enumeratedCount
    || left.frozenBlock !== right.frozenBlock
    || left.blockhash !== right.blockhash
    || left.data !== right.data) {
    throw new Error('issuer root RPCs disagree on the legacy Frozen log');
  }
  startupState.legacyFrozen = { ...left, universeId: legacyUniverseId() };
}

/**
 * Startup gate. No-op when the flag is off.
 * strict (default when enabled) reads two RPCs at the same finalized block.
 * skip reads nothing, and only when ISSUER_ROOT_ALLOW_SKIP=I_UNDERSTAND.
 * An unset issuer key refuses to start either way.
 * @param {{ fetchImpl?: typeof fetch, log?: Function }} [opts]
 */
export async function assertIssuerRootStartup({ fetchImpl = globalThis.fetch, log = null } = {}) {
  const cfg = readIssuerRootConfig();
  startupState.verified = false;
  startupState.skipped = false;
  startupState.freezes = new Map();
  startupState.legacyFrozen = null;
  if (!cfg.enabled) return { checked: false, reason: 'disabled' };
  const problem = configError(cfg);
  if (problem) throw new Error(problem);
  if (cfg.startupCheck === 'skip') {
    if (String(process.env.ISSUER_ROOT_ALLOW_SKIP || '').trim() !== SKIP_ACK) {
      throw new Error('ISSUER_ROOT_STARTUP_CHECK=skip requires ISSUER_ROOT_ALLOW_SKIP=I_UNDERSTAND');
    }
    const emit = typeof log === 'function' ? log : (fields, message) => logger.error(fields, message);
    emit({
      chainId: cfg.chainId,
      seq: cfg.seq,
      registry: cfg.registry,
    }, SKIP_LOG);
    startupState.skipped = true;
    return { checked: false, reason: 'skip' };
  }
  const finalized = await assertFinalizedCommit(cfg, fetchImpl);
  await assertFreezeFile(cfg, finalized, fetchImpl);
  await captureLegacyFrozen(cfg, finalized, fetchImpl);
  startupState.verified = true;
  return { checked: true, reason: 'finalized', seq: cfg.seq, blockNumber: finalized.blockNumber };
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
 * Signed chit402.freeze.v1, or null when the flag is off, the id is unknown,
 * or the file does not match the Frozen log checked at startup.
 * Signing does not read the chain. A skip startup never verified a log, so
 * it does not sign a freeze document.
 * @param {string} universeId
 */
export function freezeDocumentFor(universeId) {
  if (!issuerRootActive() || !startupState.verified || startupState.skipped) return null;
  const cfg = readIssuerRootConfig();
  if (!cfg.freezeFile) return null;
  const list = loadFreezeRecords(cfg.freezeFile);
  if (!list) return null;
  const row = list.find((item) => sameUniverse(item?.universe_id, universeId));
  if (!row || !freezeRecordOk(row)) return null;
  const id = String(row.universe_id).toLowerCase().replace(/^0x/, '');
  const chain = startupState.freezes.get(id);
  if (!chain || !freezeFactsMatch(row, chain)) return null;
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
