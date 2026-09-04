/**
 * Offline Solana payer verification for Chit402 receipts.
 *
 * When payment.ref starts with `solana:`, fetch the settled transaction and
 * confirm a USDC transfer of payment.gross_amount involving caller_binding.payer_wallet
 * as authority (x402 exact-svm) without trusting Chit logs.
 */

/** Solana mainnet USDC mint (SPL, 6 decimals). */
export const SOLANA_USDC_MINT_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/** Solana devnet USDC mint (SPL, 6 decimals). */
export const SOLANA_USDC_MINT_DEVNET = 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr';

/** Default public Solana mainnet RPC (override with SOLANA_RPC_URL). */
export const SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';

/** SPL Token program id. */
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

/** Base58 alphabet (no 0, O, I, l). */
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export interface SolanaPayerVerification {
  checked: boolean;
  valid: boolean;
  signature?: string;
  payerWallet?: string;
  expectedAmount?: string;
  transferredAmount?: string;
  mint?: string;
  reason?: string;
}

export interface SolanaRpcGetTransactionResult {
  meta?: {
    err?: unknown;
    preTokenBalances?: Array<{
      accountIndex: number;
      mint: string;
      owner?: string;
      uiTokenAmount?: { amount: string };
    }>;
    postTokenBalances?: Array<{
      accountIndex: number;
      mint: string;
      owner?: string;
      uiTokenAmount?: { amount: string };
    }>;
  } | null;
  transaction?: {
    message?: {
      accountKeys?: Array<{ pubkey: string; signer?: boolean } | string>;
      instructions?: Array<{
        program?: string;
        programId?: string;
        parsed?: {
          type?: string;
          info?: Record<string, unknown>;
        };
      }>;
    };
    signatures?: string[];
  };
}

export type SolanaRpcFetcher = (
  signature: string,
  rpcUrl: string,
) => Promise<SolanaRpcGetTransactionResult | null>;

function resolveRpcUrl(override?: string): string {
  return override || process.env.SOLANA_RPC_URL || SOLANA_RPC_URL;
}

/**
 * True for a plausible Solana base58 pubkey (32–44 chars).
 */
export function isSolanaBase58Pubkey(value: unknown): boolean {
  return typeof value === 'string' && BASE58_RE.test(value);
}

/**
 * Extract the tx signature from `solana:<sig>` payment.ref.
 */
export function parseSolanaPaymentRef(paymentRef: string | null | undefined): string | null {
  if (!paymentRef || typeof paymentRef !== 'string') return null;
  const trimmed = paymentRef.trim();
  if (!trimmed.toLowerCase().startsWith('solana:')) return null;
  const sig = trimmed.slice('solana:'.length).trim();
  return sig.length > 0 ? sig : null;
}

function accountPubkey(key: { pubkey: string } | string): string {
  return typeof key === 'string' ? key : key.pubkey;
}

function isSigner(key: { pubkey: string; signer?: boolean } | string): boolean {
  return typeof key !== 'string' && key.signer === true;
}

/**
 * Parse USDC transfer instructions from a jsonParsed getTransaction result.
 */
export function extractUsdcTransfersFromTx(
  tx: SolanaRpcGetTransactionResult,
  mint: string = SOLANA_USDC_MINT_MAINNET,
): Array<{ authority: string; amount: bigint; mint: string }> {
  const transfers: Array<{ authority: string; amount: bigint; mint: string }> = [];
  const instructions = tx.transaction?.message?.instructions || [];

  for (const ix of instructions) {
    const program = ix.program || '';
    const programId = ix.programId || '';
    if (program !== 'spl-token' && programId !== TOKEN_PROGRAM_ID) continue;

    const parsed = ix.parsed;
    if (!parsed || typeof parsed !== 'object') continue;

    const type = parsed.type;
    const info = parsed.info || {};

    if (type === 'transferChecked') {
      const ixMint = String(info.mint || '');
      if (ixMint !== mint) continue;
      const authority = String(info.authority || info.sourceOwner || '');
      const tokenAmount = info.tokenAmount as { amount?: string } | undefined;
      const raw = tokenAmount?.amount ?? info.amount;
      if (!authority || raw == null) continue;
      transfers.push({ authority, amount: BigInt(String(raw)), mint: ixMint });
      continue;
    }

    if (type === 'transfer') {
      // Legacy transfer ix — confirm mint via token balance owner match when possible.
      const authority = String(info.authority || info.source || '');
      const raw = (info.tokenAmount as { amount?: string } | undefined)?.amount ?? info.amount;
      if (!authority || raw == null) continue;
      transfers.push({ authority, amount: BigInt(String(raw)), mint });
    }
  }

  return transfers;
}

/**
 * Fallback: infer USDC outflow from pre/post token balance deltas for a payer owner.
 */
