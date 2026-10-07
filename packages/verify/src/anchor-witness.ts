/**
 * Check a receipt leaf against a signed tree head, then against the two
 * anchors that publish that root: an SPL Memo on Solana and calldata on Base.
 *
 * Inclusion is local. The chain checks use the RPC you pass. A matching memo
 * and matching calldata show the issuer published this root. They do not show
 * the payment.
 */
import { createHash } from 'node:crypto';
import { AbiCoder, Interface, getBytes, hashMessage, keccak256, recoverAddress, toUtf8Bytes } from 'ethers';
import { EPOCH1_FINAL_ROOT } from './epoch.js';
import { BASE_RPC_URL } from './base-payer.js';
import { verifyEpochLink, verifyEpochRecord, type EpochRecord } from './epoch.js';
import { fetchSolanaTransaction, SOLANA_RPC_URL } from './solana-payer.js';

export const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export const MEMO_PROGRAM_ID_V1 = 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo';

/**
 * Full `getGenesisHash` values. CAIP-2 references keep only the first 32
 * characters, and `getGenesisHash` returns the whole base58 hash. A prefix
 * compare never matches mainnet-beta.
 */
export const SOLANA_GENESIS: Record<string, string> = {
  'mainnet-beta': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
  testnet: '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY',
};

export const BASE_MAINNET_CHAIN_ID = 8453;

export const ANCHOR_PROVES = [
  'This receipt leaf is inside the issuer append-only tree of the stated size, under the stated root.',
  'The Solana transaction memo contains that root, and the RPC genesis hash is the cluster named on the head.',
  'The Base transaction calldata is that same root, on chain id 8453.',
];

export const ANCHOR_DOES_NOT_PROVE = [
  'It does not prove the payment, the payer, the payee, or the model output.',
  'It does not prove a receipt appended after this tree size is inside the root.',
  'It does not prove the issuer included only honest rows. It proves this leaf hashes into the published root.',
  'It does not prove the RPC itself is honest. It checks the transaction and genesis hash that RPC returned.',
];

export interface InclusionStep {
  hash: string;
  position: string;
}

export interface AnchorReceipt {
  task_id?: string;
  row_hash?: string | null;
  book_chain?: { row_hash?: string | null } | null;
}

export interface AnchorInclusion {
  task_id?: string;
  leaf_index: number;
  tree_size: number;
  root: string;
  leaf?: string;
  row_hash?: string | null;
  proof: InclusionStep[];
}

export interface AnchorHead {
  root: string;
  tree_size?: number;
  epoch?: number | null;
  prev_epoch_root?: string | null;
  prev_epoch_size?: number | null;
  anchor_tx?: string | null;
  anchor?: { tx?: string | null; calldata?: string | null; chain_id?: number | null } | null;
  anchors?: {
    base?: { tx?: string | null; calldata?: string | null; chain_id?: number | null; status?: string } | null;
    solana?: {
      signature?: string | null;
      slot?: number | null;
      cluster?: string | null;
      memo?: string | null;
      status?: string | null;
    } | null;
  } | null;
}

interface SolanaIx {
  program?: string;
  programId?: string;
  parsed?: string | { memo?: string; info?: string };
}

export interface SolanaAnchorTx {
  slot?: number;
  meta?: {
    err?: unknown;
    logMessages?: string[];
    innerInstructions?: Array<{ instructions?: SolanaIx[] }>;
  } | null;
  transaction?: { message?: { instructions?: SolanaIx[] } };
}

export interface BaseAnchorTx {
  hash?: string;
  input?: string;
  chainId?: number;
}

export interface AnchorWitnessResult {
  overall: 'verified' | 'partial' | 'failed';
  root: string | null;
  inclusion: { valid: boolean; leaf: string | null; leaf_source: string; reason?: string };
  solana: {
    checked: boolean;
    valid: boolean;
    signature: string | null;
    slot: number | null;
    cluster: string | null;
    memo: string | null;
    reason?: string;
  };
  base: {
    checked: boolean;
    valid: boolean;
    tx: string | null;
    chain_id: number | null;
    reason?: string;
  };
  witness: {
    checked: boolean;
    valid: boolean;
    configured: boolean;
    address: string | null;
    epoch: number | null;
    size: number | null;
    root: string | null;
    reason?: string;
  };
  proves: string[];
  does_not_prove: string[];
  errors: string[];
}

function sha256(buf: Uint8Array): Buffer {
  return createHash('sha256').update(buf).digest();
}

