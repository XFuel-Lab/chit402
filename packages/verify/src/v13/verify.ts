/**
 * Node entry for the v13 path. The decisions live in core/decide.ts.
 * Pins are read only from the bundled snapshot's signed payload.
 * A checkpoint rotation is not consulted and cannot add a trusted sender.
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fetchNoRedirect } from '../fetch-guard.js';
import {
  extensionNarrowsBundle,
  historyPrefixExtends,
  laterThanBundled,
  loadBundledIssuerHistory,
  verifyIssuerHistoryDocument,
  type IssuerHistoryDocument,
} from '../issuer-history.js';
import { jsonRpc } from '../rpc-deadline.js';
import { readTestSnapshot } from '../internal/test-seam.js';
import { DEFAULT_TRUSTED_ISSUER_KIDS } from '../jws.js';
import type { VerifyVerdict } from '../verdict.js';
import { V13_RPC_DEFAULTS } from './rpc-defaults.js';
import {
  ANCHORED_TOPIC0,
  UNAUDITED_NOTE,
  ZERO_ADDRESS,
  anchoredFromLog,
  bytesToHex,
  classifyCanonical,
  firstCovering,
  hexToBytes,
  isExactV13Receipt,
  parseV13Receipt,
  runV13,
  topicUint,
  type AnchoredEvent,
  type LineView,
  type PaymentView,
  type V13History,
  type V13Result,
  type V13World,
} from './core/decide.js';

const LIVE_HISTORY_URL = 'https://api.chit402.com/.well-known/issuer-history.json';

export interface V13Options {
  issuerHistoryBytes?: string | null;
  trustedKids?: readonly string[];
  fetchImpl?: typeof fetch;
  rpcUrl?: string | null;
  rpcUrls?: readonly string[] | null;
  env?: NodeJS.ProcessEnv;
}

type MerkleModule = {
  leafHash: (data: Uint8Array) => { ok: true; hash: Uint8Array } | { ok: false; reason: string };
  verifyInclusion: (
    leaf: string,
    index: number,
    treeSize: number,
    root: string,
    proof: string[],
  ) => { ok: boolean; reason?: string };
};

type LineModule = {
  decodeLine: (value: Uint8Array) => { ok: true; payment: Record<string, unknown>; sigma: { sigma: Uint8Array } } | { ok: false; reason: string };
  commitments: (input: Uint8Array) => { ok: true; sigmaDigest: Uint8Array } | { ok: false; reason: string };
  slotKey: (input: { kind: number; chainId: number; id: string }) => { ok: true; bytes: Uint8Array } | { ok: false; reason: string };
  stateLeaf: (key: Uint8Array, value: Uint8Array) => { ok: true; bytes: Uint8Array } | { ok: false; reason: string };
  stateNode: (left: Uint8Array, right: Uint8Array) => { ok: true; bytes: Uint8Array } | { ok: false; reason: string };
  emptyHash: (depth: number) => { ok: true; bytes: Uint8Array } | { ok: false; reason: string };
  isAllowedAlg: (alg: number) => boolean;
  LAYOUT: { sigma: number; sigmaBytes: number };
};

type SmtModule = {
  verifyProof: (
    key: Uint8Array,
    value: Uint8Array | null,
    proof: Uint8Array,
    root: Uint8Array,
  ) => { ok: boolean; reason?: string };
};

type EipModule = {
  canonicalKey: (alg: number, key: Uint8Array) => { ok: true; uncompressed: Uint8Array } | { ok: false; reason: string };
  keyHash: (alg: number, key: Uint8Array) => { ok: true; bytes: Uint8Array; hex: string } | { ok: false; reason: string };
  checkSigma: (sigma64: Uint8Array) => { ok: boolean; reason?: string };
  verifyPossession: (digest: Uint8Array, uncompressedKey: Uint8Array, signature: Uint8Array) => { ok: boolean; reason?: string };
};

type EcdsaModule = {
  P256: { p: bigint; a: bigint; b: bigint; order: bigint };
  SECP256K1: { p: bigint; a: bigint; b: bigint; order: bigint; G: { x: bigint; y: bigint } };
  yParityByTrial: (digest: Uint8Array, sig64: Uint8Array, publicKey: Uint8Array, curve: unknown) => number;
  recoverPublicKey: (digest: Uint8Array, r: Uint8Array, s: Uint8Array, yParity: 0 | 1, curve: unknown) => Uint8Array | null;
  ethereumAddress: (publicKey: Uint8Array) => string;
  bytesToBig: (bytes: Uint8Array) => bigint;
  bigToBytes: (value: bigint, length: number) => Uint8Array;
};

let cores: {
  merkle: MerkleModule;
  line: LineModule;
  ecdsa: EcdsaModule;
  keccak: (message: Uint8Array) => Uint8Array;
  sha256: (message: Uint8Array) => Uint8Array;
  eip: EipModule;
  smt: SmtModule;
} | null = null;

async function loadCores() {
  if (cores) return cores;
  const root = pathToFileURL(join(dirname(__filename), '../../vendor/cs2-core/')).href;
  const [merkle, line, smt, curves, recover, bytes, keccakMod, shaMod, eip, address] = await Promise.all([
    import(new URL('merkle/index.js', root).href),
    import(new URL('line/index.mjs', root).href),
    import(new URL('smt/tree.mjs', root).href),
    import(new URL('ecdsa/curves.js', root).href),
    import(new URL('ecdsa/recover.js', root).href),
    import(new URL('ecdsa/bytes.js', root).href),
    import(new URL('ecdsa/keccak.js', root).href),
    import(new URL('sha256.js', root).href),
    import(new URL('eip712/index.mjs', root).href),
    import(new URL('ecdsa/address.js', root).href),
  ]);
  cores = {
    merkle: merkle as MerkleModule,
    line: line as LineModule,
    ecdsa: {
      P256: (curves as { P256: EcdsaModule['P256'] }).P256,
      SECP256K1: (curves as { SECP256K1: EcdsaModule['SECP256K1'] }).SECP256K1,
      yParityByTrial: (recover as { yParityByTrial: EcdsaModule['yParityByTrial'] }).yParityByTrial,
      recoverPublicKey: (recover as { recoverPublicKey: EcdsaModule['recoverPublicKey'] }).recoverPublicKey,
      ethereumAddress: (address as { ethereumAddress: EcdsaModule['ethereumAddress'] }).ethereumAddress,
      bytesToBig: (bytes as { bytesToBig: EcdsaModule['bytesToBig'] }).bytesToBig,
      bigToBytes: (bytes as { bigToBytes: EcdsaModule['bigToBytes'] }).bigToBytes,
    },
    keccak: (keccakMod as { keccak256: (message: Uint8Array) => Uint8Array }).keccak256,
    sha256: (shaMod as { sha256: (message: Uint8Array) => Uint8Array }).sha256,
    eip: eip as EipModule,
    smt: smt as SmtModule,
  };
  return cores;
}

function packageVersion(): string {
  try {
    const require = createRequire(__filename);
    const pkg = require('../../package.json') as { version?: string };
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function signedPayload(doc: IssuerHistoryDocument | null | undefined): Record<string, unknown> | null {
  const jws = doc?.issuer_signature?.jws;
  if (typeof jws !== 'string') return null;
  const part = jws.split('.')[1];
  if (!part) return null;
  try {
    const parsed = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function emptyHistory(reason: string | null, ok: boolean): V13History {
  return { ok, reason, source: null, headHash: null, entryCount: null, asOf: null };
}

function historyOf(doc: IssuerHistoryDocument, source: V13History['source'], ok: boolean, reason: string | null): V13History {
  return {
    ok,
    reason,
    source,
    headHash: doc.head_hash ?? null,
    entryCount: doc.entries?.length ?? 0,
    asOf: null,
  };
}

function hermetic(): boolean {
  return process.env.CHIT402_HERMETIC === '1' || Boolean(process.env.NODE_TEST_CONTEXT);
}

function canonRpc(url: string): string {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    let host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host === '::1') host = '127.0.0.1';
    parsed.hostname = host;
    parsed.hash = '';
    if ((parsed.protocol === 'https:' && parsed.port === '443') || (parsed.protocol === 'http:' && parsed.port === '80')) {
      parsed.port = '';
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return trimmed.toLowerCase().replace(/\/+$/, '');
  }
}

function rpcUrls(chainId: number, options: V13Options): string[] {
  let raw: string[] = [];
  if (options.rpcUrls && options.rpcUrls.length > 0) {
    raw = options.rpcUrls.map((item) => item.trim()).filter((item) => item !== '');
  } else if (typeof options.rpcUrl === 'string' && options.rpcUrl.trim() !== '') {
    raw = [options.rpcUrl.trim()];
  } else {
    const env = options.env ?? process.env;
    const fromEnv = env.BASE_RPC_URL;
    if (typeof fromEnv === 'string' && fromEnv.trim() !== '') raw = [fromEnv.trim()];
    else raw = [...(V13_RPC_DEFAULTS[chainId] ?? [])];
  }
  return [...new Set(raw.map(canonRpc))];
}

function rpcError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

async function rpc(urls: string[], method: string, params: unknown[]): Promise<unknown> {
  const unique = [...new Set(urls.map(canonRpc))];
  if (unique.length < 2) throw rpcError('rpc_unconfigured');
  const settled = await Promise.all(unique.map(async (url) => {
    try {
      return { ok: true as const, value: await jsonRpc(url, method, params) };
    } catch (err) {
      return { ok: false as const, err };
    }
  }));
  const answers = settled.filter((item) => item.ok).map((item) => item.value);
  if (answers.length < 2) {
    const failed = settled.find((item) => !item.ok);
    throw failed && !failed.ok ? failed.err : rpcError('rpc_unreachable');
  }
  const first = JSON.stringify(answers[0]);
  for (const answer of answers.slice(1)) {
    if (JSON.stringify(answer) !== first) throw rpcError('rpc_disagreement');
  }
  return answers[0];
}

function hexQty(n: number): string {
  return `0x${n.toString(16)}`;
}

function parseQty(value: unknown): number | null {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) return null;
  const n = Number(BigInt(value));
  if (!Number.isSafeInteger(n) || n < 0) return null;
  return n;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function fitBig(value: bigint): number | null {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(value);
}

function lineView(decoded: { payment: Record<string, unknown> }, bytes: Uint8Array): LineView | null {
  const p = decoded.payment;
  const chain = p.chainId;
  const blockNumber = p.blockNumber;
  if (typeof chain !== 'bigint' || typeof blockNumber !== 'bigint') return null;
  const chainId = fitBig(chain);
  const number = fitBig(blockNumber);
  if (chainId == null || number == null) return null;
  if (!(p.blockHash instanceof Uint8Array) || !(p.txHash instanceof Uint8Array)) return null;
  if (!(p.token instanceof Uint8Array) || !(p.from instanceof Uint8Array) || !(p.to instanceof Uint8Array)) return null;
  if (!(p.authorizer instanceof Uint8Array) || !(p.nonce instanceof Uint8Array)) return null;
  if (typeof p.value !== 'bigint' || typeof p.method !== 'number' || typeof p.txIndex !== 'number' || typeof p.localLogIndex !== 'number') {
    return null;
  }
  return {
    chainId,
    blockHash: `0x${bytesToHex(p.blockHash)}`,
    blockNumber: number,
    txIndex: p.txIndex,
    localLogIndex: p.localLogIndex,
    txHash: `0x${bytesToHex(p.txHash)}`,
    token: `0x${bytesToHex(p.token)}`,
    from: `0x${bytesToHex(p.from)}`,
    to: `0x${bytesToHex(p.to)}`,
    value: p.value,
    method: p.method,
    authorizer: `0x${bytesToHex(p.authorizer)}`,
    nonce: `0x${bytesToHex(p.nonce)}`,
    bytes,
  };
}

const LOW_SIGMA = (() => {
  const bytes = new Uint8Array(64);
  bytes[31] = 1;
  bytes[63] = 1;
  return bytes;
})();

function coreSigma(line: LineModule, bytes: Uint8Array): boolean {
  const at = line.LAYOUT.sigma;
  const n = line.LAYOUT.sigmaBytes;
  if (bytes.length < at + n) return false;
  if (bytes[at] !== 0) return false;
  for (let i = 1; i < n; i += 1) {
    if (bytes[at + i] !== 0) return false;
  }
  return true;
}

function patchedSigma(line: LineModule, bytes: Uint8Array): Uint8Array {
  const patched = new Uint8Array(bytes);
  patched[line.LAYOUT.sigma] = 1;
  patched.set(LOW_SIGMA, line.LAYOUT.sigma + 1);
  return patched;
}

function stateOk(
  smt: SmtModule,
  slotKey: Uint8Array,
  slotValue: Uint8Array | null,
  slotProof: Uint8Array,
) {
  return (stateRoot: string): { ok: boolean; reason: string | null; exit?: 1 | 2 } => {
    if (slotKey.length !== 32 || slotProof.length < 32) {
      return { ok: false, reason: 'state_unproven', exit: 2 };
    }
    const root = hexToBytes(stateRoot);
    if (!root || root.length !== 32) return { ok: false, reason: 'state_unproven', exit: 2 };
    const checked = smt.verifyProof(slotKey, slotValue, slotProof, root);
    if (!checked.ok) return { ok: false, reason: 'not_in_state', exit: 1 };
    return { ok: true, reason: null };
  };
}


async function readExtension(
  bundle: IssuerHistoryDocument,
  bytes: string,
  trustedKids: readonly string[],
): Promise<{ ok: true; doc: IssuerHistoryDocument } | { ok: false; reason: string }> {
  let doc: IssuerHistoryDocument;
  try {
    doc = JSON.parse(bytes) as IssuerHistoryDocument;
  } catch {
    return { ok: false, reason: 'issuer_history_unreadable' };
  }
  const signed = verifyIssuerHistoryDocument(doc, { trustedKids });
  if (!signed.valid) return { ok: false, reason: signed.reason || 'issuer_history_invalid' };
  if (!historyPrefixExtends(bundle, doc) || !laterThanBundled(bundle, doc)) {
    return { ok: false, reason: 'issuer_history_not_extension' };
  }
  const narrow = extensionNarrowsBundle(bundle, doc);
  if (!narrow.ok) return { ok: false, reason: narrow.reason };
  return { ok: true, doc };
}

async function fetchLive(
  bundle: IssuerHistoryDocument,
  trustedKids: readonly string[],
  fetchImpl: typeof fetch | undefined,
): Promise<{ doc: IssuerHistoryDocument | null; refused: string | null }> {
  if (hermetic() && !fetchImpl) return { doc: null, refused: null };
  try {
    const res = await fetchNoRedirect(LIVE_HISTORY_URL, { signal: AbortSignal.timeout(800) }, fetchImpl);
    if (!res.ok) return { doc: null, refused: null };
    const text = await res.text();
    const read = await readExtension(bundle, text, trustedKids);
    if (!read.ok) return { doc: null, refused: read.reason };
    return { doc: read.doc, refused: null };
  } catch {
    return { doc: null, refused: null };
  }
}

function combineNarrowing(base: Record<string, unknown> | null, extra: Record<string, unknown> | null): unknown {
  const left = base && Array.isArray(base.narrowing) ? base.narrowing : [];
  const right = extra && Array.isArray(extra.narrowing) ? extra.narrowing : [];
  return [...left, ...right];
}

const LOG_SPAN = 4999;
const ROTATION_TOPIC0 = '0x95d3ad0e28a557ff091289f350472166359808c1308277737cd6cc7cacc4e8b3';

function blankWorld(history: V13History, extra: Partial<V13World> = {}): V13World {
  return {
    history,
    snapshotSigned: true,
    bundledPayload: null,
    narrowing: null,
    liveExtension: null,
    rpcConfigured: false,
    finalizedNumber: null,
    events: [],
    codeHash: null,
    anchorFrom: null,
    anchorTo: null,
    successor: 'not_required',
    chainGenesis: null,
    line: null,
    lineReason: null,
    rotatedTo: null,
    payment: null,
    canonical: 'unreachable',
    ...extra,
  };
}

async function fetchEvents(
  urls: string[],
  address: string,
  epoch: number,
  finalized: number,
): Promise<{ events: AnchoredEvent[]; priorStatus: 'absent' | 'present' | 'unreadable' }> {
  const want = new Set<number>();
  if (epoch > 0) want.add(epoch - 1);
  want.add(epoch);
  const out: AnchoredEvent[] = [];
  let priorStatus: 'absent' | 'present' | 'unreadable' = epoch > 0 ? 'absent' : 'present';
  const pull = async (n: number): Promise<number> => {
    const topic = topicUint(BigInt(n));
    if (!topic) return 0;
    let count = 0;
    try {
      for (let from = 0; from <= finalized; from += LOG_SPAN + 1) {
        const to = Math.min(finalized, from + LOG_SPAN);
        const result = await rpc(urls, 'eth_getLogs', [{
          address,
          fromBlock: hexQty(from),
          toBlock: hexQty(to),
          topics: [ANCHORED_TOPIC0, topic],
        }]);
        if (!Array.isArray(result)) {
          if (n === epoch - 1) priorStatus = 'unreadable';
          return 0;
        }
        for (const item of result) {
          const rec = asRecord(item);
          if (!rec) continue;
          const blockNumber = parseQty(rec.blockNumber);
          const logIndex = parseQty(rec.logIndex);
          const event = anchoredFromLog({
            address: typeof rec.address === 'string' ? rec.address : undefined,
            topics: Array.isArray(rec.topics) ? rec.topics.filter((part): part is string => typeof part === 'string') : undefined,
            data: typeof rec.data === 'string' ? rec.data : undefined,
            blockNumber: blockNumber ?? undefined,
            blockHash: typeof rec.blockHash === 'string' ? rec.blockHash : undefined,
            transactionHash: typeof rec.transactionHash === 'string' ? rec.transactionHash : undefined,
            logIndex: logIndex ?? undefined,
          });
          if (event) {
            out.push(event);
            count += 1;
          }
        }
      }
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: string }).code) : '';
      const disagreed = code === 'rpc_disagreement';
      if (disagreed || n !== epoch - 1) throw err;
      priorStatus = 'unreadable';
      return 0;
    }
    if (n === epoch - 1 && count > 0) priorStatus = 'present';
    return count;
  };
  for (const n of want) await pull(n);
  let cursor = epoch;
  for (let i = 0; i < 48; i += 1) {
    cursor += 1;
    const count = await pull(cursor);
    if (count === 0) break;
  }
  return { events: out, priorStatus };
}

function addressFromWord(word: string): string | null {
  const body = word.startsWith('0x') ? word.slice(2) : word;
  if (!/^[0-9a-fA-F]{64}$/.test(body)) return null;
  return `0x${body.slice(24).toLowerCase()}`;
}

export function verdictOf(result: V13Result, version: string): VerifyVerdict {
  const resultName = result.exit === 0 ? 'verified' : result.exit === 1 ? 'invalid' : 'could_not_check';
  return {
    result: resultName,
    exit_code: result.exit,
    reason: result.reason,
    message: result.message,
    next_step: result.exit === 2 ? 'Re-run when the anchor and the chain can be read.' : null,
    receipt_id: null,
    display_id: null,
    payload_version: null,
    checks: result.checks,
    history: {
      source: result.history.source,
      head_hash: result.history.headHash,
      entry_count: result.history.entryCount,
      as_of: result.history.asOf,
    },
    log: null,
    notes: [UNAUDITED_NOTE],
    prints: result.prints,
    live_extension: result.liveExtension,
    verifier: { name: 'chit402-verify', version },
  };
}

export async function verifyV13Document(receipt: unknown, options: V13Options = {}): Promise<VerifyVerdict> {
  const version = packageVersion();
  const trustedKids = options.trustedKids ?? DEFAULT_TRUSTED_ISSUER_KIDS;
  const bundled = readTestSnapshot(options)?.issuerHistory ?? loadBundledIssuerHistory();
  const bundleDoc = bundled.document;
  const signedBundle = verifyIssuerHistoryDocument(bundleDoc, { trustedKids });
  const payload = signedPayload(bundleDoc);
  let history = historyOf(bundleDoc, 'bundled', true, null);
  let narrowing: unknown = payload?.narrowing ?? null;
  let liveExtension: string | null = null;
  let sourceDoc = bundleDoc;

  if (!signedBundle.valid) {
    history = emptyHistory(null, true);
    const result = runV13(receipt, blankWorld(history, {
      snapshotSigned: false,
      bundledPayload: payload,
    }), idleHooks());
    return verdictOf(result, version);
  }

  if (options.issuerHistoryBytes != null) {
    const ext = await readExtension(bundleDoc, options.issuerHistoryBytes, trustedKids);
    if (!ext.ok) {
      history = historyOf(bundleDoc, 'file', false, ext.reason);
      const result = runV13(receipt, blankWorld(history, { bundledPayload: payload }), idleHooks());
      return verdictOf(result, version);
    }
    sourceDoc = ext.doc;
    history = historyOf(ext.doc, 'file', true, null);
    narrowing = combineNarrowing(payload, signedPayload(ext.doc));
  } else {
    const live = await fetchLive(bundleDoc, trustedKids, options.fetchImpl);
    if (live.refused) liveExtension = live.refused;
    if (live.doc) {
      sourceDoc = live.doc;
      history = historyOf(live.doc, 'live', true, null);
      narrowing = combineNarrowing(payload, signedPayload(live.doc));
    }
  }
  void sourceDoc;

  const parsed = parseV13Receipt(receipt);
  let loaded: Awaited<ReturnType<typeof loadCores>> | null = null;
  if (parsed.ok) {
    try {
      loaded = await loadCores();
    } catch {
      return verdictOf(runV13(receipt, blankWorld(history, {
        snapshotSigned: true,
        bundledPayload: payload,
        narrowing,
        liveExtension,
        line: null,
        lineReason: 'verifier_runtime_missing',
      }), idleHooks()), version);
    }
  }
  let line: LineView | null = null;
  let lineReason: string | null = null;
  if (parsed.ok && loaded) {
    const bytes = hexToBytes(parsed.receipt.lineHex);
    if (!bytes) lineReason = 'bad_line';
    else if (!coreSigma(loaded.line, bytes)) lineReason = 'sigma_not_core';
    else {
      const decoded = loaded.line.decodeLine(patchedSigma(loaded.line, bytes));
      if (!decoded.ok) lineReason = 'bad_line';
      else {
        line = lineView(decoded, bytes);
        if (!line) lineReason = 'bad_line';
      }
    }
  }

  const chainId = line?.chainId ?? null;
  const urls = chainId == null ? [] : rpcUrls(chainId, options);
  const base: Partial<V13World> = {
    history,
    snapshotSigned: true,
    bundledPayload: payload,
    narrowing,
    liveExtension,
    line,
    lineReason,
    rotatedTo: null,
    rpcConfigured: urls.length >= 2,
  };

  if (!parsed.ok || !line || !loaded || urls.length < 2) {
    return verdictOf(runV13(receipt, blankWorld(history, base), idleHooks()), version);
  }

  let finalizedNumber: number | null = null;
  let events: AnchoredEvent[] = [];
  let priorStatus: V13World['priorStatus'] = 'absent';
  let codeHash: string | null = null;
  let anchorFrom: string | null = null;
  let anchorTo: string | null = null;
  let successor: V13World['successor'] = 'not_required';
  let chainGenesis: number | null = null;
  let canonical: V13World['canonical'] = 'unreachable';
  let payment: PaymentView | null = null;
  let rotationExplains = false;
  let ownRetired: V13World['ownRetired'] = 'no';
  let rpcReason: string | null = null;
  let showingHour: number | null = null;

  try {
    const fin = asRecord(await rpc(urls, 'eth_getBlockByNumber', ['finalized', false]));
    finalizedNumber = fin ? parseQty(fin.number) : null;
    if (finalizedNumber == null) {
      return verdictOf(runV13(receipt, blankWorld(history, { ...base, canonical: 'ok', finalizedNumber: null }), idleHooks()), version);
    }
    const fetched = await fetchEvents(urls, parsed.receipt.contract, parsed.receipt.epoch, finalizedNumber);
    events = fetched.events;
    priorStatus = fetched.priorStatus;
    const head = firstCovering(events, parsed.receipt.index, finalizedNumber);
    if (head) {
      const tx = asRecord(await rpc(urls, 'eth_getTransactionReceipt', [head.txHash]));
      anchorFrom = tx && typeof tx.from === 'string' ? tx.from : null;
      anchorTo = tx && typeof tx.to === 'string' ? tx.to : null;
      const code = await rpc(urls, 'eth_getCode', [parsed.receipt.contract, hexQty(head.blockNumber)]);
      if (typeof code === 'string' && code.startsWith('0x')) {
        const raw = hexToBytes(code) ?? new Uint8Array();
        codeHash = `0x${bytesToHex(loaded.keccak(raw))}`;
      }
      const genesis = await callWord(urls, parsed.receipt.contract, '0x014af0c4');
      if (genesis != null) chainGenesis = Number(genesis);
      const retired = await callWord(urls, parsed.receipt.contract, '0x2eb38ae0');
      if (retired === 1n) {
        const next = await callWord(urls, parsed.receipt.contract, '0x6ff968c3');
        if (next == null) ownRetired = 'successor_unreadable';
      }
      if (head.hourStart <= BigInt(Number.MAX_SAFE_INTEGER)) showingHour = Number(head.hourStart);
      const checkpoint = checkpointOf(payload, line.chainId, parsed.receipt.contract);
      if (checkpoint && anchorFrom && anchorFrom.toLowerCase() !== checkpoint) {
        const logs = await fetchRotation(urls, parsed.receipt.contract, finalizedNumber);
        rotationExplains = rotationChain(logs, checkpoint, anchorFrom);
      }
    }
    const pinPredecessor = predecessorOf(payload, line.chainId, parsed.receipt.contract);
    if (pinPredecessor && pinPredecessor !== ZERO_ADDRESS) {
      const word = await callWord(urls, pinPredecessor, '0x6ff968c3');
      if (word == null) successor = 'unreadable';
      else {
        const got = addressFromWord(word.toString(16).padStart(64, '0'));
        successor = got === parsed.receipt.contract ? 'match' : 'mismatch';
      }
    }
    const byHash = asRecord(await rpc(urls, 'eth_getBlockByHash', [line.blockHash, false]));
    if (!byHash) {
      canonical = 'unknown_block';
    } else {
      const number = parseQty(byHash.number);
      const hash = typeof byHash.hash === 'string' ? byHash.hash : '';
      if (!hash) {
        canonical = 'unreachable';
      } else {
        const byNumber = number == null ? null : asRecord(await rpc(urls, 'eth_getBlockByNumber', [hexQty(number), false]));
        const canonicalHash = byNumber && typeof byNumber.hash === 'string' ? byNumber.hash : null;
        const judged = classifyCanonical({
          rpcError: false,
          block: number == null ? null : { number, hash },
          finalizedNumber,
          canonicalHash,
          wantHash: line.blockHash,
        });
        canonical = judged === 'finality_unavailable' ? 'unreachable' : judged;
        const txs = Array.isArray(byHash.transactions) ? byHash.transactions : [];
        const at = txs[line.txIndex];
        const txIndexMatch = typeof at === 'string' && at.toLowerCase() === line.txHash.toLowerCase();
        const rec = asRecord(await rpc(urls, 'eth_getTransactionReceipt', [line.txHash]));
        const tx = asRecord(await rpc(urls, 'eth_getTransactionByHash', [line.txHash]));
        if (rec) {
          const logs = Array.isArray(rec.logs) ? rec.logs : [];
          payment = {
            blockHash: typeof rec.blockHash === 'string' ? rec.blockHash : '',
            txIndexMatch,
            txTo: tx && typeof tx.to === 'string' ? tx.to : null,
            input: tx && typeof tx.input === 'string' ? tx.input : '',
            logs: receiptLogs(logs),
          };
        }
      }
    }
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: string }).code) : '';
    if (code === 'rpc_disagreement') rpcReason = 'rpc_disagreement';
    canonical = 'unreachable';
  }

  const hooks = {
    leafHash: loaded.merkle.leafHash,
    verifyInclusion: loaded.merkle.verifyInclusion,
    stateOk: stateOk(loaded.smt, parsed.receipt.slotKey, parsed.receipt.slotValue, parsed.receipt.slotProof),
  };
  return verdictOf(runV13(receipt, blankWorld(history, {
    ...base,
    finalizedNumber,
    events,
    priorStatus,
    codeHash,
    anchorFrom,
    anchorTo,
    successor,
    chainGenesis,
    canonical,
    payment,
    rotationExplains,
    ownRetired,
    rpcReason,
    rpcConfigured: true,
  }), hooks), version);
}

function idleHooks() {
  return {
    leafHash: () => ({ ok: false as const, reason: 'bad_leaf' }),
    verifyInclusion: () => ({ ok: false }),
    stateOk: () => ({ ok: false, reason: 'state_unproven', exit: 2 as const }),
  };
}

function receiptLogs(raw: unknown[]): PaymentView['logs'] {
  const rows: { logIndex: number; row: Record<string, unknown> }[] = [];
  for (const item of raw) {
    const row = asRecord(item);
    if (!row || typeof row.address !== 'string' || !Array.isArray(row.topics)) continue;
    const logIndex = parseQty(row.logIndex);
    if (logIndex == null) continue;
    rows.push({ logIndex, row });
  }
  rows.sort((a, b) => a.logIndex - b.logIndex);
  if (rows.length === 0) return [];
  const blockOf = (row: Record<string, unknown>) => (typeof row.blockHash === 'string' ? row.blockHash.toLowerCase() : '');
  const txOf = (row: Record<string, unknown>) => (typeof row.transactionHash === 'string' ? row.transactionHash.toLowerCase() : '');
  const block0 = blockOf(rows[0].row);
  const tx0 = txOf(rows[0].row);
  for (let i = 0; i < rows.length; i += 1) {
    if (i > 0 && rows[i].logIndex !== rows[i - 1].logIndex + 1) return [];
    const block = blockOf(rows[i].row);
    const tx = txOf(rows[i].row);
    if (block0 && block && block !== block0) return [];
    if (tx0 && tx && tx !== tx0) return [];
  }
  return rows.map((item, index) => ({
    index,
    address: String(item.row.address),
    topics: (item.row.topics as unknown[]).filter((topic): topic is string => typeof topic === 'string'),
    data: typeof item.row.data === 'string' ? item.row.data : '0x',
  }));
}

async function fetchRotation(urls: string[], address: string, finalized: number): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let from = 0; from <= finalized; from += LOG_SPAN + 1) {
    const to = Math.min(finalized, from + LOG_SPAN);
    const result = await rpc(urls, 'eth_getLogs', [{
      address,
      fromBlock: hexQty(from),
      toBlock: hexQty(to),
      topics: [ROTATION_TOPIC0],
    }]);
    if (Array.isArray(result)) out.push(...result);
  }
  return out;
}

function rotationChain(logs: unknown[], checkpoint: string, anchorFrom: string): boolean {
  const steps: { version: bigint; oldAddr: string; newAddr: string }[] = [];
  for (const item of logs) {
    const rec = asRecord(item);
    if (!rec || typeof rec.data !== 'string') continue;
    const body = rec.data.startsWith('0x') ? rec.data.slice(2) : rec.data;
    if (!/^[0-9a-fA-F]{192}$/.test(body)) continue;
    const oldAddr = `0x${body.slice(88, 128).toLowerCase()}`;
    const newAddr = `0x${body.slice(152, 192).toLowerCase()}`;
    steps.push({ version: BigInt(`0x${body.slice(0, 64)}`), oldAddr, newAddr });
  }
  steps.sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0));
  let current = checkpoint.toLowerCase();
  let moved = false;
  for (const step of steps) {
    if (step.oldAddr !== current) continue;
    current = step.newAddr;
    moved = true;
  }
  return moved && current === anchorFrom.toLowerCase();
}

function checkpointOf(payload: Record<string, unknown> | null, chainId: number, address: string): string | null {
  const list = payload?.contracts;
  if (!Array.isArray(list)) return null;
  for (const item of list) {
    const row = asRecord(item);
    if (!row || row.chainId !== chainId) continue;
    if (typeof row.address !== 'string' || row.address.toLowerCase() !== address.toLowerCase()) continue;
    return typeof row.checkpoint === 'string' ? row.checkpoint.toLowerCase() : null;
  }
  return null;
}

function predecessorOf(payload: Record<string, unknown> | null, chainId: number, address: string): string | null {
  const list = payload?.contracts;
  if (!Array.isArray(list)) return null;
  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    if (row.chainId !== chainId) continue;
    if (typeof row.address !== 'string' || row.address.toLowerCase() !== address.toLowerCase()) continue;
    return typeof row.predecessor === 'string' ? row.predecessor.toLowerCase() : null;
  }
  return null;
}

async function callWord(urls: string[], to: string, data: string): Promise<bigint | null> {
  try {
    const result = await rpc(urls, 'eth_call', [{ to, data }, 'finalized']);
    if (typeof result !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(result)) return null;
    return BigInt(result);
  } catch {
    return null;
  }
}

export { isExactV13Receipt };
