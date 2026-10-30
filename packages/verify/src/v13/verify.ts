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
};

type EcdsaModule = {
  P256: { p: bigint; a: bigint; b: bigint };
  yParityByTrial: (digest: Uint8Array, sig64: Uint8Array, publicKey: Uint8Array, curve: unknown) => number;
  bytesToBig: (bytes: Uint8Array) => bigint;
  bigToBytes: (value: bigint, length: number) => Uint8Array;
};

let cores: { merkle: MerkleModule; line: LineModule; ecdsa: EcdsaModule; keccak: (message: Uint8Array) => Uint8Array } | null = null;

async function loadCores() {
  if (cores) return cores;
  const root = pathToFileURL(join(dirname(__filename), '../../../cs2-core/')).href;
  const [merkle, line, curves, recover, bytes, keccakMod] = await Promise.all([
    import(new URL('merkle/index.js', root).href),
    import(new URL('line/index.mjs', root).href),
    import(new URL('ecdsa/curves.js', root).href),
    import(new URL('ecdsa/recover.js', root).href),
    import(new URL('ecdsa/bytes.js', root).href),
    import(new URL('ecdsa/keccak.js', root).href),
  ]);
  cores = {
    merkle: merkle as MerkleModule,
    line: line as LineModule,
    ecdsa: {
      P256: (curves as { P256: EcdsaModule['P256'] }).P256,
      yParityByTrial: (recover as { yParityByTrial: EcdsaModule['yParityByTrial'] }).yParityByTrial,
      bytesToBig: (bytes as { bytesToBig: EcdsaModule['bytesToBig'] }).bytesToBig,
      bigToBytes: (bytes as { bigToBytes: EcdsaModule['bigToBytes'] }).bigToBytes,
    },
    keccak: (keccakMod as { keccak256: (message: Uint8Array) => Uint8Array }).keccak256,
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

function rpcUrls(chainId: number, options: V13Options): string[] {
  if (typeof options.rpcUrl === 'string' && options.rpcUrl.trim() !== '') return [options.rpcUrl.trim()];
  const env = options.env ?? process.env;
  const fromEnv = env.BASE_RPC_URL;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return [fromEnv.trim()];
  return [...(V13_RPC_DEFAULTS[chainId] ?? [])];
}

async function rpc(urls: string[], method: string, params: unknown[]): Promise<unknown> {
  let last: unknown = new Error('rpc_unreachable');
  for (const url of urls) {
    try {
      return await jsonRpc(url, method, params);
    } catch (err) {
      last = err;
    }
  }
  throw last;
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

function decompressP256(compressed: Uint8Array, ecdsa: EcdsaModule): Uint8Array | null {
  if (compressed.length < 33) return null;
  const key = compressed.subarray(0, 33);
  if (key[0] !== 2 && key[0] !== 3) return null;
  const p = ecdsa.P256.p;
  const x = ecdsa.bytesToBig(key.subarray(1));
  const x2 = (x * x) % p;
  const x3 = (x2 * x) % p;
  const ax = (ecdsa.P256.a * x) % p;
  let rhs = (x3 + ax + ecdsa.P256.b) % p;
  let y = 1n;
  let base = rhs % p;
  let exp = (p + 1n) / 4n;
  while (exp > 0n) {
    if ((exp & 1n) === 1n) y = (y * base) % p;
    base = (base * base) % p;
    exp >>= 1n;
  }
  const odd = (y & 1n) === 1n;
  if (odd !== (key[0] === 3)) y = (p - y) % p;
  const out = new Uint8Array(65);
  out[0] = 4;
  out.set(ecdsa.bigToBytes(x, 32), 1);
  out.set(ecdsa.bigToBytes(y, 32), 33);
  return out;
}

function proveKey(line: LineModule, view: LineView, slotValue: Uint8Array | null, slotProof: { side: 'left' | 'right'; hash: string }[]) {
  return (stateRoot: string): boolean => {
    if (!slotValue) return false;
    const key = line.slotKey({ kind: 1, chainId: view.chainId, id: view.to.slice(2) });
    if (!key.ok) return false;
    const leaf = line.stateLeaf(key.bytes, slotValue);
    if (!leaf.ok) return false;
    let acc = leaf.bytes;
    for (const step of slotProof) {
      const sibling = hexToBytes(step.hash);
      if (!sibling || sibling.length !== 32) return false;
      const node = step.side === 'left' ? line.stateNode(sibling, acc) : line.stateNode(acc, sibling);
      if (!node.ok) return false;
      acc = node.bytes;
    }
    return bytesToHex(acc) === stateRoot.toLowerCase();
  };
}

function sigmaOk(line: LineModule, ecdsa: EcdsaModule, bytes: Uint8Array, slotValue: Uint8Array | null): boolean {
  if (!slotValue) return false;
  const opened = line.commitments(bytes);
  const decoded = line.decodeLine(bytes);
  if (!opened.ok || !decoded.ok) return false;
  const point = decompressP256(slotValue, ecdsa);
  if (!point) return false;
  try {
    ecdsa.yParityByTrial(opened.sigmaDigest, decoded.sigma.sigma, point, ecdsa.P256);
    return true;
  } catch {
    return false;
  }
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

async function fetchEvents(urls: string[], address: string, epoch: number, finalized: number): Promise<AnchoredEvent[]> {
  const want = new Set<number>();
  if (epoch > 0) want.add(epoch - 1);
  want.add(epoch);
  const out: AnchoredEvent[] = [];
  const pull = async (n: number): Promise<number> => {
    const topic = topicUint(BigInt(n));
    if (!topic) return 0;
    const result = await rpc(urls, 'eth_getLogs', [{
      address,
      fromBlock: '0x0',
      toBlock: hexQty(finalized),
      topics: [ANCHORED_TOPIC0, topic],
    }]);
    if (!Array.isArray(result)) return 0;
    let count = 0;
    for (const item of result) {
      const rec = asRecord(item);
      if (!rec) continue;
      const blockNumber = parseQty(rec.blockNumber);
      const logIndex = parseQty(rec.logIndex);
      const event = anchoredFromLog({
        address: typeof rec.address === 'string' ? rec.address : undefined,
        topics: Array.isArray(rec.topics) ? rec.topics.filter((t): t is string => typeof t === 'string') : undefined,
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
    return count;
  };
  for (const n of want) await pull(n);
  let cursor = epoch;
  for (let i = 0; i < 48; i += 1) {
    cursor += 1;
    const count = await pull(cursor);
    if (count === 0) break;
  }
  return out;
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
    narrowing = signedPayload(ext.doc)?.narrowing ?? null;
  } else {
    const live = await fetchLive(bundleDoc, trustedKids, options.fetchImpl);
    if (live.refused) liveExtension = live.refused;
    if (live.doc) {
      sourceDoc = live.doc;
      history = historyOf(live.doc, 'live', true, null);
      narrowing = signedPayload(live.doc)?.narrowing ?? null;
    }
  }
  void sourceDoc;

  const parsed = parseV13Receipt(receipt);
  const loaded = await loadCores();
  let line: LineView | null = null;
  let lineReason: string | null = null;
  if (parsed.ok) {
    const bytes = hexToBytes(parsed.receipt.lineHex);
    const decoded = bytes ? loaded.line.decodeLine(bytes) : { ok: false as const, reason: 'bad_line' };
    if (!bytes || !decoded.ok) lineReason = 'bad_line';
    else {
      line = lineView(decoded, bytes);
      if (!line) lineReason = 'bad_line';
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
    rpcConfigured: urls.length > 0,
  };

  if (!parsed.ok || !line || urls.length === 0) {
    return verdictOf(runV13(receipt, blankWorld(history, base), idleHooks()), version);
  }

  let finalizedNumber: number | null = null;
  let events: AnchoredEvent[] = [];
  let codeHash: string | null = null;
  let anchorFrom: string | null = null;
  let anchorTo: string | null = null;
  let successor: V13World['successor'] = 'not_required';
  let chainGenesis: number | null = null;
  let canonical: V13World['canonical'] = 'unreachable';
  let payment: PaymentView | null = null;

  try {
    const fin = asRecord(await rpc(urls, 'eth_getBlockByNumber', ['finalized', false]));
    finalizedNumber = fin ? parseQty(fin.number) : null;
    if (finalizedNumber == null) {
      return verdictOf(runV13(receipt, blankWorld(history, { ...base, canonical: 'ok', finalizedNumber: null }), idleHooks()), version);
    }
    events = await fetchEvents(urls, parsed.receipt.contract, parsed.receipt.epoch, finalizedNumber);
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
          logs: logs.flatMap((item, index) => {
            const row = asRecord(item);
            if (!row || typeof row.address !== 'string' || !Array.isArray(row.topics)) return [];
            const logIndex = parseQty(row.logIndex);
            return [{
              index: logIndex ?? index,
              address: row.address,
              topics: row.topics.filter((t): t is string => typeof t === 'string'),
              data: typeof row.data === 'string' ? row.data : '0x',
            }];
          }),
        };
      }
    }
  } catch {
    canonical = 'unreachable';
  }

  const slotValue = parsed.ok ? parsed.receipt.slotValue : null;
  const slotProof = parsed.ok ? parsed.receipt.slotProof : [];
  const hooks = {
    leafHash: loaded.merkle.leafHash,
    verifyInclusion: loaded.merkle.verifyInclusion,
    proveKey: proveKey(loaded.line, line, slotValue, slotProof),
    sigmaOk: () => sigmaOk(loaded.line, loaded.ecdsa, line.bytes, slotValue),
  };
  return verdictOf(runV13(receipt, blankWorld(history, {
    ...base,
    finalizedNumber,
    events,
    codeHash,
    anchorFrom,
    anchorTo,
    successor,
    chainGenesis,
    canonical,
    payment,
    rpcConfigured: true,
  }), hooks), version);
}

function idleHooks() {
  return {
    leafHash: () => ({ ok: false as const, reason: 'bad_leaf' }),
    verifyInclusion: () => ({ ok: false }),
    proveKey: () => false,
    sigmaOk: () => false,
  };
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