export function leafHash(bytes: Uint8Array): Buffer {
  return sha256(Buffer.concat([Buffer.from([0x00]), Buffer.from(bytes)]));
}

function nodeHash(left: Uint8Array, right: Uint8Array): Buffer {
  return sha256(Buffer.concat([Buffer.from([0x01]), left, right]));
}

export function normalizeRoot(root: string | null | undefined): string | null {
  const hex = String(root || '').replace(/^0x/, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}

/** RFC 6962-style inclusion. Same rule as the gateway tree. */
export function verifyMerkleInclusion(
  leaf: Buffer,
  index: number,
  treeSize: number,
  rootHex: string,
  proof: InclusionStep[],
): boolean {
  if (!Array.isArray(proof) || index < 0 || index >= treeSize) return false;
  let hash: Uint8Array = new Uint8Array(leaf);
  for (const step of proof) {
    if (!step || !/^[0-9a-fA-F]{64}$/.test(step.hash)) return false;
    const sib = Buffer.from(step.hash, 'hex');
    const next = step.position === 'left' ? nodeHash(sib, hash) : nodeHash(hash, sib);
    hash = new Uint8Array(next);
  }
  return Buffer.from(hash).toString('hex') === String(rootHex).replace(/^0x/, '').toLowerCase();
}

function parseNode(hexNode: string): Buffer | null {
  const hex = String(hexNode || '').replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  return Buffer.from(hex, 'hex');
}

function isPow2(n: number): boolean {
  if (!Number.isSafeInteger(n) || n < 1) return false;
  let x = n;
  while (x % 2 === 0) x = Math.floor(x / 2);
  return x === 1;
}

function shr1(n: number): number {
  return Math.floor(n / 2);
}

function lsb(n: number): boolean {
  return n % 2 === 1;
}

/**
 * RFC 9162 §2.1.4.2. `proof` is the RFC node list. It does not include the
 * old root. `m == n` requires an empty proof and equal roots.
 * Shifts are `Math.floor(n / 2)`. A JavaScript `>>=` would truncate at 2^31.
 * Sizes that are not safe integers are rejected.
 */
export function verifyConsistency(
  m: number,
  n: number,
  oldRoot: string,
  newRoot: string,
  proof: string[],
): boolean {
  const old = parseNode(oldRoot);
  const next = parseNode(newRoot);
  if (!old || !next || !Number.isSafeInteger(m) || !Number.isSafeInteger(n) || m < 1 || n < m) return false;
  if (m === n) return old.equals(next) && (!proof || proof.length === 0);
  if (!Array.isArray(proof) || proof.length === 0) return false;
  const nodes: Buffer[] = [];
  if (isPow2(m)) nodes.push(old);
  for (const step of proof) {
    const parsed = parseNode(step);
    if (!parsed) return false;
    nodes.push(parsed);
  }
  if (!nodes.length) return false;
  let fn = m - 1;
  let sn = n - 1;
  while (lsb(fn)) {
    fn = shr1(fn);
    sn = shr1(sn);
  }
  let fr: Uint8Array = nodes[0];
  let sr: Uint8Array = nodes[0];
  for (let i = 1; i < nodes.length; i += 1) {
    if (sn === 0) return false;
    const c = nodes[i];
    if (lsb(fn) || fn === sn) {
      fr = nodeHash(c, fr);
      sr = nodeHash(c, sr);
      if (!lsb(fn)) {
        while (!lsb(fn) && fn !== 0) {
          fn = shr1(fn);
          sn = shr1(sn);
        }
      }
    } else {
      sr = nodeHash(sr, c);
    }
    fn = shr1(fn);
    sn = shr1(sn);
  }
  return sn === 0 && Buffer.from(fr).equals(old) && Buffer.from(sr).equals(next);
}

const WITNESS_HEAD = new Interface([
  'function head() view returns (uint256 epoch, uint256 size, bytes32 root)',
]);

/** Runtime code hash of ChitLogWitness, solc 0.8.24, optimizer 200. */
export const CHIT_LOG_WITNESS_CODEHASH = '0xde755e00171330aa511c157d3fb1134691fddd3e299c600f67c2e7af53562e1a';

/** Init code without constructor args. Address and creation tx are unset until deploy. */
export const CHIT_LOG_WITNESS_INIT_CODE_HASH = '0x5fa3f199791d61eff4f4c5097f736ce3cb047e2784b5e3c51044a08d52381b56';
export const CHIT_LOG_WITNESS_INIT_CODE_BYTES = 8769;
export const CHIT_LOG_WITNESS_ADDRESS_PIN: string | null = null;

/** Domain tag for a witness countersignature. Not the registration tag. */
export const WITNESS_COUNTERSIGN_DOMAIN = keccak256(toUtf8Bytes('chit.logWitness.countersign.v1'));

export interface WitnessCountersign {
  id: string;
  epoch: number | bigint;
  key: string;
  url: string;
  treeSize: number | bigint;
  root: string;
  chainId: number | bigint;
  registry: string;
}

export interface WitnessRow {
  key?: string | null;
  url?: string | null;
  id?: string | null;
}

function hex32(value: string): string {
  const raw = String(value || '').replace(/^0x/, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(raw)) return '';
  return `0x${raw}`;
}

/**
 * EIP-191 digest over the witness key, its URL, the directory row id, and
 * the directory epoch, plus the log head. chainId and registry keep it off
 * another chain or another contract. A registration signature is a different tag.
 */
export function countersignDigest(claim: WitnessCountersign): string {
  const url = String(claim.url || '');
  const id = hex32(claim.id);
  const root = hex32(claim.root);
  const inner = keccak256(AbiCoder.defaultAbiCoder().encode(
    ['bytes32', 'uint256', 'address', 'bytes32', 'uint256', 'address', 'bytes32', 'uint256', 'bytes32'],
    [
      WITNESS_COUNTERSIGN_DOMAIN,
      BigInt(claim.chainId),
      claim.registry,
      id,
      BigInt(claim.epoch),
      claim.key,
      keccak256(toUtf8Bytes(url)),
      BigInt(claim.treeSize),
      root,
    ],
  ));
  return hashMessage(getBytes(inner));
}

/**
 * Refuse unless the signature names this row's key and URL. The signer must
 * be that key. A different row, a different epoch, or a registration signature
 * does not pass.
 */
export function countersignatureMatches(
  row: WitnessRow,
  claim: WitnessCountersign,
  signature: string,
): { ok: boolean; reason?: string } {
  const url = String(claim?.url || '');
  const key = String(claim?.key || '').toLowerCase();
  const rowKey = String(row?.key || '').toLowerCase();
  const rowUrl = String(row?.url || '');
  if (!key || key === '0x0000000000000000000000000000000000000000') {
    return { ok: false, reason: 'witness_countersign_key' };
  }
  if (!url || !rowUrl || url !== rowUrl) return { ok: false, reason: 'witness_countersign_url' };
  if (key !== rowKey) return { ok: false, reason: 'witness_countersign_key' };
  const id = keccak256(toUtf8Bytes(url));
  if (!hex32(claim.id) || hex32(claim.id) !== id) return { ok: false, reason: 'witness_countersign_row' };
  if (row.id && hex32(row.id) !== id) return { ok: false, reason: 'witness_countersign_row' };
  let recovered = '';
  try {
    recovered = recoverAddress(countersignDigest(claim), signature).toLowerCase();
  } catch {
    return { ok: false, reason: 'witness_countersign_signer' };
  }
  if (recovered !== key) return { ok: false, reason: 'witness_countersign_signer' };
  return { ok: true };
}
export const CHIT_LOG_WITNESS_CREATION_TX_PIN: string | null = null;

export interface WitnessCreation {
  input?: string | null;
  hash?: string | null;
  receipt?: { status?: string | number | null; contractAddress?: string | null } | null;
}

export function witnessCreationMatches(
  input: string | null | undefined,
  receipt: WitnessCreation['receipt'],
  address: string,
): { ok: boolean; reason?: string } {
  const raw = String(input || '').toLowerCase();
  if (!raw.startsWith('0x')) return { ok: false, reason: 'witness_creation_input' };
  const body = raw.slice(2);
  const prefixLen = CHIT_LOG_WITNESS_INIT_CODE_BYTES * 2;
  if (body.length <= prefixLen) return { ok: false, reason: 'witness_creation_input' };
  const prefix = `0x${body.slice(0, prefixLen)}`;
  try {
    if (keccak256(prefix).toLowerCase() !== CHIT_LOG_WITNESS_INIT_CODE_HASH) {
      return { ok: false, reason: 'witness_creation_input' };
    }
  } catch {
    return { ok: false, reason: 'witness_creation_input' };
  }
  let decoded: readonly [string, string, bigint, bigint, string];
  try {
    decoded = AbiCoder.defaultAbiCoder().decode(
      ['address', 'address', 'uint256', 'uint256', 'bytes32'],
      `0x${body.slice(prefixLen)}`,
    ) as unknown as readonly [string, string, bigint, bigint, string];
  } catch {
    return { ok: false, reason: 'witness_creation_args' };
  }
  const epoch = Number(decoded[2]);
  const size = Number(decoded[3]);
  const root = String(decoded[4]).replace(/^0x/, '').toLowerCase();
  if (epoch !== 1 || size !== 4 || root !== EPOCH1_FINAL_ROOT) return { ok: false, reason: 'witness_creation_args' };
  if (String(decoded[0]).toLowerCase() === '0x0000000000000000000000000000000000000000') {
    return { ok: false, reason: 'witness_creation_args' };
  }
  const created = String(receipt?.contractAddress || '').toLowerCase();
  if (!created || created !== String(address || '').toLowerCase()) return { ok: false, reason: 'witness_creation_address' };
  const status = receipt?.status;
  if (!(status === '0x1' || status === 1 || status === '0x01')) return { ok: false, reason: 'witness_creation_receipt' };
  return { ok: true };
}

export async function fetchWitnessCreation(txHash: string, rpcUrl: string): Promise<WitnessCreation | null> {
  const tx = await defaultRpc(rpcUrl, 'eth_getTransactionByHash', [txHash]) as { input?: string; hash?: string } | null;
  if (!tx) return null;
  const receipt = await defaultRpc(rpcUrl, 'eth_getTransactionReceipt', [txHash]) as WitnessCreation['receipt'];
  return { input: tx.input || null, hash: tx.hash || txHash, receipt: receipt || null };
}

export async function fetchWitnessCode(address: string, rpcUrl: string): Promise<string | null> {
  const code = await defaultRpc(rpcUrl, 'eth_getCode', [address, 'latest']) as string | null;
  return typeof code === 'string' ? code : null;
}

export function witnessCodeMatches(bytecode: string | null | undefined): boolean {
  const code = String(bytecode || '');
  if (!code || code === '0x') return false;
  try {
    return keccak256(code).toLowerCase() === CHIT_LOG_WITNESS_CODEHASH;
  } catch {
    return false;
  }
}

export interface WitnessHead {
  epoch: number;
  size: number;
  root: string;
}

export async function fetchWitnessHead(address: string, rpcUrl: string): Promise<WitnessHead | null> {
  const data = WITNESS_HEAD.encodeFunctionData('head', []);
  const raw = await defaultRpc(rpcUrl, 'eth_call', [{ to: address, data }, 'latest']) as string | null;
  if (!raw || raw === '0x') return null;
  const [epoch, size, root] = WITNESS_HEAD.decodeFunctionResult('head', raw);
  return {
    epoch: Number(epoch),
    size: Number(size),
    root: String(root).replace(/^0x/, '').toLowerCase(),
  };
}

export interface ParsedAnchorMemo {
  version?: 1 | 2;
  scope: string;
  day: string;
  root: string;
  prev: string;
  epoch?: number;
  prev_epoch_root?: string;
  prev_epoch_size?: number;
  bundle_index_hash?: string;
}

function memoIdentity(scope: string, day: string, root: string, prev: string): ParsedAnchorMemo | null {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(scope)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  if (!/^[0-9a-f]{64}$/.test(root) || !/^[0-9a-f]{64}$/.test(prev)) return null;
  return { scope, day, root, prev };
}

/** v1 memos stay valid. v2 adds epoch, prev_epoch_root, prev_epoch_size, and the bundle index hash. */
export function parseAnchorMemo(memo: string): ParsedAnchorMemo | null {
  const parts = String(memo || '').split(':');
  if (parts[0] !== 'chit402' || parts[1] !== 'root') return null;
  if (parts.length === 7 && parts[2] === 'v1') {
    const base = memoIdentity(parts[3], parts[4], parts[5], parts[6]);
    return base ? { version: 1, ...base } : null;
  }
  if (parts.length === 11 && parts[2] === 'v2') {
    const base = memoIdentity(parts[3], parts[4], parts[5], parts[6]);
    if (!base) return null;
    const epoch = Number(parts[7]);
    const prevEpoch = parts[8];
    const size = Number(parts[9]);
    const bundle = parts[10];
    if (!Number.isInteger(epoch) || epoch < 1) return null;
    if (!/^[0-9a-f]{64}$/.test(prevEpoch) || !/^[0-9a-f]{64}$/.test(bundle)) return null;
    if (!Number.isInteger(size) || size < 0) return null;
    return {
      version: 2,
      ...base,
      epoch,
      prev_epoch_root: prevEpoch,
      prev_epoch_size: size,
      bundle_index_hash: bundle,
    };
  }
  return null;
}

function isMemoIx(ix: SolanaIx): boolean {
  const program = ix.program || '';
  const programId = ix.programId || '';
  return program === 'spl-memo'
    || programId === MEMO_PROGRAM_ID
    || programId === MEMO_PROGRAM_ID_V1;
}

export function extractMemos(tx: SolanaAnchorTx | null | undefined): string[] {
  if (!tx) return [];
  const found: string[] = [];
  const push = (value: string) => {
    if (value && !found.includes(value)) found.push(value);
  };
  const visit = (ix: SolanaIx | undefined) => {
    if (!ix || !isMemoIx(ix)) return;
    if (typeof ix.parsed === 'string') push(ix.parsed);
    else if (ix.parsed && typeof ix.parsed.memo === 'string') push(ix.parsed.memo);
    else if (ix.parsed && typeof ix.parsed.info === 'string') push(ix.parsed.info);
  };
  for (const ix of tx.transaction?.message?.instructions || []) visit(ix);
  for (const inner of tx.meta?.innerInstructions || []) {
    for (const ix of inner.instructions || []) visit(ix);
  }
  for (const line of tx.meta?.logMessages || []) {
    const match = /Memo \(len \d+\): "(.*)"/.exec(line);
    if (match) push(match[1]);
  }
  return found;
}

async function defaultRpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json() as { result?: unknown; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message || 'rpc_error');
  return json.result ?? null;
}

