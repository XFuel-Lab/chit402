/**
 * Chit Simple v13 decisions. No Node imports: the same functions run in a
 * browser. Hashing, the line codec, and RPC stay outside and are passed in.
 *
 * Tree size uses safe integers and stops at 2^53-1. That cap is an
 * implementation limit, not a wire field.
 *
 * A v0 checkpoint-key rotation is not a trust event. The anchor sender is
 * the checkpoint address in the bundled pin. An on-chain rotation does not
 * add a trusted sender.
 */

export const V13_SCHEMA = 'chit402.cs2.receipt.v1';

/** Printed on every v13 --json verdict until Stage C. */
export const UNAUDITED_NOTE = 'anchor contract unaudited';

/** Implementation limit. Not a wire field. */
export const MAX_TREE_SIZE = Number.MAX_SAFE_INTEGER;

export const ANCHORED_EVENT = 'Anchored(uint64 indexed epoch, uint64 indexed hourStart, uint64 size, bytes32 root, bytes32 stateRoot, uint8 kind)';
export const ANCHORED_SIGNATURE = 'Anchored(uint64,uint64,uint64,bytes32,bytes32,uint8)';
export const ANCHORED_TOPIC0 = '0xbc37f50aefd1f20e30781db115c88ea4bb3263e504eb6e61653fb9e4f1b7b75e';

export const KIND_HOURLY = 0;
export const TRANSFER_TOPIC0 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const AUTHORIZATION_USED_TOPIC0 = '0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5';
export const METHOD_3009 = 1;
export const METHOD_PERMIT2 = 2;
export const PERMIT2_SELECTOR = '0x30f28b7a';
export const PERMIT2_ADDRESS = '0x000000000022d473030f116ddee9f6b43ac78ba3';
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Corpus rows that change verdict because this path exists.
 * `version-v13-unknown` stays `unsupported_version`: it is a legacy JWS
 * with payload_version 13, not this exact type.
 */
export const CORPUS_FLIP_LIST: readonly string[] = Object.freeze([]);

const RECEIPT_KEYS = new Set(['v', 'schema', 'line', 'index', 'epoch', 'contract', 'proof', 'slotValue', 'slotProof']);
const LEAF_KEYS = new Set(['leaf', 'leafHash', 'leaf_hash']);
const SIZE_KEYS = new Set(['treeSize', 'tree_size', 'size']);
const PIN_KEYS = ['chainId', 'address', 'codeHash', 'predecessor', 'checkpoint', 'genesisHourStart', 'retireHourStart'];
const NARROW_KEYS = new Set(['chainId', 'address', 'revokeAfterEpoch', 'retireHourStart']);

const USDC: Readonly<Record<number, string>> = Object.freeze({
  8453: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  84532: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
});

export type CheckState = 'pass' | 'fail' | 'could_not_check';

export interface V13Checks {
  signature: CheckState;
  key_window: CheckState;
  payment_binding: CheckState;
  log_inclusion: CheckState;
  anchor: CheckState;
  shape: CheckState;
}

export interface ContractPin {
  chainId: number;
  address: string;
  codeHash: string;
  predecessor: string;
  checkpoint: string;
  genesisHourStart: number;
  retireHourStart: number | null;
}

export interface NarrowRow {
  chainId: number;
  address: string;
  revokeAfterEpoch: number | null;
  retireHourStart: number | null;
}

export interface AnchoredEvent {
  epoch: bigint;
  hourStart: bigint;
  size: bigint;
  root: string;
  stateRoot: string;
  kind: number;
  blockNumber: number;
  blockHash: string;
  txHash: string;
  logIndex: number;
  address: string;
}

export interface LineView {
  chainId: number;
  blockHash: string;
  blockNumber: number;
  txIndex: number;
  localLogIndex: number;
  txHash: string;
  token: string;
  from: string;
  to: string;
  value: bigint;
  method: number;
  authorizer: string;
  nonce: string;
  bytes: Uint8Array;
}

export interface ParsedReceipt {
  index: number;
  epoch: number;
  contract: string;
  proof: string[];
  slotValue: Uint8Array | null;
  slotProof: { side: 'left' | 'right'; hash: string }[];
  lineHex: string;
}

export interface ChainLog {
  index: number;
  address: string;
  topics: string[];
  data: string;
}

export interface PaymentView {
  blockHash: string;
  txIndexMatch: boolean;
  logs: ChainLog[];
  txTo: string | null;
  input: string;
}

