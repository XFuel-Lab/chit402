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
  payee?: string;
  asset?: string;
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
 * When `payee` is set, only transfers to that address are counted.
 */
export function sumUsdcTransfersFromPayer(
  receipt: TransactionReceipt,
  payerWallet: string,
  usdcAddress: string,
  payee?: string,
): bigint {
  const expectedFrom = getAddress(payerWallet).toLowerCase();
  const expectedTo = payee ? getAddress(payee).toLowerCase() : null;
  const usdcLower = usdcAddress.toLowerCase();
  let total = 0n;

  for (const log of receipt.logs || []) {
    if (log.address?.toLowerCase() !== usdcLower) continue;
    if (log.topics?.[0]?.toLowerCase() !== ERC20_TRANSFER_TOPIC) continue;
    if ((log.topics?.length || 0) < 3) continue;

    const from = ('0x' + log.topics[1].slice(26)).toLowerCase();
    if (from !== expectedFrom) continue;
    if (expectedTo) {
      const to = ('0x' + log.topics[2].slice(26)).toLowerCase();
      if (to !== expectedTo) continue;
    }
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
  /** Settlement payee. When set, the USDC Transfer `to` must equal this address. */
  payee?: string;
  /** Token contract. When set, it must be the network USDC and the Transfer log address. */
  asset?: string;
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

  let payee: string | undefined;
  if (input.payee != null && input.payee !== '') {
    if (!isEvmAddress(input.payee)) {
      return { checked: false, valid: false, reason: 'invalid_payee' };
    }
    payee = getAddress(input.payee);
  }

  const network = (input.network || parsed.network).toLowerCase();
  const usdcAddress = USDC_ADDRESSES[network];
  if (!usdcAddress) {
    return { checked: false, valid: false, reason: `unknown_network: ${network}` };
  }

  let asset: string | undefined;
  if (input.asset != null && input.asset !== '') {
    if (!isEvmAddress(input.asset)) {
      return { checked: true, valid: false, reason: `asset_mismatch: ${input.asset} is not an EVM token address` };
    }
    asset = getAddress(input.asset);
    if (asset !== getAddress(usdcAddress)) {
      return {
        checked: true,
        valid: false,
        payerWallet: getAddress(payerWallet),
        payee,
        asset,
        expectedAmount: expectedAmount.toString(),
        network,
        reason: `asset_mismatch: ${asset} !== ${getAddress(usdcAddress)}`,
      };
    }
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

  const baseFields = {
    txHash: parsed.txHash,
    payerWallet: getAddress(payerWallet),
    payee,
    asset: asset || getAddress(usdcAddress),
    expectedAmount: expectedAmount.toString(),
    network,
  };

  if (!receipt) {
    return {
      checked: true,
      valid: false,
      ...baseFields,
      reason: 'transaction_not_found',
    };
  }

  if (receipt.status === 0) {
    return {
      checked: true,
      valid: false,
      ...baseFields,
      reason: 'transaction_reverted',
    };
  }

  const token = asset || usdcAddress;
  const transferred = sumUsdcTransfersFromPayer(receipt, payerWallet, token, payee);
  const fromPayer = payee
    ? sumUsdcTransfersFromPayer(receipt, payerWallet, token)
    : transferred;
  const valid = transferred >= expectedAmount;

  let reason: string | undefined;
  if (!valid) {
    if (payee && fromPayer > 0n && transferred === 0n) {
      reason = `payee_mismatch: no USDC transfer from ${getAddress(payerWallet)} to ${payee}`;
    } else if (transferred > 0n) {
      reason = `transferred_${transferred}_lt_expected_${expectedAmount}`;
    } else {
      reason = `no_usdc_transfer_from_${getAddress(payerWallet)}`;
    }
  }

  return {
    checked: true,
    valid,
    ...baseFields,
    transferredAmount: transferred.toString(),
    reason,
  };
}