export async function fetchSolanaGenesisHash(rpcUrl: string): Promise<string> {
  const result = await defaultRpc(rpcUrl, 'getGenesisHash', []);
  if (typeof result !== 'string' || result.length === 0) throw new Error('no_genesis');
  return result;
}

export async function fetchBaseAnchorTransaction(txHash: string, rpcUrl: string): Promise<BaseAnchorTx | null> {
  const tx = await defaultRpc(rpcUrl, 'eth_getTransactionByHash', [txHash]) as { hash?: string; input?: string } | null;
  const chainHex = await defaultRpc(rpcUrl, 'eth_chainId', []) as string | null;
  if (!tx) return null;
  return {
    hash: tx.hash,
    input: tx.input,
    chainId: chainHex ? Number(chainHex) : undefined,
  };
}

function rowHashFrom(receipt: AnchorReceipt, inclusion: AnchorInclusion): { rowHash: string; source: 'receipt' | 'inclusion' } | null {
  if (typeof receipt.row_hash === 'string') return { rowHash: receipt.row_hash, source: 'receipt' };
  if (typeof receipt.book_chain?.row_hash === 'string') return { rowHash: receipt.book_chain.row_hash, source: 'receipt' };
  if (typeof inclusion.row_hash === 'string') return { rowHash: inclusion.row_hash, source: 'inclusion' };
  return null;
}

