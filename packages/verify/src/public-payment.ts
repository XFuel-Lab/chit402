/**
 * On-chain check for a public attestation (0.4.6, Base only).
 *
 * Reads the Base transaction receipt and requires: chain 8453, status 1,
 * at least BASE_ANCHOR_MIN_CONFIRMATIONS blocks of depth, and exactly one
 * Transfer log from the signed asset contract to the signed payee, with an
 * amount equal to the signed settled_amount. Zero or two such logs is a
 * mismatch. The sender is reported as a chain fact; it is not signed and is
 * not a payer claim.
 *
 * An RPC that does not answer, errors, or returns null is could_not_check.
 */

import { jsonRpc } from './rpc-deadline.js';
import { BASE_RPC_URL, ERC20_TRANSFER_TOPIC } from './base-payer.js';
import { BASE_ANCHOR_MIN_CONFIRMATIONS } from './anchor-witness.js';

export interface PublicPaymentInput {
  ref: string;
  asset: string;
  payee: string;
  settledAmount: string;
  rpcUrl?: string;
}

export interface PublicPaymentOutcome {
  state: 'pass' | 'fail' | 'could_not_check';
  reason: string | null;
  from: string | null;
}

type RpcLog = { address?: string; topics?: string[]; data?: string };
type RpcReceipt = { transactionHash?: string; status?: string; blockNumber?: string; logs?: RpcLog[] };

function hexToBigInt(value: unknown): bigint | null {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function topicAddress(topic: unknown): string | null {
  if (typeof topic !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(topic)) return null;
  return `0x${topic.slice(26).toLowerCase()}`;
}

export function truncateAddress(address: string | null): string | null {
  if (!address || address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export async function verifyPublicBasePayment(input: PublicPaymentInput): Promise<PublicPaymentOutcome> {
  const match = /^base:(0x[0-9a-f]{64})$/.exec(input.ref || '');
  if (!match) return { state: 'could_not_check', reason: 'public_rail_unsupported', from: null };
  const txHash = match[1];
  const url = input.rpcUrl || process.env.BASE_RPC_URL || BASE_RPC_URL;
  let receipt: RpcReceipt | null;
  let chainId: unknown;
  let tip: unknown;
  try {
    receipt = await jsonRpc(url, 'eth_getTransactionReceipt', [txHash]) as RpcReceipt | null;
    chainId = await jsonRpc(url, 'eth_chainId', []);
    tip = await jsonRpc(url, 'eth_blockNumber', []);
  } catch {
    return { state: 'could_not_check', reason: 'payer_unchecked', from: null };
  }
  if (!receipt || typeof receipt !== 'object') return { state: 'could_not_check', reason: 'payer_unchecked', from: null };
  const chain = hexToBigInt(chainId);
  if (chain == null) return { state: 'could_not_check', reason: 'payer_unchecked', from: null };
  if (chain !== 8453n) return { state: 'fail', reason: 'transfer_mismatch', from: null };
  if (typeof receipt.transactionHash === 'string' && receipt.transactionHash.toLowerCase() !== txHash) {
    return { state: 'fail', reason: 'transfer_mismatch', from: null };
  }
  const status = hexToBigInt(receipt.status);
  if (status == null) return { state: 'could_not_check', reason: 'payer_unchecked', from: null };
  if (status !== 1n) return { state: 'fail', reason: 'transfer_mismatch', from: null };
  const block = hexToBigInt(receipt.blockNumber);
  const head = hexToBigInt(tip);
  if (block == null || head == null) return { state: 'could_not_check', reason: 'payer_unchecked', from: null };
  if (head < block || head - block < BigInt(BASE_ANCHOR_MIN_CONFIRMATIONS)) {
    return { state: 'could_not_check', reason: 'payer_unchecked', from: null };
  }
  const asset = input.asset.toLowerCase();
  const payee = input.payee.toLowerCase();
  const transfers = (Array.isArray(receipt.logs) ? receipt.logs : []).filter((log) => (
    typeof log?.address === 'string'
    && log.address.toLowerCase() === asset
    && Array.isArray(log.topics)
    && log.topics.length === 3
    && String(log.topics[0]).toLowerCase() === ERC20_TRANSFER_TOPIC
    && topicAddress(log.topics[2]) === payee
  ));
  if (transfers.length !== 1) return { state: 'fail', reason: 'transfer_mismatch', from: null };
  const amount = hexToBigInt(transfers[0].data);
  if (amount == null || amount.toString() !== input.settledAmount) {
    return { state: 'fail', reason: 'transfer_mismatch', from: null };
  }
  return { state: 'pass', reason: null, from: topicAddress(transfers[0].topics?.[1]) };
}
