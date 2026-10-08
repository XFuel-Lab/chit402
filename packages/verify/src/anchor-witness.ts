/**
 * Check a receipt leaf against a signed tree head, then against the two
 * anchors that publish that root: an SPL Memo on Solana and calldata on Base.
 *
 * Inclusion is local. The chain checks use the RPC you pass. A matching memo
 * and matching calldata show the issuer published this root. They do not show
 * the payment.
 */
import { createHash } from 'node:crypto';
import {
  compileAnchorWallets,
  headOmitsPinnedSigner,
  LEGACY_HEAD_UNPINNED_SIGNER,
  sameBaseAddress,
  verifyAnchorWalletDocument,
  verifyTreeHeadTrust,
  walletListed,
  type AnchorWalletList,
} from './anchor-trust.js';
import { BASE_RPC_URL } from './base-payer.js';
import { verifyEpochLink, verifyEpochRecord, type EpochRecord } from './epoch.js';
import type { IssuerHistoryDocument } from './issuer-history.js';
import type { Es256Jwk } from './jws.js';
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
  'This receipt leaf is inside the tree of the stated size, under the stated root.',
  'The tree head carries a valid ES256 issuer signature. The kid is trusted by the production pin, issuer history, or JWKS, and the signed root, size, epoch, and anchors match the head.',
  'The Solana transaction memo contains that root, its fee payer is the signed fee payer, and the RPC genesis hash is the cluster named on the head.',
  'The Base transaction calldata is that same root, on chain id 8453, and its sender is the signed anchor wallet.',
  'Those wallets are on the issuer anchor-wallet list: the package pin, or a signed well-known or issuer-history list.',
];

export const ANCHOR_DOES_NOT_PROVE = [
  'It does not prove the payment, the payer, the payee, or the model output.',
  'It does not prove a receipt appended after this tree size is inside the root.',
  'It does not prove the issuer included only honest rows. It proves this leaf hashes into the published root.',
  'It does not prove the RPC itself is honest. It checks the transaction and genesis hash that RPC returned.',
  'It does not read the on-chain issuer-root registry or the DNS anchor. Those sources are reserved and are not consulted.',
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
    base?: {
      tx?: string | null;
      calldata?: string | null;
      chain_id?: number | null;
      status?: string;
      from?: string | null;
    } | null;
    solana?: {
      signature?: string | null;
      slot?: number | null;
      cluster?: string | null;
      memo?: string | null;
      status?: string | null;
      fee_payer?: string | null;
    } | null;
  } | null;
  issuer_signature?: {
    jws?: string;
    kid?: string;
    issuer_jwk?: Es256Jwk;
  };
  schema?: string;
  payload_version?: number;
  published_at?: string | null;
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
  transaction?: {
    message?: {
      instructions?: SolanaIx[];
      accountKeys?: Array<{ pubkey?: string; signer?: boolean } | string>;
    };
  };
}