function solanaSignature(head: AnchorHead): string | null {
  const sol = head.anchors?.solana;
  if (!sol || sol.status === 'pending') return null;
  return sol.signature || null;
}

function baseTxHash(head: AnchorHead): string | null {
  const base = head.anchors?.base;
  if (base?.status === 'pending') return null;
  return base?.tx || head.anchor?.tx || head.anchor_tx || null;
}

export interface VerifyAnchoredRootInput {
  receipt: AnchorReceipt;
  inclusion: AnchorInclusion;
  head: AnchorHead;
  baseRpcUrl?: string;
  solanaRpcUrl?: string;
  fetchSolanaTx?: (signature: string, rpcUrl: string) => Promise<SolanaAnchorTx | null>;
  fetchGenesis?: (rpcUrl: string) => Promise<string>;
  fetchBaseTx?: (txHash: string, rpcUrl: string) => Promise<BaseAnchorTx | null>;
  epochRecord?: EpochRecord | null;
  verifyEpochSignature?: (jws: string) => boolean;
  witnessAddress?: string | null;
  consistency?: {
    first_tree_size?: number;
    second_tree_size?: number;
    first_root?: string;
    second_root?: string;
    proof?: string[];
  } | null;
  fetchWitness?: (address: string, rpcUrl: string) => Promise<WitnessHead | null>;
  fetchWitnessCode?: (address: string, rpcUrl: string) => Promise<string | null>;
  witnessCreationTx?: string | null;
  fetchWitnessCreation?: (txHash: string, rpcUrl: string) => Promise<WitnessCreation | null>;
}