export function inferUsdcOutflowFromBalances(
  tx: SolanaRpcGetTransactionResult,
  payerWallet: string,
  mint: string = SOLANA_USDC_MINT_MAINNET,
): bigint {
  const pre = tx.meta?.preTokenBalances || [];
  const post = tx.meta?.postTokenBalances || [];
  const byIndex = new Map<number, { pre: bigint; post: bigint; owner: string; mint: string }>();

  for (const row of pre) {
    if (row.mint !== mint || !row.owner) continue;
    const entry = byIndex.get(row.accountIndex) || {
      pre: 0n,
      post: 0n,
      owner: row.owner,
      mint: row.mint,
    };
    entry.pre = BigInt(row.uiTokenAmount?.amount || '0');
    byIndex.set(row.accountIndex, entry);
  }
  for (const row of post) {
    if (row.mint !== mint || !row.owner) continue;
    const entry = byIndex.get(row.accountIndex) || {
      pre: 0n,
      post: 0n,
      owner: row.owner,
      mint: row.mint,
    };
    entry.post = BigInt(row.uiTokenAmount?.amount || '0');
    byIndex.set(row.accountIndex, entry);
  }

  let totalOut = 0n;
  for (const entry of byIndex.values()) {
    if (entry.owner !== payerWallet) continue;
    if (entry.pre > entry.post) {
      totalOut += entry.pre - entry.post;
    }
  }
  return totalOut;
}

/**
 * Default JSON-RPC fetcher for getTransaction (jsonParsed).
 */
export async function fetchSolanaTransaction(
  signature: string,
  rpcUrl?: string,
): Promise<SolanaRpcGetTransactionResult | null> {
  const url = resolveRpcUrl(rpcUrl);
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'getTransaction',
    params: [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }],
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Solana RPC HTTP ${res.status}`);
  }

  const json = await res.json() as { result?: SolanaRpcGetTransactionResult | null; error?: { message?: string } };
  if (json.error) {
    throw new Error(`Solana RPC error: ${json.error.message || 'unknown'}`);
  }
  return json.result ?? null;
}

export interface VerifySolanaPayerInput {
  paymentRef: string;
  payerWallet: string;
  grossAmount: string | number | bigint;
  mint?: string;
  rpcUrl?: string;
  fetchTransaction?: SolanaRpcFetcher;
}

/**
 * Verify caller_binding.payer_wallet against a Solana USDC settlement tx.
 */
export async function verifySolanaPayer(input: VerifySolanaPayerInput): Promise<SolanaPayerVerification> {
  const signature = parseSolanaPaymentRef(input.paymentRef);
  if (!signature) {
    return { checked: false, valid: false, reason: 'not_solana_payment_ref' };
  }

  const payerWallet = String(input.payerWallet || '').trim();
  if (!isSolanaBase58Pubkey(payerWallet)) {
    return { checked: false, valid: false, reason: 'invalid_solana_payer_wallet' };
  }

  const expectedAmount = BigInt(String(input.grossAmount ?? '0'));
  if (expectedAmount <= 0n) {
    return { checked: false, valid: false, reason: 'invalid_gross_amount' };
  }

  const mint = input.mint || SOLANA_USDC_MINT_MAINNET;
  const fetcher = input.fetchTransaction || fetchSolanaTransaction;
  const rpcUrl = resolveRpcUrl(input.rpcUrl);

  let tx: SolanaRpcGetTransactionResult | null;
  try {
    tx = await fetcher(signature, rpcUrl);
  } catch (err) {
    return {
      checked: true,
      valid: false,
      signature,
      payerWallet,
      expectedAmount: expectedAmount.toString(),
      mint,
      reason: `rpc_error: ${(err as Error).message}`,
    };
  }

  if (!tx) {
    return {
      checked: true,
      valid: false,
      signature,
      payerWallet,
      expectedAmount: expectedAmount.toString(),
      mint,
      reason: 'transaction_not_found',
    };
  }

  if (tx.meta?.err != null) {
    return {
      checked: true,
      valid: false,
      signature,
      payerWallet,
      expectedAmount: expectedAmount.toString(),
      mint,
      reason: 'transaction_failed',
    };
  }

  const accountKeys = tx.transaction?.message?.accountKeys || [];
  const payerIsSigner = accountKeys.some((k) => accountPubkey(k) === payerWallet && isSigner(k));

  const transfers = extractUsdcTransfersFromTx(tx, mint);
  const authorityMatch = transfers.find((t) => t.authority === payerWallet && t.amount >= expectedAmount);

  if (authorityMatch) {
    return {
      checked: true,
      valid: true,
      signature,
      payerWallet,
      expectedAmount: expectedAmount.toString(),
      transferredAmount: authorityMatch.amount.toString(),
      mint,
    };
  }

  // x402 exact-svm: payer may co-sign while authority is their ATA owner — accept signer + balance delta.
  const outflow = inferUsdcOutflowFromBalances(tx, payerWallet, mint);
  if (payerIsSigner && outflow >= expectedAmount) {
    return {
      checked: true,
      valid: true,
      signature,
      payerWallet,
      expectedAmount: expectedAmount.toString(),
      transferredAmount: outflow.toString(),
      mint,
      reason: undefined,
    };
  }

  const anyTransfer = transfers.find((t) => t.amount >= expectedAmount);
  return {
    checked: true,
    valid: false,
    signature,
    payerWallet,
    expectedAmount: expectedAmount.toString(),
    transferredAmount: anyTransfer?.amount.toString(),
    mint,
    reason: anyTransfer
      ? `payer_mismatch: authority ${anyTransfer.authority} !== ${payerWallet}`
      : `no_usdc_transfer_of_${expectedAmount.toString()}_from_${payerWallet}`,
  };
}