export interface V13History {
  ok: boolean;
  reason: string | null;
  source: 'file' | 'live' | 'bundled' | null;
  headHash: string | null;
  entryCount: number | null;
  asOf: string | null;
}

export interface V13World {
  history: V13History;
  snapshotSigned: boolean;
  bundledPayload: unknown;
  narrowing: unknown;
  liveExtension: string | null;
  rpcConfigured: boolean;
  finalizedNumber: number | null;
  events: AnchoredEvent[];
  codeHash: string | null;
  anchorFrom: string | null;
  anchorTo: string | null;
  successor: 'not_required' | 'match' | 'mismatch' | 'unreadable';
  /** null when the v0 bytecode has no getter. A number must equal the pin. */
  chainGenesis: number | null;
  line: LineView | null;
  lineReason: string | null;
  /** Address a rotation log named. Never a trust input. */
  rotatedTo: string | null;
  payment: PaymentView | null;
  canonical: 'ok' | 'unreachable' | 'unknown_block' | 'not_final' | 'reorged' | 'finality_unavailable';
}

export interface V13Hooks {
  leafHash: (line: Uint8Array) => { ok: true; hash: Uint8Array } | { ok: false; reason: string };
  verifyInclusion: (
    leaf: string,
    index: number,
    treeSize: number,
    root: string,
    proof: string[],
  ) => { ok: boolean; reason?: string };
  proveKey: (stateRoot: string) => boolean;
  sigmaOk: () => boolean;
}

export interface V13Result {
  exit: 0 | 1 | 2;
  reason: string | null;
  message: string;
  prints: string[];
  liveExtension: string | null;
  checks: V13Checks;
  history: V13History;
  hourStart: number | null;
  anchorBlock: number | null;
  paymentBlock: number | null;
}

const PASS: V13Checks = {
  signature: 'pass',
  key_window: 'pass',
  payment_binding: 'pass',
  log_inclusion: 'pass',
  anchor: 'pass',
  shape: 'pass',
};