/**
 * Verify inclusion, then the Solana memo and the Base calldata for that root.
 */
export async function verifyAnchoredRoot(input: VerifyAnchoredRootInput): Promise<AnchorWitnessResult> {
  const errors: string[] = [];
  const doesNotProve = [...ANCHOR_DOES_NOT_PROVE];
  const root = normalizeRoot(input.head?.root);
  const inclusionRoot = normalizeRoot(input.inclusion?.root);
  let leafHex: string | null = null;
  let leafSource = 'none';
  let inclusionValid = false;
  let inclusionReason: string | undefined;

  const taskId = input.receipt?.task_id ? String(input.receipt.task_id) : '';
  const inclusionError = (input.inclusion as { error?: string } | null | undefined)?.error;
  if (inclusionError === 'not_in_tree') {
    inclusionReason = 'not_in_tree';
  } else if (!taskId) {
    inclusionReason = 'missing_task_id';
  } else if (input.inclusion?.task_id && String(input.inclusion.task_id) !== taskId) {
    inclusionReason = 'task_mismatch';
  } else if (!root || !inclusionRoot) {
    inclusionReason = 'bad_root';
  } else if (root !== inclusionRoot) {
    inclusionReason = 'root_mismatch';
  } else if (input.head.tree_size != null && Number(input.head.tree_size) !== Number(input.inclusion.tree_size)) {
    inclusionReason = 'tree_size_mismatch';
  } else {
    const row = rowHashFrom(input.receipt, input.inclusion);
    let leaf: Buffer | null = null;
    if (row) {
      leaf = leafHash(Buffer.from(`${taskId}|${row.rowHash}`));
      leafSource = row.source;
      if (input.inclusion.leaf && input.inclusion.leaf.toLowerCase() !== leaf.toString('hex')) {
        inclusionReason = 'leaf_mismatch';
        leaf = null;
      }
    } else if (input.inclusion.leaf && /^[0-9a-fA-F]{64}$/.test(input.inclusion.leaf)) {
      leaf = Buffer.from(input.inclusion.leaf, 'hex');
      leafSource = 'inclusion';
      doesNotProve.push('The leaf was taken from the inclusion object. The receipt had no row_hash, so this check did not recompute the leaf from the receipt bytes.');
    } else {
      inclusionReason = 'no_leaf';
    }
    if (leaf) {
      leafHex = leaf.toString('hex');
      inclusionValid = verifyMerkleInclusion(
        leaf,
        Number(input.inclusion.leaf_index),
        Number(input.inclusion.tree_size),
        root,
        input.inclusion.proof || [],
      );
      if (!inclusionValid) inclusionReason = 'inclusion_failed';
    }
  }
  if (!inclusionValid && inclusionReason) errors.push(inclusionReason);

  let epochReason: string | undefined;
  if (input.head?.epoch == null) {
    const link = verifyEpochLink(input.head, null);
    if (!link.ok) epochReason = link.reason || 'epoch_missing';
  }
  const needsEpoch = input.head?.epoch != null || input.epochRecord != null;
  if (!epochReason && needsEpoch) {
    if (!input.epochRecord) epochReason = 'epoch_record_missing';
    else {
      const checked = verifyEpochRecord(input.epochRecord, { verifySignature: input.verifyEpochSignature });
      if (!checked.ok) epochReason = checked.reason || 'epoch_record';
      else if (input.head?.epoch != null && Number(input.head.epoch) > 1) {
        const prev = (input.epochRecord.epochs || []).find((row) => Number(row.epoch) === Number(input.head.epoch) - 1);
        const link = verifyEpochLink(input.head, prev ? {
          root: prev.final_root || prev.opening_root || null,
          tree_size: prev.final_size ?? prev.opening_size ?? null,
        } : null);
        if (!link.ok) epochReason = link.reason || 'epoch_link';
      } else if (input.head) {
        const link = verifyEpochLink(input.head, null);
        if (!link.ok) epochReason = link.reason || 'epoch_link';
      }
    }
  }
  if (epochReason) errors.push(epochReason);

  const solanaRpc = input.solanaRpcUrl || process.env.SOLANA_RPC_URL || SOLANA_RPC_URL;
  const baseRpc = input.baseRpcUrl || BASE_RPC_URL;
  const signature = root && inclusionValid ? solanaSignature(input.head) : null;
  const txHash = root && inclusionValid ? baseTxHash(input.head) : null;

  const solana = {
    checked: false,
    valid: false,
    signature: input.head?.anchors?.solana?.signature ?? null,
    slot: input.head?.anchors?.solana?.slot ?? null,
    cluster: input.head?.anchors?.solana?.cluster ?? null,
    memo: input.head?.anchors?.solana?.memo ?? null,
    reason: undefined as string | undefined,
  };
  const base = {
    checked: false,
    valid: false,
    tx: input.head?.anchors?.base?.tx || input.head?.anchor?.tx || input.head?.anchor_tx || null,
    chain_id: input.head?.anchors?.base?.chain_id ?? input.head?.anchor?.chain_id ?? null,
    reason: undefined as string | undefined,
  };

  if (!inclusionValid) {
    solana.reason = 'inclusion_failed';
    base.reason = 'inclusion_failed';
  } else {
    if (!signature) {
      solana.reason = 'pending';
      errors.push('solana_pending');
    } else {
      solana.checked = true;
      try {
        const fetchTx = input.fetchSolanaTx || ((sig, url) => fetchSolanaTransaction(sig, url) as Promise<SolanaAnchorTx | null>);
        const fetchGenesis = input.fetchGenesis || fetchSolanaGenesisHash;
        const tx = await fetchTx(signature, solanaRpc);
        if (!tx) {
          solana.reason = 'tx_not_found';
        } else if (tx.meta?.err) {
          solana.reason = 'tx_failed';
        } else {
          const memos = extractMemos(tx);
          const recorded = input.head.anchors?.solana?.memo || null;
          const matched = memos.filter((memo) => {
            const parsed = parseAnchorMemo(memo);
            return Boolean(parsed && parsed.root === root && memo.includes(root) && (!recorded || memo === recorded));
          });
          const cluster = input.head.anchors?.solana?.cluster || null;
          const expectedGenesis = cluster ? SOLANA_GENESIS[cluster] : null;
          if (matched.length === 0) solana.reason = 'memo_mismatch';
          else if (!cluster) solana.reason = 'no_cluster';
          else if (!expectedGenesis) solana.reason = 'unknown_cluster';
          else {
            const genesis = await fetchGenesis(solanaRpc);
            if (genesis !== expectedGenesis) solana.reason = 'cluster_mismatch';
          }
          const headSlot = input.head.anchors?.solana?.slot;
          if (!solana.reason && headSlot != null && tx.slot != null && Number(tx.slot) !== Number(headSlot)) {
            solana.reason = 'slot_mismatch';
          }
          if (!solana.reason) {
            solana.valid = true;
            solana.memo = matched[0];
            if (tx.slot != null) solana.slot = tx.slot;
          }
        }
      } catch (err) {
        solana.reason = err instanceof Error ? err.message : 'solana_rpc_error';
      }
      if (!solana.valid && solana.reason) errors.push(`solana:${solana.reason}`);
    }

    if (!txHash) {
      base.reason = 'pending';
      errors.push('base_pending');
    } else {
      base.checked = true;
      try {
        const fetchBase = input.fetchBaseTx || fetchBaseAnchorTransaction;
        const tx = await fetchBase(txHash, baseRpc);
        const expectedChain = input.head.anchors?.base?.chain_id || input.head.anchor?.chain_id || BASE_MAINNET_CHAIN_ID;
        if (!tx) {
          base.reason = 'tx_not_found';
        } else if (tx.chainId != null && Number(tx.chainId) !== Number(expectedChain)) {
          base.reason = 'chain_mismatch';
          base.chain_id = Number(tx.chainId);
        } else {
          const inputData = String(tx.input || '').toLowerCase().replace(/^0x/, '');
          if (inputData !== root) base.reason = 'calldata_mismatch';
          else {
            base.valid = true;
            base.tx = tx.hash || txHash;
            base.chain_id = tx.chainId ?? expectedChain;
          }
        }
      } catch (err) {
        base.reason = err instanceof Error ? err.message : 'base_rpc_error';
      }
      if (!base.valid && base.reason) errors.push(`base:${base.reason}`);
    }
  }

  const witnessAddress = input.witnessAddress || null;
  const witness = {
    checked: false,
    valid: false,
    configured: Boolean(witnessAddress),
    address: witnessAddress,
    epoch: null as number | null,
    size: null as number | null,
    root: null as string | null,
    reason: undefined as string | undefined,
  };
  if (!witnessAddress) {
    doesNotProve.push('No witness contract address was set, so this run did not check a contract head. Mainnet has no ChitLogWitness address in this release.');
  } else if (!inclusionValid || !root) {
    witness.reason = 'inclusion_failed';
    errors.push('witness:inclusion_failed');
  } else {
    witness.checked = true;
    try {
      const readCode = input.fetchWitnessCode || fetchWitnessCode;
      const code = await readCode(witnessAddress, baseRpc);
      if (!witnessCodeMatches(code)) {
        witness.reason = 'witness_code';
        errors.push('witness:witness_code');
      }
      const creationTx = input.witnessCreationTx
        || process.env.CHIT_LOG_WITNESS_CREATION_TX
        || CHIT_LOG_WITNESS_CREATION_TX_PIN;
      const pinnedAddress = CHIT_LOG_WITNESS_ADDRESS_PIN;
      if (!witness.reason && pinnedAddress && pinnedAddress.toLowerCase() !== witnessAddress.toLowerCase()) {
        witness.reason = 'witness_address';
        errors.push('witness:witness_address');
      }
      if (!witness.reason && !creationTx) {
        witness.reason = 'witness_creation_unpinned';
        errors.push('witness:witness_creation_unpinned');
      } else if (!witness.reason && creationTx) {
        const readCreation = input.fetchWitnessCreation || fetchWitnessCreation;
        const created = await readCreation(creationTx, baseRpc);
        const matched = witnessCreationMatches(created?.input, created?.receipt, witnessAddress);
        if (!matched.ok) {
          witness.reason = matched.reason || 'witness_creation';
          errors.push(`witness:${witness.reason}`);
        }
      }
      const read = input.fetchWitness || fetchWitnessHead;
      const onchain = witness.reason ? null : await read(witnessAddress, baseRpc);
      if (witness.reason) {
        // already recorded
      } else if (!onchain) {
        witness.reason = 'head_missing';
      } else {
        witness.epoch = onchain.epoch;
        witness.size = onchain.size;
        witness.root = onchain.root;
        const headEpoch = input.head.epoch == null ? null : Number(input.head.epoch);
        const headSize = input.head.tree_size == null ? null : Number(input.head.tree_size);
        if (headEpoch != null && headEpoch !== onchain.epoch) witness.reason = 'epoch_mismatch';
        else if (headSize == null) witness.reason = 'head_size_missing';
        else if (headSize < onchain.size) witness.reason = 'head_behind';
        else if (headSize === onchain.size) {
          witness.valid = onchain.root === root;
          if (!witness.valid) witness.reason = 'root_mismatch';
        } else {
          const proof = input.consistency;
          const nodes = proof?.proof || [];
          const oldSize = Number(proof?.first_tree_size);
          const newSize = Number(proof?.second_tree_size);
          const oldRoot = normalizeRoot(proof?.first_root || null);
          const newRoot = normalizeRoot(proof?.second_root || null);
          if (!proof || !Array.isArray(nodes)) witness.reason = 'witness_proof_required';
          else if (oldSize !== onchain.size || newSize !== headSize || oldRoot !== onchain.root || newRoot !== root) {
            witness.reason = 'witness_proof_mismatch';
          } else if (!verifyConsistency(onchain.size, headSize, onchain.root, root, nodes)) {
            witness.reason = 'witness_proof_rejected';
          } else witness.valid = true;
        }
      }
    } catch (err) {
      witness.reason = err instanceof Error ? err.message : 'witness_rpc_error';
    }
    if (!witness.valid && witness.reason) errors.push(`witness:${witness.reason}`);
  }

  let overall: AnchorWitnessResult['overall'];
  const witnessFailed = witness.configured && !witness.valid;
  if (!inclusionValid || epochReason || witnessFailed || (solana.checked && !solana.valid) || (base.checked && !base.valid)) overall = 'failed';
  else if (solana.valid && base.valid) overall = 'verified';
  else overall = 'partial';

  const proves = witness.valid
    ? [...ANCHOR_PROVES, `The Base witness contract at ${witness.address} stores this head, or this head is an RFC 6962 extension of the head it stores.`]
    : ANCHOR_PROVES;

  return {
    overall,
    root,
    inclusion: { valid: inclusionValid, leaf: leafHex, leaf_source: leafSource, reason: inclusionReason },
    solana,
    base,
    witness,
    proves,
    does_not_prove: doesNotProve,
    errors,
  };
}