export interface BaseAnchorTx {
  hash?: string;
  input?: string;
  chainId?: number;
  from?: string;
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
    fee_payer: string | null;
    reason?: string;
  };
  base: {
    checked: boolean;
    valid: boolean;
    tx: string | null;
    chain_id: number | null;
    from: string | null;
    reason?: string;
  };
  head_signature: {
    checked: boolean;
    valid: boolean;
    kid: string | null;
    trust: string | null;
    reason?: string;
    message?: string;
  };
  anchor_wallets: {
    base_from: string | null;
    solana_fee_payer: string | null;
    sources: AnchorWalletList['sources'];
    not_consulted: AnchorWalletList['not_consulted'];
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

function half(n: number): number {
  return Math.floor(n / 2);
}

/**
 * RFC 9162 §2.1.3.2 inclusion. `index` and `treeSize` choose left or right
 * at each step. `position` on a proof node is not trusted. A proof whose
 * length is not the length that pair requires is rejected, as is
 * `index >= treeSize`. Leaf and node bytes stay SHA-256(0x00 || leaf) and
 * SHA-256(0x01 || left || right). Consistency proofs and the empty root
 * are not this function.
 */
export function verifyMerkleInclusion(
  leaf: Buffer,
  index: number,
  treeSize: number,
  rootHex: string,
  proof: InclusionStep[],
): boolean {
  if (!Array.isArray(proof)) return false;
  const leafIndex = Number(index);
  const size = Number(treeSize);
  if (!Number.isSafeInteger(leafIndex) || !Number.isSafeInteger(size)) return false;
  if (leafIndex < 0 || leafIndex >= size) return false;
  const root = String(rootHex || '').replace(/^0x/, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(root)) return false;
  let fn = leafIndex;
  let sn = size - 1;
  let hash: Buffer = Buffer.from(leaf);
  for (const step of proof) {
    if (sn === 0) return false;
    if (!step || !/^[0-9a-fA-F]{64}$/.test(step.hash)) return false;
    const sib = Buffer.from(step.hash, 'hex');
    if ((fn % 2) === 1 || fn === sn) {
      hash = nodeHash(sib, hash);
      if ((fn % 2) === 0) {
        while ((fn % 2) === 0 && fn !== 0) {
          fn = half(fn);
          sn = half(sn);
        }
      }
    } else {
      hash = nodeHash(hash, sib);
    }
    fn = half(fn);
    sn = half(sn);
  }
  return sn === 0 && hash.toString('hex') === root;
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
  const tx = await defaultRpc(rpcUrl, 'eth_getTransactionByHash', [txHash]) as { hash?: string; input?: string; from?: string } | null;
  const chainHex = await defaultRpc(rpcUrl, 'eth_chainId', []) as string | null;
  if (!tx) return null;
  return {
    hash: tx.hash,
    input: tx.input,
    from: tx.from,
    chainId: chainHex ? Number(chainHex) : undefined,
  };
}

/** Fee payer is the first account. A parsed key that is explicitly not a signer does not count. */
export function solanaFeePayer(tx: SolanaAnchorTx | null | undefined): string | null {
  const keys = tx?.transaction?.message?.accountKeys || [];
  if (!keys.length) return null;
  const first = keys[0];
  if (typeof first === 'string') return first;
  if (first?.signer === false) return null;
  return first?.pubkey || null;
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
  jwks?: { keys: Es256Jwk[] };
  trustedKids?: readonly string[];
  issuerHistory?: IssuerHistoryDocument | null;
  strictIssuerHistory?: boolean;
  /** Parsed `chit402.anchor_wallets.v1`. Verified here. A bad document fails closed. */
  anchorWalletDocument?: {
    schema?: string;
    base?: unknown;
    solana?: unknown;
    issuer_signature?: { jws?: string; issuer_jwk?: Es256Jwk };
  } | null;
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

  const headTrust = verifyTreeHeadTrust(input.head, {
    jwks: input.jwks,
    trustedKids: input.trustedKids,
    issuerHistory: input.issuerHistory ?? null,
    strictIssuerHistory: input.strictIssuerHistory === true,
  });
  if (!headTrust.ok && headTrust.reason) errors.push(headTrust.reason);
  const legacyHead = headTrust.ok && headOmitsPinnedSigner(headTrust.payload);
  if (legacyHead) errors.push(LEGACY_HEAD_UNPINNED_SIGNER);

  let publishedWallets: { base: string[]; solana: string[] } | null = null;
  if (input.anchorWalletDocument) {
    const listed = verifyAnchorWalletDocument(input.anchorWalletDocument, {
      jwks: input.jwks,
      trustedKids: input.trustedKids,
    });
    if (!listed.ok) errors.push(listed.reason);
    else publishedWallets = { base: listed.base, solana: listed.solana };
  }
  const walletList = compileAnchorWallets({
    jwks: input.jwks,
    trustedKids: input.trustedKids,
    issuerHistory: headTrust.ok ? (input.issuerHistory ?? null) : null,
    published: publishedWallets,
  });
  const anchorWalletsInvalid = errors.includes('anchor_wallets_invalid');

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
    fee_payer: input.head?.anchors?.solana?.fee_payer ?? null,
    reason: undefined as string | undefined,
  };
  const base = {
    checked: false,
    valid: false,
    tx: input.head?.anchors?.base?.tx || input.head?.anchor?.tx || input.head?.anchor_tx || null,
    chain_id: input.head?.anchors?.base?.chain_id ?? input.head?.anchor?.chain_id ?? null,
    from: input.head?.anchors?.base?.from ?? null,
    reason: undefined as string | undefined,
  };

  const signedFrom = input.head?.anchors?.base?.from || null;
  const signedPayer = input.head?.anchors?.solana?.fee_payer || null;
  let walletFailed = anchorWalletsInvalid;
  if (signedFrom && !walletListed(walletList.base, signedFrom, 'base')) {
    walletFailed = true;
    errors.push('anchor_sender_unlisted');
  }
  if (signedPayer && !walletListed(walletList.solana, signedPayer, 'solana')) {
    walletFailed = true;
    errors.push('fee_payer_unlisted');
  }

  if (!inclusionValid) {
    solana.reason = 'inclusion_failed';
    base.reason = 'inclusion_failed';
  } else if (!headTrust.ok || walletFailed) {
    const reason = !headTrust.ok
      ? (headTrust.reason || 'head_signature_invalid')
      : (errors.find((code) => code.startsWith('anchor_') || code.startsWith('fee_payer')) || 'anchor_wallets_invalid');
    solana.reason = solana.fee_payer && errors.includes('fee_payer_unlisted') ? 'fee_payer_unlisted' : reason;
    base.reason = base.from && errors.includes('anchor_sender_unlisted') ? 'anchor_sender_unlisted' : reason;
  } else if (legacyHead) {
    solana.reason = LEGACY_HEAD_UNPINNED_SIGNER;
    base.reason = LEGACY_HEAD_UNPINNED_SIGNER;
  } else {
    if (!signature) {
      solana.reason = 'pending';
      errors.push('solana_pending');
    } else if (!signedPayer) {
      solana.reason = 'fee_payer_missing';
      errors.push('fee_payer_missing');
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
          const payer = solanaFeePayer(tx);
          if (!solana.reason && payer !== signedPayer) {
            solana.reason = 'fee_payer_mismatch';
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
    } else if (!signedFrom) {
      base.reason = 'anchor_sender_missing';
      errors.push('anchor_sender_missing');
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
          else if (!tx.from || !sameBaseAddress(tx.from, signedFrom)) base.reason = 'sender_mismatch';
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

  let overall: AnchorWitnessResult['overall'];
  const anchorSideFailed = (solana.reason && solana.reason !== 'pending')
    || (base.reason && base.reason !== 'pending');
  if (!inclusionValid || epochReason || !headTrust.ok || walletFailed || legacyHead || anchorSideFailed) overall = 'failed';
  else if (solana.valid && base.valid) overall = 'verified';
  else overall = 'partial';

  return {
    overall,
    root,
    inclusion: { valid: inclusionValid, leaf: leafHex, leaf_source: leafSource, reason: inclusionReason },
    solana,
    base,
    head_signature: {
      checked: Boolean(input.head?.issuer_signature?.jws) || !headTrust.ok,
      valid: headTrust.ok,
      kid: headTrust.kid,
      trust: headTrust.trust,
      reason: headTrust.reason || undefined,
      message: headTrust.message || undefined,
    },
    anchor_wallets: {
      base_from: signedFrom,
      solana_fee_payer: signedPayer,
      sources: walletList.sources,
      not_consulted: walletList.not_consulted,
    },
    proves: ANCHOR_PROVES,
    does_not_prove: doesNotProve,
    errors,
  };
}
