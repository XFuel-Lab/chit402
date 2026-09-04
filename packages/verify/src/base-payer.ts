/**
 * Offline Base (EVM) payer verification for Chit402 receipts.
 *
 * When payment.ref starts with `base:` or `eip155:8453:`, read the USDC Transfer
 * event and confirm the sender matches caller_binding.payer_wallet (EIP-3009
 * transferWithAuthorization records `from` as the payer).
 */

import { JsonRpcProvider, getAddress, type TransactionReceipt } from 'ethers';

/** ERC-20 Transfer(address,address,uint256) topic. */
export const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/** Known USDC contract addresses by network key. */
export const USDC_ADDRESSES: Record<string, string> = {
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'base-sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  'eip155:8453': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'eip155:84532': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
};

/** Default Base mainnet RPC. */
export const BASE_RPC_URL = 'https://mainnet.base.org';

export interface BasePayerVerification {
  checked: boolean;
  valid: boolean;
  txHash?: string;
  payerWallet?: string;
  expectedAmount?: string;
  transferredAmount?: string;
  network?: string;
  reason?: string;
}

export type BaseReceiptFetcher = (
  txHash: string,
  rpcUrl: string,
) => Promise<TransactionReceipt | null>;

function resolveRpcUrl(override?: string): string {
  return override || process.env.BASE_RPC_URL || BASE_RPC_URL;
}

/**
 * True for a valid EVM address (0x + 40 hex).
 */
export function isEvmAddress(value: unknown): boolean {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}

/**
 * Parse Base payment.ref into { network, txHash }.
 * Supports `base:0x…`, `base-sepolia:0x…`, `eip155:8453:0x…`.
 */
export function parseBasePaymentRef(
  paymentRef: string | null | undefined,
): { network: string; txHash: string } | null {
  if (!paymentRef || typeof paymentRef !== 'string') return null;
  const trimmed = paymentRef.trim();
  const lower = trimmed.toLowerCase();

  if (lower.startsWith('eip155:')) {
    const parts = trimmed.split(':');
    if (parts.length < 3) return null;
    const txHash = parts.slice(2).join(':');
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return null;
    const network = `${parts[0]}:${parts[1]}`.toLowerCase();
    return { network, txHash };
  }

  if (lower.startsWith('base-sepolia:')) {
    const txHash = trimmed.slice('base-sepolia:'.length);
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return null;
    return { network: 'base-sepolia', txHash };
  }

  if (lower.startsWith('base:')) {
    const txHash = trimmed.slice('base:'.length);
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return null;
    return { network: 'base', txHash };
  }

  return null;
}

/**
 * Sum USDC Transfer amounts from payer in a transaction receipt.
 */
export function sumUsdcTransfersFromPayer(
  receipt: TransactionReceipt,
  payerWallet: string,
  usdcAddress: string,
): bigint {
  const expectedFrom = getAddress(payerWallet).toLowerCase();
  const usdcLower = usdcAddress.toLowerCase();
  let total = 0n;

  for (const log of receipt.logs || []) {
    if (log.address?.toLowerCase() !== usdcLower) continue;
    if (log.topics?.[0] !== ERC20_TRANSFER_TOPIC) continue;
    if ((log.topics?.length || 0) < 3) continue;

    const from = ('0x' + log.topics[1].slice(26)).toLowerCase();
    if (from !== expectedFrom) continue;
    total += BigInt(log.data || '0');
  }

  return total;
}

/**
 * Default ethers provider fetcher for getTransactionReceipt.
 */
export async function fetchBaseTransactionReceipt(
  txHash: string,
  rpcUrl?: string,
): Promise<TransactionReceipt | null> {
  const provider = new JsonRpcProvider(resolveRpcUrl(rpcUrl), undefined, {
    staticNetwork: true,
    batchMaxCount: 1,
  });
  return provider.getTransactionReceipt(txHash);
}

export interface VerifyBasePayerInput {
  paymentRef: string;
  payerWallet: string;
  grossAmount: string | number | bigint;
  network?: string;
  rpcUrl?: string;
  fetchReceipt?: BaseReceiptFetcher;
}

/**
 * Verify caller_binding.payer_wallet against a Base USDC settlement tx.
 */
export async function verifyBasePayer(input: VerifyBasePayerInput): Promise<BasePayerVerification> {
  const parsed = parseBasePaymentRef(input.paymentRef);
  if (!parsed) {
    return { checked: false, valid: false, reason: 'not_base_payment_ref' };
  }

  const payerWallet = String(input.payerWallet || '').trim();
  if (!isEvmAddress(payerWallet)) {
    return { checked: false, valid: false, reason: 'invalid_evm_payer_wallet' };
  }

  const expectedAmount = BigInt(String(input.grossAmount ?? '0'));
  if (expectedAmount <= 0n) {
    return { checked: false, valid: false, reason: 'invalid_gross_amount' };
  }

  const network = (input.network || parsed.network).toLowerCase();
  const usdcAddress = USDC_ADDRESSES[network];
  if (!usdcAddress) {
    return { checked: false, valid: false, reason: `unknown_network: ${network}` };
  }

  const fetcher = input.fetchReceipt || fetchBaseTransactionReceipt;
  const rpcUrl = resolveRpcUrl(input.rpcUrl);

  let receipt: TransactionReceipt | null;
  try {
    receipt = await fetcher(parsed.txHash, rpcUrl);
  } catch (err) {
    return {
      checked: true,
      valid: false,
      txHash: parsed.txHash,
      payerWallet: getAddress(payerWallet),
      expectedAmount: expectedAmount.toString(),
      network,
      reason: `rpc_error: ${(err as Error).message}`,
    };
  }

  if (!receipt) {
    return {
      checked: true,
      valid: false,
      txHash: parsed.txHash,
      payerWallet: getAddress(payerWallet),
      expectedAmount: expectedAmount.toString(),
      network,
      reason: 'transaction_not_found',
    };
  }

  if (receipt.status === 0) {
    return {
      checked: true,
      valid: false,
      txHash: parsed.txHash,
      payerWallet: getAddress(payerWallet),
      expectedAmount: expectedAmount.toString(),
      network,
      reason: 'transaction_reverted',
    };
  }

  const transferred = sumUsdcTransfersFromPayer(receipt, payerWallet, usdcAddress);
  const valid = transferred >= expectedAmount;

  return {
    checked: true,
    valid,
    txHash: parsed.txHash,
    payerWallet: getAddress(payerWallet),
    expectedAmount: expectedAmount.toString(),
    transferredAmount: transferred.toString(),
    network,
    reason: valid
      ? undefined
      : transferred > 0n
        ? `transferred_${transferred}_lt_expected_${expectedAmount}`
        : `no_usdc_transfer_from_${getAddress(payerWallet)}`,
  };
}