function checks(patch: Partial<V13Checks>): V13Checks {
  return { ...PASS, ...patch };
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isJsonInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && !Object.is(value, -0);
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

export function hexToBytes(value: string): Uint8Array | null {
  const body = value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value;
  if (body.length % 2 !== 0 || !/^[0-9a-f]*$/.test(body)) return null;
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function normHex(value: string, bytes: number): string | null {
  const raw = hexToBytes(value);
  if (!raw || raw.length !== bytes) return null;
  const text = value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value;
  if (text !== text.toLowerCase()) return null;
  return `0x${bytesToHex(raw)}`;
}

export function normHash(value: string): string | null {
  if (typeof value !== 'string') return null;
  const body = value.startsWith('0x') ? value.slice(2) : value;
  if (!/^[0-9a-f]{64}$/.test(body)) return null;
  return body;
}

/**
 * Exact type: JSON number 13 and the v13 schema. A legacy JWS, a string
 * "13", or a line-shaped object without this type is not dispatched here.
 */
export function isExactV13Receipt(value: unknown): boolean {
  if (!isPlain(value)) return false;
  if (!hasOwn(value, 'v') || !isJsonInteger(value.v) || value.v !== 13) return false;
  if (value.schema !== V13_SCHEMA) return false;
  if (hasOwn(value, 'payload_version')) return false;
  if (hasOwn(value, 'issuer_signature')) return false;
  return true;
}

function fail(exit: 0 | 1 | 2, reason: string, world: V13World, patch: Partial<V13Checks>, message: string): V13Result {
  return {
    exit,
    reason,
    message,
    prints: [],
    liveExtension: world.liveExtension,
    checks: checks(patch),
    history: world.history,
    hourStart: null,
    anchorBlock: null,
    paymentBlock: world.line ? world.line.blockNumber : null,
  };
}

const MESSAGES: Record<string, string> = {
  caller_supplied_leaf: 'The leaf is computed from the line. A caller-supplied leaf hash is refused.',
  caller_supplied_tree_size: 'The tree size comes from the anchored head. A caller-supplied size is refused.',
  bad_receipt: 'The v13 receipt fields are not the exact type.',
  bad_line: 'The line is not a 1,024-byte v13 line.',
  snapshot_signature_invalid: 'The bundled issuer-history snapshot signature is invalid.',
  snapshot_contracts_invalid: 'The bundled contract list is not the pinned shape.',
  contract_not_pinned: 'contract not pinned: update chit402-verify',
  rpc_unconfigured: 'No RPC is configured for this chain. The v13 anchor could not be checked.',
  rpc_unreachable: 'The RPC did not answer. The receipt could not be checked.',
  pre_anchor: 'pre-anchor',
  tree_size_above_cap: 'The anchored tree size is above the verifier cap.',
  anchor_sender_mismatch: 'anchor sender mismatch',
  code_hash_mismatch: 'The contract code hash does not match the pin.',
  code_unreadable: 'The contract code could not be read.',
  hour_outside_coverage: 'The receipt hour is outside the contract coverage.',
  revoked_after_epoch: 'The contract is revoked after this epoch.',
  lineage_successor_mismatch: 'The predecessor successor() is not the pinned contract.',
  successor_unreadable: 'The predecessor successor() could not be read.',
  not_first_anchor: 'This epoch is not the first anchored head over the line.',
  not_in_log: 'NOT_IN_LOG',
  pending_hourly_close: 'pending hourly close',
  key_status_unproven: 'key status unproven',
  sigma_invalid: 'The seller signature does not verify under the payTo slot.',
  unknown_block: 'The block hash is not known to the RPC.',
  block_not_final: 'The payment block is not final.',
  finality_unavailable: 'The finalized head could not be read.',
  reorged: 'REORGED',
  wrong_block_hash: 'The payment is not in the block the line names.',
  payment_mismatch: 'The chain payment does not match the line.',
  extension_widens_pin: 'An issuer-history extension may only narrow a bundled pin.',
  extension_adds_contract: 'An issuer-history extension may not add a v13 contract pin.',
  issuer_history_signer_inactive: 'The issuer-history signer is not active in the bundled snapshot.',
  issuer_history_not_extension: 'The issuer-history file is not a narrowing extension of the bundled snapshot.',
  issuer_history_invalid: 'The issuer-history document is invalid.',
  signature_invalid: 'The issuer-history signature is invalid.',
};

function messageOf(reason: string): string {
  return MESSAGES[reason] || reason;
}

export function parseV13Receipt(value: unknown): { ok: true; receipt: ParsedReceipt } | { ok: false; exit: 1; reason: string } {
  if (!isPlain(value)) return { ok: false, exit: 1, reason: 'bad_receipt' };
  for (const key of Object.keys(value)) {
    if (LEAF_KEYS.has(key)) return { ok: false, exit: 1, reason: 'caller_supplied_leaf' };
    if (SIZE_KEYS.has(key)) return { ok: false, exit: 1, reason: 'caller_supplied_tree_size' };
    if (!RECEIPT_KEYS.has(key)) return { ok: false, exit: 1, reason: 'bad_receipt' };
  }
  if (!isExactV13Receipt(value)) return { ok: false, exit: 1, reason: 'bad_receipt' };
  if (typeof value.line !== 'string') return { ok: false, exit: 1, reason: 'bad_receipt' };
  const lineBody = value.line.startsWith('0x') ? value.line.slice(2) : value.line;
  if (!/^[0-9a-f]{2048}$/.test(lineBody)) return { ok: false, exit: 1, reason: 'bad_receipt' };
  if (!isJsonInteger(value.index) || value.index < 0) return { ok: false, exit: 1, reason: 'bad_receipt' };
  if (!isJsonInteger(value.epoch) || value.epoch < 0) return { ok: false, exit: 1, reason: 'bad_receipt' };
  if (typeof value.contract !== 'string' || !normHex(value.contract, 20)) return { ok: false, exit: 1, reason: 'bad_receipt' };
  if (!Array.isArray(value.proof) || value.proof.length > 64) return { ok: false, exit: 1, reason: 'bad_receipt' };
  const proof: string[] = [];
  for (const item of value.proof) {
    if (typeof item !== 'string') return { ok: false, exit: 1, reason: 'bad_receipt' };
    const hash = normHash(item);
    if (!hash) return { ok: false, exit: 1, reason: 'bad_receipt' };
    proof.push(hash);
  }
  let slotValue: Uint8Array | null = null;
  if (hasOwn(value, 'slotValue')) {
    if (typeof value.slotValue !== 'string') return { ok: false, exit: 1, reason: 'bad_receipt' };
    const raw = hexToBytes(value.slotValue);
    if (!raw || (value.slotValue.startsWith('0x') ? value.slotValue.slice(2) : value.slotValue) !== (value.slotValue.startsWith('0x') ? value.slotValue.slice(2).toLowerCase() : value.slotValue.toLowerCase())) {
      return { ok: false, exit: 1, reason: 'bad_receipt' };
    }
    if (!/^[0-9a-f]*$/.test(value.slotValue.startsWith('0x') ? value.slotValue.slice(2) : value.slotValue)) {
      return { ok: false, exit: 1, reason: 'bad_receipt' };
    }
    slotValue = raw;
  }
  const slotProof: { side: 'left' | 'right'; hash: string }[] = [];
  if (hasOwn(value, 'slotProof')) {
    if (!Array.isArray(value.slotProof)) return { ok: false, exit: 1, reason: 'bad_receipt' };
    for (const step of value.slotProof) {
      if (!isPlain(step)) return { ok: false, exit: 1, reason: 'bad_receipt' };
      if (step.side !== 'left' && step.side !== 'right') return { ok: false, exit: 1, reason: 'bad_receipt' };
      const hash = typeof step.hash === 'string' ? normHash(step.hash) : null;
      if (!hash) return { ok: false, exit: 1, reason: 'bad_receipt' };
      slotProof.push({ side: step.side, hash });
    }
  }
  return {
    ok: true,
    receipt: {
      index: value.index,
      epoch: value.epoch,
      contract: normHex(value.contract, 20) as string,
      proof,
      slotValue,
      slotProof,
      lineHex: lineBody,
    },
  };
}

export function treeSizeFromHead(size: bigint): { ok: true; size: number } | { ok: false; reason: 'tree_size_above_cap' } {
  if (size < 0n || size > BigInt(MAX_TREE_SIZE)) return { ok: false, reason: 'tree_size_above_cap' };
  return { ok: true, size: Number(size) };
}

/**
 * The trusted anchor sender. `rotatedTo` is the address a checkpoint
 * rotation would name. It is ignored: v0 rotation does not raise trust.
 */
export function trustedSender(pin: { checkpoint: string }, rotatedTo: string | null): string {
  void rotatedTo;
  return pin.checkpoint;
}

function safeUint(value: unknown): number | null {
  if (!isJsonInteger(value) || value < 0) return null;
  return value;
}

export function contractsFromPayload(payload: unknown): { ok: true; pins: ContractPin[] } | { ok: false; reason: 'snapshot_contracts_invalid' } {
  if (!isPlain(payload) || !hasOwn(payload, 'contracts')) return { ok: true, pins: [] };
  const list = payload.contracts;
  if (!Array.isArray(list)) return { ok: false, reason: 'snapshot_contracts_invalid' };
  const pins: ContractPin[] = [];
  for (const item of list) {
    if (!isPlain(item)) return { ok: false, reason: 'snapshot_contracts_invalid' };
    const keys = Object.keys(item);
    if (keys.length !== PIN_KEYS.length || PIN_KEYS.some((key) => !hasOwn(item, key))) {
      return { ok: false, reason: 'snapshot_contracts_invalid' };
    }
    const chainId = safeUint(item.chainId);
    const address = typeof item.address === 'string' ? normHex(item.address, 20) : null;
    const codeHash = typeof item.codeHash === 'string' ? normHex(item.codeHash, 32) : null;
    const predecessor = typeof item.predecessor === 'string' ? normHex(item.predecessor, 20) : null;
    const checkpoint = typeof item.checkpoint === 'string' ? normHex(item.checkpoint, 20) : null;
    const genesis = safeUint(item.genesisHourStart);
    let retire: number | null = null;
    if (item.retireHourStart !== null) {
      retire = safeUint(item.retireHourStart);
      if (retire == null) return { ok: false, reason: 'snapshot_contracts_invalid' };
    }
    if (chainId == null || !address || !codeHash || !predecessor || !checkpoint || genesis == null) {
      return { ok: false, reason: 'snapshot_contracts_invalid' };
    }
    if (retire != null && retire < genesis) return { ok: false, reason: 'snapshot_contracts_invalid' };
    pins.push({
      chainId, address, codeHash, predecessor, checkpoint, genesisHourStart: genesis, retireHourStart: retire,
    });
  }
  return { ok: true, pins };
}

function pinKey(chainId: number, address: string): string {
  return `${chainId}:${address}`;
}

export function readNarrowing(value: unknown): { ok: true; rows: NarrowRow[] } | { ok: false; reason: 'extension_widens_pin' } {
  if (value == null) return { ok: true, rows: [] };
  if (!Array.isArray(value)) return { ok: false, reason: 'extension_widens_pin' };
  const rows: NarrowRow[] = [];
  for (const item of value) {
    if (!isPlain(item)) return { ok: false, reason: 'extension_widens_pin' };
    for (const key of Object.keys(item)) {
      if (!NARROW_KEYS.has(key)) return { ok: false, reason: 'extension_widens_pin' };
    }
    if (!hasOwn(item, 'chainId') || !hasOwn(item, 'address')) return { ok: false, reason: 'extension_widens_pin' };
    const chainId = safeUint(item.chainId);
    const address = typeof item.address === 'string' ? normHex(item.address, 20) : null;
    if (chainId == null || !address) return { ok: false, reason: 'extension_widens_pin' };
    let revoke: number | null = null;
    let retire: number | null = null;
    if (hasOwn(item, 'revokeAfterEpoch')) {
      revoke = safeUint(item.revokeAfterEpoch);
      if (revoke == null) return { ok: false, reason: 'extension_widens_pin' };
    }
    if (hasOwn(item, 'retireHourStart')) {
      retire = safeUint(item.retireHourStart);
      if (retire == null) return { ok: false, reason: 'extension_widens_pin' };
    }
    if (revoke == null && retire == null) return { ok: false, reason: 'extension_widens_pin' };
    rows.push({ chainId, address, revokeAfterEpoch: revoke, retireHourStart: retire });
  }
  return { ok: true, rows };
}

export function applyNarrowing(
  pins: ContractPin[],
  rows: NarrowRow[],
): { ok: true; pins: ContractPin[]; revokeAfter: Map<string, number> } | { ok: false; reason: 'extension_widens_pin' } {
  const next = pins.map((pin) => ({ ...pin }));
  const byKey = new Map(next.map((pin) => [pinKey(pin.chainId, pin.address), pin]));
  const revokeAfter = new Map<string, number>();
  for (const row of rows) {
    const pin = byKey.get(pinKey(row.chainId, row.address));
    if (!pin) return { ok: false, reason: 'extension_widens_pin' };
    if (row.retireHourStart != null) {
      if (pin.retireHourStart != null && row.retireHourStart > pin.retireHourStart) {
        return { ok: false, reason: 'extension_widens_pin' };
      }
      pin.retireHourStart = pin.retireHourStart == null
        ? row.retireHourStart
        : Math.min(pin.retireHourStart, row.retireHourStart);
    }
    if (row.revokeAfterEpoch != null) {
      const key = pinKey(row.chainId, row.address);
      const prior = revokeAfter.get(key);
      revokeAfter.set(key, prior == null ? row.revokeAfterEpoch : Math.min(prior, row.revokeAfterEpoch));
    }
  }
  return { ok: true, pins: next, revokeAfter };
}

export function usdcFor(chainId: number): string | null {
  return USDC[chainId] ?? null;
}

function wordBig(hex: string): bigint | null {
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  return BigInt(`0x${hex}`);
}

export function decodeAnchoredData(data: string): { size: bigint; root: string; stateRoot: string; kind: number } | null {
  const body = data.startsWith('0x') ? data.slice(2) : data;
  if (!/^[0-9a-f]{256}$/.test(body)) return null;
  const size = wordBig(body.slice(0, 64));
  const root = body.slice(64, 128);
  const stateRoot = body.slice(128, 192);
  const kindWord = wordBig(body.slice(192, 256));
  if (size == null || kindWord == null || kindWord > 255n) return null;
  return { size, root, stateRoot, kind: Number(kindWord) };
}

export function topicUint(value: bigint): string | null {
  if (value < 0n || value > 0xffffffffffffffffn) return null;
  return `0x${value.toString(16).padStart(64, '0')}`;
}

function sameTopic(got: string, want: string): boolean {
  return got.toLowerCase() === want.toLowerCase();
}

export function anchoredFromLog(log: {
  address?: string;
  topics?: string[];
  data?: string;
  blockNumber?: number;
  blockHash?: string;
  transactionHash?: string;
  logIndex?: number;
}): AnchoredEvent | null {
  if (!log.topics || log.topics.length < 3 || !log.address || !log.data) return null;
  if (!sameTopic(log.topics[0], ANCHORED_TOPIC0)) return null;
  const epochBody = normHash(log.topics[1]);
  const hourBody = normHash(log.topics[2]);
  const decoded = decodeAnchoredData(log.data);
  const address = normHex(log.address, 20);
  const blockHash = typeof log.blockHash === 'string' ? normHex(log.blockHash, 32) : null;
  const txHash = typeof log.transactionHash === 'string' ? normHex(log.transactionHash, 32) : null;
  if (!epochBody || !hourBody || !decoded || !address || !blockHash || !txHash) return null;
  if (!isJsonInteger(log.blockNumber) || log.blockNumber < 0) return null;
  if (!isJsonInteger(log.logIndex) || log.logIndex < 0) return null;
  return {
    epoch: BigInt(`0x${epochBody}`),
    hourStart: BigInt(`0x${hourBody}`),
    size: decoded.size,
    root: decoded.root,
    stateRoot: decoded.stateRoot,
    kind: decoded.kind,
    blockNumber: log.blockNumber,
    blockHash,
    txHash,
    logIndex: log.logIndex,
    address,
  };
}

function covers(event: AnchoredEvent, index: number, finalizedNumber: number): boolean {
  return event.blockNumber <= finalizedNumber && event.size > BigInt(index);
}

export function firstCovering(events: AnchoredEvent[], index: number, finalizedNumber: number): AnchoredEvent | null {
  const found = events.filter((event) => covers(event, index, finalizedNumber));
  found.sort((a, b) => {
    if (a.epoch < b.epoch) return -1;
    if (a.epoch > b.epoch) return 1;
    return a.logIndex - b.logIndex;
  });
  return found[0] ?? null;
}

export function firstHourly(events: AnchoredEvent[], index: number, finalizedNumber: number): AnchoredEvent | null {
  const found = events.filter((event) => covers(event, index, finalizedNumber) && event.kind === KIND_HOURLY);
  found.sort((a, b) => {
    if (a.epoch < b.epoch) return -1;
    if (a.epoch > b.epoch) return 1;
    return a.logIndex - b.logIndex;
  });
  return found[0] ?? null;
}

function hourInCoverage(pin: ContractPin, hourStart: number): boolean {
  if (hourStart < pin.genesisHourStart) return false;
  if (pin.retireHourStart != null && hourStart > pin.retireHourStart) return false;
  return true;
}

export function classifyCanonical(input: {
  rpcError: boolean;
  block: { number: number; hash: string } | null;
  finalizedNumber: number | null;
  canonicalHash: string | null;
  wantHash: string;
}): 'unreachable' | 'unknown_block' | 'not_final' | 'reorged' | 'finality_unavailable' | 'ok' {
  if (input.rpcError) return 'unreachable';
  if (!input.block) return 'unknown_block';
  if (input.finalizedNumber == null) return 'finality_unavailable';
  if (input.block.number > input.finalizedNumber) return 'not_final';
  if (!input.canonicalHash || input.canonicalHash.toLowerCase() !== input.block.hash.toLowerCase()) return 'reorged';
  if (input.block.hash.toLowerCase() !== input.wantHash.toLowerCase()) return 'reorged';
  return 'ok';
}

function padAddress(address: string): string {
  return `0x${address.slice(2).toLowerCase().padStart(64, '0')}`;
}

function padWord(value: bigint): string {
  return `0x${value.toString(16).padStart(64, '0')}`;
}

export function paymentStatus(line: LineView, payment: PaymentView): 'wrong_block_hash' | 'payment_mismatch' | 'ok' {
  if (payment.blockHash.toLowerCase() !== line.blockHash.toLowerCase()) return 'wrong_block_hash';
  if (!payment.txIndexMatch) return 'payment_mismatch';
  const usdc = usdcFor(line.chainId);
  if (!usdc) return 'payment_mismatch';
  const transfer = payment.logs.find((log) => log.index === line.localLogIndex);
  if (!transfer) return 'payment_mismatch';
  if (transfer.address.toLowerCase() !== usdc) return 'payment_mismatch';
  if (transfer.topics.length < 3) return 'payment_mismatch';
  if (transfer.topics[0].toLowerCase() !== TRANSFER_TOPIC0) return 'payment_mismatch';
  if (transfer.topics[1].toLowerCase() !== padAddress(line.from)) return 'payment_mismatch';
  if (transfer.topics[2].toLowerCase() !== padAddress(line.to)) return 'payment_mismatch';
  const data = normHash(transfer.data.startsWith('0x') ? transfer.data : `0x${transfer.data}`);
  if (!data || BigInt(`0x${data}`) !== line.value) return 'payment_mismatch';
  if (line.token.toLowerCase() !== usdc) return 'payment_mismatch';
  if (line.method === METHOD_3009) {
    if (line.localLogIndex < 1) return 'payment_mismatch';
    const auth = payment.logs.find((log) => log.index === line.localLogIndex - 1);
    if (!auth || auth.address.toLowerCase() !== usdc || auth.topics.length < 3) return 'payment_mismatch';
    if (auth.topics[0].toLowerCase() !== AUTHORIZATION_USED_TOPIC0) return 'payment_mismatch';
    if (auth.topics[1].toLowerCase() !== padAddress(line.authorizer)) return 'payment_mismatch';
    if (auth.topics[2].toLowerCase() !== line.nonce.toLowerCase()) return 'payment_mismatch';
    return 'ok';
  }
  if (line.method === METHOD_PERMIT2) {
    if (!payment.txTo || payment.txTo.toLowerCase() !== PERMIT2_ADDRESS) return 'payment_mismatch';
    const input = payment.input.startsWith('0x') ? payment.input : `0x${payment.input}`;
    if (!input.toLowerCase().startsWith(PERMIT2_SELECTOR)) return 'payment_mismatch';
    const nonce = line.nonce.slice(2).toLowerCase();
    if (!input.toLowerCase().includes(nonce)) return 'payment_mismatch';
    return 'ok';
  }
  return 'payment_mismatch';
}

function safeHour(value: bigint): number | null {
  if (value < 0n || value > BigInt(MAX_TREE_SIZE)) return null;
  return Number(value);
}

export function runV13(receipt: unknown, world: V13World, hooks: V13Hooks): V13Result {
  const parsed = parseV13Receipt(receipt);
  if (!parsed.ok) {
    const reason = parsed.reason;
    const shape = reason === 'caller_supplied_leaf' || reason === 'caller_supplied_tree_size' || reason === 'bad_receipt';
    return fail(1, reason, world, { shape: shape ? 'fail' : 'pass' }, messageOf(reason));
  }
  if (!world.snapshotSigned) {
    return fail(1, 'snapshot_signature_invalid', world, { key_window: 'fail' }, messageOf('snapshot_signature_invalid'));
  }
  if (!world.history.ok) {
    const reason = world.history.reason || 'issuer_history_invalid';
    return fail(1, reason, world, { key_window: 'fail' }, messageOf(reason));
  }
  const listed = contractsFromPayload(world.bundledPayload);
  if (!listed.ok) return fail(1, listed.reason, world, { key_window: 'fail' }, messageOf(listed.reason));
  const narrowing = readNarrowing(world.narrowing);
  if (!narrowing.ok) return fail(1, narrowing.reason, world, { key_window: 'fail' }, messageOf(narrowing.reason));
  const applied = applyNarrowing(listed.pins, narrowing.rows);
  if (!applied.ok) return fail(1, applied.reason, world, { key_window: 'fail' }, messageOf(applied.reason));
  if (!world.line) {
    return fail(1, 'bad_line', world, { shape: 'fail' }, world.lineReason || messageOf('bad_line'));
  }
  const pin = applied.pins.find((item) => item.chainId === world.line?.chainId && item.address === parsed.receipt.contract) ?? null;
  if (!pin) return fail(2, 'contract_not_pinned', world, { anchor: 'could_not_check' }, messageOf('contract_not_pinned'));
  if (!world.rpcConfigured) return fail(2, 'rpc_unconfigured', world, { anchor: 'could_not_check' }, messageOf('rpc_unconfigured'));
  if (world.canonical === 'unreachable') return fail(2, 'rpc_unreachable', world, { anchor: 'could_not_check' }, messageOf('rpc_unreachable'));
  if (world.finalizedNumber == null) return fail(2, 'finality_unavailable', world, { anchor: 'could_not_check' }, messageOf('finality_unavailable'));
  const head = firstCovering(world.events, parsed.receipt.index, world.finalizedNumber);
  if (!head) return fail(2, 'pre_anchor', world, { anchor: 'could_not_check', log_inclusion: 'could_not_check' }, messageOf('pre_anchor'));
  const sized = treeSizeFromHead(head.size);
  if (!sized.ok) return fail(1, 'tree_size_above_cap', world, { log_inclusion: 'fail' }, messageOf('tree_size_above_cap'));
  if (head.epoch !== BigInt(parsed.receipt.epoch)) {
    return fail(1, 'not_first_anchor', world, { anchor: 'fail' }, messageOf('not_first_anchor'));
  }
  const priors = world.events.filter((event) => event.epoch === head.epoch - 1n && event.blockNumber <= (world.finalizedNumber as number));
  priors.sort((a, b) => b.logIndex - a.logIndex);
  const prior = priors[0];
  if (head.epoch > 0n && prior && prior.size > BigInt(parsed.receipt.index)) {
    return fail(1, 'not_first_anchor', world, { anchor: 'fail' }, messageOf('not_first_anchor'));
  }
  const sender = trustedSender(pin, world.rotatedTo);
  if (!world.anchorFrom || !world.anchorTo || world.anchorFrom.toLowerCase() !== sender.toLowerCase() || world.anchorTo.toLowerCase() !== pin.address) {
    return fail(1, 'anchor_sender_mismatch', world, { anchor: 'fail' }, messageOf('anchor_sender_mismatch'));
  }
  if (!world.codeHash) return fail(2, 'code_unreadable', world, { anchor: 'could_not_check' }, messageOf('code_unreadable'));
  if (world.codeHash.toLowerCase() !== pin.codeHash.toLowerCase()) {
    return fail(1, 'code_hash_mismatch', world, { anchor: 'fail' }, messageOf('code_hash_mismatch'));
  }
  if (world.chainGenesis != null && world.chainGenesis !== pin.genesisHourStart) {
    return fail(1, 'hour_outside_coverage', world, { anchor: 'fail' }, messageOf('hour_outside_coverage'));
  }
  const hour = safeHour(head.hourStart);
  if (hour == null || !hourInCoverage(pin, hour)) {
    return fail(1, 'hour_outside_coverage', world, { anchor: 'fail' }, messageOf('hour_outside_coverage'));
  }
  const revoke = applied.revokeAfter.get(pinKey(pin.chainId, pin.address));
  if (revoke != null && parsed.receipt.epoch > revoke) {
    return fail(1, 'revoked_after_epoch', world, { anchor: 'fail' }, messageOf('revoked_after_epoch'));
  }
  if (pin.predecessor !== ZERO_ADDRESS) {
    if (world.successor === 'unreadable') return fail(2, 'successor_unreadable', world, { anchor: 'could_not_check' }, messageOf('successor_unreadable'));
    if (world.successor !== 'match') return fail(1, 'lineage_successor_mismatch', world, { anchor: 'fail' }, messageOf('lineage_successor_mismatch'));
  }
  const leaf = hooks.leafHash(world.line.bytes);
  if (!leaf.ok) return fail(1, 'bad_line', world, { shape: 'fail' }, messageOf('bad_line'));
  const included = hooks.verifyInclusion(bytesToHex(leaf.hash), parsed.receipt.index, sized.size, head.root, parsed.receipt.proof);
  if (!included.ok) return fail(1, 'not_in_log', world, { log_inclusion: 'fail' }, messageOf('not_in_log'));
  const hourly = firstHourly(world.events, parsed.receipt.index, world.finalizedNumber);
  const stateRoot = hourly ? hourly.stateRoot : head.stateRoot;
  const proven = hooks.proveKey(stateRoot);
  if (!proven && !hourly) {
    return fail(2, 'pending_hourly_close', world, { signature: 'could_not_check' }, messageOf('pending_hourly_close'));
  }
  if (!proven) return fail(1, 'key_status_unproven', world, { signature: 'fail' }, messageOf('key_status_unproven'));
  if (!hooks.sigmaOk()) return fail(1, 'sigma_invalid', world, { signature: 'fail' }, messageOf('sigma_invalid'));
  if (world.canonical === 'unknown_block') return fail(2, 'unknown_block', world, { payment_binding: 'could_not_check' }, messageOf('unknown_block'));
  if (world.canonical === 'not_final') return fail(2, 'block_not_final', world, { payment_binding: 'could_not_check' }, messageOf('block_not_final'));
  if (world.canonical === 'finality_unavailable') return fail(2, 'finality_unavailable', world, { payment_binding: 'could_not_check' }, messageOf('finality_unavailable'));
  if (world.canonical === 'reorged') return fail(1, 'reorged', world, { payment_binding: 'fail' }, messageOf('reorged'));
  if (!world.payment) return fail(2, 'rpc_unreachable', world, { payment_binding: 'could_not_check' }, messageOf('rpc_unreachable'));
  const paid = paymentStatus(world.line, world.payment);
  if (paid === 'wrong_block_hash') return fail(1, 'wrong_block_hash', world, { payment_binding: 'fail' }, messageOf('wrong_block_hash'));
  if (paid !== 'ok') return fail(1, 'payment_mismatch', world, { payment_binding: 'fail' }, messageOf('payment_mismatch'));
  return {
    exit: 0,
    reason: null,
    message: 'Every check passed.',
    prints: [
      'payment: chain-proven',
      'content: seller-attested; seller may be the agent',
      'uniqueness: see statement',
      `hour: ${hour}`,
      `window: [${world.line.blockNumber}, ${head.blockNumber}]`,
    ],
    liveExtension: world.liveExtension,
    checks: PASS,
    history: world.history,
    hourStart: hour,
    anchorBlock: head.blockNumber,
    paymentBlock: world.line.blockNumber,
  };
}

export { padAddress, padWord };
